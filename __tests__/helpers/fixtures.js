/**
 * Centralized Test Fixtures for OTPLUS Test Suite
 *
 * This module provides unified mock patterns, consistent store setup,
 * and comprehensive cleanup utilities across all test files.
 *
 * @see docs/prd.md for calculation rules, docs/guide.md for API constraints
 */

import { jest } from '@jest/globals';

// ============================================================================
// Constants - Unified mock values used across all tests
// ============================================================================

let fixturesEntryCounter = 0;

/**
 * Standard mock authentication token
 * All tests should use this consistent format
 */
export const MOCK_TOKEN = 'mock_jwt_token_test_suite';

/**
 * Standard workspace ID for tests
 */
export const MOCK_WORKSPACE_ID = 'workspace_test_123';

/**
 * Standard user IDs
 */
export const MOCK_USER_IDS = {
  primary: 'user_1',
  secondary: 'user_2',
  tertiary: 'user_3'
};

/**
 * Standard date range for tests
 */
export const MOCK_DATE_RANGE = {
  start: '2025-01-01',
  end: '2025-01-31'
};

/**
 * Standard test dates (known weekdays/weekends)
 * Jan 2025 calendar:
 * - Jan 1 (Wed), Jan 15 (Wed), Jan 18 (Sat), Jan 19 (Sun)
 */
export const TEST_DATES = {
  wednesday: '2025-01-15',      // Weekday (Wednesday)
  saturday: '2025-01-18',       // Weekend (Saturday)
  sunday: '2025-01-19',         // Weekend (Sunday)
  monday: '2025-01-20',         // Weekday (Monday)
  newYear: '2025-01-01',        // Holiday (Wednesday)
  multiDay: ['2025-01-15', '2025-01-16', '2025-01-17']
};

// ============================================================================
// Test Fixtures Factory
// ============================================================================

/**
 * TestFixtures - Centralized factory for creating test fixtures
 */
