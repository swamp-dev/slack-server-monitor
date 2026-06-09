import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { config } from '../config/index.js';
import { getConversationStore } from '../services/conversation-store.js';
import { getServerHealth } from '../services/server-health.js';
import {
  header,
  section,
  divider,
  context,
  error,
  progressBar,
  statusEmoji,
} from '../formatters/blocks.js';
import { logger } from '../utils/logger.js';

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Register the /stats command
 *
 * Usage:
 *   /stats - Show usage statistics and system health summary
 */
export function registerStatsCommand(app: App): void {
  app.command('/stats', async ({ ack, respond }) => {
    await ack();

    try {
      const claudeConfig = config.claude;

      // Build response blocks
      const blocks: KnownBlock[] = [header('Usage Statistics')];

      // Claude AI stats (if enabled)
      if (claudeConfig) {
        const store = getConversationStore(claudeConfig.dbPath, claudeConfig.conversationTtlHours);
        const stats = store.getSessionStats(24);
        const uniqueUsers = store.countUniqueUsers(24);

        blocks.push(
          section(
            `*Last 24 Hours*\n` +
            `${statusEmoji('ok')} *Sessions:* ${String(stats.totalSessions)}  |  ` +
            `*Active:* ${String(stats.activeSessions)}  |  ` +
            `*Users:* ${String(uniqueUsers)}\n` +
            `*Messages:* ${String(stats.totalMessages)}  |  ` +
            `*Tool Calls:* ${String(stats.totalToolCalls)}`
          ),
        );

        // Tool performance
        if (stats.avgToolDurationMs != null) {
          const failurePct = (stats.toolFailureRate * 100).toFixed(1);
          blocks.push(
            section(
              `*Tool Performance*\n` +
              `Avg response: *${formatDuration(stats.avgToolDurationMs)}*  |  ` +
              `Failure rate: *${failurePct}%*`
            ),
          );
        }

        // Top tools
        if (stats.topTools.length > 0) {
          const maxCount = stats.topTools[0]?.count ?? 1;
          const toolLines = stats.topTools.map((t) => {
            const duration = t.avgDurationMs != null ? ` (${formatDuration(t.avgDurationMs)})` : '';
            const bar = progressBar(t.count, maxCount, 8);
            return `${bar} \`${t.name}\` × ${String(t.count)}${duration}`;
          });
          blocks.push(section(`*Top Tools*\n${toolLines.join('\n')}`));
        }
      } else {
        blocks.push(section('_Claude AI is not enabled — no usage stats available._'));
      }

      blocks.push(divider());

      // System health summary
      const health = await getServerHealth();
      if (health) {
        const memPct = health.memory.percentUsed;
        const memStatus = memPct >= 90 ? 'error' : memPct >= 75 ? 'warn' : 'ok';
        const loadStatus = health.loadAverage[0] / health.cpu.cores >= 1.0 ? 'error'
          : health.loadAverage[0] / health.cpu.cores >= 0.7 ? 'warn' : 'ok';

        blocks.push(
          section(
            `*System Health*\n` +
            `${statusEmoji('ok')} *Uptime:* ${health.uptime}\n` +
            `${statusEmoji(loadStatus)} *Load:* ${health.loadAverage.map((l) => l.toFixed(2)).join(', ')} ` +
            `(${String(health.cpu.cores)} cores)\n` +
            `${statusEmoji(memStatus)} *Memory:* ${progressBar(memPct, 100)} ${String(Math.round(memPct))}%`
          ),
        );

        // Disk usage — split system mounts from attached storage (/mnt/* or labeled mounts)
        if (health.disks.length > 0) {
          const diskLabels = config.server.diskLabels;
          const isAttached = (mountPoint: string) =>
            mountPoint in diskLabels || mountPoint.startsWith('/mnt/');

          const formatDiskLine = (d: { mountPoint: string; percentUsed: number; used: string; size: string }) => {
            const diskStatus = d.percentUsed >= 90 ? 'error' : d.percentUsed >= 75 ? 'warn' : 'ok';
            const label = diskLabels[d.mountPoint];
            const displayName = label ? `${label} \`${d.mountPoint}\`` : `\`${d.mountPoint}\``;
            return `${statusEmoji(diskStatus)} ${displayName} ${progressBar(d.percentUsed, 100)} ${String(Math.round(d.percentUsed))}%  ${d.used} / ${d.size}`;
          };

          const systemDisks = health.disks.filter((d) => !isAttached(d.mountPoint));
          const attachedDisks = health.disks.filter((d) => isAttached(d.mountPoint));

          if (systemDisks.length > 0 && attachedDisks.length > 0) {
            blocks.push(section(`*System Disk*\n${systemDisks.map(formatDiskLine).join('\n')}`));
            blocks.push(section(`*Attached Storage*\n${attachedDisks.map(formatDiskLine).join('\n')}`));
          } else {
            blocks.push(section(`*Disk Usage*\n${health.disks.map(formatDiskLine).join('\n')}`));
          }
        }
      } else {
        blocks.push(section('_Could not fetch system health._'));
      }

      blocks.push(context('_Stats from the last 24 hours. View more on the web dashboard._'));

      await respond({ blocks });
    } catch (err) {
      logger.error('Stats command failed', { error: err instanceof Error ? err.message : String(err) });
      await respond({
        blocks: [error('Failed to fetch stats. Please try again.')],
      });
    }
  });
}
