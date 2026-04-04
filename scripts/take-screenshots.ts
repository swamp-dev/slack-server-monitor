/**
 * Playwright screenshot harness.
 *
 * Starts the screenshot server, captures all key pages in both themes
 * and viewports, then shuts down.
 *
 * Usage:
 *   npx tsx scripts/take-screenshots.ts            # capture all
 *   npx tsx scripts/take-screenshots.ts dashboard   # capture one page
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { startScreenshotServer, stopScreenshotServer } from './screenshot-server.js';

const OUTPUT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'screenshots');

const PAGES = [
  { name: 'dashboard', path: '/' },
  { name: 'sessions', path: '/c' },
  { name: 'conversation', path: '/c/1000.001/C001' },
  { name: 'notifications', path: '/notifications' },
  { name: 'login', path: '/login' },
] as const;

const THEMES = ['dracula', 'light'] as const;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 375, height: 812 },
] as const;

async function main() {
  const filter = process.argv[2];
  const pages = filter ? PAGES.filter((p) => p.name === filter) : [...PAGES];

  if (filter && pages.length === 0) {
    console.error(`Unknown page: "${filter}". Available: ${PAGES.map((p) => p.name).join(', ')}`);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const port = await startScreenshotServer();
  const baseUrl = `http://localhost:${port}`;

  const browser = await chromium.launch({ headless: true });
  let captured = 0;

  try {
    for (const page of pages) {
      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          // Fresh context per combo ensures localStorage (theme) is cleanly set
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            storageState: {
              cookies: [],
              origins: [{
                origin: baseUrl,
                localStorage: [
                  { name: 'ssm-theme', value: theme },
                  { name: 'ssm-onboarded', value: 'true' },
                ],
              }],
            },
          });

          const pw = await context.newPage();
          await pw.goto(`${baseUrl}${page.path}`, { waitUntil: 'networkidle' });

          const filename = `${page.name}-${theme}-${viewport.name}.png`;
          await pw.screenshot({
            path: path.join(OUTPUT_DIR, filename),
            fullPage: false,
          });

          captured++;
          console.log(`  ${filename}`);

          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await stopScreenshotServer();
  }

  console.log(`\nCaptured ${captured} screenshots to screenshots/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