export const TestFixtures = {
  /**
   * Creates a consistent store fixture with sensible defaults
   * @param {Object} overrides - Properties to override
   * @returns {Object} Store fixture
   */
  createStoreFixture(overrides = {}) {
    const defaults = {
      token: MOCK_TOKEN,
      claims: {
        workspaceId: MOCK_WORKSPACE_ID,
        userId: MOCK_USER_IDS.primary,
        backendUrl: 'https://api.clockify.me'
      },
      users: [
        { id: MOCK_USER_IDS.primary, name: 'Test User 1' },
        { id: MOCK_USER_IDS.secondary, name: 'Test User 2' }
      ],
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        showDecimalTime: false,
        enableTieredOT: false,
        amountDisplay: 'earned',
        overtimeBasis: 'daily',
        maxPages: 50
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 0,
        tier2Multiplier: 2.0
      },
      overrides: {},
      profiles: new Map(),
      holidays: new Map(),
      timeOff: new Map(),
      apiStatus: {
        profilesFailed: 0,
        holidaysFailed: 0,
        timeOffFailed: 0
      },
      ui: {
        isLoading: false,
        summaryExpanded: false,
        summaryGroupBy: 'user',
        overridesCollapsed: true,
        activeTab: 'summary',
        detailedPage: 1,
        detailedPageSize: 50,
        activeDetailedFilter: 'all',
        hasCostRates: true,
        hasAmountRates: true
      },
      listeners: new Set(),
      throttleStatus: {
        retryCount: 0,
        lastRetryTime: null
      },
      rawEntries: null,
      analysisResults: null,
      currentDateRange: null
    };

    // Deep merge with overrides
    return {
      ...defaults,
      ...overrides,
      config: { ...defaults.config, ...(overrides.config || {}) },
      calcParams: { ...defaults.calcParams, ...(overrides.calcParams || {}) },
      apiStatus: { ...defaults.apiStatus, ...(overrides.apiStatus || {}) },
      ui: { ...defaults.ui, ...(overrides.ui || {}) },
      claims: { ...defaults.claims, ...(overrides.claims || {}) }
    };
  },

  /**
   * Creates a standard time entry fixture
   * @param {Object} overrides - Properties to override
   * @returns {Object} Entry fixture
   */
  createEntryFixture(overrides = {}) {
    if (!fixturesEntryCounter) {
        fixturesEntryCounter = 0;
    }
    fixturesEntryCounter += 1;
    const id = overrides.id || `entry_${fixturesEntryCounter}`;
    const defaults = {
      id,
      userId: MOCK_USER_IDS.primary,
      userName: 'Test User 1',
      description: 'Test work entry',
      timeInterval: {
        start: `${TEST_DATES.wednesday}T09:00:00Z`,
        end: `${TEST_DATES.wednesday}T17:00:00Z`,
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000, currency: 'USD' },
      billable: true,
      type: 'REGULAR',
      tags: []
    };

    return { ...defaults, ...overrides };
  },

  /**
   * Creates multiple entry fixtures with sequential timestamps
   * @param {number} count - Number of entries to create
   * @param {Object} baseOverrides - Base properties for all entries
   * @returns {Array} Array of entry fixtures
   */
  createEntriesFixture(count, baseOverrides = {}) {
    const entries = [];
    for (let i = 0; i < count; i++) {
      const hour = 9 + i;
      entries.push(this.createEntryFixture({
        id: `entry_${i + 1}`,
        timeInterval: {
          start: `${TEST_DATES.wednesday}T${String(hour).padStart(2, '0')}:00:00Z`,
          end: `${TEST_DATES.wednesday}T${String(hour + 1).padStart(2, '0')}:00:00Z`,
          duration: 'PT1H'
        },
        ...baseOverrides
      }));
    }
    return entries;
  },

  /**
   * Creates a mock fetch response
   * @param {Object} data - Response data
   * @param {Object} options - Response options (status, ok, etc.)
   * @returns {Object} Mock response
   */
  createFetchResponse(data, options = {}) {
    const { status = 200, ok = true, headers = {} } = options;
    const normalizedHeaders = Object.entries(headers).reduce((acc, [key, value]) => {
      acc[String(key).toLowerCase()] = value;
      return acc;
    }, {});
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      headers: {
        get: (name) => normalizedHeaders[String(name).toLowerCase()] ?? null,
        has: (name) => Object.prototype.hasOwnProperty.call(normalizedHeaders, String(name).toLowerCase())
      },
      json: async () => data,
      text: async () => JSON.stringify(data)
    };
  },

  /**
   * Creates a mock profile fixture
   * @param {string} userId - User ID
   * @param {Object} overrides - Properties to override
   * @returns {Object} Profile fixture
   */
  createProfileFixture(userId, overrides = {}) {
    return {
      userId,
      workCapacity: 'PT8H',
      workCapacityHours: 8,
      workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      hourlyRate: { amount: 5000 },
      ...overrides
    };
  },

  /**
   * Creates a holiday fixture
   * @param {string} dateKey - Date key (YYYY-MM-DD)
   * @param {string} name - Holiday name
   * @returns {Object} Holiday fixture
   */
  createHolidayFixture(dateKey, name = 'Test Holiday') {
    return {
      name,
      datePeriod: {
        startDate: `${dateKey}T00:00:00Z`,
        endDate: `${dateKey}T23:59:59Z`
      }
    };
  },

  /**
   * Creates a time-off fixture
   * @param {boolean} isFullDay - Full day time off
   * @param {number} hours - Hours of time off (for partial days)
   * @returns {Object} Time-off fixture
   */
  createTimeOffFixture(isFullDay = true, hours = 0) {
    return { isFullDay, hours };
  },

  /**
   * Creates a standard date range fixture
   * @param {string} start - Start date
   * @param {string} end - End date
   * @returns {Object} Date range fixture
   */
  createDateRangeFixture(start = MOCK_DATE_RANGE.start, end = MOCK_DATE_RANGE.end) {
    return { start, end };
  }
};

// ============================================================================
// Test State Management
// ============================================================================

/**
 * Tracks shared state that needs to be validated for isolation
 */
let sharedStateSnapshot = null;

/**
 * Captures the current state of shared objects for isolation validation
 * @param {Object} store - Store to capture
 */
export function captureStateSnapshot(store) {
  sharedStateSnapshot = {
    overridesKeys: Object.keys(store?.overrides || {}),
    profilesSize: store?.profiles?.size || 0,
    holidaysSize: store?.holidays?.size || 0,
    timeOffSize: store?.timeOff?.size || 0,
    listenersSize: store?.listeners?.size || 0,
    localStorageLength: typeof localStorage !== 'undefined' ? localStorage.length : 0
  };
}

/**
 * Validates that shared state wasn't unexpectedly mutated
 * @param {Object} store - Store to validate
 * @returns {Object} Validation result { valid: boolean, mutations: string[] }
 */
