/**
 * `/user-admin` Slack slash command (#274).
 *
 * Lets admins manage users at runtime without restarting the bot or
 * shelling into the host. Read-only subcommands (`list`, `whoami`) are
 * available to any authenticated user; mutations require admin role.
 *
 * Subcommand handlers below (`handle*`) are pure: they take their store
 * dependencies and return Block-Kit blocks. The Slack registration
 * function at the bottom is the only impure surface.
 */
import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { logger } from '../utils/logger.js';
import {
  type UserStore,
  getUserStore,
  resolveUserStoreDbPath,
} from '../services/user-store.js';
import { type InviteStore, getInviteStore } from '../services/invite-store.js';
import type { User, UserRole } from '../types/user.js';
import {
  section,
  error as errorBlock,
  success as successBlock,
} from '../formatters/blocks.js';

// ─── Subcommand handlers (pure) ───────────────────────────────────────

interface UserAdminContext {
  /** Slack user_id of the requesting user. */
  requesterId: string;
  /** Role attached by `authorize` middleware (#271). */
  requesterRole: UserRole | undefined;
  /** Web base URL — used to build the registration URL for invite codes. */
  baseUrl?: string;
}

const SLACK_ID_RE = /^U[A-Z0-9]+$/;

function permissionDenied(): KnownBlock[] {
  return [errorBlock('This subcommand requires admin role.')];
}

function badArgs(message: string): KnownBlock[] {
  return [errorBlock(message)];
}

function formatUserLine(u: User): string {
  const idTag = u.slackId ?? (u.username ? `(web:${u.username})` : '<no id>');
  const status = u.isActive ? '' : ' • _deactivated_';
  return `• \`${idTag}\` *${u.role}*${status}${u.displayName ? ` — ${u.displayName}` : ''}`;
}

/**
 * Slack section blocks cap text at 3000 chars. Keep the rendered list
 * under that even with chatty user records by capping the displayed
 * count and surfacing a "…and N more" footer. The full list is
 * always available via `npm run manage-users list-users`.
 */
const LIST_DISPLAY_CAP = 50;

export function handleList(userStore: UserStore): KnownBlock[] {
  const users = userStore.listAll();
  if (users.length === 0) {
    return [section('No users yet.')];
  }
  const shown = users.slice(0, LIST_DISPLAY_CAP);
  const lines = shown.map(formatUserLine).join('\n');
  const overflow = users.length > LIST_DISPLAY_CAP
    ? `\n_…and ${String(users.length - LIST_DISPLAY_CAP)} more — run \`npm run manage-users list-users\` for the full list._`
    : '';
  return [
    section(`*Users (${String(users.length)})*\n${lines}${overflow}`),
  ];
}

export function handleWhoami(userStore: UserStore, slackId: string): KnownBlock[] {
  const user = userStore.getBySlackId(slackId);
  if (!user) {
    return [
      section(`You are *${slackId}* — not registered in the users table. ` +
        'Authorized via the deprecated env-var fallback.'),
    ];
  }
  const lines = [
    `*Your user record*`,
    `• Slack ID: \`${user.slackId ?? '—'}\``,
    `• Username: \`${user.username ?? '—'}\``,
    `• Role: *${user.role}*`,
    `• Active: ${user.isActive ? 'yes' : 'no'}`,
    user.displayName ? `• Display name: ${user.displayName}` : null,
  ].filter(Boolean).join('\n');
  return [section(lines)];
}

export async function handleAdd(
  userStore: UserStore,
  args: string[],
): Promise<KnownBlock[]> {
  const [slackId, roleArg] = args;
  if (!slackId || !SLACK_ID_RE.test(slackId)) {
    return badArgs('Usage: `/user-admin add <SlackID> [admin]` (Slack ID must look like `U...`).');
  }
  // Reject unrecognized role tokens rather than silently coercing to
  // 'user' — `add U01ABC tpyo` is almost certainly a mistake.
  let role: UserRole = 'user';
  if (roleArg !== undefined) {
    if (roleArg !== 'admin' && roleArg !== 'user') {
      return badArgs(`Unknown role \`${roleArg}\`. Use \`admin\` or omit for \`user\`.`);
    }
    role = roleArg;
  }
  const existing = userStore.getBySlackId(slackId);
  if (existing) {
    return badArgs(`User \`${slackId}\` already exists.`);
  }
  await userStore.create({ slackId, role });
  return [
    successBlock(
      `Added \`${slackId}\` with role *${role}*. ` +
        'Web login requires a separate invite via `/user-admin invite`.',
    ),
  ];
}

