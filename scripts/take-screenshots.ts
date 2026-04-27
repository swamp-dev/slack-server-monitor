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
import { startScreenshotServer, stopScreenshotServer, pluginPages } from './screenshot-server.js';

const OUTPUT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'screenshots');

interface PageDef {
  name: string;
  path: string;
  variants?: { name: string; query: string }[];
  fullPage?: boolean;
  /** Run after navigation but before screenshot (e.g., open a modal) */
  setup?: (page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>) => Promise<void>;
}

const PAGES: PageDef[] = [
  { name: 'dashboard', path: '/', variants: [
    { name: 'empty', query: '?variant=empty' },
    { name: 'degraded', query: '?variant=degraded' },
  ]},
  { name: 'sessions', path: '/c', variants: [
    { name: 'empty', query: '?variant=empty' },
    { name: 'search-no-results', query: '?variant=search-no-results' },
    { name: 'favorites', query: '?variant=favorites' },
    { name: 'archived', query: '?variant=archived' },
  ]},
  { name: 'conversation', path: '/c/1000.001/C001', variants: [
    { name: 'branched', query: '?variant=branched' },
  ]},
  { name: 'notifications', path: '/notifications', variants: [
    { name: 'empty', query: '?variant=empty' },
  ]},
  { name: 'login', path: '/login', variants: [
    { name: 'error', query: '?variant=error' },
  ]},
  { name: 'register', path: '/register', variants: [
    { name: 'prefilled', query: '?variant=prefilled' },
    { name: 'error', query: '?variant=error' },
  ]},
  { name: 'admin-users', path: '/admin/users', variants: [
    { name: 'empty', query: '?variant=empty' },
    { name: 'with-flash', query: '?variant=with-flash' },
  ]},
  { name: '404', path: '/nonexistent-page' },
  { name: 'command-palette', path: '/', setup: async (pw) => {
    await pw.keyboard.press('Control+k');
    await pw.waitForSelector('#cmd-palette .cmd-palette-item', { timeout: 3000 });
    // Scroll results to show Plugins group
    await pw.evaluate(() => {
      const results = document.querySelector('.cmd-palette-results');
      if (results) results.scrollTop = results.scrollHeight;
    });
  }},
];

const THEMES = ['dracula', 'light'] as const;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 375, height: 812 },
] as const;

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const port = await startScreenshotServer();
  const baseUrl = `http://localhost:${port}`;

  // Append plugin pages discovered during server startup
  const allPages: PageDef[] = [...PAGES];
  for (const pp of pluginPages) {
    allPages.push({
      name: `${pp.pluginName}-${pp.name}`,
      path: `/p/${pp.pluginName}${pp.path}`,
      fullPage: pp.fullPage,
    });
  }

  const filter = process.argv[2];
  const pages = filter ? allPages.filter((p) => p.name === filter) : allPages;

  if (filter && pages.length === 0) {
    console.error(`Unknown page: "${filter}". Available: ${allPages.map((p) => p.name).join(', ')}`);
    process.exit(1);
  }

  let captured = 0;

  async function capture(browser: Awaited<ReturnType<typeof chromium.launch>>, pageName: string, url: string, theme: string, viewport: typeof VIEWPORTS[number], fullPage = false, setup?: PageDef['setup']) {
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

    try {
      const pw = await context.newPage();
      await pw.goto(url, { waitUntil: 'networkidle' });
      if (setup) await setup(pw);

      const filename = `${pageName}-${theme}-${viewport.name}.png`;
      await pw.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage,
      });

      captured++;
      console.log(`  ${filename}`);
    } finally {
      await context.close();
    }
  }

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const page of pages) {
        for (const theme of THEMES) {
          for (const viewport of VIEWPORTS) {
            // Default state
            await capture(browser, page.name, `${baseUrl}${page.path}`, theme, viewport, page.fullPage);

            // Variant states
            if (page.variants) {
              for (const variant of page.variants) {
                await capture(
                  browser,
                  `${page.name}-${variant.name}`,
                  `${baseUrl}${page.path}${variant.query}`,
                  theme,
                  viewport,
                  page.fullPage,
                );
              }
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopScreenshotServer();
  }

  console.log(`\nCaptured ${captured} screenshots to screenshots/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