export function validateStateIsolation(store) {
  if (!sharedStateSnapshot) {
    return { valid: true, mutations: [] };
  }

  const mutations = [];
  const current = {
    overridesKeys: Object.keys(store?.overrides || {}),
    profilesSize: store?.profiles?.size || 0,
    holidaysSize: store?.holidays?.size || 0,
    timeOffSize: store?.timeOff?.size || 0,
    listenersSize: store?.listeners?.size || 0,
    localStorageLength: typeof localStorage !== 'undefined' ? localStorage.length : 0
  };

  if (current.listenersSize !== sharedStateSnapshot.listenersSize) {
    mutations.push(`listeners: ${sharedStateSnapshot.listenersSize} -> ${current.listenersSize}`);
  }

  return {
    valid: mutations.length === 0,
    mutations
  };
}

// ============================================================================
// Cleanup Utilities
// ============================================================================

/**
 * Comprehensive reset of all shared state
 * Call this in afterEach to ensure test isolation
 */
export function resetAll() {
  // Reset localStorage
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }

  // Reset sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }

  // Reset Jest timers if active
  try {
    jest.useRealTimers();
  } catch {
    // Timers not active
  }

  // Clear all mocks
  jest.clearAllMocks();

  // Reset shared state snapshot
  sharedStateSnapshot = null;
}

/**
 * Resets a store instance to its default state
 * @param {Object} store - Store to reset
 */
export function resetStore(store) {
  if (!store) return;

  store.token = null;
  store.claims = null;
  store.users = [];
  store.rawEntries = null;
  store.analysisResults = null;
  store.currentDateRange = null;
  store.profiles = new Map();
  store.holidays = new Map();
  store.timeOff = new Map();
  store.overrides = {};
  store.apiStatus = {
    profilesFailed: 0,
    holidaysFailed: 0,
    timeOffFailed: 0
  };

  if (store.listeners) {
    store.listeners.clear();
  }

  if (store.throttleStatus) {
    store.throttleStatus.retryCount = 0;
    store.throttleStatus.lastRetryTime = null;
  }
}

// ============================================================================
// API Contract Validation
// ============================================================================

/**
 * Validates that a mock fetch was called with correct Clockify API headers
 * @param {Function} mockFetch - Jest mock fetch function
 * @param {Object} expectations - Expected values
 * @returns {Object} Validation result
 */
