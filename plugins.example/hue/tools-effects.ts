/**
 * Claude AI tool definitions for Hue effects.
 */

import type { ToolDefinition, ToolConfig } from '../../src/services/tools/types.js';
import { findTarget } from './matching.js';
import { COLORS, RAINBOW_COLORS } from './colors.js';
import { listRunning, stop, stopAll } from './effects-registry.js';
import {
  runFlash,
  runPulse,
  runColorLoop,
  runStrobe,
  runAlert,
  runFade,
} from './effects.js';
import {
  validate,
  FlashEffectSchema,
  PulseEffectSchema,
  ColorLoopSchema,
  StrobeEffectSchema,
  AlertEffectSchema,
  FadeEffectSchema,
  StopSequenceSchema,
} from './validation.js';

export const effectTools: ToolDefinition[] = [
  {
    spec: {
      name: 'flash_effect',
      description:
        'Flash a light or room with attention-getting on/off flashes. Returns a sequence ID that can be used with stop_sequence.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Light or room name' },
          color: { type: 'string', description: `Color name or hex (#RRGGBB). Default: white. Available: ${Object.keys(COLORS).join(', ')}` },
          flash_count: { type: 'number', description: 'Number of flashes (default: 3)' },
          flash_duration_ms: { type: 'number', description: 'Duration of each flash on/off in ms (default: 200)' },
        },
        required: ['target'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(FlashEffectSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const target = await findTarget(parsed.data.target);
        const id = runFlash({
          target,
          color: parsed.data.color,
          flashCount: parsed.data.flash_count,
          flashDurationMs: parsed.data.flash_duration_ms,
        });
        return `Flash effect started on ${target.displayName}. Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'pulse_effect',
      description:
        'Create a breathing/heartbeat pulsing effect on a light or room. Fades brightness up and down repeatedly.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Light or room name' },
          min_brightness: { type: 'number', description: 'Minimum brightness 0-100 (default: 10)' },
          max_brightness: { type: 'number', description: 'Maximum brightness 0-100 (default: 100)' },
          pulse_count: { type: 'number', description: 'Number of pulses (default: 5)' },
          pulse_duration_ms: { type: 'number', description: 'Duration of one full pulse cycle in ms (default: 2000)' },
        },
        required: ['target'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(PulseEffectSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const target = await findTarget(parsed.data.target);
        const id = runPulse({
          target,
          minBrightness: parsed.data.min_brightness,
          maxBrightness: parsed.data.max_brightness,
          pulseCount: parsed.data.pulse_count,
          pulseDurationMs: parsed.data.pulse_duration_ms,
        });
        return `Pulse effect started on ${target.displayName}. Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'color_loop',
      description:
        'Cycle through colors on a light or room. Loops indefinitely by default (use stop_sequence to end). Supports custom colors or defaults to rainbow.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Light or room name' },
          colors: {
            type: 'array',
            items: { type: 'string' },
            description: `Array of color names or hex values. Default: rainbow (${RAINBOW_COLORS.join(', ')}). Min 2 colors.`,
          },
          transition_ms: { type: 'number', description: 'Time between color changes in ms (default: 1000)' },
          loop: { type: 'boolean', description: 'Loop indefinitely (default: true). Set false for single cycle.' },
        },
        required: ['target'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(ColorLoopSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const target = await findTarget(parsed.data.target);
        const id = runColorLoop({
          target,
          colors: parsed.data.colors,
          transitionMs: parsed.data.transition_ms,
          loop: parsed.data.loop,
        });
        return `Color loop started on ${target.displayName}. Sequence ID: ${id}${parsed.data.loop ? ' (use stop_sequence to end)' : ''}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'strobe_effect',
      description:
        'Rapid disco-style strobe effect on a light or room. Use with caution - can be intense.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Light or room name' },
          color: { type: 'string', description: 'Color name or hex (default: white)' },
          strobe_rate_ms: { type: 'number', description: 'On/off rate in ms (default: 100, min: 50)' },
          duration_ms: { type: 'number', description: 'Total duration in ms (default: 5000)' },
        },
        required: ['target'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(StrobeEffectSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const target = await findTarget(parsed.data.target);
        const id = runStrobe({
          target,
          color: parsed.data.color,
          strobeRateMs: parsed.data.strobe_rate_ms,
          durationMs: parsed.data.duration_ms,
        });
        return `Strobe effect started on ${target.displayName}. Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'alert_effect',
      description:
        'Flash a light with an alert pattern - 3 rapid flashes between alert and normal colors. Good for notifications.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Light or room name' },
          alert_color: { type: 'string', description: 'Alert flash color (default: red)' },
          normal_color: { type: 'string', description: 'Normal/return color (default: white)' },
        },
        required: ['target'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(AlertEffectSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const target = await findTarget(parsed.data.target);
        const id = runAlert({
          target,
          alertColor: parsed.data.alert_color,
          normalColor: parsed.data.normal_color,
        });
        return `Alert effect started on ${target.displayName}. Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'fade_effect',
      description:
        'Smoothly fade a light between brightness levels and/or colors over a duration.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Light or room name' },
          start_brightness: { type: 'number', description: 'Starting brightness 0-100' },
          end_brightness: { type: 'number', description: 'Ending brightness 0-100' },
          start_color: { type: 'string', description: 'Starting color (name or hex)' },
          end_color: { type: 'string', description: 'Ending color (name or hex)' },
          duration_ms: { type: 'number', description: 'Fade duration in ms (default: 3000)' },
          steps: { type: 'number', description: 'Number of interpolation steps (default: 20, max: 100)' },
        },
        required: ['target'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(FadeEffectSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const target = await findTarget(parsed.data.target);
        const id = runFade({
          target,
          startBrightness: parsed.data.start_brightness,
          endBrightness: parsed.data.end_brightness,
          startColor: parsed.data.start_color,
          endColor: parsed.data.end_color,
          durationMs: parsed.data.duration_ms,
          steps: parsed.data.steps,
        });
        return `Fade effect started on ${target.displayName}. Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'list_sequences',
      description:
        'List all currently running effects and sequences with their IDs. Use the IDs with stop_sequence to stop them.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    execute: async (_input: Record<string, unknown>, _config: ToolConfig) => {
      const running = listRunning();
      if (running.length === 0) {
        return 'No effects currently running.';
      }
      const lines = running.map((e) => {
        const elapsed = Math.round((Date.now() - e.startedAt) / 1000);
        return `- ${e.id}: ${e.description} (running ${elapsed}s)`;
      });
      return `Running effects (${running.length}):\n${lines.join('\n')}`;
    },
  },
  {
    spec: {
      name: 'stop_sequence',
      description:
        'Stop a running effect or sequence by its ID. Use "all" to stop all running effects.',
      input_schema: {
        type: 'object',
        properties: {
          sequence_id: {
            type: 'string',
            description: 'Sequence ID from list_sequences, or "all" to stop everything',
          },
        },
        required: ['sequence_id'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(StopSequenceSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      const { sequence_id: id } = parsed.data;

      if (id === 'all') {
        const count = stopAll();
        return count === 0
          ? 'No effects were running.'
          : `Stopped ${count} running effect${count > 1 ? 's' : ''}.`;
      }

      const stopped = stop(id);
      return stopped
        ? `Stopped sequence ${id}.`
        : `No running sequence with ID "${id}". Use list_sequences to see active effects.`;
    },
  },
];
