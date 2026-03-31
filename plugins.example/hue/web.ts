/**
 * Hue Plugin — Web Dashboard
 *
 * Pages:
 * - /p/hue/         Dashboard home (room cards, all-lights toggle, active effects)
 * - /p/hue/scenes   Scene browser with activate buttons
 * - /p/hue/sensors  Sensor readings (motion, temperature, light level)
 *
 * API Endpoints (POST):
 * - /p/hue/lights/:id/toggle       Toggle light on/off
 * - /p/hue/lights/:id/brightness   Set brightness { brightness: 0-100 }
 * - /p/hue/rooms/:id/toggle        Toggle room on/off
 * - /p/hue/rooms/:id/brightness    Set room brightness
 * - /p/hue/scenes/:id/activate     Activate scene
 * - /p/hue/all/toggle              Toggle all lights
 *
 * SSE Events:
 * - light-state    Pushed every 10s with current light/room state
 * - sensor-update  Pushed every 10s with sensor readings
 */

import type { PluginRouter } from '../../src/plugins/index.js';
import type { DashboardWidget } from '../../src/plugins/types.js';
import type { PluginContext } from '../../src/plugins/types.js';
import { renderPluginPage, pluginCard, escapeHtml } from '../../src/plugins/index.js';
import {
  getLights,
  getLight,
  getRooms,
  getGroupedLights,
  getGroupedLight,
  getScenes,
  controlLight,
  controlGroupedLight,
  activateScene,
  getMotionSensors,
  getTemperatureSensors,
  getLightLevelSensors,
  getDevices,
} from './client.js';
import { listRunning, stop as stopEffect } from './effects-registry.js';
import type {
  HueLight,
  HueRoom,
  HueGroupedLight,
  HueScene,
} from './types.js';
import { HueNotConfiguredError } from './types.js';
import { logger } from '../../src/utils/logger.js';

const HUE_ID_RE = /^[0-9a-f-]{36}$/;

