import { test, expect } from '@playwright/test';

import { AUTH_TOKEN } from './constants.js';

test.describe('conversation list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('lists conversations', async ({ page }) => {
    await page.goto('/c');
    await expect(page.locator('h1')).toContainText('Conversations');
    await expect(page.locator('.session-card')).toHaveCount(3);
  });

  test('clicking a conversation opens the detail view', async ({ page }) => {
    await page.goto('/c');
    await page.locator('.session-card a').first().click();
    await expect(page.locator('h1')).toContainText('Conversation');
    await expect(page.locator('.message')).toHaveCount(2);
  });

  test('favorites page shows only favorited conversations', async ({ page }) => {
    await page.goto('/c/favorites');
    await expect(page.locator('h1')).toContainText('Favorites');
    // Should show only the one favorited conversation
    await expect(page.locator('.session-card')).toHaveCount(1);
  });

  test('archived page shows archived conversations', async ({ page }) => {
    await page.goto('/c/archived');
    await expect(page.locator('h1')).toContainText('Archived');
    // No archived conversations in test data
    await expect(page.locator('.session-card')).toHaveCount(0);
  });

  test('search returns matching results', async ({ page }) => {
    await page.goto('/c/search?q=disk');
    await expect(page.locator('h1')).toContainText('Search: disk');
    await expect(page.locator('.session-card')).toHaveCount(1);
  });

  test('search with no results shows empty', async ({ page }) => {
    await page.goto('/c/search?q=nonexistentquery');
    await expect(page.locator('.session-card')).toHaveCount(0);
  });
});

test.describe('conversation detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('renders messages with correct roles', async ({ page }) => {
    await page.goto('/c/1000.001/C001');
    await expect(page.locator('.message[data-role="user"]')).toHaveCount(1);
    await expect(page.locator('.message[data-role="assistant"]')).toHaveCount(1);
    await expect(page.locator('.message[data-role="user"]')).toContainText('containers');
    await expect(page.locator('.message[data-role="assistant"]')).toContainText('nginx');
  });

  test('export markdown link works', async ({ page }) => {
    await page.goto('/c/1000.001/C001');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.export-btn'),
    ]);

    expect(download.suggestedFilename()).toContain('conversation-');
    expect(download.suggestedFilename()).toContain('.md');
  });

  test('returns 404 for non-existent conversation', async ({ page }) => {
    const response = await page.goto('/c/9999.999/CNONE');
    expect(response?.status()).toBe(404);
  });
});

test.describe('conversation forking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('fork button hidden on last assistant message (2-message conversation)', async ({ page }) => {
    await page.goto('/c/1000.001/C001');
    // Conversation has 2 messages: user + assistant. The assistant message is last, so no fork button.
    const forkButtons = page.locator('.fork-btn');
    await expect(forkButtons).toHaveCount(0);
  });

  test('fork button visible on intermediate assistant message (4-message conversation)', async ({ page }) => {
    // Conversation 3 has 4 messages: user, assistant, user, assistant
    // The first assistant message (index 1) is NOT last, so it gets a fork button
    // The second assistant message (index 3) IS last, so no fork button
    await page.goto('/c/3000.003/C001');
    const forkButtons = page.locator('.fork-btn');
    await expect(forkButtons).toHaveCount(1);
  });
});

test.describe('notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('notifications page shows notifications', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.locator('h1')).toContainText('Notifications');
    await expect(page.locator('.notification')).toHaveCount(2);
    await expect(page.locator('.unread-badge')).toContainText('2');
  });

  test('notification content is visible', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.locator('.notification').first()).toContainText('Server started');
    await expect(page.locator('.notification').last()).toContainText('Backup delayed');
  });
});
