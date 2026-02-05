/**
 * Mock Data Generator Suite for OTPLUS v2.0 Testing
 * Provides comprehensive, reusable mock data for all test scenarios
 */

let mockIdCounter = 0;
const nextMockId = () => {
  mockIdCounter += 1;
  return mockIdCounter;
};

// ============================================================================
// Core Mock Data Generators
// ============================================================================

/**
 * Generates mock time entries with realistic work patterns
 * @param {number} count - Number of entries to generate
 * @param {number} userCount - Number of unique users
 * @returns {Array<Object>} Array of mock time entries with analysis metadata
 */
export function generateMockEntries(count, userCount = 5) {
  const entries = [];
  const baseDate = new Date('2025-01-01T09:00:00Z');
  const names = ['Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Eve Anderson'];

  for (let i = 0; i < count; i++) {
    const userId = `user${i % userCount}`;
    const userName = names[i % userCount];
    const dayOffset = Math.floor(i / userCount);
    const hours = 6 + (i % 4); // 6-9 hours per entry, deterministic for testing
    const startTime = new Date(baseDate);
    startTime.setDate(startTime.getDate() + dayOffset);

    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + hours);

    const regular = Math.min(hours, 8);
    const overtime = Math.max(0, hours - 8);

    entries.push({
      id: `entry${i}`,
      userId,
      userName,
      userEmail: `${userId}@example.com`,
      description: `Project work - Task ${i}`,
      timeInterval: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        duration: `PT${hours}H`
      },
      hourlyRate: { amount: 5000 + ((i % 3) * 1000) }, // $50-$70/hour
      billable: i % 2 === 0, // Alternate billable/non-billable
      project: {
        id: `project${i % 3}`,
        name: `Project ${i % 3}`,
        color: ['#FF6B6B', '#4ECDC4', '#45B7D1'][i % 3]
      },
      analysis: {
        regular,
        overtime,
        isBillable: i % 2 === 0,
        isBreak: false,
        totalCost: hours * 50 + (overtime * 50 * 0.5),
        tags: []
      }
    });
  }
  return entries;
}

/**
 * Generates mock users with realistic names and roles
 * @param {number} count - Number of users to generate
 * @returns {Array<Object>} Array of mock user objects
 */
export function generateMockUsers(count = 5) {
  const names = ['Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Eve Anderson'];
  const roles = ['Engineer', 'Designer', 'Product Manager', 'QA Analyst', 'DevOps'];

  return Array.from({ length: count }, (_, i) => ({
    id: `user${i}`,
    name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''),
    email: `${names[i % names.length].toLowerCase().replace(' ', '.')}${i >= names.length ? i : ''}@example.com`,
    role: roles[i % roles.length],
    status: 'ACTIVE',
    hourlyRate: { amount: 5000 + (i * 500) }
  }));
}

/**
 * Generates complete mock analysis results for UI testing
 * Includes day-level data with capacity, holidays, and time-off
 * @param {number} userCount - Number of users to generate
 * @returns {Array<Object>} Array of user analysis objects
 */
export function generateMockAnalysisData(userCount = 5) {
  const users = [];
  const names = ['Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Eve Anderson'];

  for (let i = 0; i < userCount; i++) {
    const regularHours = 40 + (i % 11); // 40-50 hours (deterministic)
    const overtimeHours = Math.max(0, regularHours - 40); // OT if over 40
    const billableHours = regularHours * 0.8; // 80% billable
    const totalCost = (regularHours * 50) + (overtimeHours * 50 * 0.5); // $50/hr base, 1.5x OT
    const expectedCapacity = 40;

    const userDays = new Map();
    for (let day = 1; day <= 7; day++) {
      const dateKey = `2025-01-${String(day).padStart(2, '0')}`;
      const isWorkingDay = day <= 5; // Mon-Fri
      const dayHours = isWorkingDay ? (8 + (i % 2)) : 0; // 8-9 hours on work days

      userDays.set(dateKey, {
        entries: isWorkingDay ? [{
          id: `entry${i}_${day}`,
          timeInterval: {
            start: `${dateKey}T09:00:00Z`,
            end: `${dateKey}T${9 + dayHours}:00:00Z`
          },
          description: `Work on day ${day}`,
          hourlyRate: { amount: 5000 },
          billable: true,
          analysis: {
            regular: Math.min(dayHours, 8),
            overtime: Math.max(0, dayHours - 8),
            isBillable: true,
            totalCost: dayHours * 50
          }
        }] : [],
        meta: {
          capacity: isWorkingDay ? 8 : 0,
          isNonWorking: !isWorkingDay,
          isHoliday: false,
          isTimeOff: false,
          holidayName: null
        }
      });
    }

    users.push({
      userId: `user${i}`,
      userName: names[i % names.length],
      days: userDays,
      totals: {
        regular: regularHours,
        overtime: overtimeHours,
        total: regularHours,
        billableWorked: billableHours,
        nonBillableWorked: regularHours - billableHours,
        billableOT: overtimeHours * 0.8,
        nonBillableOT: overtimeHours * 0.2,
        amount: totalCost,
        otPremium: overtimeHours * 50 * 0.5,
        expectedCapacity: expectedCapacity,
        holidayCount: 0,
        timeOffCount: 0,
        breaks: 0
      }
    });
  }

  return users;
}

