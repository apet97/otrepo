import { test, expect, type Dialog, type Page } from '@playwright/test';
import { setupApiMocks, navigateWithToken, freezeTime, mockUsers, createMockToken, waitForAppReady } from './helpers/mock-api';

async function acceptDialogSafely(dialog: Dialog): Promise<void> {
    try {
        await dialog.accept();
    } catch (error) {
        // Dialog callbacks can race with page teardown in multi-browser runs.
        if (error instanceof Error && /Target page, context or browser has been closed/.test(error.message)) {
            return;
        }
        throw error;
    }
}

/**
 * Security E2E Tests
 *
 * These tests verify that the application properly handles potentially malicious
 * input to prevent CSV injection (DDE attacks) and XSS vulnerabilities.
 */

test.describe('CSV Injection Prevention', () => {
    /**
     * CSV injection test cases matching those in fixtures.js
     * These characters can trigger formula execution in spreadsheet apps
     */
    const CSV_INJECTION_CHARS = [
        { char: '=', description: 'equals sign (formula)', payload: '=SUM(A1:A10)' },
        { char: '+', description: 'plus sign (formula)', payload: '+cmd|\' /C calc' },
        { char: '-', description: 'minus sign (formula)', payload: '-1+1' },
        { char: '@', description: 'at sign (DDE)', payload: '@SUM(A1)' },
    ];

    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await acceptDialogSafely(dialog);
        });
        await freezeTime(page);
    });

    async function triggerCsvDownload(page: Page) {
        const clickOnce = async () => {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 15000 }),
                page.click('[data-testid="export-btn"]'),
            ]);
            return download;
        };
        // Firefox occasionally misses the first export click in CI-like runs; retry once.
        return clickOnce().catch(async () => {
            await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });
            return clickOnce();
        });
    }

    for (const { char, description, payload } of CSV_INJECTION_CHARS) {
        test(`sanitizes ${description} in CSV export`, async ({ page }) => {
            // Create mock users with injection payload in name
            const maliciousUsers = [
                { id: 'user-1', name: `${payload} Attacker`, email: 'attack@example.com', status: 'ACTIVE' },
            ];

            await setupApiMocks(page, { users: maliciousUsers, entriesPerUser: 1, startDate: '2025-01-15' });
            await navigateWithToken(page);
            await waitForAppReady(page);

            // Generate report
            await page.fill('[data-testid="start-date"]', '2025-01-08');
            await page.fill('[data-testid="end-date"]', '2025-01-15');
            await page.click('[data-testid="generate-btn"]');

            await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

            // Download CSV and verify sanitization
            const download = await triggerCsvDownload(page);

            const path = await download.path();
            if (path) {
                const fs = await import('fs');
                const content = fs.readFileSync(path, 'utf-8');

                // The sanitization should prepend a single quote to prevent formula execution
                // If the payload starts with =, +, -, @, tab, or CR, it should be prefixed with '
                const lines = content.split('\n').slice(1); // Skip header
                const dataLines = lines.filter(l => l.trim());

                // Check that the malicious payload is either:
                // 1. Prefixed with single quote (OWASP sanitization)
                // 2. Or the dangerous character is properly escaped
                const hasDangerousUnescaped = dataLines.some(line => {
                    // Check if the line contains the raw injection character at field start
                    // CSV fields are comma-separated, so check after each comma or at line start
                    const fields = line.split(',');
                    return fields.some(field => {
                        // Remove quotes if present
                        const unquoted = field.replace(/^"|"$/g, '');
                        // Should NOT start with dangerous char unless prefixed with '
                        return unquoted.startsWith(char) && !unquoted.startsWith("'" + char);
                    });
                });

                expect(hasDangerousUnescaped).toBe(false);
            }
        });
    }

    test('sanitizes tab character in CSV export', async ({ page }) => {
        const maliciousUsers = [
            { id: 'user-1', name: '\tHidden Tab', email: 'tab@example.com', status: 'ACTIVE' },
        ];

        await setupApiMocks(page, { users: maliciousUsers, entriesPerUser: 1, startDate: '2025-01-15' });
        await navigateWithToken(page);
        await waitForAppReady(page);

        await page.fill('[data-testid="start-date"]', '2025-01-08');
        await page.fill('[data-testid="end-date"]', '2025-01-15');
        await page.click('[data-testid="generate-btn"]');

        await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="export-btn"]')).toBeEnabled({ timeout: 5000 });

        const download = await triggerCsvDownload(page);

        const path = await download.path();
        if (path) {
            const fs = await import('fs');
            const content = fs.readFileSync(path, 'utf-8');
            const lines = content.split('\n').slice(1);
            const dataLines = lines.filter(l => l.trim());

            // Tab at field start should be sanitized with ' prefix
            const hasUnsanitizedTab = dataLines.some(line => {
                const fields = line.split(',');
                return fields.some(field => {
                    const unquoted = field.replace(/^"|"$/g, '');
                    return unquoted.startsWith('\t') && !unquoted.startsWith("'\t");
                });
            });

            expect(hasUnsanitizedTab).toBe(false);
        }
    });
});

