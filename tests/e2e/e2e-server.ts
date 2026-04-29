/**
 * E2E test server — starts the real web server with mocked backends.
 *
 * This module is imported by Playwright's globalSetup/globalTeardown.
 * It mocks external dependencies (Slack, Claude, Docker) so the web UI
 * can be tested end-to-end in a browser without real infrastructure.
 */

import type { Server } from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import Database from 'better-sqlite3';
import { PluginDatabase } from '../../src/services/plugin-database.js';
import { createSchema } from '../../plugins.example/agentbox/schema.js';
import { migrateRunsTable } from '../../plugins.local/agentbox.js';
import {
  loadDashboardData,
  renderDashboard,
  renderQueue,
  renderRunHistory,
  loadRunHistory,
  loadRunDetail,
  renderRunDetail,
  renderNavPills,
  parsePageParam,
  parseRunIdParam,
  type QueueIssue,
} from '../../plugins.local/agentbox/web-templates.js';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// We can't easily mock ESM modules for E2E tests the way Vitest does.
// Instead, we'll start the web server components directly using a
// minimal Express app that mirrors the real server's routes but with
// in-memory data. This avoids needing to mock module imports.

import { AUTH_TOKEN } from './constants.js';
const SESSION_COOKIE = 'ssm_session';
const PORT = 18960;

interface Session {
  sessionId: string;
  userId: string;
  isAdmin: boolean;
  createdAt: number;
  expiresAt: number;
}

// In-memory session store
const sessions = new Map<string, Session>();

// In-memory conversation data
const conversations = [
  {
    id: 1,
    threadTs: '1000.001',
    channelId: 'C001',
    userId: 'admin',
    messages: [
      { role: 'user' as const, content: 'What containers are running?' },
      { role: 'assistant' as const, content: 'Here are the running containers:\n- nginx (healthy)\n- wordpress (healthy)\n- n8n (healthy)' },
    ],
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3500000,
    favoritedAt: null as number | null,
    archivedAt: null as number | null,
    tags: ['server'] as string[],
  },
  {
    id: 2,
    threadTs: '2000.002',
    channelId: 'C001',
    userId: 'admin',
    messages: [
      { role: 'user' as const, content: 'Check disk usage' },
      { role: 'assistant' as const, content: 'Disk usage:\n- / : 45% used (50GB/100GB)\n- /data : 72% used (720GB/1TB)' },
    ],
    createdAt: Date.now() - 7200000,
    updatedAt: Date.now() - 7100000,
    favoritedAt: Date.now() - 5000000,
    archivedAt: null as number | null,
    tags: ['disk', 'monitoring'] as string[],
  },
  {
    id: 3,
    threadTs: '3000.003',
    channelId: 'C001',
    userId: 'admin',
    messages: [
      { role: 'user' as const, content: 'Check nginx logs' },
      { role: 'assistant' as const, content: 'Here are the recent nginx logs showing 200 OK responses.' },
      { role: 'user' as const, content: 'Any errors?' },
      { role: 'assistant' as const, content: 'No errors found in the last 24 hours.' },
    ],
    createdAt: Date.now() - 1800000,
    updatedAt: Date.now() - 1700000,
    favoritedAt: null as number | null,
    archivedAt: null as number | null,
    tags: ['nginx'] as string[],
  },
];

const notifications = [
  { id: 1, source: 'system', level: 'info', title: 'Server started', body: 'Web server is running', link: null, readAt: null, createdAt: Date.now() - 60000 },
  { id: 2, source: 'backup', level: 'warn', title: 'Backup delayed', body: 'S3 backup took 15 minutes', link: null, readAt: null, createdAt: Date.now() - 30000 },
];

let quickLinks = [
  { id: 1, userId: 'admin', title: 'Grafana', url: 'https://grafana.local', icon: 'chart', sortOrder: 0 },
];

// ─── Agentbox plugin fixture ───────────────────────────────────────
const AGENTBOX_FIXTURE_REPO = 'test-org/test-repo';

const AGENTBOX_QUEUE_ISSUES: QueueIssue[] = [
  {
    number: 101,
    title: 'Add feature X',
    labels: [{ name: 'agentbox-ready' }, { name: 'priority: high' }],
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    url: 'https://github.com/test-org/test-repo/issues/101',
  },
  {
    number: 102,
    title: 'Fix bug Y',
    labels: [{ name: 'agentbox-ready' }, { name: 'priority: medium' }],
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    url: 'https://github.com/test-org/test-repo/issues/102',
  },
];

