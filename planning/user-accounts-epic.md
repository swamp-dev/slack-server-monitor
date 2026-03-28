# Epic: Username/Password Authentication for Web UI

## Context

The web UI currently requires either a Slack-generated HMAC link token or the raw `WEB_AUTH_TOKEN` (emergency admin) to log in. There's no way for regular users to access the web UI directly without Slack. Additionally, all authenticated users see all conversations regardless of ownership.

This epic adds username/password authentication with invite-code-gated registration, per-user conversation scoping, full admin CRUD in the web UI, and a separate CLI for user/invite management.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| User management CLI | Separate `npm run manage-users` | Keeps setup wizard focused on initial config |
| Admin web UI | Full CRUD | Admin can create/edit/delete users, generate invites from web |
| Web conversations | Web identity (`web:<username>`) | Web users own their own conversations; linked Slack IDs also visible |
| Password hashing | `crypto.scrypt` (Node built-in) | No new dependency needed |
| Registration gating | Single-use invite codes with expiry | Prevents abuse while remaining user-friendly |
| User ID namespace | `web:<username>` prefix | Prevents collision with Slack IDs (`U...`) |

---

## Phase 1: User Store

**New file:** `src/services/user-store.ts`

SQLite table in the existing `claude.db`:

```sql
CREATE TABLE IF NOT EXISTS web_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,       -- "hex(salt):hex(scrypt_key)"
  display_name TEXT,
  slack_user_id TEXT,                -- optional link to Slack identity
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_users_username ON web_users(username);
CREATE INDEX IF NOT EXISTS idx_web_users_slack_id ON web_users(slack_user_id);
```

### Password Hashing

- `crypto.scrypt` with 32-byte random salt, keylen=64
- Store as `hex(salt):hex(derivedKey)`
- Verify with timing-safe comparison
- All password operations are async (scrypt is callback-based, promisify it)

### Validation

- Username: 3-32 chars, `^[a-zA-Z][a-zA-Z0-9_-]*$`
- Password: minimum 8 characters

### Methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `createUser` | `(username, password, opts?) → Promise<WebUser>` | opts: displayName, slackUserId, isAdmin |
| `verifyPassword` | `(username, password) → Promise<WebUser \| null>` | Async, timing-safe |
| `getUser` | `(username) → WebUser \| null` | |
| `getUserBySlackId` | `(slackUserId) → WebUser \| null` | |
| `updateUser` | `(username, updates) → void` | displayName, slackUserId, isAdmin |
| `updatePassword` | `(username, newPassword) → Promise<void>` | Rehash with new salt |
| `deleteUser` | `(username) → void` | |
| `listUsers` | `() → WebUser[]` | |

Singleton pattern matching `session-store.ts` (`getUserStore(dbPath)`).

### Tests

**New file:** `tests/services/user-store.test.ts`

- Create user and verify fields
- Verify correct password returns user
- Verify wrong password returns null
- Duplicate username throws
- Case-insensitive username lookup
- Update user fields
- Delete user
- List users

---

## Phase 2: Invite Store

**New file:** `src/services/invite-store.ts`

```sql
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,             -- 32-char hex
  created_by TEXT NOT NULL,          -- userId of admin who created it
  is_admin INTEGER NOT NULL DEFAULT 0,
  slack_user_id TEXT,                -- optionally pre-link invitee to Slack ID
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT                       -- username who redeemed it
);
```

### Methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `createInvite` | `(createdBy, opts?) → InviteCode` | opts: isAdmin, slackUserId, ttlHours (default 72) |
| `redeemInvite` | `(code) → InviteCode \| null` | Atomic: UPDATE WHERE used_at IS NULL AND expires_at > now |
| `getInvite` | `(code) → InviteCode \| null` | |
| `listInvites` | `() → InviteCode[]` | All invites (used and unused) |
| `listActiveInvites` | `() → InviteCode[]` | Unused + not expired |
| `deleteInvite` | `(code) → void` | |
| `cleanupExpired` | `() → number` | Delete expired+used invites older than 7 days |

Code generation: `crypto.randomBytes(16).toString('hex')` (32 chars)

### Tests

**New file:** `tests/services/invite-store.test.ts`

- Create invite and verify fields
- Redeem valid invite succeeds
- Double-redeem returns null
- Expired invite returns null
- Cleanup removes old expired invites

---

## Phase 3: Auth Module Updates

**Modified file:** `src/web/auth.ts`

### New Functions

#### `resolveUserPassword(username, password, dbPath): Promise<TokenIdentity | null>`

