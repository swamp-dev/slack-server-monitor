/**
 * Seed data fixtures for screenshot capture.
 *
 * Typed mock data matching each render function's signature.
 * Produces realistic, visually rich pages for automated screenshots.
 */

import type { ConversationMessage, ToolCallLog, SessionSummary, PaginationInfo, TagInfo, SessionStats } from '../src/services/conversation-store.js';
import type { Notification } from '../src/services/notification-store.js';
import type { QuickLink } from '../src/services/quick-links-store.js';
import type { ServerHealth } from '../src/services/server-health.js';
import type { DashboardWidget } from '../src/plugins/types.js';

const now = Date.now();
const hour = 3_600_000;
const day = 24 * hour;

// --- Dashboard ---

export const seedStats: SessionStats = {
  totalSessions: 47,
  activeSessions: 5,
  totalMessages: 312,
  totalToolCalls: 89,
  avgToolDurationMs: 680,
  toolFailureRate: 0.03,
  topTools: [
    { name: 'docker_ps', count: 34, avgDurationMs: 450 },
    { name: 'disk_usage', count: 22, avgDurationMs: 320 },
    { name: 'container_logs', count: 18, avgDurationMs: 890 },
    { name: 'system_info', count: 15, avgDurationMs: 210 },
  ],
};

export const seedHealth: ServerHealth = {
  uptime: '12 days, 4:32',
  uptimeSeconds: 12 * 86400 + 4 * 3600 + 32 * 60,
  loadAverage: [0.42, 0.38, 0.31],
  cpu: { cores: 4, model: 'Intel Core i5-8250U' },
  memory: {
    total: 16384,
    used: 8192,
    free: 4096,
    available: 8192,
    bufferCache: 4096,
    percentUsed: 50,
  },
  swap: { total: 4096, used: 256, free: 3840, percentUsed: 6.25 },
  disks: [
    { filesystem: '/dev/sda1', size: '100G', used: '45G', available: '55G', percentUsed: 45, mountPoint: '/' },
    { filesystem: '/dev/sdb1', size: '1.0T', used: '720G', available: '280G', percentUsed: 72, mountPoint: '/data' },
  ],
  timestamp: now,
};

export const seedRecent: SessionSummary[] = [
  {
    id: 1, threadTs: '1000.001', channelId: 'C001', userId: 'admin',
    messageCount: 8, toolCallCount: 3, createdAt: now - 15 * 60_000, updatedAt: now - 2 * 60_000,
    archivedAt: null, isActive: true, isFavorited: false,
    tags: ['docker', 'monitoring'],
    firstMessage: 'Which containers are using the most memory right now?',
  },
  {
    id: 2, threadTs: '2000.002', channelId: 'C001', userId: 'admin',
    messageCount: 4, toolCallCount: 2, createdAt: now - 2 * hour, updatedAt: now - hour,
    archivedAt: null, isActive: false, isFavorited: true,
    tags: ['disk', 'backup'],
    firstMessage: 'Check disk usage on /data and verify last backup completed',
  },
  {
    id: 3, threadTs: '3000.003', channelId: 'C001', userId: 'admin',
    messageCount: 12, toolCallCount: 5, createdAt: now - 6 * hour, updatedAt: now - 5 * hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['nginx', 'ssl'],
    firstMessage: 'Check nginx SSL certificate expiry dates for all domains',
  },
  {
    id: 4, threadTs: '4000.004', channelId: 'C001', userId: 'admin',
    messageCount: 6, toolCallCount: 2, createdAt: now - day, updatedAt: now - day + hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['monitoring'],
    firstMessage: 'Show me the current system load and any concerning processes',
  },
  {
    id: 5, threadTs: '5000.005', channelId: 'C001', userId: 'admin',
    messageCount: 3, toolCallCount: 1, createdAt: now - 2 * day, updatedAt: now - 2 * day + 30 * 60_000,
    archivedAt: null, isActive: false, isFavorited: true,
    tags: ['docker'],
    firstMessage: 'What version of Jellyfin is running and is there an update available?',
  },
];

