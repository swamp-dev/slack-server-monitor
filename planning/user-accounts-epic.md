# Epic: User Accounts with Slack ID Linkage

## Context

The current auth model relies on a static env-var whitelist (`AUTHORIZED_USER_IDS`) with no persistent user records. Web sessions carry a simple `is_admin` boolean with no real identity model. There's no way to add/remove users without restarting the app, no per-user conversation scoping, and no standalone web login.

This epic introduces a `users` table as the single source of truth for identity, connected to Slack IDs. It adds two web login paths (Slack link tokens and username/password with invite codes), per-user conversation filtering, and admin tooling for managing users at runtime.

**Design principle**: Use a text `role` column (not boolean `is_admin`) so future tickets can introduce granular permissions without schema changes.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Identity model | Slack ID is primary, web credentials optional | Bot is Slack-first; web is secondary interface |
| Role storage | `role TEXT CHECK(role IN ('admin','user'))` | Extensible -- add roles later via ALTER CHECK |
| Web user namespace | `web:<username>` prefix on userId | Prevents collision with Slack IDs (`U...`) |
| Password hashing | `crypto.scrypt` (Node built-in) | No new dependency |
| Registration gating | Single-use invite codes with expiry | Prevents abuse while remaining user-friendly |
| Conversation scoping | Non-admins see only own conversations | Admin sees all; linked Slack+web IDs merged |
| User management | Slack command + web admin + CLI | Three surfaces for flexibility |

---

## Dependency Graph

```
Ticket 1 (users table + UserStore)
  ├──> Ticket 2 (bootstrap + migrate Slack auth)
  │      ├──> Ticket 5 (/user-admin Slack command)
  │      └──> Ticket 8 (deprecate env-var-only auth)
  ├──> Ticket 3 (invite store + web credentials)
  │      └──> Ticket 6 (web registration + login routes)
  ├──> Ticket 4 (web sessions use user accounts)
  │      ├──> Ticket 6
  │      └──> Ticket 7 (admin web UI)
  └──> Ticket 9 (conversation scoping)
```

Parallelizable: 2+3+4 after 1. Then 5+6+7 after their deps. 8+9 are final.

---

## Ticket 1: `users` table and `UserStore` service

**Summary**: Create the foundational data layer for user accounts.

### Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_id TEXT UNIQUE,                -- NULL if web-only user
  username TEXT UNIQUE COLLATE NOCASE, -- NULL if Slack-only user
  password_hash TEXT,                  -- "hex(salt):hex(scrypt_key)", NULL if Slack-only
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slack_id ON users(slack_id) WHERE slack_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;
```

### Password Hashing

- `crypto.scrypt` with 32-byte random salt, keylen=64
- Store as `hex(salt):hex(derivedKey)`
- Timing-safe comparison on verify
- All password ops are async (promisified scrypt)

### Validation (Zod)

- `UserRoleSchema = z.enum(['admin', 'user'])`
- Username: 3-32 chars, `^[a-zA-Z][a-zA-Z0-9_-]*$`
- Password: minimum 8 characters
- Slack ID: `^U[A-Z0-9]+$`

### Methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `create` | `(opts: CreateUserInput) → Promise<User>` | At least one of slack_id or username required |
| `getById` | `(id: number) → User \| null` | |
| `getBySlackId` | `(slackId: string) → User \| null` | |
| `getByUsername` | `(username: string) → User \| null` | Case-insensitive |
| `verifyPassword` | `(username: string, password: string) → Promise<User \| null>` | Timing-safe |
| `updateRole` | `(id: number, role: string) → void` | |
| `updateProfile` | `(id: number, updates) → void` | display_name, slack_id, username |
| `updatePassword` | `(id: number, newPassword: string) → Promise<void>` | Rehash with new salt |
| `deactivate` | `(id: number) → void` | Soft delete |
| `activate` | `(id: number) → void` | |
| `listAll` | `() → User[]` | |
| `countByRole` | `(role: string) → number` | For last-admin protection |
| `resolveIdentities` | `(userId: string) → string[]` | See below |

### `resolveIdentities(userId)`

Given a session userId, returns all IDs whose conversations the user can see:

| Input | Returns |
|-------|---------|
| `web:alice` (linked to `U01ABC`) | `['web:alice', 'U01ABC']` |
| `web:bob` (no Slack link) | `['web:bob']` |
| `U01ABC` (Slack session, linked to `web:alice`) | `['U01ABC', 'web:alice']` |
| Admin user | `undefined` (no filter = see all) |

### Files

- `src/services/user-store.ts` (new)
- `src/types/user.ts` (new)
- `tests/services/user-store.test.ts` (new)

### Acceptance Criteria

- [ ] Table created on startup via `initSchema()`
- [ ] All CRUD methods work with SQLite
- [ ] Password hash/verify is timing-safe
- [ ] Zod validation on all inputs
- [ ] `resolveIdentities` handles all cases
- [ ] Tests for: create, get by slack/username, verify password (correct + wrong), duplicate handling, case-insensitive username, deactivate/activate, list, role update

### Dependencies

None

---

## Ticket 2: Bootstrap users from env var + migrate Slack auth

**Summary**: Seed `users` table from `AUTHORIZED_USER_IDS` on first startup, then make the `users` table the primary auth source for Slack commands.

### Bootstrap Logic

1. If `users` table empty AND `AUTHORIZED_USER_IDS` is set: insert all IDs as Slack-only users. First ID becomes `admin`, rest become `user`.
2. If table populated: no-op (idempotent).
3. Best-effort Slack API call to resolve display names.

### Authorize Middleware Changes

**Current** (`src/middleware/authorize.ts`): checks `config.authorization.userIds.includes(userId)`.

**New**:
1. Primary: `userStore.getBySlackId(userId)` -- allow if found + `is_active`
2. Fallback: `config.authorization.userIds.includes(userId)` with deprecation warning log
3. Attach `user.role` to Bolt `args.context` for downstream handlers
4. Relax `authorization.userIds` schema from `.min(1)` to allow empty array

### Files

- `src/services/user-store.ts` (add `bootstrap` method)
- `src/middleware/authorize.ts` (DB lookup + role on context)
- `src/config/schema.ts` (relax userIds constraint)
- `src/app.ts` (wire bootstrap + UserStore)
- `tests/middleware/authorize.test.ts` (update)

### Acceptance Criteria

- [ ] Fresh install with `AUTHORIZED_USER_IDS=U111,U222` creates 2 rows, U111 is admin
- [ ] Re-running bootstrap on populated table is no-op
- [ ] User in `users` table can execute commands even if not in env var
- [ ] Deactivated user (`is_active=0`) is rejected even if in env var
- [ ] Env-var fallback works with deprecation warning
- [ ] `args.context.userRole` available to command handlers

### Dependencies

Ticket 1

---

## Ticket 3: Invite store + web credentials on user accounts

**Summary**: Add invite code infrastructure and the ability for users to have username/password credentials linked to their account.

### Invite Schema

```sql
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,             -- 32-char hex
  created_by INTEGER NOT NULL,       -- user.id of admin who created it
  role TEXT NOT NULL DEFAULT 'user',
  slack_user_id TEXT,                -- optionally pre-link invitee to Slack ID
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by INTEGER                    -- user.id who redeemed it
);
```

### Methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `createInvite` | `(createdBy, opts?) → InviteCode` | opts: role, slackUserId, ttlHours (default 72) |
| `redeemInvite` | `(code) → InviteCode \| null` | Atomic: UPDATE WHERE used_at IS NULL AND expires_at > now |
| `getInvite` | `(code) → InviteCode \| null` | |
| `listActive` | `() → InviteCode[]` | Unused + not expired |
| `listAll` | `() → InviteCode[]` | |
| `deleteInvite` | `(code) → void` | |
| `cleanupExpired` | `() → number` | Delete expired+used invites older than 7 days |

Code generation: `crypto.randomBytes(16).toString('hex')`

### Files

- `src/services/invite-store.ts` (new)
- `tests/services/invite-store.test.ts` (new)

### Acceptance Criteria

- [ ] Create invite with code, expiry, and role
- [ ] Redeem valid invite succeeds (atomic)
- [ ] Double-redeem returns null
- [ ] Expired invite returns null
- [ ] Cleanup removes old expired invites
- [ ] Pre-linked Slack ID carried through to user creation

### Dependencies

Ticket 1

---

## Ticket 4: Web sessions reference user accounts

**Summary**: Derive session permissions from the `users` table instead of hardcoding from token type.

### Changes

- `SessionStore.createSession` accepts user ID and looks up role from `UserStore`
- HMAC link token login: resolve user from DB, create session with actual role
- Static admin token: still grants admin (emergency access)
- If Slack user in token not in `users` table: auto-create as `user` role with warning log

### Auth Module Updates (`src/web/auth.ts`)

New function: `resolveUserPassword(username, password) → Promise<TokenIdentity | null>`
- Calls `userStore.verifyPassword(username, password)`
- Returns `{ userId: 'web:<username>', isAdmin: user.role === 'admin' }`

### Files

- `src/services/session-store.ts`
- `src/web/auth.ts` (add `resolveUserPassword`)
- `src/web/server.ts` (login flow)
- `tests/services/session-store.test.ts`
- `tests/web/auth.test.ts`

### Acceptance Criteria

- [ ] Admin user via HMAC link token gets `isAdmin: true` session
- [ ] Regular user via HMAC link token gets `isAdmin: false`
- [ ] Static admin token still works
- [ ] `resolveUserPassword` returns correct identity for valid credentials
- [ ] `resolveUserPassword` returns null for invalid credentials (timing-safe)

### Dependencies

Ticket 1

---

## Ticket 5: `/user-admin` Slack command

**Summary**: Admin user management from Slack.

### Subcommands

| Subcommand | Access | Description |
|------------|--------|-------------|
| `list` | Any user | Show all users with roles and active status |
| `whoami` | Any user | Show own user record |
| `add <SlackID> [admin]` | Admin | Add new Slack-only user |
| `remove <SlackID>` | Admin | Soft-deactivate user |
| `promote <SlackID>` | Admin | Set role to admin |
| `demote <SlackID>` | Admin | Set role to user |
| `invite [admin] [ttl=72h]` | Admin | Generate invite code, post to DM |

### Guards

- Admin-only for mutations (check `args.context.userRole`)
- Last-admin protection: cannot demote/remove if `countByRole('admin') === 1`
- Slack ID format validation

### Files

- `src/commands/user-admin.ts` (new)
- `src/commands/index.ts` (register)
- `tests/commands/user-admin.test.ts` (new)

### Acceptance Criteria

- [ ] Admin can list, add, remove, promote, demote, generate invites
- [ ] Non-admin gets "Permission denied" for mutations
- [ ] Non-admin can run `whoami` and `list`
- [ ] Cannot demote/remove last admin
- [ ] Block Kit formatted output

### Dependencies

Tickets 1, 2, 3

---

## Ticket 6: Web registration + username/password login

**Summary**: Add `/register` page (invite-gated) and username/password login tab.

### Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/register` | Public | Registration form (404 if disabled) |
| `POST` | `/register` | Public | Redeem invite, create user, start session |
| `POST` | `/login` | Public | Extended: username/password OR token |

