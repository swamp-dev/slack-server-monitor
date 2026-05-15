import * as p from '@clack/prompts';

/**
 * Server monitoring configuration section.
 * Configures which services, domains, and backups to monitor.
 */
export async function runMonitoringSection(
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const services = await p.text({
    message: 'Docker containers to monitor (comma-separated)',
    placeholder: 'wordpress,nginx,mysql,n8n',
    initialValue: existing.MONITORED_SERVICES ?? '',
  });

  if (p.isCancel(services)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const sslDomains = await p.text({
    message: 'SSL domains to check (comma-separated, optional)',
    placeholder: 'example.com,app.example.com',
    initialValue: existing.SSL_DOMAINS ?? '',
  });

  if (p.isCancel(sslDomains)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const backupDirs = await p.text({
    message: 'Backup directories to monitor (comma-separated, optional)',
    placeholder: '/backups/n8n,/backups/wordpress',
    initialValue: existing.BACKUP_DIRS ?? '',
  });

  if (p.isCancel(backupDirs)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const s3Bucket = await p.text({
    message: 'S3 backup bucket name (optional)',
    placeholder: 'my-backup-bucket',
    initialValue: existing.S3_BACKUP_BUCKET ?? '',
  });

  if (p.isCancel(s3Bucket)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    MONITORED_SERVICES: services,
    SSL_DOMAINS: sslDomains,
    BACKUP_DIRS: backupDirs,
    S3_BACKUP_BUCKET: s3Bucket,
  };
}
