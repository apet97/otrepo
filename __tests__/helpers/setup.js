/**
 * Centralized Test Cleanup Utilities for OTPLUS Test Suite
 *
 * This module provides standardized afterEach cleanup and beforeEach setup
 * patterns to ensure test isolation across all test files.
 *
 * @see CONTRIBUTING.md for testing guidelines
 */

import { jest } from '@jest/globals';

/**
 * Standard afterEach cleanup function.
 * Clears all mocks, restores mocked functions, and clears storage.
 *
 * Usage in test files:
 * ```javascript
 * import { standardAfterEach } from '../helpers/setup.js';
 * afterEach(standardAfterEach);
 * ```
 */
export function standardAfterEach() {
  // Clear all mock function calls and instances
  jest.clearAllMocks();

  // Restore all mocked functions to their original implementations
  jest.restoreAllMocks();

  // Clear localStorage if available
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.clear();
    } catch {
      // Ignore errors in environments where localStorage is restricted
    }
  }

  // Clear sessionStorage if available
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.clear();
    } catch {
      // Ignore errors in environments where sessionStorage is restricted
    }
  }

  // Reset fake timers if any are active
  try {
    if (jest.isMockFunction(setTimeout)) {
      jest.useRealTimers();
    }
  } catch {
    // Ignore if timers weren't mocked
  }
}

/**
 * Standard beforeEach setup for tests that need mock reset.
 * Lighter weight than standardAfterEach - just clears mocks.
 *
 * Usage in test files:
 * ```javascript
 * import { standardBeforeEach } from '../helpers/setup.js';
 * beforeEach(standardBeforeEach);
 * ```
 */
export function standardBeforeEach() {
  jest.clearAllMocks();
}

/**
 * Creates a comprehensive cleanup function for DOM-based tests.
 * Use this for tests that modify document.body.
 *
 * @param {Object} options - Cleanup options
 * @param {boolean} options.clearBody - Whether to clear document.body.innerHTML
 * @returns {Function} Cleanup function for afterEach
 */
export function createDOMCleanup(options = {}) {
  const { clearBody = true } = options;

  return function domCleanup() {
    standardAfterEach();

    if (clearBody && typeof document !== 'undefined' && document.body) {
      document.body.innerHTML = '';
    }
  };
}

/**
 * Standard store reset function for state.test.js and related tests.
 * Resets all store properties to their default values.
 *
 * @param {Object} store - The store instance to reset
 */
export function resetStore(store) {
  if (!store) return;

  // Reset authentication
  store.token = null;
  store.claims = null;

  // Reset data
  store.users = [];
  store.rawEntries = null;
  store.analysisResults = null;
  store.currentDateRange = null;

  // Reset Maps
  if (store.profiles) store.profiles = new Map();
  if (store.holidays) store.holidays = new Map();
  if (store.timeOff) store.timeOff = new Map();

  // Reset overrides
  store.overrides = {};

  // Reset API status
  if (store.apiStatus) {
    store.apiStatus = {
      profilesFailed: 0,
      holidaysFailed: 0,
      timeOffFailed: 0
    };
  }

  // Reset throttle status
  if (store.throttleStatus) {
    store.throttleStatus = {
      retryCount: 0,
      lastRetryTime: null
    };
  }

  // Clear listeners
  if (store.listeners) {
    store.listeners.clear();
  }
}

/**
 * Creates a fetch mock with standard response handling.
 *
 * @param {Object|Array} responseData - Data to return from fetch
 * @param {Object} options - Mock options
 * @param {number} options.status - HTTP status code (default 200)
 * @param {boolean} options.ok - Whether response is ok (default true)
 * @param {Object} options.headers - Response headers
 * @returns {Function} Mock fetch function
 */
function createHeadersMock(headers = {}) {
  const normalized = Object.entries(headers).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = value;
    return acc;
  }, {});

  return {
    get: (name) => normalized[String(name).toLowerCase()] ?? null,
    has: (name) => Object.prototype.hasOwnProperty.call(normalized, String(name).toLowerCase())
  };
}

export function createMockFetch(responseData, options = {}) {
  const { status = 200, ok = true, headers = {} } = options;

  return jest.fn().mockResolvedValue({
    ok,
    status,
    headers: createHeadersMock(headers),
    json: async () => responseData,
    text: async () => JSON.stringify(responseData)
  });
}

/**
 * Assertion helper: Validates that an object matches expected shape.
 * More specific than toBeDefined() - validates actual structure.
 *
 * @param {Object} actual - The actual object
 * @param {Object} expected - Expected shape with types
 */
export function expectUserAnalysis(actual) {
  expect(actual).toMatchObject({
    userId: expect.any(String),
    userName: expect.any(String),
    totals: expect.objectContaining({
      total: expect.any(Number),
      regular: expect.any(Number),
      overtime: expect.any(Number)
    })
  });
}

/**
 * Assertion helper: Validates entry analysis structure.
 *
 * @param {Object} entry - The entry to validate
 */
export function expectEntryAnalysis(entry) {
  expect(entry).toMatchObject({
    analysis: expect.objectContaining({
      regular: expect.any(Number),
      overtime: expect.any(Number)
    })
  });
}

/**
 * Security assertion helper: Validates no token leakage.
 *
 * @param {Object} store - Store instance to check
 * @param {string} token - Token that should not be persisted
 */
export function expectNoTokenLeakage(store, token) {
  // Token should not be in localStorage
  const storedData = localStorage.getItem('otplus_config');
  if (storedData) {
    expect(storedData).not.toContain(token);
  }

  // Check all localStorage keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    expect(value).not.toContain(token);
  }
}

/**
 * Security assertion helper: Validates XSS is escaped in HTML.
 *
 * @param {string} html - HTML string to check
 * @param {string} maliciousInput - The original malicious input
 */
export function expectXSSEscaped(html, maliciousInput) {
  // Should not contain raw script tags
  expect(html).not.toContain('<script');
  expect(html).not.toContain('</script>');

  // Should not contain raw event handlers
  expect(html).not.toContain('onerror=');
  expect(html).not.toContain('onclick=');
  expect(html).not.toContain('onload=');

  // Should contain escaped version if it was a script tag
  if (maliciousInput.includes('<script>')) {
    expect(html).toContain('&lt;script&gt;');
  }
}

export default {
  standardAfterEach,
  standardBeforeEach,
  createDOMCleanup,
  resetStore,
  createMockFetch,
  expectUserAnalysis,
  expectEntryAnalysis,
  expectNoTokenLeakage,
  expectXSSEscaped
};
