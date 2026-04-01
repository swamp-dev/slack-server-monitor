import { test, expect } from '@playwright/test';

import { AUTH_TOKEN } from './constants.js';

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('renders all dashboard sections', async ({ page }) => {
    // Stats
    await expect(page.locator('.stats')).toBeVisible();
    await expect(page.locator('.stat-card')).toHaveCount(2);

    // Health widget
    await expect(page.locator('.health-widget')).toBeVisible();
    await expect(page.locator('.health-widget')).toContainText('Uptime');

    // Quick links
    await expect(page.locator('.quick-links')).toBeVisible();
    await expect(page.locator('.quick-link')).toHaveCount(1);
    await expect(page.locator('.quick-link').first()).toContainText('Grafana');

    // Recent conversations
    await expect(page.locator('.recent-conversations')).toBeVisible();
  });

  test('navigation links work', async ({ page }) => {
    // Conversations link
    await page.click('a[href="/c"]');
    await expect(page.locator('h1')).toContainText('Conversations');
    await page.goBack();

    // Notifications link
    await page.click('a[href="/notifications"]');
    await expect(page.locator('h1')).toContainText('Notifications');
  });

  test('theme toggle changes appearance', async ({ page }) => {
    const html = page.locator('html');
    // Default is dracula (dark)
    await expect(html).toHaveAttribute('data-theme', 'dracula');

    // Toggle to light
    await page.click('#theme-toggle');
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Toggle back to dracula
    await page.click('#theme-toggle');
    await expect(html).toHaveAttribute('data-theme', 'dracula');
  });

  test('theme preference persists across page loads', async ({ page }) => {
    const html = page.locator('html');
    // Set to light
    await page.click('#theme-toggle');
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Reload
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Clean up — set back to dracula
    await page.click('#theme-toggle');
  });
});
