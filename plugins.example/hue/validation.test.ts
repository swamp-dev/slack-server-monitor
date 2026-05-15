import { describe, it, expect } from 'vitest';
import {
  validate,
  ControlLightSchema,
  ActivateSceneSchema,
  FlashEffectSchema,
  PulseEffectSchema,
  ColorLoopSchema,
  StrobeEffectSchema,
  AlertEffectSchema,
  FadeEffectSchema,
  StopSequenceSchema,
  BatchCommandsSchema,
  CustomSequenceSchema,
  CreateSceneSchema,
  GetLightStateSchema,
} from './validation.js';

describe('hue validation', () => {
  describe('validate helper', () => {
    it('should return success with parsed data', () => {
      const result = validate(ControlLightSchema, { target: 'Office', action: 'on' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.target).toBe('Office');
        expect(result.data.action).toBe('on');
      }
    });

    it('should return error with descriptive message', () => {
      const result = validate(ControlLightSchema, { target: '', action: 'on' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('target');
      }
    });
  });

  describe('ControlLightSchema', () => {
    it('should accept valid on/off', () => {
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'on' }).success).toBe(true);
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'off' }).success).toBe(true);
    });

    it('should accept dim with brightness', () => {
      const result = validate(ControlLightSchema, { target: 'Desk', action: 'dim', brightness: 50 });
      expect(result.success).toBe(true);
    });

    it('should accept color with color_name', () => {
      const result = validate(ControlLightSchema, { target: 'Desk', action: 'color', color_name: 'red' });
      expect(result.success).toBe(true);
    });

    it('should reject empty target', () => {
      expect(validate(ControlLightSchema, { target: '', action: 'on' }).success).toBe(false);
    });

    it('should reject invalid action', () => {
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'blink' }).success).toBe(false);
    });

    it('should reject brightness out of range', () => {
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'dim', brightness: -1 }).success).toBe(false);
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'dim', brightness: 101 }).success).toBe(false);
    });

    it('should accept brightness at boundaries', () => {
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'dim', brightness: 0 }).success).toBe(true);
      expect(validate(ControlLightSchema, { target: 'Desk', action: 'dim', brightness: 100 }).success).toBe(true);
    });
  });

  describe('ActivateSceneSchema', () => {
    it('should accept valid scene name', () => {
      expect(validate(ActivateSceneSchema, { scene_name: 'Relax' }).success).toBe(true);
    });

    it('should reject empty scene name', () => {
      expect(validate(ActivateSceneSchema, { scene_name: '' }).success).toBe(false);
    });
  });

  describe('FlashEffectSchema', () => {
    it('should accept minimal input with defaults', () => {
      const result = validate(FlashEffectSchema, { target: 'Desk' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.color).toBe('#FFFFFF');
        expect(result.data.flash_count).toBe(3);
        expect(result.data.flash_duration_ms).toBe(200);
      }
    });

    it('should accept custom values', () => {
      const result = validate(FlashEffectSchema, {
        target: 'Desk',
        color: '#FF0000',
        flash_count: 5,
        flash_duration_ms: 500,
      });
      expect(result.success).toBe(true);
    });

    it('should reject zero flash_count', () => {
      expect(validate(FlashEffectSchema, { target: 'Desk', flash_count: 0 }).success).toBe(false);
    });
  });

  describe('PulseEffectSchema', () => {
    it('should provide sensible defaults', () => {
      const result = validate(PulseEffectSchema, { target: 'Lamp' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.min_brightness).toBe(10);
        expect(result.data.max_brightness).toBe(100);
        expect(result.data.pulse_count).toBe(5);
        expect(result.data.pulse_duration_ms).toBe(2000);
      }
    });

    it('should reject brightness over 100', () => {
      expect(validate(PulseEffectSchema, { target: 'Lamp', max_brightness: 150 }).success).toBe(false);
    });
  });

  describe('ColorLoopSchema', () => {
    it('should accept with defaults', () => {
      const result = validate(ColorLoopSchema, { target: 'Strip' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.loop).toBe(true);
        expect(result.data.transition_ms).toBe(1000);
      }
    });

    it('should reject colors array with less than 2 items', () => {
      expect(validate(ColorLoopSchema, { target: 'Strip', colors: ['red'] }).success).toBe(false);
    });

    it('should accept colors array with 2+ items', () => {
      expect(validate(ColorLoopSchema, { target: 'Strip', colors: ['red', 'blue'] }).success).toBe(true);
    });
  });

  describe('StrobeEffectSchema', () => {
    it('should reject strobe_rate_ms below 50', () => {
      expect(validate(StrobeEffectSchema, { target: 'Lamp', strobe_rate_ms: 25 }).success).toBe(false);
    });

    it('should accept strobe_rate_ms at minimum (50)', () => {
      expect(validate(StrobeEffectSchema, { target: 'Lamp', strobe_rate_ms: 50 }).success).toBe(true);
    });
  });

  describe('AlertEffectSchema', () => {
    it('should provide red/white defaults', () => {
      const result = validate(AlertEffectSchema, { target: 'Light' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.alert_color).toBe('#FF0000');
        expect(result.data.normal_color).toBe('#FFFFFF');
      }
    });
  });

  describe('FadeEffectSchema', () => {
    it('should provide defaults for duration and steps', () => {
      const result = validate(FadeEffectSchema, { target: 'Lamp' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.duration_ms).toBe(3000);
        expect(result.data.steps).toBe(20);
      }
    });

    it('should reject steps below 2', () => {
      expect(validate(FadeEffectSchema, { target: 'Lamp', steps: 1 }).success).toBe(false);
    });

    it('should reject steps above 100', () => {
      expect(validate(FadeEffectSchema, { target: 'Lamp', steps: 101 }).success).toBe(false);
    });
  });

  describe('StopSequenceSchema', () => {
    it('should accept "all"', () => {
      expect(validate(StopSequenceSchema, { sequence_id: 'all' }).success).toBe(true);
    });

    it('should reject empty string', () => {
      expect(validate(StopSequenceSchema, { sequence_id: '' }).success).toBe(false);
    });
  });

  describe('BatchCommandsSchema', () => {
    it('should accept valid batch', () => {
      const result = validate(BatchCommandsSchema, {
        commands: [
          { action: 'on', target: 'Desk' },
          { action: 'color', target: 'Lamp', value: '#FF0000' },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.delay_ms).toBe(100);
        expect(result.data.async).toBe(true);
      }
    });

    it('should reject empty commands array', () => {
      expect(validate(BatchCommandsSchema, { commands: [] }).success).toBe(false);
    });
  });

  describe('CustomSequenceSchema', () => {
    it('should accept valid sequence', () => {
      const result = validate(CustomSequenceSchema, {
        steps: [
          { action: 'color', target: 'Desk', value: '#FF0000' },
          { action: 'brightness', target: 'Desk', value: '50', delay_ms: 1000 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty steps', () => {
      expect(validate(CustomSequenceSchema, { steps: [] }).success).toBe(false);
    });
  });

  describe('CreateSceneSchema', () => {
    it('should accept valid input', () => {
      expect(validate(CreateSceneSchema, { name: 'Cozy', room_name: 'Office' }).success).toBe(true);
    });

    it('should reject empty name', () => {
      expect(validate(CreateSceneSchema, { name: '', room_name: 'Office' }).success).toBe(false);
    });

    it('should reject empty room_name', () => {
      expect(validate(CreateSceneSchema, { name: 'Cozy', room_name: '' }).success).toBe(false);
    });
  });

  describe('GetLightStateSchema', () => {
    it('should accept valid light name', () => {
      expect(validate(GetLightStateSchema, { light_name: 'Desk' }).success).toBe(true);
    });

    it('should reject empty', () => {
      expect(validate(GetLightStateSchema, { light_name: '' }).success).toBe(false);
    });
  });
});
