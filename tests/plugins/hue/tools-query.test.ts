import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../plugins.example/hue/client.js', () => ({
  getLights: vi.fn().mockResolvedValue([
    { id: 'light-1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 80 }, color: { xy: { x: 0.3, y: 0.3 } }, color_temperature: { mirek: 250 }, owner: { rid: 'device-1', rtype: 'device' } },
  ]),
  getRooms: vi.fn().mockResolvedValue([
    { id: 'room-1', metadata: { name: 'Office' }, children: [{ rid: 'device-1', rtype: 'device' }], services: [] },
  ]),
  getGroupedLights: vi.fn().mockResolvedValue([]),
  getLight: vi.fn().mockResolvedValue({
    id: 'light-1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true },
    dimming: { brightness: 80 }, color: { xy: { x: 0.3, y: 0.3 } }, color_temperature: { mirek: 250 },
    owner: { rid: 'device-1', rtype: 'device' },
  }),
  getDevices: vi.fn().mockResolvedValue([
    { id: 'device-1', metadata: { name: 'Desk Light', archetype: 'sultan_bulb' }, product_data: { model_id: 'LCT007', manufacturer_name: 'Signify', product_name: 'Hue White and Color', software_version: '1.104.2' }, services: [{ rid: 'light-1', rtype: 'light' }] },
  ]),
  getDevice: vi.fn().mockResolvedValue({
    id: 'device-1', metadata: { name: 'Desk Light', archetype: 'sultan_bulb' },
    product_data: { model_id: 'LCT007', manufacturer_name: 'Signify', product_name: 'Hue White and Color', software_version: '1.104.2' },
    services: [{ rid: 'light-1', rtype: 'light' }],
  }),
  getBridge: vi.fn().mockResolvedValue([
    { id: 'bridge-1', bridge_id: 'AABBCCDD', time_zone: { time_zone: 'America/New_York' } },
  ]),
  getZones: vi.fn().mockResolvedValue([]),
  getMotionSensors: vi.fn().mockResolvedValue([
    { id: 'motion-1', enabled: true, motion: { motion: true, motion_valid: true }, owner: { rid: 'device-2', rtype: 'device' } },
    { id: 'motion-2', enabled: false, motion: { motion: false, motion_valid: true }, owner: { rid: 'device-3', rtype: 'device' } },
  ]),
  getTemperatureSensors: vi.fn().mockResolvedValue([
    { id: 'temp-1', enabled: true, temperature: { temperature: 22.5, temperature_valid: true }, owner: { rid: 'device-2', rtype: 'device' } },
  ]),
  getLightLevelSensors: vi.fn().mockResolvedValue([
    { id: 'lux-1', enabled: true, light: { light_level: 25000, light_level_valid: true }, owner: { rid: 'device-2', rtype: 'device' } },
  ]),
  getButtons: vi.fn().mockResolvedValue([
    { id: 'button-1', metadata: { control_id: 1 }, button: { last_event: 'short_release' }, owner: { rid: 'device-4', rtype: 'device' } },
  ]),
  controlLight: vi.fn(),
  controlGroupedLight: vi.fn(),
}));

import { queryTools } from '../../../plugins.example/hue/tools-query.js';

const dummyConfig = { allowedDirs: [], maxFileSizeKb: 100, maxLogLines: 50 };

function findTool(name: string) {
  const tool = queryTools.find((t) => t.spec.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe('hue query tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_light_state', () => {
    it('should return full light state', async () => {
      const tool = findTool('get_light_state');
      const result = await tool.execute({ light_name: 'Desk' }, dummyConfig);
      expect(result).toContain('Desk');
      expect(result).toContain('80%');
      expect(result).toContain('250 mirek');
    });

    it('should return error for unknown light', async () => {
      const tool = findTool('get_light_state');
      const result = await tool.execute({ light_name: 'NonExistent' }, dummyConfig);
      expect(result).toContain('No light matching');
    });
  });

  describe('bridge_info', () => {
    it('should return bridge information', async () => {
      const tool = findTool('bridge_info');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('AABBCCDD');
      expect(result).toContain('America/New_York');
      expect(result).toContain('Lights: 1');
    });
  });

  describe('list_devices', () => {
    it('should list devices with product info', async () => {
      const tool = findTool('list_devices');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('Desk Light');
      expect(result).toContain('Signify');
      expect(result).toContain('LCT007');
    });
  });

  describe('get_device', () => {
    it('should return device details', async () => {
      const tool = findTool('get_device');
      const result = await tool.execute({ device_name: 'Desk Light' }, dummyConfig);
      expect(result).toContain('Desk Light');
      expect(result).toContain('Signify');
      expect(result).toContain('1.104.2');
    });
  });

  describe('list_motion_sensors', () => {
    it('should list motion sensors with state', async () => {
      const tool = findTool('list_motion_sensors');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('MOTION DETECTED');
      expect(result).toContain('no motion');
      expect(result).toContain('(disabled)');
    });
  });

  describe('list_temperature_sensors', () => {
    it('should show celsius and fahrenheit', async () => {
      const tool = findTool('list_temperature_sensors');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('22.5°C');
      expect(result).toContain('73°F');
    });
  });

  describe('list_light_level_sensors', () => {
    it('should show lux values', async () => {
      const tool = findTool('list_light_level_sensors');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('lux');
      expect(result).toContain('25000');
    });
  });

  describe('list_buttons', () => {
    it('should show button events', async () => {
      const tool = findTool('list_buttons');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('short_release');
      expect(result).toContain('control 1');
    });
  });
});
