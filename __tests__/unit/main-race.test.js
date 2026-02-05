/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

const uiMock = {
  renderLoading: jest.fn(),
  showError: jest.fn(),
  showLargeDateRangeWarning: jest.fn(),
  showCachePrompt: jest.fn(),
  updateLoadingProgress: jest.fn(),
  clearLoadingProgress: jest.fn(),
  renderApiStatus: jest.fn(),
  renderThrottleStatus: jest.fn(),
  renderSummaryStrip: jest.fn(),
  renderSummaryTable: jest.fn(),
  renderDetailedTable: jest.fn()
};

const apiMock = {
  fetchDetailedReport: jest.fn(),
  fetchAllProfiles: jest.fn().mockResolvedValue(new Map()),
  fetchAllHolidays: jest.fn().mockResolvedValue(new Map()),
  fetchAllTimeOff: jest.fn().mockResolvedValue(new Map())
};

jest.unstable_mockModule('../../js/ui/index.js', () => uiMock);
jest.unstable_mockModule('../../js/api.js', () => ({
  Api: apiMock,
  resetRateLimiter: jest.fn(),
  resetCircuitBreaker: jest.fn(),
  getCircuitBreakerState: jest.fn(() => ({ isOpen: false, failures: 0 }))
}));
jest.unstable_mockModule('../../js/calc.js', () => ({
  calculateAnalysis: jest.fn(() => [])
}));

describe('Main handleGenerateReport concurrency', () => {
  let handleGenerateReport;
  let store;
  let originalClaims;
  let originalConfig;
  let originalUsers;
  let originalProfiles;
  let originalHolidays;
  let originalTimeOff;
  let originalOverrides;
  let originalUi;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    const stateModule = await import('../../js/state.js');
    store = stateModule.store;

    originalClaims = store.claims;
    originalConfig = store.config;
    originalUsers = store.users;
    originalProfiles = store.profiles;
    originalHolidays = store.holidays;
    originalTimeOff = store.timeOff;
    originalOverrides = store.overrides;
    originalUi = store.ui;

    document.body.innerHTML = `
      <input id="startDate" />
      <input id="endDate" />
      <div id="emptyState" class="hidden"></div>
      <div id="tabNavCard" style="display:none;"></div>
      <button id="exportBtn" disabled></button>
    `;

    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me',
      reportsUrl: 'https://reports.api.clockify.me'
    };
    store.config = {
      useProfileCapacity: false,
      useProfileWorkingDays: false,
      applyHolidays: false,
      applyTimeOff: false,
      showBillableBreakdown: true,
      showDecimalTime: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily'
    };
    store.users = [{ id: 'user1', name: 'User 1' }];
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.ui = { ...store.ui, detailedPage: 1, detailedPageSize: 50 };
    store.rawEntries = null;
    store.analysisResults = null;

    uiMock.showLargeDateRangeWarning.mockResolvedValue(true);

    const mainModule = await import('../../js/main.js');
    handleGenerateReport = mainModule.handleGenerateReport;
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';

    store.claims = originalClaims;
    store.config = originalConfig;
    store.users = originalUsers;
    store.profiles = originalProfiles;
    store.holidays = originalHolidays;
    store.timeOff = originalTimeOff;
    store.overrides = originalOverrides;
    store.ui = originalUi;
  });

  it('renders only the latest request when responses resolve out of order', async () => {
    const start = '2025-01-01';
    const end = '2025-01-07';

    document.getElementById('startDate').value = start;
    document.getElementById('endDate').value = end;

    let resolveFirst;
    let resolveSecond;

    apiMock.fetchDetailedReport.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );
    apiMock.fetchDetailedReport.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSecond = resolve; })
    );

    const firstPromise = handleGenerateReport();
    const secondPromise = handleGenerateReport();

    resolveSecond([
      {
        id: 'entry_second',
        userId: 'user1',
        userName: 'User 1',
        timeInterval: {
          start: '2025-01-03T09:00:00Z',
          end: '2025-01-03T10:00:00Z',
          duration: 'PT1H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ]);
    await secondPromise;

    resolveFirst([
      {
        id: 'entry_first',
        userId: 'user1',
        userName: 'User 1',
        timeInterval: {
          start: '2025-01-02T09:00:00Z',
          end: '2025-01-02T10:00:00Z',
          duration: 'PT1H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ]);
    await firstPromise;

    expect(uiMock.renderSummaryStrip).toHaveBeenCalledTimes(1);
  });

  it('discards stale profile/holiday/timeOff responses from cancelled requests', async () => {
    const start = '2025-01-01';
    const end = '2025-01-07';

    document.getElementById('startDate').value = start;
    document.getElementById('endDate').value = end;

    // Enable optional fetches
    store.config.useProfileCapacity = true;
    store.config.applyHolidays = true;
    store.config.applyTimeOff = true;

    let resolveFirstEntries;
    let resolveSecondEntries;
    let resolveFirstProfiles;
    let resolveSecondProfiles;

    // Set up controlled promises for entries
    apiMock.fetchDetailedReport
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstEntries = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondEntries = resolve; }));

    // Set up controlled promises for profiles
    apiMock.fetchAllProfiles
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstProfiles = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondProfiles = resolve; }));

    // Holidays and timeOff resolve immediately with empty data
    apiMock.fetchAllHolidays.mockResolvedValue(new Map());
    apiMock.fetchAllTimeOff.mockResolvedValue(new Map());

    // Start first request
    const firstPromise = handleGenerateReport();

    // Start second request (aborts first)
    const secondPromise = handleGenerateReport();

    // Resolve second request's entries and profiles first (simulates faster response)
    const secondProfileData = new Map([
      ['user1', { workCapacity: 'PT8H', workingDays: [1, 2, 3, 4, 5] }]
    ]);
    resolveSecondProfiles(secondProfileData);
    resolveSecondEntries([{
      id: 'entry_second',
      userId: 'user1',
      userName: 'User 1',
      timeInterval: {
        start: '2025-01-03T09:00:00Z',
        end: '2025-01-03T10:00:00Z',
        duration: 'PT1H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }]);
    await secondPromise;

    // Verify second request's profile data was stored
    expect(store.profiles.has('user1')).toBe(true);
    const profileAfterSecond = store.profiles.get('user1');
    expect(profileAfterSecond.workCapacityHours).toBe(8);

    // Now resolve first request's profile with DIFFERENT data (should be discarded)
    const firstProfileData = new Map([
      ['user1', { workCapacity: 'PT4H', workingDays: [1, 2, 3] }] // Different capacity!
    ]);
    resolveFirstProfiles(firstProfileData);
    resolveFirstEntries([{
      id: 'entry_first',
      userId: 'user1',
      userName: 'User 1',
      timeInterval: {
        start: '2025-01-02T09:00:00Z',
        end: '2025-01-02T10:00:00Z',
        duration: 'PT1H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }]);
    await firstPromise;

    // Verify the stale profile data was NOT applied (race condition guard worked)
    const profileAfterFirst = store.profiles.get('user1');
    expect(profileAfterFirst.workCapacityHours).toBe(8); // Should still be 8, not 4
  });
});
