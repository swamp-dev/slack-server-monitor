/**
 * AgentBox plugin configuration — reads from environment variables.
 */

export interface AgentboxConfig {
  enabled: boolean;
  binaryPath: string;
  workDir: string;
  defaultRepo: string;
}

export function loadAgentboxConfig(): AgentboxConfig {
  return {
    enabled: process.env.AGENTBOX_ENABLED === 'true',
    binaryPath: process.env.AGENTBOX_BINARY_PATH ?? '/root/agentbox/agentbox',
    workDir: process.env.AGENTBOX_WORK_DIR ?? './data/agentbox-runs',
    defaultRepo: process.env.AGENTBOX_DEFAULT_REPO ?? '',
  };
}