export const seedFavorites: SessionSummary[] = seedRecent.filter((s) => s.isFavorited);
// Total favorites across all pages (dashboard only shows recent subset)
export const seedFavCount = 8;

export const seedAllTags: TagInfo[] = [
  { name: 'monitoring', count: 15 },
  { name: 'docker', count: 12 },
  { name: 'nginx', count: 8 },
  { name: 'disk', count: 6 },
  { name: 'backup', count: 4 },
  { name: 'ssl', count: 3 },
];

export const seedQuickLinks: QuickLink[] = [
  { id: 1, userId: 'admin', title: 'Grafana', url: 'http://grafana.local:3000', icon: 'activity', position: 0, createdAt: now - 30 * day },
  { id: 2, userId: 'admin', title: 'Portainer', url: 'http://portainer.local:9000', icon: 'server', position: 1, createdAt: now - 30 * day },
  { id: 3, userId: 'admin', title: 'Pi-hole', url: 'http://pihole.local/admin', icon: 'shield', position: 2, createdAt: now - 30 * day },
  { id: 4, userId: 'admin', title: 'Uptime Kuma', url: 'http://uptime.local:3001', icon: 'zap', position: 3, createdAt: now - 30 * day },
];

export const seedWidgets: DashboardWidget[] = [
  {
    title: 'Hue Lights',
    icon: 'sun',
    html: '<div style="display:flex;gap:8px;flex-wrap:wrap"><span style="padding:4px 10px;border-radius:12px;background:var(--surface);font-size:0.85rem">Living Room <span style="color:var(--green)">on</span></span><span style="padding:4px 10px;border-radius:12px;background:var(--surface);font-size:0.85rem">Office <span style="color:var(--green)">on</span></span><span style="padding:4px 10px;border-radius:12px;background:var(--surface);font-size:0.85rem">Bedroom <span style="color:var(--text-muted)">off</span></span></div>',
    link: '/p/hue/',
    priority: 50,
  },
];

// --- Session list ---

export const seedSessions: SessionSummary[] = [
  ...seedRecent,
  {
    id: 6, threadTs: '6000.006', channelId: 'C001', userId: 'admin',
    messageCount: 2, toolCallCount: 1, createdAt: now - 3 * day, updatedAt: now - 3 * day + hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['nginx'], firstMessage: 'Show me the nginx access logs from the last hour',
  },
  {
    id: 7, threadTs: '7000.007', channelId: 'C001', userId: 'admin',
    messageCount: 5, toolCallCount: 3, createdAt: now - 4 * day, updatedAt: now - 4 * day + 2 * hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['docker', 'monitoring'], firstMessage: 'Are there any containers that have restarted in the last 24 hours?',
  },
];

export const seedPagination: PaginationInfo = {
  page: 1,
  pageSize: 20,
  totalItems: 47,
  totalPages: 3,
};

// --- Conversation detail ---

export const seedMessages: ConversationMessage[] = [
  {
    role: 'user',
    content: 'Which containers are using the most memory right now?',
    timestamp: now - 15 * 60_000,
  },
  {
    role: 'assistant',
    content: `Here are the top containers by memory usage:\n\n| Container | Memory | Limit | % Used |\n|-----------|--------|-------|--------|\n| **jellyfin** | 1.2 GB | 4 GB | 30% |\n| **nextcloud** | 890 MB | 2 GB | 44% |\n| **nginx-proxy** | 124 MB | 512 MB | 24% |\n| **pihole** | 98 MB | 256 MB | 38% |\n| **portainer** | 45 MB | 256 MB | 18% |\n\nJellyfin is the heaviest consumer at 1.2 GB, which is normal during transcoding. All containers are within their memory limits.`,
    timestamp: now - 14 * 60_000,
  },
  {
    role: 'user',
    content: 'Is Jellyfin actively transcoding something right now?',
    timestamp: now - 10 * 60_000,
  },
  {
    role: 'assistant',
    content: `I checked the Jellyfin container logs and there are **no active transcoding sessions** right now. The elevated memory usage (1.2 GB) is from the metadata cache — Jellyfin keeps library metadata in memory for fast browsing.\n\nThis is normal behavior. The memory will fluctuate between ~800 MB (idle) and ~2.5 GB (active transcoding) depending on usage.\n\n\`\`\`\n$ docker stats jellyfin --no-stream\nCONTAINER   CPU %   MEM USAGE / LIMIT   NET I/O       BLOCK I/O\njellyfin    0.15%   1.2GiB / 4GiB       12MB / 450KB  2.1GB / 89MB\n\`\`\``,
    timestamp: now - 9 * 60_000,
  },
];

