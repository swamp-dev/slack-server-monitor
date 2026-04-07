# Hue Plugin Extension: Complete API Coverage

## Context

The Hue plugin (`plugins.example/hue.ts`) is a 775-line monolith with 3 Claude tools and basic light/room/scene control. The user wants Claude to perform complex light manipulations (animated scenes, effects, sequences) and wants increased robustness. The reference implementation is the `kungfusheep/hue` Go MCP server which exposes 40+ tools including effects, batch commands, scene CRUD, sensors, and event streaming.

**Goals:**
1. **Primary**: Complex light manipulation - animated scenes, effects, sequences via Claude tools
2. **Secondary**: Robustness - retries, Zod validation, better error types, connection reuse
3. **Approach**: TDD throughout

---

## File Structure

The plugin loader discovers `.ts` files in `plugins.local/` (non-recursive) but `jiti` resolves imports normally, so the entry file can import from a subdirectory.

```
plugins.example/
  hue.ts                      # Entry: slim plugin object, imports + wiring
  hue/
    types.ts                  # Hue API types + effect parameter types + error classes
    client.ts                 # HTTP client with retry, keepAlive agent, config
    colors.ts                 # Named color map + hexToXY() conversion
    matching.ts               # findByName, findTarget, listNames, controlTarget
    validation.ts             # Zod schemas for all tool inputs
    commands.ts               # Slack slash command handler + formatters
    effects.ts                # Effect scheduler: flash, pulse, color_loop, strobe, alert, fade
    effects-registry.ts       # Running effect tracking (Map<id, RunningEffect>)
    sequences.ts              # Custom multi-step sequence parser + executor
    scene-cache.ts            # Persistent custom scene cache (SQLite)
    tools-query.ts            # Read tools: get_lights, get_light_state, bridge_info, sensors
    tools-control.ts          # Write tools: control_light, activate_scene, batch_commands
    tools-effects.ts          # Effect tools: flash, pulse, color_loop, strobe, alert, etc.
    tools-scenes.ts           # Scene CRUD + custom scene cache tools

tests/plugins/hue/
    client.test.ts
    colors.test.ts
    matching.test.ts
    validation.test.ts
    commands.test.ts
    effects.test.ts
    effects-registry.test.ts
    sequences.test.ts
    scene-cache.test.ts
    tools-effects.test.ts
    tools-control.test.ts
    tools-scenes.test.ts
    tools-query.test.ts
```

---

## Phase 0: Extract and Test Existing Code

**Goal**: Split the monolith, establish module boundaries and mock patterns, test existing behavior.

### Files to create

| File | Contents extracted from `hue.ts` |
|------|--------------------------------|
| `hue/types.ts` | `HueLight`, `HueRoom`, `HueGroupedLight`, `HueScene`, `HueResponse` + new error classes (`HueApiError`, `HueBridgeUnreachableError`, `HueNotConfiguredError`) |
| `hue/client.ts` | `getConfig()`, `hueRequest()`, `getLights()`, `getRooms()`, `getGroupedLights()`, `getScenes()`, `controlLight()`, `controlGroupedLight()`, `activateScene()`. Add: retry with exponential backoff (3 attempts, 500/1000/2000ms, only for ECONNRESET/ETIMEDOUT/503), `https.Agent` with `keepAlive: true` |
| `hue/colors.ts` | `COLORS` map, new `hexToXY()` and named color lookup |
| `hue/matching.ts` | `findByName()`, `listNames()`, `findTarget()`, `controlTarget()` |
| `hue/validation.ts` | Zod schemas for every tool input |
| `hue/commands.ts` | `parseArgs()`, `handleHueCommand()`, `buildDashboard()`, all Slack Block Kit formatters |
| `hue.ts` | Slim entry: imports + plugin object + tool array + `registerCommands` |

### Tests

