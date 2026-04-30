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
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { startScreenshotServer, stopScreenshotServer, pluginPages } from './screenshot-server.js';

const OUTPUT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'screenshots');

type ViewportName = 'desktop' | 'tablet' | 'mobile';

interface PageDef {
  name: string;
  path: string;
  variants?: { name: string; query: string }[];
  fullPage?: boolean;
  /** Run after navigation but before screenshot (e.g., open a modal) */
  setup?: (page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>) => Promise<void>;
  /**
   * Restrict the entry to a subset of viewports. Useful for setup hooks
   * that only make sense at one size (e.g. mobile-only hamburger menu).
   * Defaults to all viewports if unset.
   */
  viewports?: ViewportName[];
}

interface ManifestEntry {
  page: string;
  variant: string | null;
  theme: 'dracula' | 'light';
  viewport: ViewportName;
  url: string;
  file: string;
  hasSetup: boolean;
}

const PAGES: PageDef[] = [
  { name: 'dashboard', path: '/', variants: [
    { name: 'empty', query: '?variant=empty' },
    { name: 'degraded', query: '?variant=degraded' },
  ]},
  { name: 'sessions', path: '/c', variants: [
    { name: 'empty', query: '?variant=empty' },
    { name: 'search-no-results', query: '?variant=search-no-results' },
    { name: 'search-results', query: '?variant=search-results' },
    { name: 'search-results-many', query: '?variant=search-results-many' },
    { name: 'favorites', query: '?variant=favorites' },
    { name: 'archived', query: '?variant=archived' },
    { name: 'tagged', query: '?variant=tagged' },
  ]},
  { name: 'conversation', path: '/c/1000.001/C001', variants: [
    { name: 'branched', query: '?variant=branched' },
    { name: 'long-with-code', query: '?variant=long-with-code' },
    { name: 'truncated', query: '?variant=truncated' },
    { name: 'tool-error', query: '?variant=tool-error' },
  ]},
  { name: 'notifications', path: '/notifications', variants: [
    { name: 'empty', query: '?variant=empty' },
    { name: 'all-unread', query: '?variant=all-unread' },
    { name: 'many', query: '?variant=many' },
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
    { name: 'deactivated', query: '?variant=deactivated' },
  ]},
  { name: 'admin-users-reset-pw-open', path: '/admin/users', setup: async (pw) => {
    // Click the Reset-password button for user id=1 (alice in the seed) to
    // open the <dialog> modal. Anchored on data-id so the screenshot stays
    // stable if row ordering or button layout shifts later.
    await pw.click('.reset-pw-btn[data-id="1"]');
    await pw.waitForSelector('#reset-pw-dialog[open]', { timeout: 2000 });
  }},
  { name: '401', path: '/401' },
  { name: '403', path: '/403' },
  { name: '404', path: '/nonexistent-page' },
  { name: '500', path: '/500' },
  { name: 'command-palette', path: '/', setup: async (pw) => {
    await pw.keyboard.press('Control+k');
    await pw.waitForSelector('#cmd-palette .cmd-palette-item', { timeout: 3000 });
    // Scroll results to show Plugins group
    await pw.evaluate(() => {
      const results = document.querySelector('.cmd-palette-results');
      if (results) results.scrollTop = results.scrollHeight;
    });
  }},
  // Notification bell dropdown — clicking the bell adds .open and fetches
  // notifications via /api/notifications, which the screenshot server stubs.
  // The bell lives inside .nav-actions which collapses behind the hamburger
  // on mobile, so this only runs at desktop/tablet sizes.
  { name: 'notification-bell-open', path: '/', viewports: ['desktop', 'tablet'], setup: async (pw) => {
    await pw.click('#notification-bell');
    await pw.waitForSelector('#notif-dropdown.open', { timeout: 2000 });
    // Wait for the async fetch to populate dropdown items.
    await pw.waitForSelector('#notif-dropdown .notif-item', { timeout: 2000 });
  }},
  // Keyboard shortcut overlay — `?` toggles #keyboard-help via inline style.
  // Dispatch the keyboard event directly to sidestep keyboard-layout
  // normalization issues with Playwright's Shift+/ chord on headless.
  { name: 'kb-overlay', path: '/c', setup: async (pw) => {
    await pw.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    await pw.waitForFunction(
      () => {
        const el = document.getElementById('keyboard-help');
        return !!el && el.style.display !== 'none';
      },
      { timeout: 2000 },
    );
  }},
  // Mobile hamburger menu — only meaningful at the mobile viewport.
  { name: 'mobile-hamburger-open', path: '/', viewports: ['mobile'], setup: async (pw) => {
    await pw.click('#nav-hamburger');
    // The handler toggles `.open` on .nav-actions; wait for it to settle.
    await pw.waitForSelector('.nav-actions.open', { timeout: 2000 });
  }},
  // Copy-message toast — clicking the per-message Copy button briefly swaps
  // the button label and shows a confirmation. We screenshot during that
  // 1.5s window before it reverts.
  { name: 'copy-toast', path: '/c/1000.001/C001', setup: async (pw) => {
    // The Copy button only becomes visible on hover by default. Force-show by
    // hovering the message first so the button is interactable.
    const message = pw.locator('.message').first();
    await message.hover();
    await pw.click('.copy-msg-btn');
    await pw.waitForFunction(
      () => !!document.querySelector('.copy-msg-btn .copy-label')?.textContent?.includes('Copied'),
      { timeout: 2000 },
    );
  }},
];

