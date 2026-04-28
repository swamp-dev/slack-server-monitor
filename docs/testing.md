# Testing

This project uses [Vitest](https://vitest.dev) with a real-DB integration
strategy: `better-sqlite3` runs against per-test temp files (or `:memory:`)
rather than mocked drivers. Plugins ship colocated tests; core tests live in
`tests/` mirroring `src/`.

## Running tests

```bash
npm test                  # full suite
npm run test:coverage     # full suite + v8 coverage report
npm run test:smoke        # smoke tests only (tests/smoke/)
npm run test:e2e          # Playwright end-to-end (separate runner)
```

Coverage output lands in `coverage/` (HTML at `coverage/index.html`,
machine-readable at `coverage/lcov.info`). The repo does **not** enforce a
coverage threshold in CI — focus is on critical-path coverage, not a number.

## Auth-feature coverage snapshot

Captured 2026-04-27 against `main` at commit `35ba69f`. Re-run
`npm run test:coverage` and update this table when auth code changes
materially.

| File | Lines | Branches | Functions | Notes |
|------|------:|---------:|----------:|-------|
| `src/middleware/authorize.ts` | **100%** | 93.75% | 100% | One uncovered branch is the storage-failure log path; behavior is covered by the `fail-closed` tests asserting rejection, just not the inner log assertion. |
| `src/services/auth-rate-limit.ts` | **100%** | **100%** | **100%** | Fully covered. |
| `src/services/session-store.ts` | 97.06% | 91.67% | **100%** | Single uncovered line is the singleton-already-initialized fast path. |
| `src/services/invite-store.ts` | 96.15% | 80.00% | **100%** | Two uncovered branches are defensive `if (!row) return null` after queries that the schema makes unreachable in the current code paths. Acceptable. |
| `src/web/auth.ts` | 94.03% | 90.91% | **100%** | Uncovered: the cookie-clearing branch when `req.cookies` is undefined (Express middleware always populates it before this runs in practice). |
| `src/services/user-store.ts` | 93.98% | 81.18% | 96.67% | Uncovered lines are the `getDatabase()` accessor (used only by tests/migrations) and a few defensive branches in `bootstrap()` for malformed env input. The `bootstrap()` validation path itself is exercised. |
| `src/web/server.ts` (auth routes) | 87.35% (whole file) | 74.09% | 87.65% | Whole-file number; auth routes specifically — `/login`, `/register`, `/logout`, `/admin/users*`, `/admin/invites*` (lines 279–732) — are exercised by `tests/web/register.test.ts`, `tests/web/login.test.ts`, `tests/web/admin-users.test.ts`, and the end-to-end journey test in `tests/web/auth-journey.test.ts`. The lower whole-file branch number reflects breadth of non-auth routes (conversation pages, search, plugin proxy) where some HTML edge cases aren't covered. |
| `src/commands/user-admin.ts` | 82.05% | 80.20% | 85.71% | Uncovered branches are the modal-error rendering paths for Slack API failures (best-effort UX with `try/catch` swallowing errors); the happy paths and validation are all covered. |
| `src/cli/manage-users.ts` | **24.44%** | 18.63% | 34.48% | **Gap.** The pure ops layer (`createUserOp`, `redeemInviteOp`, etc.) is at ~100% via `tests/cli/manage-users.test.ts`; the uncovered ~75% is the interactive `@clack/prompts` driver layer. **Tracked by #317** — once that lands, this file should reach the 80% line target for auth code. |

### Acceptance threshold (informal)

- **Auth code** should hold ≥ 80% line coverage (currently waived for
  `src/cli/manage-users.ts` pending #317). Anything else below — or a
  regression — should be addressed before further auth feature work.
- **The full repo** has no enforced threshold; focus is critical paths.

### Gaps tracked elsewhere

- **`src/cli/manage-users.ts` interactive driver** → #317 (clack/prompts
  driver tests).
- **Auth-flow UI snapshots** → #315 (login error, 401, 403, password reset
  modal, deactivated row variants for visual review).

No blocking gaps that warrant new tickets beyond those.

## Test layout

```
tests/
├── app.test.ts                      # boot wiring
├── cli/                             # CLI ops (no driver layer yet — see #317)
├── commands/                        # Slack slash + event handlers
├── config/                          # env validation, prompts
├── executors/                       # shell wrappers
├── formatters/                      # block builders, scrubber
├── middleware/                      # authorize, rate-limit, audit
├── plugins/                         # plugin loader, app wrapper, types
├── services/                        # stores, providers, tools, claude
│   ├── auth-concurrency.test.ts     # WAL-mode race tests
│   └── conversation-store.scoping.test.ts
├── setup/                           # interactive setup wizard pieces
├── smoke/                           # boot smoke tests
├── utils/                           # shell, sanitize, logger, image
└── web/
    ├── admin-users.test.ts
    ├── auth-journey.test.ts         # full register → login → scoped views
    ├── login.test.ts
    └── register.test.ts
```

Plugin tests are colocated alongside their plugins under
`plugins.example/**/*.test.ts` and `plugins.local/**/*.test.ts` so they
travel with the code they cover.

## Conventions

- Real DB over mocked drivers: stores use `better-sqlite3` against per-test
  temp files (`tests/services/conversation-store.scoping.test.ts:24` is the
  reference pattern).
- Per-test isolation: temp files use `process.pid + Math.random()` suffixes
  to avoid collision when Vitest runs files in parallel.
- Singletons get reset in `afterEach` (e.g. `closeUserStore()`) so test
  files don't leak state across describes.
- 100% of tests must pass — no `.skip` or `.only` allowed in committed code.