/**
 * Soft-deactivate, not hard-delete. The intent is reversible — an admin
 * can re-activate via the manage-users CLI later. Hard delete is only
 * available via `npm run manage-users delete-user` (with explicit
 * confirmation). This divergence is intentional: Slack slash commands
 * are too easy to mistype for irreversible operations.
 */
export function handleRemove(
  userStore: UserStore,
  args: string[],
): KnownBlock[] {
  const [slackId] = args;
  if (!slackId || !SLACK_ID_RE.test(slackId)) {
    return badArgs('Usage: `/user-admin remove <SlackID>`.');
  }
  const user = userStore.getBySlackId(slackId);
  if (!user) {
    return badArgs(`User \`${slackId}\` not found.`);
  }
  if (!user.isActive) {
    return [section(`User \`${slackId}\` is already deactivated.`)];
  }
  if (user.role === 'admin' && userStore.countByRole('admin') <= 1) {
    return badArgs(`Refusing to deactivate the last admin (\`${slackId}\`).`);
  }
  userStore.deactivate(user.id);
  return [successBlock(`Deactivated \`${slackId}\`.`)];
}

export function handlePromote(
  userStore: UserStore,
  args: string[],
): KnownBlock[] {
  const [slackId] = args;
  if (!slackId || !SLACK_ID_RE.test(slackId)) {
    return badArgs('Usage: `/user-admin promote <SlackID>`.');
  }
  const user = userStore.getBySlackId(slackId);
  if (!user) return badArgs(`User \`${slackId}\` not found.`);
  if (user.role === 'admin') {
    return [section(`User \`${slackId}\` is already admin.`)];
  }
  userStore.updateRole(user.id, 'admin');
  return [successBlock(`Promoted \`${slackId}\` to *admin*.`)];
}

export function handleDemote(
  userStore: UserStore,
  args: string[],
): KnownBlock[] {
  const [slackId] = args;
  if (!slackId || !SLACK_ID_RE.test(slackId)) {
    return badArgs('Usage: `/user-admin demote <SlackID>`.');
  }
  const user = userStore.getBySlackId(slackId);
  if (!user) return badArgs(`User \`${slackId}\` not found.`);
  if (user.role !== 'admin') {
    return [section(`User \`${slackId}\` is already a regular user.`)];
  }
  if (userStore.countByRole('admin') <= 1) {
    return badArgs(`Refusing to demote the last admin (\`${slackId}\`).`);
  }
  userStore.updateRole(user.id, 'user');
  return [successBlock(`Demoted \`${slackId}\` to *user*.`)];
}

const MAX_INVITE_TTL_HOURS = 24 * 365; // 1 year

/**
 * Parse `[admin] [ttl=72h]` style args. Returns a normalized struct.
 * Bare numbers are interpreted as hours. TTL is clamped to a sane upper
 * bound (1 year) so a typo can't produce a forever-valid invite.
 *
 * Last-write-wins for conflicting role tokens (`admin user` → `user`).
 * That's deterministic but probably surprising; keeping it simple here
 * since this CLI is invoked manually and the user can re-issue.
 */
function parseInviteArgs(args: string[]): { role: UserRole; ttlHours: number } {
  let role: UserRole = 'user';
  let ttlHours = 72;
  for (const raw of args) {
    if (raw === 'admin') {
      role = 'admin';
    } else if (raw === 'user') {
      role = 'user';
    } else {
      const m = /^ttl=(\d+)h?$/.exec(raw) ?? /^(\d+)h?$/.exec(raw);
      if (m?.[1]) {
        const n = parseInt(m[1], 10);
        if (Number.isInteger(n) && n > 0) {
          ttlHours = Math.min(n, MAX_INVITE_TTL_HOURS);
        }
      }
    }
  }
  return { role, ttlHours };
}

