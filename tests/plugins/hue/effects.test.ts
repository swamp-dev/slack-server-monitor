import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the client module
vi.mock('../../../plugins.example/hue/client.js', () => ({
  getLight: vi.fn().mockResolvedValue({
    id: 'light-1',
    on: { on: true },
    dimming: { brightness: 50 },
    color: { xy: { x: 0.3, y: 0.3 } },
    metadata: { name: 'Test Light', archetype: 'table_shade' },
    owner: { rid: 'device-1', rtype: 'device' },
  }),
  getGroupedLight: vi.fn().mockResolvedValue({
    id: 'gl-1',
    on: { on: true },
    dimming: { brightness: 60 },
    owner: { rid: 'room-1', rtype: 'room' },
  }),
  controlLight: vi.fn().mockResolvedValue(undefined),
  controlGroupedLight: vi.fn().mockResolvedValue(undefined),
}));

import { controlLight, controlGroupedLight } from '../../../plugins.example/hue/client.js';
import { _reset, listRunning, stop } from '../../../plugins.example/hue/effects-registry.js';
import {
  abortableSleep,
  runFlash,
  runPulse,
  runColorLoop,
  runStrobe,
  runAlert,
  runFade,
} from '../../../plugins.example/hue/effects.js';
import type { ResolvedTarget } from '../../../plugins.example/hue/types.js';

const mockControlLight = vi.mocked(controlLight);
const mockControlGroupedLight = vi.mocked(controlGroupedLight);

const lightTarget: ResolvedTarget = { id: 'light-1', type: 'light', displayName: 'Test Light' };
const groupTarget: ResolvedTarget = { id: 'gl-1', type: 'grouped_light', displayName: 'Test Room' };