### POST /register Flow

1. Rate limit (5 per IP per 15 min)
2. Validate fields (Zod)
3. Verify passwords match
4. `inviteStore.redeemInvite(code)` -- atomic
5. `userStore.create({ username, password, role: invite.role, slackUserId: invite.slackUserId })`
6. `sessionStore.createSession('web:<username>', isAdmin)`
7. Set cookie, redirect to `/`

### POST /login Changes

Detect auth mode from request body:
- `body.username + body.password` → `resolveUserPassword()` (async)
- `body.token` → `resolveToken()` (existing)

### Login Page Changes

Replace single token field with tabbed UI:
- **Tab 1**: Username + Password (default)
- **Tab 2**: Access Token (existing)
- Registration link: "Don't have an account? Register"

### Config

- `WEB_REGISTRATION_ENABLED` (default: `true`) → `web.registrationEnabled`

### Files

- `src/web/server.ts` (routes)
- `src/web/templates/login.ts` (new or modify existing login rendering)
- `src/web/templates/register.ts` (new)
- `src/config/schema.ts` (+registrationEnabled)
- `src/config/index.ts`
- `.env.example`

### Acceptance Criteria

- [ ] Register with valid invite code creates account and logs in
- [ ] Invalid/expired/used invite code shows error
- [ ] Login with username/password works
- [ ] Login with token still works
- [ ] Rate limiting on login + register (5/15min per IP)
- [ ] `WEB_REGISTRATION_ENABLED=false` returns 404 on `/register`

### Dependencies

Tickets 1, 3, 4

---

## Ticket 7: Admin user management web page

