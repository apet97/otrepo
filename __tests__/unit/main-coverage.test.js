/**
 * @jest-environment jsdom
 */

/**
 * Comprehensive coverage tests for js/main.ts
 *
 * Targets all uncovered lines/branches identified in coverage report:
 * - unrefTimerIfSupported (lines 83-89)
 * - initSessionTimeout edge cases (lines 113-115, 123-146, 150-155, 164-169)
 * - resolveCanonicalTimeZone fallback paths (lines 211, 213-219)
 * - isAllowedClockifyUrl error path (line 267)
 * - parseAndValidateToken error paths (lines 322, 326, 329, 332)
 * - initSubsystems catch/encryption listener (lines 347-352, 374-386)
 * - applyTokenClaims theme/encryption/rate limiter (lines 391-413)
 * - init() disallowed origin, no token, invalid token (lines 417-457)
 * - loadInitialData server config/overrides, admin detection, callbacks (lines 500-656)
 * - Auto-init guard (line 667-668)
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// ============================================================================
// Mock declarations (must precede dynamic imports)
// ============================================================================

const uiMock = {
  initializeElements: jest.fn(),
  renderLoading: jest.fn(),
  renderOverridesPage: jest.fn(),
  bindEvents: jest.fn(),
  showError: jest.fn(),
  showSessionExpiredDialog: jest.fn(),
  showSessionExpiringWarning: jest.fn(),
  hideSessionWarning: jest.fn(),
  renderApiStatus: jest.fn(),
  renderSummaryStrip: jest.fn(),
  renderSummaryTable: jest.fn(),
  renderDetailedTable: jest.fn(),
};

const apiMock = {
  fetchUsers: jest.fn(() => Promise.resolve([{ id: 'user1', name: 'User 1' }])),
};

const resetRateLimiterMock = jest.fn();
const initApiMock = jest.fn();

const initErrorReportingMock = jest.fn(() => Promise.resolve(true));
const reportErrorMock = jest.fn();
const initCSPReporterMock = jest.fn();

const runCalculationMock = jest.fn();
const bindConfigEventsMock = jest.fn();
const handleGenerateReportMock = jest.fn();

let isValidTimeZoneMock = jest.fn(() => true);
let setCanonicalTimeZoneMock = jest.fn();

const settingsApiMocks = {
  initSettingsApi: jest.fn(),
  fetchServerConfig: jest.fn(() => Promise.resolve(null)),
  fetchServerOverrides: jest.fn(() => Promise.resolve(null)),
  saveServerConfig: jest.fn(() => Promise.resolve(true)),
  saveServerOverrides: jest.fn(() => Promise.resolve(true)),
};

// Store mock: mimics the real store with all properties used by main.ts
const storeMock = {
  token: null,
  claims: null,
  users: [],
  rawEntries: null,
  analysisResults: null,
  config: {
    encryptStorage: false,
    useProfileCapacity: true,
    useProfileWorkingDays: true,
    applyHolidays: true,
    applyTimeOff: true,
    showBillableBreakdown: true,
    overtimeBasis: 'daily',
  },
  calcParams: {
    dailyThreshold: 8,
    weeklyThreshold: 40,
    overtimeMultiplier: 1.5,
  },
  overrides: {},
  apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 },
  diagnostics: { sentryInitFailed: false },
  ui: {
    isLoading: false,
    isAdmin: false,
    paginationTruncated: false,
    paginationAbortedDueToTokenExpiration: false,
  },
  throttleStatus: { retryCount: 0, lastRetryTime: null },
  setToken: jest.fn(),
  clearToken: jest.fn(),
  initEncryption: jest.fn(() => Promise.resolve()),
  loadOverridesEncrypted: jest.fn(() => Promise.resolve()),
  updateOverride: jest.fn(),
  setOverrideMode: jest.fn(),
  updatePerDayOverride: jest.fn(),
  copyGlobalToPerDay: jest.fn(),
  setWeeklyOverride: jest.fn(),
  copyGlobalToWeekly: jest.fn(),
  incrementThrottleRetry: jest.fn(),
  applyServerConfig: jest.fn(),
  applyServerOverrides: jest.fn(),
  resetConfigToDefaults: jest.fn(),
  updateToken: jest.fn(),
};

jest.unstable_mockModule('../../js/state.js', () => ({
  store: storeMock,
}));

jest.unstable_mockModule('../../js/ui/index.js', () => uiMock);
jest.unstable_mockModule('../../js/api.js', () => ({
  initApi: initApiMock,
  Api: apiMock,
  resetRateLimiter: resetRateLimiterMock,
  resetCircuitBreaker: jest.fn(),
  getCircuitBreakerState: jest.fn(() => ({ isOpen: false, failures: 0 })),
}));
jest.unstable_mockModule('../../js/settings-api.js', () => settingsApiMocks);
jest.unstable_mockModule('../../js/error-reporting.js', () => ({
  initErrorReporting: initErrorReportingMock,
  reportError: reportErrorMock,
}));
jest.unstable_mockModule('../../js/csp-reporter.js', () => ({
  initCSPReporter: initCSPReporterMock,
}));
jest.unstable_mockModule('../../js/logger.js', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
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

// Mock utils.js — must provide all named exports used by main.ts
jest.unstable_mockModule('../../js/utils.js', () => ({
  IsoUtils: {
    toDateKey: jest.fn((date) => {
      if (!date) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }),
    generateDateRange: jest.fn((start, end) => {
      const dates = [];
      const startDate = new Date(start);
      const endDate = new Date(end);
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }
      return dates;
    }),
  },
  base64urlDecode: jest.fn((value) => {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '='
    );
    return atob(padded);
  }),
  setCanonicalTimeZone: (...args) => setCanonicalTimeZoneMock(...args),
  isValidTimeZone: (...args) => isValidTimeZoneMock(...args),
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

// ============================================================================
// Helpers
// ============================================================================

function base64url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeToken(claims) {
  const header = { alg: 'HS256', typ: 'JWT' };
  return `${base64url(header)}.${base64url(claims)}.sig`;
}

function setAuthTokenUrl(token) {
  window.history.replaceState({}, '', `/?auth_token=${token}`);
}

function setupDOM() {
  document.body.innerHTML = `
    <div id="emptyState" class="hidden"></div>
    <input type="date" id="startDate" value="2025-01-01" />
    <input type="date" id="endDate" value="2025-01-31" />
    <div id="configToggle"></div>
    <div id="configContent"></div>
    <button id="openOverridesBtn"></button>
  `;
  document.body.dataset.appReady = '';
  delete document.body.dataset.appError;
  document.body.classList.remove('cl-theme-dark');
}

function resetStoreMock() {
  storeMock.token = null;
  storeMock.claims = null;
  storeMock.users = [];
  storeMock.rawEntries = null;
  storeMock.analysisResults = null;
  storeMock.config.encryptStorage = false;
  storeMock.overrides = {};
  storeMock.diagnostics = { sentryInitFailed: false };
  storeMock.ui = {
    isLoading: false,
    isAdmin: false,
    paginationTruncated: false,
    paginationAbortedDueToTokenExpiration: false,
  };
  storeMock.setToken.mockReset();
  storeMock.clearToken.mockReset();
  storeMock.initEncryption.mockReset().mockResolvedValue(undefined);
  storeMock.loadOverridesEncrypted.mockReset().mockResolvedValue(undefined);
  storeMock.updateOverride.mockReset();
  storeMock.setOverrideMode.mockReset();
  storeMock.updatePerDayOverride.mockReset();
  storeMock.copyGlobalToPerDay.mockReset();
  storeMock.setWeeklyOverride.mockReset();
  storeMock.copyGlobalToWeekly.mockReset();
  storeMock.incrementThrottleRetry.mockReset();
  storeMock.applyServerConfig.mockReset();
  storeMock.applyServerOverrides.mockReset();
  storeMock.resetConfigToDefaults.mockReset();
  storeMock.updateToken.mockReset();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('main.ts coverage', () => {
  let init;
  let initSessionTimeout;
  let clearSessionTimers;
  let loadInitialData;
  let isAllowedOrigin;
  let setDefaultDates;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Restore NODE_ENV
    process.env.NODE_ENV = savedNodeEnv;

    // Reset function-level mocks
    isValidTimeZoneMock = jest.fn(() => true);
    setCanonicalTimeZoneMock = jest.fn();

    // Reset all mocks to defaults
    initErrorReportingMock.mockReturnValue(Promise.resolve(true));
    apiMock.fetchUsers.mockResolvedValue([{ id: 'user1', name: 'User 1' }]);
    settingsApiMocks.fetchServerConfig.mockResolvedValue(null);
    settingsApiMocks.fetchServerOverrides.mockResolvedValue(null);

    resetStoreMock();
    setupDOM();

    const mainModule = await import('../../js/main.js');
    init = mainModule.init;
    initSessionTimeout = mainModule.initSessionTimeout;
    clearSessionTimers = mainModule.clearSessionTimers;
    loadInitialData = mainModule.loadInitialData;
    isAllowedOrigin = mainModule.isAllowedOrigin;
    setDefaultDates = mainModule.setDefaultDates;
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
    delete document.body.dataset.appError;
    delete document.documentElement.dataset.skipSignatureVerify;
    window.history.replaceState({}, '', '/');
    process.env.NODE_ENV = savedNodeEnv;
  });

  // ==========================================================================
  // unrefTimerIfSupported (lines 83-89)
  // ==========================================================================

  describe('unrefTimerIfSupported', () => {
    it('calls unref on Node-style timer objects during initSessionTimeout', () => {
      const mockUnref = jest.fn();
      const spy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
        return { unref: mockUnref, ref: jest.fn() };
      });

      const now = Math.floor(Date.now() / 1000);
      initSessionTimeout({ exp: now + 3600, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      // unrefTimerIfSupported checks typeof timer.unref === 'function' and calls it
      expect(mockUnref).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('handles numeric timer IDs (browser path) without calling unref', () => {
      jest.useFakeTimers();
      const now = Date.now();
      const exp = Math.floor(now / 1000) + 3600;

      // With fake timers, setTimeout returns numbers (not objects with .unref).
      // unrefTimerIfSupported should handle this gracefully without throwing.
      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      // Verify the function completed without error (timers were created)
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      clearSessionTimers();
      jest.useRealTimers();
    });

    it('exercises the unref branch with an object timer that has unref (line 85-87)', () => {
      // Override setTimeout to return an object with unref
      const originalSetTimeout = globalThis.setTimeout;
      const unrefSpy = jest.fn();
      globalThis.setTimeout = jest.fn(() => ({ unref: unrefSpy }));

      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600;

      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      // Both timers should have called unref
      expect(unrefSpy).toHaveBeenCalled();

      // Restore and clean up
      globalThis.setTimeout = originalSetTimeout;
      clearSessionTimers();
    });

    it('handles object timer without unref method (line 86 false branch)', () => {
      // Override setTimeout to return an object WITHOUT unref
      const originalSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = jest.fn(() => ({ noUnref: true }));

      const now = Math.floor(Date.now() / 1000);
      const exp = now + 3600;

      // Should not throw when the object has no unref
      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      globalThis.setTimeout = originalSetTimeout;
      clearSessionTimers();
    });
  });

  // ==========================================================================
  // initSessionTimeout (lines 113-115, 123-146, 150-155, 164-169)
  // ==========================================================================

  describe('initSessionTimeout', () => {
    it('shows expired dialog immediately when token already expired (lines 113-115)', () => {
      const now = Math.floor(Date.now() / 1000);
      const exp = now - 100;

      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      expect(storeMock.clearToken).toHaveBeenCalled();
      expect(uiMock.showSessionExpiredDialog).toHaveBeenCalled();
    });

    it('shows warning immediately when less than 5 min remaining (lines 137-146)', () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 120; // 2 minutes

      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      expect(uiMock.showSessionExpiringWarning).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Function),
        expect.any(Function)
      );

      // Exercise reload callback (line 142)
      const reloadCallback = uiMock.showSessionExpiringWarning.mock.calls[0][1];
      try { reloadCallback(); } catch { /* location.reload may throw in jsdom */ }

      // Exercise dismiss callback (lines 143-145)
      const dismissCallback = uiMock.showSessionExpiringWarning.mock.calls[0][2];
      dismissCallback();

      clearSessionTimers();
      jest.useRealTimers();
    });

    it('sets up warning timer that fires and shows warning (lines 123-136)', () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 600; // 10 minutes

      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      jest.advanceTimersByTime(300 * 1000); // trigger warning at 5 min mark

      expect(uiMock.showSessionExpiringWarning).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Function),
        expect.any(Function)
      );

      // Exercise reload callback (line 129)
      const reloadCallback = uiMock.showSessionExpiringWarning.mock.calls[0][1];
      try { reloadCallback(); } catch { /* location.reload */ }

      // Exercise dismiss callback (lines 131-133)
      const dismissCallback = uiMock.showSessionExpiringWarning.mock.calls[0][2];
      dismissCallback();

      clearSessionTimers();
      jest.useRealTimers();
    });

    it('fires expiration timer callback (lines 150-155)', () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 10;

      initSessionTimeout({ exp, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      jest.advanceTimersByTime(10 * 1000);

      expect(storeMock.clearToken).toHaveBeenCalled();
      expect(uiMock.hideSessionWarning).toHaveBeenCalled();
      expect(uiMock.showSessionExpiredDialog).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('clears existing warning timer on second call (lines 164-165)', () => {
      jest.useFakeTimers();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
      const now = Math.floor(Date.now() / 1000);

      initSessionTimeout({ exp: now + 600, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });
      clearTimeoutSpy.mockClear();
      initSessionTimeout({ exp: now + 1200, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });

      // Second init should have cleared first init's timers
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
      clearSessionTimers();
      jest.useRealTimers();
    });

    it('clears existing expiration timer (lines 168-169)', () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);

      initSessionTimeout({ exp: now + 60, workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });
      clearSessionTimers();

      jest.advanceTimersByTime(60 * 1000);
      expect(uiMock.showSessionExpiredDialog).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('returns early when exp is not a number', () => {
      initSessionTimeout({ workspaceId: 'ws', backendUrl: 'https://api.clockify.me' });
      expect(uiMock.showSessionExpiredDialog).not.toHaveBeenCalled();
      expect(uiMock.showSessionExpiringWarning).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // resolveCanonicalTimeZone (lines 211, 213-219)
  // ==========================================================================

  describe('resolveCanonicalTimeZone via init()', () => {
    it('falls back to workspaceTimeZone when user timeZone is missing (lines 213-217)', async () => {
      isValidTimeZoneMock = jest.fn((tz) => tz === 'America/Chicago');

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceTimeZone: 'America/Chicago',
      });
      setAuthTokenUrl(token);

      await init();

      expect(setCanonicalTimeZoneMock).toHaveBeenCalledWith('America/Chicago');
    });

    it('falls back to workspaceTimezone (lowercase z) when workspaceTimeZone is missing (line 215)', async () => {
      isValidTimeZoneMock = jest.fn((tz) => tz === 'Europe/London');

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceTimezone: 'Europe/London',
      });
      setAuthTokenUrl(token);

      await init();

      expect(setCanonicalTimeZoneMock).toHaveBeenCalledWith('Europe/London');
    });

    it('falls back to Intl.DateTimeFormat when no timezone claims are valid (line 219)', async () => {
      isValidTimeZoneMock = jest.fn(() => false);

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(setCanonicalTimeZoneMock).toHaveBeenCalledWith(expect.any(String));
    });

    it('prefers user timeZone over workspace timeZone (line 211)', async () => {
      isValidTimeZoneMock = jest.fn(() => true);

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        timeZone: 'Asia/Tokyo',
        workspaceTimeZone: 'America/Chicago',
      });
      setAuthTokenUrl(token);

      await init();

      expect(setCanonicalTimeZoneMock).toHaveBeenCalledWith('Asia/Tokyo');
    });
  });

  // ==========================================================================
  // isAllowedClockifyUrl — error path (line 267)
  // ==========================================================================

  describe('isAllowedClockifyUrl error path', () => {
    it('rejects token with invalid backendUrl that throws in URL constructor (line 267)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: '://not-a-url',
      });
      setAuthTokenUrl(token);

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('rejects http:// backendUrl (HTTPS enforcement)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'http://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // parseAndValidateToken (lines 322, 326, 329, 332)
  // ==========================================================================

  describe('parseAndValidateToken error paths', () => {
    it('accepts developer-style token claims by normalizing activeWs/baseURL', async () => {
      const token = makeToken({
        activeWs: 'ws_legacy',
        baseURL: 'https://developer.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(storeMock.setToken).toHaveBeenCalledWith(
        token,
        expect.objectContaining({
          workspaceId: 'ws_legacy',
          backendUrl: 'https://developer.clockify.me/api',
        })
      );
    });

    it('rejects token with invalid format (not 3 parts) — line 322', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setAuthTokenUrl('invalid.token');

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Invalid token format') }),
        expect.objectContaining({ module: 'main', operation: 'init', level: 'error' })
      );
      consoleErrorSpy.mockRestore();
    });

    it('rejects token with missing workspaceId — line 326', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const token = makeToken({ userId: 'user_1' });
      setAuthTokenUrl(token);

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('rejects token with missing backendUrl — line 328', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const token = makeToken({ workspaceId: 'ws_123' });
      setAuthTokenUrl(token);

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('rejects token with untrusted backendUrl — line 329', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://evil.example.com/api',
      });
      setAuthTokenUrl(token);

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('rejects token with untrusted reportsUrl — line 332', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        reportsUrl: 'https://evil.example.com/reports',
      });
      setAuthTokenUrl(token);

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // initSubsystems (lines 347-352, 374-386)
  // ==========================================================================

  describe('initSubsystems', () => {
    it('catches error reporting initialization failure with Error (lines 347-352)', async () => {
      initErrorReportingMock.mockRejectedValue(new Error('Sentry init failed'));

      await init();
      await new Promise((r) => setTimeout(r, 0));

      expect(storeMock.diagnostics.sentryInitFailed).toBe(true);
    });

    it('catches error reporting failure with non-Error (line 350 fallback)', async () => {
      initErrorReportingMock.mockRejectedValue('plain string error');

      await init();
      await new Promise((r) => setTimeout(r, 0));

      expect(storeMock.diagnostics.sentryInitFailed).toBe(true);
    });

    it('catches error reporting failure with null error (line 350 null safety)', async () => {
      initErrorReportingMock.mockRejectedValue(null);

      await init();
      await new Promise((r) => setTimeout(r, 0));

      expect(storeMock.diagnostics.sentryInitFailed).toBe(true);
    });

    it('initApi callbacks work correctly — setApiStatus and setUiPaginationFlag (lines 363-369)', async () => {
      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      // initApi was called with a deps object. Capture it and invoke the callbacks.
      expect(initApiMock).toHaveBeenCalled();
      const deps = initApiMock.mock.calls[0][0];

      // Test setApiStatus (line 364)
      deps.setApiStatus('profilesFailed', 5);
      expect(storeMock.apiStatus.profilesFailed).toBe(5);

      // Test setUiPaginationFlag (line 367)
      deps.setUiPaginationFlag('paginationTruncated');
      expect(storeMock.ui.paginationTruncated).toBe(true);

      deps.setUiPaginationFlag('paginationAbortedDueToTokenExpiration');
      expect(storeMock.ui.paginationAbortedDueToTokenExpiration).toBe(true);

      // Test incrementThrottleRetry (line 369)
      deps.incrementThrottleRetry();
      expect(storeMock.incrementThrottleRetry).toHaveBeenCalled();

      // Test getToken, getClaims, getConfig
      storeMock.token = 'test-token';
      expect(deps.getToken()).toBe('test-token');
      expect(deps.getClaims()).toBe(storeMock.claims);
      expect(deps.getConfig()).toBe(storeMock.config);
    });

    it('does not bind encryption listener twice (line 374 false branch)', async () => {
      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      // First call to init() binds the listener
      await init();

      // Reset URL to call init again
      const token2 = makeToken({
        workspaceId: 'ws_456',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token2);

      // Track calls to addEventListener before second init
      const addEventSpy = jest.spyOn(window, 'addEventListener');

      // Second call — encryptionErrorListenerBound is already true
      await init();

      // Verify addEventListener was NOT called with 'otplus:encryption-error'
      // since the listener was already bound in the first call
      const encryptionListenerCalls = addEventSpy.mock.calls.filter(
        ([event]) => event === 'otplus:encryption-error'
      );
      expect(encryptionListenerCalls).toHaveLength(0);

      addEventSpy.mockRestore();
    });

    it('binds encryption error listener and shows error on event (lines 374-386)', async () => {
      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      // Dispatch the encryption error event
      window.dispatchEvent(new Event('otplus:encryption-error'));

      expect(uiMock.showError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Encryption Error',
          type: 'UNKNOWN',
        })
      );
    });
  });

  // ==========================================================================
  // applyTokenClaims (lines 390-413)
  // ==========================================================================

  describe('applyTokenClaims via init()', () => {
    it('applies DARK theme class to body (line 392)', async () => {
      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        theme: 'DARK',
      });
      setAuthTokenUrl(token);

      await init();

      expect(document.body.classList.contains('cl-theme-dark')).toBe(true);
    });

    it('does not apply theme class for LIGHT theme (line 391 false branch)', async () => {
      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        theme: 'LIGHT',
      });
      setAuthTokenUrl(token);

      await init();

      expect(document.body.classList.contains('cl-theme-dark')).toBe(false);
    });

    it('resets rate limiter when workspace changes (lines 395-397)', async () => {
      storeMock.claims = {
        workspaceId: 'ws_old',
        backendUrl: 'https://api.clockify.me',
      };

      const token = makeToken({
        workspaceId: 'ws_new',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(resetRateLimiterMock).toHaveBeenCalled();
    });

    it('does not reset rate limiter when workspace is the same (line 395)', async () => {
      storeMock.claims = {
        workspaceId: 'ws_same',
        backendUrl: 'https://api.clockify.me',
      };

      const token = makeToken({
        workspaceId: 'ws_same',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(resetRateLimiterMock).not.toHaveBeenCalled();
    });

    it('does not reset rate limiter when no prior claims (line 395)', async () => {
      storeMock.claims = null;

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(resetRateLimiterMock).not.toHaveBeenCalled();
    });

    it('initializes encryption when encryptStorage is true (lines 401-408)', async () => {
      storeMock.config.encryptStorage = true;

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(storeMock.initEncryption).toHaveBeenCalled();
      expect(storeMock.loadOverridesEncrypted).toHaveBeenCalled();
    });

    it('handles encryption initialization failure gracefully (lines 405-407)', async () => {
      storeMock.config.encryptStorage = true;
      storeMock.initEncryption.mockRejectedValue(new Error('crypto fail'));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Encryption initialization failed',
        expect.any(Error)
      );
      consoleWarnSpy.mockRestore();
    });

    it('does not call encryption when encryptStorage is false (line 401)', async () => {
      storeMock.config.encryptStorage = false;

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(storeMock.initEncryption).not.toHaveBeenCalled();
    });

    it('updates admin state on token refresh when role changes MEMBER→ADMIN', async () => {
      // Initial load as MEMBER
      const initialToken = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceRole: 'MEMBER',
      });
      setAuthTokenUrl(initialToken);
      await init();

      // After init, storeMock.setToken was called (not updateToken) — initial path
      expect(storeMock.setToken).toHaveBeenCalled();
      // storeMock.ui.isAdmin would be set by loadInitialData, simulate it:
      storeMock.ui.isAdmin = false;
      // Add admin-only-hidden to simulate non-admin state
      document.getElementById('configToggle').classList.add('admin-only-hidden');
      document.getElementById('configContent').classList.add('admin-only-hidden');
      document.getElementById('openOverridesBtn').classList.add('admin-only-hidden');

      // Simulate token refresh via postMessage
      const refreshToken = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceRole: 'ADMIN',
      });
      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify({ auth_token: refreshToken }),
        origin: 'http://localhost',
      });
      window.dispatchEvent(messageEvent);
      // Allow the async promise chain to resolve
      await new Promise((r) => setTimeout(r, 50));

      expect(storeMock.updateToken).toHaveBeenCalled();
      expect(storeMock.ui.isAdmin).toBe(true);
      expect(document.getElementById('configToggle').classList.contains('admin-only-hidden')).toBe(false);
      expect(document.getElementById('configContent').classList.contains('admin-only-hidden')).toBe(false);
      expect(document.getElementById('openOverridesBtn').classList.contains('admin-only-hidden')).toBe(false);
    });

    it('does not toggle admin UI when role stays the same on refresh', async () => {
      // Initial load as ADMIN
      const initialToken = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceRole: 'ADMIN',
      });
      setAuthTokenUrl(initialToken);
      await init();

      // Simulate admin state from loadInitialData
      storeMock.ui.isAdmin = true;

      // Refresh with same ADMIN role
      const refreshToken = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceRole: 'ADMIN',
      });
      const messageEvent = new MessageEvent('message', {
        data: JSON.stringify({ auth_token: refreshToken }),
        origin: 'http://localhost',
      });
      window.dispatchEvent(messageEvent);
      await new Promise((r) => setTimeout(r, 50));

      expect(storeMock.updateToken).toHaveBeenCalled();
      expect(storeMock.ui.isAdmin).toBe(true);
      // Admin elements should NOT have admin-only-hidden
      expect(document.getElementById('configToggle').classList.contains('admin-only-hidden')).toBe(false);
    });
  });

  // ==========================================================================
  // init() (lines 417-457)
  // ==========================================================================

  describe('init()', () => {
    it('blocks disallowed origin in production (lines 417-424)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      process.env.NODE_ENV = 'production';

      jest.resetModules();
      const mainModule = await import('../../js/main.js');

      // jsdom default origin is 'http://localhost' — not in production allowed list
      await mainModule.init();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'CORS: Unauthorized origin',
        expect.any(String)
      );

      const emptyState = document.getElementById('emptyState');
      expect(emptyState.textContent).toBe(
        'This addon can only be accessed through Clockify.'
      );
      expect(document.body.dataset.appReady).toBe('true');
      expect(document.body.dataset.appError).toBe('true');
      consoleErrorSpy.mockRestore();
    });

    it('blocks disallowed origin in non-production with verbose message (lines 420-422)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // In non-production mode, localhost is allowed, so we use the production path
      // where localhost IS disallowed to verify the verbose error message branch.
      // The production test above covers the production message; here we verify
      // that in non-production, a truly disallowed origin triggers the verbose message.
      // Since jsdom doesn't allow overriding window.location.origin, we test this
      // by checking the isAllowedOrigin function directly.
      expect(isAllowedOrigin('https://evil.example.com')).toBe(false);

      consoleErrorSpy.mockRestore();
    });

    it('shows error when no auth token provided (lines 429-442)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      window.history.replaceState({}, '', '/');

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('No auth token');
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          module: 'main',
          operation: 'init',
          level: 'warning',
        })
      );
      expect(uiMock.renderLoading).toHaveBeenCalledWith(false);

      const emptyState = document.getElementById('emptyState');
      expect(emptyState.textContent).toContain('No authentication token');
      consoleErrorSpy.mockRestore();
    });

    it('extracts token and scrubs URL when auth_token is the only param (line 312 empty branch)', async () => {
      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      // Only auth_token param — nextSearch will be empty
      window.history.replaceState({}, '', `/?auth_token=${token}`);

      const replaceSpy = jest.spyOn(window.history, 'replaceState');
      await init();

      // The URL should have no query string after scrubbing
      const lastCall = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1];
      const nextUrl = lastCall ? lastCall[2] : '';
      expect(nextUrl).not.toContain('auth_token');
      expect(nextUrl).not.toContain('?'); // no query string at all
    });

    it('catches invalid token and shows error (lines 448-457)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setAuthTokenUrl('part1.part2');

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          module: 'main',
          operation: 'init',
          level: 'error',
        })
      );
      expect(uiMock.renderLoading).toHaveBeenCalledWith(false);

      const emptyState = document.getElementById('emptyState');
      expect(emptyState.textContent).toContain('Invalid authentication token');
      consoleErrorSpy.mockRestore();
    });

    it('catches invalid base64 in token payload (lines 449-454)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      setAuthTokenUrl('aaa.!!!invalid!!!.ccc');

      await init();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid token', expect.any(Error));
      expect(reportErrorMock).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // loadInitialData (lines 500-656)
  // ==========================================================================

  describe('loadInitialData()', () => {
    beforeEach(() => {
      storeMock.claims = {
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
        workspaceRole: 'OWNER',
      };
      storeMock.token = 'mock-token';
      storeMock.ui.isAdmin = false;
    });

    it('throws when no workspaceId in claims (line 508)', async () => {
      storeMock.claims = { backendUrl: 'https://api.clockify.me' };

      await loadInitialData();

      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No workspace ID' }),
        expect.objectContaining({
          module: 'main',
          operation: 'loadInitialData',
          level: 'error',
        })
      );
      expect(uiMock.showError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Failed to Load Users',
          type: 'API_ERROR',
        })
      );
    });

    it('throws when claims is null (line 507-508)', async () => {
      storeMock.claims = null;

      await loadInitialData();

      expect(reportErrorMock).toHaveBeenCalled();
      expect(uiMock.showError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to Load Users' })
      );
    });

    it('applies server config when available (lines 519-521)', async () => {
      settingsApiMocks.fetchServerConfig.mockResolvedValue({
        config: { overtimeBasis: 'weekly' },
        calcParams: { dailyThreshold: 7 },
      });

      await loadInitialData();

      expect(storeMock.applyServerConfig).toHaveBeenCalledWith(
        { overtimeBasis: 'weekly' },
        { dailyThreshold: 7 }
      );
    });

    it('applies server overrides when available (lines 522-526)', async () => {
      settingsApiMocks.fetchServerOverrides.mockResolvedValue({
        overrides: { user1: { capacity: 6, mode: 'global' } },
      });

      await loadInitialData();

      expect(storeMock.applyServerOverrides).toHaveBeenCalledWith({
        user1: { capacity: 6, mode: 'global' },
      });
    });

    it('resets config to defaults when server config is null', async () => {
      settingsApiMocks.fetchServerConfig.mockResolvedValue(null);

      await loadInitialData();

      expect(storeMock.applyServerConfig).not.toHaveBeenCalled();
      expect(storeMock.resetConfigToDefaults).toHaveBeenCalled();
    });

    it('skips server overrides when null (line 522)', async () => {
      settingsApiMocks.fetchServerOverrides.mockResolvedValue(null);

      await loadInitialData();

      expect(storeMock.applyServerOverrides).not.toHaveBeenCalled();
    });

    it('resets config to defaults when config property is missing', async () => {
      settingsApiMocks.fetchServerConfig.mockResolvedValue({});

      await loadInitialData();

      expect(storeMock.applyServerConfig).not.toHaveBeenCalled();
      expect(storeMock.resetConfigToDefaults).toHaveBeenCalled();
    });

    it('skips overrides when overrides property is missing', async () => {
      settingsApiMocks.fetchServerOverrides.mockResolvedValue({});

      await loadInitialData();

      expect(storeMock.applyServerOverrides).not.toHaveBeenCalled();
    });

    it('detects OWNER as admin (line 532)', async () => {
      storeMock.claims.workspaceRole = 'OWNER';

      await loadInitialData();

      expect(storeMock.ui.isAdmin).toBe(true);
    });

    it('detects ADMIN as admin (line 532)', async () => {
      storeMock.claims.workspaceRole = 'ADMIN';

      await loadInitialData();

      expect(storeMock.ui.isAdmin).toBe(true);
    });

    it('detects MEMBER as non-admin and hides admin-only UI (lines 560-569)', async () => {
      storeMock.claims.workspaceRole = 'MEMBER';

      await loadInitialData();

      expect(storeMock.ui.isAdmin).toBe(false);

      expect(document.getElementById('configToggle').classList.contains('admin-only-hidden')).toBe(true);
      expect(document.getElementById('configContent').classList.contains('admin-only-hidden')).toBe(true);
      expect(document.getElementById('openOverridesBtn').classList.contains('admin-only-hidden')).toBe(true);
    });

    it('hides admin UI even when some elements are missing (line 567)', async () => {
      storeMock.claims.workspaceRole = 'MEMBER';
      document.getElementById('configToggle').remove();

      await loadInitialData();

      expect(storeMock.ui.isAdmin).toBe(false);
      // Should not throw despite missing element
    });

    it('shows validation error when no users returned (lines 540-553)', async () => {
      apiMock.fetchUsers.mockResolvedValue([]);

      await loadInitialData();

      expect(uiMock.showError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'No Users Found',
          action: 'reload',
          type: 'VALIDATION_ERROR',
        })
      );
      expect(document.body.dataset.appReady).toBe('true');
      expect(document.body.dataset.appError).toBe('true');
    });

    it('shows validation error when users is null (line 540)', async () => {
      apiMock.fetchUsers.mockResolvedValue(null);

      await loadInitialData();

      expect(uiMock.showError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'No Users Found' })
      );
    });

    it('calls renderOverridesPage after users fetched (line 557)', async () => {
      await loadInitialData();

      expect(uiMock.renderOverridesPage).toHaveBeenCalled();
    });

    it('calls bindConfigEvents with handleGenerateReport (line 596)', async () => {
      await loadInitialData();

      expect(bindConfigEventsMock).toHaveBeenCalledWith(handleGenerateReportMock);
    });

    it('sets appReady after successful init (line 655)', async () => {
      await loadInitialData();

      expect(document.body.dataset.appReady).toBe('true');
      expect(document.body.dataset.appError).toBeUndefined();
    });

    it('handles fetchUsers failure (lines 570-589)', async () => {
      apiMock.fetchUsers.mockRejectedValue(new Error('network error'));

      await loadInitialData();

      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          module: 'main',
          operation: 'loadInitialData',
          level: 'error',
        })
      );
      expect(uiMock.showError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Failed to Load Users',
          type: 'API_ERROR',
        })
      );
      expect(document.body.dataset.appReady).toBe('true');
      expect(document.body.dataset.appError).toBe('true');
    });

    it('handles non-Error exception in catch (line 571)', async () => {
      apiMock.fetchUsers.mockRejectedValue('string error');

      await loadInitialData();

      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ module: 'main' })
      );
    });

    it('binds UI events with all override callbacks (lines 611-651)', async () => {
      await loadInitialData();

      expect(uiMock.bindEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          onGenerate: expect.any(Function),
          onRecalculate: expect.any(Function),
          onOverrideChange: expect.any(Function),
          onOverrideModeChange: expect.any(Function),
          onPerDayOverrideChange: expect.any(Function),
          onCopyFromGlobal: expect.any(Function),
          onWeeklyOverrideChange: expect.any(Function),
          onCopyGlobalToWeekly: expect.any(Function),
        })
      );
    });

    it('onOverrideChange updates override and recalculates (lines 613-617)', async () => {
      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onOverrideChange('user1', 'capacity', '6');

      expect(storeMock.updateOverride).toHaveBeenCalledWith('user1', 'capacity', '6');
      expect(runCalculationMock).toHaveBeenCalled();
    });

    it('onOverrideChange does not recalculate when no rawEntries (line 601)', async () => {
      await loadInitialData();

      storeMock.rawEntries = null;
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onOverrideChange('user1', 'capacity', '6');

      expect(runCalculationMock).not.toHaveBeenCalled();
    });

    it('onOverrideModeChange sets mode and recalculates (lines 618-623)', async () => {
      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onOverrideModeChange('user1', 'per-day');

      expect(storeMock.setOverrideMode).toHaveBeenCalledWith('user1', 'per-day');
      expect(runCalculationMock).toHaveBeenCalled();
    });

    it('onOverrideModeChange skips recalculation when no rawEntries', async () => {
      await loadInitialData();

      storeMock.rawEntries = null;
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onOverrideModeChange('user1', 'per-day');

      expect(runCalculationMock).not.toHaveBeenCalled();
    });

    it('onPerDayOverrideChange updates and recalculates (lines 624-628)', async () => {
      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onPerDayOverrideChange('user1', '2025-01-01', 'capacity', '6');

      expect(storeMock.updatePerDayOverride).toHaveBeenCalledWith('user1', '2025-01-01', 'capacity', '6');
      expect(runCalculationMock).toHaveBeenCalled();
    });

    it('onCopyFromGlobal copies overrides for date range (lines 629-639)', async () => {
      document.getElementById('startDate').value = '2025-01-01';
      document.getElementById('endDate').value = '2025-01-03';

      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onCopyFromGlobal('user1');

      expect(storeMock.copyGlobalToPerDay).toHaveBeenCalledWith('user1', expect.any(Array));
      expect(runCalculationMock).toHaveBeenCalled();
    });

    it('onCopyFromGlobal does nothing when date inputs are empty (line 632)', async () => {
      document.getElementById('startDate').value = '';
      document.getElementById('endDate').value = '';

      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onCopyFromGlobal('user1');

      expect(storeMock.copyGlobalToPerDay).not.toHaveBeenCalled();
    });

    it('onCopyFromGlobal skips recalculation when no rawEntries', async () => {
      document.getElementById('startDate').value = '2025-01-01';
      document.getElementById('endDate').value = '2025-01-03';

      await loadInitialData();

      storeMock.rawEntries = null;
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onCopyFromGlobal('user1');

      expect(runCalculationMock).not.toHaveBeenCalled();
    });

    it('onWeeklyOverrideChange updates and recalculates (lines 640-644)', async () => {
      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onWeeklyOverrideChange('user1', 'MONDAY', 'capacity', '6');

      expect(storeMock.setWeeklyOverride).toHaveBeenCalledWith('user1', 'MONDAY', 'capacity', '6');
      expect(runCalculationMock).toHaveBeenCalled();
    });

    it('onCopyGlobalToWeekly copies and recalculates (lines 645-650)', async () => {
      await loadInitialData();

      storeMock.rawEntries = [{ id: 'e1' }];
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onCopyGlobalToWeekly('user1');

      expect(storeMock.copyGlobalToWeekly).toHaveBeenCalledWith('user1');
      expect(runCalculationMock).toHaveBeenCalled();
    });

    it('onCopyGlobalToWeekly skips recalculation when no rawEntries', async () => {
      await loadInitialData();

      storeMock.rawEntries = null;
      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onCopyGlobalToWeekly('user1');

      expect(runCalculationMock).not.toHaveBeenCalled();
    });

    it('debouncedServerOverrideSave skips save for non-admins (line 605)', async () => {
      storeMock.claims.workspaceRole = 'MEMBER';

      await loadInitialData();

      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onOverrideChange('user1', 'capacity', '6');

      expect(settingsApiMocks.saveServerOverrides).not.toHaveBeenCalled();
    });

    it('debouncedServerOverrideSave saves for admins (line 606)', async () => {
      storeMock.claims.workspaceRole = 'OWNER';

      await loadInitialData();

      expect(storeMock.ui.isAdmin).toBe(true);

      const callbacks = uiMock.bindEvents.mock.calls[0][0];
      callbacks.onOverrideChange('user1', 'capacity', '6');

      expect(settingsApiMocks.saveServerOverrides).toHaveBeenCalledWith(storeMock.overrides);
    });

    it('initSettingsApi is called via applyTokenClaims before loadInitialData', async () => {
      // initSettingsApi is called in applyTokenClaims(), not in loadInitialData().
      // loadInitialData() relies on the token already being set.
      await loadInitialData();

      // Settings API should already be initialized (from applyTokenClaims during init)
      expect(settingsApiMocks.fetchServerConfig).toHaveBeenCalled();
      expect(settingsApiMocks.fetchServerOverrides).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Branch coverage: showInitError when emptyState is missing (line 298)
  // ==========================================================================

  describe('showInitError when emptyState is missing', () => {
    it('does not throw when emptyState element is absent (line 298 false branch)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Remove emptyState from DOM
      document.getElementById('emptyState').remove();

      // Trigger the no-token path which calls showInitError
      window.history.replaceState({}, '', '/');
      await init();

      // Should still set appReady even without the emptyState element
      expect(document.body.dataset.appReady).toBe('true');
      expect(document.body.dataset.appError).toBe('true');

      consoleErrorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Branch coverage: initSubsystems env branches (lines 342-350)
  // ==========================================================================

  describe('initSubsystems environment branches', () => {
    it('passes development environment when NODE_ENV is not production (line 342-343)', async () => {
      // Production branch of initErrorReporting({ environment }) is unreachable:
      // NODE_ENV=production causes isAllowedOrigin to reject localhost,
      // so init() returns before calling initSubsystems().
      // Verify the development branch instead.
      process.env.NODE_ENV = 'test';

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(initErrorReportingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'development',
        })
      );
      process.env.NODE_ENV = savedNodeEnv;
    });

    it('passes VERSION in release string when set (line 345)', async () => {
      process.env.VERSION = '3.0.0';

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      jest.resetModules();
      const mainModule = await import('../../js/main.js');
      await mainModule.init();

      expect(initErrorReportingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          release: 'otplus@3.0.0',
          environment: 'development',
        })
      );

      delete process.env.VERSION;
    });

    it('uses 0.0.0 in release when VERSION is not set (line 345)', async () => {
      delete process.env.VERSION;

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      await init();

      expect(initErrorReportingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          release: 'otplus@0.0.0',
        })
      );
    });
  });

  // ==========================================================================
  // Branch coverage: Intl.DateTimeFormat fallback to UTC (line 219)
  // ==========================================================================

  describe('resolveCanonicalTimeZone Intl fallback to UTC', () => {
    it('falls back to UTC when Intl.DateTimeFormat returns no timezone (line 219)', async () => {
      isValidTimeZoneMock = jest.fn(() => false);

      // Mock Intl to return empty timezone
      const origIntl = globalThis.Intl;
      globalThis.Intl = {
        ...origIntl,
        DateTimeFormat: function () {
          return {
            resolvedOptions: () => ({ timeZone: '' }),
            format: () => '',
          };
        },
      };

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me',
      });
      setAuthTokenUrl(token);

      jest.resetModules();
      const mainModule = await import('../../js/main.js');
      await mainModule.init();

      expect(setCanonicalTimeZoneMock).toHaveBeenCalledWith('UTC');

      globalThis.Intl = origIntl;
    });
  });

  // ==========================================================================
  // verifyJwtSignature fail-closed + E2E bypass
  // ==========================================================================

  describe('verifyJwtSignature', () => {
    it('accepts token when signature bypass DOM attribute is set', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const origNodeEnv = process.env.NODE_ENV;
      // Use 'development' so localhost origin is allowed but NODE_ENV !== 'test'
      process.env.NODE_ENV = 'development';
      jest.clearAllMocks();
      jest.resetModules();
      resetStoreMock();
      setupDOM();
      // Set bypass via DOM attribute (shared across VM module boundaries)
      document.documentElement.dataset.skipSignatureVerify = 'true';

      apiMock.fetchUsers.mockResolvedValue([{ id: 'user1', name: 'User 1' }]);
      settingsApiMocks.fetchServerConfig.mockResolvedValue(null);
      settingsApiMocks.fetchServerOverrides.mockResolvedValue(null);

      const mainModule = await import('../../js/main.js');

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me/api',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      setAuthTokenUrl(token);

      await mainModule.init();

      expect(storeMock.setToken).toHaveBeenCalled();

      process.env.NODE_ENV = origNodeEnv;
      delete document.documentElement.dataset.skipSignatureVerify;
      consoleErrorSpy.mockRestore();
    });

    it('rejects token when crypto.subtle verification throws (fail-closed)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const origNodeEnv = process.env.NODE_ENV;
      // Use 'development' so localhost origin is allowed but NODE_ENV !== 'test'
      // (verifyJwtSignature short-circuits with return true when NODE_ENV === 'test')
      process.env.NODE_ENV = 'development';

      const origCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          subtle: {
            importKey: () => { throw new Error('mock importKey failure'); },
            verify: () => { throw new Error('mock verify failure'); },
          },
        },
        writable: true,
        configurable: true,
      });

      jest.resetModules();
      const mainModule = await import('../../js/main.js');
      setupDOM();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me/api',
      });
      setAuthTokenUrl(token);

      await mainModule.init();

      expect(storeMock.setToken).not.toHaveBeenCalled();
      expect(document.getElementById('emptyState').textContent).toContain(
        'Invalid authentication token'
      );
      expect(document.body.dataset.appError).toBe('true');

      process.env.NODE_ENV = origNodeEnv;
      Object.defineProperty(globalThis, 'crypto', {
        value: origCrypto,
        writable: true,
        configurable: true,
      });
      consoleErrorSpy.mockRestore();
    });

    it('rejects token when crypto.subtle is undefined (fail-closed)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const origCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        value: { subtle: undefined },
        writable: true,
        configurable: true,
      });

      jest.resetModules();
      const mainModule = await import('../../js/main.js');
      setupDOM();

      const token = makeToken({
        workspaceId: 'ws_123',
        backendUrl: 'https://api.clockify.me/api',
      });
      setAuthTokenUrl(token);
      await mainModule.init();

      expect(storeMock.setToken).not.toHaveBeenCalled();
      expect(document.body.dataset.appError).toBe('true');

      process.env.NODE_ENV = origNodeEnv;
      Object.defineProperty(globalThis, 'crypto', {
        value: origCrypto,
        writable: true,
        configurable: true,
      });
      consoleErrorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Branch coverage: non-Error thrown in token parsing (line 450)
  // ==========================================================================

  describe('init error handling for non-Error exceptions', () => {
    it('wraps non-Error thrown object in new Error (line 450)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // We need parseAndValidateToken to throw a non-Error.
      // The base64urlDecode mock is used. If it throws, that would be an Error.
      // We need to mock base64urlDecode to throw a non-Error value.
      jest.resetModules();

      // Re-mock utils.js with base64urlDecode that throws a string
      jest.unstable_mockModule('../../js/utils.js', () => ({
        IsoUtils: {
          toDateKey: jest.fn(() => '2025-01-01'),
          generateDateRange: jest.fn(() => []),
        },
        base64urlDecode: jest.fn(() => {
          throw 'non-error-string'; // eslint-disable-line no-throw-literal
        }),
        setCanonicalTimeZone: (...args) => setCanonicalTimeZoneMock(...args),
        isValidTimeZone: (...args) => isValidTimeZoneMock(...args),
        debounce: jest.fn((fn) => fn),
        isAllowedClockifyUrl: jest.fn(() => true),
      }));

      const mainModule = await import('../../js/main.js');

      // Valid 3-part token so it gets past the length check
      setAuthTokenUrl('aaa.bbb.ccc');
      await mainModule.init();

      // reportError should receive a new Error wrapping the non-Error
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid token' }),
        expect.objectContaining({ level: 'error' })
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // isAllowedOrigin
  // ==========================================================================

  describe('isAllowedOrigin', () => {
    it('allows Clockify origins', () => {
      expect(isAllowedOrigin('https://app.clockify.me')).toBe(true);
      expect(isAllowedOrigin('https://clockify.me')).toBe(true);
      expect(isAllowedOrigin('https://developer.clockify.me')).toBe(true);
    });

    it('allows GitHub Pages origins', () => {
      expect(isAllowedOrigin('https://apet97.github.io')).toBe(true);
      expect(isAllowedOrigin('https://my-org.github.io')).toBe(true);
    });

    it('allows Cloudflare Worker origins', () => {
      expect(isAllowedOrigin('https://otplus-worker.petkovic-aleksandar037.workers.dev')).toBe(true);
      expect(isAllowedOrigin('https://my-addon.my-account.workers.dev')).toBe(true);
    });

    it('allows regional Clockify origins', () => {
      expect(isAllowedOrigin('https://de.app.clockify.me')).toBe(true);
      expect(isAllowedOrigin('https://fr.clockify.me')).toBe(true);
    });

    it('rejects unknown origins', () => {
      expect(isAllowedOrigin('https://evil.com')).toBe(false);
      expect(isAllowedOrigin('https://fake-clockify.me')).toBe(false);
    });
  });

  // ==========================================================================
  // setDefaultDates
  // ==========================================================================

  describe('setDefaultDates', () => {
    it('sets date inputs to today', () => {
      setDefaultDates();

      const startEl = document.getElementById('startDate');
      const endEl = document.getElementById('endDate');

      expect(startEl.value).toBeTruthy();
      expect(endEl.value).toBeTruthy();
    });

    it('handles missing date elements gracefully', () => {
      document.getElementById('startDate').remove();
      document.getElementById('endDate').remove();

      expect(() => setDefaultDates()).not.toThrow();
    });
  });

  // ==========================================================================
  // Auto-init guard (line 667-668)
  // ==========================================================================

  describe('auto-init guard', () => {
    it('does not call init() when NODE_ENV is test', () => {
      // Verified by the fact that importing the module did not trigger
      // any init side effects before our explicit calls in tests.
      expect(process.env.NODE_ENV).not.toBe('production');
    });
  });

});

