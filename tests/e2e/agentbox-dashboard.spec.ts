import { test, expect } from '@playwright/test';

import { AUTH_TOKEN } from './constants.js';

test.describe('agentbox workflows UI', () => {
  let runningRunId: number;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/__test__/agentbox/fixture');
    const data: { runningRunId: number } = await res.json();
    runningRunId = data.runningRunId;
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('dashboard renders nav, stats, active run, and recent runs', async ({ page }) => {
    await page.goto('/p/agentbox/');

    await expect(page.locator('.agentbox-nav')).toBeVisible();
    await expect(page.locator('.agentbox-pill.active')).toContainText('Dashboard');

    // Stats cards — fixture seeds 1 running, 1 paused, 1 success, 1 failed.
    // Sibling specs that mutate state (cancel/pause/resume) seed
    // additional rows via /__test__/agentbox/seed-run; assert "at least
    // 4" rather than an exact total so test ordering doesn't matter.
    await expect(page.locator('.agentbox-stats')).toBeVisible();
    const totalText = await page.locator('.agentbox-stat-value').first().textContent();
    expect(Number(totalText)).toBeGreaterThanOrEqual(4);

    // Active run section — fixture seeds a running row, but sibling
    // specs may add others. Assert the section renders SOME running
    // row, not a specific issue number.
    const activeCard = page.locator('.agentbox-card', { hasText: 'Active Run' });
    await expect(activeCard).toBeVisible();
    await expect(activeCard).not.toContainText('Idle');
    // Progress-fill is rendered by the template — assert it exists and
    // has a width style. The minimal e2e shell doesn't ship the plugin
    // CSS, so toBeVisible() doesn't apply; presence + width is the
    // assertion that proves the renderer ran correctly.
    await expect(page.locator('.agentbox-progress-fill')).toHaveAttribute('style', /width:\s*\d+%/);
  });

  test('queue page renders ready issues', async ({ page }) => {
    await page.goto('/p/agentbox/queue');

    await expect(page.locator('.agentbox-pill.active')).toContainText('Queue');
    // Fixture seeds two ready issues
    await expect(page.locator('.agentbox-runs-table tbody tr')).toHaveCount(2);
    await expect(page.locator('.agentbox-runs-table')).toContainText('Add feature X');
    await expect(page.locator('.agentbox-runs-table')).toContainText('Fix bug Y');
  });

  test('runs history page renders all seeded runs', async ({ page }) => {
    await page.goto('/p/agentbox/runs');

    await expect(page.locator('.agentbox-pill.active')).toContainText('Runs');
    // Baseline fixture: 1 running + 1 paused + 1 success + 1 failed.
    // Sibling specs may add rows; assert at least 4 and that each
    // baseline status badge is represented.
    const rowCount = await page.locator('.agentbox-runs-table tbody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(4);
    expect(await page.locator('.agentbox-badge-paused').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('.agentbox-badge-success').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('.agentbox-badge-failed').count()).toBeGreaterThanOrEqual(1);
  });

  test('run detail page renders for an existing run', async ({ page }) => {
    await page.goto(`/p/agentbox/runs/${runningRunId}`);

    await expect(page.locator('.plugin-agentbox')).toContainText('#42');
    await expect(page.locator('.plugin-agentbox')).toContainText('running');
  });

  test('run detail returns 404 for missing run', async ({ page }) => {
    const response = await page.goto('/p/agentbox/runs/9999');
    expect(response?.status()).toBe(404);
    await expect(page.locator('.plugin-agentbox')).toContainText('Run not found');
  });

  test('nav pills link between pages', async ({ page }) => {
    await page.goto('/p/agentbox/');

    await page.click('.agentbox-pill[href="/p/agentbox/queue"]');
    await expect(page).toHaveURL('/p/agentbox/queue');
    await expect(page.locator('.agentbox-pill.active')).toContainText('Queue');

    await page.click('.agentbox-pill[href="/p/agentbox/runs"]');
    await expect(page).toHaveURL('/p/agentbox/runs');
    await expect(page.locator('.agentbox-pill.active')).toContainText('Runs');

    await page.click('.agentbox-pill[href="/p/agentbox/"]');
    await expect(page).toHaveURL('/p/agentbox/');
    await expect(page.locator('.agentbox-pill.active')).toContainText('Dashboard');
  });
});
