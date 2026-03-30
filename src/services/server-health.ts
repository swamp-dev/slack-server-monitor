/**
 * Server health service with caching
 *
 * Provides cached server health metrics for the dashboard.
 * Metrics are refreshed at most once per cache TTL (default 60s).
 */

import { getMemoryInfo, getSwapInfo, getDiskUsage, getUptimeInfo, getCpuInfo } from '../executors/system.js';
import type { MemoryInfo, SwapInfo, DiskMount, CpuInfo } from '../executors/system.js';
import { logger } from '../utils/logger.js';

/**
 * Server health snapshot
 */
export interface ServerHealth {
  uptime: string;
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  cpu: CpuInfo;
  memory: MemoryInfo;
  swap: SwapInfo;
  disks: DiskMount[];
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedHealth: ServerHealth | null = null;
let cacheTimestamp = 0;
let inflightFetch: Promise<ServerHealth | null> | null = null;

/**
 * Get server health metrics.
 * Returns cached result if within TTL, otherwise fetches fresh data.
 * Deduplicates concurrent requests via an in-flight promise guard.
 */
export async function getServerHealth(): Promise<ServerHealth | null> {
  const now = Date.now();

  if (cachedHealth && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedHealth;
  }

  // Deduplicate concurrent fetches
  if (inflightFetch) {
    return inflightFetch;
  }

  inflightFetch = fetchHealth(now).finally(() => {
    inflightFetch = null;
  });

  return inflightFetch;
}

async function fetchHealth(now: number): Promise<ServerHealth | null> {
  try {
    const [cpu, memory, swap, disks, uptimeInfo] = await Promise.all([
      getCpuInfo(),
      getMemoryInfo(),
      getSwapInfo(),
      getDiskUsage(),
      getUptimeInfo(),
    ]);

    cachedHealth = {
      uptime: uptimeInfo.uptime,
      uptimeSeconds: uptimeInfo.uptimeSeconds,
      loadAverage: uptimeInfo.loadAverage,
      cpu,
      memory,
      swap,
      disks,
      timestamp: now,
    };
    cacheTimestamp = now;

    return cachedHealth;
  } catch (error) {
    logger.error('Failed to fetch server health', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Return stale cache if available, null otherwise
    return cachedHealth;
  }
}

/**
 * Clear the health cache (for testing)
 */
export function clearHealthCache(): void {
  cachedHealth = null;
  cacheTimestamp = 0;
  inflightFetch = null;
}