**Summary**: `/admin/users` page for managing accounts and invites in the web UI.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users` | User list + invite management |
| `POST` | `/admin/users` | Create user (form) |
| `PUT` | `/admin/users/:id` | Update user (JSON) |
| `POST` | `/admin/users/:id/toggle-active` | Activate/deactivate |
| `POST` | `/admin/users/:id/reset-password` | Reset password |
| `POST` | `/admin/invites` | Generate invite code |
| `DELETE` | `/admin/invites/:code` | Delete invite |

### Page Layout

**Users section:**
- Table: username, display name, Slack ID, role badge, active status, created date
- Per-row actions: edit, deactivate, reset password
- Create user form

**Invites section:**
- Generate invite form: role, TTL, optional Slack ID pre-link
- Active invites table: code (copyable), created by, role, expires, registration URL, delete

### Guards

- Admin-only middleware on `/admin/*` (403 for non-admins)
- Last-admin protection on demote/deactivate
- Admin nav link visible only to admins in shell template

### Files

- `src/web/templates/admin-users.ts` (new)
- `src/web/templates/index.ts` (export)
- `src/web/templates/shell.ts` (admin nav link)
- `src/web/templates/errors.ts` (403 page)
- `src/web/server.ts` (routes + admin guard middleware)

### Acceptance Criteria

- [ ] Admin sees user list at `/admin/users`
- [ ] Non-admin gets 403
- [ ] CRUD operations work from web UI
- [ ] Invite generation shows copyable registration URL
- [ ] Last-admin protection
- [ ] Consistent Dracula theme styling

### Dependencies

Tickets 1, 3, 4

---

## Ticket 8: Deprecate `AUTHORIZED_USER_IDS` as sole auth source

**Summary**: Make env var fully optional once users table is populated. Clean up the fallback.

### Changes

- `authorization.userIds` defaults to `[]`
- Remove env-var fallback from authorize middleware (DB is sole source of truth)
- Startup validation:
  - Users table populated + env var set → INFO: "User accounts active. AUTHORIZED_USER_IDS can be removed."
  - Users table empty + env var set → normal bootstrap (Ticket 2)
  - Both empty → ERROR, fail startup with clear message

### Files

- `src/config/schema.ts`
- `src/config/index.ts`
- `src/middleware/authorize.ts` (remove fallback)
- `src/app.ts` (startup validation)
- `docs/configuration.md` (migration guide)

### Acceptance Criteria

- [ ] App starts without `AUTHORIZED_USER_IDS` if users table populated
- [ ] App fails with clear error if both empty
- [ ] No regression for existing deployments with env var set
- [ ] Docs updated with migration path

### Dependencies

Tickets 1, 2 (must be deployed first)

---

## Ticket 9: Per-user conversation scoping

**Summary**: Non-admin users see only their own conversations in the web UI. Admin sees all.

### Conversation Store Changes

Add `userId?: string | string[]` parameter to all list/count/search methods:

| Method | Change |
|--------|--------|
| `listRecentSessions` | Add userId filter |
| `countSessions` | Add userId filter |
| `searchConversations` | Add userId filter |
| `countSearchResults` | Add userId filter |
| `listFavoriteSessions` | Add userId filter |
| `countFavoriteSessions` | Add userId filter |
| `listSessionsByTag` | Add userId filter |
| `countSessionsByTag` | Add userId filter |
| `listArchivedSessions` | Add userId filter |
| `countArchivedSessions` | Add userId filter |
| `listAllTags` | Add userId filter |
| `getSessionStats` | Add userId filter |

### Implementation

Private helper to reduce duplication:

```typescript
private buildUserFilter(userId?: string | string[]): { clause: string; params: Record<string, unknown> } {
  if (!userId) return { clause: '', params: {} };
  if (typeof userId === 'string') {
    return { clause: 'AND c.user_id = $userId', params: { userId } };
  }
  const params: Record<string, unknown> = {};
  const placeholders = userId.map((id, i) => { params[`u${i}`] = id; return `$u${i}`; });
  return { clause: `AND c.user_id IN (${placeholders.join(',')})`, params };
}
```

### Web Server Integration

Helper middleware:
```typescript
function getUserFilterIds(res: Response): string[] | undefined {
  if (res.locals.isAdmin) return undefined; // admin sees all
  return userStore.resolveIdentities(res.locals.userId);
}
```

Apply to all `/c` routes + dashboard.

### Conversation Detail Ownership

- Non-admin accessing a conversation they don't own → 404 (don't leak existence)
- Same check on mutation endpoints (favorite, tag, archive, ask)

### Files

- `src/services/conversation-store.ts` (add filtering)
- `src/web/server.ts` (apply filters to all routes)
- `tests/services/conversation-store.test.ts` (filter tests)

### Acceptance Criteria

- [ ] Non-admin sees only own conversations
- [ ] Admin sees all conversations
- [ ] Linked Slack+web identities see conversations from both
- [ ] Accessing someone else's conversation returns 404
- [ ] Search, favorites, tags, archives all respect scoping
- [ ] Dashboard stats scoped to user

### Dependencies

Tickets 1, 4

---

## Ticket 10: CLI for user management

**Summary**: `npm run manage-users` CLI for bootstrapping and managing users outside of Slack/web.

### Commands

| Command | Prompts | Action |
|---------|---------|--------|
| `create-user` | username, password, admin? | Create user in DB |
| `create-invite` | role, TTL, Slack ID? | Generate code + registration URL |
| `list-users` | -- | Table of all users |
| `list-invites` | -- | Table of active invites |
| `link-slack` | username, Slack ID | Link web user to Slack identity |
| `set-role` | username, role | Change user role |
| `delete-user` | username, confirm | Delete user + sessions |
| `reset-password` | username, new password | Update password hash |

Uses `@clack/prompts` for interactive input.

### Files

- `src/cli/manage-users.ts` (new)
- `package.json` (add script)
- `tests/cli/manage-users.test.ts` (new -- test core functions, not interactive prompts)

### Acceptance Criteria

- [ ] All commands work against SQLite DB
- [ ] Interactive prompts for required fields
- [ ] Can be used for initial setup before Slack is connected
- [ ] Last-admin protection on role change and delete

### Dependencies

Tickets 1, 3

---

## Implementation Order

```
Phase 1 (parallel):
  Ticket 1 - users table + UserStore

Phase 2 (parallel after 1):
  Ticket 2 - bootstrap + Slack auth migration
  Ticket 3 - invite store
  Ticket 4 - web sessions

Phase 3 (parallel after deps):
  Ticket 5 - /user-admin Slack command (after 2, 3)
  Ticket 6 - web registration + login (after 3, 4)
  Ticket 7 - admin web UI (after 3, 4)
  Ticket 9 - conversation scoping (after 4)
  Ticket 10 - CLI (after 3)

Phase 4 (last):
  Ticket 8 - deprecate env var
```

---

## Files Summary

| File | Action | Ticket |
|------|--------|--------|
| `src/services/user-store.ts` | NEW | 1 |
| `src/types/user.ts` | NEW | 1 |
| `src/services/invite-store.ts` | NEW | 3 |
| `src/commands/user-admin.ts` | NEW | 5 |
| `src/web/templates/register.ts` | NEW | 6 |
| `src/web/templates/admin-users.ts` | NEW | 7 |
| `src/cli/manage-users.ts` | NEW | 10 |
| `src/middleware/authorize.ts` | MODIFY | 2, 8 |
| `src/services/session-store.ts` | MODIFY | 4 |
| `src/services/conversation-store.ts` | MODIFY | 9 |
| `src/web/auth.ts` | MODIFY | 4 |
| `src/web/server.ts` | MODIFY | 4, 6, 7, 9 |
| `src/web/templates/shell.ts` | MODIFY | 7 |
| `src/web/templates/errors.ts` | MODIFY | 7 |
| `src/config/schema.ts` | MODIFY | 2, 6, 8 |
| `src/config/index.ts` | MODIFY | 6, 8 |
| `src/app.ts` | MODIFY | 2, 8 |
| `src/commands/index.ts` | MODIFY | 5 |

---

## Security Considerations

- `crypto.scrypt` with 32-byte salt prevents rainbow tables
- Timing-safe comparison on password verification
- Invite codes are single-use with expiry
- Rate limiting on login/register (5/15min per IP)
- `web:` namespace prevents userId collision with Slack IDs
- Ownership checks return 404 (not 403) to prevent info leakage
- Admin guard on all `/admin/*` routes
- No new dependencies -- `crypto.scrypt` is Node built-in
- Backward compatible -- all existing auth methods continue working
