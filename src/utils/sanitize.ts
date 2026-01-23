import { z } from 'zod';

/**
 * Service/container name validation schema
 * Allows alphanumeric characters, hyphens, and underscores
 * Must start with alphanumeric character
 * SECURITY: Explicitly blocks path traversal attempts
 */
const ServiceNameSchema = z
  .string()
  .min(1, 'Service name cannot be empty')
  .max(63, 'Service name too long (max 63 characters)')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
    'Service name must start with alphanumeric and contain only alphanumeric, hyphens, or underscores'
  )
  .refine((val) => !val.includes('/'), 'Service name cannot contain slashes')
  .refine((val) => !val.includes('..'), 'Path traversal not allowed')
  .refine((val) => !val.includes('\\'), 'Service name cannot contain backslashes');

/**
 * Domain name validation schema
 */
const DomainSchema = z
  .string()
  .min(1, 'Domain cannot be empty')
  .max(253, 'Domain too long')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/,
    'Invalid domain format'
  );

/**
 * Line count validation schema for log commands
 * Hard cap at 500 to prevent excessive data exposure
 */
const LineCountSchema = z.coerce
  .number()
  .int('Line count must be a whole number')
  .positive('Line count must be positive')
  .max(500, 'Maximum 500 lines allowed for security');

/**
 * Sanitize and validate a service/container name
 *
 * @param input - Raw user input
 * @returns Sanitized service name
 * @throws Error if validation fails
 */
export function sanitizeServiceName(input: string): string {
  const trimmed = input.trim();
  const result = ServiceNameSchema.safeParse(trimmed);

  if (!result.success) {
    const message = result.error.errors[0]?.message ?? 'Invalid service name';
    throw new Error(message);
  }

  return result.data;
}

/**
 * Sanitize and validate a domain name
 *
 * @param input - Raw user input
 * @returns Sanitized domain name (lowercase)
 * @throws Error if validation fails
 */
export function sanitizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const result = DomainSchema.safeParse(trimmed);

  if (!result.success) {
    const message = result.error.errors[0]?.message ?? 'Invalid domain';
    throw new Error(message);
  }

  return result.data;
}

/**
 * Sanitize and validate a line count for log commands
 *
 * @param input - Raw user input (string or undefined)
 * @param defaultValue - Default if input is empty/undefined
 * @returns Validated line count
 * @throws Error if validation fails
 */
export function sanitizeLineCount(input: string | undefined, defaultValue = 50): number {
  if (!input || input.trim() === '') {
    return defaultValue;
  }

  const result = LineCountSchema.safeParse(input.trim());

  if (!result.success) {
    const message = result.error.errors[0]?.message ?? 'Invalid line count';
    throw new Error(message);
  }

  return result.data;
}

/**
 * Parse command arguments into service name and optional line count
 * Handles formats like: "nginx", "nginx 100", "nginx  50"
 *
 * @param text - Raw command text
 * @returns Parsed service name and line count
 */
export function parseLogsArgs(
  text: string,
  defaultLines = 50
): { serviceName: string; lineCount: number } {
  const parts = text.trim().split(/\s+/);

  if (parts.length === 0 || parts[0] === '') {
    throw new Error('Service name is required. Usage: /logs <service> [lines]');
  }

  const serviceName = sanitizeServiceName(parts[0] ?? '');
  const lineCount = sanitizeLineCount(parts[1], defaultLines);

  return { serviceName, lineCount };
}

/**
 * Check if a string looks like it might contain sensitive content
 * Used as a secondary check before sending data to Slack
 */
export function mightContainSensitive(text: string): boolean {
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /api[_-]?key/i,
    /token/i,
    /credential/i,
    /private[_-]?key/i,
    /-----BEGIN/,
    /bearer\s+\S{20,}/i,
  ];

  return sensitivePatterns.some((pattern) => pattern.test(text));
}
