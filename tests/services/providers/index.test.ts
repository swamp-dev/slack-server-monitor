import { describe, it, expect, beforeEach } from 'vitest';
import { createProvider, resetProvider, type CliProviderConfig } from '../../../src/services/providers/index.js';

describe('provider factory', () => {
  beforeEach(() => {
    resetProvider();
  });

  describe('createProvider', () => {
    it('should create CliProvider with valid config', () => {
      const config: CliProviderConfig = {
        cliPath: 'claude',
        model: 'sonnet',
        maxTokens: 2048,
        maxToolCalls: 10,
        maxIterations: 20,
      };

      const provider = createProvider(config);

      expect(provider.name).toBe('cli');
    });

    it('should create provider with custom CLI path', () => {
      const config: CliProviderConfig = {
        cliPath: '/usr/local/bin/claude',
        model: 'opus',
        maxTokens: 4096,
        maxToolCalls: 20,
        maxIterations: 30,
      };

      const provider = createProvider(config);

      expect(provider.name).toBe('cli');
    });
  });
});