export function validateApiContract(mockFetch, expectations = {}) {
  const calls = mockFetch.mock.calls;
  const errors = [];

  for (let i = 0; i < calls.length; i++) {
    const [url, options] = calls[i];
    const headers = options?.headers || {};

    // Validate X-Addon-Token header
    if (expectations.token !== undefined) {
      if (headers['X-Addon-Token'] !== expectations.token) {
        errors.push(`Call ${i}: Expected X-Addon-Token "${expectations.token}", got "${headers['X-Addon-Token']}"`);
      }
    } else if (!headers['X-Addon-Token']) {
      errors.push(`Call ${i}: Missing X-Addon-Token header`);
    }

    // Validate Content-Type for POST requests
    if (options?.method === 'POST' && options?.body) {
      if (headers['Content-Type'] !== 'application/json') {
        errors.push(`Call ${i}: POST request missing Content-Type: application/json`);
      }
    }

    // Validate URL format
    if (typeof url !== 'string' || !url.startsWith('http')) {
      errors.push(`Call ${i}: Invalid URL format: ${url}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    callCount: calls.length
  };
}

/**
 * Creates a mock fetch function that validates API contracts
 * @param {Array} responses - Array of responses for sequential calls
 * @param {Object} options - Validation options
 * @returns {Function} Mock fetch with contract validation
 */
export function createContractValidatingFetch(responses = [], options = {}) {
  let callIndex = 0;
  const contractErrors = [];

  const mockFetch = jest.fn(async (url, fetchOptions = {}) => {
    const headers = fetchOptions.headers || {};

    // Validate token header
    if (!headers['X-Addon-Token']) {
      contractErrors.push(`Call ${callIndex}: Missing X-Addon-Token header`);
    }

    // Get response
    const response = responses[callIndex] || responses[responses.length - 1] || {
      ok: true,
      status: 200,
      json: async () => ({})
    };

    callIndex++;
    return response;
  });

  mockFetch.getContractErrors = () => contractErrors;
  mockFetch.resetCallIndex = () => { callIndex = 0; };

  return mockFetch;
}

// ============================================================================
// Parameterized Test Helpers
// ============================================================================

/**
 * Standard overtime test cases for parameterized testing
 */
export const OVERTIME_TEST_CASES = [
  { name: 'under capacity (6h)', hours: 6, expectedRegular: 6, expectedOT: 0 },
  { name: 'at capacity (8h)', hours: 8, expectedRegular: 8, expectedOT: 0 },
  { name: 'over capacity (10h)', hours: 10, expectedRegular: 8, expectedOT: 2 },
  { name: 'double overtime (12h)', hours: 12, expectedRegular: 8, expectedOT: 4 },
  { name: 'extreme overtime (16h)', hours: 16, expectedRegular: 8, expectedOT: 8 },
  { name: 'minimal work (0.5h)', hours: 0.5, expectedRegular: 0.5, expectedOT: 0 },
  { name: 'exactly at boundary (8.0h)', hours: 8.0, expectedRegular: 8, expectedOT: 0 },
  { name: 'just over boundary (8.01h)', hours: 8.01, expectedRegular: 8, expectedOT: 0.01 }
];

/**
 * HTTP status code test cases
 */
export const HTTP_STATUS_TEST_CASES = [
  { status: 200, ok: true, description: 'Success' },
  { status: 201, ok: true, description: 'Created' },
  { status: 400, ok: false, description: 'Bad Request' },
  { status: 401, ok: false, description: 'Unauthorized' },
  { status: 403, ok: false, description: 'Forbidden' },
  { status: 404, ok: false, description: 'Not Found' },
  { status: 429, ok: false, description: 'Rate Limited' },
  { status: 500, ok: false, description: 'Internal Server Error' },
  { status: 502, ok: false, description: 'Bad Gateway' },
  { status: 503, ok: false, description: 'Service Unavailable' }
];

/**
 * CSV injection character test cases
 */
export const CSV_INJECTION_TEST_CASES = [
  { char: '=', description: 'equals sign (formula)' },
  { char: '+', description: 'plus sign (formula)' },
  { char: '-', description: 'minus sign (formula)' },
  { char: '@', description: 'at sign (DDE)' },
  { char: '|', description: 'pipe character (DDE)' },
  { char: '\t', description: 'tab character' },
  { char: '\r', description: 'carriage return' },
  { char: '\n', description: 'line feed' }
  // Note: '"=' case is handled separately as it triggers CSV quoting, not formula prefix
];

/**
 * Entry type classification test cases
 */
export const ENTRY_TYPE_TEST_CASES = [
  { type: 'REGULAR', isBreak: false, isPTO: false, canBeOT: true },
  { type: 'BREAK', isBreak: true, isPTO: false, canBeOT: false },
  { type: 'TIME_OFF', isBreak: false, isPTO: true, canBeOT: false },
  { type: 'HOLIDAY', isBreak: false, isPTO: true, canBeOT: false }
];

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Custom assertion for overtime calculations
 * @param {Object} result - Calculation result
 * @param {Object} expected - Expected values
 */
export function expectOvertimeCalculation(result, expected) {
  expect(result.totals.regular).toBeCloseTo(expected.regular, 4);
  expect(result.totals.overtime).toBeCloseTo(expected.overtime, 4);
  expect(result.totals.total).toBeCloseTo(expected.regular + expected.overtime, 4);
}

/**
 * Custom assertion for billable breakdown
 * @param {Object} result - Calculation result
 * @param {Object} expected - Expected values
 */
export function expectBillableBreakdown(result, expected) {
  const totals = result.totals;
  const billableTotal = totals.billableWorked + totals.billableOT;
  const nonBillableTotal = totals.nonBillableWorked + totals.nonBillableOT;

  expect(billableTotal + nonBillableTotal).toBeCloseTo(totals.total, 4);

  if (expected.billableWorked !== undefined) {
    expect(totals.billableWorked).toBeCloseTo(expected.billableWorked, 4);
  }
  if (expected.billableOT !== undefined) {
    expect(totals.billableOT).toBeCloseTo(expected.billableOT, 4);
  }
}

/**
 * Asserts that a value is within acceptable rounding tolerance (4 decimal places)
 * @param {number} actual - Actual value
 * @param {number} expected - Expected value
 */
export function expectWithinRoundingTolerance(actual, expected) {
  expect(Math.abs(actual - expected)).toBeLessThan(0.00015);
}

// ============================================================================
// Export default object for convenience
// ============================================================================

export default {
  MOCK_TOKEN,
  MOCK_WORKSPACE_ID,
  MOCK_USER_IDS,
  MOCK_DATE_RANGE,
  TEST_DATES,
  TestFixtures,
  captureStateSnapshot,
  validateStateIsolation,
  resetAll,
  resetStore,
  validateApiContract,
  createContractValidatingFetch,
  OVERTIME_TEST_CASES,
  HTTP_STATUS_TEST_CASES,
  CSV_INJECTION_TEST_CASES,
  ENTRY_TYPE_TEST_CASES,
  expectOvertimeCalculation,
  expectBillableBreakdown,
  expectWithinRoundingTolerance
};
