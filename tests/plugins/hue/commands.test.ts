import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../plugins.example/hue/client.js', () => ({
  getLights: vi.fn().mockResolvedValue([
    { id: 'light-1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'device-1', rtype: 'device' } },
    { id: 'light-2', metadata: { name: 'Lamp', archetype: 'floor_shade' }, on: { on: false }, owner: { rid: 'device-2', rtype: 'device' } },
  ]),
  getRooms: vi.fn().mockResolvedValue([
    { id: 'room-1', metadata: { name: 'Office' }, children: [{ rid: 'device-1', rtype: 'device' }], services: [] },
  ]),
  getGroupedLights: vi.fn().mockResolvedValue([
    { id: 'gl-1', on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'room-1', rtype: 'room' } },
  ]),
  getScenes: vi.fn().mockResolvedValue([
    { id: 'scene-1', metadata: { name: 'Relax' }, group: { rid: 'room-1', rtype: 'room' } },
    { id: 'scene-2', metadata: { name: 'Energize' }, group: { rid: 'room-1', rtype: 'room' } },
  ]),
  activateScene: vi.fn().mockResolvedValue(undefined),
  controlLight: vi.fn().mockResolvedValue(undefined),
  controlGroupedLight: vi.fn().mockResolvedValue(undefined),
}));

import { controlLight, controlGroupedLight, activateScene } from '../../../plugins.example/hue/client.js';
import { parseArgs, lightStatusLine, handleHueCommand } from '../../../plugins.example/hue/commands.js';
import type { HueLight } from '../../../plugins.example/hue/types.js';

const mockControlLight = vi.mocked(controlLight);
const mockControlGroupedLight = vi.mocked(controlGroupedLight);
const mockActivateScene = vi.mocked(activateScene);

describe('hue commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseArgs', () => {
    it('should parse space-separated args', () => {
      expect(parseArgs('on Desk')).toEqual(['on', 'Desk']);
    });

    it('should handle multiple spaces', () => {
      expect(parseArgs('dim   Desk   75')).toEqual(['dim', 'Desk', '75']);
    });

    it('should return empty array for empty string', () => {
      expect(parseArgs('')).toEqual([]);
    });

    it('should trim whitespace', () => {
      expect(parseArgs('  help  ')).toEqual(['help']);
    });
  });

  describe('lightStatusLine', () => {
    it('should format light that is on with brightness', () => {
      const light = {
        id: 'l1', metadata: { name: 'Desk', archetype: 'table_shade' },
        on: { on: true }, dimming: { brightness: 80 },
        owner: { rid: 'd1', rtype: 'device' },
      } as HueLight;
      const line = lightStatusLine(light);
      expect(line).toContain('Desk');
      expect(line).toContain('on');
      expect(line).toContain('80%');
    });

    it('should format light that is off', () => {
      const light = {
        id: 'l2', metadata: { name: 'Lamp', archetype: 'floor_shade' },
        on: { on: false },
        owner: { rid: 'd2', rtype: 'device' },
      } as HueLight;
      const line = lightStatusLine(light);
      expect(line).toContain('Lamp');
      expect(line).toContain('off');
    });
  });

  describe('handleHueCommand', () => {
    it('should show dashboard for empty args', async () => {
      const result = await handleHueCommand([]);
      expect(result.blocks).toBeDefined();
      // Dashboard shows light counts
    });

    it('should show help', async () => {
      const result = await handleHueCommand(['help']);
      const text = JSON.stringify(result);
      expect(text).toContain('/hue');
      expect(text).toContain('dashboard');
    });

    it('should list rooms', async () => {
      const result = await handleHueCommand(['rooms']);
      const text = JSON.stringify(result);
      expect(text).toContain('Office');
    });

    it('should list scenes', async () => {
      const result = await handleHueCommand(['scenes']);
      const text = JSON.stringify(result);
      expect(text).toContain('Relax');
      expect(text).toContain('Energize');
    });

    it('should turn on all rooms when no name given', async () => {
      await handleHueCommand(['on']);
      expect(mockControlGroupedLight).toHaveBeenCalledWith('gl-1', { on: { on: true } });
    });

    it('should turn on specific light', async () => {
      await handleHueCommand(['on', 'Desk']);
      expect(mockControlLight).toHaveBeenCalledWith('light-1', { on: { on: true } });
    });

    it('should turn off all rooms when no name given', async () => {
      await handleHueCommand(['off']);
      expect(mockControlGroupedLight).toHaveBeenCalledWith('gl-1', { on: { on: false } });
    });

    it('should turn off specific light', async () => {
      await handleHueCommand(['off', 'Desk']);
      expect(mockControlLight).toHaveBeenCalledWith('light-1', { on: { on: false } });
    });

    it('should set brightness with dim', async () => {
      await handleHueCommand(['dim', 'Desk', '75']);
      expect(mockControlLight).toHaveBeenCalledWith('light-1', {
        on: { on: true },
        dimming: { brightness: 75 },
      });
    });

    it('should error on dim without args', async () => {
      const result = await handleHueCommand(['dim']);
      const text = JSON.stringify(result);
      expect(text).toContain('Usage');
    });

    it('should error on dim with invalid brightness', async () => {
      const result = await handleHueCommand(['dim', 'Desk', '150']);
      const text = JSON.stringify(result);
      expect(text).toContain('Usage');
    });

    it('should activate scene', async () => {
      await handleHueCommand(['scene', 'Relax']);
      expect(mockActivateScene).toHaveBeenCalledWith('scene-1');
    });

    it('should error on scene without name', async () => {
      const result = await handleHueCommand(['scene']);
      const text = JSON.stringify(result);
      expect(text).toContain('Usage');
    });

    it('should error on unknown scene', async () => {
      const result = await handleHueCommand(['scene', 'NonExistent']);
      const text = JSON.stringify(result);
      expect(text).toContain('No scene matching');
    });

    it('should set named color', async () => {
      await handleHueCommand(['color', 'Desk', 'red']);
      expect(mockControlLight).toHaveBeenCalled();
      const call = mockControlLight.mock.calls[0];
      expect(call[1]).toHaveProperty('color');
    });

    it('should set hex color', async () => {
      await handleHueCommand(['color', 'Desk', '#FF0000']);
      expect(mockControlLight).toHaveBeenCalled();
      const call = mockControlLight.mock.calls[0];
      expect(call[1]).toHaveProperty('color');
    });

    it('should set two-word color', async () => {
      await handleHueCommand(['color', 'Desk', 'warm', 'white']);
      expect(mockControlLight).toHaveBeenCalled();
    });

    it('should error on color without args', async () => {
      const result = await handleHueCommand(['color']);
      const text = JSON.stringify(result);
      expect(text).toContain('Usage');
    });

    it('should error on unknown command', async () => {
      const result = await handleHueCommand(['blink']);
      const text = JSON.stringify(result);
      expect(text).toContain('Unknown command');
    });
  });
});
