import { Page, Route } from '@playwright/test';

/**
 * Mock API helpers for E2E tests
 */

/**
 * Wait for the app to finish initialization.
 *
 * The app sets `data-app-ready="true"` on the body element when JS initialization
 * completes (event handlers bound, initial data loaded or error shown).
 *
 * @param page - Playwright Page object
 * @param options - Configuration options
 * @param options.expectError - If true, also waits for error indicators (useful for tests
 *                              that expect API failures during initialization)
 */
export async function waitForAppReady(page: Page, options?: { expectError?: boolean }) {
    if (options?.expectError) {
        // For error tests, wait for error banner OR app ready
        await Promise.race([
            page.waitForSelector('[data-app-ready="true"]', { timeout: 10000 }),
            page.waitForSelector('[data-testid="api-status-banner"]:not(.hidden)', { timeout: 10000 }),
            page.waitForSelector('#emptyState:not(.hidden)', { timeout: 10000 }),
        ]);
    } else {
        await page.waitForSelector('[data-app-ready="true"]', { timeout: 10000 });
    }
}

/**
 * Mock JWT token for testing
 */
export function createMockToken(claims: Record<string, unknown> = {}): string {
    const base64UrlEncode = (value: string): string =>
        Buffer.from(value, 'utf8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');

    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64UrlEncode(JSON.stringify({
        workspaceId: 'ws-test-123',
        backendUrl: 'https://api.clockify.me',
        reportsUrl: 'https://reports.api.clockify.me',
        theme: 'LIGHT',
        ...claims,
    }));
    // Note: Signature validation is not performed in tests.
    const signature = base64UrlEncode('mock-signature');
    return `${header}.${payload}.${signature}`;
}

/**
 * Mock users data
 */
export const mockUsers = [
    { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com', status: 'ACTIVE' },
    { id: 'user-2', name: 'Bob Smith', email: 'bob@example.com', status: 'ACTIVE' },
    { id: 'user-3', name: 'Carol Davis', email: 'carol@example.com', status: 'ACTIVE' },
];

/**
 * Mock time entries data
 */
export function createMockTimeEntries(options: {
    userId?: string;
    userName?: string;
    count?: number;
    startDate?: string;
} = {}) {
    const {
        userId = 'user-1',
        userName = 'Alice Johnson',
        count = 5,
        // Use a fixed date for deterministic tests
        startDate = '2025-01-15',
    } = options;

    const baseDate = new Date(`${startDate}T00:00:00Z`);
    const entries = [];
    for (let i = 0; i < count; i++) {
        const date = new Date(baseDate);
        date.setUTCDate(date.getUTCDate() + Math.floor(i / 2));
        const dateStr = date.toISOString().split('T')[0];

        entries.push({
            _id: `entry-${userId}-${i}`,
            id: `entry-${userId}-${i}`,
            userId,
            userName,
            description: `Task ${i + 1}`,
            billable: i % 2 === 0,
            type: 'REGULAR',
            projectId: 'proj-1',
            projectName: 'Main Project',
            clientId: 'client-1',
            clientName: 'Test Client',
            taskId: 'task-1',
            taskName: 'Development',
            timeInterval: {
                start: `${dateStr}T09:00:00Z`,
                end: `${dateStr}T${12 + (i % 4)}:00:00Z`,
                duration: (3 + (i % 4)) * 3600,
            },
            hourlyRate: { amount: 5000, currency: 'USD' },
            earnedRate: 5000,
            costRate: 3000,
            amounts: [
                { type: 'EARNED', value: (3 + (i % 4)) * 50 },
                { type: 'COST', value: (3 + (i % 4)) * 30 },
            ],
            tags: [],
        });
    }
    return entries;
}

/**
 * Mock detailed report response
 */
export function createMockDetailedReportResponse(options: {
    entriesPerUser?: number;
    startDate?: string;
} = {}) {
    const { entriesPerUser = 5, startDate = '2025-01-15' } = options;

    const allEntries = mockUsers.flatMap(user =>
        createMockTimeEntries({
            userId: user.id,
            userName: user.name,
            count: entriesPerUser,
            startDate,
        })
    );

    return {
        timeentries: allEntries,
    };
}

/**
 * Mock user profile data
 */
export function createMockProfile(userId: string) {
    return {
        workCapacity: 'PT8H',
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    };
}

/**
 * Mock holidays data
 */
export function createMockHolidays(year = 2025) {
    return [
        {
            name: 'New Year',
            datePeriod: {
                startDate: `${year}-01-01`,
                endDate: `${year}-01-01`,
            },
        },
    ];
}

/**
 * Mock time off data
 */
export function createMockTimeOffResponse() {
    return {
        requests: [],
    };
}

/**
 * API failure modes for testing error handling
 */
export type ApiFailureMode =
    | false                    // No failure
    | 'server_error'           // 500 Internal Server Error
    | 'not_found'              // 404 Not Found
    | 'rate_limited'           // 429 Too Many Requests
    | 'network_timeout'        // Network timeout simulation
    | 'malformed_json';        // Invalid JSON response

/**
 * Helper to fulfill route with specific failure mode
 */
async function fulfillWithFailure(route: Route, failureMode: ApiFailureMode): Promise<boolean> {
    if (failureMode === false) {
        return false; // No failure, continue with normal response
    }

    switch (failureMode) {
        case 'server_error':
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
            return true;

        case 'not_found':
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Not Found' }),
            });
            return true;

        case 'rate_limited':
            await route.fulfill({
                status: 429,
                contentType: 'application/json',
                headers: { 'Retry-After': '5' },
                body: JSON.stringify({ error: 'Too Many Requests' }),
            });
            return true;

        case 'network_timeout':
            // Simulate timeout by aborting the route
            await route.abort('timedout');
            return true;

        case 'malformed_json':
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: 'this is not valid json {{{',
            });
            return true;

        default:
            return false;
    }
}

