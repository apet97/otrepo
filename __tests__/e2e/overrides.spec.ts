import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken, freezeTime, waitForAppReady } from './helpers/mock-api';

test.describe('User Overrides Persistence', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await freezeTime(page);
        await setupApiMocks(page, { entriesPerUser: 1, startDate: '2025-01-15' });
        await navigateWithToken(page);
        await waitForAppReady(page);
    });

    test('override changes recalculate summary and persist across reload', async ({ page }) => {
        // Generate a report first
        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');
        await page.click('[data-testid="generate-btn"]');
        await expect(page.locator('[data-testid="summary-strip"]')).toBeVisible({ timeout: 10000 });

        // Capture the initial summary text
        const initialSummary = await page.locator('[data-testid="summary-strip"]').textContent();

        // Open overrides page
        await page.click('#openOverridesBtn');
        await page.waitForSelector('#overridesPage:not(.hidden)', { timeout: 5000 });

        // Expand first user card
        const firstCard = page.locator('.override-user-card').first();
        await firstCard.locator('.override-user-header').click();
        await expect(firstCard).not.toHaveClass(/collapsed/);

        // Set capacity override to a low value (1 hour) to force more overtime
        const capacityInput = firstCard.locator('input[data-field="capacity"]');
        await expect(capacityInput).toBeVisible();
        await capacityInput.fill('1');

        // Go back to main view
        await page.click('#closeOverridesBtn');
        await expect(page.locator('#mainView')).not.toHaveClass(/hidden/);

        // Summary should have recalculated (overtime amounts should differ)
        const updatedSummary = await page.locator('[data-testid="summary-strip"]').textContent();
        expect(updatedSummary).not.toBe(initialSummary);

        // Reload the page and re-setup mocks
        await setupApiMocks(page, { entriesPerUser: 1, startDate: '2025-01-15' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Open overrides page to verify persistence
        await page.click('#openOverridesBtn');
        await page.waitForSelector('#overridesPage:not(.hidden)', { timeout: 5000 });

        // Expand first user card
        const reloadedCard = page.locator('.override-user-card').first();
        await reloadedCard.locator('.override-user-header').click();
        await expect(reloadedCard).not.toHaveClass(/collapsed/);

        // Verify the capacity override persisted
        const reloadedCapacity = reloadedCard.locator('input[data-field="capacity"]');
        await expect(reloadedCapacity).toHaveValue('1');
    });
});
