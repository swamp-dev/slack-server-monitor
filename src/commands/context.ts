import type { App, SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { config } from '../config/index.js';
import { getContextStore } from '../services/context-store.js';
import { logger } from '../utils/logger.js';
import {
  section,
  context as contextBlock,
  error as errorBlock,
  success as successBlock,
  divider,
} from '../formatters/blocks.js';

/**
 * Register the /context command
 *
 * Usage:
 *   /context                    - Show current context and available options
 *   /context set <alias>        - Set context for this channel
 *   /context clear              - Clear context (use default or none)
 */
export function registerContextCommand(app: App): void {
  if (!config.claude) {
    logger.info('Claude not configured - /context command disabled');
    return;
  }

  const claudeConfig = config.claude;
  const contextOptions = claudeConfig.contextOptions;

  // If no context options configured, don't register the command
  if (contextOptions.length === 0) {
    logger.info('No context options configured - /context command disabled');
    return;
  }

  app.command('/context', async ({ command, ack, respond }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0] ?? '';
    const channelId = command.channel_id;

    const store = getContextStore(claudeConfig.dbPath);

    switch (subcommand) {
      case '':
        // Show current context and available options
        await handleShowContext(respond, channelId, store, contextOptions, claudeConfig.contextDir);
        break;

      case 'set':
        await handleSetContext(respond, channelId, args[1], store, contextOptions);
        break;

      case 'clear':
        await handleClearContext(respond, channelId, store);
        break;

      default:
        await respond({
          blocks: [
            errorBlock(`Unknown subcommand: \`${subcommand}\``),
            section('*Usage:*\n' +
              '`/context` - Show current context and available options\n' +
              '`/context set <alias>` - Set context for this channel\n' +
              '`/context clear` - Clear context (use default)'),
          ],
          response_type: 'ephemeral',
        });
    }
  });

  logger.info('Registered /context command', { optionCount: contextOptions.length });
}

/**
 * Show current context and available options
 */
async function handleShowContext(
  respond: SlackCommandMiddlewareArgs['respond'],
  channelId: string,
  store: ReturnType<typeof getContextStore>,
  contextOptions: { alias: string; path: string }[],
  defaultContextDir: string | undefined
): Promise<void> {
  const currentAlias = store.getChannelContext(channelId);

  // Build current context display
  let currentContextText: string;
  if (currentAlias) {
    const option = contextOptions.find((o) => o.alias === currentAlias);
    if (option) {
      currentContextText = `*Current context:* \`${currentAlias}\` (${option.path})`;
    } else {
      // Alias no longer exists in options
      currentContextText = `*Current context:* \`${currentAlias}\` (configured option no longer exists)`;
    }
  } else if (defaultContextDir) {
    currentContextText = `*Current context:* _default_ (${defaultContextDir})`;
  } else {
    currentContextText = '*Current context:* _none configured_';
  }

  // Build available options list
  const optionsList = contextOptions
    .map((opt) => {
      const isCurrent = opt.alias === currentAlias;
      const marker = isCurrent ? ' :white_check_mark:' : '';
      return `\`${opt.alias}\` - ${opt.path}${marker}`;
    })
    .join('\n');

  await respond({
    blocks: [
      section(currentContextText),
      divider(),
      section('*Available contexts:*\n' + optionsList),
      contextBlock('Use `/context set <alias>` to switch context for this channel.'),
    ],
    response_type: 'ephemeral',
  });
}

/**
 * Set context for this channel
 */
async function handleSetContext(
  respond: SlackCommandMiddlewareArgs['respond'],
  channelId: string,
  alias: string | undefined,
  store: ReturnType<typeof getContextStore>,
  contextOptions: { alias: string; path: string }[]
): Promise<void> {
  if (!alias) {
    await respond({
      blocks: [
        errorBlock('Please provide a context alias.'),
        section('*Usage:* `/context set <alias>`\n\n' +
          '*Available aliases:*\n' +
          contextOptions.map((o) => `\`${o.alias}\``).join(', ')),
      ],
      response_type: 'ephemeral',
    });
    return;
  }

  // Validate alias exists
  const option = contextOptions.find((o) => o.alias === alias);
  if (!option) {
    await respond({
      blocks: [
        errorBlock(`Unknown context alias: \`${alias}\``),
        section('*Available aliases:*\n' +
          contextOptions.map((o) => `\`${o.alias}\` - ${o.path}`).join('\n')),
      ],
      response_type: 'ephemeral',
    });
    return;
  }

  // Set the context
  store.setChannelContext(channelId, alias);

  await respond({
    blocks: [
      successBlock(`Context set to \`${alias}\` for this channel.`),
      contextBlock(`Path: ${option.path}`),
    ],
    response_type: 'ephemeral',
  });

  logger.info('Context set via command', { channelId, alias });
}

/**
 * Clear context for this channel
 */
async function handleClearContext(
  respond: SlackCommandMiddlewareArgs['respond'],
  channelId: string,
  store: ReturnType<typeof getContextStore>
): Promise<void> {
  const hadContext = store.clearChannelContext(channelId);

  if (hadContext) {
    await respond({
      blocks: [
        successBlock('Context cleared for this channel.'),
        contextBlock('The default context will be used (if configured).'),
      ],
      response_type: 'ephemeral',
    });
  } else {
    await respond({
      blocks: [
        section('No context was set for this channel.'),
      ],
      response_type: 'ephemeral',
    });
  }
}
