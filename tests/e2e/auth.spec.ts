import { test, expect } from '@playwright/test';

import { AUTH_TOKEN } from './constants.js';

test.describe('authentication flow', () => {
  test('unauthenticated user sees 401 page', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(401);
    await expect(page.locator('body')).toContainText('Authentication Required');
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('Login');
    await expect(page.locator('input[name="token"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('invalid token shows error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', 'wrong-token');
    await page.click('button[type="submit"]');

    await expect(page.locator('.error')).toContainText('Invalid token');
  });

  test('valid token logs in and redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await page.waitForURL('/');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('session persists across page navigation', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Navigate to conversations
    await page.click('a[href="/c"]');
    await expect(page.locator('h1')).toContainText('Conversations');

    // Navigate to notifications
    await page.click('a[href="/notifications"]');
    await expect(page.locator('h1')).toContainText('Notifications');

    // Navigate back to dashboard
    await page.click('a[href="/"]');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('logout clears session', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[name="token"]', AUTH_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Logout
    await page.click('button:has-text("Logout")');
    await page.waitForURL('/login');

    // Verify we can't access protected routes
    const response = await page.goto('/');
    expect(response?.status()).toBe(401);
  });
});
