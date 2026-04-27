/**
 * `npm run manage-users` — interactive CLI for user/invite administration.
 *
 * Use cases:
 * - First-time bootstrap before Slack is connected (create the first admin).
 * - Generating an invite code to onboard a web user.
 * - Resetting a forgotten password.
 * - Promoting/demoting roles, linking a web user to a Slack identity.
 *
 * The interactive driver is `main()` at the bottom of the file. The pure
 * operations above (`createUserOp`, `setRoleOp`, etc.) are exported so
 * tests can exercise them without driving prompts.
 */
import * as p from '@clack/prompts';
import {
  type UserStore,
  getUserStore,
  closeUserStore,
  resolveUserStoreDbPath,
} from '../services/user-store.js';
import {
  type InviteStore,
  getInviteStore,
  closeInviteStore,
  type InviteCode,
} from '../services/invite-store.js';
import type { User, UserRole } from '../types/user.js';

// ─── Pure operations (testable) ───────────────────────────────────────

export interface CreateUserOpts {
  username: string;
  password: string;
  admin?: boolean;
}

export async function createUserOp(store: UserStore, opts: CreateUserOpts): Promise<User> {
  return await store.create({
    username: opts.username,
    password: opts.password,
    role: opts.admin ? 'admin' : 'user',
  });
}

export interface CreateInviteOpts {
  createdByUsername: string;
  role: UserRole;
  ttlHours: number;
  slackUserId?: string;
  baseUrl: string;
}

export function createInviteOp(
  inviteStore: InviteStore,
  userStore: UserStore,
  opts: CreateInviteOpts,
): { invite: InviteCode; url: string } {
  const creator = userStore.getByUsername(opts.createdByUsername);
  if (!creator) {
    throw new Error(`User '${opts.createdByUsername}' not found`);
  }
  const invite = inviteStore.createInvite(creator.id, {
    role: opts.role,
    ttlHours: opts.ttlHours,
    slackUserId: opts.slackUserId,
  });
  return { invite, url: buildInviteUrl(opts.baseUrl, invite.code) };
}

export function listUsersOp(store: UserStore): User[] {
  return store.listAll();
}

export function listInvitesOp(store: InviteStore): InviteCode[] {
  return store.listActive();
}

export function linkSlackOp(store: UserStore, username: string, slackId: string): void {
  const user = store.getByUsername(username);
  if (!user) throw new Error(`User '${username}' not found`);
  store.updateProfile(user.id, { slackId });
}

/**
 * Change a user's role. The store enforces last-admin protection
 * atomically so a concurrent demotion can't strand the system.
 */
export function setRoleOp(store: UserStore, username: string, role: UserRole): void {
  const user = store.getByUsername(username);
  if (!user) throw new Error(`User '${username}' not found`);
  if (role === 'admin') {
    store.updateRole(user.id, role);
    return;
  }
  if (!store.demoteIfNotLastAdmin(user.id, 'user')) {
    throw new Error(`Refusing to demote the last admin ('${username}')`);
  }
}

/**
 * Delete a user. The store enforces last-admin protection atomically.
 *
 * Note: web sessions for the deleted user are not explicitly purged
 * here — sessions for a non-existent user fail authorization on the
 * next request via `resolveTokenWithRole` because their slack_id no
 * longer resolves. A future ticket can add explicit session purge.
 */
export function deleteUserOp(store: UserStore, username: string): void {
  const user = store.getByUsername(username);
  if (!user) throw new Error(`User '${username}' not found`);
  if (!store.deleteIfNotLastAdmin(user.id)) {
    throw new Error(`Refusing to delete the last admin ('${username}')`);
  }
}

export async function resetPasswordOp(
  store: UserStore,
  username: string,
  newPassword: string,
): Promise<void> {
  const user = store.getByUsername(username);
  if (!user) throw new Error(`User '${username}' not found`);
  await store.updatePassword(user.id, newPassword);
}

