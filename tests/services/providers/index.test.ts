import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProvider, resetProvider, type ProviderConfig } from '../../../src/services/providers/index.js';

// Mock the SdkProvider to avoid needing real API key
vi.mock('../../../src/services/providers/sdk-provider.js', () => ({
  SdkProvider: vi.fn().mockImplementation(() => ({
    name: 'sdk',
    ask: vi.fn(),
  })),
}));

// Mock the CliProvider
vi.mock('../../../src/services/providers/cli-provider.js', () => ({
  CliProvider: vi.fn().mockImplementation(() => ({
    name: 'cli',
    ask: vi.fn(),
  })),
}));

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('provider factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProvider();
  });

  describe('createProvider', () => {
    const baseConfig: ProviderConfig = {
      provider: 'auto',
      cliPath: 'claude',
      cliModel: 'sonnet',
      sdkModel: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
      maxToolCalls: 10,
      maxIterations: 20,
    };

    describe('auto mode', () => {
      it('should create CLI provider when no API key set', () => {
        const config: ProviderConfig = { ...baseConfig, provider: 'auto' };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });

      it('should create SDK provider when API key is set', () => {
        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'auto',
          apiKey: 'sk-ant-test-key',
        };
        const provider = createProvider(config);
        expect(provider.name).toBe('sdk');
      });
    });

    describe('explicit cli mode', () => {
      it('should create CLI provider even when API key is set', () => {
        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'cli',
          apiKey: 'sk-ant-test-key',
        };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });

      it('should create CLI provider without API key', () => {
        const config: ProviderConfig = { ...baseConfig, provider: 'cli' };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });
    });

    describe('explicit sdk mode', () => {
      it('should create SDK provider when API key is set', () => {
        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'sdk',
          apiKey: 'sk-ant-test-key',
        };
        const provider = createProvider(config);
        expect(provider.name).toBe('sdk');
      });

      it('should throw error when SDK mode requested without API key', () => {
        const config: ProviderConfig = { ...baseConfig, provider: 'sdk' };
        expect(() => createProvider(config)).toThrow('SDK provider requires ANTHROPIC_API_KEY');
      });
    });

    describe('model configuration', () => {
      it('should pass CLI model to CLI provider', async () => {
        const { CliProvider } = await import(
          '../../../src/services/providers/cli-provider.js'
        );

        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'cli',
          cliModel: 'opus',
        };

        createProvider(config);

        expect(CliProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'opus',
          })
        );
      });

      it('should pass SDK model to SDK provider', async () => {
        const { SdkProvider } = await import(
          '../../../src/services/providers/sdk-provider.js'
        );

        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'sdk',
          apiKey: 'test-key',
          sdkModel: 'claude-opus-4-20250514',
        };

        createProvider(config);

        expect(SdkProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-opus-4-20250514',
          })
        );
      });
    });
  });

  describe('provider singleton', () => {
    it('should return same instance on subsequent calls', async () => {
      const { getProvider } = await import('../../../src/services/providers/index.js');

      const config: ProviderConfig = {
        provider: 'cli',
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 10,
        maxIterations: 20,
      };

      const provider1 = getProvider(config);
      const provider2 = getProvider(config);

      expect(provider1).toBe(provider2);
    });

    it('should create new instance after reset', async () => {
      const { getProvider, resetProvider } = await import(
        '../../../src/services/providers/index.js'
      );
      const { CliProvider } = await import(
        '../../../src/services/providers/cli-provider.js'
      );

      const config: ProviderConfig = {
        provider: 'cli',
        cliPath: 'claude',
        cliModel: 'sonnet',
        sdkModel: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        maxToolCalls: 10,
        maxIterations: 20,
      };

      vi.clearAllMocks();

      getProvider(config);
      expect(CliProvider).toHaveBeenCalledTimes(1);

      resetProvider();

      getProvider(config);
      expect(CliProvider).toHaveBeenCalledTimes(2);
    });
  });
});
