/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

const uiMock = {
  renderLoading: jest.fn(),
  showError: jest.fn(),
  showLargeDateRangeWarning: jest.fn().mockResolvedValue(true),
  showCachePrompt: jest.fn().mockResolvedValue('refresh'),
  updateLoadingProgress: jest.fn(),
  clearLoadingProgress: jest.fn(),
  renderApiStatus: jest.fn(),
  renderPaginationWarning: jest.fn(),
  renderThrottleStatus: jest.fn(),
};

const apiMock = {
  fetchDetailedReport: jest.fn().mockResolvedValue([]),
  fetchAllProfiles: jest.fn().mockResolvedValue(new Map()),
  fetchAllHolidays: jest.fn().mockResolvedValue(new Map()),
  fetchAllTimeOff: jest.fn().mockResolvedValue(new Map()),
};

const runCalculationMock = jest.fn();
const syncAmountDisplayAvailabilityMock = jest.fn();
const reportErrorMock = jest.fn();

jest.unstable_mockModule('../../js/ui/index.js', () => uiMock);
jest.unstable_mockModule('../../js/api.js', () => ({
  Api: apiMock,
  initApi: jest.fn(),
}));
jest.unstable_mockModule('../../js/worker-manager.js', () => ({
  runCalculation: runCalculationMock,
}));
jest.unstable_mockModule('../../js/config-manager.js', () => ({
  syncAmountDisplayAvailability: syncAmountDisplayAvailabilityMock,
  bindConfigEvents: jest.fn(),
  cleanupConfigEvents: jest.fn(),
  flushPendingConfigSave: jest.fn(),
}));
jest.unstable_mockModule('../../js/error-reporting.js', () => ({
  reportError: reportErrorMock,
  initErrorReporting: jest.fn(),
  reportMessage: jest.fn(),
  setUserContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  isErrorReportingEnabled: jest.fn(() => false),
  flushErrorReports: jest.fn(),
}));

function setupDOM() {
  document.body.innerHTML = `
    <input id="startDate" />
    <input id="endDate" />
    <div id="emptyState" class="hidden"></div>
    <div id="tabNavCard" style="display:none;"></div>
    <button id="exportBtn" disabled></button>
  `;
}

function setDates(start, end) {
  document.getElementById('startDate').value = start;
  document.getElementById('endDate').value = end;
}

function createEntry(id) {
  return {
    id,
    userId: 'user1',
    userName: 'User 1',
    billable: true,
    timeInterval: {
      start: '2025-01-02T09:00:00Z',
      end: '2025-01-02T17:00:00Z',
      duration: 'PT8H',
    },
  };
}

