import * as p from '@clack/prompts';
import { validateUserIds, validateChannelIds } from '../validators.js';

/**
 * Authorization configuration section.
 * Configures which users and channels can use the bot.
 */
export async function runAuthSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const userIds = await p.text({
    message: 'Authorized Slack User IDs (comma-separated)',
    placeholder: 'U01ABC123,U02DEF456',
    initialValue: existing.AUTHORIZED_USER_IDS ?? '',
    validate: validateUserIds,
  });

  if (p.isCancel(userIds)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const channelIds = await p.text({
    message: 'Restrict to specific channels? (comma-separated, or leave empty for all)',
    placeholder: 'C01ABC123,C02DEF456',
    initialValue: existing.AUTHORIZED_CHANNEL_IDS ?? '',
    validate: validateChannelIds,
  });

  if (p.isCancel(channelIds)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    AUTHORIZED_USER_IDS: userIds,
    AUTHORIZED_CHANNEL_IDS: channelIds,
  };
}