export const seedToolCalls: ToolCallLog[] = [
  {
    id: 1, conversationId: 1, toolName: 'docker_ps',
    input: { format: 'table', all: false },
    outputPreview: 'CONTAINER ID  IMAGE         STATUS\nabc123        jellyfin      Up 12 days\ndef456        nextcloud     Up 12 days\nghi789        nginx-proxy   Up 12 days',
    timestamp: now - 14 * 60_000 - 500, durationMs: 1200, success: true,
  },
  {
    id: 2, conversationId: 1, toolName: 'disk_usage',
    input: { path: '/' },
    outputPreview: 'Filesystem  Size  Used  Avail  Use%  Mounted on\n/dev/sda1   100G  45G   55G    45%   /',
    timestamp: now - 14 * 60_000 - 200, durationMs: 450, success: true,
  },
  {
    id: 3, conversationId: 1, toolName: 'container_logs',
    input: { container: 'jellyfin', tail: 50 },
    outputPreview: '[2026-04-04 10:32:15] [INF] Library scan complete\n[2026-04-04 10:32:16] [INF] Metadata refresh queued',
    timestamp: now - 9 * 60_000 - 300, durationMs: 890, success: true,
  },
];

export const seedConversationMeta = {
  threadTs: '1000.001',
  channelId: 'C001',
  createdAt: now - 15 * 60_000,
  updatedAt: now - 9 * 60_000,
  canContinue: true,
  conversationId: 1,
  isFavorited: false,
  tags: ['docker', 'monitoring'],
  userId: 'admin',
  contextStatus: null,
  parentConversationId: null,
  branchPointIndex: null,
  branches: [],
};

// --- Notifications ---

export const seedNotifications: Notification[] = [
  { id: 1, source: 'system', level: 'info', title: 'Server started', body: 'Slack Server Monitor v1.0.0 started successfully', link: null, createdAt: now - 12 * day, readAt: now - 12 * day + hour },
  { id: 2, source: 'backup', level: 'warn', title: 'Backup slow', body: 'Borg backup took 4h 23m (threshold: 3h). Check /data for large new files.', link: null, createdAt: now - 2 * day, readAt: now - day },
  { id: 3, source: 'ssl', level: 'error', title: 'Certificate expiring', body: 'SSL certificate for media.example.com expires in 7 days. Renew immediately.', link: null, createdAt: now - day, readAt: null },
  { id: 4, source: 'health', level: 'info', title: 'Disk usage normal', body: '/data partition at 72% — below 80% warning threshold.', link: null, createdAt: now - 6 * hour, readAt: now - 5 * hour },
  { id: 5, source: 'hue', level: 'info', title: 'Scene activated', body: 'Evening scene activated in Living Room at 7:00 PM.', link: '/p/hue/', createdAt: now - 2 * hour, readAt: null },
];

// =============================================================================
// Variant fixtures — alternate states for the same pages
// =============================================================================

// --- Dashboard: empty (new user welcome) ---

export const emptyStats: SessionStats = {
  totalSessions: 0,
  activeSessions: 0,
  totalMessages: 0,
  totalToolCalls: 0,
  avgToolDurationMs: null,
  toolFailureRate: 0,
  topTools: [],
};

// --- Dashboard: degraded health ---

