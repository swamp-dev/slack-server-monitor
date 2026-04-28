/**
 * Startup validation for the auth subsystem (#278).
 *
 * Pure decision function — no I/O. Called from `app.ts` after the user
 * store is bootstrapped from `AUTHORIZED_USER_IDS` (if any). The bot
 * authorizes from the DB only at request time, so "no active users in
 * the DB" means "every command will be silently rejected" — refuse to
 * start in that case rather than running broken.
 *
 *   - `{ ok: true, level: 'silent' }`  — normal operation; nothing to log.
 *   - `{ ok: true, level: 'info' }`    — DB has users AND env var is also
 *                                        set; operator can safely remove
 *                                        AUTHORIZED_USER_IDS (env var is
 *                                        bootstrap-only, redundant once
 *                                        the table has rows).
 *   - `{ ok: false }`                  — no active users in DB. Either
 *                                        env was unset (no bootstrap) or
 *                                        bootstrap failed validation for
 *                                        every entry. Caller should log
 *                                        the message and refuse to start.
 */
export type AuthStartupResult =
  | { ok: true; level: 'silent' }
  | { ok: true; level: 'info'; message: string }
  | { ok: false; message: string };

export function evaluateAuthStartup(
  activeUsersInTable: number,
  envUserIdsCount: number,
): AuthStartupResult {
  if (activeUsersInTable === 0) {
    if (envUserIdsCount === 0) {
      return {
        ok: false,
        message:
          'No authorized users configured. The users table is empty and ' +
          'AUTHORIZED_USER_IDS is unset. Set AUTHORIZED_USER_IDS for ' +
          'first-time bootstrap, or seed the users table via ' +
          '`npm run manage-users create-user`. Refusing to start.',
      };
    }
    return {
      ok: false,
      message:
        `AUTHORIZED_USER_IDS has ${String(envUserIdsCount)} entries but no active users ` +
        'are present in the users table — bootstrap inserted nothing ' +
        '(check earlier warnings for invalid Slack IDs) or every user ' +
        'has been deactivated. The bot would silently reject every ' +
        'command. Refusing to start.',
    };
  }
  if (envUserIdsCount > 0) {
    const userWord = activeUsersInTable === 1 ? 'user' : 'users';
    return {
      ok: true,
      level: 'info',
      message:
        `User accounts active (${String(activeUsersInTable)} ${userWord} in DB). ` +
        'AUTHORIZED_USER_IDS can be removed from your environment — ' +
        'manage users via `/user-admin`, the web `/admin/users` page, ' +
        'or `npm run manage-users`.',
    };
  }
  return { ok: true, level: 'silent' };
}