export function handleInvite(
  userStore: UserStore,
  inviteStore: InviteStore,
  requesterId: string,
  args: string[],
  baseUrl: string | undefined,
): KnownBlock[] {
  const requester = userStore.getBySlackId(requesterId);
  if (!requester) {
    // Edge: admin via env-var fallback (not yet seeded into users). They
    // can't author invites because the FK target doesn't exist; tell them
    // to bootstrap the table first.
    return badArgs('Your Slack ID is not in the users table — run bootstrap or `/user-admin add` first.');
  }
  const { role, ttlHours } = parseInviteArgs(args);
  const invite = inviteStore.createInvite(requester.id, { role, ttlHours });
  const expires = new Date(invite.expiresAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/register?invite=${invite.code}` : null;

  const lines = [
    `*Invite created* (role: *${role}*, expires: ${expires})`,
    `Code: \`${invite.code}\``,
    url ? `Link: ${url}` : '_Set `WEB_BASE_URL` to share a clickable registration URL._',
  ];
  return [section(lines.join('\n'))];
}

// ─── Dispatcher (pure) ────────────────────────────────────────────────

const ADMIN_SUBCOMMANDS = new Set(['add', 'remove', 'promote', 'demote', 'invite']);

export async function dispatchUserAdmin(
  rawText: string,
  cx: UserAdminContext,
  userStore: UserStore,
  inviteStore: InviteStore,
): Promise<KnownBlock[]> {
  const trimmed = rawText.trim();
  const [subcommand = '', ...rest] = trimmed.split(/\s+/).filter(Boolean);

  if (!subcommand || subcommand === 'help') {
    return [
      section(
        '*`/user-admin` subcommands*\n' +
          '• `list` — show all users (any user)\n' +
          '• `whoami` — show your user record (any user)\n' +
          '• `add <SlackID> [admin]` — admin only\n' +
          '• `remove <SlackID>` — admin only (soft-deactivate)\n' +
          '• `promote <SlackID>` — admin only\n' +
          '• `demote <SlackID>` — admin only\n' +
          '• `invite [admin] [ttl=72h]` — admin only',
      ),
    ];
  }

  if (ADMIN_SUBCOMMANDS.has(subcommand) && cx.requesterRole !== 'admin') {
    return permissionDenied();
  }

  switch (subcommand) {
    case 'list':
      return handleList(userStore);
    case 'whoami':
      return handleWhoami(userStore, cx.requesterId);
    case 'add':
      return await handleAdd(userStore, rest);
    case 'remove':
      return handleRemove(userStore, rest);
    case 'promote':
      return handlePromote(userStore, rest);
    case 'demote':
      return handleDemote(userStore, rest);
    case 'invite':
      return handleInvite(userStore, inviteStore, cx.requesterId, rest, cx.baseUrl);
    default:
      return badArgs(`Unknown subcommand \`${subcommand}\`. Try \`/user-admin help\`.`);
  }
}

// ─── Slack registration (impure) ──────────────────────────────────────

export function registerUserAdminCommand(app: App): void {
  app.command('/user-admin', async (args: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    const { command, ack, respond, context } = args;
    await ack();

    // Lazy-import config so test files that exercise dispatchUserAdmin
    // directly don't trip on env-var validation at module load time.
    const { config } = await import('../config/index.js');
    const dbPath = resolveUserStoreDbPath(config.claude?.dbPath);
    const userStore = getUserStore(dbPath);
    const inviteStore = getInviteStore(dbPath);
    const requesterRole = (context as { userRole?: UserRole }).userRole;

    try {
      const blocks = await dispatchUserAdmin(
        command.text,
        {
          requesterId: command.user_id,
          requesterRole,
          baseUrl: config.web?.baseUrl,
        },
        userStore,
        inviteStore,
      );
      await respond({ blocks, response_type: 'ephemeral' });
      logger.info('user-admin invoked', {
        userId: command.user_id,
        role: requesterRole,
        text: command.text,
      });
    } catch (err) {
      logger.error('user-admin command failed', {
        userId: command.user_id,
        text: command.text,
        error: err instanceof Error ? err.message : String(err),
      });
      await respond({
        blocks: [errorBlock('Command failed. Check the audit log for details.')],
        response_type: 'ephemeral',
      });
    }
  });
}
