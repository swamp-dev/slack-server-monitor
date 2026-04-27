import { tmpdir } from 'os';
import { join } from 'path';
import type { AskOptions } from './claude.js';
import type { ConversationTurnResult } from './conversation-processor.js';
import { context as contextBlock } from '../formatters/blocks.js';
import { downloadImageToFile } from '../utils/image.js';
import { logger } from '../utils/logger.js';

export const SLACK_TEXT_LIMIT = 2900;

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface SlackImageFile {
  id: string;
  name?: string | null;
  mimetype: string;
  size: number;
  url_private_download?: string;
}

export interface DownloadImageResult {
  askOptions?: AskOptions;
  tempImagePath?: string;
  error?: string;
}

export async function extractImageFromSlackFiles(
  files: SlackImageFile[] | undefined,
  botToken: string,
): Promise<DownloadImageResult> {
  if (!files || files.length === 0) return {};
  const imageFile = files.find((f) => IMAGE_MIME_TYPES.has(f.mimetype));
  if (!imageFile?.url_private_download) return {};

  try {
    const ext = IMAGE_MIME_TO_EXT[imageFile.mimetype] ?? 'bin';
    const tempImagePath = join(tmpdir(), `ssm-${imageFile.id}.${ext}`);
    await downloadImageToFile(imageFile.url_private_download, tempImagePath, botToken);
    logger.debug('Downloaded Slack file for analysis', { fileId: imageFile.id, path: tempImagePath });
    return { askOptions: { localImagePath: tempImagePath }, tempImagePath };
  } catch (imgError) {
    logger.warn('Failed to download Slack file', { error: imgError, fileId: imageFile.id });
    return { error: imgError instanceof Error ? imgError.message : 'download failed' };
  }
}

export function stripBotMention(text: string, botUserId: string): string {
  if (!botUserId) return text.trim();
  return text
    .replace(new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildContextWarningBlocks(
  contextStatus: ConversationTurnResult['contextStatus'],
): ReturnType<typeof contextBlock>[] {
  if (!contextStatus) return [];
  const blocks: ReturnType<typeof contextBlock>[] = [];

  if (contextStatus.wasTruncated) {
    blocks.push(
      contextBlock(
        `_:memo: Conversation trimmed to fit context window (${String(contextStatus.removedCount)} earlier messages removed, ${String(Math.round(contextStatus.percentUsed * 100))}% context used)_`,
      ),
    );
  } else if (contextStatus.isWarning) {
    blocks.push(
      contextBlock(
        `_:warning: Long conversation — context ${String(Math.round(contextStatus.percentUsed * 100))}% used, older messages may be trimmed soon_`,
      ),
    );
  }

  return blocks;
}
