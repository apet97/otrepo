import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './__tests__',
    testMatch: ['**/e2e/**/*.spec.ts', '**/a11y/**/*.spec.ts'],

    /* Run tests in files in parallel */
    fullyParallel: true,

    /* Fail the build on CI if you accidentally left test.only in the source code */
    forbidOnly: !!process.env.CI,

    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,

    /* Opt out of parallel tests on CI */
    workers: process.env.CI ? 1 : undefined,

    /* Reporter to use */
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['list'],
    ],

    /* Shared settings for all the projects below */
    use: {
        /* Base URL for relative URLs in tests */
        baseURL: 'http://localhost:8080',

        /* Allow axe-core to inject scripts on CSP-protected pages */
        bypassCSP: true,

        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',

        /* Screenshot on failure */
        screenshot: 'only-on-failure',

        /* Video recording on failure */
        video: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: (() => {
        const allProjects = [
            {
                name: 'chromium',
                use: { ...devices['Desktop Chrome'] },
            },
            {
                name: 'firefox',
                use: { ...devices['Desktop Firefox'] },
            },
            {
                name: 'webkit',
                use: { ...devices['Desktop Safari'] },
            },
        ];

        if (process.env.CI) {
            return allProjects.filter((p) => p.name !== 'webkit');
        }

        return allProjects;
    })(),

    /* Run your local dev server before starting the tests */
    webServer: {
        command: 'npm run build && npx http-server dist -p 8080 -c-1',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
    },

    /* Global timeout for each test */
    timeout: 30000,

    /* Expect timeout */
    expect: {
        timeout: 5000,
    },
});
