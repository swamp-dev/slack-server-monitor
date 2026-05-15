import { test, expect, type Page } from '@playwright/test';

import { AUTH_TOKEN } from './constants.js';

interface FixtureIds {
  runningRunId: number;
  // pausedRunId is exposed by the fixture endpoint for future specs;
  // none of the tests in this file consume it directly because every
  // mutating spec seeds its own fresh paused row to avoid pollution.
  pausedRunId: number;
  successRunId: number;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="token"]', AUTH_TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
}

test.describe('agentbox run controls', () => {
  let ids: FixtureIds;

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/__test__/agentbox/fixture');
    ids = (await res.json()) as FixtureIds;
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Auto-accept native confirm() dialogs so submit handlers proceed.
    page.on('dialog', (d) => { void d.accept(); });
  });

  test('Cancel button on a running run transitions to cancelled', async ({ page, request }) => {
    // Seed a fresh running run so the shared baseline fixture is
    // preserved for sibling specs.
    const seedRes = await request.post('/__test__/agentbox/seed-run', {
      data: { issueNumber: 96, status: 'running', progressPct: 20 },
    });
    const { id: cancelTargetId } = (await seedRes.json()) as { id: number };

    await page.goto(`/p/agentbox/runs/${cancelTargetId}`);
    await expect(page.locator('.agentbox-controls')).toContainText('Cancel');
    await expect(page.locator('.agentbox-controls')).toContainText('Pause');

    await page.locator('button:has-text("Cancel")').click();
    await page.waitForURL(`/p/agentbox/runs/${cancelTargetId}`);

    await expect(page.locator('.agentbox-badge-cancelled')).toContainText('cancelled');
    // Controls must vanish on terminal state.
    await expect(page.locator('.agentbox-controls')).toHaveCount(0);
  });

  test('Pause button on a fresh running run transitions to paused, then Resume restores running', async ({ page, request }) => {
    // Fresh fixture: start a new running run via the test endpoint so
    // we don't depend on test ordering. Reuse the seeded paused run id
    // would be simpler, but exercising pause→resume needs a running run.
    const res = await request.post('/__test__/agentbox/seed-run', {
      data: { issueNumber: 99, status: 'running', progressPct: 10 },
    });
    const { id: freshRunId } = (await res.json()) as { id: number };

    await page.goto(`/p/agentbox/runs/${freshRunId}`);
    await page.locator('button:has-text("Pause")').click();
    await page.waitForURL(`/p/agentbox/runs/${freshRunId}`);
    await expect(page.locator('.plugin-agentbox')).toContainText('paused');

    // Resume button is rendered for paused runs.
    await page.locator('button:has-text("Resume")').click();
    await page.waitForURL(`/p/agentbox/runs/${freshRunId}`);
    await expect(page.locator('.plugin-agentbox')).toContainText('running');
  });

  test('Resume on the seeded paused run transitions to running', async ({ page, request }) => {
    // Use a fresh paused row so this spec doesn't depend on which
    // other specs ran first.
    const res = await request.post('/__test__/agentbox/seed-run', {
      data: { issueNumber: 98, status: 'paused', outputPath: '/tmp/x', progressPct: 50 },
    });
    const { id: freshPausedId } = (await res.json()) as { id: number };

    await page.goto(`/p/agentbox/runs/${freshPausedId}`);
    await expect(page.locator('button:has-text("Resume")')).toBeVisible();

    await page.locator('button:has-text("Resume")').click();
    await page.waitForURL(`/p/agentbox/runs/${freshPausedId}`);
    await expect(page.locator('.plugin-agentbox')).toContainText('running');
  });

  test('Resume on a non-paused run returns 409', async ({ page, request }) => {
    const seedRes = await request.post('/__test__/agentbox/seed-run', {
      data: { issueNumber: 97, status: 'running' },
    });
    const { id: runningId } = (await seedRes.json()) as { id: number };

    // Issue the POST inside the authenticated browser context so the
    // session cookie is sent (Playwright's `request` fixture has its
    // own cookie jar separate from `page`).
    await page.goto(`/p/agentbox/runs/${runningId}`);
    const status = await page.evaluate(async (id: number) => {
      const r = await fetch(`/p/agentbox/runs/${id}/resume`, { method: 'POST', redirect: 'manual' });
      return r.status;
    }, runningId);
    expect(status).toBe(409);
  });

  test('Cancel on a missing run returns 404', async ({ page }) => {
    await page.goto('/p/agentbox/');
    const status = await page.evaluate(async () => {
      const r = await fetch('/p/agentbox/runs/9999/cancel', { method: 'POST', redirect: 'manual' });
      return r.status;
    });
    expect(status).toBe(404);
  });

  test('controls are absent on terminal runs (success)', async ({ page }) => {
    await page.goto(`/p/agentbox/runs/${ids.successRunId}`);
    await expect(page.locator('.agentbox-controls')).toHaveCount(0);
  });
});
