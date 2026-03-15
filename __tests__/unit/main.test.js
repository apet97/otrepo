/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

const mockStore = {
    token: null,
    claims: null,
    users: [],
    rawEntries: null,
    analysisResults: null,
    config: {
        encryptStorage: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        amountDisplay: 'earned',
        overtimeBasis: 'daily',
    },
    calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
    },
    ui: {
        isAdmin: false,
        activeTab: 'summary',
        paginationTruncated: false,
        paginationAbortedDueToTokenExpiration: false,
        hasAmountRates: true,
        hasCostRates: true,
    },
    overrides: { u1: { capacity: 8 } },
    apiStatus: {},
    throttleStatus: {},
    diagnostics: {},
    setToken: jest.fn(),
    clearToken: jest.fn(),
    initEncryption: jest.fn(),
    loadOverridesEncrypted: jest.fn(),
    incrementThrottleRetry: jest.fn(),
    applyServerConfig: jest.fn(),
    applyServerOverrides: jest.fn(),
    resetConfigToDefaults: jest.fn(),
    updateOverride: jest.fn(),
    updateToken: jest.fn(),
    setOverrideMode: jest.fn(),
    updatePerDayOverride: jest.fn(),
    copyGlobalToPerDay: jest.fn(),
    setWeeklyOverride: jest.fn(),
    copyGlobalToWeekly: jest.fn(),
};

const apiMock = {
    fetchUsers: jest.fn(),
};

const settingsApiMock = {
    initSettingsApi: jest.fn(),
    fetchServerConfig: jest.fn(),
    fetchServerOverrides: jest.fn(),
    saveServerOverrides: jest.fn().mockResolvedValue(true),
};

const uiMock = {
    initializeElements: jest.fn(),
    renderLoading: jest.fn(),
    renderOverridesPage: jest.fn(),
    bindEvents: jest.fn(),
    showError: jest.fn(),
    showSessionExpiringWarning: jest.fn(),
    hideSessionWarning: jest.fn(),
    showSessionExpiredDialog: jest.fn(),
};

const initApiMock = jest.fn();
const resetRateLimiterMock = jest.fn();
const initErrorReportingMock = jest.fn(() => Promise.resolve());
const reportErrorMock = jest.fn();
const initCspReporterMock = jest.fn();
const runCalculationMock = jest.fn();
const bindConfigEventsMock = jest.fn();
const handleGenerateReportMock = jest.fn();
const setCanonicalTimeZoneMock = jest.fn();

jest.unstable_mockModule('../../js/state.js', () => ({
    store: mockStore,
}));

jest.unstable_mockModule('../../js/api.js', () => ({
    Api: apiMock,
    initApi: initApiMock,
    resetRateLimiter: resetRateLimiterMock,
}));