/**
 * Build a registration URL from a base URL and an invite code. Uses
 * `URL` so query strings, ports, and existing paths in the base are
 * preserved, and we don't produce `//register` from a trailing slash.
 *
 * `code` is set via `searchParams.set` (URL-encoded). `baseUrl` is
 * trimmed of leading/trailing whitespace; everything else is left to
 * the standard URL parser.
 */
export function buildInviteUrl(baseUrl: string, code: string): string {
  const url = new URL('/register', baseUrl.trim());
  url.searchParams.set('invite', code);
  return url.toString();
}

// ─── Interactive driver ───────────────────────────────────────────────

const COMMANDS = [
  'create-user',
  'create-invite',
  'list-users',
  'list-invites',
  'link-slack',
  'set-role',
  'delete-user',
  'reset-password',
] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(s: string): s is Command {
  return (COMMANDS as readonly string[]).includes(s);
}

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function printUsage(): void {
  console.error(`Usage: npm run manage-users -- <command>

Commands:
  ${COMMANDS.join('\n  ')}
`);
}

async function runCreateUser(userStore: UserStore): Promise<void> {
  const username = await p.text({ message: 'Username', validate: (v) => (v ? undefined : 'required') });
  if (p.isCancel(username)) return;
  const password = await p.password({ message: 'Password (min 8 chars)', validate: (v) => (v && v.length >= 8 ? undefined : 'min 8 chars') });
  if (p.isCancel(password)) return;
  const admin = await p.confirm({ message: 'Make this user an admin?', initialValue: false });
  if (p.isCancel(admin)) return;

  const user = await createUserOp(userStore, { username, password, admin });
  p.note(`Created user #${String(user.id)} (${user.username ?? '<no-username>'}) — role=${user.role}`, 'Done');
}

async function runCreateInvite(userStore: UserStore, inviteStore: InviteStore, baseUrl: string): Promise<void> {
  const createdByUsername = await p.text({ message: 'Admin username creating this invite' });
  if (p.isCancel(createdByUsername)) return;
  const role = await p.select<UserRole>({
    message: 'Role for new user',
    options: [
      { value: 'user', label: 'user' },
      { value: 'admin', label: 'admin' },
    ],
    initialValue: 'user',
  });
  if (p.isCancel(role)) return;
  const ttlHoursStr = await p.text({
    message: 'TTL in hours',
    placeholder: '72',
    initialValue: '72',
    validate: (v) => {
      const n = parseInt(v ?? '', 10);
      return Number.isInteger(n) && n > 0 ? undefined : 'must be a positive integer';
    },
  });
  if (p.isCancel(ttlHoursStr)) return;
  const slackUserIdRaw = await p.text({ message: 'Slack user ID to pre-link (optional, e.g. U01ABC)', placeholder: '' });
  if (p.isCancel(slackUserIdRaw)) return;

  const slackUserId = slackUserIdRaw.trim() || undefined;
  const result = createInviteOp(inviteStore, userStore, {
    createdByUsername,
    role,
    ttlHours: parseInt(ttlHoursStr, 10),
    slackUserId,
    baseUrl,
  });
  p.note(`Code: ${result.invite.code}\nURL:  ${result.url}\nExpires: ${fmtTime(result.invite.expiresAt)}`, 'Invite created');
}

function runListUsers(userStore: UserStore): void {
  const users = listUsersOp(userStore);
  if (users.length === 0) {
    p.note('No users yet.', 'Users');
    return;
  }
  const lines = users.map(
    (u) => `  #${String(u.id).padStart(3)}  ${(u.username ?? '<no-username>').padEnd(20)}  ${u.role.padEnd(5)}  ${u.isActive ? 'active  ' : 'inactive'}  ${u.slackId ?? ''}`,
  );
  p.note(lines.join('\n'), `Users (${String(users.length)})`);
}

function runListInvites(inviteStore: InviteStore): void {
  const invites = listInvitesOp(inviteStore);
  if (invites.length === 0) {
    p.note('No active invites.', 'Invites');
    return;
  }
  const lines = invites.map(
    (i) => `  ${i.code}  role=${i.role.padEnd(5)}  by=${String(i.createdBy).padStart(3)}  expires=${fmtTime(i.expiresAt)}${i.slackUserId ? `  slack=${i.slackUserId}` : ''}`,
  );
  p.note(lines.join('\n'), `Active invites (${String(invites.length)})`);
}

