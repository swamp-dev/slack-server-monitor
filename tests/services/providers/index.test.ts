import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProvider, resetProvider, type ProviderConfig } from '../../../src/services/providers/index.js';

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
      provider: 'cli',
      cliPath: 'claude',
      cliModel: 'sonnet',
      sdkModel: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
      maxToolCalls: 10,
      maxIterations: 20,
    };

    describe('cli mode (default)', () => {
      it('should create CLI provider', () => {
        const config: ProviderConfig = { ...baseConfig, provider: 'cli' };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });

      it('should create CLI provider even when API key is set', () => {
        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'cli',
          apiKey: 'sk-ant-test-key',
        };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });
    });

    describe('legacy modes (deprecated)', () => {
      it('should create CLI provider when auto mode is requested (SDK removed)', () => {
        const config: ProviderConfig = { ...baseConfig, provider: 'auto' };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });

      it('should create CLI provider when sdk mode is requested (SDK removed)', () => {
        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'sdk',
          apiKey: 'sk-ant-test-key',
        };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
      });

      it('should create CLI provider when hybrid mode is requested (hybrid removed)', () => {
        const config: ProviderConfig = {
          ...baseConfig,
          provider: 'hybrid',
          apiKey: 'sk-ant-test-key',
        };
        const provider = createProvider(config);
        expect(provider.name).toBe('cli');
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
