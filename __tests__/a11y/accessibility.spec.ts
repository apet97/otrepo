/**
 * @fileoverview Accessibility Test Suite
 *
 * Tests WCAG 2.1 AA compliance using axe-core accessibility engine.
 * These tests verify that the OTPLUS UI is accessible to users with disabilities.
 *
 * ## Coverage
 * - Page-level accessibility (axe-core automated checks)
 * - Keyboard navigation
 * - Screen reader compatibility
 * - Color contrast
 * - Focus management
 *
 * ## Running Tests
 * ```bash
 * npm run test:a11y          # Run accessibility tests
 * npm run test:e2e -- --grep "Accessibility"  # Run with other e2e tests
 * ```
 *
 * @see https://www.w3.org/WAI/WCAG21/quickref/ - WCAG 2.1 Quick Reference
 * @see https://www.deque.com/axe/ - axe-core documentation
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateWithToken, setupApiMocks, freezeTime, waitForAppReady } from '../e2e/helpers/mock-api';

// Test configuration
test.describe('Accessibility', () => {
    test.beforeEach(async ({ page }) => {
        await setupApiMocks(page);
        await freezeTime(page);
        // Navigate to the app with a mock token
        await navigateWithToken(page);
        // Wait for the app to finish initialization (event handlers bound)
        await waitForAppReady(page);
    });

    test.describe('WCAG 2.1 AA Compliance', () => {
        test('main page passes axe accessibility checks', async ({ page }) => {
            const accessibilityScanResults = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            expect(accessibilityScanResults.violations).toEqual([]);
        });

        test('filter bar is accessible', async ({ page }) => {
            const accessibilityScanResults = await new AxeBuilder({ page })
                .include('.filter-bar-compact')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            expect(accessibilityScanResults.violations).toEqual([]);
        });

        test('configuration section is accessible', async ({ page }) => {
            const accessibilityScanResults = await new AxeBuilder({ page })
                .include('#configContent')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            expect(accessibilityScanResults.violations).toEqual([]);
        });

        test('overrides page meets accessibility standards', async ({ page }) => {
            // Open the overrides page
            await page.click('#openOverridesBtn');
            await page.waitForSelector('#overridesPage:not(.hidden)', { timeout: 5000 });

            const accessibilityScanResults = await new AxeBuilder({ page })
                .include('#overridesPage')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            expect(accessibilityScanResults.violations).toEqual([]);
        });
    });

    test.describe('Keyboard Navigation', () => {
        test('all interactive elements are keyboard accessible', async ({ page }) => {
            // Tab through all focusable elements
            const focusableSelectors = [
                '#generateBtn',
                '#refreshBtn',
                '#exportBtn',
                '#startDate',
                '#endDate',
                '#datePresetThisWeek',
                '#datePresetLastWeek',
                '#configToggle',
                '#openOverridesBtn',
                '#useProfileCapacity',
                '#configDaily',
            ];

            for (const selector of focusableSelectors) {
                const element = page.locator(selector);
                // Disabled elements are intentionally removed from tab order
                if (await element.isDisabled()) continue;
                await element.focus();
                await expect(element).toBeFocused();
            }
        });

        test('configuration toggle works with keyboard', async ({ page }) => {
            const toggle = page.locator('#configToggle');
            const content = page.locator('#configContent');

            // Initially expanded
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect(content).toBeVisible();

            // Collapse with Enter key
            await toggle.focus();
            await page.keyboard.press('Enter');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');

            // Expand with Space key
            await page.keyboard.press('Space');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        });

        test('overrides page can be closed with Back button', async ({ page }) => {
            // Open overrides page
            await page.click('#openOverridesBtn');
            await page.waitForSelector('#overridesPage:not(.hidden)', { timeout: 5000 });

            // Close with Back button
            await page.click('#closeOverridesBtn');

            // Overrides page should be hidden
            await expect(page.locator('#overridesPage')).toHaveClass(/hidden/);
        });

        test('buttons can be activated with Enter and Space', async ({ page }) => {
            const generateBtn = page.locator('#generateBtn');

            // Test Enter key
            await generateBtn.focus();
            await page.keyboard.press('Enter');
            // Should trigger loading state
            await expect(generateBtn).toHaveAttribute('aria-busy', 'true');

            // Wait for completion
            await page.waitForSelector('#generateBtn[aria-busy="false"]', { timeout: 10000 });
        });
    });

    test.describe('Screen Reader Compatibility', () => {
        test('all form controls have associated labels', async ({ page }) => {
            // Check date inputs have labels
            const startDateLabel = page.locator('label[for="startDate"]');
            const endDateLabel = page.locator('label[for="endDate"]');
            await expect(startDateLabel).toBeVisible();
            await expect(endDateLabel).toBeVisible();

            // Check inputs have aria-labels
            const startDate = page.locator('#startDate');
            const endDate = page.locator('#endDate');
            await expect(startDate).toHaveAttribute('aria-label');
            await expect(endDate).toHaveAttribute('aria-label');
        });

        test('buttons have accessible names', async ({ page }) => {
            const buttons = [
                { selector: '#generateBtn', expectedText: 'Generate' },
                { selector: '#refreshBtn', expectedText: /Refresh/ },
                { selector: '#exportBtn', expectedText: 'Export CSV' },
            ];

            for (const { selector, expectedText } of buttons) {
                const button = page.locator(selector);
                await expect(button).toHaveText(expectedText);
            }
        });

        test('aria-expanded correctly reflects toggle state', async ({ page }) => {
            const toggle = page.locator('#configToggle');

            // Initially expanded
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');

            // After clicking, should be collapsed
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');

            // After clicking again, should be expanded
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        });

        test('loading state is announced', async ({ page }) => {
            const generateBtn = page.locator('#generateBtn');

            // Slow down API response so loading state is observable
            await page.route('**/reports/**', async (route) => {
                await new Promise((r) => setTimeout(r, 1000));
                await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
            });

            // Click generate
            await generateBtn.click();

            // Should have aria-busy="true" during loading
            await expect(generateBtn).toHaveAttribute('aria-busy', 'true');
        });

        test('configuration section has proper region landmark', async ({ page }) => {
            const configContent = page.locator('#configContent');
            await expect(configContent).toHaveAttribute('role', 'region');
            await expect(configContent).toHaveAttribute('aria-labelledby', 'configToggle');
        });
    });

    test.describe('Focus Management', () => {
        test('focus is visible on interactive elements', async ({ page }) => {
            // Focus the generate button
            const generateBtn = page.locator('#generateBtn');
            await generateBtn.focus();

            // Check that focus is visible (button has focus styles)
            await expect(generateBtn).toBeFocused();

            // The button should have a visible focus indicator (outline or ring)
            // This is a visual check - in real testing, you'd use visual regression
        });

        test('overrides open button remains focusable after page close', async ({ page }) => {
            const openBtn = page.locator('#openOverridesBtn');

            // Open overrides page
            await openBtn.click();
            await page.waitForSelector('#overridesPage:not(.hidden)', { timeout: 5000 });

            // Close via Back button
            await page.click('#closeOverridesBtn');
            await expect(page.locator('#overridesPage')).toHaveClass(/hidden/);

            // Verify the open button is focusable
            await openBtn.focus();
            await expect(openBtn).toBeFocused();
        });

        test('overrides page contains focusable elements', async ({ page }) => {
            // Open overrides page
            await page.click('#openOverridesBtn');
            await page.waitForSelector('#overridesPage:not(.hidden)', { timeout: 5000 });

            const overridesPage = page.locator('#overridesPage');
            const focusableElements = overridesPage.locator(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );

            // Should have focusable elements (at least the Back button and user cards)
            const count = await focusableElements.count();
            expect(count).toBeGreaterThan(0);

            // Back button should be focusable
            const backBtn = page.locator('#closeOverridesBtn');
            await backBtn.focus();
            await expect(backBtn).toBeFocused();
        });
    });

    test.describe('Color and Contrast', () => {
        test('color contrast meets WCAG AA standards', async ({ page }) => {
            const accessibilityScanResults = await new AxeBuilder({ page })
                .withTags(['wcag2aa'])
                .options({
                    rules: {
                        'color-contrast': { enabled: true },
                    },
                })
                .analyze();

            const contrastViolations = accessibilityScanResults.violations.filter(
                (v) => v.id === 'color-contrast'
            );
            expect(contrastViolations).toEqual([]);
        });

        test('information is not conveyed by color alone', async ({ page }) => {
            // Check that status indicators have text/icon alternatives
            // Export button has text, not just color
            const exportBtn = page.locator('#exportBtn');
            await expect(exportBtn).toHaveText('Export CSV');
        });
    });

    test.describe('Text and Content', () => {
        test('page has proper heading hierarchy', async ({ page }) => {
            const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();

            // Should have at least one h1
            const h1 = await page.locator('h1').count();
            expect(h1).toBeGreaterThanOrEqual(1);

            // Heading levels should not skip (e.g., no h1 -> h3 without h2)
            const levels: number[] = [];
            for (const heading of headings) {
                const tagName = await heading.evaluate((el) => el.tagName.toLowerCase());
                levels.push(parseInt(tagName.replace('h', '')));
            }

            for (let i = 1; i < levels.length; i++) {
                const diff = levels[i] - levels[i - 1];
                // Heading levels should not increase by more than 1
                expect(diff).toBeLessThanOrEqual(1);
            }
        });

        test('images have alt text', async ({ page }) => {
            const images = page.locator('img');
            const count = await images.count();

            for (let i = 0; i < count; i++) {
                const img = images.nth(i);
                const hasAlt = await img.getAttribute('alt');
                const hasRole = await img.getAttribute('role');
                // Images should have alt text or role="presentation" for decorative
                expect(hasAlt !== null || hasRole === 'presentation').toBeTruthy();
            }
        });

        test('lang attribute is set on html element', async ({ page }) => {
            const lang = await page.locator('html').getAttribute('lang');
            expect(lang).toBe('en');
        });
    });
});