// =============================================================================
// SSE Polling
// =============================================================================

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startSSEPolling(ctx: PluginContext): void {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    if (ctx.sse.clientCount() === 0) return;

    try {
      const [lights, rooms, groupedLights] = await Promise.all([
        getLights(),
        getRooms(),
        getGroupedLights(),
      ]);

      const roomStates = buildRoomStates(lights, rooms, groupedLights);
      const totalOn = lights.filter((l) => l.on.on).length;
      const totalLights = lights.length;

      updateWidgetCache(totalOn, totalLights, roomStates);

      ctx.sse.broadcast('light-state', {
        rooms: roomStates,
        totalOn,
        totalLights,
      });
    } catch (err) {
      if (err instanceof HueNotConfiguredError || (err instanceof Error && err.message.includes('ECONNREFUSED'))) {
        logger.debug('Hue bridge unreachable during poll', { error: err instanceof Error ? err.message : String(err) });
      } else {
        logger.warn('Unexpected error in Hue SSE poll', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      const [motion, temp, lightLevel] = await Promise.all([
        getMotionSensors(),
        getTemperatureSensors(),
        getLightLevelSensors(),
      ]);

      ctx.sse.broadcast('sensor-update', {
        motion: motion.map((s) => ({
          id: s.id,
          motion: s.motion.motion,
          valid: s.motion.motion_valid,
          enabled: s.enabled,
        })),
        temperature: temp.map((s) => ({
          id: s.id,
          temperature: s.temperature.temperature,
          valid: s.temperature.temperature_valid,
          enabled: s.enabled,
        })),
        lightLevel: lightLevel.map((s) => ({
          id: s.id,
          level: s.light.light_level,
          valid: s.light.light_level_valid,
          enabled: s.enabled,
        })),
      });
    } catch (err) {
      if (err instanceof HueNotConfiguredError || (err instanceof Error && err.message.includes('ECONNREFUSED'))) {
        logger.debug('Hue bridge unreachable during sensor poll', { error: err instanceof Error ? err.message : String(err) });
      } else {
        logger.warn('Unexpected error in Hue sensor SSE poll', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }, 10_000);
}

export function stopSSEPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// =============================================================================
// Data Helpers
// =============================================================================

interface RoomState {
  id: string;
  name: string;
  groupedLightId: string | null;
  on: boolean;
  brightness: number;
  lightsOn: number;
  lightsTotal: number;
  scenes: Array<{ id: string; name: string }>;
}

function buildRoomStates(
  lights: HueLight[],
  rooms: HueRoom[],
  groupedLights: HueGroupedLight[],
  scenes?: HueScene[],
): RoomState[] {
  return rooms.map((room) => {
    const childDeviceIds = new Set(room.children.map((c) => c.rid));
    const roomLights = lights.filter((l) => childDeviceIds.has(l.owner.rid));
    const gl = groupedLights.find(
      (g) => g.owner.rid === room.id && g.owner.rtype === 'room',
    );
    const roomScenes = scenes
      ? scenes.filter((s) => s.group.rid === room.id).slice(0, 5)
      : [];

    return {
      id: room.id,
      name: room.metadata.name,
      groupedLightId: gl?.id ?? null,
      on: gl?.on?.on ?? roomLights.some((l) => l.on.on),
      brightness: gl?.dimming?.brightness ?? 0,
      lightsOn: roomLights.filter((l) => l.on.on).length,
      lightsTotal: roomLights.length,
      scenes: roomScenes.map((s) => ({ id: s.id, name: s.metadata.name })),
    };
  });
}

// =============================================================================
// Navigation
// =============================================================================

function navPills(active: string): string {
  const pages = [
    { href: '/p/hue/', label: 'Dashboard', id: 'dashboard' },
    { href: '/p/hue/scenes', label: 'Scenes', id: 'scenes' },
    { href: '/p/hue/sensors', label: 'Sensors', id: 'sensors' },
  ];
  return `<nav class="hue-nav">${pages.map(
    (p) => `<a href="${p.href}" class="hue-pill${active === p.id ? ' active' : ''}">${escapeHtml(p.label)}</a>`,
  ).join('')}</nav>`;
}

// =============================================================================
// CSS
// =============================================================================

const CSS = `
  .hue-nav {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  .hue-pill {
    padding: 0.4rem 1rem;
    border-radius: 20px;
    text-decoration: none;
    font-size: 0.9rem;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    transition: all 0.2s;
  }
  .hue-pill:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
  .hue-pill.active {
    color: var(--text-inverse);
    background: var(--accent);
  }

  .hue-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .hue-room-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    transition: border-color 0.2s;
  }
  .hue-room-card.room-on {
    border-color: var(--accent);
  }
  .hue-room-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .hue-room-name {
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--text-primary);
  }
  .hue-light-count {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .hue-toggle {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--bg-tertiary);
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
    padding: 0;
  }
  .hue-toggle.on {
    background: var(--accent);
  }
  .hue-toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }
  .hue-toggle.on::after {
    transform: translateX(20px);
  }

  .hue-brightness {
    width: 100%;
    margin: 0.5rem 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .hue-brightness-label {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-align: right;
    display: block;
  }

  .hue-scenes-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .hue-scene-btn {
    padding: 0.25rem 0.6rem;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .hue-scene-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .hue-master-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 1.5rem;
  }
  .hue-master-label {
    font-weight: 600;
    color: var(--text-primary);
  }
  .hue-master-count {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin-left: auto;
  }

  .hue-effects {
    margin-top: 1rem;
  }
  .hue-effect-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }
  .hue-effect-name {
    font-weight: 500;
    color: var(--text-primary);
  }
  .hue-effect-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .hue-stop-btn {
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    border: 1px solid var(--danger, #e74c3c);
    background: transparent;
    color: var(--danger, #e74c3c);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .hue-stop-btn:hover {
    background: var(--danger, #e74c3c);
    color: white;
  }

  .hue-scene-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1rem;
  }
  .hue-scene-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }
  .hue-scene-card-name {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }
  .hue-scene-card-room {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }
  .hue-activate-btn {
    padding: 0.35rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .hue-activate-btn:hover {
    background: var(--accent);
    color: var(--text-inverse);
  }

  .hue-sensor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
  .hue-sensor-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }
  .hue-sensor-type {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }
  .hue-sensor-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .hue-sensor-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }
  .hue-sensor-status {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.4rem;
  }
  .hue-sensor-status.active { background: var(--success, #2ecc71); }
  .hue-sensor-status.inactive { background: var(--text-secondary); }

  .hue-not-configured {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-secondary);
  }
  .hue-not-configured h2 {
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .hue-empty {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
  }

  .hue-flash {
    animation: hue-flash-anim 0.3s ease;
  }
  @keyframes hue-flash-anim {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
  }
`;

// =============================================================================
// Page: Dashboard Home
// =============================================================================

async function renderDashboard(): Promise<string> {
  const [lights, rooms, groupedLights, scenes] = await Promise.all([
    getLights(),
    getRooms(),
    getGroupedLights(),
    getScenes(),
  ]);

  const roomStates = buildRoomStates(lights, rooms, groupedLights, scenes);
  const totalOn = lights.filter((l) => l.on.on).length;
  const totalLights = lights.length;
  const anyOn = totalOn > 0;

  // Master toggle bar
  let html = `
    <div class="hue-master-bar" id="master-bar">
      <span class="hue-master-label">All Lights</span>
      <button class="hue-toggle${anyOn ? ' on' : ''}" id="master-toggle"
        onclick="hueToggleAll()" title="Toggle all lights"></button>
      <span class="hue-master-count" id="master-count">${String(totalOn)}/${String(totalLights)} on</span>
    </div>
  `;

  // Room cards
  html += '<div class="hue-grid" id="room-grid">';
  for (const room of roomStates) {
    html += renderRoomCard(room);
  }
  html += '</div>';

  // Active Effects
  const effects = listRunning();
  if (effects.length > 0) {
    let effectsHtml = '';
    for (const effect of effects) {
      effectsHtml += `
        <div class="hue-effect-row" id="effect-${escapeHtml(effect.id)}">
          <div>
            <span class="hue-effect-name">${escapeHtml(effect.name)}</span>
            <span class="hue-effect-desc">${escapeHtml(effect.description)}</span>
          </div>
          <button class="hue-stop-btn" onclick="hueStopEffect('${escapeHtml(effect.id)}')">Stop</button>
        </div>
      `;
    }
    html += pluginCard('Active Effects', `<div class="hue-effects">${effectsHtml}</div>`);
  }

  return html;
}

function renderRoomCard(room: RoomState): string {
  const brightnessVal = Math.round(room.brightness);
  const scenesHtml = room.scenes.length > 0
    ? `<div class="hue-scenes-row">${room.scenes.map(
      (s) => `<button class="hue-scene-btn" onclick="hueActivateScene('${escapeHtml(s.id)}')">${escapeHtml(s.name)}</button>`,
    ).join('')}</div>`
    : '';

  return `
    <div class="hue-room-card${room.on ? ' room-on' : ''}" data-room-id="${escapeHtml(room.id)}"
         data-grouped-light-id="${escapeHtml(room.groupedLightId ?? '')}">
      <div class="hue-room-header">
        <div>
          <div class="hue-room-name">${escapeHtml(room.name)}</div>
          <div class="hue-light-count" data-room-count="${escapeHtml(room.id)}">${String(room.lightsOn)}/${String(room.lightsTotal)} on</div>
        </div>
        <button class="hue-toggle${room.on ? ' on' : ''}" data-room-toggle="${escapeHtml(room.id)}"
          onclick="hueToggleRoom('${escapeHtml(room.id)}', '${escapeHtml(room.groupedLightId ?? '')}')"
          title="Toggle ${escapeHtml(room.name)}"></button>
      </div>
      <input type="range" class="hue-brightness" min="0" max="100" value="${String(brightnessVal)}"
        data-room-brightness="${escapeHtml(room.id)}"
        oninput="hueDebouncedRoomBrightness('${escapeHtml(room.id)}', '${escapeHtml(room.groupedLightId ?? '')}', this.value)"
        title="Brightness">
      <span class="hue-brightness-label" data-room-brightness-label="${escapeHtml(room.id)}">${String(brightnessVal)}%</span>
      ${scenesHtml}
    </div>
  `;
}

// =============================================================================
// Page: Scenes
// =============================================================================

async function renderScenes(): Promise<string> {
  const [scenes, rooms] = await Promise.all([getScenes(), getRooms()]);
  const roomMap = new Map(rooms.map((r) => [r.id, r.metadata.name]));

  if (scenes.length === 0) {
    return '<div class="hue-empty">No scenes found on the bridge.</div>';
  }

  let html = '<div class="hue-scene-grid">';
  for (const scene of scenes) {
    const roomName = roomMap.get(scene.group.rid) ?? 'Unknown room';
    html += `
      <div class="hue-scene-card">
        <div class="hue-scene-card-name">${escapeHtml(scene.metadata.name)}</div>
        <div class="hue-scene-card-room">${escapeHtml(roomName)}</div>
        <button class="hue-activate-btn" onclick="hueActivateScene('${escapeHtml(scene.id)}')">Activate</button>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

// =============================================================================
// Page: Sensors
// =============================================================================

async function renderSensors(): Promise<string> {
  const [motion, temp, lightLevel, devices] = await Promise.all([
    getMotionSensors(),
    getTemperatureSensors(),
    getLightLevelSensors(),
    getDevices(),
  ]);

  // Build device name lookup
  const deviceNames = new Map<string, string>();
  for (const d of devices) {
    deviceNames.set(d.id, d.metadata.name);
  }

  if (motion.length === 0 && temp.length === 0 && lightLevel.length === 0) {
    return '<div class="hue-empty">No sensors found on the bridge.</div>';
  }

  let html = '<div class="hue-sensor-grid">';

  for (const s of motion) {
    const name = deviceNames.get(s.owner.rid) ?? 'Motion sensor';
    const active = s.motion.motion;
    html += `
      <div class="hue-sensor-card" data-sensor-id="${escapeHtml(s.id)}">
        <div class="hue-sensor-type">Motion</div>
        <div class="hue-sensor-value">
          <span class="hue-sensor-status ${active ? 'active' : 'inactive'}"></span>
          ${active ? 'Motion detected' : 'Clear'}
        </div>
        <div class="hue-sensor-label">${escapeHtml(name)}</div>
      </div>
    `;
  }

  for (const s of temp) {
    const name = deviceNames.get(s.owner.rid) ?? 'Temperature sensor';
    const tempC = s.temperature.temperature;
    const tempF = (tempC * 9) / 5 + 32;
    html += `
      <div class="hue-sensor-card" data-sensor-id="${escapeHtml(s.id)}">
        <div class="hue-sensor-type">Temperature</div>
        <div class="hue-sensor-value">${tempC.toFixed(1)}&deg;C / ${tempF.toFixed(1)}&deg;F</div>
        <div class="hue-sensor-label">${escapeHtml(name)}</div>
      </div>
    `;
  }

  for (const s of lightLevel) {
    const name = deviceNames.get(s.owner.rid) ?? 'Light sensor';
    const lux = Math.round(Math.pow(10, (s.light.light_level - 1) / 10000));
    html += `
      <div class="hue-sensor-card" data-sensor-id="${escapeHtml(s.id)}">
        <div class="hue-sensor-type">Light Level</div>
        <div class="hue-sensor-value">${String(lux)} lux</div>
        <div class="hue-sensor-label">${escapeHtml(name)}</div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

// =============================================================================
// Client-side JavaScript
// =============================================================================

const CLIENT_JS = `
<script>
(function() {
  // Debounce helper
  var brightnessTimers = {};
  function debounce(key, fn, ms) {
    if (brightnessTimers[key]) clearTimeout(brightnessTimers[key]);
    brightnessTimers[key] = setTimeout(fn, ms);
  }

  // POST helper
  function huePost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function(r) { return r.json(); })
      .catch(function(err) { console.error('Hue API error:', err); });
  }

  // Toggle all lights
  window.hueToggleAll = function() {
    huePost('/p/hue/all/toggle').then(function(data) {
      if (data && data.success) {
        var btn = document.getElementById('master-toggle');
        if (btn) btn.classList.toggle('on');
      }
    });
  };

  // Toggle room
  window.hueToggleRoom = function(roomId, groupedLightId) {
    huePost('/p/hue/rooms/' + encodeURIComponent(groupedLightId) + '/toggle').then(function(data) {
      if (data && data.success) {
        var cards = document.querySelectorAll('[data-room-id]');
        cards.forEach(function(card) {
          if (card.dataset.roomId === roomId) {
            card.classList.toggle('room-on');
            var toggle = card.querySelector('.hue-toggle');
            if (toggle) toggle.classList.toggle('on');
          }
        });
      }
    });
  };

  // Debounced room brightness
  window.hueDebouncedRoomBrightness = function(roomId, groupedLightId, value) {
    var cards = document.querySelectorAll('[data-room-id]');
    cards.forEach(function(card) {
      if (card.dataset.roomId === roomId) {
        var label = card.querySelector('[data-room-brightness-label]');
        if (label) label.textContent = value + '%';
      }
    });
    debounce('room-' + roomId, function() {
      huePost('/p/hue/rooms/' + encodeURIComponent(groupedLightId) + '/brightness', { brightness: parseInt(value, 10) });
    }, 300);
  };

  // Activate scene
  window.hueActivateScene = function(sceneId) {
    huePost('/p/hue/scenes/' + encodeURIComponent(sceneId) + '/activate');
  };

  // Stop effect
  window.hueStopEffect = function(effectId) {
    huePost('/p/hue/effects/' + encodeURIComponent(effectId) + '/stop').then(function(data) {
      if (data && data.success) {
        var row = document.getElementById('effect-' + effectId);
        if (row) row.remove();
      }
    });
  };

  // SSE live updates
  var es;
  function connectSSE() {
    es = new EventSource('/p/hue/stream');

    es.addEventListener('light-state', function(e) {
      try {
        var data = JSON.parse(e.data);
        // Update master count
        var masterCount = document.getElementById('master-count');
        if (masterCount) masterCount.textContent = data.totalOn + '/' + data.totalLights + ' on';
        var masterToggle = document.getElementById('master-toggle');
        if (masterToggle) {
          if (data.totalOn > 0) masterToggle.classList.add('on');
          else masterToggle.classList.remove('on');
        }
        // Update room cards
        if (data.rooms) {
          var allCards = document.querySelectorAll('[data-room-id]');
          data.rooms.forEach(function(room) {
            allCards.forEach(function(card) {
              if (card.dataset.roomId !== room.id) return;
              // Toggle state
              if (room.on) card.classList.add('room-on');
              else card.classList.remove('room-on');
              var toggle = card.querySelector('.hue-toggle');
              if (toggle) {
                if (room.on) toggle.classList.add('on');
                else toggle.classList.remove('on');
              }
              // Light count
              var count = card.querySelector('[data-room-count]');
              if (count) count.textContent = room.lightsOn + '/' + room.lightsTotal + ' on';
              // Brightness (only update if user is not actively dragging)
              var slider = card.querySelector('[data-room-brightness]');
              if (slider && document.activeElement !== slider) {
                slider.value = Math.min(100, Math.max(0, Math.round(room.brightness)));
                var label = card.querySelector('[data-room-brightness-label]');
                if (label) label.textContent = Math.min(100, Math.max(0, Math.round(room.brightness))) + '%';
              }
            });
          });
        }
      } catch(err) { console.error('SSE light-state parse error:', err); }
    });

    es.onerror = function() {
      es.close();
      setTimeout(connectSSE, 5000);
    };
  }
  connectSSE();
})();
</script>
`;

// =============================================================================
// Not Configured Page
// =============================================================================

function notConfiguredPage(): string {
  return `
    <div class="hue-not-configured">
      <h2>Hue Bridge Not Configured</h2>
      <p>Set <code>HUE_BRIDGE_IP</code> and <code>HUE_API_KEY</code> environment variables to connect.</p>
    </div>
  `;
}

// =============================================================================
// Route Registration
// =============================================================================

export function registerHueWebRoutes(router: PluginRouter): void {
  // Dashboard home
  router.get('/', async (_req, res, ctx) => {
    let body: string;
    try {
      body = navPills('dashboard') + await renderDashboard();
    } catch (err) {
      if (err instanceof HueNotConfiguredError) {
        body = notConfiguredPage();
      } else {
        body = pluginCard('Error', `<p>Could not connect to Hue bridge: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`);
      }
    }
    res.send(renderPluginPage({
      title: 'Hue Dashboard',
      pluginName: ctx.name,
      body,
      styles: CSS,
      scripts: CLIENT_JS,
    }));
  });

  // Scenes page
  router.get('/scenes', async (_req, res, ctx) => {
    let body: string;
    try {
      body = navPills('scenes') + await renderScenes();
    } catch (err) {
      if (err instanceof HueNotConfiguredError) {
        body = notConfiguredPage();
      } else {
        body = pluginCard('Error', `<p>Could not load scenes: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`);
      }
    }
    res.send(renderPluginPage({
      title: 'Hue Scenes',
      pluginName: ctx.name,
      body,
      styles: CSS,
      scripts: CLIENT_JS,
    }));
  });

  // Sensors page
  router.get('/sensors', async (_req, res, ctx) => {
    let body: string;
    try {
      body = navPills('sensors') + await renderSensors();
    } catch (err) {
      if (err instanceof HueNotConfiguredError) {
        body = notConfiguredPage();
      } else {
        body = pluginCard('Error', `<p>Could not load sensors: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`);
      }
    }
    res.send(renderPluginPage({
      title: 'Hue Sensors',
      pluginName: ctx.name,
      body,
      styles: CSS,
    }));
  });

  // ─── POST API Routes ──────────────────────────────────────────────────

  // Toggle single light
  router.post('/lights/:id/toggle', async (req, res) => {
    try {
      const lightId = String(req.params.id);
      if (!HUE_ID_RE.test(lightId)) {
        res.status(400).json({ success: false, error: 'Invalid ID format' });
        return;
      }
      const light = await getLight(lightId);
      const newState = !light.on.on;
      await controlLight(lightId, { on: { on: newState } });
      res.json({ success: true, on: newState });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Set light brightness
  router.post('/lights/:id/brightness', async (req, res) => {
    try {
      const lightId = String(req.params.id);
      if (!HUE_ID_RE.test(lightId)) {
        res.status(400).json({ success: false, error: 'Invalid ID format' });
        return;
      }
      const brightness = Number(req.body?.brightness);
      if (isNaN(brightness) || brightness < 0 || brightness > 100) {
        res.status(400).json({ success: false, error: 'brightness must be 0-100' });
        return;
      }
      await controlLight(lightId, {
        on: { on: brightness > 0 },
        dimming: { brightness },
      });
      res.json({ success: true, brightness });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Toggle room
  router.post('/rooms/:id/toggle', async (req, res) => {
    try {
      const groupedLightId = String(req.params.id);
      if (!HUE_ID_RE.test(groupedLightId)) {
        res.status(400).json({ success: false, error: 'Invalid ID format' });
        return;
      }
      const gl = await getGroupedLight(groupedLightId);
      const newState = !gl.on.on;
      await controlGroupedLight(groupedLightId, { on: { on: newState } });
      res.json({ success: true, on: newState });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Set room brightness
  router.post('/rooms/:id/brightness', async (req, res) => {
    try {
      const groupedLightId = String(req.params.id);
      if (!HUE_ID_RE.test(groupedLightId)) {
        res.status(400).json({ success: false, error: 'Invalid ID format' });
        return;
      }
      const brightness = Number(req.body?.brightness);
      if (isNaN(brightness) || brightness < 0 || brightness > 100) {
        res.status(400).json({ success: false, error: 'brightness must be 0-100' });
        return;
      }
      await controlGroupedLight(groupedLightId, {
        on: { on: brightness > 0 },
        dimming: { brightness },
      });
      res.json({ success: true, brightness });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Activate scene
  router.post('/scenes/:id/activate', async (req, res) => {
    try {
      const sceneId = String(req.params.id);
      if (!HUE_ID_RE.test(sceneId)) {
        res.status(400).json({ success: false, error: 'Invalid ID format' });
        return;
      }
      await activateScene(sceneId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Toggle all lights
  router.post('/all/toggle', async (_req, res) => {
    try {
      const lights = await getLights();
      const anyOn = lights.some((l) => l.on.on);
      const newState = !anyOn;

      const groupedLights = await getGroupedLights();
      await Promise.all(
        groupedLights.map((gl) => controlGroupedLight(gl.id, { on: { on: newState } })),
      );
      res.json({ success: true, on: newState });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Stop effect
  router.post('/effects/:id/stop', async (req, res) => {
    try {
      const effectId = String(req.params.id);
      if (!HUE_ID_RE.test(effectId)) {
        res.status(400).json({ success: false, error: 'Invalid ID format' });
        return;
      }
      const stopped = stopEffect(effectId);
      if (stopped) {
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, error: 'Effect not found' });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

// =============================================================================
// Dashboard Widget
// =============================================================================

// Cached widget state (updated by SSE poll loop)
let cachedWidgetHtml = '<p style="color:var(--text-secondary)">Connecting to bridge...</p>';
let cachedWidgetSize: 'small' | 'medium' = 'small';

export function updateWidgetCache(
  totalOn: number,
  totalLights: number,
  roomStates: RoomState[],
): void {
  const topRooms = roomStates
    .filter((r) => r.lightsTotal > 0)
    .slice(0, 3)
    .map((r) => `${escapeHtml(r.name)}: ${Math.round(r.brightness)}%`)
    .join(' | ');

  cachedWidgetHtml = `
    <p style="font-size:1.1rem;margin:0 0 0.25rem 0">
      ${String(totalOn)}/${String(totalLights)} lights on
    </p>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin:0">
      ${topRooms || 'No rooms'}
    </p>
  `;
  cachedWidgetSize = 'medium';
}

export function getHueWidgets(): DashboardWidget[] {
  return [{
    title: 'Hue',
    icon: 'lightbulb',
    html: cachedWidgetHtml,
    link: '/p/hue/',
    priority: 20,
    size: cachedWidgetSize,
  }];
}