/**
 * Setup API mocking for a test page
 */
export async function setupApiMocks(page: Page, options: {
    users?: typeof mockUsers;
    entriesPerUser?: number;
    startDate?: string;
    shouldFailUsers?: boolean | ApiFailureMode;
    shouldFailReport?: boolean | ApiFailureMode;
    shouldFailProfiles?: boolean | ApiFailureMode;
    shouldFailHolidays?: boolean | ApiFailureMode;
    shouldFailTimeOff?: boolean | ApiFailureMode;
} = {}) {
    const {
        users = mockUsers,
        entriesPerUser = 5,
        startDate = '2025-01-15',
        shouldFailUsers = false,
        shouldFailReport = false,
        shouldFailProfiles = false,
        shouldFailHolidays = false,
        shouldFailTimeOff = false,
    } = options;

    // Convert boolean to ApiFailureMode
    const usersFailure: ApiFailureMode = shouldFailUsers === true ? 'server_error' : shouldFailUsers;
    const reportFailure: ApiFailureMode = shouldFailReport === true ? 'server_error' : shouldFailReport;
    const profilesFailure: ApiFailureMode = shouldFailProfiles === true ? 'server_error' : shouldFailProfiles;
    const holidaysFailure: ApiFailureMode = shouldFailHolidays === true ? 'server_error' : shouldFailHolidays;
    const timeOffFailure: ApiFailureMode = shouldFailTimeOff === true ? 'server_error' : shouldFailTimeOff;

    // Mock users endpoint
    await page.route('**/v1/workspaces/*/users', async (route: Route) => {
        if (await fulfillWithFailure(route, usersFailure)) return;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(users),
        });
    });

    // Mock detailed report endpoint
    await page.route('**/v1/workspaces/*/reports/detailed', async (route: Route) => {
        if (await fulfillWithFailure(route, reportFailure)) return;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockDetailedReportResponse({ entriesPerUser, startDate })),
        });
    });

    // Mock profiles endpoint
    await page.route('**/v1/workspaces/*/member-profile/*', async (route: Route) => {
        if (await fulfillWithFailure(route, profilesFailure)) return;
        const url = route.request().url();
        const userId = url.split('/').pop() || 'user-1';
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockProfile(userId)),
        });
    });

    // Mock holidays endpoint
    await page.route('**/v1/workspaces/*/holidays/**', async (route: Route) => {
        if (await fulfillWithFailure(route, holidaysFailure)) return;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockHolidays()),
        });
    });

    // Mock time-off endpoint
    await page.route('**/v1/workspaces/*/time-off/requests', async (route: Route) => {
        if (await fulfillWithFailure(route, timeOffFailure)) return;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockTimeOffResponse()),
        });
    });
}

/**
 * Freeze browser time for deterministic tests.
 */
export async function freezeTime(page: Page, iso: string = '2025-01-15T12:00:00Z') {
    await page.addInitScript(({ iso: isoString }) => {
        const fixed = new Date(isoString);
        const OriginalDate = Date;
        // @ts-ignore - override Date for deterministic tests
        // eslint-disable-next-line no-global-assign
        Date = class extends OriginalDate {
            constructor(...args: any[]) {
                return args.length ? new OriginalDate(...args) : new OriginalDate(fixed);
            }
            static now() {
                return fixed.getTime();
            }
            static parse(str: string) {
                return OriginalDate.parse(str);
            }
            static UTC(...args: any[]) {
                return OriginalDate.UTC(...args);
            }
        } as DateConstructor;
    }, { iso });
}

/**
 * Navigate to app with mock token
 */
export async function navigateWithToken(page: Page, token?: string) {
    const mockToken = token || createMockToken();
    await page.goto(`/?auth_token=${encodeURIComponent(mockToken)}`);
}
