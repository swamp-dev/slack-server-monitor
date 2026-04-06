import { describe, it, expect } from 'vitest';
import { renderSceneCards } from './web.js';
import type { HueScene, HueRoom } from './types.js';

const ROOM_LIVING = 'room-living';
const ROOM_BEDROOM = 'room-bedroom';

const scenes: HueScene[] = [
  { id: 'scene-1', metadata: { name: 'Movie Night' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-2', metadata: { name: 'Bright' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-3', metadata: { name: 'Nightlight' }, group: { rid: ROOM_BEDROOM, rtype: 'room' } },
];

const rooms: HueRoom[] = [
  { id: ROOM_LIVING, metadata: { name: 'Living Room' }, children: [{ rid: 'dev-1', rtype: 'device' }, { rid: 'dev-2', rtype: 'device' }], services: [{ rid: 'gl-1', rtype: 'grouped_light' }] },
  { id: ROOM_BEDROOM, metadata: { name: 'Bedroom' }, children: [{ rid: 'dev-3', rtype: 'device' }], services: [{ rid: 'gl-2', rtype: 'grouped_light' }] },
];

describe('renderSceneCards', () => {
  it('should group scenes by room with section headers', () => {
    const html = renderSceneCards(scenes, rooms);

    // Should have room group headers
    expect(html).toContain('Living Room');
    expect(html).toContain('Bedroom');
    expect(html).toContain('hue-scene-group');
  });

  it('should show light count per room', () => {
    const html = renderSceneCards(scenes, rooms);

    // Living Room has 2 device children, Bedroom has 1
    expect(html).toContain('2 devices');
    expect(html).toContain('1 device');
  });

  it('should render scene names and activate buttons', () => {
    const html = renderSceneCards(scenes, rooms);

    expect(html).toContain('Movie Night');
    expect(html).toContain('Bright');
    expect(html).toContain('Nightlight');
    expect(html).toContain('hue-activate-btn');
    expect(html).toContain('hueActivateScene');
  });

  it('should escape HTML in scene names', () => {
    const xssScenes: HueScene[] = [
      { id: 's1', metadata: { name: '<script>alert("xss")</script>' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
    ];
    const html = renderSceneCards(xssScenes, rooms);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape HTML in scene IDs to prevent injection via onclick', () => {
    const xssScenes: HueScene[] = [
      { id: "');alert(1)//", metadata: { name: 'Evil' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
    ];
    const html = renderSceneCards(xssScenes, rooms);

    // Single quote in ID must be escaped in the onclick attribute
    expect(html).not.toContain("');alert(1)//");
    expect(html).toContain('&#039;');
  });

  it('should return empty message when no scenes', () => {
    const html = renderSceneCards([], rooms);

    expect(html).toContain('No scenes');
  });

  it('should handle scenes with unknown room', () => {
    const orphanScenes: HueScene[] = [
      { id: 's1', metadata: { name: 'Orphan' }, group: { rid: 'unknown-room', rtype: 'room' } },
    ];
    const html = renderSceneCards(orphanScenes, rooms);

    expect(html).toContain('Orphan');
    expect(html).toContain('Other');
  });
});