// ============================================================================
// Mock Store and Configuration
// ============================================================================

/**
 * Creates a fully configured mock store for testing
 * @param {Object} options - Configuration options
 * @returns {Object} Complete mock store object
 */
export function createMockStore(options = {}) {
  const userCount = options.userCount || 5;
  const users = options.users || generateMockUsers(userCount);
  const mockId = nextMockId();

  const defaults = {
    token: `mock-jwt-token-${mockId}`,
    claims: {
      workspaceId: `ws_test_${mockId}`,
      userId: 'user_test',
      backendUrl: 'https://api.clockify.me'
    },
    users: users,
    rawEntries: null,
    analysisResults: generateMockAnalysisData(users.length),
    config: {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      showDecimalTime: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily'
    },
    calcParams: {
      dailyThreshold: 8,
      weeklyThreshold: 40,
      overtimeMultiplier: 1.5,
      tier2ThresholdHours: 9999,  // High threshold to not trigger in legacy tests
      tier2Multiplier: 2.0
    },
    profiles: new Map(
      users.map((u, i) => [
        u.id,
        {
          userId: u.id,
          workCapacity: 'PT8H',
          workCapacityHours: 8,
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          hourlyRate: { amount: 5000 }
        }
      ])
    ),
    holidays: new Map(),
    timeOff: new Map(),
    overrides: {},
    apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 },
    ui: {
      isLoading: false,
      summaryExpanded: false,
      summaryGroupBy: 'user',
      overridesCollapsed: true,
      activeTab: 'summary',
      hasCostRates: true,
      hasAmountRates: true
    }
  };

  // Deep merge: merge config and calcParams separately to preserve defaults
  return {
    ...defaults,
    ...options,
    config: { ...defaults.config, ...(options.config || {}) },
    calcParams: { ...defaults.calcParams, ...(options.calcParams || {}) },
    overrides: options.overrides || defaults.overrides
  };
}

/**
 * Generates a mock token payload for testing
 * @returns {Object} Mock token payload
 */
export function createMockTokenPayload() {
  const mockId = nextMockId();
  return {
    workspaceId: `ws_test_${mockId}`,
    userId: 'user_test',
    backendUrl: 'https://api.clockify.me'
  };
}

/**
 * Generates a mock JWT for tests that require a valid JWT format.
 * @param {Object} claims - Optional JWT claims to merge.
 * @returns {string} Mock JWT token.
 */
export function createMockJwtToken(claims = {}) {
  const base64UrlEncode = (value) =>
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
    ...claims
  }));
  const signature = base64UrlEncode('mock-signature');
  return `${header}.${payload}.${signature}`;
}

/**
 * Generates mock CSV export string
 * @param {Array<Object>} users - User analysis data
 * @returns {string} CSV formatted string
 */
export function generateMockCsv(users) {
  const headers = [
    'User',
    'Capacity',
    'Regular Hours',
    'Overtime Hours',
    'Total Hours',
    'Utilization',
    'Amount',
    'Billable Worked',
    'Billable OT',
    'Non-Billable OT'
  ];

  const rows = users.map(user => [
    user.userName,
    `${user.totals.expectedCapacity}h`,
    `${user.totals.regular}h`,
    `${user.totals.overtime}h`,
    `${user.totals.total}h`,
    `${Math.round((user.totals.total / user.totals.expectedCapacity) * 100)}%`,
    `$${user.totals.amount.toFixed(2)}`,
    `${user.totals.billableWorked}h`,
    `${user.totals.billableOT}h`,
    `${user.totals.nonBillableOT}h`
  ]);

  return [headers, ...rows]
    .map(row => row.join(','))
    .join('\n');
}

/**
 * Generates mock holiday data
 * @returns {Object} Mock holiday object
 */
export function generateMockHoliday() {
  return {
    id: 'holiday_1',
    name: 'New Year\'s Day',
    datePeriod: {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T23:59:59Z'
    }
  };
}

/**
 * Generates mock user profile for testing
 * @param {string} userId - User ID
 * @param {number} capacityHours - Work capacity in hours
 * @returns {Object} Mock profile object
 */
export function generateMockProfile(userId, capacityHours = 8) {
  return {
    userId,
    workCapacity: `PT${capacityHours}H`,
    workCapacityHours: capacityHours,
    workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    hourlyRate: { amount: 5000 }
  };
}

// ============================================================================
// Mock API Responses
// ============================================================================

/**
 * Standardized mock API responses for testing API module
 */
