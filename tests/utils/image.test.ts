import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidImageUrl, fetchImageAsBase64, downloadImageToFile, cleanupTempImage } from '../../src/utils/image.js';
import * as fs from 'fs/promises';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('image utilities', () => {
  describe('isValidImageUrl', () => {
    it('should accept valid HTTPS URLs', () => {
      expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
      expect(isValidImageUrl('https://files.slack.com/files-pri/T123-F456/image.png')).toBe(true);
    });

    it('should reject HTTP URLs', () => {
      expect(isValidImageUrl('http://example.com/image.jpg')).toBe(false);
    });

    it('should reject non-HTTP protocols', () => {
      expect(isValidImageUrl('ftp://example.com/image.jpg')).toBe(false);
      expect(isValidImageUrl('file:///etc/passwd')).toBe(false);
      expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isValidImageUrl('')).toBe(false);
      expect(isValidImageUrl('not-a-url')).toBe(false);
      expect(isValidImageUrl('https://')).toBe(false);
    });
  });

  describe('fetchImageAsBase64', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it('should fetch and convert image to base64', async () => {
      // Create mock image data
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const mockArrayBuffer = imageBytes.buffer;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/png',
          'content-length': '4',
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const result = await fetchImageAsBase64('https://example.com/test.png');

      expect(result.mediaType).toBe('image/png');
      expect(result.data).toBeTruthy();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/test.png',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'SlackServerMonitor/1.0',
          }),
        })
      );
    });

    it('should reject non-HTTPS URLs', async () => {
      await expect(fetchImageAsBase64('http://example.com/image.jpg')).rejects.toThrow(
        'Invalid image URL. Must be HTTPS.'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(fetchImageAsBase64('https://example.com/notfound.jpg')).rejects.toThrow(
        'Failed to fetch image: HTTP 404'
      );
    });

    it('should reject invalid content types', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'text/html',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      await expect(fetchImageAsBase64('https://example.com/image.jpg')).rejects.toThrow(
        'Invalid image content type: text/html'
      );
    });

    it('should reject images that exceed size limit', async () => {
      // Create a response with a large Content-Length header
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': '10000000', // 10MB
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      await expect(fetchImageAsBase64('https://example.com/large.jpg')).rejects.toThrow(
        'Image too large'
      );
    });

    it('should normalize JPEG content types', async () => {
      const mockArrayBuffer = new Uint8Array([0xff, 0xd8]).buffer;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpg', // Non-standard but common
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const result = await fetchImageAsBase64('https://example.com/test.jpg');

      expect(result.mediaType).toBe('image/jpeg');
    });

    it('should handle content types with charset', async () => {
      const mockArrayBuffer = new Uint8Array([0x89, 0x50]).buffer;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/png; charset=utf-8', // Unusual but possible
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const result = await fetchImageAsBase64('https://example.com/test.png');

      expect(result.mediaType).toBe('image/png');
    });
  });

  describe('downloadImageToFile', () => {
    const mockFetch = vi.fn();
    const testFilePath = '/tmp/test-image-download.jpg';

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(async () => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
      // Clean up test file if it exists
      try {
        await fs.unlink(testFilePath);
      } catch {
        // Ignore if file doesn't exist
      }
    });

    it('should download image to file', async () => {
      const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
      const mockArrayBuffer = imageBytes.buffer;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': '4',
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const mediaType = await downloadImageToFile('https://example.com/test.jpg', testFilePath);

      expect(mediaType).toBe('image/jpeg');

      // Verify file was created
      const fileContent = await fs.readFile(testFilePath);
      expect(fileContent).toEqual(Buffer.from(imageBytes));
    });

    it('should add Authorization header when token provided', async () => {
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const mockArrayBuffer = imageBytes.buffer;

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/png',
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      await downloadImageToFile('https://files.slack.com/test.png', testFilePath, 'xoxb-test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://files.slack.com/test.png',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'SlackServerMonitor/1.0',
            Authorization: 'Bearer xoxb-test-token',
          }),
        })
      );
    });

    it('should reject non-HTTPS URLs', async () => {
      await expect(downloadImageToFile('http://example.com/image.jpg', testFilePath)).rejects.toThrow(
        'Invalid image URL. Must be HTTPS.'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject invalid content types', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'application/pdf',
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      await expect(downloadImageToFile('https://example.com/doc.pdf', testFilePath)).rejects.toThrow(
        'Invalid image content type'
      );
    });

    it('should reject images that exceed size limit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': '10000000', // 10MB
        }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

      await expect(downloadImageToFile('https://example.com/large.jpg', testFilePath)).rejects.toThrow(
        'Image too large'
      );
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
      });

      await expect(downloadImageToFile('https://example.com/forbidden.jpg', testFilePath)).rejects.toThrow(
        'Failed to fetch image: HTTP 403'
      );
    });
  });

  describe('cleanupTempImage', () => {
    it('should delete existing file', async () => {
      const testFile = '/tmp/test-cleanup-image.jpg';
      // Create a test file
      await fs.writeFile(testFile, 'test content');

      // Verify it exists
      const statBefore = await fs.stat(testFile).catch(() => null);
      expect(statBefore).not.toBeNull();

      // Clean it up
      await cleanupTempImage(testFile);

      // Verify it's gone
      const statAfter = await fs.stat(testFile).catch(() => null);
      expect(statAfter).toBeNull();
    });

    it('should not throw error for non-existent file', async () => {
      // Should not throw
      await expect(cleanupTempImage('/tmp/non-existent-file-12345.jpg')).resolves.toBeUndefined();
    });
  });
});
