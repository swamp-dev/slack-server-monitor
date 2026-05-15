/**
 * Name matching and target resolution for Hue lights and rooms.
 */

import { getLights, getRooms, getGroupedLights, controlLight, controlGroupedLight } from './client.js';
import type { ResolvedTarget } from './types.js';

// =============================================================================
// Name Matching
// =============================================================================

/**
 * Find an item by name. Tries exact match first, then substring.
 */
export function findByName<T extends { metadata: { name: string }; id: string }>(
  items: T[],
  query: string,
): T | undefined {
  const q = query.toLowerCase();
  const exact = items.find((item) => item.metadata.name.toLowerCase() === q);
  if (exact) return exact;
  return items.find((item) => item.metadata.name.toLowerCase().includes(q));
}

/**
 * Join item names into a comma-separated string.
 */
export function listNames<T extends { metadata: { name: string } }>(items: T[]): string {
  return items.map((item) => item.metadata.name).join(', ');
}

// =============================================================================
// Target Resolution
// =============================================================================

/**
 * Find a controllable target by name.
 * Priority: exact light → exact room → substring light → substring room.
 * Throws if no match found.
 */
export async function findTarget(name: string): Promise<ResolvedTarget> {
  const q = name.toLowerCase();
  const [lights, rooms, groupedLights] = await Promise.all([
    getLights(),
    getRooms(),
    getGroupedLights(),
  ]);

  // 1. Exact light match
  const exactLight = lights.find((l) => l.metadata.name.toLowerCase() === q);
  if (exactLight) {
    return { id: exactLight.id, type: 'light', displayName: exactLight.metadata.name };
  }

  // 2. Exact room match
  const exactRoom = rooms.find((r) => r.metadata.name.toLowerCase() === q);
  if (exactRoom) {
    const gl = groupedLights.find(
      (g) => g.owner.rid === exactRoom.id && g.owner.rtype === 'room',
    );
    if (gl) {
      return { id: gl.id, type: 'grouped_light', displayName: exactRoom.metadata.name };
    }
  }

  // 3. Substring light match
  const subLight = lights.find((l) => l.metadata.name.toLowerCase().includes(q));
  if (subLight) {
    return { id: subLight.id, type: 'light', displayName: subLight.metadata.name };
  }

  // 4. Substring room match
  const subRoom = rooms.find((r) => r.metadata.name.toLowerCase().includes(q));
  if (subRoom) {
    const gl = groupedLights.find(
      (g) => g.owner.rid === subRoom.id && g.owner.rtype === 'room',
    );
    if (gl) {
      return { id: gl.id, type: 'grouped_light', displayName: subRoom.metadata.name };
    }
  }

  const allNames = [
    ...lights.map((l) => l.metadata.name),
    ...rooms.map((r) => r.metadata.name),
  ];
  throw new Error(`No light or room matching "${name}". Available: ${allNames.join(', ')}`);
}

/**
 * Send a control command to a resolved target.
 */
export async function controlTarget(
  target: ResolvedTarget,
  body: Record<string, unknown>,
): Promise<void> {
  if (target.type === 'light') {
    await controlLight(target.id, body);
  } else {
    await controlGroupedLight(target.id, body);
  }
}
