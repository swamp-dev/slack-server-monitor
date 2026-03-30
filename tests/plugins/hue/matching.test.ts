import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findByName, listNames } from '../../../plugins.example/hue/matching.js';

// Mock the client module for findTarget/controlTarget tests
vi.mock('../../../plugins.example/hue/client.js', () => ({
  getLights: vi.fn(),
  getRooms: vi.fn(),
  getGroupedLights: vi.fn(),
  controlLight: vi.fn(),
  controlGroupedLight: vi.fn(),
}));

import { getLights, getRooms, getGroupedLights, controlLight, controlGroupedLight } from '../../../plugins.example/hue/client.js';
import { findTarget, controlTarget } from '../../../plugins.example/hue/matching.js';

const mockGetLights = vi.mocked(getLights);
const mockGetRooms = vi.mocked(getRooms);
const mockGetGroupedLights = vi.mocked(getGroupedLights);
const mockControlLight = vi.mocked(controlLight);
const mockControlGroupedLight = vi.mocked(controlGroupedLight);

// Test data
const lights = [
  { id: 'light-1', metadata: { name: 'Office Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'device-1', rtype: 'device' } },
  { id: 'light-2', metadata: { name: 'Living Room Lamp', archetype: 'floor_shade' }, on: { on: false }, owner: { rid: 'device-2', rtype: 'device' } },
  { id: 'light-3', metadata: { name: 'Bedroom Light', archetype: 'ceiling_round' }, on: { on: true }, dimming: { brightness: 50 }, owner: { rid: 'device-3', rtype: 'device' } },
];

const rooms = [
  { id: 'room-1', metadata: { name: 'Office' }, children: [{ rid: 'device-1', rtype: 'device' }], services: [{ rid: 'gl-1', rtype: 'grouped_light' }] },
  { id: 'room-2', metadata: { name: 'Living Room' }, children: [{ rid: 'device-2', rtype: 'device' }], services: [{ rid: 'gl-2', rtype: 'grouped_light' }] },
];

const groupedLights = [
  { id: 'gl-1', on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'room-1', rtype: 'room' } },
  { id: 'gl-2', on: { on: false }, owner: { rid: 'room-2', rtype: 'room' } },
];

describe('hue matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findByName', () => {
    it('should find exact match (case-insensitive)', () => {
      const result = findByName(lights, 'Office Desk');
      expect(result?.id).toBe('light-1');
    });

    it('should find exact match regardless of case', () => {
      const result = findByName(lights, 'office desk');
      expect(result?.id).toBe('light-1');
    });

    it('should fall back to substring match', () => {
      const result = findByName(lights, 'Desk');
      expect(result?.id).toBe('light-1');
    });

    it('should prefer exact match over substring', () => {
      const items = [
        { id: '1', metadata: { name: 'Office' } },
        { id: '2', metadata: { name: 'Office Desk' } },
      ];
      const result = findByName(items, 'Office');
      expect(result?.id).toBe('1');
    });

    it('should return undefined when no match', () => {
      const result = findByName(lights, 'Kitchen');
      expect(result).toBeUndefined();
    });

    it('should handle empty query', () => {
      // Empty string is a substring of everything, so it returns the first item
      const result = findByName(lights, '');
      expect(result).toBeDefined();
    });

    it('should handle empty items array', () => {
      const result = findByName([], 'anything');
      expect(result).toBeUndefined();
    });
  });

  describe('listNames', () => {
    it('should join names with commas', () => {
      const result = listNames(lights);
      expect(result).toBe('Office Desk, Living Room Lamp, Bedroom Light');
    });

    it('should return empty string for empty array', () => {
      const result = listNames([]);
      expect(result).toBe('');
    });

    it('should return single name without comma', () => {
      const result = listNames([lights[0]]);
      expect(result).toBe('Office Desk');
    });
  });

  describe('findTarget', () => {
    it('should find a light by name', async () => {
      mockGetLights.mockResolvedValue(lights as never);
      mockGetRooms.mockResolvedValue(rooms as never);
      mockGetGroupedLights.mockResolvedValue(groupedLights as never);
      const target = await findTarget('Office Desk');
      expect(target).toEqual({
        id: 'light-1',
        type: 'light',
        displayName: 'Office Desk',
      });
    });

    it('should prefer exact room match over light substring match', async () => {
      mockGetLights.mockResolvedValue(lights as never);
      mockGetRooms.mockResolvedValue(rooms as never);
      mockGetGroupedLights.mockResolvedValue(groupedLights as never);

      // "Office" exact-matches room before substring-matching "Office Desk" light
      const target = await findTarget('Office');
      expect(target.type).toBe('grouped_light');
      expect(target.displayName).toBe('Office');
    });

    it('should find a room when no light matches', async () => {
      mockGetLights.mockResolvedValue([]);
      mockGetRooms.mockResolvedValue(rooms as never);
      mockGetGroupedLights.mockResolvedValue(groupedLights as never);

      const target = await findTarget('Living Room');
      expect(target).toEqual({
        id: 'gl-2',
        type: 'grouped_light',
        displayName: 'Living Room',
      });
    });

    it('should find substring light when no exact matches exist', async () => {
      mockGetLights.mockResolvedValue(lights as never);
      mockGetRooms.mockResolvedValue(rooms as never);
      mockGetGroupedLights.mockResolvedValue(groupedLights as never);

      const target = await findTarget('Desk');
      expect(target.type).toBe('light');
      expect(target.displayName).toBe('Office Desk');
    });

    it('should throw when nothing matches', async () => {
      mockGetLights.mockResolvedValue(lights as never);
      mockGetRooms.mockResolvedValue(rooms as never);
      mockGetGroupedLights.mockResolvedValue(groupedLights as never);

      await expect(findTarget('Kitchen')).rejects.toThrow(
        /No light or room matching "Kitchen"/,
      );
    });

    it('should include available names in error message', async () => {
      mockGetLights.mockResolvedValue(lights as never);
      mockGetRooms.mockResolvedValue(rooms as never);
      mockGetGroupedLights.mockResolvedValue(groupedLights as never);

      await expect(findTarget('Kitchen')).rejects.toThrow(/Office Desk/);
    });
  });

  describe('controlTarget', () => {
    it('should call controlLight for light targets', async () => {
      mockControlLight.mockResolvedValue(undefined);
      await controlTarget(
        { id: 'light-1', type: 'light', displayName: 'Test' },
        { on: { on: true } },
      );
      expect(mockControlLight).toHaveBeenCalledWith('light-1', { on: { on: true } });
    });

    it('should call controlGroupedLight for grouped_light targets', async () => {
      mockControlGroupedLight.mockResolvedValue(undefined);
      await controlTarget(
        { id: 'gl-1', type: 'grouped_light', displayName: 'Test' },
        { on: { on: false } },
      );
      expect(mockControlGroupedLight).toHaveBeenCalledWith('gl-1', { on: { on: false } });
    });
  });
});
