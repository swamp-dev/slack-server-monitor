import * as p from '@clack/prompts';
import { validateUrl, generateSecret } from '../validators.js';

/**
 * Web UI setup section.
 * Configures the web server for hosting long Claude responses.
 */
export async function runWebSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const enableWeb = await p.confirm({
    message: 'Enable web UI for long Claude responses?',
    initialValue: existing.WEB_ENABLED === 'true',
  });

  if (p.isCancel(enableWeb)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (!enableWeb) {
    return { WEB_ENABLED: 'false' };
  }

  const port = await p.text({
    message: 'Web server port',
    placeholder: '8080',
    initialValue: existing.WEB_PORT ?? '8080',
    validate(value) {
      if (!value) return 'Port must be a number between 1 and 65535';
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 65535) {
        return 'Port must be a number between 1 and 65535';
      }
      return undefined;
    },
  });

  if (p.isCancel(port)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const baseUrl = await p.text({
    message: 'Base URL for Slack links (e.g., http://hostname:port)',
    placeholder: `http://localhost:${port}`,
    initialValue: existing.WEB_BASE_URL ?? '',
    validate: validateUrl,
  });

  if (p.isCancel(baseUrl)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  // Auto-generate auth token if not already set
  const existingToken = existing.WEB_AUTH_TOKEN;
  let authToken: string;

  if (existingToken && existingToken.length >= 16) {
    const reuse = await p.confirm({
      message: 'Reuse existing WEB_AUTH_TOKEN?',
      initialValue: true,
    });

    if (p.isCancel(reuse)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    authToken = reuse ? existingToken : generateSecret();
  } else {
    authToken = generateSecret();
  }

  p.log.info(`Auth token: ${authToken.slice(0, 8)}...${authToken.slice(-4)}`);

  return {
    WEB_ENABLED: 'true',
    WEB_PORT: port,
    WEB_BASE_URL: baseUrl,
    WEB_AUTH_TOKEN: authToken,
  };
}