async function runLinkSlack(userStore: UserStore): Promise<void> {
  const username = await p.text({ message: 'Web username' });
  if (p.isCancel(username)) return;
  const slackId = await p.text({ message: 'Slack user ID (e.g. U01ABC)' });
  if (p.isCancel(slackId)) return;
  linkSlackOp(userStore, username, slackId);
  p.note(`Linked ${username} → ${slackId}`, 'Done');
}

async function runSetRole(userStore: UserStore): Promise<void> {
  const username = await p.text({ message: 'Username' });
  if (p.isCancel(username)) return;
  const role = await p.select<UserRole>({
    message: 'New role',
    options: [
      { value: 'user', label: 'user' },
      { value: 'admin', label: 'admin' },
    ],
  });
  if (p.isCancel(role)) return;
  setRoleOp(userStore, username, role);
  p.note(`Updated role for ${username} → ${role}`, 'Done');
}

async function runDeleteUser(userStore: UserStore): Promise<void> {
  const username = await p.text({ message: 'Username to delete' });
  if (p.isCancel(username)) return;
  const confirm = await p.confirm({
    message: `Really delete '${username}'? This cannot be undone.`,
    initialValue: false,
  });
  if (p.isCancel(confirm)) return;
  if (!confirm) {
    p.note('Aborted.', 'Cancelled');
    return;
  }
  deleteUserOp(userStore, username);
  p.note(`Deleted ${username}.`, 'Done');
}

async function runResetPassword(userStore: UserStore): Promise<void> {
  const username = await p.text({ message: 'Username' });
  if (p.isCancel(username)) return;
  const password = await p.password({ message: 'New password (min 8 chars)', validate: (v) => (v && v.length >= 8 ? undefined : 'min 8 chars') });
  if (p.isCancel(password)) return;
  await resetPasswordOp(userStore, username, password);
  p.note(`Password updated for ${username}.`, 'Done');
}

async function dispatch(
  command: Command,
  userStore: UserStore,
  inviteStore: InviteStore,
  baseUrl: string,
): Promise<void> {
  switch (command) {
    case 'create-user':
      await runCreateUser(userStore);
      return;
    case 'create-invite':
      await runCreateInvite(userStore, inviteStore, baseUrl);
      return;
    case 'list-users':
      runListUsers(userStore);
      return;
    case 'list-invites':
      runListInvites(inviteStore);
      return;
    case 'link-slack':
      await runLinkSlack(userStore);
      return;
    case 'set-role':
      await runSetRole(userStore);
      return;
    case 'delete-user':
      await runDeleteUser(userStore);
      return;
    case 'reset-password':
      await runResetPassword(userStore);
      return;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !isCommand(command)) {
    printUsage();
    process.exit(1);
  }

  // Lazy import so the test suite (which imports the pure ops) doesn't
  // trip on env-var validation when Slack tokens etc. aren't set.
  const { config } = await import('../config/index.js');
  const dbPath = resolveUserStoreDbPath(config.claude?.dbPath);
  const baseUrl = config.web?.baseUrl ?? 'http://localhost:8080';
  const userStore = getUserStore(dbPath);
  const inviteStore = getInviteStore(dbPath);

  try {
    p.intro(`manage-users · ${command}`);
    await dispatch(command, userStore, inviteStore, baseUrl);
    p.outro('Done.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.cancel(msg);
    process.exitCode = 1;
  } finally {
    closeInviteStore();
    closeUserStore();
  }
}

// Only run main when invoked directly (not when imported by tests).
// Note: this comparison assumes POSIX-style paths; Windows isn't a target
// platform for this project, so backslash → file:// translation isn't
// handled here.
const invokedDirectly = (() => {
  try {
    return import.meta.url === `file://${process.argv[1] ?? ''}`;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main();
}