| Test file | What it covers |
|-----------|---------------|
| `client.test.ts` | Retry behavior (transient errors retry, 4xx doesn't), timeout handling, error classification |
| `colors.test.ts` | `hexToXY()` accuracy, named color lookup, invalid input handling |
| `matching.test.ts` | Exact match priority, substring fallback, "not found" error with available names |
| `validation.test.ts` | Zod schemas accept valid input, reject edge cases (brightness -1, brightness 101, empty target, etc.) |
| `commands.test.ts` | Each subcommand (on/off/dim/scene/color/rooms/scenes/help) with mocked API helpers |

### Mock pattern

```typescript
vi.mock('../../plugins.example/hue/client.js', () => ({
  getLights: vi.fn(),
  getRooms: vi.fn(),
  // ...
}));
```

### Robustness improvements in this phase

- **Retry**: Exponential backoff for transient errors only (ECONNRESET, ETIMEDOUT, HTTP 503)
- **Connection reuse**: `https.Agent({ keepAlive: true, maxSockets: 4 })`
- **Structured errors**: Custom error classes with codes for better tool output
- **Zod validation**: Every tool input validated before bridge calls

---

## Phase 1: Effects Engine (HIGH PRIORITY)

**Goal**: Build the effect scheduler and implement flash, pulse, color_loop, strobe, alert effects.

### Architecture

```
AbortController + setTimeout chains (not setInterval)
Each effect → unique ID + AbortController → registered in effects-registry
Abortable sleep helper checks signal.aborted between each step
State capture before effect → restore on completion/abort
```

### Key implementation: `effects.ts`

```typescript
// Abortable sleep
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

interface RunningEffect {
  id: string;
  name: string;
  targetId: string;
  abortController: AbortController;
  startedAt: number;
  description: string;
}
```

### Effects to implement

| Effect | Parameters | Behavior |
|--------|-----------|----------|
| `flash` | target, color (#hex), count (default 3), duration_ms (default 200) | On/off flashes with color |
| `pulse` | target, min_brightness (10), max_brightness (100), count (5), duration_ms (2000) | 10-step fade up/down per pulse |
| `color_loop` | target, colors (#hex array, default rainbow), transition_ms (1000) | Loop through colors indefinitely |
| `strobe` | target, color, rate_ms (100, min 50), duration_ms (5000) | Rapid on/off |
| `alert` | target, alert_color (red), normal_color (white) | 3 quick flashes then restore |
| `fade` | target, start_color, end_color, start_brightness, end_brightness, duration_ms, steps | Linear interpolation |

### Management tools

- `list_sequences` - Show all running effects with IDs
- `stop_sequence` - Stop by ID (or "all")

### Files

| File | Purpose |
|------|---------|
| `hue/effects.ts` | Effect implementations (flash, pulse, color_loop, strobe, alert, fade) |
| `hue/effects-registry.ts` | `Map<id, RunningEffect>`, create/list/stop/stopAll |
| `hue/tools-effects.ts` | Tool definitions for each effect + list/stop |
| `tests/plugins/hue/effects.test.ts` | Fake timers, verify API call sequences, abort mid-sequence |
| `tests/plugins/hue/effects-registry.test.ts` | Registry CRUD |
| `tests/plugins/hue/tools-effects.test.ts` | Tool handlers with mocked scheduler |

### Testing approach

- `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)`
- Verify correct number and order of `hueRequest` calls per effect
- Test abort: call `stop()` mid-sequence, verify no further API calls
- Test state restoration on completion and on abort

### Lifecycle integration

- `init()`: Create scheduler instance
- `destroy()`: Call `stopAll()` to abort all running effects

---

## Phase 2: Custom Sequences and Batch Commands

**Goal**: Multi-step choreography and batch operations.

### Custom sequences (`sequences.ts`)

A sequence is a JSON array of steps, each with:
```typescript
interface SequenceStep {
  action: 'on' | 'off' | 'color' | 'brightness' | 'scene';
  target: string;       // light or room name
  value?: string;       // color hex or brightness number
  delay_ms?: number;    // delay before this step
}
```

Sequences execute through the same AbortController pattern as effects and register in effects-registry.

### Batch commands tool

```typescript
{
  commands: SequenceStep[];    // Array of commands
  delay_ms?: number;           // Default delay between commands (100ms)
  async?: boolean;             // Fire-and-forget (true) vs wait (false)
  cache_name?: string;         // Save as custom scene
  cache_description?: string;
}
```

### Files

| File | Purpose |
|------|---------|
| `hue/sequences.ts` | Sequence parser, validator, executor |
| `hue/tools-control.ts` | Refactored control_light + activate_scene + new batch_commands |
| `tests/plugins/hue/sequences.test.ts` | Parse, validate, execute with timing |
| `tests/plugins/hue/tools-control.test.ts` | Tool handlers |

---

## Phase 3: Scene CRUD and Custom Scene Cache

**Goal**: Create/update/delete bridge scenes. Persistent custom scene cache.

### Bridge scene operations

- `create_scene` - Create from current light states in a room
- `update_scene` - Update scene metadata/actions
- `delete_scene` - Remove scene from bridge

### Custom scene cache (`scene-cache.ts`)

Persisted to SQLite via `PluginContext.db`:
```sql
CREATE TABLE IF NOT EXISTS plugin_hue_custom_scenes (
  name TEXT PRIMARY KEY,
  commands TEXT NOT NULL,     -- JSON batch commands
  description TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER DEFAULT 0
);
```

### Tools

- `create_scene`, `update_scene`, `delete_scene`
- `list_custom_scenes`, `recall_custom_scene`, `clear_custom_scene`, `export_custom_scene`

### Files

| File | Purpose |
|------|---------|
| `hue/scene-cache.ts` | SQLite-backed cache |
| `hue/tools-scenes.ts` | Scene CRUD + cache tools |
| `tests/plugins/hue/scene-cache.test.ts` | Cache store/recall/list/clear |
| `tests/plugins/hue/tools-scenes.test.ts` | Tool handlers |

---

## Phase 4: Enhanced Queries and Device Info

**Goal**: Richer read-only tools for Claude to understand the system.

### New tools

| Tool | Endpoint | Description |
|------|----------|-------------|
| `get_light_state` | `GET /light/{id}` | Full state dump for one light |
| `bridge_info` | `GET /bridge` | Bridge firmware, model, network |
| `list_devices` | `GET /device` | All devices with product info |
| `get_device` | `GET /device/{id}` | Detailed device information |

### Files

| File | Purpose |
|------|---------|
| `hue/tools-query.ts` | All query/read tools |
| `tests/plugins/hue/tools-query.test.ts` | Tool handlers with canned responses |

---

## Phase 5: Sensors

**Goal**: Expose motion, temperature, light level, and button sensors.

### New tools

| Tool | Endpoint | Description |
|------|----------|-------------|
| `list_motion_sensors` | `GET /motion` | Motion detected state |
| `list_temperature_sensors` | `GET /temperature` | Temp in C and F |
| `list_light_level_sensors` | `GET /light_level` | Light level in lux |
| `list_buttons` | `GET /button` | Button/dimmer switch events |

### New types in `types.ts`

```typescript
interface HueMotionSensor { id: string; enabled: boolean; motion: { motion: boolean }; owner: HueRef; }
interface HueTemperatureSensor { id: string; enabled: boolean; temperature: { temperature: number }; owner: HueRef; }
interface HueLightLevelSensor { id: string; enabled: boolean; light: { light_level: number }; owner: HueRef; }
interface HueButton { id: string; metadata: { control_id: number }; button: { last_event: string }; owner: HueRef; }
```

---

## Phase 6: Event Stream (SSE) -- Lower Priority

**Goal**: Real-time Hue bridge event monitoring.

### Architecture

- Persistent HTTPS connection to `/eventstream/clip/v2`
- Chunked transfer encoding (SSE protocol)
- Circular buffer of last 100 events
- Auto-reconnect on disconnect (5s backoff)
- Managed via `init()`/`destroy()` lifecycle hooks

### Tools

- `start_event_stream`, `stop_event_stream`
- `get_event_stream_status`, `get_recent_events` (with type filter)

### Files

| File | Purpose |
|------|---------|
| `hue/eventstream.ts` | SSE client, event buffer, filtering |
| `tests/plugins/hue/eventstream.test.ts` | Mock SSE stream, test buffer/filter |

---

## Phase 7: Entertainment/Streaming -- Lowest Priority

UDP-based real-time color streaming. Complex, limited Slack bot use case. Defer unless specifically requested.

---

## Phase Dependencies

```
Phase 0 (extract + test) ──┬──> Phase 1 (effects) ──> Phase 2 (sequences/batch)
                           ├──> Phase 3 (scene CRUD) -- independent
                           ├──> Phase 4 (queries) -- independent
                           └──> Phase 5 (sensors) -- independent

Phase 6 (SSE) -- independent, but lower priority
Phase 7 (entertainment) -- deferred
```

Phases 3, 4, 5 can proceed in parallel with Phases 1-2 since they only depend on Phase 0.

---

## Tool Summary (All Phases)

### Phase 0 (existing, extracted)
1. `get_lights` - List lights with state
2. `control_light` - On/off/dim/color individual light or room
3. `activate_scene` - Activate bridge scene

### Phase 1 (effects)
4. `flash_effect` - Attention flashes
5. `pulse_effect` - Breathing/heartbeat
6. `color_loop` - Color cycling
7. `strobe_effect` - Rapid strobe
8. `alert_effect` - Alert pattern
9. `fade_effect` - Smooth transition
10. `list_sequences` - Show running effects
11. `stop_sequence` - Stop effect by ID

### Phase 2 (sequences/batch)
12. `custom_sequence` - Multi-step choreography
13. `batch_commands` - Multiple commands with timing

### Phase 3 (scenes)
14. `create_scene` - Create bridge scene from current state
15. `update_scene` - Update scene metadata
16. `delete_scene` - Delete bridge scene
17. `list_custom_scenes` - Cached custom scenes
18. `recall_custom_scene` - Recall cached scene
19. `clear_custom_scene` - Delete cached scene
20. `export_custom_scene` - Export as JSON

### Phase 4 (queries)
21. `get_light_state` - Full state of one light
22. `bridge_info` - Bridge system info
23. `list_devices` - All devices
24. `get_device` - One device detail

### Phase 5 (sensors)
25. `list_motion_sensors`
26. `list_temperature_sensors`
27. `list_light_level_sensors`
28. `list_buttons`

### Phase 6 (events)
29. `start_event_stream`
30. `stop_event_stream`
31. `get_event_stream_status`
32. `get_recent_events`

**Total: 31 tools** (up from 3)

---

## Verification

### Per-phase
- `npm test` - All tests pass (existing + new)
- `npm run typecheck` - No TypeScript errors
- `npm run lint` - No lint errors

### Integration testing (after Phase 1+)
1. Copy `plugins.example/hue.ts` and `plugins.example/hue/` to `plugins.local/`
2. Set `HUE_BRIDGE_IP` and `HUE_API_KEY` in `.env`
3. `npm run dev` - Bot starts, plugin loads
4. Test slash commands: `/hue`, `/hue rooms`, `/hue on`, `/hue off`
5. Test via Claude: `/ask flash the office lights red 5 times`
6. Test effect management: `/ask list running effects` then `/ask stop all effects`
7. Verify `destroy()` cleans up running effects on bot shutdown

### Robustness verification
- Kill bridge network temporarily, verify retry + graceful error messages
- Send malformed tool inputs, verify Zod rejects with clear errors
- Run multiple effects simultaneously, verify they don't interfere
- Abort effect mid-run, verify state restoration
