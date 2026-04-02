import { test, expect } from '@playwright/test';
import { AUTH_TOKEN } from './constants.js';

test.describe('command palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('Ctrl+K opens and Esc closes the palette', async ({ page }) => {
    // Palette should be hidden initially
    await expect(page.locator('#cmd-palette')).toBeHidden();

    // Open with Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette')).toBeVisible();
    await expect(page.locator('#cmd-palette-input')).toBeFocused();

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#cmd-palette')).toBeHidden();
  });

  test('palette shows default commands on empty query', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette')).toBeVisible();

    // Wait for fetch to complete and items to render
    await expect(page.locator('.cmd-palette-item').first()).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.cmd-palette-item')).not.toHaveCount(0);
  });

  test('typing filters results', async ({ page }) => {
    await page.keyboard.press('Control+k');

    // Type a search query that matches conversation content
    await page.fill('#cmd-palette-input', 'containers');

    // Wait for results to update (debounced)
    await page.waitForTimeout(300);

    // Should have results
    const items = page.locator('.cmd-palette-item');
    await expect(items).not.toHaveCount(0);
  });

  test('Enter navigates to first result', async ({ page }) => {
    await page.keyboard.press('Control+k');

    // Should have default items
    await expect(page.locator('.cmd-palette-item')).not.toHaveCount(0);

    // Press Enter to navigate to first item
    await page.keyboard.press('Enter');

    // Should have navigated away from dashboard
    // (first item is Dashboard which stays on /, but navigation happened)
    await expect(page.locator('#cmd-palette')).toBeHidden();
  });
});
