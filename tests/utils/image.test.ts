import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidImageUrl, fetchImageAsBase64 } from '../../src/utils/image.js';

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
});