export const degradedHealth: ServerHealth = {
  uptime: '2 days, 1:15',
  uptimeSeconds: 2 * 86400 + 1 * 3600 + 15 * 60,
  loadAverage: [6.8, 5.2, 4.1],
  cpu: { cores: 4, model: 'Intel Core i5-8250U' },
  memory: {
    total: 16384,
    used: 15200,
    free: 384,
    available: 1184,
    bufferCache: 800,
    percentUsed: 93,
  },
  swap: { total: 4096, used: 3200, free: 896, percentUsed: 78 },
  disks: [
    { filesystem: '/dev/sda1', size: '100G', used: '92G', available: '8G', percentUsed: 92, mountPoint: '/' },
    { filesystem: '/dev/sdb1', size: '1.0T', used: '820G', available: '180G', percentUsed: 82, mountPoint: '/data' },
  ],
  timestamp: now,
};

// --- Sessions: archived ---

export const archivedSessions: SessionSummary[] = [
  {
    id: 10, threadTs: '10000.010', channelId: 'C001', userId: 'admin',
    messageCount: 6, toolCallCount: 2, createdAt: now - 14 * day, updatedAt: now - 14 * day + hour,
    archivedAt: now - 7 * day, isActive: false, isFavorited: false,
    tags: ['docker'], firstMessage: 'How do I update the Jellyfin container to the latest version?',
  },
  {
    id: 11, threadTs: '11000.011', channelId: 'C001', userId: 'admin',
    messageCount: 3, toolCallCount: 1, createdAt: now - 21 * day, updatedAt: now - 21 * day + 30 * 60_000,
    archivedAt: now - 14 * day, isActive: false, isFavorited: false,
    tags: ['nginx', 'ssl'], firstMessage: 'Set up SSL for the new subdomain wiki.example.com',
  },
  {
    id: 12, threadTs: '12000.012', channelId: 'C001', userId: 'admin',
    messageCount: 8, toolCallCount: 4, createdAt: now - 30 * day, updatedAt: now - 30 * day + 2 * hour,
    archivedAt: now - 21 * day, isActive: false, isFavorited: false,
    tags: ['backup', 'disk'], firstMessage: 'Debug why borg backup is failing with a lock error',
  },
];

// --- Conversation: with branches ---

export const branchedConversationMeta = {
  ...seedConversationMeta,
  branches: [
    { threadTs: '1000.001b1', channelId: 'C001', createdAt: now - 8 * 60_000, branchPointIndex: 1 },
    { threadTs: '1000.001b2', channelId: 'C001', createdAt: now - 5 * 60_000, branchPointIndex: 3 },
  ],
};

// --- Sessions: search results (matched against the term "docker") ---

export const seedSearchResults: SessionSummary[] = [
  {
    id: 20, threadTs: '20000.020', channelId: 'C001', userId: 'admin',
    messageCount: 9, toolCallCount: 4, createdAt: now - 4 * hour, updatedAt: now - 3 * hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['docker'],
    firstMessage: 'Why is the docker daemon spending so much CPU on the dind container?',
  },
  {
    id: 21, threadTs: '21000.021', channelId: 'C001', userId: 'admin',
    messageCount: 4, toolCallCount: 2, createdAt: now - 8 * hour, updatedAt: now - 7 * hour,
    archivedAt: null, isActive: false, isFavorited: true,
    tags: ['docker', 'monitoring'],
    firstMessage: 'List docker containers using more than 500 MB of memory',
  },
  {
    id: 22, threadTs: '22000.022', channelId: 'C001', userId: 'admin',
    messageCount: 6, toolCallCount: 3, createdAt: now - day, updatedAt: now - day + 2 * hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['docker', 'nginx'],
    firstMessage: 'Compare the docker network configuration between staging and prod',
  },
  {
    id: 23, threadTs: '23000.023', channelId: 'C001', userId: 'admin',
    messageCount: 11, toolCallCount: 5, createdAt: now - 3 * day, updatedAt: now - 3 * day + hour,
    archivedAt: null, isActive: false, isFavorited: false,
    tags: ['docker', 'backup'],
    firstMessage: 'Restore the postgres docker volume from yesterday\'s borg snapshot',
  },
];

// --- Notifications: all unread, mixed levels ---

