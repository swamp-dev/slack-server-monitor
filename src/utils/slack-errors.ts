/**
 * Slack API Error Parsing
 *
 * Parses Slack API errors and provides actionable suggestions for common issues.
 * This helps users understand what went wrong and how to fix it.
 */

export type SlackErrorType =
  | 'missing_scope'
  | 'rate_limited'
  | 'not_in_channel'
  | 'channel_not_found'
  | 'invalid_auth'
  | 'unknown';

export interface ParsedSlackError {
  type: SlackErrorType;
  message: string;
  suggestion: string;
  /** Format the error with suggestion for display */
  format(): string;
}

interface ErrorPattern {
  pattern: RegExp;
  type: SlackErrorType;
  message: string;
  suggestion: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /missing_scope/i,
    type: 'missing_scope',
    message: 'Slack app missing required OAuth scope',
    suggestion: 'Add the required scope (e.g., chat:write) at https://api.slack.com/apps > OAuth & Permissions, then reinstall the app',
  },
  {
    pattern: /rate[_-]?limit/i,
    type: 'rate_limited',
    message: 'Slack API rate limit exceeded',
    suggestion: 'Please wait a few seconds before trying again',
  },
  {
    pattern: /not_in_channel/i,
    type: 'not_in_channel',
    message: 'Bot is not in this channel',
    suggestion: 'Invite the bot to this channel with /invite @botname',
  },
  {
    pattern: /channel_not_found/i,
    type: 'channel_not_found',
    message: 'Channel not found or bot lacks access',
    suggestion: 'Verify the channel exists and the bot has been added to it',
  },
  {
    pattern: /invalid_auth|token_revoked|token_expired/i,
    type: 'invalid_auth',
    message: 'Invalid or expired Slack token',
    suggestion: 'Check SLACK_BOT_TOKEN in your environment configuration',
  },
];

/**
 * Parse a Slack API error and return structured information with suggestions
 */
export function parseSlackError(error: Error): ParsedSlackError {
  const errorMessage = error instanceof Error ? error.message : String(error);

  for (const { pattern, type, message, suggestion } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return {
        type,
        message,
        suggestion,
        format() {
          return `${this.message}. ${this.suggestion}`;
        },
      };
    }
  }

  return {
    type: 'unknown',
    message: errorMessage,
    suggestion: '',
    format() {
      return this.message;
    },
  };
}
