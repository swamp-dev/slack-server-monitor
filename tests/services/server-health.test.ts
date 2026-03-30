import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockMemory = { total: 16384, used: 8192, free: 4096, available: 8192, bufferCache: 4096, percentUsed: 50 };
const mockSwap = { total: 4096, used: 1024, free: 3072, percentUsed: 25 };
const mockCpu = { cores: 4, model: 'AMD Ryzen 5' };
const mockDisks = [{ filesystem: '/dev/sda1', size: '500G', used: '200G', available: '300G', percentUsed: 40, mountPoint: '/' }];
const mockUptime = { uptime: '5d 3h', uptimeSeconds: 443580, loadAverage: [1.2, 0.8, 0.5] as [number, number, number] };

vi.mock('../../src/executors/system.js', () => ({
  getMemoryInfo: vi.fn(() => Promise.resolve(mockMemory)),
  getSwapInfo: vi.fn(() => Promise.resolve(mockSwap)),
  getCpuInfo: vi.fn(() => Promise.resolve(mockCpu)),
  getDiskUsage: vi.fn(() => Promise.resolve(mockDisks)),
  getUptimeInfo: vi.fn(() => Promise.resolve(mockUptime)),
}));

import { getServerHealth, clearHealthCache } from '../../src/services/server-health.js';
import { getMemoryInfo } from '../../src/executors/system.js';

describe('server-health', () => {
  beforeEach(() => {
    clearHealthCache();
    vi.clearAllMocks();
  });

  it('should return server health metrics', async () => {
    const health = await getServerHealth();

    expect(health).toBeDefined();
    expect(health?.uptime).toBe('5d 3h');
    expect(health?.memory.percentUsed).toBe(50);
    expect(health?.cpu.cores).toBe(4);
    expect(health?.disks).toHaveLength(1);
    expect(health?.loadAverage).toEqual([1.2, 0.8, 0.5]);
    expect(health?.swap.percentUsed).toBe(25);
    expect(health?.timestamp).toBeGreaterThan(0);
  });

  it('should cache results within TTL', async () => {
    await getServerHealth();
    await getServerHealth();

    // Should only call executors once (cached second time)
    expect(getMemoryInfo).toHaveBeenCalledTimes(1);
  });

  it('should refresh after cache is cleared', async () => {
    await getServerHealth();
    clearHealthCache();
    await getServerHealth();

    expect(getMemoryInfo).toHaveBeenCalledTimes(2);
  });

  it('should return null on first failure with no cache', async () => {
    vi.mocked(getMemoryInfo).mockRejectedValueOnce(new Error('fail'));

    const health = await getServerHealth();
    expect(health).toBeNull();
  });

  it('should return stale cache on failure when TTL expires', async () => {
    // First call succeeds and populates cache
    const initial = await getServerHealth();
    expect(initial).not.toBeNull();

    // Expire cache by advancing time
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);

    // Mock failure on refresh
    vi.mocked(getMemoryInfo).mockRejectedValueOnce(new Error('fail'));

    // Should return stale cached data (not null)
    const health = await getServerHealth();
    expect(health).not.toBeNull();
    expect(health?.uptime).toBe('5d 3h');

    vi.useRealTimers();
  });
});