export const MockApiResponses = {
  users: {
    success: {
      status: 200,
      data: generateMockUsers(5),
      ok: true
    },
    error: {
      status: 403,
      data: null,
      ok: false,
      error: 'Access denied'
    },
    empty: {
      status: 200,
      data: [],
      ok: true
    }
  },

  entries: {
    success: {
      status: 200,
      data: generateMockEntries(100, 5),
      ok: true
    },
    paginated: {
      status: 200,
      data: generateMockEntries(50, 5),
      headers: { 'x-page': '1', 'x-total-pages': '2' },
      ok: true
    }
  },

  profiles: {
    success: {
      status: 200,
      data: new Map([
        ['user0', { workCapacity: 'PT8H', workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }],
        ['user1', { workCapacity: 'PT7H', workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'] }]
      ]),
      ok: true
    }
  }
};

// ============================================================================
// Mock DOM Elements (for UI testing without real DOM)
// ============================================================================

/**
 * Creates a mock DOM element with all standard methods
 * @param {Object} overrides - Custom properties to merge
 * @returns {Object} Mock DOM element
 */
export function createMockElement(overrides = {}) {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      contains: jest.fn(() => false),
      toggle: jest.fn(),
      toString: jest.fn(() => '')
    },
    style: {},
    dataset: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(() => true),
    appendChild: jest.fn(function() { return this; }),
    removeChild: jest.fn(),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
    getAttribute: jest.fn(),
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
    hasAttribute: jest.fn(() => false),
    focus: jest.fn(),
    blur: jest.fn(),
    click: jest.fn(),
    ...overrides
  };
}

/**
 * Creates a complete mock DOM environment
 * Sets up document methods to return mock elements
 * @returns {Object} Object containing all mock elements by ID
 */
export function setupMockDOM() {
  const mockElements = {
    resultsContainer: createMockElement(),
    summaryStrip: createMockElement(),
    summaryTableBody: createMockElement(),
    loadingState: createMockElement(),
    emptyState: createMockElement(),
    apiStatusBanner: createMockElement(),
    tabNavCard: createMockElement({ style: { display: 'none' } }),
    startDate: createMockElement({ value: '2025-01-01' }),
    endDate: createMockElement({ value: '2025-01-31' }),
    generateBtn: createMockElement({ disabled: false }),
    exportBtn: createMockElement({ disabled: false }),
    summaryCard: createMockElement(),
    detailedCard: createMockElement(),
    detailedFilters: createMockElement(),
    detailedTableContainer: createMockElement(),
    configDaily: createMockElement({ value: '8' }),
    configMultiplier: createMockElement({ value: '1.5' }),
    useProfileCapacity: createMockElement({ checked: true }),
    useProfileWorkingDays: createMockElement({ checked: true }),
    applyHolidays: createMockElement({ checked: true }),
    applyTimeOff: createMockElement({ checked: true }),
    showBillableBreakdown: createMockElement({ checked: true }),
    // Overrides page elements
    mainView: createMockElement(),
    overridesPage: createMockElement(),
    openOverridesBtn: createMockElement(),
    closeOverridesBtn: createMockElement(),
    overridesUserList: createMockElement()
  };

  // Mock document methods
  document.getElementById = jest.fn((id) => {
    return mockElements[id] || createMockElement();
  });

  document.querySelector = jest.fn(() => createMockElement());
  document.querySelectorAll = jest.fn(() => []);
  document.createElement = jest.fn(() => createMockElement());
  document.body = createMockElement();

  return mockElements;
}

// ============================================================================
// Performance Testing Data
// ============================================================================

/**
 * Generates a massive dataset for performance and stress testing
 * @param {number} userCount - Number of users (default: 50)
 * @param {number} entriesPerUser - Entries per user (default: 100)
 * @returns {Object} Large dataset with users and entries
 */
export function generateLargeDataset(userCount = 50, entriesPerUser = 100) {
  const users = generateMockUsers(userCount);
  const entries = [];

  users.forEach((user, userIndex) => {
    const userEntries = generateMockEntries(entriesPerUser, userCount);
    // Ensure entries are assigned to the correct user
    userEntries.forEach((entry, idx) => {
      entry.userId = user.id;
      entry.userName = user.name;
      entry.userEmail = user.email;
      entry.id = `entry_${user.id}_${idx}`;
    });
    entries.push(...userEntries);
  });

  return { users, entries };
}

/**
 * Creates a stress test configuration
 * @returns {Object} Stress test parameters
 */
export function getStressTestConfig() {
  return {
    small: { users: 10, entries: 100, description: 'Small (10 users, 100 entries)' },
    medium: { users: 20, entries: 500, description: 'Medium (20 users, 500 entries)' },
    large: { users: 50, entries: 1000, description: 'Large (50 users, 1000 entries)' },
    xl: { users: 100, entries: 5000, description: 'XL (100 users, 5000 entries)' }
  };
}

// ============================================================================
// Export all generators
// ============================================================================

export default {
  generateMockEntries,
  generateMockUsers,
  generateMockAnalysisData,
  createMockStore,
  generateMockCsv,
  MockApiResponses,
  createMockElement,
  setupMockDOM,
  generateLargeDataset,
  getStressTestConfig
};