interface AgentboxFixture {
  rawDb: Database.Database;
  pluginDb: PluginDatabase;
  runningRunId: number;
}

function insertAgentboxRun(
  rawDb: Database.Database,
  pluginDb: PluginDatabase,
  opts: {
    issueNumber: number;
    status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled';
    startedAt?: number | null;
    finishedAt?: number | null;
    prUrl?: string | null;
    progressPct?: number | null;
  },
): number {
  const result = rawDb
    .prepare(
      `INSERT INTO ${pluginDb.prefix}runs
       (issue_number, repo, status, started_at, finished_at, pr_url, progress_pct, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.issueNumber, AGENTBOX_FIXTURE_REPO, opts.status,
      opts.startedAt ?? null, opts.finishedAt ?? null,
      opts.prUrl ?? null, opts.progressPct ?? null,
      Date.now(),
    );
  return Number(result.lastInsertRowid);
}

function setupAgentboxFixture(): AgentboxFixture {
  const rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  const pluginDb = new PluginDatabase(rawDb, 'agentbox');
  createSchema(pluginDb);
  migrateRunsTable(pluginDb);

  const now = Date.now();
  // One running, one success, one failed — enough to populate stats,
  // active-run section, recent list, and the run-detail page.
  const runningRunId = insertAgentboxRun(rawDb, pluginDb, {
    issueNumber: 42, status: 'running',
    startedAt: now - 60_000, progressPct: 35,
  });
  insertAgentboxRun(rawDb, pluginDb, {
    issueNumber: 40, status: 'success',
    startedAt: now - 7_200_000, finishedAt: now - 7_080_000,
    prUrl: 'https://github.com/test-org/test-repo/pull/45',
    progressPct: 100,
  });
  insertAgentboxRun(rawDb, pluginDb, {
    issueNumber: 38, status: 'failed',
    startedAt: now - 14_400_000, finishedAt: now - 14_280_000,
    progressPct: 60,
  });
  return { rawDb, pluginDb, runningRunId };
}

function wrapPluginPage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${esc(title)}</title></head><body>
    <nav><a href="/">Dashboard</a> <a href="/p/agentbox/">Workflows</a> <a href="/c">Conversations</a></nav>
    <main class="container"><div class="plugin-agentbox">${body}</div></main>
  </body></html>`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

function createSession(userId: string, isAdmin: boolean): Session {
  const sessionId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session: Session = {
    sessionId,
    userId,
    isAdmin,
    createdAt: Date.now(),
    expiresAt: Date.now() + 72 * 3600 * 1000,
  };
  sessions.set(sessionId, session);
  return session;
}

function sessionAuth(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.expiresAt > Date.now()) {
      res.locals.userId = session.userId;
      res.locals.isAdmin = session.isAdmin;
      next();
      return;
    }
    // Expired — clear cookie
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }
  res.status(401).send(`<!DOCTYPE html><html><body>
    <h1>Authentication Required</h1>
    <p><a href="/login">Log in</a></p>
  </body></html>`);
}

let server: Server | null = null;
let agentboxFixtureForTeardown: { rawDb: Database.Database } | null = null;

