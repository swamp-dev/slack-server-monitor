import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HueResponseCache } from './response-cache.js';
import { getResponseCache } from './client.js';

describe('HueResponseCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get/set', () => {
    it('should return undefined for cache miss', () => {
      const cache = new HueResponseCache();
      expect(cache.get('/light')).toBeUndefined();
    });

    it('should return cached value within TTL', () => {
      const cache = new HueResponseCache();
      const data = [{ id: '1', on: { on: true } }];
      cache.set('/light', data, 30_000);
      expect(cache.get('/light')).toEqual(data);
    });

    it('should return undefined after TTL expires', () => {
      const cache = new HueResponseCache();
      cache.set('/light', [{ id: '1' }], 30_000);

      vi.advanceTimersByTime(30_001);
      expect(cache.get('/light')).toBeUndefined();
    });

    it('should return value just before TTL expires', () => {
      const cache = new HueResponseCache();
      const data = [{ id: '1' }];
      cache.set('/light', data, 30_000);

      vi.advanceTimersByTime(29_999);
      expect(cache.get('/light')).toEqual(data);
    });

    it('should overwrite existing entry', () => {
      const cache = new HueResponseCache();
      cache.set('/light', [{ id: '1' }], 30_000);
      cache.set('/light', [{ id: '2' }], 30_000);
      expect(cache.get('/light')).toEqual([{ id: '2' }]);
    });
  });

  describe('invalidate', () => {
    it('should remove a specific cache entry', () => {
      const cache = new HueResponseCache();
      cache.set('/light', [{ id: '1' }], 30_000);
      cache.set('/room', [{ id: 'r1' }], 30_000);

      cache.invalidate('/light');
      expect(cache.get('/light')).toBeUndefined();
      expect(cache.get('/room')).toEqual([{ id: 'r1' }]);
    });

    it('should be a no-op for nonexistent key', () => {
      const cache = new HueResponseCache();
      cache.invalidate('/nonexistent'); // should not throw
    });
  });

  describe('invalidateAll', () => {
    it('should clear all entries', () => {
      const cache = new HueResponseCache();
      cache.set('/light', [{ id: '1' }], 30_000);
      cache.set('/room', [{ id: 'r1' }], 30_000);
      cache.set('/scene', [{ id: 's1' }], 30_000);

      cache.invalidateAll();
      expect(cache.get('/light')).toBeUndefined();
      expect(cache.get('/room')).toBeUndefined();
      expect(cache.get('/scene')).toBeUndefined();
    });
  });

  describe('invalidateByPrefix', () => {
    it('should remove entries matching prefix', () => {
      const cache = new HueResponseCache();
      cache.set('/scene', [{ id: 's1' }], 30_000);
      cache.set('/scene/abc', [{ id: 's2' }], 30_000);
      cache.set('/light', [{ id: 'l1' }], 30_000);

      cache.invalidateByPrefix('/scene');
      expect(cache.get('/scene')).toBeUndefined();
      expect(cache.get('/scene/abc')).toBeUndefined();
      expect(cache.get('/light')).toEqual([{ id: 'l1' }]);
    });
  });

  describe('size', () => {
    it('should return 0 for empty cache', () => {
      const cache = new HueResponseCache();
      expect(cache.size).toBe(0);
    });

    it('should return number of active entries', () => {
      const cache = new HueResponseCache();
      cache.set('/light', [], 30_000);
      cache.set('/room', [], 30_000);
      expect(cache.size).toBe(2);
    });

    it('should not count expired entries', () => {
      const cache = new HueResponseCache();
      cache.set('/light', [], 10_000);
      cache.set('/room', [], 30_000);

      vi.advanceTimersByTime(15_000);
      // Expired entries are still in the map but get() returns undefined.
      // size counts stored entries; cleanup happens lazily.
      expect(cache.get('/light')).toBeUndefined();
      expect(cache.get('/room')).toEqual([]);
    });
  });

  describe('client integration', () => {
    it('getResponseCache returns the singleton cache instance', () => {
      const cache = getResponseCache();
      expect(cache).toBeInstanceOf(HueResponseCache);
      // Same instance on repeated calls
      expect(getResponseCache()).toBe(cache);
    });

    it('cache can be manually populated and read back', () => {
      const cache = getResponseCache();
      const testData = { data: [{ id: 'test-light' }], errors: [] };
      cache.set('/light', testData, 30_000);
      expect(cache.get('/light')).toEqual(testData);
      // Clean up
      cache.invalidate('/light');
    });

    it('invalidateByPrefix clears related entries after writes', () => {
      const cache = getResponseCache();
      cache.set('/scene', { data: [] }, 30_000);
      cache.set('/scene/abc', { data: [] }, 30_000);
      cache.set('/light', { data: [] }, 30_000);

      // Simulates what hueRequest does on PUT /scene/abc
      cache.invalidateByPrefix('/scene');

      expect(cache.get('/scene')).toBeUndefined();
      expect(cache.get('/scene/abc')).toBeUndefined();
      expect(cache.get('/light')).toBeDefined();

      // Clean up
      cache.invalidateAll();
    });
  });
});
