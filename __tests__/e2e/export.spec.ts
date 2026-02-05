import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken, freezeTime, waitForAppReady } from './helpers/mock-api';

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

    test('downloads CSV when clicking export button', async ({ page }) => {
        // Generate report first
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        // Wait for results
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Ensure export button is enabled before clicking
        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        // Use Promise.all to set up listener and click simultaneously for reliability
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            page.click('[data-testid="export-btn"]'),
        ]);

        // Verify download filename
        const filename = download.suggestedFilename();
        expect(filename).toBe('otplus-report.csv');
    });

    test('CSV contains expected headers', async ({ page }) => {
        // Generate report first
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('[data-testid="start-date"]', startDate);
        await page.fill('[data-testid="end-date"]', endDate);
        await page.click('[data-testid="generate-btn"]');

        // Wait for results
        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

        // Ensure export button is enabled before clicking
        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        // Use Promise.all to set up listener and click simultaneously for reliability
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            page.click('[data-testid="export-btn"]'),
        ]);
        const path = await download.path();

        if (path) {
            const fs = await import('fs');
            const content = fs.readFileSync(path, 'utf-8');
            const lines = content.split('\n');
            const headers = lines[0];

            // Check for expected headers
            expect(headers).toContain('User');
            expect(headers).toContain('Date');
            expect(headers).toContain('Regular');
            expect(headers).toContain('Overtime');

            const dataLines = lines.slice(1).filter(l => l.trim());
            expect(dataLines.some(line => line.includes('Alice Johnson'))).toBe(true);
            expect(dataLines.some(line => line.includes('3h'))).toBe(true);
            expect(dataLines.some(line => line.includes('2025-01-15'))).toBe(true);
        }
    });
});
