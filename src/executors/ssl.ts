import { executeCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';

/**
 * SECURITY: Validate domain string to prevent command injection
 * This is defense-in-depth - the command layer also validates
 */
function validateDomainFormat(domain: string): boolean {
  // Length check
  if (!domain || domain.length > 253) return false;

  // Only allow characters that are safe for domain names
  // and cannot be used for shell injection
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(domain)) return false;

  // No leading/trailing dots
  if (domain.startsWith('.') || domain.endsWith('.')) return false;

  // No consecutive dots
  if (domain.includes('..')) return false;

  // Each label must be valid
  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
  }

  return true;
}

/**
 * SSL certificate information
 */
export interface CertificateInfo {
  domain: string;
  valid: boolean;
  expiresAt?: Date;
  daysRemaining?: number;
  status: 'ok' | 'warn' | 'error';
  error?: string;
}

/**
 * Parse a date string from openssl output
 * Format: "Dec 15 23:59:59 2024 GMT"
 */
function parseOpenSslDate(dateStr: string): Date | null {
  try {
    // notAfter=Dec 15 23:59:59 2024 GMT
    const match = /(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+GMT/.exec(dateStr);
    if (!match) return null;

    const [, month, day, time, year] = match;
    if (!month || !day || !time || !year) return null;

    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };

    const [hours, minutes, seconds] = time.split(':').map(Number);
    const monthNum = months[month];

    if (monthNum === undefined) return null;

    return new Date(Date.UTC(
      parseInt(year, 10),
      monthNum,
      parseInt(day, 10),
      hours,
      minutes,
      seconds
    ));
  } catch {
    return null;
  }
}

/**
 * Calculate days remaining until expiry
 */
function calculateDaysRemaining(expiresAt: Date): number {
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determine status based on days remaining
 */
function getExpiryStatus(daysRemaining: number): 'ok' | 'warn' | 'error' {
  if (daysRemaining <= 7) return 'error';
  if (daysRemaining <= 30) return 'warn';
  return 'ok';
}

/**
 * Check SSL certificate for a domain
 */
export async function checkCertificate(
  domain: string,
  port = 443
): Promise<CertificateInfo> {
  // SECURITY: Defense-in-depth validation of domain format
  if (!validateDomainFormat(domain)) {
    return {
      domain,
      valid: false,
      status: 'error',
      error: 'Invalid domain format',
    };
  }

  // openssl s_client -connect domain:port -servername domain </dev/null 2>&1 | openssl x509 -noout -enddate
  // We can't pipe, so we use s_client with a short timeout and parse the output

  const result = await executeCommand(
    'openssl',
    [
      's_client',
      '-connect',
      `${domain}:${String(port)}`,
      '-servername',
      domain,
      '-brief',
    ],
    { timeout: 10000 }
  );

  // openssl s_client writes certificate info to stderr
  const output = result.stderr + result.stdout;

  // Check for connection errors
  if (output.includes('Connection refused')) {
    return {
      domain,
      valid: false,
      status: 'error',
      error: 'Connection refused',
    };
  }

  if (output.includes('timed out') || output.includes('Operation timed out')) {
    return {
      domain,
      valid: false,
      status: 'error',
      error: 'Connection timed out',
    };
  }

  if (output.includes('Name or service not known') || output.includes('getaddrinfo')) {
    return {
      domain,
      valid: false,
      status: 'error',
      error: 'Domain not found',
    };
  }

  // Parse expiry date from output
  // Look for notAfter=...
  const notAfterMatch = /notAfter=(.+)/.exec(output);
  if (!notAfterMatch?.[1]) {
    logger.warn('Could not find notAfter in openssl output', { domain, output: output.slice(0, 500) });
    return {
      domain,
      valid: false,
      status: 'error',
      error: 'Could not parse certificate expiry date',
    };
  }

  const expiresAt = parseOpenSslDate(notAfterMatch[1]);
  if (!expiresAt) {
    return {
      domain,
      valid: false,
      status: 'error',
      error: 'Could not parse certificate expiry date',
    };
  }

  const daysRemaining = calculateDaysRemaining(expiresAt);
  const status = getExpiryStatus(daysRemaining);
  const valid = daysRemaining > 0;

  return {
    domain,
    valid,
    expiresAt,
    daysRemaining,
    status,
  };
}

/**
 * Check multiple SSL certificates
 */
export async function checkMultipleCertificates(
  domains: string[]
): Promise<CertificateInfo[]> {
  if (domains.length === 0) return [];

  const results: CertificateInfo[] = [];

  for (const domain of domains) {
    try {
      const result = await checkCertificate(domain);
      results.push(result);
    } catch (error) {
      logger.error('Failed to check certificate', { domain, error });
      results.push({
        domain,
        valid: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