export async function startE2EServer(): Promise<void> {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Login page
  app.get('/login', (req, res) => {
    const error = req.query.error as string | undefined;
    res.type('html').send(`<!DOCTYPE html><html><head><title>Login</title></head><body>
      <h1>Server Monitor Login</h1>
      ${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
      <form method="POST" action="/login">
        <label for="token">Token</label>
        <input type="password" id="token" name="token" required>
        <button type="submit">Log In</button>
      </form>
    </body></html>`);
  });

  // Login form
  app.post('/login', (req, res) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    if (token !== AUTH_TOKEN) {
      res.status(401).type('html').send(`<!DOCTYPE html><html><body>
        <h1>Server Monitor Login</h1>
        <div class="error" role="alert">Invalid token.</div>
        <form method="POST" action="/login">
          <label for="token">Token</label>
          <input type="password" id="token" name="token" required>
          <button type="submit">Log In</button>
        </form>
      </body></html>`);
      return;
    }
    const session = createSession('admin', true);
    const maxAge = 72 * 3600;
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${session.sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
    res.redirect(302, '/');
  });

  // Logout
  app.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) sessions.delete(sessionId);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.redirect(302, '/login');
  });

  // Protected routes
  app.use('/c', sessionAuth);

  // Session list
  app.get('/c', (_req, res) => {
    const active = conversations.filter((c) => !c.archivedAt);
    res.type('html').send(`<!DOCTYPE html><html><head><title>Conversations</title></head><body>
      <nav><a href="/">Dashboard</a> <a href="/c">Conversations</a> <a href="/notifications">Notifications</a></nav>
      <h1>Conversations</h1>
      <input type="search" id="search" placeholder="Search conversations..." aria-label="Search conversations">
      <div class="session-list">
        ${active.map((c) => `
          <div class="session-card" data-id="${c.id}">
            <a href="/c/${esc(c.threadTs)}/${esc(c.channelId)}">${esc(c.messages[0]?.content.slice(0, 50) ?? '')}</a>
            <button class="favorite-btn" data-id="${c.id}" aria-label="Toggle favorite">${c.favoritedAt ? '★' : '☆'}</button>
            <span class="tags">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>
          </div>
        `).join('')}
      </div>
      <a href="/c/favorites">Favorites</a>
      <a href="/c/archived">Archived</a>
    </body></html>`);
  });

  // Conversation detail
  app.get('/c/:threadTs/:channelId', (req, res) => {
    const conv = conversations.find(
      (c) => c.threadTs === req.params.threadTs && c.channelId === req.params.channelId
    );
    if (!conv) {
      res.status(404).type('html').send('<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>');
      return;
    }
    res.type('html').send(`<!DOCTYPE html><html><head><title>Conversation</title></head><body>
      <nav><a href="/">Dashboard</a> <a href="/c">Conversations</a></nav>
      <h1>Conversation</h1>
      <div class="messages">
        ${conv.messages.map((m, i) => {
          const isLast = i === conv.messages.length - 1;
          const forkBtn = m.role === 'assistant' && !isLast
            ? `<button class="fork-btn" data-index="${i}" data-conv-id="${conv.id}">Fork</button>`
            : '';
          return `<div class="message ${m.role}" data-role="${m.role}" data-index="${i}">
            <strong>${m.role === 'user' ? 'You' : 'Claude'}</strong>${forkBtn}
            <p>${esc(m.content)}</p>
          </div>`;
        }).join('')}
      </div>
      <a href="/c/${conv.threadTs}/${conv.channelId}/export/md" class="export-btn">Export Markdown</a>
      <button class="favorite-btn" data-id="${conv.id}">${conv.favoritedAt ? '★' : '☆'}</button>
    </body></html>`);
  });

  // Markdown export
  app.get('/c/:threadTs/:channelId/export/md', (req, res) => {
    const conv = conversations.find(
      (c) => c.threadTs === req.params.threadTs && c.channelId === req.params.channelId
    );
    if (!conv) {
      res.status(404).send('Not found');
      return;
    }
    const md = conv.messages.map((m) => `## ${m.role}\n\n${m.content}`).join('\n\n---\n\n');
    res.type('text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="conversation-${conv.threadTs}.md"`);
    res.send(md);
  });

  // Favorites
  app.get('/c/favorites', (_req, res) => {
    const favs = conversations.filter((c) => c.favoritedAt);
    res.type('html').send(`<!DOCTYPE html><html><body>
      <h1>Favorites</h1>
      <div class="session-list">${favs.map((c) => `<div class="session-card"><a href="/c/${esc(c.threadTs)}/${esc(c.channelId)}">${esc(c.messages[0]?.content.slice(0, 50) ?? '')}</a></div>`).join('')}</div>
    </body></html>`);
  });

  // Archived
  app.get('/c/archived', (_req, res) => {
    const archived = conversations.filter((c) => c.archivedAt);
    res.type('html').send(`<!DOCTYPE html><html><body>
      <h1>Archived</h1>
      <div class="session-list">${archived.map((c) => `<div class="session-card">${esc(c.messages[0]?.content.slice(0, 50) ?? '')}</div>`).join('')}</div>
    </body></html>`);
  });

  // Toggle favorite API
  app.post('/c/:id/favorite', (req, res) => {
    const id = Number(req.params.id);
    const conv = conversations.find((c) => c.id === id);
    if (!conv) { res.status(404).json({ error: 'Not found' }); return; }
    conv.favoritedAt = conv.favoritedAt ? null : Date.now();
    res.json({ isFavorited: conv.favoritedAt !== null });
  });

  // Fork conversation
  app.post('/c/:id/fork', (req, res) => {
    const id = Number(req.params.id);
    const messageIndex = typeof req.body.messageIndex === 'number' ? req.body.messageIndex : -1;
    const conv = conversations.find((c) => c.id === id);
    if (!conv) { res.status(404).json({ error: 'Not found' }); return; }
    if (!Number.isInteger(messageIndex) || messageIndex < 0) { res.status(400).json({ error: 'Invalid messageIndex' }); return; }
    const branchTs = `branch-${Date.now()}`;
    const branch = {
      id: conversations.length + 10,
      threadTs: branchTs,
      channelId: conv.channelId,
      userId: 'admin',
      messages: conv.messages.slice(0, messageIndex + 1),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      favoritedAt: null,
      archivedAt: null,
      tags: [] as string[],
    };
    conversations.push(branch);
    res.json({ threadTs: branch.threadTs, channelId: branch.channelId, id: branch.id });
  });

  // Search API (for command palette)
  app.get('/api/search', sessionAuth, (req, res) => {
    const q = (req.query.q as string || '').toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 5, 10);
    const filtered = q
      ? conversations.filter((c) => c.messages.some((m) => m.content.toLowerCase().includes(q)))
      : conversations;
    res.json({
      results: filtered.slice(0, limit).map((c) => ({
        id: c.id,
        title: c.messages[0]?.content.slice(0, 50) ?? 'Untitled',
        url: `/c/${esc(c.threadTs)}/${esc(c.channelId)}`,
        time: c.updatedAt,
      })),
    });
  });

  // Search page
  app.get('/c/search', (req, res) => {
    const q = (req.query.q as string || '').toLowerCase();
    if (!q) { res.redirect('/c'); return; }
    const results = conversations.filter((c) =>
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
    res.type('html').send(`<!DOCTYPE html><html><body>
      <h1>Search: ${esc(q)}</h1>
      <div class="session-list">${results.map((c) => `<div class="session-card"><a href="/c/${esc(c.threadTs)}/${esc(c.channelId)}">${esc(c.messages[0]?.content.slice(0, 50) ?? '')}</a></div>`).join('')}</div>
    </body></html>`);
  });

  // Health API
  app.get('/api/health/server', sessionAuth, (_req, res) => {
    res.json({
      uptime: '5 days',
      loadAverage: [0.5, 0.3, 0.2],
      memory: { total: '16GB', used: '8GB', free: '8GB', usedPercent: 50 },
      disk: [{ mount: '/', total: '100GB', used: '50GB', free: '50GB', usedPercent: 50 }],
      cpuCount: 4,
      hostname: 'test-server',
    });
  });

  // Quick Links API
  app.get('/api/links', sessionAuth, (_req, res) => {
    res.json({ links: quickLinks });
  });

  app.post('/api/links', sessionAuth, (req, res) => {
    const { title, url, icon } = req.body;
    if (!title || !url) { res.status(400).json({ error: 'title and url required' }); return; }
    const id = quickLinks.length + 1;
    const link = { id, userId: 'admin', title, url, icon: icon ?? null, sortOrder: id };
    quickLinks.push(link);
    res.status(201).json({ link });
  });

  app.delete('/api/links/:id', sessionAuth, (req, res) => {
    const id = Number(req.params.id);
    quickLinks = quickLinks.filter((l) => l.id !== id);
    res.json({ success: true });
  });

  // Notification API
  app.get('/api/notifications', sessionAuth, (_req, res) => {
    const unreadCount = notifications.filter((n) => !n.readAt).length;
    res.json({ notifications, unreadCount });
  });

  // Notifications page
  app.get('/notifications', sessionAuth, (_req, res) => {
    const unreadCount = notifications.filter((n) => !n.readAt).length;
    res.type('html').send(`<!DOCTYPE html><html><head><title>Notifications</title></head><body>
      <nav><a href="/">Dashboard</a> <a href="/c">Conversations</a> <a href="/notifications">Notifications</a></nav>
      <h1>Notifications</h1>
      <span class="unread-badge">${unreadCount}</span>
      <div class="notification-list">
        ${notifications.map((n) => `
          <div class="notification ${n.readAt ? 'read' : 'unread'}" data-id="${n.id}">
            <strong>${esc(n.title)}</strong>
            <p>${esc(n.body ?? '')}</p>
          </div>
        `).join('')}
      </div>
    </body></html>`);
  });

  // Dashboard
  app.get('/', sessionAuth, (_req, res) => {
    const stats = { totalSessions: conversations.length, totalMessages: conversations.reduce((s, c) => s + c.messages.length, 0) };
    const unreadCount = notifications.filter((n) => !n.readAt).length;
    res.type('html').send(`<!DOCTYPE html><html><head><title>Dashboard</title>
      <style>
        :root, [data-theme="dracula"] { --bg: #282a36; --fg: #f8f8f2; }
        [data-theme="light"] { --bg: #ffffff; --fg: #1a1a2e; }
        body { background: var(--bg); color: var(--fg); font-family: sans-serif; }
      </style>
    </head><body>
    <script>document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'dracula');</script>
      <nav>
        <a href="/">Dashboard</a>
        <a href="/c">Conversations</a>
        <a href="/notifications">Notifications <span class="unread-badge">${unreadCount}</span></a>
        <button id="theme-toggle" aria-label="Toggle theme">Toggle Theme</button>
        <form action="/logout" method="POST" style="display:inline"><button type="submit">Logout</button></form>
      </nav>
      <h1>Dashboard</h1>
      <div class="stats">
        <div class="stat-card"><h3>Sessions</h3><p>${stats.totalSessions}</p></div>
        <div class="stat-card"><h3>Messages</h3><p>${stats.totalMessages}</p></div>
      </div>
      <div class="health-widget">
        <h3>Server Health</h3>
        <p>Uptime: 5 days</p>
        <p>Memory: 50%</p>
      </div>
      <div class="quick-links">
        <h3>Quick Links</h3>
        ${quickLinks.map((l) => `<a href="${esc(l.url)}" class="quick-link">${esc(l.title)}</a>`).join('')}
      </div>
      <div class="recent-conversations">
        <h3>Recent</h3>
        ${conversations.slice(0, 3).map((c) => `<a href="/c/${esc(c.threadTs)}/${esc(c.channelId)}">${esc(c.messages[0]?.content.slice(0, 40) ?? '')}</a>`).join('<br>')}
      </div>
      <script>
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
          toggle.addEventListener('click', function() {
            const el = document.documentElement;
            const current = el.getAttribute('data-theme');
            const next = current === 'dracula' ? 'light' : 'dracula';
            el.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
          });
        }
      </script>
      <div id="cmd-palette" class="cmd-palette" style="display:none" role="dialog" aria-label="Command palette" aria-modal="true">
        <div class="cmd-palette-backdrop"></div>
        <div class="cmd-palette-panel">
          <div class="cmd-palette-input-wrap">
            <input type="text" id="cmd-palette-input" class="cmd-palette-input" placeholder="Search or type a command...">
          </div>
          <div id="cmd-palette-results" class="cmd-palette-results"></div>
        </div>
      </div>
      <script>
        (function() {
          function escJs(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
          var palette = document.getElementById('cmd-palette');
          var input = document.getElementById('cmd-palette-input');
          var results = document.getElementById('cmd-palette-results');
          if (!palette || !input || !results) return;
          var searchSeq = 0;

          function open() { palette.style.display = ''; input.value = ''; input.focus(); renderDefault(); }
          function close() { palette.style.display = 'none'; }

          function renderDefault() {
            var seq = ++searchSeq;
            var html = '<div class="cmd-palette-group">Navigate</div>'
              + '<a href="/" class="cmd-palette-item"><span class="cmd-item-title">Dashboard</span></a>'
              + '<a href="/c" class="cmd-palette-item"><span class="cmd-item-title">Conversations</span></a>'
              + '<a href="/c/new" class="cmd-palette-item"><span class="cmd-item-title">New Conversation</span></a>';
            fetch('/api/search?limit=3', { credentials: 'same-origin' })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (seq !== searchSeq) return;
                if (data.results && data.results.length > 0) {
                  html += '<div class="cmd-palette-group">Recent</div>';
                  data.results.forEach(function(r) {
                    html += '<a href="' + escJs(r.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + escJs(r.title || 'Untitled') + '</span></a>';
                  });
                }
                results.innerHTML = html;
              })
              .catch(function() { results.innerHTML = html; });
          }

          document.addEventListener('keydown', function(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              palette.style.display === 'none' ? open() : close();
            }
          });
          palette.querySelector('.cmd-palette-backdrop').addEventListener('click', close);
          input.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            if (e.key === 'Enter') {
              var first = results.querySelector('.cmd-palette-item');
              if (first) first.click();
              close();
            }
          });
          input.addEventListener('input', function() {
            var q = input.value.trim();
            if (!q) { renderDefault(); return; }
            var seq2 = ++searchSeq;
            fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=5', { credentials: 'same-origin' })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (seq2 !== searchSeq) return;
                var h = '';
                if (data.results && data.results.length > 0) {
                  h += '<div class="cmd-palette-group">Results</div>';
                  data.results.forEach(function(r) {
                    h += '<a href="' + escJs(r.url) + '" class="cmd-palette-item"><span class="cmd-item-title">' + escJs(r.title || 'Untitled') + '</span></a>';
                  });
                } else {
                  h = '<div class="cmd-palette-empty">No results</div>';
                }
                results.innerHTML = h;
              });
          });
        })();
      </script>
    </body></html>`);
  });

  // ─── Agentbox plugin routes (real renderers, in-memory SQLite) ───
  // Mounts the plugin's pure render functions at /p/agentbox/* against
  // a seeded in-memory SQLite. Lets Playwright drive the real template
  // code without needing the full PluginRouter / shell wrapper stack.
  const fixture = setupAgentboxFixture();
  agentboxFixtureForTeardown = fixture;
  const agentboxDb = fixture.pluginDb;

  // Expose the seeded run ids so specs can target them without
  // depending on insert order. Playwright reads this once in beforeAll.
  app.get('/__test__/agentbox/fixture', (_req, res) => {
    res.json({ runningRunId: fixture.runningRunId });
  });

  app.get('/p/agentbox/', sessionAuth, (_req, res) => {
    const body = renderDashboard(loadDashboardData(agentboxDb));
    res.type('html').send(wrapPluginPage('Workflows', body));
  });

  app.get('/p/agentbox/queue', sessionAuth, (_req, res) => {
    const issues: QueueIssue[] = AGENTBOX_QUEUE_ISSUES;
    const body = renderQueue(issues, AGENTBOX_FIXTURE_REPO);
    res.type('html').send(wrapPluginPage('Workflows · Queue', body));
  });

  app.get('/p/agentbox/runs', sessionAuth, (req, res) => {
    const page = parsePageParam(req.query.page);
    const body = renderRunHistory(loadRunHistory(agentboxDb, page));
    res.type('html').send(wrapPluginPage('Workflows · Runs', body));
  });

  app.get('/p/agentbox/runs/:id', sessionAuth, (req, res) => {
    const id = parseRunIdParam(req.params.id);
    if (id === null) {
      res.status(400).type('html').send(wrapPluginPage('Workflows · Run', `${renderNavPills('runs')}<div class="agentbox-card"><h2>Bad request</h2></div>`));
      return;
    }
    const detail = loadRunDetail(agentboxDb, id);
    if (!detail) {
      res.status(404).type('html').send(wrapPluginPage('Workflows · Run', `${renderNavPills('runs')}<div class="agentbox-card"><h2>Run not found</h2></div>`));
      return;
    }
    res.type('html').send(wrapPluginPage('Workflows · Run', renderRunDetail(detail)));
  });

  // 404
  app.use((_req, res) => {
    res.status(404).type('html').send('<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>');
  });

  return new Promise((resolve) => {
    server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`E2E test server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

export async function stopE2EServer(): Promise<void> {
  if (agentboxFixtureForTeardown) {
    try { agentboxFixtureForTeardown.rawDb.close(); } catch { /* ignore */ }
    agentboxFixtureForTeardown = null;
  }
  if (!server) return;
  return new Promise((resolve, reject) => {
    (server as Server).close((err) => {
      if (err) reject(err);
      else { server = null; resolve(); }
    });
  });
}
