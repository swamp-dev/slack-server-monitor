import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import { AUTH_TOKEN } from './constants.js';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="token"]', AUTH_TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
}

/**
 * Broadcast an SSE event and assert it actually reached at least one
 * client. The dashboard's EventSource handshake is asynchronous, so a
 * naive broadcast immediately after page.goto() can land before any
 * client has connected. We retry briefly so the race becomes a hard
 * failure with a clear message instead of a timeout on the assertion
 * downstream.
 */
async function broadcast(
  request: APIRequestContext,
  event: 'dashboard-update' | 'journal-entry' | 'run-complete',
  data: unknown,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const res = await request.post('/__test__/agentbox/sse-broadcast', {
      data: { event, data },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { delivered: number };
    if (body.delivered >= 1) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`SSE broadcast for "${event}" delivered to 0 clients within 2s — EventSource never connected`);
}

async function waitForSseConnected(page: Page): Promise<void> {
  // Non-destructive probe: poll /__test__/agentbox/sse-clients for
  // the connected count. Avoids the connection-race trap where a
  // broadcast fires before the EventSource handshake completes.
  await page.waitForFunction(async () => {
    const r = await fetch('/__test__/agentbox/sse-clients');
    if (!r.ok) return false;
    const j = (await r.json()) as { count: number };
    return j.count >= 1;
  }, null, { timeout: 5000 });
}

test.describe('agentbox SSE event delivery', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard-update event updates stat values without reload', async ({ page, request }) => {
    await page.goto('/p/agentbox/');
    await waitForSseConnected(page);
    // Wait for the EventSource to connect — `agentbox-stats` is rendered
    // server-side, so it's there immediately, but the client JS only
    // attaches after the first event lands.
    await expect(page.locator('.agentbox-stats')).toBeVisible();

    // Push a dashboard-update with synthesized stats. The client JS
    // matches stat values by their visible label text.
    await broadcast(request, 'dashboard-update', {
      stats: {
        totalRuns: 999,
        activeRuns: 0,
        successCount: 42,
        failedCount: 7,
        cancelledCount: 3,
      },
      activeRun: null,
    });

    // The "Total runs" stat updates in place — the new value won't be
    // there immediately, so wait for it.
    const totalCard = page.locator('.agentbox-stat', { has: page.locator('.agentbox-stat-label', { hasText: /^Total runs$/ }) });
    await expect(totalCard.locator('.agentbox-stat-value')).toHaveText('999');
    const successCard = page.locator('.agentbox-stat', { has: page.locator('.agentbox-stat-label', { hasText: /^Success$/ }) });
    await expect(successCard.locator('.agentbox-stat-value')).toHaveText('42');
  });

  test('dashboard-update event drives the active-run progress bar width', async ({ page, request }) => {
    await page.goto('/p/agentbox/');
    await waitForSseConnected(page);
    await expect(page.locator('.agentbox-progress-fill')).toBeAttached();

    await broadcast(request, 'dashboard-update', {
      stats: { totalRuns: 0, activeRuns: 0, successCount: 0, failedCount: 0, cancelledCount: 0 },
      activeRun: { id: 1, issueNumber: 42, status: 'running', progressPct: 88 },
    });

    await expect(page.locator('.agentbox-progress-fill')).toHaveAttribute('style', /width:\s*88%/);
  });

  test('journal-entry events append to the journal list, dedup on id', async ({ page, request }) => {
    await page.goto('/p/agentbox/');
    await waitForSseConnected(page);

    await broadcast(request, 'journal-entry', {
      entry: {
        id: 1, summary: 'First entry', reflection: 'Reflection 1',
        iteration: 1, sprint: 1, confidence: 4, difficulty: 2, momentum: 5,
        timestamp: '2026-04-29T10:00:00Z',
      },
    });
    await broadcast(request, 'journal-entry', {
      entry: {
        id: 2, summary: 'Second entry', reflection: 'Reflection 2',
        iteration: 2, sprint: 1, confidence: 4, difficulty: 2, momentum: 5,
        timestamp: '2026-04-29T10:05:00Z',
      },
    });
    // Re-deliver entry id=1 — must be deduped (idempotent on reconnect).
    await broadcast(request, 'journal-entry', {
      entry: {
        id: 1, summary: 'First entry', reflection: 'Reflection 1',
        iteration: 1, sprint: 1, confidence: 4, difficulty: 2, momentum: 5,
        timestamp: '2026-04-29T10:00:00Z',
      },
    });

    const list = page.locator('#agentbox-journal-list');
    await expect(list.locator('.agentbox-journal-entry')).toHaveCount(2);
    await expect(list.locator('[data-entry-id="1"]')).toContainText('First entry');
    await expect(list.locator('[data-entry-id="2"]')).toContainText('Second entry');
    // DOM order: id=1 before id=2 — the dedup must not re-order.
    const entries = list.locator('.agentbox-journal-entry');
    await expect(entries.nth(0)).toHaveAttribute('data-entry-id', '1');
    await expect(entries.nth(1)).toHaveAttribute('data-entry-id', '2');
  });

  test('run-complete event renders a toast', async ({ page, request }) => {
    await page.goto('/p/agentbox/');
    await waitForSseConnected(page);

    await broadcast(request, 'run-complete', {
      runId: 12, issueNumber: 42, repo: 'test-org/test-repo', status: 'success',
    });

    const toast = page.locator('#agentbox-toasts .agentbox-toast').first();
    await expect(toast).toBeAttached();
    await expect(toast).toContainText('test-org/test-repo#42');
    await expect(toast).toContainText('success');
  });

  test('terminal status in run-complete payload — does NOT re-open as running', async ({ page, request }) => {
    // Belt-and-braces check: a run-complete event does not, on its
    // own, mutate stats. The client JS routes run-complete to the
    // toast handler only; stats updates require a separate
    // dashboard-update event.
    await page.goto('/p/agentbox/');
    await waitForSseConnected(page);
    const beforeText = await page.locator('.agentbox-stat-value').first().textContent();

    await broadcast(request, 'run-complete', {
      runId: 99, issueNumber: 1, repo: 'test-org/test-repo', status: 'failed',
    });

    // Toast is shown.
    await expect(page.locator('#agentbox-toasts .agentbox-toast')).toBeAttached();
    // Stat values are unchanged (no piggybacked stats update).
    const afterText = await page.locator('.agentbox-stat-value').first().textContent();
    expect(afterText).toBe(beforeText);
  });
});
