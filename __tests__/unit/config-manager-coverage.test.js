/**
 * @jest-environment jsdom
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// ========== Mocks ==========

const mockRenderSummaryExpandToggle = jest.fn();
const mockRenderSummaryStrip = jest.fn();
const mockRenderSummaryTable = jest.fn();
const mockRenderDetailedTable = jest.fn();
const mockShowClearDataConfirmation = jest.fn();

jest.unstable_mockModule('../../js/ui/index.js', () => ({
    renderSummaryExpandToggle: mockRenderSummaryExpandToggle,
    renderSummaryStrip: mockRenderSummaryStrip,
    renderSummaryTable: mockRenderSummaryTable,
    renderDetailedTable: mockRenderDetailedTable,
    renderLoading: jest.fn(),
    showError: jest.fn(),
    hideError: jest.fn(),
    initializeElements: jest.fn(),
    showClearDataConfirmation: mockShowClearDataConfirmation,
}));

const mockDownloadSummaryCsv = jest.fn().mockResolvedValue(undefined);
const mockDownloadDetailedCsv = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../js/export.js', () => ({
    downloadCsv: jest.fn(),
    downloadSummaryCsv: mockDownloadSummaryCsv,
    downloadDetailedCsv: mockDownloadDetailedCsv,
}));

const mockRunCalculation = jest.fn();
jest.unstable_mockModule('../../js/worker-manager.js', () => ({
    runCalculation: mockRunCalculation,
}));

const mockSaveServerConfig = jest.fn().mockResolvedValue(true);
jest.unstable_mockModule('../../js/settings-api.js', () => ({
    saveServerConfig: mockSaveServerConfig,
    fetchServerConfig: jest.fn().mockResolvedValue(null),
    fetchServerOverrides: jest.fn().mockResolvedValue(null),
    saveServerOverrides: jest.fn().mockResolvedValue(true),
    initSettingsApi: jest.fn(),
}));

jest.unstable_mockModule('../../js/date-presets.js', () => ({
    getThisWeekRange: jest.fn(() => ({ start: '2026-03-09', end: '2026-03-11' })),
    getLastWeekRange: jest.fn(() => ({ start: '2026-03-02', end: '2026-03-08' })),
    getLast2WeeksRange: jest.fn(() => ({ start: '2026-02-26', end: '2026-03-11' })),
    getLastMonthRange: jest.fn(() => ({ start: '2026-02-01', end: '2026-02-28' })),
    getThisMonthRange: jest.fn(() => ({ start: '2026-03-01', end: '2026-03-31' })),
}));

const { store } = await import('../../js/state.js');
const { bindConfigEvents, cleanupConfigEvents, syncAmountDisplayAvailability } =
    await import('../../js/config-manager.js');

function setupConfigDOM() {
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
        <div id="configToggle" class="collapsed" aria-expanded="false"><span>Config</span></div>
        <div id="configContent" class="hidden"></div>
        <div id="tabNavCard">
            <button class="tab-btn" data-tab="summary" aria-selected="true">Summary</button>
            <button class="tab-btn" data-tab="detailed" aria-selected="false">Detailed</button>
            <button class="tab-btn" data-tab="invalid" aria-selected="false">Invalid</button>
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
        <div id="detailedFilters">
            <button class="chip" data-filter="all">All</button>
            <button class="chip" data-filter="overtime">OT</button>
        </div>
        <select id="groupBySelect">
            <option value="user">User</option>
            <option value="date">Date</option>
        </select>
        <div id="summaryExpandToggleContainer">
            <button id="summaryExpandToggle">Toggle</button>
        </div>
        <button id="clearAllDataBtn">Clear</button>
        <select id="amountDisplay">
            <option value="earned">Earned</option>
            <option value="cost">Cost</option>
            <option value="profit">Profit</option>
        </select>
        <div id="amountDisplayContainer"></div>
    `;
}

describe('config-manager coverage — uncovered paths', () => {
    let handleGenerateReport;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        handleGenerateReport = jest.fn();
        setupConfigDOM();
        // Reset store state
        store.rawEntries = null;
        store.analysisResults = null;
        store.config.useProfileCapacity = false;
        store.ui.isAdmin = false;
        store.ui.activeTab = 'summary';
    });

    afterEach(() => {
        cleanupConfigEvents();
        jest.useRealTimers();
        standardAfterEach();
        document.body.innerHTML = '';
    });

    // ==================================================================
    // Lines 24-25: debouncedServerConfigSave — non-admin guard
    // ==================================================================

    describe('debouncedServerConfigSave', () => {
        it('does not call saveServerConfig when user is not admin', () => {
            store.ui.isAdmin = false;
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('applyHolidays');
            el.checked = true;
            el.dispatchEvent(new Event('change'));

            // Advance past the 500ms debounce for debouncedServerConfigSave
            jest.advanceTimersByTime(600);

            expect(mockSaveServerConfig).not.toHaveBeenCalled();
        });

        it('calls saveServerConfig when user is admin', () => {
            store.ui.isAdmin = true;
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('applyHolidays');
            el.checked = true;
            el.dispatchEvent(new Event('change'));

            // Advance past the 500ms debounce for debouncedServerConfigSave
            jest.advanceTimersByTime(600);

            expect(mockSaveServerConfig).toHaveBeenCalledWith(store.config, store.calcParams);
        });
    });

    // ==================================================================
    // Lines 44-47: updateDailyThresholdState — useProfile=false path
    // ==================================================================

    describe('updateDailyThresholdState — useProfile=false path', () => {
        it('sets opacity to 1 and cursor to empty when useProfileCapacity is false', () => {
            store.config.useProfileCapacity = false;
            bindConfigEvents(handleGenerateReport);

            const dailyInput = document.getElementById('configDaily');
            expect(dailyInput.disabled).toBe(false);
            expect(dailyInput.style.opacity).toBe('1');
            expect(dailyInput.style.cursor).toBe('');
        });

        it('sets opacity to 0.5 and cursor to not-allowed when useProfileCapacity is true', () => {
            store.config.useProfileCapacity = true;
            bindConfigEvents(handleGenerateReport);

            const dailyInput = document.getElementById('configDaily');
            expect(dailyInput.disabled).toBe(true);
            expect(dailyInput.style.opacity).toBe('0.5');
            expect(dailyInput.style.cursor).toBe('not-allowed');
        });

        it('toggles from enabled to disabled on useProfileCapacity change', () => {
            store.config.useProfileCapacity = false;
            bindConfigEvents(handleGenerateReport);

            const dailyInput = document.getElementById('configDaily');
            expect(dailyInput.style.opacity).toBe('1');

            // Toggle useProfileCapacity to true
            const toggle = document.getElementById('useProfileCapacity');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));

            expect(dailyInput.disabled).toBe(true);
            expect(dailyInput.style.opacity).toBe('0.5');
            expect(dailyInput.style.cursor).toBe('not-allowed');
        });

        it('toggles from disabled back to enabled', () => {
            store.config.useProfileCapacity = true;
            bindConfigEvents(handleGenerateReport);

            const dailyInput = document.getElementById('configDaily');
            expect(dailyInput.style.opacity).toBe('0.5');

            // Toggle useProfileCapacity to false
            const toggle = document.getElementById('useProfileCapacity');
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));

            expect(dailyInput.disabled).toBe(false);
            expect(dailyInput.style.opacity).toBe('1');
            expect(dailyInput.style.cursor).toBe('');
        });
    });

    // ==================================================================
    // Line 85: parseTabKey — invalid value returns null
    // ==================================================================

    describe('parseTabKey — invalid tab value', () => {
        it('ignores tab button with invalid data-tab value', () => {
            bindConfigEvents(handleGenerateReport);
            store.ui.activeTab = 'summary';

            const invalidTab = document.querySelector('.tab-btn[data-tab="invalid"]');
            invalidTab.dispatchEvent(new MouseEvent('click'));

            // activeTab should remain unchanged since parseTabKey returns null
            expect(store.ui.activeTab).toBe('summary');
        });

        it('ignores keydown Enter on tab button with invalid data-tab', () => {
            bindConfigEvents(handleGenerateReport);
            store.ui.activeTab = 'summary';

            const invalidTab = document.querySelector('.tab-btn[data-tab="invalid"]');
            invalidTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            expect(store.ui.activeTab).toBe('summary');
        });
    });

    // ==================================================================
    // Lines 321-329: configDaily input handler (debounced)
    // ==================================================================

    describe('configDaily numeric input handler', () => {
        it('updates dailyThreshold on valid input after debounce', () => {
            store.rawEntries = [{}];
            bindConfigEvents(handleGenerateReport);

            const dailyEl = document.getElementById('configDaily');
            dailyEl.value = '10';
            dailyEl.dispatchEvent(new Event('input'));

            // Advance past the 300ms debounce
            jest.advanceTimersByTime(400);

            expect(store.calcParams.dailyThreshold).toBe(10);
            expect(mockRunCalculation).toHaveBeenCalled();
        });

        it('defaults to 8 when input is NaN', () => {
            bindConfigEvents(handleGenerateReport);

            const dailyEl = document.getElementById('configDaily');
            dailyEl.value = 'abc';
            dailyEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.dailyThreshold).toBe(8);
        });

        it('does not runCalculation when rawEntries is null', () => {
            store.rawEntries = null;
            bindConfigEvents(handleGenerateReport);

            const dailyEl = document.getElementById('configDaily');
            dailyEl.value = '10';
            dailyEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.dailyThreshold).toBe(10);
            expect(mockRunCalculation).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 341-349: configWeekly input handler (debounced)
    // ==================================================================

    describe('configWeekly numeric input handler', () => {
        it('updates weeklyThreshold on valid input after debounce', () => {
            store.rawEntries = [{}];
            bindConfigEvents(handleGenerateReport);

            const weeklyEl = document.getElementById('configWeekly');
            weeklyEl.value = '45';
            weeklyEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.weeklyThreshold).toBe(45);
            expect(mockRunCalculation).toHaveBeenCalled();
        });

        it('defaults to 40 when input is NaN', () => {
            bindConfigEvents(handleGenerateReport);

            const weeklyEl = document.getElementById('configWeekly');
            weeklyEl.value = 'abc';
            weeklyEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.weeklyThreshold).toBe(40);
        });

        it('does not runCalculation when rawEntries is null', () => {
            store.rawEntries = null;
            bindConfigEvents(handleGenerateReport);

            const weeklyEl = document.getElementById('configWeekly');
            weeklyEl.value = '45';
            weeklyEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.weeklyThreshold).toBe(45);
            expect(mockRunCalculation).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 361-369: configMultiplier input handler (debounced)
    // ==================================================================

    describe('configMultiplier numeric input handler', () => {
        it('updates overtimeMultiplier on valid input after debounce', () => {
            store.rawEntries = [{}];
            bindConfigEvents(handleGenerateReport);

            const multEl = document.getElementById('configMultiplier');
            multEl.value = '2.0';
            multEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.overtimeMultiplier).toBe(2.0);
            expect(mockRunCalculation).toHaveBeenCalled();
        });

        it('defaults to 1.5 when input is NaN', () => {
            bindConfigEvents(handleGenerateReport);

            const multEl = document.getElementById('configMultiplier');
            multEl.value = 'abc';
            multEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.overtimeMultiplier).toBe(1.5);
        });

        it('does not runCalculation when rawEntries is null', () => {
            store.rawEntries = null;
            bindConfigEvents(handleGenerateReport);

            const multEl = document.getElementById('configMultiplier');
            multEl.value = '2.0';
            multEl.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.overtimeMultiplier).toBe(2.0);
            expect(mockRunCalculation).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 417-425: configTier2Threshold input handler (debounced)
    // ==================================================================

    describe('configTier2Threshold numeric input handler', () => {
        it('updates tier2ThresholdHours on valid input after debounce', () => {
            store.rawEntries = [{}];
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('configTier2Threshold');
            el.value = '12';
            el.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.tier2ThresholdHours).toBe(12);
            expect(mockRunCalculation).toHaveBeenCalled();
        });

        it('defaults to 0 when input is NaN', () => {
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('configTier2Threshold');
            el.value = 'abc';
            el.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.tier2ThresholdHours).toBe(0);
        });

        it('does not runCalculation when rawEntries is null', () => {
            store.rawEntries = null;
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('configTier2Threshold');
            el.value = '12';
            el.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.tier2ThresholdHours).toBe(12);
            expect(mockRunCalculation).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 439-447: configTier2Multiplier input handler (debounced)
    // ==================================================================

    describe('configTier2Multiplier numeric input handler', () => {
        it('updates tier2Multiplier on valid input after debounce', () => {
            store.rawEntries = [{}];
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('configTier2Multiplier');
            el.value = '3.0';
            el.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.tier2Multiplier).toBe(3.0);
            expect(mockRunCalculation).toHaveBeenCalled();
        });

        it('defaults to 2.0 when input is NaN', () => {
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('configTier2Multiplier');
            el.value = 'abc';
            el.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.tier2Multiplier).toBe(2.0);
        });

        it('does not runCalculation when rawEntries is null', () => {
            store.rawEntries = null;
            bindConfigEvents(handleGenerateReport);

            const el = document.getElementById('configTier2Multiplier');
            el.value = '3.0';
            el.dispatchEvent(new Event('input'));

            jest.advanceTimersByTime(400);

            expect(store.calcParams.tier2Multiplier).toBe(3.0);
            expect(mockRunCalculation).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 493-497: Export button — detailed tab path
    // ==================================================================

    describe('export button — detailed tab', () => {
        it('calls downloadDetailedCsv when activeTab is detailed', async () => {
            store.analysisResults = [{ some: 'data' }];
            store.ui.activeTab = 'detailed';
            bindConfigEvents(handleGenerateReport);

            const exportBtn = document.getElementById('exportBtn');
            exportBtn.dispatchEvent(new MouseEvent('click'));

            // The handler is async, flush promises
            await jest.advanceTimersByTimeAsync(0);

            expect(mockDownloadDetailedCsv).toHaveBeenCalledWith(store.analysisResults);
            expect(mockDownloadSummaryCsv).not.toHaveBeenCalled();
        });

        it('calls downloadSummaryCsv when activeTab is summary', async () => {
            store.analysisResults = [{ some: 'data' }];
            store.ui.activeTab = 'summary';
            store.ui.summaryGroupBy = 'user';
            bindConfigEvents(handleGenerateReport);

            const exportBtn = document.getElementById('exportBtn');
            exportBtn.dispatchEvent(new MouseEvent('click'));

            await jest.advanceTimersByTimeAsync(0);

            expect(mockDownloadSummaryCsv).toHaveBeenCalledWith(store.analysisResults, 'user');
            expect(mockDownloadDetailedCsv).not.toHaveBeenCalled();
        });

        it('does nothing when analysisResults is null', async () => {
            store.analysisResults = null;
            store.ui.activeTab = 'detailed';
            bindConfigEvents(handleGenerateReport);

            const exportBtn = document.getElementById('exportBtn');
            exportBtn.dispatchEvent(new MouseEvent('click'));

            await jest.advanceTimersByTimeAsync(0);

            expect(mockDownloadDetailedCsv).not.toHaveBeenCalled();
            expect(mockDownloadSummaryCsv).not.toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 516-520: Date range change — queueAutoGenerate
    // ==================================================================

    describe('date range change — queueAutoGenerate', () => {
        it('calls handleGenerateReport when start <= end after debounce', () => {
            bindConfigEvents(handleGenerateReport);

            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            startInput.value = '2026-03-01';
            endInput.value = '2026-03-11';

            startInput.dispatchEvent(new Event('change'));

            jest.advanceTimersByTime(400);

            expect(handleGenerateReport).toHaveBeenCalled();
        });

        it('does not call handleGenerateReport when startValue > endValue', () => {
            bindConfigEvents(handleGenerateReport);

            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            startInput.value = '2026-03-15';
            endInput.value = '2026-03-01';

            startInput.dispatchEvent(new Event('change'));

            jest.advanceTimersByTime(400);

            expect(handleGenerateReport).not.toHaveBeenCalled();
        });

        it('does not call handleGenerateReport when startValue is empty', () => {
            bindConfigEvents(handleGenerateReport);

            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            startInput.value = '';
            endInput.value = '2026-03-11';

            startInput.dispatchEvent(new Event('change'));

            jest.advanceTimersByTime(400);

            expect(handleGenerateReport).not.toHaveBeenCalled();
        });

        it('does not call handleGenerateReport when endValue is empty', () => {
            bindConfigEvents(handleGenerateReport);

            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            startInput.value = '2026-03-01';
            endInput.value = '';

            endInput.dispatchEvent(new Event('change'));

            jest.advanceTimersByTime(400);

            expect(handleGenerateReport).not.toHaveBeenCalled();
        });

        it('fires queueAutoGenerate from endDate change event', () => {
            bindConfigEvents(handleGenerateReport);

            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            startInput.value = '2026-03-01';
            endInput.value = '2026-03-11';

            endInput.dispatchEvent(new Event('change'));

            jest.advanceTimersByTime(400);

            expect(handleGenerateReport).toHaveBeenCalled();
        });
    });

    // ==================================================================
    // Lines 604-606: Clear all data button
    // ==================================================================

    describe('clear all data button', () => {
        it('calls UI.showClearDataConfirmation with a callback', () => {
            bindConfigEvents(handleGenerateReport);

            const clearBtn = document.getElementById('clearAllDataBtn');
            clearBtn.dispatchEvent(new MouseEvent('click'));

            expect(mockShowClearDataConfirmation).toHaveBeenCalledTimes(1);
            expect(typeof mockShowClearDataConfirmation.mock.calls[0][0]).toBe('function');
        });

        it('callback calls store.clearAllData and location.reload', () => {
            bindConfigEvents(handleGenerateReport);

            const clearBtn = document.getElementById('clearAllDataBtn');
            clearBtn.dispatchEvent(new MouseEvent('click'));

            // Get the callback passed to showClearDataConfirmation
            const callback = mockShowClearDataConfirmation.mock.calls[0][0];

            // Mock store.clearAllData
            const clearAllDataSpy = jest.spyOn(store, 'clearAllData').mockImplementation(() => {});

            // Execute the callback — location.reload() throws "Not implemented" in jsdom
            // but store.clearAllData should still be called (it runs before reload)
            try {
                callback();
            } catch {
                // jsdom throws "Not implemented: navigation" for location.reload()
            }

            expect(clearAllDataSpy).toHaveBeenCalled();

            clearAllDataSpy.mockRestore();
        });
    });

    // ==================================================================
    // Additional coverage: debouncedServerConfigSave via numeric inputs
    // ==================================================================

    describe('debouncedServerConfigSave via numeric inputs', () => {
        it('calls saveServerConfig for daily input when admin', () => {
            store.ui.isAdmin = true;
            bindConfigEvents(handleGenerateReport);

            const dailyEl = document.getElementById('configDaily');
            dailyEl.value = '9';
            dailyEl.dispatchEvent(new Event('input'));

            // Advance past both the 300ms input debounce and the 500ms server save debounce
            jest.advanceTimersByTime(1000);

            expect(mockSaveServerConfig).toHaveBeenCalledWith(store.config, store.calcParams);
        });
    });
});

// ======================================================================
// Missing DOM element branches — cover the falsy paths of if (el) guards
// ======================================================================

describe('config-manager coverage — missing DOM elements', () => {
    let handleGenerateReport;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        handleGenerateReport = jest.fn();
        store.rawEntries = null;
        store.analysisResults = null;
        store.ui.isAdmin = false;
        store.ui.activeTab = 'summary';
    });

    afterEach(() => {
        cleanupConfigEvents();
        jest.useRealTimers();
        standardAfterEach();
        document.body.innerHTML = '';
    });

    it('handles empty DOM — no elements at all', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing dailyInput/helper in updateDailyThresholdState', () => {
        // DOM without configDaily and dailyThresholdHelper
        document.body.innerHTML = `
            <input type="checkbox" id="useProfileCapacity" />
            <select id="overtimeBasis"><option value="daily">Daily</option></select>
            <div id="weeklyThresholdContainer"></div>
        `;
        store.config.useProfileCapacity = false;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing weeklyThresholdContainer in updateWeeklyThresholdState', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
            </select>
        `;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing tab buttons in setActiveTab', () => {
        document.body.innerHTML = `
            <div id="tabNavCard">
                <button class="tab-btn" data-tab="summary">Summary</button>
            </div>
        `;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();

        // Click the only tab — setActiveTab runs with missing detailedBtn, summaryCard, detailedCard
        const btn = document.querySelector('.tab-btn[data-tab="summary"]');
        btn.dispatchEvent(new MouseEvent('click'));
        expect(store.ui.activeTab).toBe('summary');
    });

    it('handles missing summaryCard/detailedCard in setActiveTab', () => {
        document.body.innerHTML = `
            <div id="tabNavCard">
                <button class="tab-btn active" data-tab="summary" aria-selected="true">Summary</button>
                <button class="tab-btn" data-tab="detailed" aria-selected="false">Detailed</button>
            </div>
        `;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();

        const detailedBtn = document.querySelector('.tab-btn[data-tab="detailed"]');
        detailedBtn.dispatchEvent(new MouseEvent('click'));
        expect(store.ui.activeTab).toBe('detailed');
    });

    it('handles missing configToggle or configContent', () => {
        document.body.innerHTML = `<div id="configToggle"></div>`;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing exportBtn', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing refreshBtn', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing startDate/endDate in date range', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing detailedFilters container', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing groupBySelect', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing summaryExpandToggleContainer', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing clearAllDataBtn', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing amountDisplay select', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing enableTieredOT', () => {
        document.body.innerHTML = `
            <div class="tier2-config"><input type="number" id="configTier2Threshold" value="0" /></div>
            <div class="tier2-config"><input type="number" id="configTier2Multiplier" value="2" /></div>
        `;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing configDaily', () => {
        document.body.innerHTML = `<span id="dailyThresholdHelper"></span>`;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing configWeekly', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing configMultiplier', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing configTier2Threshold', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles missing configTier2Multiplier', () => {
        document.body.innerHTML = '';
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles only one date input (startDate only)', () => {
        document.body.innerHTML = `<input type="date" id="startDate" value="2026-03-01" />`;
        bindConfigEvents(handleGenerateReport);

        const startInput = document.getElementById('startDate');
        startInput.dispatchEvent(new Event('change'));

        jest.advanceTimersByTime(400);
        // queueAutoGenerate runs but endInput?.value is undefined, so early return
        expect(handleGenerateReport).not.toHaveBeenCalled();
    });

    it('handles only one date input (endDate only)', () => {
        document.body.innerHTML = `<input type="date" id="endDate" value="2026-03-11" />`;
        bindConfigEvents(handleGenerateReport);

        const endInput = document.getElementById('endDate');
        endInput.dispatchEvent(new Event('change'));

        jest.advanceTimersByTime(400);
        // queueAutoGenerate runs but startInput?.value is undefined, so early return
        expect(handleGenerateReport).not.toHaveBeenCalled();
    });

    it('handles missing amountDisplayContainer', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
                <option value="profit">Profit</option>
            </select>
        `;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles showDecimalTime toggle with rawEntries but no analysisResults', () => {
        setupConfigDOM();
        store.rawEntries = [{}];
        store.analysisResults = null;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('showDecimalTime');
        el.checked = true;
        el.dispatchEvent(new Event('change'));

        // Should not render (no analysisResults) and not call runCalculation (showDecimalTime special path)
        expect(mockRenderSummaryStrip).not.toHaveBeenCalled();
    });

    it('handles date preset button click with missing startEl/endEl', () => {
        document.body.innerHTML = `
            <button id="datePresetThisWeek">This Week</button>
        `;
        bindConfigEvents(handleGenerateReport);

        const btn = document.getElementById('datePresetThisWeek');
        btn.dispatchEvent(new MouseEvent('click'));

        jest.advanceTimersByTime(400);

        // queueAutoGenerate runs but startInput/endInput not in DOM at bind time
        // so startInput?.value and endInput?.value are undefined
        expect(handleGenerateReport).not.toHaveBeenCalled();
    });

    it('handles missing cost/profit options in amountDisplay', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
            </select>
            <div id="amountDisplayContainer"></div>
        `;
        expect(() => bindConfigEvents(handleGenerateReport)).not.toThrow();
    });

    it('handles filter chip click with no data-filter attribute', () => {
        document.body.innerHTML = `
            <div id="detailedFilters">
                <button class="chip">No filter attr</button>
            </div>
        `;
        store.analysisResults = [{}];
        bindConfigEvents(handleGenerateReport);

        const chip = document.querySelector('.chip');
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockRenderDetailedTable).not.toHaveBeenCalled();
    });

    it('handles filter chip click with no analysisResults', () => {
        document.body.innerHTML = `
            <div id="detailedFilters">
                <button class="chip" data-filter="overtime">OT</button>
            </div>
        `;
        store.analysisResults = null;
        bindConfigEvents(handleGenerateReport);

        const chip = document.querySelector('.chip');
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mockRenderDetailedTable).not.toHaveBeenCalled();
    });

    it('handles overtime basis invalid change value — defaults to daily', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="both">Both</option>
                <option value="invalid">Invalid</option>
            </select>
            <div id="weeklyThresholdContainer"></div>
        `;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('overtimeBasis');
        el.value = 'invalid';
        el.dispatchEvent(new Event('change'));

        expect(store.config.overtimeBasis).toBe('daily');
    });

    it('handles amount display invalid change value — defaults to earned', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
                <option value="profit">Profit</option>
                <option value="invalid">Invalid</option>
            </select>
        `;
        store.ui.hasCostRates = true;
        store.ui.hasAmountRates = true;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        el.value = 'invalid';
        el.dispatchEvent(new Event('change'));

        expect(store.config.amountDisplay).toBe('earned');
    });

    it('handles groupBySelect change with no analysisResults', () => {
        document.body.innerHTML = `
            <select id="groupBySelect">
                <option value="user">User</option>
                <option value="date">Date</option>
            </select>
        `;
        store.analysisResults = null;
        bindConfigEvents(handleGenerateReport);

        const sel = document.getElementById('groupBySelect');
        sel.value = 'date';
        sel.dispatchEvent(new Event('change'));

        expect(store.ui.summaryGroupBy).toBe('date');
        expect(mockRenderSummaryTable).not.toHaveBeenCalled();
    });

    it('handles summaryExpandToggle click with no analysisResults', () => {
        document.body.innerHTML = `
            <div id="summaryExpandToggleContainer">
                <button id="summaryExpandToggle">Toggle</button>
            </div>
        `;
        store.ui.summaryExpanded = false;
        store.analysisResults = null;
        bindConfigEvents(handleGenerateReport);

        const btn = document.getElementById('summaryExpandToggle');
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(store.ui.summaryExpanded).toBe(true);
        expect(mockRenderSummaryTable).not.toHaveBeenCalled();
    });

    it('handles enableTieredOT toggle with missing tier2MultEl', () => {
        document.body.innerHTML = `
            <input type="checkbox" id="enableTieredOT" />
            <div class="tier2-config"></div>
        `;
        store.calcParams.overtimeMultiplier = 1.5;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('enableTieredOT');
        el.checked = true;
        el.dispatchEvent(new Event('change'));

        expect(store.config.enableTieredOT).toBe(true);
        // tier2Multiplier should still be set from overtimeMultiplier
        expect(store.calcParams.tier2Multiplier).toBe(1.5);
    });

    it('handles enableTieredOT toggle unchecked — does not set tier2Multiplier', () => {
        setupConfigDOM();
        store.calcParams.overtimeMultiplier = 1.5;
        store.calcParams.tier2Multiplier = 3.0;
        store.config.enableTieredOT = true;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('enableTieredOT');
        el.checked = false;
        el.dispatchEvent(new Event('change'));

        expect(store.config.enableTieredOT).toBe(false);
        // tier2Multiplier should stay 3.0 since the enable branch is not taken
        expect(store.calcParams.tier2Multiplier).toBe(3.0);
    });

    it('handles amount display change triggers runCalculation when rawEntries exist', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
            </select>
        `;
        store.ui.hasCostRates = true;
        store.ui.hasAmountRates = true;
        store.rawEntries = [{}];
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        el.value = 'cost';
        el.dispatchEvent(new Event('change'));

        expect(mockRunCalculation).toHaveBeenCalled();
    });

    it('handles amount display change does not runCalculation when no rawEntries', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
            </select>
        `;
        store.ui.hasCostRates = true;
        store.ui.hasAmountRates = true;
        store.rawEntries = null;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        el.value = 'cost';
        el.dispatchEvent(new Event('change'));

        expect(mockRunCalculation).not.toHaveBeenCalled();
    });

    it('handles overtime basis change triggers runCalculation when rawEntries exist', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
            </select>
            <div id="weeklyThresholdContainer"></div>
        `;
        store.rawEntries = [{}];
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('overtimeBasis');
        el.value = 'weekly';
        el.dispatchEvent(new Event('change'));

        expect(mockRunCalculation).toHaveBeenCalled();
    });

    it('handles overtime basis change does not runCalculation when no rawEntries', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
            </select>
            <div id="weeklyThresholdContainer"></div>
        `;
        store.rawEntries = null;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('overtimeBasis');
        el.value = 'weekly';
        el.dispatchEvent(new Event('change'));

        expect(mockRunCalculation).not.toHaveBeenCalled();
    });

    it('tabNavCard with listenerAttached dataset skips re-binding', () => {
        document.body.innerHTML = `
            <div id="tabNavCard" data-listener-attached="true">
                <button class="tab-btn" data-tab="summary">Summary</button>
                <button class="tab-btn" data-tab="detailed">Detailed</button>
            </div>
        `;
        bindConfigEvents(handleGenerateReport);

        // Click should not change tab since listeners were not attached (dataset already set)
        store.ui.activeTab = 'summary';
        const btn = document.querySelector('.tab-btn[data-tab="detailed"]');
        btn.dispatchEvent(new MouseEvent('click'));
        expect(store.ui.activeTab).toBe('summary');
    });

    it('handles amountDisplay with invalid current store value at init', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
            </select>
        `;
        store.config.amountDisplay = 'invalid';
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        expect(el.value).toBe('earned');
    });

    it('handles amount display profit rejection when no cost rates', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
                <option value="profit">Profit</option>
            </select>
        `;
        store.ui.hasCostRates = false;
        store.ui.hasAmountRates = true;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        el.value = 'profit';
        el.dispatchEvent(new Event('change'));

        expect(store.config.amountDisplay).toBe('earned');
    });

    it('enableTieredOT change triggers runCalculation when rawEntries exist', () => {
        document.body.innerHTML = `
            <input type="checkbox" id="enableTieredOT" />
            <div class="tier2-config"></div>
        `;
        store.rawEntries = [{}];
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('enableTieredOT');
        el.checked = true;
        el.dispatchEvent(new Event('change'));

        expect(mockRunCalculation).toHaveBeenCalled();
    });

    it('enableTieredOT change does not runCalculation when no rawEntries', () => {
        document.body.innerHTML = `
            <input type="checkbox" id="enableTieredOT" />
            <div class="tier2-config"></div>
        `;
        store.rawEntries = null;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('enableTieredOT');
        el.checked = true;
        el.dispatchEvent(new Event('change'));

        expect(mockRunCalculation).not.toHaveBeenCalled();
    });

    // ======= Falsy || fallback branches =======

    it('updateWeeklyThresholdState with falsy overtimeBasis defaults to daily', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
            </select>
            <div id="weeklyThresholdContainer"></div>
        `;
        store.config.overtimeBasis = '';
        bindConfigEvents(handleGenerateReport);

        const container = document.getElementById('weeklyThresholdContainer');
        // With empty overtimeBasis, defaults to 'daily', so weekly container should be hidden
        expect(container.classList.contains('hidden')).toBe(true);
    });

    it('overtimeBasis init with falsy store value defaults to daily', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
            </select>
            <div id="weeklyThresholdContainer"></div>
        `;
        store.config.overtimeBasis = '';
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('overtimeBasis');
        expect(el.value).toBe('daily');
    });

    it('amountDisplay init with falsy store value defaults to earned', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
            </select>
        `;
        store.config.amountDisplay = '';
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        expect(el.value).toBe('earned');
    });

    it('amountDisplay change with falsy select value defaults to earned', () => {
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="">--</option>
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
            </select>
        `;
        store.ui.hasCostRates = true;
        store.ui.hasAmountRates = true;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('amountDisplay');
        el.value = '';
        el.dispatchEvent(new Event('change'));

        expect(store.config.amountDisplay).toBe('earned');
    });

    it('overtimeBasis change with falsy select value defaults to daily', () => {
        document.body.innerHTML = `
            <select id="overtimeBasis">
                <option value="">--</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
            </select>
            <div id="weeklyThresholdContainer"></div>
        `;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('overtimeBasis');
        el.value = '';
        el.dispatchEvent(new Event('change'));

        expect(store.config.overtimeBasis).toBe('daily');
    });

    it('groupBySelect init with falsy summaryGroupBy defaults to user', () => {
        document.body.innerHTML = `
            <select id="groupBySelect">
                <option value="user">User</option>
                <option value="date">Date</option>
            </select>
        `;
        store.ui.summaryGroupBy = '';
        bindConfigEvents(handleGenerateReport);

        const sel = document.getElementById('groupBySelect');
        expect(sel.value).toBe('user');
    });

    it('tier2ThresholdHours init with null value defaults via ??', () => {
        document.body.innerHTML = `
            <input type="number" id="configTier2Threshold" value="0" />
        `;
        store.calcParams.tier2ThresholdHours = null;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('configTier2Threshold');
        expect(el.value).toBe('0');
    });

    it('tier2Multiplier init with null value defaults via ??', () => {
        document.body.innerHTML = `
            <input type="number" id="configTier2Multiplier" value="2" />
        `;
        store.calcParams.tier2Multiplier = null;
        bindConfigEvents(handleGenerateReport);

        const el = document.getElementById('configTier2Multiplier');
        expect(el.value).toBe('2');
    });

    it('export button uses summaryGroupBy fallback when falsy', async () => {
        setupConfigDOM();
        store.analysisResults = [{ some: 'data' }];
        store.ui.activeTab = 'summary';
        store.ui.summaryGroupBy = '';
        bindConfigEvents(handleGenerateReport);

        const exportBtn = document.getElementById('exportBtn');
        exportBtn.dispatchEvent(new MouseEvent('click'));

        await jest.advanceTimersByTimeAsync(0);

        expect(mockDownloadSummaryCsv).toHaveBeenCalledWith(store.analysisResults, 'user');
    });

    // ======= syncAmountDisplayAvailability missing container branch =======

    it('syncAmountDisplayAvailability without amountDisplayContainer', () => {
        // syncAmountDisplayAvailability imported at module level
        // This test is covered via the import at the top; we need to test through
        // the bound module. Let's verify behavior directly.
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
                <option value="cost">Cost</option>
                <option value="profit">Profit</option>
            </select>
        `;
        // No amountDisplayContainer element
        expect(() => syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 75 } }])).not.toThrow();
    });

    it('syncAmountDisplayAvailability without cost/profit options', () => {
        // syncAmountDisplayAvailability imported at module level
        document.body.innerHTML = `
            <select id="amountDisplay">
                <option value="earned">Earned</option>
            </select>
            <div id="amountDisplayContainer"></div>
        `;
        // No cost or profit option elements
        expect(() => syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 75 } }])).not.toThrow();
    });

    it('hasCostRates with amount using amountType instead of type', () => {
        // syncAmountDisplayAvailability imported at module level
        setupConfigDOM();
        // Entry with amounts where amountType is used (not type), and value is via 'amount' key
        syncAmountDisplayAvailability([
            { id: '1', amounts: [{ amountType: 'COST', amount: 50 }] },
        ]);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('hasCostRates with amounts of non-COST/PROFIT type returns false for cost', () => {
        // syncAmountDisplayAvailability imported at module level
        setupConfigDOM();
        // Entry with amounts that have a type but not COST or PROFIT
        syncAmountDisplayAvailability([
            { id: '1', amounts: [{ type: 'EARNED', value: 100 }] },
        ]);
        // hasAmountRates is true (amount value exists), but hasCostRates is false
        expect(store.ui.hasAmountRates).toBe(true);
        expect(store.ui.hasCostRates).toBe(false);
    });

    it('hasCostRates with amounts having neither type nor amountType', () => {
        // syncAmountDisplayAvailability imported at module level
        setupConfigDOM();
        syncAmountDisplayAvailability([
            { id: '1', amounts: [{ value: 100 }] },
        ]);
        // The type will be '' which is not COST or PROFIT
        expect(store.ui.hasCostRates).toBe(false);
    });

    it('setActiveTab with missing summaryBtn covers false branch on line 68', () => {
        // Create tabNavCard with only detailed button — no summary button
        document.body.innerHTML = `
            <div id="tabNavCard">
                <button class="tab-btn" data-tab="detailed" aria-selected="false">Detailed</button>
            </div>
        `;
        bindConfigEvents(handleGenerateReport);

        // Click detailed tab — setActiveTab runs with summaryBtn = null
        const detailedBtn = document.querySelector('.tab-btn[data-tab="detailed"]');
        detailedBtn.dispatchEvent(new MouseEvent('click'));

        expect(store.ui.activeTab).toBe('detailed');
    });

    it('syncAmountDisplayAvailability with falsy amountDisplay in store covers || fallback on line 180', () => {
        setupConfigDOM();
        // Set amountDisplay to a falsy value
        store.config.amountDisplay = '';
        // Entries with amount rates but no cost rates
        syncAmountDisplayAvailability([{ id: '1', hourlyRate: { amount: 50 } }]);
        // The || '' fallback kicks in, then it becomes 'earned' via the invalid value path
        expect(store.config.amountDisplay).toBe('earned');
    });

    it('syncAmountDisplayAvailability with null-ish amountDisplay in store', () => {
        setupConfigDOM();
        store.config.amountDisplay = null;
        syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 75 } }]);
        expect(store.config.amountDisplay).toBe('earned');
    });
});
