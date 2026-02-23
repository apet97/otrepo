import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken, mockUsers, freezeTime, waitForAppReady } from './helpers/mock-api';

test.describe('Report Generation', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await freezeTime(page);
        await setupApiMocks(page, { entriesPerUser: 1, startDate: '2025-01-15' });
        await navigateWithToken(page);
        await waitForAppReady(page);
    });

    test('generates report when clicking Generate button', async ({ page }) => {
        // Set date range
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);

        // Click generate
        await page.click('[data-testid="generate-btn"]');

        // Wait for results to appear
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Summary strip should be visible
        await expect(page.locator('[data-testid="summary-strip"]')).toBeVisible();
        await expect(page.locator('[data-testid="summary-strip"]')).toContainText('Total time9h');
    });

    test('shows summary table with user data', async ({ page }) => {
        // Set date range and generate
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        // Wait for summary table
        await expect(page.locator('[data-testid="summary-table-body"]')).toBeVisible({ timeout: 10000 });

        // Should have rows for each user
        const rows = page.locator('[data-testid="summary-table-body"] tr');
        await expect(rows).toHaveCount(mockUsers.length);

        // First row should include a deterministic total (3h) for the first user
        const firstRowText = await rows.first().innerText();
        expect(firstRowText).toContain('Alice Johnson');
        expect(firstRowText).toContain('3h');
    });

    test('switches between summary and detailed tabs', async ({ page }) => {
        // Generate report first
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        // Wait for results
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        const summaryTab = page.locator('[data-tab="summary"]');
        const detailedTab = page.locator('[data-tab="detailed"]');
        const activateTab = async (
            tab: typeof summaryTab,
            expectedSelected: 'true' | 'false',
            fallbackKey: 'Enter' | 'Space' = 'Enter'
        ) => {
            await tab.click();
            if ((await tab.getAttribute('aria-selected')) !== expectedSelected) {
                await tab.focus();
                await page.keyboard.press(fallbackKey);
            }
            await expect(tab).toHaveAttribute('aria-selected', expectedSelected, { timeout: 10000 });
        };

        // Summary should be visible by default
        await expect(summaryTab).toHaveAttribute('aria-selected', 'true');
        await expect(detailedTab).toHaveAttribute('aria-selected', 'false');
        await expect(page.locator('[data-testid="summary-card"]')).toBeVisible();
        await expect(page.locator('[data-testid="detailed-card"]')).toBeHidden();

        // Click detailed tab
        await activateTab(detailedTab, 'true');

        // Detailed should now be active and visible.
        await expect(summaryTab).toHaveAttribute('aria-selected', 'false');
        await expect(page.locator('[data-testid="detailed-card"]')).toBeVisible();
        await expect(page.locator('[data-testid="summary-card"]')).toBeHidden();

        // Click back to summary
        await activateTab(summaryTab, 'true');
        await expect(detailedTab).toHaveAttribute('aria-selected', 'false');
        await expect(page.locator('[data-testid="summary-card"]')).toBeVisible();
        await expect(page.locator('[data-testid="detailed-card"]')).toBeHidden();
    });

    test('enables export button after generating report', async ({ page }) => {
        // Export button should be disabled initially
        await expect(page.locator('[data-testid="export-btn"]')).toBeDisabled();

        // Generate report
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        // Wait for results
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Export button should be enabled
        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled();
    });

    test('date presets work correctly', async ({ page }) => {
        // Click "This Week" preset
        await page.click('[data-testid="date-preset-this-week"]');

        // Date inputs should be populated
        const startDateValue = await page.inputValue('[data-testid="start-date"]');
        const endDateValue = await page.inputValue('[data-testid="end-date"]');

        expect(startDateValue).toBeTruthy();
        expect(endDateValue).toBeTruthy();

        // Start date should be before or equal to end date
        expect(new Date(startDateValue) <= new Date(endDateValue)).toBeTruthy();
    });

    test('validates date range (start before end)', async ({ page }) => {
        // Set invalid range (start after end)
        await page.fill('[data-testid="start-date"]', '2025-01-15');
        await page.fill('[data-testid="end-date"]', '2025-01-14');
        await page.click('[data-testid="generate-btn"]');

        // Should show validation error (via error dialog or other means)
        // The exact behavior depends on implementation
        // Check that results container is still hidden
        await expect(page.locator('[data-testid="results-container"]')).toBeHidden();
    });

    test('group by selector changes summary grouping', async ({ page }) => {
        // Generate report first
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        // Wait for results
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Change group by to project
        await page.selectOption('[data-testid="group-by-select"]', 'project');

        // Table should update (we can check that it re-rendered by checking content)
        await expect(page.locator('[data-testid="summary-table-body"]')).toBeVisible();
    });
});

test.describe('Report Generation - Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await freezeTime(page);
    });

    test('shows error when users fetch fails', async ({ page }) => {
        await setupApiMocks(page, { shouldFailUsers: true });
        await navigateWithToken(page);

        // Wait for app to finish initializing (will result in error state)
        await waitForAppReady(page, { expectError: true });

        // Wait for error to appear - use Playwright's proper async waiting
        // The error should appear in either the API status banner or empty state
        const apiStatusBanner = page.locator('.api-status-banner:not(.hidden)');
        const emptyStateWithError = page.locator('[data-testid="empty-state"]').filter({ hasText: /error|fail/i });

        // Wait for either error indicator to be visible with extended timeout
        await expect(apiStatusBanner.or(emptyStateWithError)).toBeVisible({ timeout: 10000 });
    });

    test('handles report fetch failure gracefully', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: true });
        await navigateWithToken(page);
        await waitForAppReady(page);

        // Set date range and generate
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);

        // Click generate and wait for failed response
        await Promise.all([
            page.waitForResponse((response) =>
                response.url().includes('/reports/detailed') && response.status() === 500
            ),
            page.click('[data-testid="generate-btn"]'),
        ]);

        // Should show error banner instead of rendering empty results
        await expect(page.locator('[data-testid="api-status-banner"]')).toBeVisible({ timeout: 10000 });
    });
});
