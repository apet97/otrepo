import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks, navigateWithToken, freezeTime, waitForAppReady } from './helpers/mock-api';

/**
 * Trigger a CSV download from the export button, retrying once on failure.
 * The retry guards against rare races where the browser misses the first click
 * under full-matrix load (same pattern used in security.spec.ts).
 */
async function triggerDownload(page: Page, selector = '[data-testid="export-btn"]') {
    const clickOnce = async () => {
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            page.click(selector),
        ]);
        return download;
    };
    return clickOnce().catch(async () => {
        await expect(page.locator(selector)).toBeEnabled({ timeout: 5000 });
        return clickOnce();
    });
}

test.describe('CSV Export', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            try {
                await dialog.accept();
            } catch {
                // Ignore errors from dialogs after test completion
            }
        });
        await freezeTime(page);
        await setupApiMocks(page, { entriesPerUser: 1, startDate: '2025-01-15' });
        await navigateWithToken(page);
        await waitForAppReady(page);
    });

    test('downloads summary CSV when on summary tab (default)', async ({ page }) => {
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        const download = await triggerDownload(page);

        expect(download.suggestedFilename()).toBe('otplus-summary.csv');
    });

    test('summary CSV contains expected headers', async ({ page }) => {
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        const download = await triggerDownload(page);
        const path = await download.path();

        if (path) {
            const fs = await import('fs');
            const content = fs.readFileSync(path, 'utf-8');
            const lines = content.split('\n');
            const headers = lines[0];

            expect(headers).toContain('Group');
            expect(headers).toContain('Capacity');
            expect(headers).toContain('Regular');
            expect(headers).toContain('Overtime');
            expect(headers).toContain('OTPremium');

            const dataLines = lines.slice(1).filter(l => l.trim());
            expect(dataLines.some(line => line.includes('Alice Johnson'))).toBe(true);
        }
    });

    test('downloads detailed CSV when on detailed tab', async ({ page }) => {
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Switch to detailed tab
        await page.click('[data-tab="detailed"]');

        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        const download = await triggerDownload(page);

        expect(download.suggestedFilename()).toBe('otplus-detailed.csv');
    });

    test('detailed CSV contains start/end times and project info', async ({ page }) => {
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Switch to detailed tab
        await page.click('[data-tab="detailed"]');

        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        const download = await triggerDownload(page);
        const path = await download.path();

        if (path) {
            const fs = await import('fs');
            const content = fs.readFileSync(path, 'utf-8');
            const lines = content.split('\n');
            const headers = lines[0];

            expect(headers).toContain('Date');
            expect(headers).toContain('StartTime');
            expect(headers).toContain('EndTime');
            expect(headers).toContain('User');
            expect(headers).toContain('Project');
            expect(headers).toContain('Client');
            expect(headers).toContain('Task');
            expect(headers).toContain('Status');

            const dataLines = lines.slice(1).filter(l => l.trim());
            expect(dataLines.some(line => line.includes('Alice Johnson'))).toBe(true);
            expect(dataLines.some(line => line.includes('2025-01-15'))).toBe(true);
        }
    });
});
