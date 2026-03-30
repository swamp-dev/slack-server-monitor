import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../plugins.example/hue/client.js', () => ({
  getLights: vi.fn().mockResolvedValue([
    { id: 'light-1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 50 }, owner: { rid: 'device-1', rtype: 'device' } },
  ]),
  getRooms: vi.fn().mockResolvedValue([]),
  getGroupedLights: vi.fn().mockResolvedValue([]),
  getLight: vi.fn().mockResolvedValue({
    id: 'light-1', on: { on: true }, dimming: { brightness: 50 },
    metadata: { name: 'Desk', archetype: 'table_shade' },
    owner: { rid: 'device-1', rtype: 'device' },
  }),
  getGroupedLight: vi.fn().mockResolvedValue({ id: 'gl-1', on: { on: true }, dimming: { brightness: 50 }, owner: { rid: 'room-1', rtype: 'room' } }),
  controlLight: vi.fn().mockResolvedValue(undefined),
  controlGroupedLight: vi.fn().mockResolvedValue(undefined),
}));

import { effectTools } from '../../../plugins.example/hue/tools-effects.js';
import { _reset, listRunning } from '../../../plugins.example/hue/effects-registry.js';

const dummyConfig = { allowedDirs: [], maxFileSizeKb: 100, maxLogLines: 50 };

function findTool(name: string) {
  const tool = effectTools.find((t) => t.spec.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe('hue tools-effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    _reset();
  });

  afterEach(() => {
    _reset();
    vi.useRealTimers();
  });

  describe('flash_effect', () => {
    it('should start flash and return sequence ID', async () => {
      const tool = findTool('flash_effect');
      const result = await tool.execute({ target: 'Desk' }, dummyConfig);
      expect(result).toContain('Flash effect started');
      expect(result).toContain('Sequence ID: flash-');
    });

    it('should return validation error for empty target', async () => {
      const tool = findTool('flash_effect');
      const result = await tool.execute({ target: '' }, dummyConfig);
      expect(result).toContain('Validation error');
    });
  });

  describe('pulse_effect', () => {
    it('should start pulse and return sequence ID', async () => {
      const tool = findTool('pulse_effect');
      const result = await tool.execute({ target: 'Desk' }, dummyConfig);
      expect(result).toContain('Pulse effect started');
      expect(result).toContain('Sequence ID: pulse-');
    });
  });

  describe('color_loop', () => {
    it('should start color loop and return sequence ID', async () => {
      const tool = findTool('color_loop');
      const result = await tool.execute({ target: 'Desk' }, dummyConfig);
      expect(result).toContain('Color loop started');
      expect(result).toContain('use stop_sequence to end');
    });

    it('should error with single color', async () => {
      const tool = findTool('color_loop');
      const result = await tool.execute({ target: 'Desk', colors: ['red'] }, dummyConfig);
      expect(result).toContain('Validation error');
    });
  });

  describe('strobe_effect', () => {
    it('should start strobe and return sequence ID', async () => {
      const tool = findTool('strobe_effect');
      const result = await tool.execute({ target: 'Desk' }, dummyConfig);
      expect(result).toContain('Strobe effect started');
    });

    it('should reject strobe rate below 50ms', async () => {
      const tool = findTool('strobe_effect');
      const result = await tool.execute({ target: 'Desk', strobe_rate_ms: 25 }, dummyConfig);
      expect(result).toContain('Validation error');
    });
  });

  describe('alert_effect', () => {
    it('should start alert and return sequence ID', async () => {
      const tool = findTool('alert_effect');
      const result = await tool.execute({ target: 'Desk' }, dummyConfig);
      expect(result).toContain('Alert effect started');
    });
  });

  describe('fade_effect', () => {
    it('should start fade and return sequence ID', async () => {
      const tool = findTool('fade_effect');
      const result = await tool.execute({
        target: 'Desk',
        start_brightness: 0,
        end_brightness: 100,
      }, dummyConfig);
      expect(result).toContain('Fade effect started');
    });
  });

  describe('list_sequences', () => {
    it('should return "no effects" when empty', async () => {
      const tool = findTool('list_sequences');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('No effects currently running');
    });

    it('should list running effects', async () => {
      // Start an effect
      const flash = findTool('flash_effect');
      await flash.execute({ target: 'Desk', flash_count: 100 }, dummyConfig);

      const tool = findTool('list_sequences');
      const result = await tool.execute({}, dummyConfig);
      expect(result).toContain('Running effects (1)');
      expect(result).toContain('flash-');
    });
  });

  describe('stop_sequence', () => {
    it('should stop a running effect by ID', async () => {
      // Start an effect
      const flash = findTool('flash_effect');
      const startResult = await flash.execute({ target: 'Desk', flash_count: 100 }, dummyConfig);
      const idMatch = startResult.match(/Sequence ID: (flash-\d+)/);
      const id = idMatch?.[1];

      const tool = findTool('stop_sequence');
      const result = await tool.execute({ sequence_id: id }, dummyConfig);
      expect(result).toContain('Stopped sequence');
    });

    it('should stop all effects', async () => {
      const flash = findTool('flash_effect');
      await flash.execute({ target: 'Desk' }, dummyConfig);
      await flash.execute({ target: 'Desk' }, dummyConfig);

      const tool = findTool('stop_sequence');
      const result = await tool.execute({ sequence_id: 'all' }, dummyConfig);
      expect(result).toContain('Stopped 2');
      expect(listRunning()).toHaveLength(0);
    });

    it('should return error for unknown ID', async () => {
      const tool = findTool('stop_sequence');
      const result = await tool.execute({ sequence_id: 'nonexistent-99' }, dummyConfig);
      expect(result).toContain('No running sequence');
    });

    it('should return validation error for empty ID', async () => {
      const tool = findTool('stop_sequence');
      const result = await tool.execute({ sequence_id: '' }, dummyConfig);
      expect(result).toContain('Validation error');
    });
  });
});
