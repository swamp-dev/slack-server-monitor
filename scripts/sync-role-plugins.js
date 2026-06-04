#!/usr/bin/env node
/**
 * Copies plugin source files from the Ansible role into plugins.local/ so that
 * Vitest can discover and run their tests without a manual copy step.
 *
 * Runs automatically as the "pretest" npm lifecycle hook.
 * Safe to run repeatedly — uses recursive copy with overwrite.
 *
 * Copies every directory and .ts file from roles/slack_monitor/files/,
 * so new plugins are picked up automatically without editing this script.
 *
 * Source:  home-server-ansible/roles/slack_monitor/files/
 * Target:  home-server-ansible/slack-server-monitor/plugins.local/
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SSM_ROOT = join(__dirname, '..');
const ROLE_FILES = join(SSM_ROOT, '..', 'roles', 'slack_monitor', 'files');
const PLUGINS_LOCAL = join(SSM_ROOT, 'plugins.local');

if (!existsSync(ROLE_FILES)) {
  // Running outside the Ansible repo (e.g., standalone SSM checkout) — skip silently.
  process.exit(0);
}

mkdirSync(PLUGINS_LOCAL, { recursive: true });

for (const entry of readdirSync(ROLE_FILES)) {
  const src = join(ROLE_FILES, entry);
  const dst = join(PLUGINS_LOCAL, entry);
  const stat = statSync(src);
  // Copy plugin directories and .ts entrypoints/tests; skip Dockerfile and build artifacts.
  if (stat.isDirectory() || entry.endsWith('.ts')) {
    if (!existsSync(src)) continue;
    cpSync(src, dst, { recursive: true, force: true });
  }
}
