/**
 * Log Scrubbing Utility
 *
 * SECURITY WARNING: This is a best-effort attempt to redact sensitive information.
 * It CANNOT catch all possible secrets or PII. Users should:
 * 1. Review what their services log before using the /logs command
 * 2. Use in private channels only with trusted team members
 * 3. Understand that Slack retains message history
 */

/**
 * Patterns for common sensitive data formats
 * Each pattern replaces the matched sensitive value while keeping context
 */
const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Passwords in various formats
  { pattern: /password[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'password=[REDACTED]' },
  { pattern: /passwd[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'passwd=[REDACTED]' },
  { pattern: /pwd[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'pwd=[REDACTED]' },

  // API keys and tokens
  { pattern: /api[_-]?key[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'api_key=[REDACTED]' },
  { pattern: /apikey[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'apikey=[REDACTED]' },
  { pattern: /token[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'token=[REDACTED]' },
  { pattern: /auth[_-]?token[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'auth_token=[REDACTED]' },
  { pattern: /access[_-]?token[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'access_token=[REDACTED]' },
  { pattern: /refresh[_-]?token[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'refresh_token=[REDACTED]' },

  // Secrets
  { pattern: /secret[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'secret=[REDACTED]' },
  { pattern: /client[_-]?secret[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'client_secret=[REDACTED]' },

  // Authorization headers
  { pattern: /authorization:\s*bearer\s+\S+/gi, replacement: 'Authorization: Bearer [REDACTED]' },
  { pattern: /authorization:\s*basic\s+\S+/gi, replacement: 'Authorization: Basic [REDACTED]' },

  // Private keys (PEM format)
  {
    pattern: /-----BEGIN[A-Z ]+PRIVATE KEY-----[\s\S]*?-----END[A-Z ]+PRIVATE KEY-----/g,
    replacement: '[PRIVATE KEY REDACTED]',
  },

  // AWS credentials
  { pattern: /aws[_-]?access[_-]?key[_-]?id[=:]\s*["']?([A-Z0-9]{20})["']?/gi, replacement: 'AWS_ACCESS_KEY_ID=[REDACTED]' },
  { pattern: /aws[_-]?secret[_-]?access[_-]?key[=:]\s*["']?([^"'\s]+)["']?/gi, replacement: 'AWS_SECRET_ACCESS_KEY=[REDACTED]' },

  // Database connection strings (multiple formats)
  { pattern: /(mysql|postgres|postgresql|mongodb|redis|amqp|elasticsearch):\/\/[^:]+:([^@]+)@/gi, replacement: '$1://[USER]:[REDACTED]@' },
  { pattern: /(https?):\/\/[^:]+:([^@]+)@/gi, replacement: '$1://[USER]:[REDACTED]@' },
  { pattern: /jdbc:[a-z]+:\/\/[^?]+\?[^&]*password=([^&\s]+)/gi, replacement: 'jdbc:...[REDACTED]' },
  { pattern: /connectionstring[=:]\s*["']?[^"'\s]+["']?/gi, replacement: 'connectionstring=[REDACTED]' },

  // Generic credentials
  { pattern: /credentials?[=:]\s*["']?[^"'\s]+["']?/gi, replacement: 'credential=[REDACTED]' },
  { pattern: /private[_-]?key[=:]\s*["']?[^"'\s]+["']?/gi, replacement: 'private_key=[REDACTED]' },

  // Email addresses (optional - can be PII)
  // Uncomment if needed: { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL REDACTED]' },

  // IP addresses with port that look like internal IPs (optional)
  // { pattern: /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+\b/g, replacement: '[INTERNAL IP:PORT]' },

  // Credit card numbers (basic pattern)
  { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, replacement: '[CARD NUMBER REDACTED]' },

  // Social Security Numbers (US)
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN REDACTED]' },
];

/**
 * Scrub sensitive data from text
 *
 * @param text - Raw text that may contain sensitive information
 * @returns Text with sensitive data redacted
 */
export function scrubSensitiveData(text: string): string {
  let scrubbed = text;

  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }

  return scrubbed;
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 2900 for Slack's 3000 char limit with margin)
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength = 2900): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + '\n... [truncated]';
}

/**
 * Process log output for safe display in Slack
 * Combines scrubbing and truncation
 *
 * @param logs - Raw log output
 * @param maxLength - Maximum output length
 * @returns Processed logs safe for Slack
 */
export function processLogsForSlack(logs: string, maxLength = 2900): string {
  const scrubbed = scrubSensitiveData(logs);
  return truncateText(scrubbed, maxLength);
}

/**
 * Count how many potential sensitive items were found (for warnings)
 */
export function countPotentialSecrets(text: string): number {
  let count = 0;

  for (const { pattern } of SENSITIVE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}
