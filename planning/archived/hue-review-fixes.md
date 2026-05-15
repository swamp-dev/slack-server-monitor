# Hue Plugin: Code Review Fixes

## Context

Code review of the hue plugin extension identified two categories of remaining issues:
1. **Test coverage gaps**: 4 files with zero or minimal test coverage
2. **Code issues**: 5 lower-severity bugs/design issues

This plan addresses all of them in priority order.

---

## Part 1: Test Coverage Gaps

### 1A. `client.ts` retry logic tests (`tests/plugins/hue/client.test.ts`)

Currently only tests `getConfig()` and error type constructors. Need to test the actual HTTP behavior.

**Approach**: Can't easily mock `node:https` due to vi.mock hoisting issues (discovered in Phase 0). Instead, test the retry-adjacent logic that's testable:

- `getConfig()` bridge IP validation (new regex check)
- Error classification: `HueApiError(503)` vs `HueApiError(404)` for transient detection
- Export `isTransientError` for direct testing

**Tests to add** (~8 tests):
- Bridge IP validation: valid IP, valid hostname, rejects `127.0.0.1:443/path#fragment`
- `isTransientError`: returns true for 503, ECONNRESET, ETIMEDOUT, ECONNREFUSED, EPIPE
- `isTransientError`: returns false for 400, 404, HueApiError without 503, generic Error

**File**: `tests/plugins/hue/client.test.ts` (extend existing)

### 1B. `commands.ts` tests (`tests/plugins/hue/commands.test.ts`)

**Approach**: Mock `hue/client.js`, test `parseArgs`, `lightStatusLine`, and `handleHueCommand` with each subcommand.

**Tests to add** (~20 tests):
- `parseArgs`: empty string, single word, multiple spaces, trim
- `lightStatusLine`: light on with brightness, light off, light without dimming
- `handleHueCommand`:
  - `[]` (empty) → calls dashboard
  - `['help']` → returns help text
  - `['rooms']` → returns room list
  - `['scenes']` → returns scene table
  - `['on']` → turns on all rooms
  - `['on', 'Desk']` → turns on specific light
  - `['off']` → turns off all rooms
  - `['off', 'Desk']` → turns off specific light
  - `['dim', 'Desk', '75']` → sets brightness
  - `['dim']` → error usage
  - `['dim', 'Desk', '150']` → error out of range
  - `['scene', 'Relax']` → activates scene
  - `['scene']` → error usage
  - `['color', 'Desk', 'red']` → sets named color
  - `['color', 'Desk', '#FF0000']` → sets hex color
  - `['color', 'Desk', 'warm', 'white']` → two-word color
  - `['unknown']` → error unknown command

**File**: `tests/plugins/hue/commands.test.ts` (new)

### 1C. `tools-scenes.ts` tests (`tests/plugins/hue/tools-scenes.test.ts`)

**Approach**: Mock `hue/client.js` for bridge scene ops. Use in-memory SQLite for custom scene cache (same pattern as `scene-cache.test.ts`).

**Tests to add** (~15 tests):
- `create_scene`: success (captures room lights), unknown room, empty room
- `update_scene`: rename success, unknown scene, no changes
- `delete_scene`: success, unknown scene
- `list_custom_scenes`: empty, with scenes
- `recall_custom_scene`: success, unknown name
- `clear_custom_scene`: success, unknown name
- `export_custom_scene`: success, unknown name

**File**: `tests/plugins/hue/tools-scenes.test.ts` (new)

### 1D. `tools-effects.ts` wrapper tests (`tests/plugins/hue/tools-effects.test.ts`)

**Approach**: Mock `findTarget` and the effect runner functions. Verify tool execute returns proper messages and passes correct parameters.

**Tests to add** (~15 tests):
- `flash_effect`: success message with sequence ID, validation error (empty target)
- `pulse_effect`: success, parameter passthrough
- `color_loop`: success, error with <2 colors
- `strobe_effect`: success
- `alert_effect`: success
- `fade_effect`: success
- `list_sequences`: empty, with running effects
- `stop_sequence`: success, unknown ID, "all"

**File**: `tests/plugins/hue/tools-effects.test.ts` (new)

---

## Part 2: Code Issues

### 2A. State capture for grouped lights (`effects.ts`)

**Problem**: `captureState` returns null for grouped lights (rooms). Effects on rooms don't restore state after completion.

**Fix**: Add grouped light state capture via `GET /grouped_light/{id}`. The response has `on` and `dimming` fields (no color for groups). Restore these on completion.

**Files**: `plugins.example/hue/effects.ts`, `plugins.example/hue/client.ts` (add `getGroupedLight`)

### 2B. `findTarget` disambiguation (`matching.ts`)

**Problem**: `findTarget("Office")` matches light "Office Desk" via substring before ever checking the "Office" room.

**Fix**: Check for exact room name match before falling back to light substring match. Order: exact light → exact room → substring light → substring room.

**Files**: `plugins.example/hue/matching.ts`, update `tests/plugins/hue/matching.test.ts`

### 2C. `getScene` side effects on read (`scene-cache.ts`)

**Problem**: `getScene` increments use count even when called from `export_custom_scene`.

**Fix**: Split into `readScene` (no side effects) and `recallScene` (bumps counter). `export_custom_scene` uses `readScene`, `recall_custom_scene` uses `recallScene`.

**Files**: `plugins.example/hue/scene-cache.ts`, `plugins.example/hue/tools-scenes.ts`, update `tests/plugins/hue/scene-cache.test.ts`

### 2D. Export `isTransientError` for testability (`client.ts`)

**Problem**: Retry logic internals are untestable because `isTransientError` is not exported.

**Fix**: Export the function. Add tests in client.test.ts (covered in 1A above).

**File**: `plugins.example/hue/client.ts`

### 2E. Sequence registry `targetId` for multi-target (`sequences.ts`)

**Problem**: Uses first step's target string, which is misleading for multi-target sequences.

**Fix**: Use `"multi"` when steps have more than one unique target, otherwise use the single target name.

**File**: `plugins.example/hue/sequences.ts`

---

## Implementation Order

1. **2D** — Export `isTransientError` (1 line change, unblocks 1A)
2. **1A** — Client retry tests
3. **1B** — Commands tests
4. **1C** — Tools-scenes tests (need scene cache init)
5. **1D** — Tools-effects wrapper tests
6. **2A** — Grouped light state capture
7. **2B** — findTarget disambiguation
8. **2C** — Scene cache read vs recall split
9. **2E** — Sequence targetId fix

## Verification

- `npm test` — all tests pass (existing + ~58 new)
- `npm run typecheck` — clean
- `npm run lint` — clean