export const seedNotificationsAllUnread: Notification[] = [
  { id: 100, source: 'ssl', level: 'error', title: 'Certificate expiring', body: 'SSL certificate for media.example.com expires in 7 days. Renew immediately.', link: null, createdAt: now - 30 * 60_000, readAt: null },
  { id: 101, source: 'health', level: 'warn', title: 'Memory at 91%', body: 'System memory has been above 90% for the last 12 minutes — investigate jellyfin transcoding sessions.', link: null, createdAt: now - 45 * 60_000, readAt: null },
  { id: 102, source: 'backup', level: 'error', title: 'Backup failed', body: 'Borg backup to offsite repo failed: lock file held by stale process. Manual intervention required.', link: null, createdAt: now - 2 * hour, readAt: null },
  { id: 103, source: 'system', level: 'info', title: 'Reboot pending', body: 'Kernel update applied. A reboot is required to load 6.1.0-45.', link: null, createdAt: now - 4 * hour, readAt: null },
  { id: 104, source: 'hue', level: 'warn', title: 'Hue bridge unreachable', body: 'Could not reach Hue bridge at 192.168.1.42 for 5 consecutive polls.', link: '/p/hue/', createdAt: now - 6 * hour, readAt: null },
];

// --- Notifications: many entries (overflow / scroll test) ---

export const seedNotificationsMany: Notification[] = (() => {
  const out: Notification[] = [];
  const sources = ['system', 'health', 'backup', 'ssl', 'hue', 'docker'];
  const levels: Array<'info' | 'warn' | 'error'> = ['info', 'info', 'info', 'warn', 'warn', 'error'];
  for (let i = 0; i < 18; i++) {
    const level = levels[i % levels.length]!;
    const source = sources[i % sources.length]!;
    out.push({
      id: 200 + i,
      source,
      level,
      title: `${source.charAt(0).toUpperCase() + source.slice(1)} event #${i + 1}`,
      body: `Event ${i + 1} from ${source} subsystem. Details: routine status update for ${source} containing event-specific information that wraps to multiple lines on narrow viewports.`,
      link: null,
      createdAt: now - (i + 1) * 30 * 60_000,
      readAt: i < 4 ? null : now - (i * 25 * 60_000),
    });
  }
  return out;
})();

// --- Conversation: long thread with code blocks, tables, and lists ---

