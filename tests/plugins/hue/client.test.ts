import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('hue client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HUE_BRIDGE_IP = '192.168.1.100';
    process.env.HUE_API_KEY = 'test-api-key-12345678901234';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getConfig', () => {
    it('should return config when env vars are set', async () => {
      const { getConfig } = await import('../../../plugins.example/hue/client.js');
      const config = getConfig();
      expect(config.bridgeIp).toBe('192.168.1.100');
      expect(config.apiKey).toBe('test-api-key-12345678901234');
    });

    it('should throw HueNotConfiguredError when BRIDGE_IP missing', async () => {
      delete process.env.HUE_BRIDGE_IP;
      const { getConfig } = await import('../../../plugins.example/hue/client.js');
      const { HueNotConfiguredError } = await import('../../../plugins.example/hue/types.js');
      expect(() => getConfig()).toThrow(HueNotConfiguredError);
    });

    it('should throw HueNotConfiguredError when API_KEY missing', async () => {
      delete process.env.HUE_API_KEY;
      const { getConfig } = await import('../../../plugins.example/hue/client.js');
      const { HueNotConfiguredError } = await import('../../../plugins.example/hue/types.js');
      expect(() => getConfig()).toThrow(HueNotConfiguredError);
    });

    it('should accept valid hostname', async () => {
      process.env.HUE_BRIDGE_IP = 'my-hue-bridge.local';
      const { getConfig } = await import('../../../plugins.example/hue/client.js');
      expect(getConfig().bridgeIp).toBe('my-hue-bridge.local');
    });

    it('should reject bridge IP with path traversal', async () => {
      process.env.HUE_BRIDGE_IP = '192.168.1.1:443/etc/passwd#';
      const { getConfig } = await import('../../../plugins.example/hue/client.js');
      const { HueNotConfiguredError } = await import('../../../plugins.example/hue/types.js');
      expect(() => getConfig()).toThrow(HueNotConfiguredError);
    });

    it('should reject bridge IP with special characters', async () => {
      process.env.HUE_BRIDGE_IP = '192.168.1.1;rm -rf /';
      const { getConfig } = await import('../../../plugins.example/hue/client.js');
      const { HueNotConfiguredError } = await import('../../../plugins.example/hue/types.js');
      expect(() => getConfig()).toThrow(HueNotConfiguredError);
    });
  });

  describe('isTransientError', () => {
    it('should return true for HueApiError with 503', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const { HueApiError } = await import('../../../plugins.example/hue/types.js');
      expect(isTransientError(new HueApiError('Service unavailable', 503))).toBe(true);
    });

    it('should return false for HueApiError with 400', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const { HueApiError } = await import('../../../plugins.example/hue/types.js');
      expect(isTransientError(new HueApiError('Bad request', 400))).toBe(false);
    });

    it('should return false for HueApiError with 404', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const { HueApiError } = await import('../../../plugins.example/hue/types.js');
      expect(isTransientError(new HueApiError('Not found', 404))).toBe(false);
    });

    it('should return true for ECONNRESET', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      expect(isTransientError(err)).toBe(true);
    });

    it('should return true for ETIMEDOUT', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      expect(isTransientError(err)).toBe(true);
    });

    it('should return true for ECONNREFUSED', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      expect(isTransientError(err)).toBe(true);
    });

    it('should return true for HueBridgeUnreachableError', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      const { HueBridgeUnreachableError } = await import('../../../plugins.example/hue/types.js');
      expect(isTransientError(new HueBridgeUnreachableError('1.2.3.4', 'timeout'))).toBe(true);
    });

    it('should return false for generic Error', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      expect(isTransientError(new Error('generic'))).toBe(false);
    });

    it('should return false for string', async () => {
      const { isTransientError } = await import('../../../plugins.example/hue/client.js');
      expect(isTransientError('error')).toBe(false);
    });
  });

  describe('error types', () => {
    it('HueNotConfiguredError should have correct name', async () => {
      const { HueNotConfiguredError } = await import('../../../plugins.example/hue/types.js');
      const err = new HueNotConfiguredError();
      expect(err.name).toBe('HueNotConfiguredError');
      expect(err.message).toContain('HUE_BRIDGE_IP');
    });

    it('HueBridgeUnreachableError should include bridge IP', async () => {
      const { HueBridgeUnreachableError } = await import('../../../plugins.example/hue/types.js');
      const err = new HueBridgeUnreachableError('192.168.1.1', 'connection refused');
      expect(err.name).toBe('HueBridgeUnreachableError');
      expect(err.message).toContain('192.168.1.1');
      expect(err.bridgeIp).toBe('192.168.1.1');
    });

    it('HueApiError should include status code', async () => {
      const { HueApiError } = await import('../../../plugins.example/hue/types.js');
      const err = new HueApiError('Not found', 404);
      expect(err.name).toBe('HueApiError');
      expect(err.statusCode).toBe(404);
    });
  });
});
