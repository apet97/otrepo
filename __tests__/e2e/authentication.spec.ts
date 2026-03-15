import { test, expect } from '@playwright/test';
import { createMockToken, setupApiMocks, navigateWithToken, freezeTime, waitForAppReady } from './helpers/mock-api';

test.describe('Authentication Flow', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await freezeTime(page);
    });

    test('shows error when no auth token is provided', async ({ page }) => {
        // Navigate without token
        await page.goto('/');
        await waitForAppReady(page, { expectError: true });

        // Should show error message - wait for init() to update the DOM
        const emptyState = page.locator('[data-testid="empty-state"]');
        await expect(emptyState).toBeVisible();
        // Wait for init() to process and update the empty state text
        await expect(emptyState).toContainText('authentication', { timeout: 10000 });
    });

    test('shows error when auth token is invalid', async ({ page }) => {
        // Navigate with invalid token
        await page.goto('/?auth_token=invalid-token');
        await waitForAppReady(page, { expectError: true });

        // Should show error message - wait for init() to update the DOM
        const emptyState = page.locator('[data-testid="empty-state"]');
        await expect(emptyState).toBeVisible();
        // Wait for init() to process and update the empty state text
        await expect(emptyState).toContainText('authentication', { timeout: 10000 });
    });

    test('loads successfully with valid auth token', async ({ page }) => {
        await setupApiMocks(page);
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Should show the app title
        await expect(page.locator('.compact-title')).toContainText('OTPLUS');

        // Should show the generate button
        await expect(page.locator('[data-testid="generate-btn"]')).toBeVisible();

        // Should show date inputs
        await expect(page.locator('[data-testid="start-date"]')).toBeVisible();
        await expect(page.locator('[data-testid="end-date"]')).toBeVisible();
    });

    test('does not persist auth token to localStorage', async ({ page }) => {
        await setupApiMocks(page);
        const token = createMockToken();
        await navigateWithToken(page, token);
        await waitForAppReady(page);

        const hasToken = await page.evaluate((value) => {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const stored = localStorage.getItem(key);
                if (stored && stored.includes(value)) {
                    return true;
                }
            }
            return false;
        }, token);

        expect(hasToken).toBe(false);
    });

    test('applies dark theme from token claims', async ({ page }) => {
        await setupApiMocks(page);
        const darkToken = createMockToken({ theme: 'DARK' });
        await navigateWithToken(page, darkToken);
        await waitForAppReady(page);

        // Body should have dark theme class
        await expect(page.locator('body')).toHaveClass(/cl-theme-dark/);
    });

    test('does not apply dark theme for light theme token', async ({ page }) => {
        await setupApiMocks(page);
        const lightToken = createMockToken({ theme: 'LIGHT' });
        await navigateWithToken(page, lightToken);
        await waitForAppReady(page);

        // Body should not have dark theme class
        await expect(page.locator('body')).not.toHaveClass(/cl-theme-dark/);
    });
});
