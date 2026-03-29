# Epic: Platform-Agnostic Messaging Support

> **Goal:** Refactor the Slack Server Monitor into a platform-agnostic server monitor that can run on Slack, Discord, Telegram, or Microsoft Teams with a shared core.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Coupling Inventory](#coupling-inventory)
4. [Target Architecture](#target-architecture)
5. [Interface Definitions](#interface-definitions)
6. [Migration Plan](#migration-plan)
7. [Ticket Breakdown](#ticket-breakdown)
8. [Platform Comparison Matrix](#platform-comparison-matrix)
9. [Risk Register](#risk-register)

---

## Executive Summary

The slack-server-monitor is a TypeScript application that monitors home server infrastructure via chat commands and AI-assisted diagnostics. Its core monitoring logic (Docker, system, security, file operations) is platform-agnostic, but ~70-80% of the codebase is tightly coupled to Slack's APIs, data structures, and messaging primitives.

This epic proposes an adapter-based refactoring that separates the platform layer from the business logic, enabling the same server monitor to run on any supported messaging platform.

**Estimated total effort:** 6-8 weeks across 4 phases and ~20 tickets.

---

## Current Architecture Analysis

### Layers (Top to Bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  Entry Point: app.ts                                        │
│  @slack/bolt App, Socket Mode init, middleware registration  │
├─────────────────────────────────────────────────────────────┤
│  Middleware: authorize.ts, rate-limit.ts, audit-log.ts       │
│  Slack command args (user_id, channel_id, command)           │
├─────────────────────────────────────────────────────────────┤
│  Commands: 14 slash commands + thread handler                │
│  app.command() registration, ack/respond/client pattern      │
├─────────────────────────────────────────────────────────────┤
│  Formatters: blocks.ts (552 lines)                           │
│  100% Slack Block Kit (HeaderBlock, SectionBlock, etc.)      │
├─────────────────────────────────────────────────────────────┤
│  Services: conversation-store, context-store, session-store  │
│  SQLite with thread_ts/channel_id as primary keys            │
├─────────────────────────────────────────────────────────────┤
│  Claude AI: claude.ts (provider abstraction)          ← OK  │
│  Executors: docker, system, security, file ops        ← OK  │
│  Tools: tool definitions for Claude                   ← OK  │
│  Utils: shell execution, output scrubbing             ← OK  │
└─────────────────────────────────────────────────────────────┘
```

### What's Reusable Today (No Changes Needed)

| Component | Why It's Portable |
|-----------|-------------------|
| `src/services/claude.ts` | Provider abstraction (SDK/CLI/hybrid) - no Slack types |
| `src/services/tools/*` | Claude tool definitions - pure schemas |
| `src/executors/*` | Docker, system, security commands - pure shell |
| `src/utils/shell.ts` | Command execution, timeout, output scrubbing |
| `src/utils/scrub.ts` | Sensitive data redaction |
| Rate limit algorithm | Token bucket logic is platform-agnostic (keys need abstracting) |

### What Must Change

| Component | File(s) | Lines | Coupling Type |
|-----------|---------|-------|---------------|
| App initialization | `app.ts` | 137 | `@slack/bolt` App, Socket Mode |
| Command registration | `commands/*.ts` (14 files) | ~2500 | `app.command()`, `SlackCommandMiddlewareArgs` |
| Thread handler | `commands/ask.ts` (lines 568-757) | 190 | `app.event('message')`, `event.thread_ts` |
| Message formatting | `formatters/blocks.ts` | 552 | `KnownBlock`, `HeaderBlock`, `SectionBlock` |
| Auth middleware | `middleware/authorize.ts` | 62 | `command.user_id`, `command.channel_id` |
| Audit middleware | `middleware/audit-log.ts` | 42 | Slack command object destructuring |
| Conversation store | `services/conversation-store.ts` | 1152 | `thread_ts`+`channel_id` composite key |
| Context store | `services/context-store.ts` | 134 | `channel_id` as primary key |
| Session store | `services/session-store.ts` | 172 | Slack `user_id` for sessions |
| Config/validation | `config/schema.ts` | 207 | `xoxb-`/`xapp-` token validation, Slack ID regexes |
| Web server | `web/server.ts` | 721 | `slack://` deeplinks, `/c/:threadTs/:channelId` routes |
| Web templates | `web/templates.ts` | 2700 | Slack thread links, channel references |
| Plugin interface | `plugins/types.ts` | 245 | `App` from `@slack/bolt` in plugin registration |

---

## Coupling Inventory

### Slack NPM Dependencies

```json
{
  "@slack/bolt": "4.1.0",    // Entire command framework + Socket Mode
  "@slack/types": "^2.x"     // KnownBlock, HeaderBlock, etc. (transitive)
}
```

### Slack-Specific Data Formats

| Format | Where Used | Example Value |
|--------|-----------|---------------|
| `thread_ts` | conversation-store, ask.ts, web routes | `"1234567890.123456"` |
| `channel_id` | conversation-store, context-store, authorize | `"C01ABC123"` |
| `user_id` | session-store, authorize, rate-limit keys | `"U01ABC123"` |
| Bot token | config, app.ts | `"xoxb-..."` |
| App token | config, app.ts | `"xapp-..."` |
| `slack://` URLs | blocks.ts, templates.ts | `"slack://channel?team=&id=C01&thread_ts=123"` |

### Slack API Methods Called

| Method | File | Purpose |
|--------|------|---------|
| `client.chat.postMessage()` | ask.ts | Post initial "Thinking..." and threaded replies |
| `client.chat.update()` | ask.ts | Replace "Thinking..." with actual response |
| `app.command()` | all command files | Register slash command handlers |
| `app.event('message')` | ask.ts thread handler | Listen for thread replies |
| `ack()` | all command files | Acknowledge within 3s timeout |
| `respond()` | all command files | Send ephemeral/in_channel response |

### Database Schema (Slack IDs as Keys)

```sql
-- conversations: thread_ts + channel_id is the composite unique key
UNIQUE(thread_ts, channel_id)

-- channel_context: channel_id is the primary key
channel_id TEXT PRIMARY KEY

-- web_sessions: user_id stores Slack user ID
user_id TEXT NOT NULL
```

---

## Target Architecture

### Adapter Pattern

```
┌─────────────────────────────────────────────────────────────┐
│  Entry Point: app.ts                                        │
│  Reads PLATFORM env var → instantiates correct adapter      │
├─────────────────────────────────────────────────────────────┤
│  Platform Adapter Interface                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  Slack    │ │ Discord  │ │ Telegram │ │  Teams   │      │
│  │ Adapter   │ │ Adapter  │ │ Adapter  │ │ Adapter  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
├─────────────────────────────────────────────────────────────┤
│  Command Router (platform-agnostic)                          │
│  Receives CommandContext, dispatches to handler functions     │
├─────────────────────────────────────────────────────────────┤
│  Message Formatter Interface                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ BlockKit  │ │ Embeds   │ │  HTML    │ │ Adaptive │      │
│  │ (Slack)   │ │(Discord) │ │(Telegram)│ │ (Teams)  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
├─────────────────────────────────────────────────────────────┤
│  Core Services (unchanged)                                   │
│  Claude AI, Executors, Tools, Conversation Store             │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure (Target)

```
src/
├── adapters/
│   ├── types.ts                    # Platform interfaces
│   ├── slack/
│   │   ├── adapter.ts              # SlackPlatform implements PlatformAdapter
│   │   ├── formatter.ts            # Block Kit formatting
│   │   └── config.ts               # Slack-specific env/validation
│   ├── discord/
│   │   ├── adapter.ts              # DiscordPlatform
│   │   ├── formatter.ts            # Embed formatting
│   │   └── config.ts
│   └── telegram/
│       ├── adapter.ts              # TelegramPlatform
│       ├── formatter.ts            # HTML formatting
│       └── config.ts
├── commands/                       # Handlers receive CommandContext (not Slack args)
│   ├── registry.ts                 # Maps command names → handlers
│   ├── ask.ts                      # Refactored: no Slack imports
│   ├── status.ts
│   └── ...
├── formatters/
│   ├── types.ts                    # FormattedMessage, MessageBlock interfaces
│   └── shared.ts                   # statusEmoji, progressBar, formatBytes (reusable)
├── middleware/                     # Operates on CommandContext (not Slack args)
├── services/                      # Unchanged (store uses generic IDs)
├── executors/                     # Unchanged
├── web/                           # Parameterized deeplinks
├── config/
│   ├── schema.ts                  # Platform-agnostic base + per-platform schemas
│   └── index.ts
└── app.ts                         # Platform factory
```

---

## Interface Definitions

### PlatformAdapter

The central abstraction. Each messaging platform implements this interface.

```typescript
interface PlatformAdapter {
  /** Platform identifier */
  readonly platform: 'slack' | 'discord' | 'telegram' | 'teams';

  /** Start the bot connection (Socket Mode, Gateway, polling, etc.) */
  start(): Promise<void>;

  /** Graceful shutdown */
  stop(): Promise<void>;

  /** Register a command handler */
  registerCommand(name: string, handler: CommandHandler): void;

  /** Register a thread/reply handler for conversational follow-ups */
  registerThreadHandler(handler: ThreadHandler): void;

  /** Send a new message to a channel/chat */
  sendMessage(channel: string, message: FormattedMessage): Promise<MessageRef>;

  /** Update an existing message (for "Thinking..." → response pattern) */
  updateMessage(ref: MessageRef, message: FormattedMessage): Promise<void>;

  /** Send a reply in a thread/conversation */
  replyInThread(ref: MessageRef, message: FormattedMessage): Promise<MessageRef>;

  /** Generate a deeplink URL back to a message in the platform */
  getMessageLink(ref: MessageRef): string | null;
}
```

### CommandContext

Replaces `SlackCommandMiddlewareArgs & AllMiddlewareArgs`. Every command handler receives this instead of Slack-specific args.

```typescript
interface CommandContext {
  /** Platform-agnostic user identifier */
  userId: string;

  /** Platform-agnostic channel/chat identifier */
  channelId: string;

  /** Display name of the user */
  userName: string;

  /** Display name of the channel */
  channelName: string;

  /** The command name (without prefix) */
  command: string;

  /** The command arguments (text after the command) */
  args: string;

  /** The platform this command came from */
  platform: 'slack' | 'discord' | 'telegram' | 'teams';

  /** Respond ephemerally (only visible to invoking user) */
  respondEphemeral(message: FormattedMessage): Promise<void>;

  /** Respond publicly (visible to entire channel) */
  respondPublic(message: FormattedMessage): Promise<void>;

  /** Get the underlying platform adapter for advanced operations */
  getAdapter(): PlatformAdapter;
}
```

### ThreadContext

For handling follow-up messages in a conversation thread.

```typescript
interface ThreadContext {
  userId: string;
  channelId: string;
  userName: string;
  /** Reference to the parent message/thread */
  threadRef: MessageRef;
  /** The reply text */
  text: string;
  platform: 'slack' | 'discord' | 'telegram' | 'teams';
  getAdapter(): PlatformAdapter;
}
```

### MessageRef

Platform-agnostic reference to a message, replacing `thread_ts + channel_id`.

```typescript
interface MessageRef {
  /** Platform-specific message identifier (thread_ts for Slack, message ID for Discord, etc.) */
  messageId: string;

  /** Platform-specific channel/chat identifier */
  channelId: string;

  /** Which platform this ref belongs to */
  platform: 'slack' | 'discord' | 'telegram' | 'teams';
}
```

### FormattedMessage

Platform-agnostic message structure. Each platform's formatter converts this into native format.

```typescript
interface FormattedMessage {
  /** Blocks that compose the message */
  blocks: MessageBlock[];

  /** Plain text fallback (for notifications, accessibility) */
  fallbackText: string;
}

type MessageBlock =
  | { type: 'header'; text: string }
  | { type: 'text'; text: string; style?: 'bold' | 'italic' | 'code' }
  | { type: 'fields'; fields: Array<{ label: string; value: string }> }
  | { type: 'code'; code: string; language?: string }
  | { type: 'divider' }
  | { type: 'context'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'link'; url: string; text: string };
```

### MessageFormatter

Each platform implements this to convert `FormattedMessage` into native format.

```typescript
interface MessageFormatter {
  /** Convert a FormattedMessage to platform-native format */
  format(message: FormattedMessage): unknown;

  /** Max message length for this platform */
  readonly maxLength: number;

  /** Whether this platform supports message editing */
  readonly supportsEdit: boolean;

  /** Whether this platform supports threading */
  readonly supportsThreads: boolean;

  /** Whether this platform supports ephemeral messages */
  readonly supportsEphemeral: boolean;
}
```

---

## Migration Plan

### Phase 1: Introduce Abstractions (No Behavior Change)

Create the interface layer and refactor Slack code behind it. The app still only runs on Slack, but the coupling is isolated to `src/adapters/slack/`.

**Key principle:** No functionality changes. Every commit should pass existing tests. This is a pure refactoring phase.

### Phase 2: Generalize Data Layer

Migrate the SQLite schema from Slack-specific IDs (`thread_ts`, `channel_id` with `C...` format) to platform-agnostic identifiers. Add a `platform` column. Update all store methods.

### Phase 3: First Alternative Platform (Discord)

Discord is the most architecturally similar to Slack: channels, threads, rich embeds (analogous to Block Kit), bot tokens, gateway connection (analogous to Socket Mode). It's the lowest-risk first port.

### Phase 4: Additional Platforms

Telegram and Teams each have unique constraints that test the abstraction's flexibility.

---

## Ticket Breakdown

### Phase 1: Abstractions (Est. 2 weeks)

#### Ticket 1.1: Define Platform Interfaces

**Scope:** Create `src/adapters/types.ts` with all interfaces defined above (`PlatformAdapter`, `CommandContext`, `ThreadContext`, `MessageRef`, `FormattedMessage`, `MessageBlock`, `MessageFormatter`).

**Acceptance criteria:**
- Interfaces compile with no implementation
- Exported from a barrel file
- Unit tests validate interface contracts with mock implementations

**Effort:** S

---

#### Ticket 1.2: Extract Shared Formatting Utilities

**Scope:** Move platform-agnostic helpers out of `src/formatters/blocks.ts` into `src/formatters/shared.ts`.

**Functions to extract (no Slack types in signatures):**
- `statusEmoji(status)` → returns string (`:large_green_circle:`, etc.)
- `progressBar(value, max, width?)` → returns ASCII string
- `formatBytes(bytes)` → returns string
- `formatUptime(seconds)` → returns string
- `formatTable(headers, rows)` → returns string
- `extractSnippet(text, maxLength?)` → returns string

**Functions that stay in Slack formatter (return `KnownBlock`):**
- `header()`, `section()`, `sectionWithFields()`, `divider()`, `context()`
- `codeBlock()`, `compactStatusRow()`, `statsBar()`, `threadLink()`
- `buildResponse()`, `buildChannelResponse()`

**Acceptance criteria:**
- Shared utils have no `@slack/types` imports
- Existing `blocks.ts` imports from `shared.ts`
- All existing tests pass

**Effort:** S

---

#### Ticket 1.3: Implement SlackAdapter

**Scope:** Wrap existing `@slack/bolt` App initialization, command registration, and message sending behind the `PlatformAdapter` interface.

**Current code to wrap (`app.ts` lines 38-53):**
```typescript
const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
});
```

**Becomes:**
```typescript
class SlackAdapter implements PlatformAdapter {
  private app: App;
  start() { return this.app.start(); }
  stop() { return this.app.stop(); }
  registerCommand(name, handler) {
    this.app.command(`/${name}`, async ({ command, ack, respond, client }) => {
      await ack();
      const ctx = this.buildCommandContext(command, respond, client);
      await handler(ctx);
    });
  }
  // ...
}
```

**Acceptance criteria:**
- `app.ts` instantiates `SlackAdapter` instead of `@slack/bolt` `App` directly
- All existing commands work without modification (adapter translates)
- SlackAdapter passes platform adapter contract tests

**Effort:** M

---

#### Ticket 1.4: Implement SlackFormatter

**Scope:** Move all Block Kit building functions into `src/adapters/slack/formatter.ts` implementing `MessageFormatter`.

**Core conversion:** `FormattedMessage` → `KnownBlock[]`

```typescript
class SlackFormatter implements MessageFormatter {
  readonly maxLength = 3000;
  readonly supportsEdit = true;
  readonly supportsThreads = true;
  readonly supportsEphemeral = true;

  format(message: FormattedMessage): { blocks: KnownBlock[]; text: string } {
    return {
      blocks: message.blocks.map(block => this.convertBlock(block)),
      text: message.fallbackText,
    };
  }

  private convertBlock(block: MessageBlock): KnownBlock {
    switch (block.type) {
      case 'header': return { type: 'header', text: { type: 'plain_text', text: block.text } };
      case 'text': return { type: 'section', text: { type: 'mrkdwn', text: block.text } };
      case 'fields': return { type: 'section', fields: block.fields.map(f => ({ type: 'mrkdwn', text: `*${f.label}:*\n${f.value}` })) };
      case 'divider': return { type: 'divider' };
      // ...
    }
  }
}
```

**Acceptance criteria:**
- All existing command outputs render identically via the new formatter
- `blocks.ts` is retired; all imports updated
- Snapshot tests capture current output for regression detection

**Effort:** M

---

#### Ticket 1.5: Refactor Commands to Use CommandContext

**Scope:** Refactor all 14 command handler files to accept `CommandContext` instead of destructuring `SlackCommandMiddlewareArgs & AllMiddlewareArgs`.

**Before (every command):**
```typescript
export function registerStatusCommand(app: App) {
  app.command('/services', async ({ command, ack, respond }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) => {
    await ack();
    const blocks: KnownBlock[] = [header('Services'), ...];
    await respond({ blocks, response_type: 'ephemeral' });
  });
}
```

**After:**
```typescript
export async function handleStatus(ctx: CommandContext): Promise<void> {
  const message: FormattedMessage = {
    blocks: [{ type: 'header', text: 'Services' }, ...],
    fallbackText: 'Service status report',
  };
  await ctx.respondEphemeral(message);
}
```

**Note:** The SlackAdapter's `registerCommand()` bridges the gap — it receives Slack args, builds a `CommandContext`, and calls the handler.

**Acceptance criteria:**
- No command file imports from `@slack/bolt` or `@slack/types`
- All commands use `FormattedMessage` for output
- Command registry maps names → handler functions
- All existing tests pass

**Effort:** L (14 files, largest change in the epic)

---

#### Ticket 1.6: Refactor Thread Handler to Use ThreadContext

**Scope:** Extract the thread reply handler from `ask.ts` (lines 568-757) into a platform-agnostic handler that receives `ThreadContext`.

**Current Slack-specific flow:**
1. `app.event('message')` fires on all messages
2. Check `event.thread_ts !== event.ts` to identify replies
3. Look up conversation by `thread_ts + channel_id`
4. Post thinking message via `client.chat.postMessage()`
5. Update with response via `client.chat.update()`

**Target flow:**
1. Adapter calls registered `ThreadHandler` when a reply is detected
2. Handler receives `ThreadContext` with `threadRef`, `text`, `userId`
3. Handler calls `adapter.replyInThread(ref, thinkingMessage)`
4. Handler calls `adapter.updateMessage(thinkingRef, responseMessage)`

**Acceptance criteria:**
- Thread handler has no `@slack/bolt` imports
- SlackAdapter's `registerThreadHandler()` translates Slack events → `ThreadContext`
- Conversational follow-ups work identically

**Effort:** M

---

#### Ticket 1.7: Refactor Middleware to Use CommandContext

**Scope:** Update `authorize.ts`, `rate-limit.ts`, and `audit-log.ts` to operate on `CommandContext` instead of Slack middleware args.

**Key changes:**
- `authorize`: Check `ctx.userId` against allowed IDs (no Slack format assumption)
- `rate-limit`: Key format changes from `"U123:/ask"` to `"{userId}:{command}"`
- `audit-log`: Log from `CommandContext` fields

**Acceptance criteria:**
- No middleware file imports from `@slack/bolt`
- Middleware chain operates on `CommandContext`
- Authorization still silently rejects unauthorized users

**Effort:** S

---

#### Ticket 1.8: Refactor Plugin Interface

**Scope:** Update `src/plugins/types.ts` so plugins register against the platform-agnostic `PlatformAdapter` instead of `@slack/bolt` `App`.

**Before:**
```typescript
registerCommands?: (app: App | PluginApp) => void | Promise<void>;
```

**After:**
```typescript
registerCommands?: (adapter: PlatformAdapter) => void | Promise<void>;
```

**Acceptance criteria:**
- Plugin interface has no `@slack/bolt` types
- Existing plugins (if any loaded from `plugins.example`) still work via SlackAdapter
- Plugin tools unchanged (already platform-agnostic)

**Effort:** S

---

### Phase 2: Generalize Data Layer (Est. 1 week)

#### Ticket 2.1: Abstract Conversation Store Identifiers

**Scope:** Replace `thread_ts`/`channel_id` with `messageId`/`channelId`/`platform` in the SQLite schema and all store methods.

**Schema migration:**
```sql
-- Before
CREATE TABLE conversations (
  thread_ts TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  UNIQUE(thread_ts, channel_id)
);

-- After
CREATE TABLE conversations (
  message_id TEXT NOT NULL,          -- was thread_ts
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'slack',
  UNIQUE(message_id, channel_id, platform)
);
```

**Method signature changes:**
- `getConversation(threadTs, channelId)` → `getConversation(messageId, channelId, platform)`
- `getOrCreateConversation(threadTs, channelId, userId, msg)` → `getOrCreateConversation(ref: MessageRef, userId, msg)`

**Acceptance criteria:**
- Migration runs on existing databases without data loss
- All store consumers updated to pass `MessageRef`
- Indexes updated for new composite key

**Effort:** M

---

#### Ticket 2.2: Abstract Context Store and Session Store

**Scope:** Update `context-store.ts` and `session-store.ts` to use generic identifiers.

**Context store:** `channel_id` stays as a string but drops Slack format validation. Add `platform` column.

**Session store:** `user_id` stays as a string but drops Slack `U...` format assumption. Add `platform` column.

**Acceptance criteria:**
- No Slack ID format assumptions in store code
- Migration preserves existing data with `platform = 'slack'` default

**Effort:** S

---

#### Ticket 2.3: Abstract Config and Validation

**Scope:** Refactor `config/schema.ts` to support multiple platforms.

**Before:**
```typescript
const SlackUserIdSchema = z.string().regex(/^U[A-Z0-9]+$/);
const configSchema = z.object({
  slack: z.object({
    botToken: z.string().startsWith('xoxb-'),
    appToken: z.string().startsWith('xapp-'),
  }),
  authorization: z.object({
    userIds: z.array(SlackUserIdSchema),
  }),
});
```

**After:**
```typescript
const configSchema = z.object({
  platform: z.enum(['slack', 'discord', 'telegram', 'teams']),
  // Platform-specific config loaded dynamically based on platform value
  platformConfig: z.union([slackConfigSchema, discordConfigSchema, ...]),
  authorization: z.object({
    userIds: z.array(z.string()),  // No format assumption
  }),
});
```

**Environment variables:**
```bash
# Required
PLATFORM=slack                          # or discord, telegram, teams

# Slack-specific
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# Discord-specific (future)
DISCORD_BOT_TOKEN=...
DISCORD_APPLICATION_ID=...

# Telegram-specific (future)
TELEGRAM_BOT_TOKEN=...

# Shared
AUTHORIZED_USER_IDS=U01ABC,U02DEF      # Platform-native IDs
AUTHORIZED_CHANNEL_IDS=C01ABC          # Platform-native IDs
```

**Acceptance criteria:**
- `PLATFORM=slack` works identically to current behavior
- Config validation is per-platform
- Missing platform-specific env vars produce clear error messages

**Effort:** M

---

#### Ticket 2.4: Refactor Web Server for Generic Deeplinks

**Scope:** Replace Slack-specific URLs and deeplinks in `web/server.ts` and `web/templates.ts`.

**Changes:**
- Route `/c/:threadTs/:channelId` → `/c/:platform/:messageId/:channelId`
- `slack://channel?...` deeplinks → `adapter.getMessageLink(ref)`
- "Reply in Slack" → "Reply in {platform name}"
- HMAC token generation works with generic user IDs

**Acceptance criteria:**
- Web UI works for Slack with updated routes
- Deeplinks are generated by the platform adapter, not hardcoded
- Templates accept platform name for display strings

**Effort:** M

---

### Phase 3: Discord Adapter (Est. 2 weeks)

#### Ticket 3.1: Implement DiscordAdapter

**Scope:** Implement `PlatformAdapter` for Discord using `discord.js`.

**Mapping:**

| Concept | Slack | Discord |
|---------|-------|---------|
| Connection | Socket Mode (WebSocket) | Gateway (WebSocket) |
| Auth | Bot token + App token | Bot token |
| Commands | Slash commands (`/ask`) | Slash commands (registered via API) |
| Threading | `thread_ts` | Forum threads or message replies |
| Ephemeral | `response_type: 'ephemeral'` | `ephemeral: true` on `interaction.reply()` |
| Edit message | `chat.update()` | `message.edit()` |
| Channel ID | `C01ABC123` | Snowflake (`123456789012345678`) |
| User ID | `U01ABC123` | Snowflake |

**Key implementation details:**
- Register slash commands via Discord's Application Commands API
- Use `InteractionCreate` event for command handling
- Use `MessageCreate` event for thread replies
- Discord threads are first-class objects (create with `channel.threads.create()`)

**Dependencies:** `discord.js` package

**Acceptance criteria:**
- Bot connects to Discord gateway
- All commands register as Discord slash commands
- Ephemeral and public responses work
- Thread replies create/continue Discord threads

**Effort:** L

---

#### Ticket 3.2: Implement DiscordFormatter

**Scope:** Implement `MessageFormatter` for Discord using Embed objects.

**Mapping:**

| FormattedMessage block | Slack Block Kit | Discord Embed |
|------------------------|----------------|---------------|
| `header` | `HeaderBlock` | Embed title |
| `text` | `SectionBlock` with mrkdwn | Embed description (Markdown) |
| `fields` | `SectionBlock` with fields | Embed fields (inline) |
| `code` | SectionBlock with code block | Description with code block |
| `divider` | `DividerBlock` | Horizontal rule in description |
| `context` | `ContextBlock` | Embed footer |
| `table` | Formatted text | Code block table |

**Constraints:**
- Discord embeds max 6000 chars total, 25 fields max
- Multiple embeds can be sent per message (up to 10)
- Markdown syntax differs slightly (Discord uses standard MD, Slack uses mrkdwn)

**Acceptance criteria:**
- All `FormattedMessage` block types render correctly
- Long messages split across multiple embeds
- Output is visually equivalent to Slack formatting

**Effort:** M

---

#### Ticket 3.3: Discord Config and Auth

**Scope:** Add Discord-specific configuration schema and authorization logic.

**Environment variables:**
```bash
PLATFORM=discord
DISCORD_BOT_TOKEN=...
DISCORD_APPLICATION_ID=...
DISCORD_GUILD_ID=...                    # Optional: restrict to one server
AUTHORIZED_USER_IDS=123456789012345678  # Discord snowflakes
AUTHORIZED_CHANNEL_IDS=987654321098765432
```

**Acceptance criteria:**
- Discord config validates correctly
- Authorization works with Discord snowflake IDs
- Rate limiting works with Discord user IDs

**Effort:** S

---

#### Ticket 3.4: Discord Integration Tests

**Scope:** End-to-end tests for the Discord adapter using a test bot in a test server.

**Test scenarios:**
- Command registration and invocation
- Ephemeral vs public responses
- Thread creation and follow-up
- Message editing ("Thinking..." → response)
- Long message handling (embed splitting)
- Authorization rejection
- Rate limiting

**Acceptance criteria:**
- Test suite can run against a real Discord test server
- Mock adapter available for unit tests
- All command outputs verified

**Effort:** M

---

### Phase 4: Additional Platforms (Est. 1-2 weeks each)

#### Ticket 4.1: Implement TelegramAdapter

**Scope:** Implement `PlatformAdapter` for Telegram using `telegraf` or `node-telegram-bot-api`.

**Unique challenges:**
- No slash command framework — use Bot Commands menu + text parsing
- No native rich formatting — use HTML or MarkdownV2
- No ephemeral messages — use DM or inline query results
- Threading via `reply_to_message_id` (weak threading model)
- Message length limit: 4096 chars
- No message editing after 48 hours

**Effort:** L

---

#### Ticket 4.2: Implement TelegramFormatter

**Scope:** Convert `FormattedMessage` to Telegram HTML.

**Mapping:**

| FormattedMessage block | Telegram HTML |
|------------------------|---------------|
| `header` | `<b>Header</b>` |
| `text` | Plain text or `<b>`/`<i>`/`<code>` |
| `fields` | `<b>Label:</b> value` (line-separated) |
| `code` | `<pre><code class="lang">...</code></pre>` |
| `divider` | `───────────` |
| `context` | `<i>context text</i>` |

**Effort:** M

---

#### Ticket 4.3: Implement TeamsAdapter (Optional/Future)

**Scope:** Microsoft Teams via Bot Framework SDK.

**Unique challenges:**
- Azure AD authentication (most complex auth model)
- Adaptive Cards (JSON-based card format, similar in spirit to Block Kit)
- Teams threading model (reply chains in channels)
- Enterprise deployment considerations (admin consent, app catalog)

**Effort:** XL (Azure AD alone is significant)

---

## Platform Comparison Matrix

| Feature | Slack | Discord | Telegram | Teams |
|---------|-------|---------|----------|-------|
| **Connection** | Socket Mode (WS) | Gateway (WS) | Long polling / Webhook | Bot Framework (HTTPS) |
| **Auth model** | Bot + App tokens | Bot token | Bot token | Azure AD + Bot secret |
| **Slash commands** | Native | Native (API-registered) | Bot Commands menu | Messaging extensions |
| **Threading** | `thread_ts` | Forum threads / replies | `reply_to_message_id` | Reply chains |
| **Rich formatting** | Block Kit (JSON blocks) | Embeds (JSON) | HTML / MarkdownV2 | Adaptive Cards (JSON) |
| **Ephemeral msgs** | Yes | Yes | No (use DM) | Yes |
| **Edit messages** | Yes | Yes | Yes (48h limit) | Yes |
| **Max msg length** | ~3000 chars (blocks) | 6000 chars (embeds) | 4096 chars | ~28KB (Adaptive Card) |
| **File uploads** | Yes | Yes | Yes | Yes |
| **Reactions** | Emoji reactions | Emoji reactions | Reactions (limited) | Reactions |
| **NPM package** | `@slack/bolt` | `discord.js` | `telegraf` | `botbuilder` |
| **Complexity** | Medium | Medium | Low-Medium | High |

---

## Risk Register

### R1: Formatting Fidelity Loss

**Risk:** The abstract `MessageBlock` type may not capture all nuances of Slack Block Kit, leading to degraded output on Slack after refactoring.

**Mitigation:** Snapshot tests of all current command outputs before refactoring. Compare rendered output after each change. Allow platform-specific escape hatches in the formatter for edge cases.

**Severity:** Medium | **Likelihood:** Medium

---

### R2: Threading Model Mismatch

**Risk:** Slack's `thread_ts` model (any message can become a thread parent) is unique. Discord requires explicit thread creation. Telegram's reply chains are flat. The abstraction may not fit all models cleanly.

**Mitigation:** The `MessageRef` abstraction is intentionally simple. Each adapter handles thread creation in its own way. Accept that threading behavior will differ across platforms — aim for functional equivalence, not identical behavior.

**Severity:** High | **Likelihood:** High

---

### R3: Ephemeral Message Gaps

**Risk:** Telegram has no ephemeral messages. Commands that currently respond ephemerally (most commands) would become visible to the entire chat.

**Mitigation:** For platforms without ephemeral support, fall back to DM responses. Add a `supportsEphemeral` flag to `MessageFormatter` so commands can adapt their behavior.

**Severity:** Low | **Likelihood:** Certain (Telegram)

---

### R4: Rate Limit Differences

**Risk:** Each platform has different API rate limits. Slack allows ~1 msg/sec/channel; Discord is more generous but has global rate limits; Telegram limits to 30 msgs/sec across all chats.

**Mitigation:** Each adapter manages its own platform rate limits internally, separate from the application-level user rate limiting that already exists.

**Severity:** Low | **Likelihood:** Low

---

### R5: Plugin Ecosystem Breakage

**Risk:** Existing plugins (or plugins written against the current `@slack/bolt` interface) will break after the interface change.

**Mitigation:** Bump major version. Provide a migration guide. The plugin system is not widely used externally, so blast radius is small.

**Severity:** Low | **Likelihood:** Certain

---

### R6: Scope Creep into Platform-Specific Features

**Risk:** Each platform has unique features (Discord voice channels, Telegram inline mode, Teams tabs) that may tempt expansion beyond the core monitoring use case.

**Mitigation:** Keep the abstraction minimal. Platform-specific features can be added as optional adapter methods, not required interface members. Defer anything not needed for the core command/response/thread flow.

**Severity:** Medium | **Likelihood:** Medium

---

### R7: Increased Testing Surface

**Risk:** Supporting N platforms multiplies the test matrix. Each platform adapter needs its own integration tests with real platform APIs.

**Mitigation:** Strong contract tests against the `PlatformAdapter` interface (mock-based). Integration tests per platform use dedicated test bots/servers. CI runs contract tests; integration tests run on-demand.

**Severity:** Medium | **Likelihood:** Certain