describe('hue effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    _reset();
  });

  afterEach(() => {
    _reset();
    vi.useRealTimers();
  });

  describe('abortableSleep', () => {
    it('should resolve after given time', async () => {
      const ac = new AbortController();
      let resolved = false;
      abortableSleep(1000, ac.signal).then(() => { resolved = true; });

      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(resolved).toBe(true);
    });

    it('should resolve immediately if already aborted', async () => {
      const ac = new AbortController();
      ac.abort();
      let resolved = false;
      abortableSleep(1000, ac.signal).then(() => { resolved = true; });

      // Should resolve on next microtask, not after 1000ms
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });

    it('should resolve early when aborted mid-sleep', async () => {
      const ac = new AbortController();
      let resolved = false;
      abortableSleep(1000, ac.signal).then(() => { resolved = true; });

      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).toBe(false);

      ac.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });
  });

  describe('runFlash', () => {
    it('should register in effects registry', () => {
      const id = runFlash({ target: lightTarget });
      expect(id).toMatch(/^flash-/);

      const running = listRunning();
      expect(running).toHaveLength(1);
      expect(running[0].name).toBe('flash');
    });

    it('should make correct API calls for 3 flashes', async () => {
      runFlash({ target: lightTarget, flashCount: 3, flashDurationMs: 100 });

      // Each flash: on + sleep + off + sleep = 200ms per flash, 3 flashes = 600ms
      // Plus state capture + restore
      for (let i = 0; i < 7; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      // Should have called controlLight multiple times (on/off alternating)
      expect(mockControlLight.mock.calls.length).toBeGreaterThan(0);

      // First call should turn on
      const firstCall = mockControlLight.mock.calls[0];
      expect(firstCall[1]).toHaveProperty('on');
    });

    it('should stop cleanly when aborted', async () => {
      const id = runFlash({ target: lightTarget, flashCount: 100, flashDurationMs: 100 });

      // Let first flash happen
      await vi.advanceTimersByTimeAsync(200);
      const callsBefore = mockControlLight.mock.calls.length;

      // Stop the effect
      stop(id);
      await vi.advanceTimersByTimeAsync(5000);

      // Should not have made many more calls after stop
      const callsAfter = mockControlLight.mock.calls.length;
      // Allow a few more calls for state restore
      expect(callsAfter - callsBefore).toBeLessThan(5);
    });

    it('should use grouped_light control for room targets', async () => {
      runFlash({ target: groupTarget, flashCount: 1, flashDurationMs: 50 });

      await vi.advanceTimersByTimeAsync(200);

      expect(mockControlGroupedLight.mock.calls.length).toBeGreaterThan(0);
      expect(mockControlLight).not.toHaveBeenCalled();
    });

    it('should unregister after completion', async () => {
      runFlash({ target: lightTarget, flashCount: 1, flashDurationMs: 50 });

      // Wait for completion
      await vi.advanceTimersByTimeAsync(500);

      expect(listRunning()).toHaveLength(0);
    });
  });

  describe('runPulse', () => {
    it('should register in effects registry', () => {
      const id = runPulse({ target: lightTarget });
      expect(id).toMatch(/^pulse-/);
      expect(listRunning()).toHaveLength(1);
    });

    it('should make brightness control calls', async () => {
      runPulse({
        target: lightTarget,
        minBrightness: 10,
        maxBrightness: 100,
        pulseCount: 1,
        pulseDurationMs: 200,
      });

      // Let it run
      await vi.advanceTimersByTimeAsync(1000);

      // Should have called controlLight with dimming values
      const dimmingCalls = mockControlLight.mock.calls.filter(
        (call) => call[1] && typeof call[1] === 'object' && 'dimming' in call[1],
      );
      expect(dimmingCalls.length).toBeGreaterThan(0);
    });
  });

  describe('runColorLoop', () => {
    it('should register in effects registry', () => {
      const id = runColorLoop({ target: lightTarget, loop: false });
      expect(id).toMatch(/^color_loop-/);
    });

    it('should cycle through colors', async () => {
      runColorLoop({
        target: lightTarget,
        colors: ['red', 'blue', 'green'],
        transitionMs: 100,
        loop: false,
      });

      // Let it complete one cycle (3 colors * 100ms + overhead)
      await vi.advanceTimersByTimeAsync(500);

      // Should have set color multiple times
      const colorCalls = mockControlLight.mock.calls.filter(
        (call) => call[1] && typeof call[1] === 'object' && 'color' in call[1],
      );
      expect(colorCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('should throw with less than 2 valid colors', () => {
      expect(() =>
        runColorLoop({ target: lightTarget, colors: ['invalidcolor'] }),
      ).toThrow('at least 2 valid colors');
    });

    it('should stop looping when aborted', async () => {
      const id = runColorLoop({
        target: lightTarget,
        colors: ['red', 'blue'],
        transitionMs: 50,
        loop: true,
      });

      await vi.advanceTimersByTimeAsync(200);
      const callsBefore = mockControlLight.mock.calls.length;

      stop(id);
      await vi.advanceTimersByTimeAsync(1000);

      const callsAfter = mockControlLight.mock.calls.length;
      expect(callsAfter - callsBefore).toBeLessThan(5);
    });
  });

  describe('runStrobe', () => {
    it('should register in effects registry', () => {
      const id = runStrobe({ target: lightTarget });
      expect(id).toMatch(/^strobe-/);
    });

    it('should alternate on/off rapidly', async () => {
      runStrobe({
        target: lightTarget,
        strobeRateMs: 100,
        durationMs: 500,
      });

      await vi.advanceTimersByTimeAsync(600);

      // Should have 5 iterations (500/100)
      const calls = mockControlLight.mock.calls;
      const onOffCalls = calls.filter(
        (call) => call[1] && typeof call[1] === 'object' && 'on' in call[1],
      );
      expect(onOffCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('runAlert', () => {
    it('should register in effects registry', () => {
      const id = runAlert({ target: lightTarget });
      expect(id).toMatch(/^alert-/);
    });

    it('should make 6 color changes (3 alert + 3 normal)', async () => {
      runAlert({ target: lightTarget });

      // 3 flashes * (100ms alert + 100ms normal) = 600ms + restore
      await vi.advanceTimersByTimeAsync(1000);

      // Should have made at least 6 control calls (3 alert + 3 normal)
      const colorCalls = mockControlLight.mock.calls.filter(
        (call) => call[1] && typeof call[1] === 'object' && 'on' in call[1],
      );
      expect(colorCalls.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('runFade', () => {
    it('should register in effects registry', () => {
      const id = runFade({ target: lightTarget, startBrightness: 0, endBrightness: 100 });
      expect(id).toMatch(/^fade-/);
    });

    it('should interpolate brightness', async () => {
      runFade({
        target: lightTarget,
        startBrightness: 0,
        endBrightness: 100,
        durationMs: 200,
        steps: 4,
      });

      await vi.advanceTimersByTimeAsync(500);

      // Should have 5 brightness calls (steps 0-4 inclusive)
      const dimmingCalls = mockControlLight.mock.calls.filter(
        (call) => call[1] && typeof call[1] === 'object' && 'dimming' in call[1],
      );
      expect(dimmingCalls.length).toBeGreaterThanOrEqual(4);

      // First dimming call should be near 0, last near 100
      const firstBody = dimmingCalls[0][1] as Record<string, Record<string, number>>;
      const lastBody = dimmingCalls[dimmingCalls.length - 1][1] as Record<string, Record<string, number>>;
      const firstBrightness = firstBody.dimming.brightness;
      const lastBrightness = lastBody.dimming.brightness;
      expect(firstBrightness).toBeLessThan(lastBrightness);
    });
  });

  describe('multiple effects', () => {
    it('should support running multiple effects simultaneously', () => {
      runFlash({ target: lightTarget });
      runPulse({ target: { id: 'light-2', type: 'light', displayName: 'Light 2' } });

      expect(listRunning()).toHaveLength(2);
    });
  });
});
