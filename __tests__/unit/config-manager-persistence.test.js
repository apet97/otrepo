/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

const mockStore = {
    rawEntries: null,
    analysisResults: null,
    config: {
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        showDecimalTime: false,
        amountDisplay: 'earned',
        overtimeBasis: 'daily',
        enableTieredOT: false,
    },
    calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 0,
        tier2Multiplier: 2,
    },
    ui: {
        isAdmin: false,
        hasAmountRates: true,
        hasCostRates: true,
        summaryGroupBy: 'user',
        summaryExpanded: false,
        activeTab: 'summary',
        summaryPage: 1,
    },
    saveConfig: jest.fn(),
    saveUIState: jest.fn(),
    clearReportCache: jest.fn(),
    clearAllData: jest.fn(),
};

const renderSummaryExpandToggleMock = jest.fn();
const renderSummaryStripMock = jest.fn();
const renderSummaryTableMock = jest.fn();
const renderDetailedTableMock = jest.fn();
const showClearDataConfirmationMock = jest.fn();
const saveServerConfigMock = jest.fn().mockResolvedValue(true);
const runCalculationMock = jest.fn();

jest.unstable_mockModule('../../js/state.js', () => ({
    store: mockStore,
}));

jest.unstable_mockModule('../../js/ui/index.js', () => ({
    renderSummaryExpandToggle: renderSummaryExpandToggleMock,
    renderSummaryStrip: renderSummaryStripMock,
    renderSummaryTable: renderSummaryTableMock,
    renderDetailedTable: renderDetailedTableMock,
    renderLoading: jest.fn(),
    showError: jest.fn(),
    hideError: jest.fn(),
    initializeElements: jest.fn(),
    showClearDataConfirmation: showClearDataConfirmationMock,
}));

jest.unstable_mockModule('../../js/export.js', () => ({
    downloadCsv: jest.fn(),
    downloadSummaryCsv: jest.fn(),
    downloadDetailedCsv: jest.fn(),
}));

jest.unstable_mockModule('../../js/settings-api.js', () => ({
    saveServerConfig: saveServerConfigMock,
}));

jest.unstable_mockModule('../../js/worker-manager.js', () => ({
    runCalculation: runCalculationMock,
}));

jest.unstable_mockModule('../../js/date-presets.js', () => ({
    getThisWeekRange: jest.fn(() => ({ start: '2026-03-09', end: '2026-03-11' })),
    getLastWeekRange: jest.fn(() => ({ start: '2026-03-02', end: '2026-03-08' })),
    getLast2WeeksRange: jest.fn(() => ({ start: '2026-02-26', end: '2026-03-11' })),
    getLastMonthRange: jest.fn(() => ({ start: '2026-02-01', end: '2026-02-28' })),
    getThisMonthRange: jest.fn(() => ({ start: '2026-03-01', end: '2026-03-31' })),
}));

jest.unstable_mockModule('../../js/utils.js', () => ({
    debounce: jest.fn((fn) => fn),
    validateInputBounds: jest.fn((_, value) => ({ value })),
}));

function setupDom() {
    document.body.innerHTML = `
        <input type="checkbox" id="useProfileCapacity" />
        <input type="checkbox" id="useProfileWorkingDays" />
        <input type="checkbox" id="applyHolidays" />
        <input type="checkbox" id="applyTimeOff" />
        <input type="checkbox" id="showBillableBreakdown" />
        <input type="checkbox" id="showDecimalTime" />
        <input type="number" id="configDaily" value="8" />
        <span id="dailyThresholdHelper" style="display:none"></span>
        <input type="number" id="configWeekly" value="40" />
        <input type="number" id="configMultiplier" value="1.5" />
        <select id="overtimeBasis">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="both">Both</option>
        </select>
        <div id="weeklyThresholdContainer"></div>
        <input type="checkbox" id="enableTieredOT" />
        <div class="tier2-config"><input type="number" id="configTier2Threshold" value="0" /></div>
        <div class="tier2-config"><input type="number" id="configTier2Multiplier" value="2" /></div>
        <div id="configToggle"></div>
        <div id="configContent"></div>
        <div id="tabNavCard">
            <button class="tab-btn" data-tab="summary" aria-selected="true">Summary</button>
            <button class="tab-btn" data-tab="detailed" aria-selected="false">Detailed</button>
        </div>
        <div id="summaryCard"></div>
        <div id="detailedCard" class="hidden"></div>
        <button id="exportBtn">Export</button>
        <button id="refreshBtn">Refresh</button>
        <input type="date" id="startDate" value="2026-03-01" />
        <input type="date" id="endDate" value="2026-03-11" />
        <button id="datePresetThisWeek">This Week</button>
        <button id="datePresetLastWeek">Last Week</button>
        <button id="datePresetLast2Weeks">Last 2 Weeks</button>
        <button id="datePresetLastMonth">Last Month</button>
        <button id="datePresetThisMonth">This Month</button>
        <div id="detailedFilters"></div>
        <select id="groupBySelect">
            <option value="user">User</option>
        </select>
        <div id="summaryExpandToggleContainer"><button id="summaryExpandToggle">Toggle</button></div>
        <button id="clearAllDataBtn">Clear</button>
        <select id="amountDisplay">
            <option value="earned">Earned</option>
            <option value="cost">Cost</option>
            <option value="profit">Profit</option>
        </select>
        <div id="amountDisplayContainer"></div>
    `;
}

describe('config-manager persistence behavior', () => {
    let bindConfigEvents;
    let cleanupConfigEvents;
    let handleGenerateReport;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        setupDom();
        handleGenerateReport = jest.fn();

        mockStore.rawEntries = null;
        mockStore.analysisResults = null;
        mockStore.config = {
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
        mockStore.calcParams = {
            dailyThreshold: 8,
            weeklyThreshold: 40,
            overtimeMultiplier: 1.5,
            tier2ThresholdHours: 0,
            tier2Multiplier: 2,
        };
        mockStore.ui = {
            isAdmin: false,
            hasAmountRates: true,
            hasCostRates: true,
            summaryGroupBy: 'user',
            summaryExpanded: false,
            activeTab: 'summary',
            summaryPage: 1,
        };

        ({ bindConfigEvents, cleanupConfigEvents } = await import('../../js/config-manager.js'));
    });

    afterEach(() => {
        cleanupConfigEvents();
        standardAfterEach();
        document.body.innerHTML = '';
    });

    it('persists shared config changes for admins', () => {
        mockStore.ui.isAdmin = true;
        bindConfigEvents(handleGenerateReport);

        const checkbox = document.getElementById('applyHolidays');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(saveServerConfigMock).toHaveBeenCalledWith(mockStore.config, mockStore.calcParams);
    });

    it('does not persist shared config changes for non-admins', () => {
        mockStore.ui.isAdmin = false;
        bindConfigEvents(handleGenerateReport);

        const checkbox = document.getElementById('applyHolidays');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(saveServerConfigMock).not.toHaveBeenCalled();
    });

    it('does not auto-generate reports when the selected date range is invalid', () => {
        bindConfigEvents(handleGenerateReport);

        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        startInput.value = '2026-03-20';
        endInput.value = '2026-03-10';

        startInput.dispatchEvent(new Event('change'));
        endInput.dispatchEvent(new Event('change'));

        expect(handleGenerateReport).not.toHaveBeenCalled();
    });
});