- Calls `userStore.verifyPassword(username, password)`
- Returns `{ userId: 'web:<username>', isAdmin: user.isAdmin }` or `null`
- The `web:` prefix namespaces web users away from Slack IDs

#### `resolveUserIdentities(userId, dbPath): string[]`

Purpose: Given an authenticated userId, return all IDs whose conversations this user should see.

| Input | Behavior | Returns |
|-------|----------|---------|
| `web:alice` (linked to `U01ABC`) | Sees both identities | `['web:alice', 'U01ABC']` |
| `web:bob` (no Slack link) | Sees only web convos | `['web:bob']` |
| `admin` or `isAdmin=true` | Sees everything | `[]` (empty = no filter) |
| `U01ABC` (Slack session) | Sees own convos | `['U01ABC']` |

### Existing `resolveToken` — UNCHANGED

HMAC link tokens and static admin token continue working exactly as before.

### Tests

**Modified file:** `tests/web/auth.test.ts`

- `resolveUserPassword` with valid/invalid credentials
- `resolveUserIdentities` for all cases above

---

## Phase 4: Conversation Store Filtering

**Modified file:** `src/services/conversation-store.ts`

### Add `userId` parameter to all unfiltered query methods

| Method | Has userId? | Change |
|--------|-------------|--------|
| `listRecentSessions(limit, offset, userId?)` | Yes (string) | Extend to accept `string \| string[]` |
| `countSessions(userId?)` | Yes (string) | Extend to accept `string \| string[]` |
| `searchConversations(query, limit, offset)` | No | Add `userId?: string \| string[]` |
| `countSearchResults(query)` | No | Add `userId?: string \| string[]` |
| `listFavoriteSessions(limit, offset)` | No | Add `userId?: string \| string[]` |
| `countFavoriteSessions()` | No | Add `userId?: string \| string[]` |
| `listSessionsByTag(tag, limit, offset)` | No | Add `userId?: string \| string[]` |
| `countSessionsByTag(tag)` | No | Add `userId?: string \| string[]` |
| `listArchivedSessions(limit, offset)` | No | Add `userId?: string \| string[]` |
| `countArchivedSessions()` | No | Add `userId?: string \| string[]` |
| `listAllTags()` | No | Add `userId?: string \| string[]` |
| `getSessionStats(hours)` | No | Add `userId?: string \| string[]` |

### Implementation Pattern

Private helper to reduce duplication:

```typescript
private buildUserFilter(userId?: string | string[]): { clause: string; params: Record<string, unknown> } {
  if (!userId) return { clause: '', params: {} };
  if (typeof userId === 'string') {
    return { clause: 'AND c.user_id = $userId', params: { userId } };
  }
  // Array: AND c.user_id IN ($u0, $u1, ...)
  const params: Record<string, unknown> = {};
  const placeholders = userId.map((id, i) => {
    params[`u${i}`] = id;
    return `$u${i}`;
  });
  return { clause: `AND c.user_id IN (${placeholders.join(',')})`, params };
}
```

Each method appends the clause and spreads the params into its existing query.

### Tests

**Modified file:** `tests/services/conversation-store.test.ts`

- Query with no userId returns all
- Query with single userId filters correctly
- Query with array of userIds returns conversations from all listed IDs
- Empty array returns nothing (edge case)

---

## Phase 5: Web Templates

**Modified file:** `src/web/templates.ts`

### 5a: Login Page — Modify `renderLogin`

Replace single token field with tabbed interface:

- **Tab 1: "Username & Password"** (default active)
  - Username text input
  - Password input
  - Submit button
- **Tab 2: "Access Token"**
  - Existing password/token field (unchanged)
  - Submit button
- Link below form: "Don't have an account? Register" → `/register`
- Tab switching via vanilla JS (no framework)

### 5b: Registration Page — NEW `renderRegister(error?, inviteCode?, returnTo?)`

- Same Dracula theme as login
- Fields:
  - Invite code (pre-filled if `?code=` in URL)
  - Username (3-32 chars, alphanumeric + underscore + hyphen)
  - Password (min 8 chars)
  - Confirm password
  - Display name (optional)
- Client-side validation: passwords match, min length indicator
- Error display area (server-side validation errors)

### 5c: Admin User Management — NEW `renderAdminUsers(users[], invites[])`

Full CRUD page with two sections:

**Users section:**
- Table: username, display name, linked Slack ID, admin badge, created date
- Per-row actions: Edit, Delete (with confirmation)
- Edit form (inline or modal): display name, Slack ID, admin toggle, reset password
- Create user form at top

