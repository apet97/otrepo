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
  fetchAllProfiles: jest.fn(),
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

describe('Main handleGenerateReport optional fetch failures', () => {
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
      useProfileCapacity: true,
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
    apiMock.fetchDetailedReport.mockResolvedValue([
      {
        id: 'entry_1',
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

  it('tracks profile fetch failure and shows API status', async () => {
    apiMock.fetchAllProfiles.mockRejectedValue(new Error('profile failure'));

    document.getElementById('startDate').value = '2025-01-01';
    document.getElementById('endDate').value = '2025-01-07';

    await handleGenerateReport();

    expect(store.apiStatus.profilesFailed).toBe(store.users.length);
    expect(uiMock.renderApiStatus).toHaveBeenCalled();
  });
});