test.describe('XSS Prevention', () => {
    // These payloads are intentional test vectors for XSS prevention
    /* eslint-disable no-script-url */
    const XSS_PAYLOADS = [
        { name: 'script tag', payload: '<script>alert("XSS")</script>' },
        { name: 'img onerror', payload: '<img src=x onerror=alert("XSS")>' },
        { name: 'svg onload', payload: '<svg onload=alert("XSS")>' },
        { name: 'event handler', payload: '" onclick="alert(\'XSS\')" data-foo="' },
        { name: 'javascript protocol', payload: 'javascript:alert("XSS")' },
    ];
    /* eslint-enable no-script-url */

    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            const message = dialog.message();
            // Only fail if the dialog message contains our XSS payload indicators
            // This allows legitimate app dialogs (cache, confirmations) to proceed
            if (message.includes('XSS') ||
                message.includes('alert("XSS")') ||
                message.includes('<script>')) {
                throw new Error(`XSS Alert triggered: ${message}`);
            }
            // Accept all other dialogs (cache prompts, confirmations, etc.)
            await acceptDialogSafely(dialog);
        });
        await freezeTime(page);
    });

    for (const { name, payload } of XSS_PAYLOADS) {
        test(`prevents ${name} in user names`, async ({ page }) => {
            const maliciousUsers = [
                { id: 'user-1', name: payload, email: 'xss@example.com', status: 'ACTIVE' },
            ];

            await setupApiMocks(page, { users: maliciousUsers, entriesPerUser: 1, startDate: '2025-01-15' });
            await navigateWithToken(page);
            await waitForAppReady(page);

            await page.fill('[data-testid="start-date"]', '2025-01-08');
            await page.fill('[data-testid="end-date"]', '2025-01-15');
            await page.click('[data-testid="generate-btn"]');

            // Wait for results to render
            await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

            // Give time for any XSS to execute
            await expect(page.locator('[data-testid="results-container"]')).toBeVisible();

            // Verify the page content is properly escaped
            const pageContent = await page.content();

            // The script tag should be escaped, not executed
            expect(pageContent).not.toContain('<script>alert');

            // Check that the payload appears as text, not as HTML
            if (payload.includes('<script>')) {
                // The literal <script> should be escaped
                expect(pageContent).not.toMatch(/<script>alert\(/i);
            }
        });

        test(`prevents ${name} in task descriptions via CSV`, async ({ page }) => {
            // Create entries with XSS payload in description by modifying mock
            await page.route('**/v1/workspaces/*/reports/detailed', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        timeentries: [{
                            _id: 'entry-xss-1',
                            id: 'entry-xss-1',
                            userId: 'user-1',
                            userName: 'Test User',
                            description: payload, // XSS payload in description
                            billable: true,
                            type: 'REGULAR',
                            projectId: 'proj-1',
                            projectName: 'Test Project',
                            timeInterval: {
                                start: '2025-01-15T09:00:00Z',
                                end: '2025-01-15T17:00:00Z',
                                duration: 28800,
                            },
                            hourlyRate: { amount: 5000, currency: 'USD' },
                            tags: [],
                        }],
                    }),
                });
            });

            // Setup other mocks
            await page.route('**/v1/workspaces/*/users', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(mockUsers),
                });
            });

            await page.route('**/v1/workspaces/*/member-profile/*', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ workCapacity: 'PT8H', workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }),
                });
            });

            await page.route('**/v1/workspaces/*/holidays/**', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([]),
                });
            });

            await page.route('**/v1/workspaces/*/time-off/requests', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ requests: [] }),
                });
            });

            await navigateWithToken(page);
            await waitForAppReady(page);

            await page.fill('[data-testid="start-date"]', '2025-01-08');
            await page.fill('[data-testid="end-date"]', '2025-01-15');
            await page.click('[data-testid="generate-btn"]');

            await expect(page.locator('[data-testid="results-container"]')).toBeVisible({ timeout: 10000 });

            // Wait for potential XSS execution
            await expect(page.locator('[data-testid="results-container"]')).toBeVisible();

            // No alert should have been triggered (handled by dialog listener above)
        });
    }
});
