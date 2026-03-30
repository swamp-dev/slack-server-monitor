/**
 * Effect scheduler: flash, pulse, color_loop, strobe, alert, fade.
 *
 * Each effect runs as an async function using AbortController for cancellation.
 * Effects capture light state before starting and restore on completion/abort.
 */

import { getLight, getGroupedLight, controlLight, controlGroupedLight } from './client.js';
import { resolveColor, RAINBOW_COLORS } from './colors.js';
import { createEffectId, register, unregister } from './effects-registry.js';
import type { ResolvedTarget } from './types.js';
import { logger } from '../../src/utils/logger.js';

// =============================================================================
// Abortable Sleep
// =============================================================================

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// =============================================================================
// Target Control Helper
// =============================================================================

async function control(target: ResolvedTarget, body: Record<string, unknown>): Promise<void> {
  if (target.type === 'light') {
    await controlLight(target.id, body);
  } else {
    await controlGroupedLight(target.id, body);
  }
}

// =============================================================================
// State Capture/Restore
// =============================================================================

interface CapturedState {
  on: boolean;
  brightness?: number;
  color?: { x: number; y: number };
}

async function captureState(target: ResolvedTarget): Promise<CapturedState | null> {
  try {
    if (target.type === 'light') {
      const light = await getLight(target.id);
      return {
        on: light.on.on,
        brightness: light.dimming?.brightness,
        color: light.color?.xy,
      };
    }
    // Grouped light: has on + dimming but no color
    const gl = await getGroupedLight(target.id);
    return {
      on: gl.on.on,
      brightness: gl.dimming?.brightness,
    };
  } catch {
    return null;
  }
}

async function restoreState(target: ResolvedTarget, state: CapturedState | null): Promise<void> {
  if (!state) return;
  try {
    const body: Record<string, unknown> = { on: { on: state.on } };
    if (state.brightness !== undefined) body.dimming = { brightness: state.brightness };
    if (state.color) body.color = { xy: state.color };
    await control(target, body);
  } catch {
    // Best effort restore
  }
}

// =============================================================================
// Effect Runner
// =============================================================================

type EffectFn = (target: ResolvedTarget, signal: AbortSignal) => Promise<void>;

