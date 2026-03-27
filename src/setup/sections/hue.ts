import * as p from '@clack/prompts';

/**
 * Philips Hue setup section.
 * Configures bridge connection for the /hue plugin.
 */
export async function runHueSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const enableHue = await p.confirm({
    message: 'Enable Philips Hue lights integration (/hue command)?',
    initialValue: existing.HUE_BRIDGE_IP !== undefined && existing.HUE_BRIDGE_IP !== '',
  });

  if (p.isCancel(enableHue)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (!enableHue) {
    return {};
  }

  const bridgeIp = await p.text({
    message: 'Hue bridge IP address',
    placeholder: '192.168.1.100',
    initialValue: existing.HUE_BRIDGE_IP ?? '',
    validate(value) {
      if (!value?.trim()) {
        return 'Bridge IP is required';
      }
      // Basic validation: must look like an IP or hostname
      const trimmed = value.trim();
      if (!/^[\d.]+$/.test(trimmed) && !/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
        return 'Must be an IP address or hostname';
      }
      return undefined;
    },
  });

  if (p.isCancel(bridgeIp)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const apiKey = await p.password({
    message: 'Hue API key (press bridge link button, then POST to /api to generate)',
    validate(value) {
      if (!value?.trim()) {
        return 'API key is required';
      }
      if (value.trim().length < 20) {
        return 'API key must be at least 20 characters';
      }
      return undefined;
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  p.log.info(`Bridge: ${bridgeIp}`);
  p.log.info(`API key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

  return {
    HUE_BRIDGE_IP: bridgeIp,
    HUE_API_KEY: apiKey,
  };
}
