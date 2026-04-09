/**
 * Socket Mode connection state tracking.
 *
 * Tracks whether the WebSocket connection to Slack is alive.
 * Used by the /health endpoint to provide meaningful health checks.
 *
 * Separated from app.ts to avoid circular imports (server.ts needs this
 * but app.ts imports from server.ts via web/index.ts).
 */

export interface SocketModeStatus {
  connected: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
}

const state: SocketModeStatus = {
  connected: false,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
};

/**
 * Get the current Socket Mode connection status.
 * Returns a shallow copy to prevent external mutation.
 */
export function getSocketModeStatus(): SocketModeStatus {
  return { ...state };
}

/**
 * Mark Socket Mode as connected.
 */
export function setConnected(): void {
  state.connected = true;
  state.lastConnectedAt = new Date().toISOString();
}

/**
 * Mark Socket Mode as disconnected.
 */
export function setDisconnected(): void {
  state.connected = false;
  state.lastDisconnectedAt = new Date().toISOString();
}