jest.unstable_mockModule('../../js/settings-api.js', () => settingsApiMock);
jest.unstable_mockModule('../../js/ui/index.js', () => uiMock);
jest.unstable_mockModule('../../js/error-reporting.js', () => ({
    initErrorReporting: initErrorReportingMock,
    reportError: reportErrorMock,
}));
jest.unstable_mockModule('../../js/csp-reporter.js', () => ({
    initCSPReporter: initCspReporterMock,
}));
jest.unstable_mockModule('../../js/logger.js', () => ({
    createLogger: jest.fn(() => ({
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));
jest.unstable_mockModule('../../js/worker-manager.js', () => ({
    runCalculation: runCalculationMock,
}));
jest.unstable_mockModule('../../js/config-manager.js', () => ({
    bindConfigEvents: bindConfigEventsMock,
    flushPendingConfigSave: jest.fn(),
}));
jest.unstable_mockModule('../../js/report-orchestrator.js', () => ({
    handleGenerateReport: handleGenerateReportMock,
}));
jest.unstable_mockModule('../../js/health-check.js', () => ({
    getHealthStatus: jest.fn(),
}));
jest.unstable_mockModule('../../js/utils.js', () => ({
    IsoUtils: {
        toDateKey: jest.fn(() => '2026-03-13'),
        generateDateRange: jest.fn((start, end) => [start, end]),
    },
    base64urlDecode: jest.fn((value) => {
        const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
        return atob(padded);
    }),
    setCanonicalTimeZone: setCanonicalTimeZoneMock,
    isValidTimeZone: jest.fn(() => true),
    debounce: jest.fn((fn) => fn),
    isAllowedClockifyUrl: jest.fn((url) => {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') return false;
            const host = parsed.hostname.toLowerCase();
            return host === 'clockify.me' || host.endsWith('.clockify.me');
        } catch { return false; }
    }),
}));

function makeToken(payload) {
    const encode = (value) =>
        btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

function setupDom() {
    document.body.innerHTML = `
        <div id="emptyState" class="hidden"></div>
        <div id="configToggle"></div>
        <div id="configContent"></div>
        <button id="openOverridesBtn" type="button">Overrides</button>
        <input id="startDate" value="2026-03-01" />
        <input id="endDate" value="2026-03-03" />
    `;
}

function resetMockState() {
    mockStore.token = null;
    mockStore.claims = null;
    mockStore.users = [];
    mockStore.rawEntries = null;
    mockStore.analysisResults = null;
    mockStore.config = {
        encryptStorage: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        amountDisplay: 'earned',
        overtimeBasis: 'daily',
    };
    mockStore.calcParams = {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
    };
    mockStore.ui = {
        isAdmin: false,
        activeTab: 'summary',
        paginationTruncated: false,
        paginationAbortedDueToTokenExpiration: false,
        hasAmountRates: true,
        hasCostRates: true,
    };
    mockStore.overrides = { u1: { capacity: 8 } };
    mockStore.apiStatus = {};
    mockStore.throttleStatus = {};
    mockStore.diagnostics = {};
    mockStore.setToken.mockImplementation((token, claims) => {
        mockStore.token = token;
        mockStore.claims = claims;
    });
    mockStore.updateToken.mockImplementation((token, claims) => {
        mockStore.token = token;
        mockStore.claims = claims;
    });
    mockStore.clearToken.mockImplementation(() => {
        mockStore.token = null;
        mockStore.claims = null;
    });
}

describe('main orchestration', () => {
    let init;
    let loadInitialData;
    let initSessionTimeout;
    let clearSessionTimers;
    let isAllowedOrigin;
    let requestTokenRefresh;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        resetMockState();
        setupDom();
        window.history.replaceState({}, '', '/');

        apiMock.fetchUsers.mockResolvedValue([{ id: 'u1', name: 'Ada Lovelace' }]);
        settingsApiMock.fetchServerConfig.mockResolvedValue(null);
        settingsApiMock.fetchServerOverrides.mockResolvedValue(null);

        ({ init, loadInitialData, initSessionTimeout, clearSessionTimers, isAllowedOrigin, requestTokenRefresh } =
            await import('../../js/main.js'));
    });

    afterEach(() => {
        clearSessionTimers();
        standardAfterEach();
        document.body.innerHTML = '';
        delete document.body.dataset.appError;
        jest.useRealTimers();
    });

    it('shows an initialization error when no auth token is provided', async () => {
        await init();

        expect(reportErrorMock).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                module: 'main',
                operation: 'init',
                level: 'warning',
            })
        );
        expect(uiMock.renderLoading).toHaveBeenCalledWith(false);
        expect(document.getElementById('emptyState').textContent).toContain(
            'No authentication token provided'
        );
        expect(document.body.dataset.appReady).toBe('true');
        expect(document.body.dataset.appError).toBe('true');
    });

    it('rejects tokens whose backendUrl is outside Clockify', async () => {
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://evil.example.com/api',
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);

        await init();

        expect(mockStore.setToken).not.toHaveBeenCalled();
        expect(bindConfigEventsMock).not.toHaveBeenCalled();
        expect(reportErrorMock).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                module: 'main',
                operation: 'init',
                level: 'error',
            })
        );
        expect(document.getElementById('emptyState').textContent).toContain(
            'Invalid authentication token'
        );
    });

    it('allows localhost in tests but blocks localhost-prefixed attacker origins', () => {
        expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
        expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
    });

    it('applies shared server settings, binds events, and hides admin controls for non-admins', async () => {
        mockStore.token = 'test-token';
        mockStore.claims = {
            workspaceId: 'ws_123',
            workspaceRole: 'USER',
        };
        settingsApiMock.fetchServerConfig.mockResolvedValue({
            config: { applyHolidays: true },
            calcParams: { dailyThreshold: 6 },
        });
        settingsApiMock.fetchServerOverrides.mockResolvedValue({
            overrides: { u1: { capacity: 6 } },
        });

        await loadInitialData();

        // initSettingsApi called via applyTokenClaims (not loadInitialData)
        expect(settingsApiMock.fetchServerConfig).toHaveBeenCalled();
        expect(mockStore.applyServerConfig).toHaveBeenCalledWith(
            { applyHolidays: true },
            { dailyThreshold: 6 }
        );
        expect(mockStore.applyServerOverrides).toHaveBeenCalledWith({ u1: { capacity: 6 } });
        expect(apiMock.fetchUsers).toHaveBeenCalledWith('ws_123');
        expect(uiMock.renderOverridesPage).toHaveBeenCalledTimes(1);
        expect(bindConfigEventsMock).toHaveBeenCalledWith(handleGenerateReportMock);
        expect(uiMock.bindEvents).toHaveBeenCalledTimes(1);
        expect(document.getElementById('configToggle').classList.contains('admin-only-hidden')).toBe(
            true
        );
        expect(document.getElementById('configContent').classList.contains('admin-only-hidden')).toBe(
            true
        );
        expect(document.getElementById('openOverridesBtn').classList.contains('admin-only-hidden')).toBe(
            true
        );
        expect(document.body.dataset.appReady).toBe('true');
        expect(document.body.dataset.appError).toBeUndefined();
    });

    it('wires admin override callbacks to recalculate and persist shared overrides', async () => {
        mockStore.token = 'test-token';
        mockStore.rawEntries = [{ id: 'entry-1' }];
        mockStore.claims = {
            workspaceId: 'ws_123',
            workspaceRole: 'ADMIN',
        };

        await loadInitialData();

        const callbacks = uiMock.bindEvents.mock.calls[0][0];
        callbacks.onOverrideChange('u1', 'capacity', '6');

        expect(mockStore.updateOverride).toHaveBeenCalledWith('u1', 'capacity', '6');
        expect(runCalculationMock).toHaveBeenCalledTimes(1);
        expect(settingsApiMock.saveServerOverrides).toHaveBeenCalledWith(mockStore.overrides);
    });

    it('does not persist shared overrides for non-admin callback changes', async () => {
        mockStore.token = 'test-token';
        mockStore.rawEntries = [{ id: 'entry-1' }];
        mockStore.claims = {
            workspaceId: 'ws_123',
            workspaceRole: 'USER',
        };

        await loadInitialData();

        const callbacks = uiMock.bindEvents.mock.calls[0][0];
        callbacks.onOverrideModeChange('u1', 'weekly');

        expect(mockStore.setOverrideMode).toHaveBeenCalledWith('u1', 'weekly');
        expect(runCalculationMock).toHaveBeenCalledTimes(1);
        expect(settingsApiMock.saveServerOverrides).not.toHaveBeenCalled();
    });

    it('warns immediately when the session is close to expiry and expires on timer', () => {
        jest.useFakeTimers();
        const exp = Math.floor(Date.now() / 1000) + 120;

        initSessionTimeout({ exp });

        expect(uiMock.showSessionExpiringWarning).toHaveBeenCalledWith(
            2,
            expect.any(Function),
            expect.any(Function)
        );

        jest.advanceTimersByTime(120000);

        expect(mockStore.clearToken).toHaveBeenCalledTimes(1);
        expect(uiMock.hideSessionWarning).toHaveBeenCalledTimes(1);
        expect(uiMock.showSessionExpiredDialog).toHaveBeenCalledTimes(1);
    });

    // P0-1: init() awaits loadInitialData — appReady and all side effects complete before init() resolves
    it('init() awaits loadInitialData — bindEvents called before init() resolves', async () => {
        delete document.body.dataset.appReady;

        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);

        await init();

        // These side effects happen at the end of loadInitialData.
        // If init() didn't await loadInitialData, they would not be complete yet.
        expect(uiMock.bindEvents).toHaveBeenCalledTimes(1);
        expect(bindConfigEventsMock).toHaveBeenCalledTimes(1);
        expect(document.body.dataset.appReady).toBe('true');
        expect(document.body.dataset.appError).toBeUndefined();
    });

    // P1-1: requestTokenRefresh dispatches postMessage in both formats
    it('requestTokenRefresh sends both { action } and { title } postMessage formats', () => {
        jest.useFakeTimers();
        const postMessageSpy = jest.spyOn(window, 'postMessage');

        requestTokenRefresh();

        // Primary: JSON-stringified { action } format via window.top
        expect(postMessageSpy).toHaveBeenCalledWith(
            JSON.stringify({ action: 'refreshAddonToken' }),
            '*'
        );
        // Fallback: plain object { title } format via window.parent
        expect(postMessageSpy).toHaveBeenCalledWith(
            { title: 'refreshAddonToken' },
            '*'
        );
        postMessageSpy.mockRestore();
    });

    // P1-2: session warning callback uses requestTokenRefresh instead of reload
    it('session warning re-auth callback calls requestTokenRefresh', () => {
        jest.useFakeTimers();
        const postMessageSpy = jest.spyOn(window, 'postMessage');
        const exp = Math.floor(Date.now() / 1000) + 120;

        initSessionTimeout({ exp });

        // The warning callback is the 2nd arg to showSessionExpiringWarning
        const reAuthCallback = uiMock.showSessionExpiringWarning.mock.calls[0][1];
        reAuthCallback();

        expect(postMessageSpy).toHaveBeenCalledWith(
            JSON.stringify({ action: 'refreshAddonToken' }),
            '*'
        );
        postMessageSpy.mockRestore();
    });

    // P1-3: proactive refresh fires before expiry
    it('sets a proactive refresh timer ~2 minutes before token expiry', () => {
        jest.useFakeTimers();
        const postMessageSpy = jest.spyOn(window, 'postMessage');
        // Token expires in 10 minutes (600s)
        const exp = Math.floor(Date.now() / 1000) + 600;

        initSessionTimeout({ exp });

        // Proactive refresh should fire at 600 - 120 = 480 seconds
        jest.advanceTimersByTime(480_000);

        expect(postMessageSpy).toHaveBeenCalledWith(
            JSON.stringify({ action: 'refreshAddonToken' }),
            '*'
        );
        postMessageSpy.mockRestore();
    });

    // P1-4: applyTokenClaims re-initializes settings API with refreshed token
    it('applyTokenClaims re-initializes settingsApi with the new token', async () => {
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);

        await init();

        // initSettingsApi is called once in applyTokenClaims (no longer duplicated in loadInitialData)
        expect(settingsApiMock.initSettingsApi).toHaveBeenCalledWith(token);
    });

    // P1-5: handleTokenMessage accepts { title: 'refreshAddonToken', body: '<jwt>' } format
    it('handleTokenMessage processes { title, body } refresh response format via updateToken', async () => {
        // init() registers the message listener — run it first
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();
        mockStore.setToken.mockClear();
        mockStore.updateToken.mockClear();
        settingsApiMock.initSettingsApi.mockClear();

        const refreshedToken = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 7200,
        });

        // Simulate Clockify responding with { title, body } format
        const event = new MessageEvent('message', {
            data: { title: 'refreshAddonToken', body: refreshedToken },
            origin: 'https://app.clockify.me',
        });
        window.dispatchEvent(event);

        // Allow the async parseAndValidateToken → applyTokenClaims chain to resolve
        await new Promise((r) => setTimeout(r, 0));

        // Refresh path uses updateToken (lightweight), NOT setToken
        expect(mockStore.updateToken).toHaveBeenCalledWith(refreshedToken, expect.objectContaining({
            workspaceId: 'ws_123',
        }));
        expect(mockStore.setToken).not.toHaveBeenCalled();
        expect(settingsApiMock.initSettingsApi).toHaveBeenCalledWith(refreshedToken);
    });

    // P1-6: valid token from trusted origin cancels fallback reload
    it('valid token from trusted origin cancels fallback reload', async () => {
        jest.useFakeTimers();

        // init() registers the message listener
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();

        // Start token refresh (sets 5s fallback timer)
        requestTokenRefresh();
        mockStore.updateToken.mockClear();

        // Simulate Clockify responding with a valid refreshed token
        const refreshedToken = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 7200,
        });
        const event = new MessageEvent('message', {
            data: { title: 'refreshAddonToken', body: refreshedToken },
            origin: 'https://app.clockify.me',
        });
        window.dispatchEvent(event);

        // Allow the async validation chain to resolve
        await jest.advanceTimersByTimeAsync(0);

        // Token was successfully applied
        expect(mockStore.updateToken).toHaveBeenCalledWith(refreshedToken, expect.objectContaining({
            workspaceId: 'ws_123',
        }));

        // Advance past the 5s fallback timeout — if fallback wasn't cancelled,
        // location.reload() would throw "Not implemented" in jsdom.
        // No throw = fallback was successfully cancelled.
        expect(() => jest.advanceTimersByTime(6000)).not.toThrow();
    });

    // P1: token refresh does NOT reset date inputs
    it('token refresh does NOT reset date inputs', async () => {
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();

        // Set custom date values (user has changed them)
        const startEl = document.getElementById('startDate');
        const endEl = document.getElementById('endDate');
        startEl.value = '2026-01-15';
        endEl.value = '2026-01-31';

        // Dispatch a refresh token message
        const refreshedToken = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 7200,
        });
        window.dispatchEvent(new MessageEvent('message', {
            data: { auth_token: refreshedToken },
            origin: 'https://app.clockify.me',
        }));
        await new Promise((r) => setTimeout(r, 0));

        // Date inputs should be unchanged
        expect(startEl.value).toBe('2026-01-15');
        expect(endEl.value).toBe('2026-01-31');
    });

    // P1: token refresh does NOT call store.setToken for same workspace
    it('token refresh does NOT call store.setToken for same workspace', async () => {
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();
        mockStore.setToken.mockClear();
        mockStore.updateToken.mockClear();

        const refreshedToken = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 7200,
        });
        window.dispatchEvent(new MessageEvent('message', {
            data: { authToken: refreshedToken },
            origin: 'https://app.clockify.me',
        }));
        await new Promise((r) => setTimeout(r, 0));

        expect(mockStore.updateToken).toHaveBeenCalled();
        expect(mockStore.setToken).not.toHaveBeenCalled();
    });

    // P1: token refresh does NOT re-init encryption
    it('token refresh does NOT re-init encryption', async () => {
        mockStore.config.encryptStorage = true;
        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();
        mockStore.initEncryption.mockClear();
        mockStore.loadOverridesEncrypted.mockClear();

        const refreshedToken = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 7200,
        });
        window.dispatchEvent(new MessageEvent('message', {
            data: { auth_token: refreshedToken },
            origin: 'https://app.clockify.me',
        }));
        await new Promise((r) => setTimeout(r, 0));

        expect(mockStore.initEncryption).not.toHaveBeenCalled();
        expect(mockStore.loadOverridesEncrypted).not.toHaveBeenCalled();
    });

    // P2: invalid token from trusted origin does NOT cancel fallback reload
    it('invalid token from trusted origin does NOT cancel fallback reload', async () => {
        jest.useFakeTimers();

        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();
        mockStore.updateToken.mockClear();

        // Start token refresh (sets 5s fallback timer)
        requestTokenRefresh();
        const timersAfterRefresh = jest.getTimerCount();

        // Simulate Clockify responding with an INVALID token (missing workspaceId)
        const malformedToken = makeToken({ exp: Math.floor(Date.now() / 1000) + 7200 });
        window.dispatchEvent(new MessageEvent('message', {
            data: { auth_token: malformedToken },
            origin: 'https://app.clockify.me',
        }));

        // Allow the async validation chain to reject
        await jest.advanceTimersByTimeAsync(0);

        // Fallback timer should still be pending (validation failed, timer NOT cleared)
        expect(jest.getTimerCount()).toBe(timersAfterRefresh);
        // updateToken should NOT have been called (invalid token was rejected)
        expect(mockStore.updateToken).not.toHaveBeenCalled();
    });

    // P2: untrusted-origin messages don't cancel the fallback timer
    it('untrusted-origin token messages do not cancel fallback timer', async () => {
        jest.useFakeTimers();

        const token = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
        window.history.replaceState({}, '', `/?auth_token=${token}`);
        await init();
        mockStore.updateToken.mockClear();

        requestTokenRefresh();
        const timersAfterRefresh = jest.getTimerCount();

        // Send a valid-looking message from an untrusted origin
        const refreshedToken = makeToken({
            workspaceId: 'ws_123',
            backendUrl: 'https://api.clockify.me/api',
            exp: Math.floor(Date.now() / 1000) + 7200,
        });
        window.dispatchEvent(new MessageEvent('message', {
            data: { auth_token: refreshedToken },
            origin: 'https://evil.example.com',
        }));

        await jest.advanceTimersByTimeAsync(0);

        // Fallback timer should still be pending (untrusted origin was ignored)
        expect(jest.getTimerCount()).toBe(timersAfterRefresh);
        // updateToken should NOT have been called (message was ignored)
        expect(mockStore.updateToken).not.toHaveBeenCalled();
    });

    // P3-1: unhandledrejection handler reports error but does NOT set appReady
    it('unhandledrejection handler reports error but does NOT set appReady', async () => {
        document.body.dataset.appReady = '';

        const event = new Event('unhandledrejection');
        Object.defineProperty(event, 'reason', { value: new Error('async boom') });
        window.dispatchEvent(event);

        expect(document.body.dataset.appReady).toBe('');
        expect(reportErrorMock).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                module: 'main',
                operation: 'unhandledrejection',
            })
        );
    });
});
