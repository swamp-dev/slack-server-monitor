import type { Plugin, PluginContext } from '../src/plugins/index.js';
import { createSchema } from './media-organizer/schema.js';
import { startIngestor } from './media-organizer/ingest.js';

const DEFAULT_EVENTS_PATH =
  process.env['MEDIA_ORGANIZER_EVENTS_LOG'] ?? '/var/lib/media-organizer/events.jsonl';

let stopIngestor: (() => void) | null = null;
let db: PluginContext['db'] | null = null;

const mediaOrganizerPlugin: Plugin = {
  name: 'media_organizer',
  version: '0.1.0',
  description: 'Observability for the media-organizer bash script via structured event log',

  async init(ctx: PluginContext): Promise<void> {
    db = ctx.db;
    createSchema(ctx.db);
    stopIngestor = startIngestor(ctx, DEFAULT_EVENTS_PATH);
  },

  async destroy(_ctx: PluginContext): Promise<void> {
    stopIngestor?.();
    stopIngestor = null;
    db = null;
  },

  registerCommands: () => {},
  registerWebRoutes: () => {},
  getWidgets: () => [],
  tools: [],
};

export default mediaOrganizerPlugin;

export function getDb(): PluginContext['db'] | null {
  return db;
}
