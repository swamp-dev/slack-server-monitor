import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./client.js', () => ({
  getLights: vi.fn().mockResolvedValue([
    { id: 'light-1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 50 }, owner: { rid: 'device-1', rtype: 'device' } },
  ]),
  getRooms: vi.fn().mockResolvedValue([]),
  getGroupedLights: vi.fn().mockResolvedValue([]),
  getScenes: vi.fn().mockResolvedValue([
    { id: 'scene-1', metadata: { name: 'Relax' }, group: { rid: 'room-1', rtype: 'room' } },
  ]),
  controlLight: vi.fn().mockResolvedValue(undefined),
  controlGroupedLight: vi.fn().mockResolvedValue(undefined),
  activateScene: vi.fn().mockResolvedValue(undefined),
  getLight: vi.fn().mockResolvedValue({
    id: 'light-1', on: { on: true }, dimming: { brightness: 50 },
    metadata: { name: 'Desk', archetype: 'table_shade' },
    owner: { rid: 'device-1', rtype: 'device' },
  }),
}));

import { controlLight, activateScene } from './client.js';
import { _reset, listRunning, stop } from './effects-registry.js';
import { executeStep, runSequence, executeBatch } from './sequences.js';
import type { SequenceStep } from './sequences.js';

const mockControlLight = vi.mocked(controlLight);
const mockActivateScene = vi.mocked(activateScene);

describe('hue sequences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    _reset();
  });

  afterEach(() => {
    _reset();
    vi.useRealTimers();
  });

  describe('executeStep', () => {
    it('should execute "on" action', async () => {
      const result = await executeStep({ action: 'on', target: 'Desk' });
      expect(result).toContain('Turned on');
      expect(mockControlLight).toHaveBeenCalledWith('light-1', { on: { on: true } });
    });

    it('should execute "off" action', async () => {
      const result = await executeStep({ action: 'off', target: 'Desk' });
      expect(result).toContain('Turned off');
      expect(mockControlLight).toHaveBeenCalledWith('light-1', { on: { on: false } });
    });

    it('should execute "color" action', async () => {
      const result = await executeStep({ action: 'color', target: 'Desk', value: 'red' });
      expect(result).toContain('red');
      expect(mockControlLight).toHaveBeenCalled();
    });

    it('should return error for color without value', async () => {
      const result = await executeStep({ action: 'color', target: 'Desk' });
      expect(result).toContain('Error');
    });

    it('should execute "brightness" action', async () => {
      const result = await executeStep({ action: 'brightness', target: 'Desk', value: '75' });
      expect(result).toContain('75%');
      expect(mockControlLight).toHaveBeenCalledWith('light-1', {
        on: { on: true },
        dimming: { brightness: 75 },
      });
    });

    it('should return error for invalid brightness', async () => {
      const result = await executeStep({ action: 'brightness', target: 'Desk', value: '150' });
      expect(result).toContain('Error');
    });

    it('should execute "scene" action', async () => {
      const result = await executeStep({ action: 'scene', target: 'Relax' });
      expect(result).toContain('Relax');
      expect(mockActivateScene).toHaveBeenCalledWith('scene-1');
    });

    it('should return error for unknown scene', async () => {
      const result = await executeStep({ action: 'scene', target: 'NonExistent' });
      expect(result).toContain('Error');
    });
  });

  describe('runSequence', () => {
    it('should register in effects registry', () => {
      const steps: SequenceStep[] = [
        { action: 'on', target: 'Desk' },
      ];
      const id = runSequence(steps);
      expect(id).toMatch(/^sequence-/);
      expect(listRunning()).toHaveLength(1);
    });

    it('should execute steps with delays', async () => {
      const steps: SequenceStep[] = [
        { action: 'on', target: 'Desk', delay_ms: 0 },
        { action: 'color', target: 'Desk', value: 'red', delay_ms: 200 },
      ];
      runSequence(steps, { defaultDelayMs: 0 });

      // First step executes immediately
      await vi.advanceTimersByTimeAsync(50);
      expect(mockControlLight).toHaveBeenCalledTimes(1);

      // Second step after delay
      await vi.advanceTimersByTimeAsync(250);
      expect(mockControlLight.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should stop when aborted', async () => {
      const steps: SequenceStep[] = [
        { action: 'on', target: 'Desk', delay_ms: 100 },
        { action: 'off', target: 'Desk', delay_ms: 100 },
      ];
      const id = runSequence(steps, { loop: true });

      await vi.advanceTimersByTimeAsync(300);
      const callsBefore = mockControlLight.mock.calls.length;

      stop(id);
      await vi.advanceTimersByTimeAsync(1000);

      const callsAfter = mockControlLight.mock.calls.length;
      expect(callsAfter - callsBefore).toBeLessThan(3);
    });

    it('should unregister after non-looping completion', async () => {
      const steps: SequenceStep[] = [
        { action: 'on', target: 'Desk', delay_ms: 0 },
      ];
      runSequence(steps, { defaultDelayMs: 0 });

      await vi.advanceTimersByTimeAsync(200);
      expect(listRunning()).toHaveLength(0);
    });
  });

  describe('executeBatch', () => {
    it('should execute all commands and return results', async () => {
      vi.useRealTimers();
      const steps: SequenceStep[] = [
        { action: 'on', target: 'Desk' },
        { action: 'brightness', target: 'Desk', value: '80' },
      ];

      const results = await executeBatch(steps, 0);
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].step).toBe(1);
      expect(results[1].success).toBe(true);
      expect(results[1].step).toBe(2);
    });

    it('should report failures without stopping', async () => {
      vi.useRealTimers();
      const steps: SequenceStep[] = [
        { action: 'on', target: 'Desk' },
        { action: 'brightness', target: 'Desk', value: 'invalid' },
        { action: 'off', target: 'Desk' },
      ];

      const results = await executeBatch(steps, 0);
      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });
});
