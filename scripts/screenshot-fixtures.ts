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
