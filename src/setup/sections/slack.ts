import * as p from '@clack/prompts';
import { validateSlackBotToken, validateSlackAppToken } from '../validators.js';

/**
 * Slack app setup section.
 * Guides user through Slack app creation and token configuration.
 */
export async function runSlackSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  p.note(
    [
      '1. Go to https://api.slack.com/apps and click "Create New App"',
      '2. Choose "From scratch", name it (e.g., "Server Monitor")',
      '3. Under "Socket Mode", enable it and create an App-Level Token',
      '   - Name: "socket-mode", Scope: connections:write',
      '   - Copy the xapp-... token',
      '4. Under "Slash Commands", create commands: /services, /logs, etc.',
      '5. Under "OAuth & Permissions", add scopes: commands, chat:write',
      '6. Install the app to your workspace',
      '7. Copy the Bot User OAuth Token (xoxb-...)',
    ].join('\n'),
    'Slack App Setup'
  );

  const botToken = await p.text({
    message: 'Slack Bot Token (xoxb-...)',
    placeholder: 'xoxb-your-bot-token-here',
    initialValue: existing.SLACK_BOT_TOKEN ?? '',
    validate: validateSlackBotToken,
  });

  if (p.isCancel(botToken)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const appToken = await p.text({
    message: 'Slack App Token (xapp-...)',
    placeholder: 'xapp-your-app-token-here',
    initialValue: existing.SLACK_APP_TOKEN ?? '',
    validate: validateSlackAppToken,
  });

  if (p.isCancel(appToken)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    SLACK_BOT_TOKEN: botToken,
    SLACK_APP_TOKEN: appToken,
  };
}
