/**
 * Custom multi-step sequence parser and executor.
 *
 * Sequences are JSON arrays of steps, each with an action, target, optional value, and delay.
 * They execute through the same AbortController pattern as effects.
 */

import { findTarget, controlTarget } from './matching.js';
import { resolveColor } from './colors.js';
import { activateScene, getScenes } from './client.js';
import { findByName } from './matching.js';
import { createEffectId, register, unregister } from './effects-registry.js';
import { abortableSleep } from './effects.js';
import { logger } from '../../src/utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface SequenceStep {
  action: 'on' | 'off' | 'color' | 'brightness' | 'scene';
  target: string;
  value?: string;
  delay_ms?: number;
}

// =============================================================================
// Step Execution
// =============================================================================

async function executeStep(step: SequenceStep): Promise<string> {
  switch (step.action) {
    case 'on': {
      const target = await findTarget(step.target);
      await controlTarget(target, { on: { on: true } });
      return `Turned on ${target.displayName}`;
    }
    case 'off': {
      const target = await findTarget(step.target);
      await controlTarget(target, { on: { on: false } });
      return `Turned off ${target.displayName}`;
    }
    case 'color': {
      if (!step.value) return 'Error: color value required';
      const xy = resolveColor(step.value);
      if (!xy) return `Error: unknown color "${step.value}"`;
      const target = await findTarget(step.target);
      await controlTarget(target, { on: { on: true }, color: { xy } });
      return `Set ${target.displayName} to ${step.value}`;
    }
    case 'brightness': {
      if (!step.value) return 'Error: brightness value required';
      const brightness = Number(step.value);
      if (isNaN(brightness) || brightness < 0 || brightness > 100) {
        return 'Error: brightness must be 0-100';
      }
      const target = await findTarget(step.target);
      await controlTarget(target, {
        on: { on: brightness > 0 },
        dimming: { brightness },
      });
      return `Set ${target.displayName} to ${brightness}%`;
    }
    case 'scene': {
      const scenes = await getScenes();
      const scene = findByName(scenes, step.target);
      if (!scene) return `Error: no scene matching "${step.target}"`;
      await activateScene(scene.id);
      return `Activated scene: ${scene.metadata.name}`;
    }
    default:
      return `Unknown action: ${step.action}`;
  }
}

export { executeStep };

// =============================================================================
// Sequence Runner
// =============================================================================

export interface SequenceResult {
  step: number;
  action: string;
  result: string;
  success: boolean;
}

export function runSequence(
  steps: SequenceStep[],
  options: { loop?: boolean; name?: string; defaultDelayMs?: number } = {},
): string {
  const { loop = false, name = 'custom', defaultDelayMs = 100 } = options;
  const id = createEffectId('sequence');
  const abortController = new AbortController();
  const description = name ? `Sequence "${name}" (${steps.length} steps)` : `Custom sequence (${steps.length} steps)`;

  const uniqueTargets = new Set(steps.map((s) => s.target));
  const targetId = uniqueTargets.size === 1 ? steps[0].target : `multi(${uniqueTargets.size})`;

  register({
    id,
    name: 'sequence',
    targetId,
    abortController,
    startedAt: Date.now(),
    description,
  });

  (async () => {
    try {
      do {
        for (const step of steps) {
          if (abortController.signal.aborted) return;

          const delay = step.delay_ms ?? defaultDelayMs;
          if (delay > 0) {
            await abortableSleep(delay, abortController.signal);
          }
          if (abortController.signal.aborted) return;

          try {
            await executeStep(step);
          } catch (err) {
            logger.error('Sequence step error', {
              id,
              step: step.action,
              target: step.target,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } while (loop && !abortController.signal.aborted);
    } finally {
      unregister(id);
    }
  })();

  return id;
}

// =============================================================================
// Batch Execution (sync mode)
// =============================================================================

export async function executeBatch(
  steps: SequenceStep[],
  delayMs: number = 100,
): Promise<SequenceResult[]> {
  const results: SequenceResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (i > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const result = await executeStep(step);
      const isError = result.startsWith('Error:');
      results.push({
        step: i + 1,
        action: `${step.action} ${step.target}`,
        result,
        success: !isError,
      });
    } catch (err) {
      results.push({
        step: i + 1,
        action: `${step.action} ${step.target}`,
        result: err instanceof Error ? err.message : String(err),
        success: false,
      });
    }
  }

  return results;
}