describe('report-orchestrator handleGenerateReport', () => {
  let handleGenerateReport;
  let store;

  beforeEach(async () => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setupDOM();

    ({ store } = await import('../../js/state.js'));
    ({ handleGenerateReport } = await import('../../js/report-orchestrator.js'));

    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me',
      reportsUrl: 'https://reports.api.clockify.me',
    };
    store.users = [{ id: 'user1', name: 'User 1' }];
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.rawEntries = null;
    store.analysisResults = null;
    store.config = {
      ...store.config,
      useProfileCapacity: false,
      useProfileWorkingDays: false,
      applyHolidays: false,
      applyTimeOff: false,
      showBillableBreakdown: true,
      showDecimalTime: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      enableTieredOT: false,
    };
    store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    store.throttleStatus = { retryCount: 0, lastRetryTime: null };

    apiMock.fetchDetailedReport.mockResolvedValue([createEntry('entry_1')]);
    apiMock.fetchAllProfiles.mockResolvedValue(new Map());
    apiMock.fetchAllHolidays.mockResolvedValue(new Map());
    apiMock.fetchAllTimeOff.mockResolvedValue(new Map());
    uiMock.showLargeDateRangeWarning.mockResolvedValue(true);
    uiMock.showCachePrompt.mockResolvedValue('refresh');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    standardAfterEach();
  });

  it('shows an empty-state message and skips fetching when dates are missing', async () => {
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';

    await handleGenerateReport();

    expect(apiMock.fetchDetailedReport).not.toHaveBeenCalled();
    expect(uiMock.renderLoading).toHaveBeenCalledWith(false);
    expect(document.getElementById('emptyState').textContent).toContain(
      'Please select start and end dates'
    );
  });

  it('shows a validation error when the start date is after the end date', async () => {
    setDates('2025-01-10', '2025-01-01');

    await handleGenerateReport();

    expect(apiMock.fetchDetailedReport).not.toHaveBeenCalled();
    expect(uiMock.showError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invalid Date Range',
        type: 'VALIDATION_ERROR',
      })
    );
  });

  it('stops before fetching when the user cancels a large date range warning', async () => {
    setDates('2025-01-01', '2026-01-10');
    uiMock.showLargeDateRangeWarning.mockResolvedValue(false);

    await handleGenerateReport();

    expect(uiMock.showLargeDateRangeWarning).toHaveBeenCalledWith(expect.any(Number), 1);
    expect(apiMock.fetchDetailedReport).not.toHaveBeenCalled();
    expect(runCalculationMock).not.toHaveBeenCalled();
    expect(uiMock.showError).not.toHaveBeenCalled();
  });

  it('auto-reuses very fresh cached entries without prompting', async () => {
    const cachedEntries = [createEntry('cached_entry')];
    jest.spyOn(store, 'getCachedReport').mockResolvedValue({ entries: cachedEntries, timestamp: Date.now() });
    setDates('2025-01-01', '2025-01-07');

    await handleGenerateReport();

    expect(uiMock.showCachePrompt).not.toHaveBeenCalled();
    expect(apiMock.fetchDetailedReport).not.toHaveBeenCalled();
    expect(store.rawEntries).toEqual(cachedEntries);
    expect(runCalculationMock).toHaveBeenCalledWith(
      { start: '2025-01-01', end: '2025-01-07' },
      syncAmountDisplayAvailabilityMock
    );
    expect(uiMock.updateLoadingProgress).toHaveBeenCalledWith(0, 'cached data');
  });

  it('prompts the user when cached data is older than 5 seconds', async () => {
    const cachedEntries = [createEntry('cached_entry')];
    const oldTimestamp = Date.now() - 10_000; // 10 seconds ago
    jest.spyOn(store, 'getCachedReport').mockResolvedValue({ entries: cachedEntries, timestamp: oldTimestamp });
    uiMock.showCachePrompt.mockResolvedValue('use');
    setDates('2025-01-01', '2025-01-07');

    await handleGenerateReport();

    expect(uiMock.showCachePrompt).toHaveBeenCalledWith(10);
    expect(apiMock.fetchDetailedReport).not.toHaveBeenCalled();
    expect(store.rawEntries).toEqual(cachedEntries);
  });

  it('reuses IDB-backed entries without manually pre-populating sessionStorage', async () => {
    // Regression test for the IDB-only cache reuse bug.
    // getCachedReport() returns { entries, timestamp } from IDB directly,
    // so the orchestrator no longer depends on sessionStorage metadata.
    const cachedEntries = [createEntry('idb_entry')];
    const cacheKey = store.getReportCacheKey('2025-01-01', '2025-01-07');

    // Write to cache via the real method
    await store.setCachedReport(cacheKey, cachedEntries);

    setDates('2025-01-01', '2025-01-07');

    await handleGenerateReport();

    // Fresh cache (< 5s) auto-reuses without prompting
    expect(uiMock.showCachePrompt).not.toHaveBeenCalled();
    expect(apiMock.fetchDetailedReport).not.toHaveBeenCalled();
    expect(store.rawEntries).toEqual(cachedEntries);
  });

  it('stores fetched entries and enables the results UI on success', async () => {
    setDates('2025-01-01', '2025-01-07');

    await handleGenerateReport();

    expect(store.rawEntries).toEqual([createEntry('entry_1')]);
    expect(runCalculationMock).toHaveBeenCalledWith(
      { start: '2025-01-01', end: '2025-01-07' },
      syncAmountDisplayAvailabilityMock
    );
    expect(document.getElementById('tabNavCard').style.display).toBe('flex');
    expect(document.getElementById('exportBtn').disabled).toBe(false);
    expect(uiMock.renderApiStatus).toHaveBeenCalled();
    expect(uiMock.renderThrottleStatus).toHaveBeenCalledWith(0);
  });

  it('maps holiday payloads into per-day store entries', async () => {
    store.config.applyHolidays = true;
    setDates('2025-01-01', '2025-01-07');
    apiMock.fetchAllHolidays.mockResolvedValue(
      new Map([
        [
          'user1',
          [
            { name: 'Single Day', datePeriod: { startDate: '2025-01-01' } },
            { name: 'Holiday Week', datePeriod: { startDate: '2025-01-02', endDate: '2025-01-03' } },
            { name: 'Ignored', datePeriod: { startDate: null, endDate: '2025-01-04' } },
          ],
        ],
      ])
    );

    await handleGenerateReport();

    const userHolidays = store.holidays.get('user1');
    expect([...userHolidays.keys()]).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    expect(userHolidays.get('2025-01-01')).toEqual(expect.objectContaining({ name: 'Single Day' }));
    expect(userHolidays.get('2025-01-03')).toEqual(expect.objectContaining({ name: 'Holiday Week' }));
  });

  it('stores time-off data by user and date map', async () => {
    store.config.applyTimeOff = true;
    setDates('2025-01-01', '2025-01-07');
    const timeOffMap = new Map([['2025-01-03', { isFullDay: true, hours: 8 }]]);
    apiMock.fetchAllTimeOff.mockResolvedValue(new Map([['user1', timeOffMap]]));

    await handleGenerateReport();

    expect(store.timeOff.get('user1')).toBe(timeOffMap);
  });

  it('records optional fetch failures without failing the main report', async () => {
    store.config.useProfileCapacity = true;
    store.config.applyHolidays = true;
    store.config.applyTimeOff = true;
    setDates('2025-01-01', '2025-01-07');

    apiMock.fetchAllProfiles.mockRejectedValue(new Error('profiles failed'));
    apiMock.fetchAllHolidays.mockRejectedValue(new Error('holidays failed'));
    apiMock.fetchAllTimeOff.mockRejectedValue(new Error('time-off failed'));

    await handleGenerateReport();

    expect(store.rawEntries).toEqual([createEntry('entry_1')]);
    expect(store.apiStatus).toEqual({
      profilesFailed: 1,
      holidaysFailed: 1,
      timeOffFailed: 1,
    });
    expect(runCalculationMock).toHaveBeenCalled();
    expect(uiMock.showError).not.toHaveBeenCalled();
  });

  it('surfaces main entry-fetch failures to the user and error reporter', async () => {
    setDates('2025-01-01', '2025-01-07');
    apiMock.fetchDetailedReport.mockRejectedValue(new Error('network failure'));

    await handleGenerateReport();

    expect(uiMock.showError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Report Generation Failed',
        type: 'API_ERROR',
      })
    );
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        module: 'main',
        operation: 'handleGenerateReport',
      })
    );
  });

  it('ignores a stale cache decision after a newer request starts', async () => {
    const cachedEntries = [createEntry('cached_entry')];
    const oldTimestamp = Date.now() - 60_000; // 60 seconds ago — triggers prompt
    jest.spyOn(store, 'getCachedReport').mockResolvedValue({ entries: cachedEntries, timestamp: oldTimestamp });
    setDates('2025-01-01', '2025-01-07');

    let promptCalls = 0;
    uiMock.showCachePrompt.mockImplementation(async () => {
      promptCalls += 1;
      if (promptCalls === 1) {
        store.getCachedReport.mockResolvedValue(null);
        await handleGenerateReport();
        return 'use';
      }
      return 'refresh';
    });

    await handleGenerateReport();

    expect(apiMock.fetchDetailedReport).toHaveBeenCalledTimes(1);
    expect(store.rawEntries).toEqual([createEntry('entry_1')]);
    expect(uiMock.showError).not.toHaveBeenCalled();
  });

  it('abandons an aborted request and only commits the newer response', async () => {
    const secondEntries = [createEntry('entry_2')];
    jest.spyOn(store, 'getCachedReport').mockResolvedValue(null);
    let firstFetchStarted;
    const firstFetchReached = new Promise((resolve) => {
      firstFetchStarted = resolve;
    });

    apiMock.fetchDetailedReport
      .mockImplementationOnce(
        (_, __, ___, { signal }) =>
          new Promise((_, reject) => {
            firstFetchStarted();

            const rejectOnAbort = () => {
              const abortError = new Error('request aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            };

            if (signal.aborted) {
              rejectOnAbort();
              return;
            }

            signal.addEventListener('abort', rejectOnAbort, { once: true });
          })
      )
      .mockResolvedValueOnce(secondEntries);

    setDates('2025-01-01', '2025-01-07');
    const firstRequest = handleGenerateReport();
    await firstFetchReached;

    setDates('2025-02-01', '2025-02-07');
    const secondRequest = handleGenerateReport();

    await Promise.all([firstRequest, secondRequest]);

    expect(apiMock.fetchDetailedReport).toHaveBeenCalledTimes(2);
    expect(runCalculationMock).toHaveBeenCalledTimes(1);
    expect(runCalculationMock).toHaveBeenCalledWith(
      { start: '2025-02-01', end: '2025-02-07' },
      syncAmountDisplayAvailabilityMock
    );
    expect(store.rawEntries).toEqual(secondEntries);
    expect(uiMock.showError).not.toHaveBeenCalled();
  });
});
