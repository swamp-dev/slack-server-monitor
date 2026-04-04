/**
 * AgentBox Plugin Types
 */

export type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface AgentboxRun {
  id: number;
  issueNumber: number;
  repo: string;
  status: RunStatus;
  branch: string | null;
  prUrl: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  outputPath: string | null;
  error: string | null;
  createdAt: number;
}

export interface IssueLink {
  id: number;
  issueNumber: number;
  repo: string;
  threadTs: string;
  channelId: string;
  createdBy: string;
  createdAt: number;
}

export interface AgentboxConfig {
  enabled: boolean;
  binaryPath: string;
  workDir: string;
  defaultRepo: string | undefined;
}
