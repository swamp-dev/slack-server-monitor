/**
 * Slack slash command handler for /hue.
 */

import type { Block, KnownBlock } from '@slack/types';
import { getLights, getRooms, getGroupedLights, getScenes, activateScene } from './client.js';
import { findByName, listNames, findTarget, controlTarget } from './matching.js';
import { COLORS, resolveColor } from './colors.js';
import type { HueLight } from './types.js';
import {
  header,
  section,
  divider,
  context,
  buildResponse,
  success,
  error as errorBlock,
  statusEmoji,
  helpTip,
  formatTable,
} from '../../src/formatters/blocks.js';
import { logger } from '../../src/utils/logger.js';

// =============================================================================
// Formatters
// =============================================================================

export function lightStatusLine(light: HueLight): string {
  const name = light.metadata.name;
  const on = light.on.on;
  const emoji = on ? statusEmoji('ok') : statusEmoji('unknown');
  const brightness = light.dimming ? ` ${Math.round(light.dimming.brightness)}%` : '';
  const state = on ? `on${brightness}` : 'off';
  return `${emoji} *${name}* — ${state}`;
}

export async function buildDashboard(): Promise<ReturnType<typeof buildResponse>> {
  const [lights, rooms] = await Promise.all([getLights(), getRooms()]);

  const blocks: (Block | KnownBlock)[] = [header('Hue Lights')];

  const deviceToRoom = new Map<string, string>();
  for (const room of rooms) {
    for (const child of room.children) {
      deviceToRoom.set(child.rid, room.metadata.name);
    }
  }

  const roomLights = new Map<string, HueLight[]>();
  const ungrouped: HueLight[] = [];

  for (const light of lights) {
    const roomName = deviceToRoom.get(light.owner.rid);
    if (roomName) {
      const arr = roomLights.get(roomName) ?? [];
      arr.push(light);
      roomLights.set(roomName, arr);
    } else {
      ungrouped.push(light);
    }
  }

  const onCount = lights.filter((l) => l.on.on).length;
  const offCount = lights.length - onCount;
  blocks.push(
    section(
      `${statusEmoji('ok')} ${onCount} on  ·  ${statusEmoji('unknown')} ${offCount} off`,
    ),
  );
  blocks.push(divider());

  for (const [roomName, roomLightList] of roomLights) {
    const lines = roomLightList.map(lightStatusLine).join('\n');
    blocks.push(section(`*${roomName}*\n${lines}`));
  }

  if (ungrouped.length > 0) {
    const lines = ungrouped.map(lightStatusLine).join('\n');
    blocks.push(section(`*Other*\n${lines}`));
  }

  blocks.push(
    helpTip(['`/hue on <name>` · `/hue off <name>` · `/hue scene <name>` · `/hue help`']),
  );

  return buildResponse(blocks);
}

// =============================================================================
// Command Parser
// =============================================================================

