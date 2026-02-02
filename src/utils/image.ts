/**
 * Image utilities for fetching and processing images
 */

import { writeFile, unlink } from 'fs/promises';
import { logger } from './logger.js';

/**
 * Supported image MIME types
 */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Result from fetching an image
 */
export interface FetchedImage {
  data: string; // base64
  mediaType: ImageMediaType;
}

/**
 * Maximum image size in bytes (5MB)
 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Fetch timeout in milliseconds (30s)
 */
const FETCH_TIMEOUT = 30_000;

/**
 * Map Content-Type to ImageMediaType
 */
const CONTENT_TYPE_MAP: Record<string, ImageMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

/**
 * Validate that a URL is a valid image URL
 * - Must be HTTPS (or Slack's internal file:// URLs)
 * - Must have a valid hostname
 *
 * @param url - URL to validate
 * @returns true if valid, false otherwise
 */
export function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Must be HTTPS for security
    // Exception: Slack file URLs start with https://files.slack.com
    if (parsed.protocol !== 'https:') {
      logger.debug('Image URL rejected: not HTTPS', { url });
      return false;
    }

    // Must have a valid hostname
    if (!parsed.hostname || parsed.hostname.length === 0) {
      logger.debug('Image URL rejected: no hostname', { url });
      return false;
    }

    return true;
  } catch {
    logger.debug('Image URL rejected: invalid URL format', { url });
    return false;
  }
}

/**
 * Fetch an image from a URL and return it as base64
 *
 * Security features:
 * - HTTPS only
 * - Max 5MB file size
 * - 30s timeout
 * - Content-Type validation
 *
 * @param url - URL to fetch
 * @returns FetchedImage with base64 data and media type
 * @throws Error if fetch fails or validation fails
 */
export async function fetchImageAsBase64(url: string): Promise<FetchedImage> {
  // Validate URL first
  if (!isValidImageUrl(url)) {
    throw new Error('Invalid image URL. Must be HTTPS.');
  }

  logger.debug('Fetching image', { url });

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Set a reasonable User-Agent
        'User-Agent': 'SlackServerMonitor/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${String(response.status)}`);
    }

    // Check Content-Type header
    const contentTypeHeader = response.headers.get('content-type');
    const rawContentType = contentTypeHeader?.split(';')[0]?.toLowerCase();
    if (!rawContentType || !CONTENT_TYPE_MAP[rawContentType]) {
      throw new Error(
        `Invalid image content type: ${rawContentType ?? 'unknown'}. ` +
          'Supported: JPEG, PNG, GIF, WebP'
      );
    }
    const contentType = rawContentType;

    // Check Content-Length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${contentLength} bytes (max: ${String(MAX_IMAGE_SIZE)})`);
    }

    // Read the response as an ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Check actual size
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image too large: ${String(arrayBuffer.byteLength)} bytes (max: ${String(MAX_IMAGE_SIZE)})`
      );
    }

    // Convert to base64 using Buffer (efficient O(n) operation)
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Safe - we validated contentType exists in CONTENT_TYPE_MAP at line 113
    const mediaType = CONTENT_TYPE_MAP[contentType];
    if (!mediaType) {
      // Should never happen due to earlier validation, but TypeScript needs this
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    logger.debug('Image fetched successfully', {
      url,
      size: arrayBuffer.byteLength,
      mediaType,
    });

    return {
      data: base64,
      mediaType,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Image fetch timed out after ${String(FETCH_TIMEOUT / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download an image from a URL and save it to a local file
 *
 * Security features:
 * - HTTPS only
 * - Max 5MB file size
 * - 30s timeout
 * - Content-Type validation
 *
 * @param url - URL to fetch
 * @param destPath - Local file path to save the image
 * @param authToken - Optional Bearer token for authenticated requests (e.g., Slack files)
 * @returns The media type of the downloaded image
 * @throws Error if fetch fails or validation fails
 */
export async function downloadImageToFile(
  url: string,
  destPath: string,
  authToken?: string
): Promise<ImageMediaType> {
  // Validate URL first
  if (!isValidImageUrl(url)) {
    throw new Error('Invalid image URL. Must be HTTPS.');
  }

  logger.debug('Downloading image to file', { url, destPath });

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT);

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'SlackServerMonitor/1.0',
    };

    // Add authorization header if token provided (for Slack private files)
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${String(response.status)}`);
    }

    // Check Content-Type header
    const contentTypeHeader = response.headers.get('content-type');
    const rawContentType = contentTypeHeader?.split(';')[0]?.toLowerCase();
    if (!rawContentType || !CONTENT_TYPE_MAP[rawContentType]) {
      throw new Error(
        `Invalid image content type: ${rawContentType ?? 'unknown'}. ` +
          'Supported: JPEG, PNG, GIF, WebP'
      );
    }
    const contentType = rawContentType;

    // Check Content-Length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${contentLength} bytes (max: ${String(MAX_IMAGE_SIZE)})`);
    }

    // Read the response as an ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Check actual size
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image too large: ${String(arrayBuffer.byteLength)} bytes (max: ${String(MAX_IMAGE_SIZE)})`
      );
    }

    // Write to file
    await writeFile(destPath, Buffer.from(arrayBuffer));

    // Safe - we validated contentType exists in CONTENT_TYPE_MAP
    const mediaType = CONTENT_TYPE_MAP[contentType];
    if (!mediaType) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    logger.debug('Image downloaded successfully', {
      url,
      destPath,
      size: arrayBuffer.byteLength,
      mediaType,
    });

    return mediaType;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Image fetch timed out after ${String(FETCH_TIMEOUT / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Clean up a temporary image file
 * Only suppresses ENOENT (file not found) errors, logs other errors
 */
export async function cleanupTempImage(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
    logger.debug('Cleaned up temp image', { filePath });
  } catch (error) {
    // Only suppress ENOENT (file doesn't exist), log other errors
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to cleanup temp image', { filePath, error });
    }
  }
}
