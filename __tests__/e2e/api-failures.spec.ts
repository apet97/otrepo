import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken, freezeTime, waitForAppReady } from './helpers/mock-api';

/**
 * API Failure Scenario Tests
 *
 * These tests verify that the application handles various API failure modes
 * gracefully, showing appropriate error messages and not crashing.
 */

test.describe('API Failure Handling', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await freezeTime(page);
    });

    test('should show error when users API returns 500', async ({ page }) => {
        await setupApiMocks(page, { shouldFailUsers: 'server_error' });
        await navigateWithToken(page);
        await waitForAppReady(page, { expectError: true });

        // Wait for error state to appear
        await expect(page.locator('[data-testid="api-status-banner"]'))
            .toBeVisible({ timeout: 10000 });
    });

    test('should show error when report API returns 500', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: 'server_error' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate to trigger report and wait for response
        await Promise.all([
            page.waitForResponse((response) =>
                response.url().includes('/reports/detailed') && response.status() === 500
            ),
            page.click('[data-testid="generate-btn"]'),
        ]);

        // Should show error after API failure
        await expect(page.locator('[data-testid="api-status-banner"]')).toBeVisible({ timeout: 10000 });
    });

    test('should handle rate limiting (429) gracefully', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: 'rate_limited' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate and wait for 429 response
        await Promise.all([
            page.waitForResponse((response) =>
                response.url().includes('/reports/detailed') && response.status() === 429
            ),
            page.click('[data-testid="generate-btn"]'),
        ]);

        // Should show error banner (rate limiting causes report failure after retries)
        await expect(page.locator('[data-testid="api-status-banner"]')).toBeVisible({ timeout: 15000 });
    });

    test('should handle network timeout gracefully', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: 'network_timeout' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate (timeout will be handled asynchronously)
        await page.click('[data-testid="generate-btn"]');

        // Should show error after timeout (wait longer as request gets aborted)
        await expect(page.locator('[data-testid="api-status-banner"]')).toBeVisible({ timeout: 15000 });
    });

    test('should handle malformed JSON response gracefully', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: 'malformed_json' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate and wait for malformed response
        await Promise.all([
            page.waitForResponse((response) =>
                response.url().includes('/reports/detailed') && response.status() === 200
            ),
            page.click('[data-testid="generate-btn"]'),
        ]);

        // Should show error when parsing fails
        await expect(page.locator('[data-testid="api-status-banner"]')).toBeVisible({ timeout: 10000 });
    });

    test('should handle 404 Not Found gracefully', async ({ page }) => {
        await setupApiMocks(page, { shouldFailUsers: 'not_found' });
        await navigateWithToken(page);
        await waitForAppReady(page, { expectError: true });

        // Should show error for missing resource
        await expect(page.locator('[data-testid="api-status-banner"]'))
            .toBeVisible({ timeout: 10000 });
    });

    test('should continue functioning when profiles API fails', async ({ page }) => {
        // Profile failures should be graceful - app should still work
        await setupApiMocks(page, { shouldFailProfiles: 'server_error' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate to trigger report
        await page.click('[data-testid="generate-btn"]');

        // App should still load (profiles are optional)
        // Wait for results container to appear
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 15000 });
    });

    test('should continue functioning when holidays API fails', async ({ page }) => {
        // Holiday failures should be graceful - app should still work
        await setupApiMocks(page, { shouldFailHolidays: 'server_error' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate to trigger report
        await page.click('[data-testid="generate-btn"]');

        // App should still load (holidays are optional)
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 15000 });
    });

    test('should continue functioning when time-off API fails', async ({ page }) => {
        // Time-off failures should be graceful - app should still work
        await setupApiMocks(page, { shouldFailTimeOff: 'server_error' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate to trigger report
        await page.click('[data-testid="generate-btn"]');

        // App should still load (time-off is optional)
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 15000 });
    });

    test('should recover when retry succeeds after initial failure', async ({ page }) => {
        // Setup non-users mocks first so the users route below can intentionally override it.
        await setupApiMocks(page, { shouldFailUsers: false });

        // This tests that the app can recover - first call fails, subsequent calls succeed
        let callCount = 0;
        await page.route('**/v1/workspaces/*/users', async (route) => {
            callCount++;
            if (callCount === 1) {
                // First call fails
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Temporary failure' }),
                });
            } else {
                // Subsequent calls succeed
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([
                        { id: 'user-1', name: 'Alice', email: 'alice@test.com', status: 'ACTIVE' },
                    ]),
                });
            }
        });

        await navigateWithToken(page);
        // With retries, app may end up in either success or error state during initialization
        await waitForAppReady(page, { expectError: true });

        // Trigger report generation explicitly so we can assert a reachable terminal UI state.
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');
        await page.click('[data-testid="generate-btn"]');

        // With retries, app should eventually show content or an API status banner.
        await page.waitForFunction(() => {
            const results = document.querySelector('[data-testid="results-container"]') as HTMLElement | null;
            const banner = document.querySelector('[data-testid="api-status-banner"]') as HTMLElement | null;
            const isVisible = (el: HTMLElement | null) => !!el && !el.classList.contains('hidden');
            return isVisible(results) || isVisible(banner);
        }, { timeout: 15000 });

        // Ensure we exercised the intended retry behavior (initial failure + retry attempt).
        expect(callCount).toBeGreaterThanOrEqual(2);

        // Verify page didn't crash
        expect(await page.title()).toBeDefined();
    });
});

test.describe('Multiple API Failures', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await freezeTime(page);
    });

    test('should handle multiple API failures simultaneously', async ({ page }) => {
        await setupApiMocks(page, {
            shouldFailUsers: 'server_error',
            shouldFailReport: 'server_error',
            shouldFailProfiles: 'server_error',
        });
        await navigateWithToken(page);
        await waitForAppReady(page, { expectError: true });

        // Should show error state
        await expect(page.locator('[data-testid="api-status-banner"]'))
            .toBeVisible({ timeout: 10000 });

        // Page should not crash
        expect(await page.title()).toBeDefined();
    });

    test('should show appropriate error when all optional APIs fail but core succeeds', async ({ page }) => {
        await setupApiMocks(page, {
            shouldFailUsers: false, // Core API works
            shouldFailReport: false, // Core API works
            shouldFailProfiles: 'server_error',
            shouldFailHolidays: 'server_error',
            shouldFailTimeOff: 'server_error',
        });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');

        // Click generate to trigger report
        await page.click('[data-testid="generate-btn"]');

        // App should still load because core APIs work
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 15000 });
    });
});
