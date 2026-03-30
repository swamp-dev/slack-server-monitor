/**
 * Claude AI tool definitions for batch commands and custom sequences.
 */

import type { ToolDefinition, ToolConfig } from '../../src/services/tools/types.js';
import {
  validate,
  BatchCommandsSchema,
  CustomSequenceSchema,
} from './validation.js';
import { runSequence, executeBatch } from './sequences.js';
import { saveScene } from './scene-cache.js';

export const controlTools: ToolDefinition[] = [
  {
    spec: {
      name: 'custom_sequence',
      description:
        'Execute a multi-step lighting choreography. Each step has an action, target, optional value, and delay. Supports looping for continuous sequences.',
      input_schema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['on', 'off', 'color', 'brightness', 'scene'], description: 'Action to perform' },
                target: { type: 'string', description: 'Light/room name (or scene name for scene action)' },
                value: { type: 'string', description: 'Color name/hex for color, brightness 0-100 for brightness' },
                delay_ms: { type: 'number', description: 'Delay before this step in ms' },
              },
              required: ['action', 'target'],
            },
            description: 'Array of steps to execute in order',
          },
          loop: { type: 'boolean', description: 'Loop the sequence indefinitely (default: false)' },
          name: { type: 'string', description: 'Optional name for the sequence' },
        },
        required: ['steps'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(CustomSequenceSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;
      try {
        const id = runSequence(parsed.data.steps, {
          loop: parsed.data.loop,
          name: parsed.data.name,
        });
        const loopNote = parsed.data.loop ? ' (looping — use stop_sequence to end)' : '';
        return `Sequence started with ${parsed.data.steps.length} steps${loopNote}. Sequence ID: ${id}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    spec: {
      name: 'batch_commands',
      description:
        'Execute multiple lighting commands with configurable delay between them. In async mode (default), returns immediately. In sync mode, waits and returns results for each command.',
      input_schema: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['on', 'off', 'color', 'brightness', 'scene'] },
                target: { type: 'string', description: 'Light/room name (or scene name for scene action)' },
                value: { type: 'string', description: 'Color or brightness value' },
              },
              required: ['action', 'target'],
            },
            description: 'Commands to execute',
          },
          delay_ms: { type: 'number', description: 'Delay between commands in ms (default: 100)' },
          async: { type: 'boolean', description: 'Fire-and-forget mode (default: true). Set false to wait for results.' },
          cache_name: { type: 'string', description: 'Save this batch as a named custom scene for instant recall later' },
          cache_description: { type: 'string', description: 'Description for the cached scene' },
        },
        required: ['commands'],
      },
    },
    execute: async (input: Record<string, unknown>, _config: ToolConfig) => {
      const parsed = validate(BatchCommandsSchema, input);
      if (!parsed.success) return `Validation error: ${parsed.error}`;

      try {
        if (parsed.data.async) {
          const id = runSequence(parsed.data.commands, {
            name: parsed.data.cache_name ?? 'batch',
            defaultDelayMs: parsed.data.delay_ms,
          });
          // Save to cache after launching (async mode — cache is best-effort)
          if (parsed.data.cache_name) {
            saveScene(parsed.data.cache_name, parsed.data.commands, parsed.data.cache_description ?? '');
          }
          const cached = parsed.data.cache_name ? ` Saved as custom scene "${parsed.data.cache_name}".` : '';
          return `Batch of ${parsed.data.commands.length} commands started.${cached} Sequence ID: ${id}`;
        }

        // Sync mode: execute, then cache only if all succeeded
        const results = await executeBatch(parsed.data.commands, parsed.data.delay_ms);
        const successes = results.filter((r) => r.success).length;
        const failures = results.length - successes;

        if (parsed.data.cache_name && failures === 0) {
          saveScene(parsed.data.cache_name, parsed.data.commands, parsed.data.cache_description ?? '');
        }

        const lines = results.map((r) =>
          `${r.step}. ${r.success ? '✓' : '✗'} ${r.action}: ${r.result}`,
        );
        const cachedNote = parsed.data.cache_name && failures === 0 ? ` Saved as "${parsed.data.cache_name}".` : '';
        return `Batch complete: ${successes} succeeded, ${failures} failed.${cachedNote}\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];
