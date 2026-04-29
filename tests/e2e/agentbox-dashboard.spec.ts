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

    // Stats cards — fixture seeds 1 running, 1 success, 1 failed
    await expect(page.locator('.agentbox-stats')).toBeVisible();
    const statValues = page.locator('.agentbox-stat-value');
    await expect(statValues.first()).toContainText('3'); // total runs

    // Active run section — fixture has issue #42 running at 35%
    await expect(page.locator('.agentbox-card', { hasText: 'Active Run' })).toBeVisible();
    await expect(page.locator('.agentbox-card', { hasText: 'Active Run' })).toContainText('#42');
    // Progress-fill is rendered by the template — assert the width matches
    // the seeded progress_pct (35). The minimal e2e shell doesn't ship the
    // plugin CSS, so toBeVisible() doesn't apply; presence + width is the
    // assertion that proves the renderer ran correctly.
    await expect(page.locator('.agentbox-progress-fill')).toHaveAttribute('style', /width:\s*35%/);
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
    // Three runs in fixture
    await expect(page.locator('.agentbox-runs-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.agentbox-badge-running')).toHaveCount(1);
    await expect(page.locator('.agentbox-badge-success')).toHaveCount(1);
    await expect(page.locator('.agentbox-badge-failed')).toHaveCount(1);
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
