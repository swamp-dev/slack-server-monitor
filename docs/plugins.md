# Plugin System

Extend the bot with custom slash commands, Claude AI tools, web pages, and dashboard widgets.

## Quick Start

```bash
# Create the plugins directory (gitignored)
mkdir plugins.local

# Copy an example to start from
cp plugins.example/lift.ts plugins.local/

# Restart the bot
npm run dev
```

Plugins are `.ts` or `.js` files in `plugins.local/` with a default export implementing the `Plugin` interface. They are loaded at startup via [jiti](https://github.com/unjs/jiti) -- no build step required.

## Minimal Example

```typescript
import type { Plugin } from '../src/plugins/index.js';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom plugin',

  registerCommands(app) {
    app.command('/mycommand', async ({ ack, respond }) => {
      await ack();
      await respond('Hello from my plugin!');
    });
  },
};

export default myPlugin;
```

## Plugin Interface

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (lowercase, `[a-z][a-z0-9_-]{0,49}`) |
| `version` | Yes | Semver version |
| `description` | No | Help text |
| `helpEntries` | No | Structured help entries for `/help` display |
| `registerCommands` | No | Function to register Slack slash commands |
| `registerWebRoutes` | No | Register web pages under `/p/{name}/` |
| `webNavEntry` | No | `{ label, icon? }` -- nav bar link to plugin pages |
| `getWidgets` | No | Return `DashboardWidget[]` for the home page |
| `tools` | No | Array of Claude AI tool definitions |
| `init` | No | Async setup hook with `PluginContext` (10s timeout) |
| `destroy` | No | Cleanup hook with `PluginContext` (5s timeout) |

## Slash Commands

```typescript
registerCommands(app) {
  app.command('/mycommand', async ({ ack, respond }) => {
    await ack();
    await respond('Hello!');
  });
},
```

Remember to register the slash command in your Slack App settings too.

## Claude AI Tools

Plugins can provide tools that Claude can call during `/ask` conversations:

```typescript
tools: [
  {
    spec: {
      name: 'my_tool',
      description: 'Does something useful',
      input_schema: { type: 'object', properties: {} },
    },
    execute: async (input) => 'Tool result',
  },
],
```

**Tool naming rules:**
- Lowercase, starts with a letter, 3-50 characters
- Only letters, numbers, and underscores
- Cannot conflict with built-in tool names

**Namespacing:** Plugin tools are automatically namespaced as `pluginname:toolname`. For example, a tool `get_forecast` in plugin `weather` becomes `weather:get_forecast`.

## Database Access

Plugins get scoped database access via `PluginContext.db`. Tables are isolated per-plugin with a required prefix.

```typescript
init: async (ctx: PluginContext) => {
  // Create tables (prefix required, e.g., "plugin_myplugin_")
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS ${ctx.db.prefix}entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL
    )
  `);
},
```

**Querying:**

```typescript
// Insert
ctx.db.prepare(`INSERT INTO ${ctx.db.prefix}entries (user_id, data, created_at) VALUES (?, ?, ?)`)
  .run(userId, JSON.stringify(data), Date.now());

// Query
const rows = ctx.db.prepare(`SELECT * FROM ${ctx.db.prefix}entries WHERE user_id = ?`)
  .all(userId);