function runEffect(
  name: string,
  target: ResolvedTarget,
  description: string,
  fn: EffectFn,
  shouldRestore: boolean = true,
): string {
  const id = createEffectId(name);
  const abortController = new AbortController();

  register({
    id,
    name,
    targetId: target.id,
    abortController,
    startedAt: Date.now(),
    description,
  });

  // Fire-and-forget the async execution
  (async () => {
    let savedState: CapturedState | null = null;
    try {
      if (shouldRestore) {
        savedState = await captureState(target);
      }
      await fn(target, abortController.signal);
    } catch (err) {
      if (!abortController.signal.aborted) {
        logger.error('Effect error', { id, name, error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (shouldRestore) {
        await restoreState(target, savedState);
      }
      unregister(id);
    }
  })();

  return id;
}

// =============================================================================
// Flash Effect
// =============================================================================

export interface FlashParams {
  target: ResolvedTarget;
  color?: string;
  flashCount?: number;
  flashDurationMs?: number;
}

export function runFlash(params: FlashParams): string {
  const { target, color = '#FFFFFF', flashCount = 3, flashDurationMs = 200 } = params;
  const xy = resolveColor(color);

  return runEffect('flash', target, `Flash ${target.displayName} ${flashCount}x`, async (t, signal) => {
    for (let i = 0; i < flashCount; i++) {
      if (signal.aborted) return;
      const body: Record<string, unknown> = { on: { on: true } };
      if (xy) body.color = { xy };
      await control(t, body);
      await abortableSleep(flashDurationMs, signal);

      if (signal.aborted) return;
      await control(t, { on: { on: false } });
      await abortableSleep(flashDurationMs, signal);
    }
  });
}

// =============================================================================
// Pulse Effect
// =============================================================================

export interface PulseParams {
  target: ResolvedTarget;
  minBrightness?: number;
  maxBrightness?: number;
  pulseCount?: number;
  pulseDurationMs?: number;
}

export function runPulse(params: PulseParams): string {
  const {
    target,
    minBrightness = 10,
    maxBrightness = 100,
    pulseCount = 5,
    pulseDurationMs = 2000,
  } = params;
  const steps = 10;
  const stepDelay = Math.floor(pulseDurationMs / (steps * 2));

  return runEffect('pulse', target, `Pulse ${target.displayName} ${pulseCount}x`, async (t, signal) => {
    await control(t, { on: { on: true } });

    for (let pulse = 0; pulse < pulseCount; pulse++) {
      // Fade up
      for (let step = 0; step <= steps; step++) {
        if (signal.aborted) return;
        const brightness = minBrightness + (maxBrightness - minBrightness) * (step / steps);
        await control(t, { dimming: { brightness: Math.round(brightness) } });
        await abortableSleep(stepDelay, signal);
      }
      // Fade down
      for (let step = steps; step >= 0; step--) {
        if (signal.aborted) return;
        const brightness = minBrightness + (maxBrightness - minBrightness) * (step / steps);
        await control(t, { dimming: { brightness: Math.round(brightness) } });
        await abortableSleep(stepDelay, signal);
      }
    }
  });
}

// =============================================================================
// Color Loop Effect
// =============================================================================

export interface ColorLoopParams {
  target: ResolvedTarget;
  colors?: string[];
  transitionMs?: number;
  loop?: boolean;
}

export function runColorLoop(params: ColorLoopParams): string {
  const {
    target,
    colors = RAINBOW_COLORS,
    transitionMs = 1000,
    loop = true,
  } = params;

  const xyColors = colors
    .map((c) => resolveColor(c))
    .filter((xy): xy is { x: number; y: number } => xy !== null);

  if (xyColors.length < 2) {
    throw new Error('Color loop requires at least 2 valid colors');
  }

  return runEffect('color_loop', target, `Color loop ${target.displayName}`, async (t, signal) => {
    await control(t, { on: { on: true } });

    do {
      for (const xy of xyColors) {
        if (signal.aborted) return;
        await control(t, { color: { xy } });
        await abortableSleep(transitionMs, signal);
      }
    } while (loop && !signal.aborted);
  });
}

// =============================================================================
// Strobe Effect
// =============================================================================

export interface StrobeParams {
  target: ResolvedTarget;
  color?: string;
  strobeRateMs?: number;
  durationMs?: number;
}

export function runStrobe(params: StrobeParams): string {
  const { target, color = '#FFFFFF', strobeRateMs = 100, durationMs = 5000 } = params;
  const xy = resolveColor(color);
  const iterations = Math.floor(durationMs / strobeRateMs);

  return runEffect('strobe', target, `Strobe ${target.displayName} ${durationMs}ms`, async (t, signal) => {
    for (let i = 0; i < iterations; i++) {
      if (signal.aborted) return;
      const on = i % 2 === 0;
      const body: Record<string, unknown> = { on: { on } };
      if (on && xy) body.color = { xy };
      await control(t, body);
      await abortableSleep(strobeRateMs, signal);
    }
  });
}

// =============================================================================
// Alert Effect
// =============================================================================

export interface AlertParams {
  target: ResolvedTarget;
  alertColor?: string;
  normalColor?: string;
}

export function runAlert(params: AlertParams): string {
  const { target, alertColor = '#FF0000', normalColor = '#FFFFFF' } = params;
  const alertXY = resolveColor(alertColor);
  const normalXY = resolveColor(normalColor);

  return runEffect('alert', target, `Alert ${target.displayName}`, async (t, signal) => {
    // 3 quick flashes between alert and normal color
    for (let i = 0; i < 3; i++) {
      if (signal.aborted) return;
      await control(t, { on: { on: true }, ...(alertXY ? { color: { xy: alertXY } } : {}) });
      await abortableSleep(100, signal);

      if (signal.aborted) return;
      await control(t, { on: { on: true }, ...(normalXY ? { color: { xy: normalXY } } : {}) });
      await abortableSleep(100, signal);
    }
  });
}

// =============================================================================
// Fade Effect
// =============================================================================

export interface FadeParams {
  target: ResolvedTarget;
  startBrightness?: number;
  endBrightness?: number;
  startColor?: string;
  endColor?: string;
  durationMs?: number;
  steps?: number;
}

export function runFade(params: FadeParams): string {
  const {
    target,
    startBrightness,
    endBrightness,
    startColor,
    endColor,
    durationMs = 3000,
    steps = 20,
  } = params;

  const startXY = startColor ? resolveColor(startColor) : null;
  const endXY = endColor ? resolveColor(endColor) : null;
  const stepDelay = Math.floor(durationMs / steps);

  return runEffect('fade', target, `Fade ${target.displayName} ${durationMs}ms`, async (t, signal) => {
    await control(t, { on: { on: true } });

    for (let i = 0; i <= steps; i++) {
      if (signal.aborted) return;
      const progress = i / steps;
      const body: Record<string, unknown> = {};

      if (startBrightness !== undefined && endBrightness !== undefined) {
        const brightness = Math.round(startBrightness + (endBrightness - startBrightness) * progress);
        body.dimming = { brightness };
      }

      if (startXY && endXY) {
        body.color = {
          xy: {
            x: Math.round((startXY.x + (endXY.x - startXY.x) * progress) * 10000) / 10000,
            y: Math.round((startXY.y + (endXY.y - startXY.y) * progress) * 10000) / 10000,
          },
        };
      }

      if (Object.keys(body).length > 0) {
        await control(t, body);
      }
      await abortableSleep(stepDelay, signal);
    }
  }, false); // Don't restore state after fade
}
