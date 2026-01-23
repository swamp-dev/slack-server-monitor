import { describe, it, expect, beforeEach } from 'vitest';
import { createProvider, resetProvider, type ProviderFactoryConfig } from '../../../src/services/providers/index.js';

describe('provider factory', () => {
  beforeEach(() => {
    resetProvider();
  });

  describe('createProvider', () => {
    describe('with backend=api', () => {
      it('should create ApiProvider when API config provided', () => {
        const config: ProviderFactoryConfig = {
          backend: 'api',
          api: {
            apiKey: 'sk-test-key',
            model: 'claude-sonnet-4-20250514',
            maxTokens: 2048,
            maxToolCalls: 10,
            maxIterations: 20,
          },
        };

        const provider = createProvider(config);

        expect(provider.name).toBe('api');
        expect(provider.tracksTokens).toBe(true);
      });

      it('should throw when API config missing', () => {
        const config: ProviderFactoryConfig = {
          backend: 'api',
        };

        expect(() => createProvider(config)).toThrow('API provider requires apiKey configuration');
      });
    });

    describe('with backend=cli', () => {
      it('should create CliProvider when CLI config provided', () => {
        const config: ProviderFactoryConfig = {
          backend: 'cli',
          cli: {
            cliPath: 'claude',
            model: 'sonnet',
            maxTokens: 2048,
            maxToolCalls: 10,
            maxIterations: 20,
          },
        };

        const provider = createProvider(config);

        expect(provider.name).toBe('cli');
        expect(provider.tracksTokens).toBe(false);
      });

      it('should throw when CLI config missing', () => {
        const config: ProviderFactoryConfig = {
          backend: 'cli',
        };

        expect(() => createProvider(config)).toThrow('CLI provider requires cliPath configuration');
      });
    });

    describe('with backend=auto', () => {
      it('should prefer ApiProvider when API config available', () => {
        const config: ProviderFactoryConfig = {
          backend: 'auto',
          api: {
            apiKey: 'sk-test-key',
            model: 'claude-sonnet-4-20250514',
            maxTokens: 2048,
            maxToolCalls: 10,
            maxIterations: 20,
          },
          cli: {
            cliPath: 'claude',
            model: 'sonnet',
            maxTokens: 2048,
            maxToolCalls: 10,
            maxIterations: 20,
          },
        };

        const provider = createProvider(config);

        expect(provider.name).toBe('api');
      });

      it('should fall back to CliProvider when only CLI config available', () => {
        const config: ProviderFactoryConfig = {
          backend: 'auto',
          cli: {
            cliPath: 'claude',
            model: 'sonnet',
            maxTokens: 2048,
            maxToolCalls: 10,
            maxIterations: 20,
          },
        };

        const provider = createProvider(config);

        expect(provider.name).toBe('cli');
      });

      it('should throw when no config available', () => {
        const config: ProviderFactoryConfig = {
          backend: 'auto',
        };

        expect(() => createProvider(config)).toThrow('No valid provider configuration found');
      });
    });
  });
});