export function parseArgs(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

// =============================================================================
// Command Handler
// =============================================================================

export async function handleHueCommand(
  args: string[],
): Promise<ReturnType<typeof buildResponse>> {
  const sub = args[0]?.toLowerCase() ?? '';
  const rest = args.slice(1).join(' ').trim();

  try {
    switch (sub) {
      case '':
        return buildDashboard();

      case 'help':
        return buildResponse([
          header('Hue Commands'),
          section(
            '`/hue` — Light dashboard\n' +
              '`/hue rooms` — List rooms\n' +
              '`/hue scenes` — List scenes\n' +
              '`/hue on [name]` — Turn on light/room\n' +
              '`/hue off [name]` — Turn off light/room\n' +
              '`/hue dim <name> <0-100>` — Set brightness\n' +
              '`/hue scene <name>` — Activate scene\n' +
              '`/hue color <name> <color>` — Set color\n',
          ),
          context(`Colors: ${Object.keys(COLORS).join(', ')}`),
        ]);

      case 'rooms': {
        const [rooms, groupedLights] = await Promise.all([
          getRooms(),
          getGroupedLights(),
        ]);
        const blocks: (Block | KnownBlock)[] = [header('Rooms')];
        for (const room of rooms) {
          const gl = groupedLights.find(
            (g) => g.owner.rid === room.id && g.owner.rtype === 'room',
          );
          const on = gl?.on?.on ?? false;
          const brightness = gl?.dimming
            ? ` ${Math.round(gl.dimming.brightness)}%`
            : '';
          const emoji = on ? statusEmoji('ok') : statusEmoji('unknown');
          const lightCount = room.children.filter(
            (c) => c.rtype === 'device',
          ).length;
          blocks.push(
            section(
              `${emoji} *${room.metadata.name}* — ${on ? `on${brightness}` : 'off'} (${lightCount} lights)`,
            ),
          );
        }
        return buildResponse(blocks);
      }

      case 'scenes': {
        const [scenes, rooms] = await Promise.all([getScenes(), getRooms()]);
        const roomMap = new Map(rooms.map((r) => [r.id, r.metadata.name]));
        const blocks: (Block | KnownBlock)[] = [header('Scenes')];
        const rows = scenes.map((s) => [
          s.metadata.name,
          roomMap.get(s.group.rid) ?? 'Unknown',
        ]);
        blocks.push(section(formatTable(['Scene', 'Room'], rows)));
        blocks.push(helpTip(['`/hue scene <name>` to activate']));
        return buildResponse(blocks);
      }

      case 'on': {
        if (!rest) {
          const groupedLights = await getGroupedLights();
          const roomLights = groupedLights.filter(
            (gl) => gl.owner.rtype === 'room',
          );
          await Promise.all(
            roomLights.map((gl) =>
              controlTarget({ id: gl.id, type: 'grouped_light', displayName: '' }, { on: { on: true } }),
            ),
          );
          return buildResponse([success('All lights turned on')]);
        }
        const target = await findTarget(rest);
        await controlTarget(target, { on: { on: true } });
        return buildResponse([success(`*${target.displayName}* turned on`)]);
      }

      case 'off': {
        if (!rest) {
          const groupedLights = await getGroupedLights();
          const roomLights = groupedLights.filter(
            (gl) => gl.owner.rtype === 'room',
          );
          await Promise.all(
            roomLights.map((gl) =>
              controlTarget({ id: gl.id, type: 'grouped_light', displayName: '' }, { on: { on: false } }),
            ),
          );
          return buildResponse([success('All lights turned off')]);
        }
        const target = await findTarget(rest);
        await controlTarget(target, { on: { on: false } });
        return buildResponse([success(`*${target.displayName}* turned off`)]);
      }

      case 'dim': {
        if (!rest) {
          return buildResponse([errorBlock('Usage: `/hue dim <name> <0-100>`')]);
        }
        const dimArgs = rest.split(/\s+/);
        if (dimArgs.length < 2) {
          return buildResponse([errorBlock('Usage: `/hue dim <name> <0-100>`')]);
        }
        const brightnessStr = dimArgs.pop()!;
        const name = dimArgs.join(' ');
        const brightness = Number(brightnessStr);
        if (isNaN(brightness) || brightness < 0 || brightness > 100) {
          return buildResponse([errorBlock('Usage: `/hue dim <name> <0-100>`')]);
        }
        const target = await findTarget(name);
        await controlTarget(target, {
          on: { on: brightness > 0 },
          dimming: { brightness },
        });
        return buildResponse([
          success(`*${target.displayName}* set to ${brightness}%`),
        ]);
      }

      case 'scene': {
        if (!rest) {
          return buildResponse([errorBlock('Usage: `/hue scene <name>`')]);
        }
        const scenes = await getScenes();
        const scene = findByName(scenes, rest);
        if (!scene) {
          return buildResponse([
            errorBlock(
              `No scene matching "${rest}". Available: ${listNames(scenes)}`,
            ),
          ]);
        }
        await activateScene(scene.id);
        return buildResponse([
          success(`Scene *${scene.metadata.name}* activated`),
        ]);
      }

      case 'color': {
        if (!rest) {
          return buildResponse([
            errorBlock(
              `Usage: \`/hue color <name> <color>\`\nColors: ${Object.keys(COLORS).join(', ')}`,
            ),
          ]);
        }
        const colorArgs = rest.split(/\s+/);
        let colorName: string | undefined;
        let targetName: string | undefined;

        // Try matching last two words as color (e.g., "warm white")
        if (colorArgs.length >= 3) {
          const twoWord =
            `${colorArgs[colorArgs.length - 2]} ${colorArgs[colorArgs.length - 1]}`.toLowerCase();
          if (COLORS[twoWord]) {
            colorName = twoWord;
            targetName = colorArgs.slice(0, -2).join(' ');
          }
        }
        // Try matching last word as named color or hex
        if (!colorName && colorArgs.length >= 2) {
          const oneWord = colorArgs[colorArgs.length - 1].toLowerCase();
          if (COLORS[oneWord] || resolveColor(oneWord)) {
            colorName = oneWord;
            targetName = colorArgs.slice(0, -1).join(' ');
          }
        }

        if (!colorName || !targetName) {
          return buildResponse([
            errorBlock(
              `Usage: \`/hue color <name> <color>\`\nColors: ${Object.keys(COLORS).join(', ')} or hex (#RRGGBB)`,
            ),
          ]);
        }

        const xy = resolveColor(colorName);
        if (!xy) {
          return buildResponse([
            errorBlock(`Unknown color "${colorName}". Available: ${Object.keys(COLORS).join(', ')}`),
          ]);
        }
        const target = await findTarget(targetName);
        await controlTarget(target, { on: { on: true }, color: { xy } });
        return buildResponse([
          success(`*${target.displayName}* set to ${colorName}`),
        ]);
      }

      default:
        return buildResponse([
          errorBlock(`Unknown command: \`${sub}\`. Try \`/hue help\`.`),
        ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Hue command error', { sub, rest, error: message });
    return buildResponse([errorBlock(message)]);
  }
}
