/**
 * Registry for tracking running effects/sequences.
 */

// =============================================================================
// Types
// =============================================================================

export interface RunningEffect {
  id: string;
  name: string;
  targetId: string;
  abortController: AbortController;
  startedAt: number;
  description: string;
}

// =============================================================================
// Registry
// =============================================================================

const effects = new Map<string, RunningEffect>();
let nextId = 1;

export function createEffectId(name: string): string {
  return `${name}-${nextId++}`;
}

export function register(effect: RunningEffect): void {
  effects.set(effect.id, effect);
}

export function unregister(id: string): void {
  effects.delete(id);
}

export function get(id: string): RunningEffect | undefined {
  return effects.get(id);
}

export function listRunning(): RunningEffect[] {
  return Array.from(effects.values());
}

export function stop(id: string): boolean {
  const effect = effects.get(id);
  if (!effect) return false;
  effect.abortController.abort();
  effects.delete(id);
  return true;
}

export function stopAll(): number {
  let count = 0;
  for (const effect of effects.values()) {
    effect.abortController.abort();
    count++;
  }
  effects.clear();
  return count;
}

/**
 * Reset registry state (for testing).
 */
export function _reset(): void {
  stopAll();
  nextId = 1;
}