// Transaction
ctx.db.transaction(() => {
  stmt1.run(...);
  stmt2.run(...);
});
```

Uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). Database is `./data/claude.db` (shared with core, but tables are isolated to `plugin_{name}_*`).

## Claude API Access

Plugins can call Claude programmatically via `PluginContext.claude` (undefined if Claude is disabled):

```typescript
if (ctx.claude?.enabled) {
  const result = await ctx.claude.ask('What containers are running?', userId, {
    includeBuiltinTools: true,
    systemPromptAddition: 'Additional context...',
    maxTokens: 2048,
    images: [{ data: '...', mediaType: 'image/png' }],
  });
  // result.response, result.toolCalls, result.usage
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `includeBuiltinTools` | false | Include server monitoring tools |
| `systemPromptAddition` | - | Additional context for system prompt |
| `maxTokens` | plugin default | Max response tokens |
| `images` | - | Base64-encoded images for multimodal requests |
| `localImagePath` | - | Local image file path (CLI provider only) |

## Notifications

Push notifications to the web UI notification center:

```typescript
ctx.notify('Backup failed', {
  level: 'error',
  body: 'S3 upload timed out',
  link: '/p/my-plugin/backups',
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `level` | `'info'` | `'info'`, `'warn'`, or `'error'` |
| `body` | - | Additional detail text |
| `link` | - | URL to navigate to when clicked |

## SSE (Real-time Push)

Push events to web clients via Server-Sent Events. Each plugin gets a scoped channel at `/p/{pluginName}/stream`.

```typescript
// Server-side
ctx.sse?.broadcast('status-changed', { light: 'kitchen', state: 'on' });
const count = ctx.sse?.clientCount() ?? 0;
```

```javascript
// Client-side (in plugin web pages)
const es = new EventSource('/p/my-plugin/stream');
es.addEventListener('status-changed', function(e) {
  const data = JSON.parse(e.data);
  // Update UI
});
```

- `ctx.sse` is always present -- silent no-ops when web server is disabled
- SSE endpoints are session-authenticated
- Events are scoped per-plugin (no cross-plugin leakage)
- 30s event buffering handles late-connecting clients

## Dashboard Widgets

Contribute summary cards to the home page:

```typescript
getWidgets: () => [
  {
    title: 'My Stats',
    html: '<p>Active: 5</p>',
    icon: 'chart',
    link: '/p/my-plugin/',
    priority: 10,
    size: 'medium',
  },
],
```

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Card header (HTML-escaped) |
| `html` | Yes | Card body (**rendered verbatim** -- plugin must escape user data) |
| `icon` | No | Icon name from the icon system |
| `link` | No | Makes title clickable (sanitized via allowlist) |
| `priority` | No | Sort order (lower first, default: 100) |
| `size` | No | `'small'`, `'medium'`, or `'large'` (grid span) |

## Web Routes

Register pages under `/p/{pluginName}/`:

```typescript
import { renderPluginPage, pluginCard, pluginTable } from '../src/plugins/index.js';

registerWebRoutes(router) {
  router.get('/', (req, res, ctx) => {
    res.send(renderPluginPage({
      title: 'My Plugin',
      pluginName: ctx.name,
      body: pluginCard('Stats', pluginTable(['Metric', 'Value'], [['CPU', '42%']])),
    }));
  });
},

// Add a nav bar link
webNavEntry: { label: 'My Plugin', icon: 'star' },
```

Routes are scoped, session-authenticated, and wrapped with error handling.

### Template Helpers

Import from `../src/plugins/index.js`:

| Function | Description |
|----------|-------------|
| `renderPluginPage(opts)` | Full page with standard shell (nav, theme, shortcuts) |
| `pluginStyles(name, css)` | Scope CSS under `.plugin-{name}` |
| `pluginCard(title, body, opts?)` | Themed card component |
| `pluginTable(headers, rows)` | Theme-aware table (auto-escaped) |
| `pluginChart(data)` | Horizontal CSS bar chart |
| `escapeHtml(text)` | HTML entity escaping |
| `icon(name, size)` | Inline SVG icon |
| `sanitizeUrl(url)` | URL allowlist (http/https/relative only) |
| `formatTimestamp(ts)` | Human-readable date/time |

## Security

**Plugins run with full process privileges.** Only install plugins from trusted sources.

Plugins can access all environment variables, execute arbitrary code, make network requests, access the filesystem, and store data in the shared SQLite database. The `PluginApp` wrapper and `PluginDatabase` provide defense-in-depth (validation, logging, table isolation) but not true sandboxing.

### Lifecycle Timeouts

| Hook | Timeout | On Timeout |
|------|---------|------------|
| `init()` | 10 seconds | Plugin not loaded |
| `destroy()` | 5 seconds | Warning logged, continues |

### Atomic Loading

If any step fails (validation, init, command registration), the entire plugin is skipped.

### Writing Secure Plugins

1. **Validate all input** -- use Zod schemas for tool inputs
2. **Respect allowed directories** -- use `config.allowedDirs` for file access
3. **Don't store secrets** -- use environment variables
4. **Log appropriately** -- use `logger` from `../src/utils/logger.js`
5. **Handle errors gracefully** -- don't leak stack traces
6. **Test your plugin** -- colocate tests as `my-plugin.test.ts` (excluded from plugin loading)

## Example Plugins

In `plugins.example/`:

| Plugin | File | Description |
|--------|------|-------------|
| **lift** | `lift.ts` | Powerlifting calculator, bodyweight tracking, workout logging |
| **health** | `health.ts` | Family health tracker (medications, appointments, vaccinations) |
| **hue** | `hue.ts` | Philips Hue light control |
| **web-assistant** | `web-assistant.ts` | Web search integration |
| **agentbox** | `agentbox.ts` | GitHub issue integration with AgentBox |

```bash
# Try an example
cp plugins.example/lift.ts plugins.local/
npm run dev
```

## Docker Deployment

Mount `plugins.local/` as a volume:

```bash
docker run -d \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /path/to/plugins.local:/app/plugins.local:ro \
  slack-monitor
```

When deploying via the Ansible role, plugins are automatically mounted when `slack_monitor_plugins_enabled: true` (the default). See [Deployment](deployment.md#ansible).