**Invites section:**
- Generate invite form: admin toggle, optional Slack ID pre-link, TTL selector
- Active invites table: code (copyable), created by, admin flag, expires, copy registration link, delete
- Show full registration URL: `{baseUrl}/register?code={code}`

### 5d: Navbar Update

- Show logged-in user: username for web users, Slack ID for token users, "Admin" for admin token
- "Users" link (admin only) → `/admin/users`
- "Logout" link

### 5e: 403 Page — NEW `render403()`

- "403 Forbidden" heading
- "You don't have permission to access this page"
- Link back to dashboard

---

## Phase 6: Web Server Routes

**Modified file:** `src/web/server.ts`

### New Public Routes (before auth middleware)

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/register` | Render registration form. If `WEB_REGISTRATION_ENABLED=false`, return 404. Accept `?code=` to pre-fill. |
| `POST` | `/register` | Validate invite code → redeem → create user → create session → redirect to `/` |

#### POST /register flow:
1. Rate limit check (5 per IP per 15 min)
2. Validate all fields (Zod schema)
3. Verify passwords match
4. `inviteStore.redeemInvite(code)` — atomic, returns null if invalid/used/expired
5. `userStore.createUser(username, password, { isAdmin: invite.isAdmin, slackUserId: invite.slackUserId })`
6. `sessionStore.createSession('web:<username>', isAdmin)`
7. Set cookie, redirect to `/`

### Modified: POST /login

Check for `username` field to determine auth mode:

```
if (body.username && body.password) → resolveUserPassword() (async)
else if (body.token) → resolveToken() (existing sync path)
```

Both paths create session identically. The userId for web users is `web:<username>`.

### Modified: All /c routes — User Filtering

Add a helper middleware or function:

```typescript
function getUserFilterIds(res: Response): string[] | undefined {
  if (res.locals.isAdmin) return undefined; // admin sees all
  // resolveUserIdentities looks up linked Slack ID if web user
  return resolveUserIdentities(res.locals.userId, dbPath);
}
```

Apply to every store call in every route:

- `GET /c` — `store.listRecentSessions(pageSize, offset, filterIds)`
- `GET /c/search` — `store.searchConversations(query, pageSize, offset, filterIds)`
- `GET /c/favorites` — `store.listFavoriteSessions(pageSize, offset, filterIds)`
- `GET /c/archived` — `store.listArchivedSessions(pageSize, offset, filterIds)`
- `GET /c/tag/:tag` — `store.listSessionsByTag(tag, pageSize, offset, filterIds)`
- `GET /` (dashboard) — filter stats, recent, favorites

### Modified: Conversation Detail — Ownership Check

`GET /c/:threadTs/:channelId`:
- Load conversation
- If not admin: verify `conversation.userId` is in user's identity set
- If not authorized: return 404 (don't leak existence)

Same ownership check for mutation endpoints: `POST /c/:id/favorite`, `POST /c/:id/tag`, `DELETE /c/:id/tag/:tag`, `POST /c/:id/archive`, `POST /c/:threadTs/:channelId/ask`

### New Admin Routes (behind auth middleware + admin guard)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/users` | Render user management page |
| `POST` | `/admin/users` | Create user (form submit) |
| `PUT` | `/admin/users/:username` | Update user (JSON) |
| `DELETE` | `/admin/users/:username` | Delete user (JSON) |
| `POST` | `/admin/users/:username/reset-password` | Reset password (JSON) |
| `POST` | `/admin/invites` | Generate invite code (form/JSON) |
| `DELETE` | `/admin/invites/:code` | Delete invite code (JSON) |

Admin guard middleware:
```typescript
function requireAdmin(req, res, next) {
  if (!res.locals.isAdmin) return res.status(403).send(render403());
  next();
}
app.use('/admin', requireAdmin);
```

### Auth Rate Limiting

In-memory map, separate from Slack command rate limiter:

```typescript
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
// 5 attempts per IP per 15 minutes
```

Apply to `POST /login` and `POST /register`.

---

## Phase 7: CLI for User Management

**New file:** `src/cli/manage-users.ts`

Uses `@clack/prompts` (already a dev dependency). Subcommands via first CLI argument:

