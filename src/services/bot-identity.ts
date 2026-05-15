import type { App } from '@slack/bolt';

let cached: string | undefined;

export async function getBotUserId(app: App): Promise<string> {
  if (cached) return cached;
  const res = await app.client.auth.test();
  if (!res.user_id) {
    throw new Error('auth.test returned no user_id');
  }
  cached = res.user_id;
  return cached;
}

export function _resetBotUserIdCache(): void {
  cached = undefined;
}