const THEMES = ['dracula', 'light'] as const;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
] as const satisfies readonly { name: ViewportName; width: number; height: number }[];

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
  const manifest: ManifestEntry[] = [];

  async function capture(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
    pageName: string,
    variant: string | null,
    url: string,
    theme: typeof THEMES[number],
    viewport: typeof VIEWPORTS[number],
    fullPage = false,
    setup?: PageDef['setup'],
  ) {
    // Fresh context per combo ensures localStorage (theme) is cleanly set
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      // The conversation copy button uses navigator.clipboard.writeText, which
      // requires explicit permission grants in headless Chromium even on
      // localhost. Without these, the copy-toast setup hook never sees
      // "Copied" because the success path is gated on the promise resolving.
      permissions: ['clipboard-read', 'clipboard-write'],
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
      if (setup) {
        try {
          await setup(pw);
        } catch (err) {
          // A flaky setup hook (timing, layout) shouldn't kill the whole run —
          // log and skip this combo so the rest of the manifest still lands.
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  [skip] ${pageName} ${theme}/${viewport.name}: setup failed — ${msg.split('\n')[0]}`);
          return;
        }
      }

      const filename = `${pageName}-${theme}-${viewport.name}.png`;
      await pw.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage,
      });

      captured++;
      manifest.push({
        page: pageName,
        variant,
        theme,
        viewport: viewport.name,
        url,
        file: filename,
        hasSetup: !!setup,
      });
      console.log(`  ${filename}`);
    } finally {
      await context.close();
    }
  }

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const page of pages) {
        const allowedViewports = page.viewports;
        for (const theme of THEMES) {
          for (const viewport of VIEWPORTS) {
            if (allowedViewports && !allowedViewports.includes(viewport.name)) continue;

            // Default state — setup runs after navigation if defined
            // (e.g. open a modal, focus an input) before the screenshot.
            await capture(browser, page.name, null, `${baseUrl}${page.path}`, theme, viewport, page.fullPage, page.setup);

            // Variant states
            if (page.variants) {
              for (const variant of page.variants) {
                await capture(
                  browser,
                  `${page.name}-${variant.name}`,
                  variant.name,
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

  // Write manifest so downstream consumers (e.g. visual analysis) can
  // walk the captured set without parsing filenames.
  await writeFile(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseDir: 'screenshots',
        themes: THEMES,
        viewports: VIEWPORTS.map((v) => ({ name: v.name, width: v.width, height: v.height })),
        entries: manifest,
      },
      null,
      2,
    ),
  );

  console.log(`\nCaptured ${captured} screenshots to screenshots/ (manifest.json written)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