| Command | Interactive Prompts | Action |
|---------|-------------------|--------|
| `create-user` | username, password (hidden), admin? | Create user in DB |
| `create-invite` | admin?, TTL hours, Slack ID? | Generate code, display it + registration URL |
| `list-users` | — | Table of all users |
| `list-invites` | — | Table of active invites |
| `link-slack` | username, Slack user ID | Link web user to Slack identity |
| `set-admin` | username, true/false | Toggle admin flag |
| `delete-user` | username, confirm | Delete user + their sessions |
| `reset-password` | username, new password (hidden) | Update password hash |

**Add to `package.json`:**
```json
"manage-users": "tsx src/cli/manage-users.ts"
```

### Tests

**New file:** `tests/cli/manage-users.test.ts`

- Test core functions (user creation, invite generation) directly
- Don't test interactive prompts

---

## Phase 8: Config Updates

### `src/config/schema.ts` — MODIFY

Add to WebConfigSchema:
```typescript
registrationEnabled: z.boolean().default(true),
```

### `src/config/index.ts` — MODIFY

Parse `WEB_REGISTRATION_ENABLED` env var into `web.registrationEnabled`

### `.env.example` — MODIFY

```bash
# Set to false to disable /register (invite codes can still be created, just can't be redeemed)
# WEB_REGISTRATION_ENABLED=true
```

---

## Implementation Order

```
1. src/services/user-store.ts + tests           (no deps)
2. src/services/invite-store.ts + tests          (no deps)
3. src/web/auth.ts updates + tests               (depends on 1)
4. src/services/conversation-store.ts + tests    (independent)
5. src/config/schema.ts + src/config/index.ts    (small, independent)
6. src/web/templates.ts                          (login, register, admin, navbar, 403)
7. src/web/server.ts                             (routes, filtering, rate limiting, admin)
8. src/cli/manage-users.ts + package.json        (depends on 1, 2)
9. .env.example + CLAUDE.md docs                 (last)
```

Steps 1, 2, and 4 can be done in parallel. Step 3 depends on 1. Steps 6-7 are the largest chunk. Step 8 is independent once stores exist.

---

## Files Summary

| File | Action | Size Estimate |
|------|--------|---------------|
| `src/services/user-store.ts` | NEW | ~200 lines |
| `src/services/invite-store.ts` | NEW | ~150 lines |
| `src/cli/manage-users.ts` | NEW | ~200 lines |
| `tests/services/user-store.test.ts` | NEW | ~150 lines |
| `tests/services/invite-store.test.ts` | NEW | ~100 lines |
| `tests/cli/manage-users.test.ts` | NEW | ~80 lines |
| `src/web/auth.ts` | MODIFY | +60 lines |
| `src/web/server.ts` | MODIFY | +200 lines |
| `src/web/templates.ts` | MODIFY | +400 lines |
| `src/services/conversation-store.ts` | MODIFY | +80 lines |
| `src/config/schema.ts` | MODIFY | +3 lines |
| `src/config/index.ts` | MODIFY | +3 lines |
| `package.json` | MODIFY | +1 line |
| `.env.example` | MODIFY | +3 lines |
| `CLAUDE.md` | MODIFY | +30 lines |
| `tests/web/auth.test.ts` | MODIFY | +50 lines |
| `tests/services/conversation-store.test.ts` | MODIFY | +60 lines |

---

## Verification

1. **Unit tests:** `npm test` — all new and existing tests pass
2. **Type check:** `npm run typecheck` — no errors
3. **Lint:** `npm run lint` — clean
4. **Manual flow:**
   - `npm run manage-users create-user` → create admin user
   - `npm run manage-users create-invite` → get invite code
   - Navigate to `/register?code=<code>` → create account
   - Login with username/password → lands on dashboard
   - Non-admin sees only their own conversations
   - Admin sees all conversations
   - Existing HMAC link tokens from Slack still work
   - Emergency admin token login still works
   - Admin panel: create/edit/delete users, generate/delete invites
   - Rate limiting: 6 failed logins → 429 response
   - Disabled registration: set `WEB_REGISTRATION_ENABLED=false` → `/register` returns 404

---

## Security Considerations

- **scrypt** with 32-byte salt prevents rainbow table attacks
- **Timing-safe comparison** on password verification prevents timing attacks
- **Invite codes are single-use** with expiry — leaked codes expire and can't be reused
- **Rate limiting** on login/register prevents brute force
- **`web:` namespace** prevents userId collision with Slack IDs
- **Ownership checks** return 404 (not 403) to prevent information leakage
- **Admin guard** on all `/admin` routes
- **No new dependencies** — `crypto.scrypt` is Node built-in
- **Backward compatible** — all existing auth methods continue working unchanged
