import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => ({
  getLights: vi.fn().mockResolvedValue([]),
  getLight: vi.fn().mockResolvedValue({}),
  getRooms: vi.fn().mockResolvedValue([]),
  getGroupedLights: vi.fn().mockResolvedValue([]),
  getGroupedLight: vi.fn().mockResolvedValue({}),
  getScenes: vi.fn().mockResolvedValue([]),
  controlLight: vi.fn().mockResolvedValue(undefined),
  controlGroupedLight: vi.fn().mockResolvedValue(undefined),
  activateScene: vi.fn().mockResolvedValue(undefined),
  getMotionSensors: vi.fn().mockResolvedValue([]),
  getTemperatureSensors: vi.fn().mockResolvedValue([]),
  getLightLevelSensors: vi.fn().mockResolvedValue([]),
  getDevices: vi.fn().mockResolvedValue([]),
}));

vi.mock('./effects-registry.js', () => ({
  listRunning: vi.fn().mockReturnValue([]),
  stop: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getMotionSensors,
  getTemperatureSensors,
  getLightLevelSensors,
  getDevices,
} from './client.js';
import { CSS, buildRoomStates, renderRoomCard, renderSceneCards, renderSensors } from './web.js';
import type { HueLight, HueRoom, HueGroupedLight, HueScene } from './types.js';

// =============================================================================
// #251: CSS variable correctness
// =============================================================================

describe('CSS theme variables', () => {
  const WRONG_VARS = [
    '--text-primary',
    '--text-secondary',
    '--text-inverse',
    '--bg-primary',
    '--bg-tertiary',
  ];

  const CORRECT_VARS = [
    '--text)',
    '--text-muted',
    '--card-bg',
    '--bg)',
    '--surface',
  ];

  for (const wrongVar of WRONG_VARS) {
    it(`should not reference non-existent variable ${wrongVar}`, () => {
      expect(CSS).not.toContain(`var(${wrongVar})`);
    });
  }

  for (const correctVar of CORRECT_VARS) {
    it(`should use shell theme variable ${correctVar}`, () => {
      expect(CSS).toContain(correctVar);
    });
  }

  it('should use --card-bg for card backgrounds instead of --bg-secondary', () => {
    expect(CSS).not.toContain('var(--bg-secondary)');
    expect(CSS).toContain('var(--card-bg)');
  });
});

// =============================================================================
// #254: Light dots on room cards
// =============================================================================

describe('renderRoomCard', () => {
  it('should render a dot for each light in the room', () => {
    const room = {
      id: 'room-1',
      name: 'Living Room',
      groupedLightId: 'gl-1',
      on: true,
      brightness: 80,
      lightsOn: 2,
      lightsTotal: 3,
      scenes: [],
      lights: [
        { id: 'l1', on: true },
        { id: 'l2', on: true },
        { id: 'l3', on: false },
      ],
    };

    const html = renderRoomCard(room);
    const dotMatches = html.match(/hue-light-dot (on|off)/g) ?? [];
    expect(dotMatches.length).toBe(3);
  });

  it('should differentiate on and off light dots', () => {
    const room = {
      id: 'room-1',
      name: 'Office',
      groupedLightId: 'gl-1',
      on: true,
      brightness: 50,
      lightsOn: 1,
      lightsTotal: 2,
      scenes: [],
      lights: [
        { id: 'l1', on: true },
        { id: 'l2', on: false },
      ],
    };

    const html = renderRoomCard(room);
    expect(html).toContain('hue-light-dot on');
    expect(html).toContain('hue-light-dot off');
  });
});

describe('buildRoomStates', () => {
  it('should include lights array with on/off state', () => {
    const lights: HueLight[] = [
      { id: 'l1', metadata: { name: 'Desk', archetype: 'table_shade' }, on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'dev-1', rtype: 'device' } },
      { id: 'l2', metadata: { name: 'Floor', archetype: 'floor_shade' }, on: { on: false }, owner: { rid: 'dev-2', rtype: 'device' } },
    ];
    const rooms: HueRoom[] = [
      { id: 'room-1', metadata: { name: 'Office' }, children: [{ rid: 'dev-1', rtype: 'device' }, { rid: 'dev-2', rtype: 'device' }], services: [] },
    ];
    const groupedLights: HueGroupedLight[] = [
      { id: 'gl-1', on: { on: true }, dimming: { brightness: 80 }, owner: { rid: 'room-1', rtype: 'room' } },
    ];

    const states = buildRoomStates(lights, rooms, groupedLights);
    expect(states).toHaveLength(1);
    expect(states[0].lights).toHaveLength(2);
    expect(states[0].lights[0]).toEqual({ id: 'l1', on: true });
    expect(states[0].lights[1]).toEqual({ id: 'l2', on: false });
  });
});

// =============================================================================
// #252: Scenes grouped by room (from PR #260)
// =============================================================================

const ROOM_LIVING = 'room-living';
const ROOM_BEDROOM = 'room-bedroom';

const sceneFixtures: HueScene[] = [
  { id: 'scene-1', metadata: { name: 'Movie Night' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-2', metadata: { name: 'Bright' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
  { id: 'scene-3', metadata: { name: 'Nightlight' }, group: { rid: ROOM_BEDROOM, rtype: 'room' } },
];

const roomFixtures: HueRoom[] = [
  { id: ROOM_LIVING, metadata: { name: 'Living Room' }, children: [{ rid: 'dev-1', rtype: 'device' }, { rid: 'dev-2', rtype: 'device' }], services: [{ rid: 'gl-1', rtype: 'grouped_light' }] },
  { id: ROOM_BEDROOM, metadata: { name: 'Bedroom' }, children: [{ rid: 'dev-3', rtype: 'device' }], services: [{ rid: 'gl-2', rtype: 'grouped_light' }] },
];

describe('renderSceneCards', () => {
  it('should group scenes by room with section headers', () => {
    const html = renderSceneCards(sceneFixtures, roomFixtures);
    expect(html).toContain('Living Room');
    expect(html).toContain('Bedroom');
    expect(html).toContain('hue-scene-group');
  });

  it('should show device count per room', () => {
    const html = renderSceneCards(sceneFixtures, roomFixtures);
    expect(html).toContain('2 devices');
    expect(html).toContain('1 device');
  });

  it('should render scene names and activate buttons', () => {
    const html = renderSceneCards(sceneFixtures, roomFixtures);
    expect(html).toContain('Movie Night');
    expect(html).toContain('Bright');
    expect(html).toContain('Nightlight');
    expect(html).toContain('hue-activate-btn');
  });

  it('should escape HTML in scene names', () => {
    const xssScenes: HueScene[] = [
      { id: 's1', metadata: { name: '<script>alert("xss")</script>' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
    ];
    const html = renderSceneCards(xssScenes, roomFixtures);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape HTML in scene IDs to prevent injection via onclick', () => {
    const xssScenes: HueScene[] = [
      { id: "');alert(1)//", metadata: { name: 'Evil' }, group: { rid: ROOM_LIVING, rtype: 'room' } },
    ];
    const html = renderSceneCards(xssScenes, roomFixtures);
    expect(html).not.toContain("');alert(1)//");
    expect(html).toContain('&#039;');
  });

  it('should return empty message when no scenes', () => {
    const html = renderSceneCards([], roomFixtures);
    expect(html).toContain('No scenes');
  });

  it('should handle scenes with unknown room', () => {
    const orphanScenes: HueScene[] = [
      { id: 's1', metadata: { name: 'Orphan' }, group: { rid: 'unknown-room', rtype: 'room' } },
    ];
    const html = renderSceneCards(orphanScenes, roomFixtures);
    expect(html).toContain('Orphan');
    expect(html).toContain('Other');
  });
});

// =============================================================================
// #253: Sensors grouped by type with icons
// =============================================================================

describe('renderSensors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render type-grouped sections with headers', async () => {
    vi.mocked(getMotionSensors).mockResolvedValue([
      { id: 'm1', motion: { motion: true }, owner: { rid: 'dev-1', rtype: 'device' } },
    ] as never[]);
    vi.mocked(getTemperatureSensors).mockResolvedValue([
      { id: 't1', temperature: { temperature: 22.5 }, owner: { rid: 'dev-1', rtype: 'device' } },
    ] as never[]);
    vi.mocked(getLightLevelSensors).mockResolvedValue([
      { id: 'x1', light: { light_level: 25000 }, owner: { rid: 'dev-1', rtype: 'device' } },
    ] as never[]);
    vi.mocked(getDevices).mockResolvedValue([
      { id: 'dev-1', metadata: { name: 'Hallway Sensor' } },
    ] as never[]);

    const html = await renderSensors();

    const headers = html.match(/hue-section-header/g) ?? [];
    expect(headers.length).toBe(3);
    expect(html).toContain('Motion');
    expect(html).toContain('Temperature');
    expect(html).toContain('Light Level');
  });

  it('should include SVG icons in section headers', async () => {
    vi.mocked(getMotionSensors).mockResolvedValue([
      { id: 'm1', motion: { motion: false }, owner: { rid: 'dev-1', rtype: 'device' } },
    ] as never[]);
    vi.mocked(getTemperatureSensors).mockResolvedValue([]);
    vi.mocked(getLightLevelSensors).mockResolvedValue([]);
    vi.mocked(getDevices).mockResolvedValue([
      { id: 'dev-1', metadata: { name: 'Sensor' } },
    ] as never[]);

    const html = await renderSensors();
    expect(html).toContain('<svg');
  });
});

// =============================================================================
// #255: Mobile responsive layout
// =============================================================================

describe('mobile responsive CSS', () => {
  it('should include a 640px breakpoint media query', () => {
    expect(CSS).toContain('@media (max-width: 640px)');
  });

  it('should collapse grids to single column on mobile', () => {
    const mediaMatch = CSS.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*)\}\s*$/);
    expect(mediaMatch).not.toBeNull();
    const mediaBlock = mediaMatch![1];
    expect(mediaBlock).toContain('grid-template-columns: 1fr');
  });

  it('should manually scope @media selectors with .plugin-hue prefix', () => {
    const mediaMatch = CSS.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*)\}\s*$/);
    expect(mediaMatch).not.toBeNull();
    const mediaBlock = mediaMatch![1];
    const selectorLines = mediaBlock.match(/^[ \t]+\..+\{/gm) ?? [];
    expect(selectorLines.length).toBeGreaterThan(0);
    for (const line of selectorLines) {
      expect(line).toContain('.plugin-hue');
    }
  });
});