export const seedLongConversation: ConversationMessage[] = [
  {
    role: 'user',
    content: 'Walk me through how to deploy a new version of the API service safely.',
    timestamp: now - 60 * 60_000,
  },
  {
    role: 'assistant',
    content: `Here's the safe deploy sequence I'd recommend:\n\n1. **Run the test suite locally** to catch regressions before they reach prod\n2. **Open a PR** so CI runs the same checks in a clean environment\n3. **Tag a release** once CI is green\n4. **Deploy to staging** and exercise the new endpoints manually\n5. **Promote to production** with a blue-green flip\n6. **Monitor logs and metrics** for 15 minutes after the flip\n\nWant me to show you the deploy script?`,
    timestamp: now - 59 * 60_000,
  },
  {
    role: 'user',
    content: 'Yes, show me the deploy script.',
    timestamp: now - 58 * 60_000,
  },
  {
    role: 'assistant',
    content: `Here's the current deploy script:\n\n\`\`\`bash\n#!/usr/bin/env bash\nset -euo pipefail\n\nVERSION="\${1:?usage: deploy.sh <version>}"\nENV="\${2:-staging}"\n\necho "Deploying $VERSION to $ENV"\ndocker pull "registry.local/api:$VERSION"\ndocker tag "registry.local/api:$VERSION" "api:current"\ndocker compose up -d api\n\necho "Waiting for health check..."\nfor i in {1..30}; do\n  if curl -sf http://localhost:8080/health; then\n    echo "Healthy"\n    exit 0\n  fi\n  sleep 2\ndone\necho "Health check failed" >&2\nexit 1\n\`\`\`\n\nIt does a tag-and-flip with a 60-second health check window before declaring failure.`,
    timestamp: now - 57 * 60_000,
  },
  {
    role: 'user',
    content: 'What does the health endpoint actually check?',
    timestamp: now - 55 * 60_000,
  },
  {
    role: 'assistant',
    content: `The health endpoint reports four sub-checks:\n\n| Check | What it verifies | Failure mode |\n|-------|------------------|--------------|\n| **db** | Postgres connection + 1 round-trip | Returns 503 if connection pool is exhausted |\n| **cache** | Redis PING | Returns 503 if Redis is down |\n| **disk** | /data writable + < 95% full | Returns 503 if disk is read-only |\n| **deps** | Reachability of two upstream APIs | Returns 200 with degraded=true (still serves traffic) |\n\nThe deploy script's curl uses \`-f\` (fail on non-2xx), so any 503 stops the rollout.`,
    timestamp: now - 54 * 60_000,
  },
  {
    role: 'user',
    content: 'How do I roll back if monitoring shows errors after the flip?',
    timestamp: now - 50 * 60_000,
  },
  {
    role: 'assistant',
    content: `Roll back by re-tagging the previous version:\n\n\`\`\`bash\ndocker tag "registry.local/api:$PREV_VERSION" "api:current"\ndocker compose up -d api\n\`\`\`\n\nThe blue-green flip is instant (it's just a container restart), so rollback completes in ~10 seconds. After rolling back:\n\n- **Capture the failing logs** with \`docker logs api --since 5m > rollback-$(date +%s).log\`\n- **Tag the bad commit** in git so you don't redeploy it accidentally\n- **Open a tracking issue** with the log output attached`,
    timestamp: now - 49 * 60_000,
  },
  {
    role: 'user',
    content: 'Got it. Anything else I should know?',
    timestamp: now - 47 * 60_000,
  },
  {
    role: 'assistant',
    content: `A few gotchas worth knowing:\n\n- **Database migrations** — they run on container start. If a migration takes more than 30s, the health check window expires and the deploy fails. For long migrations, run them out-of-band first.\n- **Cache warm-up** — the new container starts with an empty Redis cache reference, so first-request latency spikes. Pre-warm with \`curl http://localhost:8080/warm\` before declaring success.\n- **Log volume** — the new container writes to /var/log which is mounted from the host. Make sure /var/log isn't full before deploying or the container will crash on first log line.\n\nThat's the lot. The script handles the common cases; the rest is operational hygiene.`,
    timestamp: now - 46 * 60_000,
  },
  {
    role: 'user',
    content: 'Thanks, this is helpful.',
    timestamp: now - 30 * 60_000,
  },
  {
    role: 'assistant',
    content: 'Glad it helped! Let me know if anything goes sideways during the rollout.',
    timestamp: now - 29 * 60_000,
  },
];

// --- Conversation: context truncated (long history pruned) ---

export const seedTruncatedConvMeta = {
  ...seedConversationMeta,
  contextStatus: {
    // percentUsed is stored as a fraction (0.0-1.0); the renderer multiplies
    // by 100 for display. See conversation.ts:18 (Math.round(percentUsed * 100)).
    percentUsed: 0.87,
    wasTruncated: true,
    removedCount: 6,
  },
};

// --- Conversation: tool error mixed with successes ---

export const seedConversationToolError: ToolCallLog[] = [
  {
    id: 10, conversationId: 1, toolName: 'docker_ps',
    input: { format: 'table', all: false },
    outputPreview: 'CONTAINER ID  IMAGE         STATUS\nabc123        jellyfin      Up 12 days',
    timestamp: now - 9 * 60_000, durationMs: 1200, success: true,
  },
  {
    id: 11, conversationId: 1, toolName: 'container_logs',
    input: { container: 'jellyfin-staging', tail: 200 },
    outputPreview: 'Error response from daemon: No such container: jellyfin-staging\n  at /usr/lib/node_modules/dockerode/lib/util.js:42:11\n  at processTicksAndRejections (node:internal/process/task_queues:96:5)',
    timestamp: now - 8 * 60_000, durationMs: 230, success: false,
  },
  {
    id: 12, conversationId: 1, toolName: 'disk_usage',
    input: { path: '/data' },
    outputPreview: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sdb1       1.0T  720G  280G  72% /data',
    timestamp: now - 7 * 60_000, durationMs: 510, success: true,
  },
];
