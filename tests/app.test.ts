import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('socket-mode-status', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should return disconnected state initially', async () => {
    const { getSocketModeStatus } = await import('../src/services/socket-mode-status.js');
    const status = getSocketModeStatus();
    expect(status.connected).toBe(false);
    expect(status.lastConnectedAt).toBeNull();
    expect(status.lastDisconnectedAt).toBeNull();
  });

  it('should return a copy (not a reference)', async () => {
    const { getSocketModeStatus } = await import('../src/services/socket-mode-status.js');
    const a = getSocketModeStatus();
    const b = getSocketModeStatus();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('should update state on setConnected', async () => {
    const { getSocketModeStatus, setConnected } = await import('../src/services/socket-mode-status.js');
    setConnected();
    const status = getSocketModeStatus();
    expect(status.connected).toBe(true);
    expect(status.lastConnectedAt).toBeTruthy();
  });

  it('should update state on setDisconnected', async () => {
    const { getSocketModeStatus, setConnected, setDisconnected } = await import('../src/services/socket-mode-status.js');
    setConnected();
    setDisconnected();
    const status = getSocketModeStatus();
    expect(status.connected).toBe(false);
    expect(status.lastDisconnectedAt).toBeTruthy();
    expect(status.lastConnectedAt).toBeTruthy();
  });
});
