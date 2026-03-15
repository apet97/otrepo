/**
 * @jest-environment jsdom
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

const mockRenderSummaryExpandToggle = jest.fn();
const mockRenderSummaryStrip = jest.fn();
const mockRenderSummaryTable = jest.fn();
const mockRenderDetailedTable = jest.fn();

jest.unstable_mockModule('../../js/ui/index.js', () => ({
    renderSummaryExpandToggle: mockRenderSummaryExpandToggle,
    renderSummaryStrip: mockRenderSummaryStrip,
    renderSummaryTable: mockRenderSummaryTable,
    renderDetailedTable: mockRenderDetailedTable,
    renderLoading: jest.fn(),
    showError: jest.fn(),
    hideError: jest.fn(),
    initializeElements: jest.fn(),
    showClearDataConfirmation: jest.fn(),
}));

jest.unstable_mockModule('../../js/export.js', () => ({
    downloadCsv: jest.fn(),
    downloadSummaryCsv: jest.fn(),
    downloadDetailedCsv: jest.fn(),
}));

const mockRunCalculation = jest.fn();
jest.unstable_mockModule('../../js/worker-manager.js', () => ({
    runCalculation: mockRunCalculation,
}));

jest.unstable_mockModule('../../js/date-presets.js', () => ({
    getThisWeekRange: jest.fn(() => ({ start: '2026-03-09', end: '2026-03-11' })),
    getLastWeekRange: jest.fn(() => ({ start: '2026-03-02', end: '2026-03-08' })),
    getLast2WeeksRange: jest.fn(() => ({ start: '2026-02-26', end: '2026-03-11' })),
    getLastMonthRange: jest.fn(() => ({ start: '2026-02-01', end: '2026-02-28' })),
    getThisMonthRange: jest.fn(() => ({ start: '2026-03-01', end: '2026-03-31' })),
}));

const { store } = await import('../../js/state.js');
const { syncAmountDisplayAvailability, bindConfigEvents, cleanupConfigEvents } =
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

describe('syncAmountDisplayAvailability', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupConfigDOM();
    });

    afterEach(() => {
        standardAfterEach();
        document.body.innerHTML = '';
    });

    it('handles null entries (defaults to true)', () => {
        syncAmountDisplayAvailability(null);
        expect(store.ui.hasAmountRates).toBe(true);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('handles empty entries array (defaults to true)', () => {
        syncAmountDisplayAvailability([]);
        expect(store.ui.hasAmountRates).toBe(true);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('detects no rates and disables amount display', () => {
        syncAmountDisplayAvailability([{ id: '1', timeInterval: { start: '', end: '', duration: '' } }]);
        expect(store.ui.hasAmountRates).toBe(false);
        expect(store.ui.hasCostRates).toBe(false);
        const el = document.getElementById('amountDisplay');
        expect(el.disabled).toBe(true);
    });

    it('detects hourlyRate', () => {
        syncAmountDisplayAvailability([{ id: '1', hourlyRate: { amount: 50 } }]);
        expect(store.ui.hasAmountRates).toBe(true);
    });

    it('detects earnedRate object form', () => {
        syncAmountDisplayAvailability([{ id: '1', earnedRate: { amount: 100 } }]);
        expect(store.ui.hasAmountRates).toBe(true);
    });

    it('detects earnedRate numeric form', () => {
        syncAmountDisplayAvailability([{ id: '1', earnedRate: 100 }]);
        expect(store.ui.hasAmountRates).toBe(true);
    });

    it('detects costRate object form', () => {
        syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 75 } }]);
        expect(store.ui.hasAmountRates).toBe(true);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('detects costRate numeric form', () => {
        syncAmountDisplayAvailability([{ id: '1', costRate: 75 }]);
        expect(store.ui.hasAmountRates).toBe(true);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('costRate = 0 is not counted', () => {
        syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 0 } }]);
        expect(store.ui.hasCostRates).toBe(false);
    });

    it('detects amounts array with COST type', () => {
        syncAmountDisplayAvailability([{ id: '1', amounts: [{ type: 'COST', value: 100 }] }]);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('detects amounts array with PROFIT amountType', () => {
        syncAmountDisplayAvailability([{ id: '1', amounts: [{ amountType: 'PROFIT', amount: 50 }] }]);
        expect(store.ui.hasCostRates).toBe(true);
    });

    it('amounts with zero value are not counted for cost', () => {
        syncAmountDisplayAvailability([{ id: '1', amounts: [{ type: 'COST', value: 0 }] }]);
        expect(store.ui.hasCostRates).toBe(false);
    });

    it('amounts with non-COST/PROFIT type detected for amount rates', () => {
        syncAmountDisplayAvailability([{ id: '1', amounts: [{ type: 'EARNED', value: 100 }] }]);
        expect(store.ui.hasAmountRates).toBe(true);
    });

    it('resets display to earned when no amount rates', () => {
        store.config.amountDisplay = 'cost';
        syncAmountDisplayAvailability([{ id: '1' }]);
        expect(store.config.amountDisplay).toBe('earned');
    });

    it('resets cost/profit to earned when no cost rates', () => {
        store.config.amountDisplay = 'cost';
        syncAmountDisplayAvailability([{ id: '1', hourlyRate: { amount: 50 } }]);
        expect(store.config.amountDisplay).toBe('earned');
    });

    it('preserves earned display when valid', () => {
        store.config.amountDisplay = 'earned';
        syncAmountDisplayAvailability([{ id: '1', hourlyRate: { amount: 50 }, costRate: { amount: 25 } }]);
        expect(store.config.amountDisplay).toBe('earned');
    });

    it('handles missing amountDisplay element', () => {
        document.body.innerHTML = '';
        expect(() => syncAmountDisplayAvailability([{ id: '1', hourlyRate: { amount: 50 } }])).not.toThrow();
    });

    it('handles invalid amountDisplay value in store', () => {
        store.config.amountDisplay = 'invalid';
        syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 75 } }]);
        expect(store.config.amountDisplay).toBe('earned');
    });

    it('hides cost/profit options when no cost rates available', () => {
        syncAmountDisplayAvailability([{ id: '1', hourlyRate: { amount: 50 } }]);
        const costOpt = document.querySelector('option[value="cost"]');
        const profitOpt = document.querySelector('option[value="profit"]');
        expect(costOpt.hidden).toBe(true);
        expect(profitOpt.hidden).toBe(true);
    });

    it('shows cost/profit options when cost rates available', () => {
        syncAmountDisplayAvailability([{ id: '1', costRate: { amount: 75 } }]);
        const costOpt = document.querySelector('option[value="cost"]');
        expect(costOpt.hidden).toBe(false);
        expect(costOpt.disabled).toBe(false);
    });

    it('hides amountDisplayContainer when no amount rates', () => {
        syncAmountDisplayAvailability([{ id: '1' }]);
        const container = document.getElementById('amountDisplayContainer');
        expect(container.classList.contains('hidden')).toBe(true);
    });
});

describe('bindConfigEvents', () => {
    let handleGenerateReport;

    beforeEach(() => {
        jest.clearAllMocks();
        handleGenerateReport = jest.fn();
        setupConfigDOM();
    });

    afterEach(() => {
        cleanupConfigEvents();
        standardAfterEach();
        document.body.innerHTML = '';
    });

    it('binds useProfileCapacity toggle — disables daily input', () => {
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('useProfileCapacity');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
        expect(store.config.useProfileCapacity).toBe(true);
        expect(document.getElementById('configDaily').disabled).toBe(true);
    });

    it('binds showDecimalTime toggle — re-renders without runCalculation', () => {
        store.rawEntries = [{}];
        store.analysisResults = [{}];
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('showDecimalTime');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
        expect(store.config.showDecimalTime).toBe(true);
        expect(mockRenderSummaryStrip).toHaveBeenCalled();
        expect(mockRunCalculation).not.toHaveBeenCalled();
    });

    it('binds showBillableBreakdown toggle', () => {
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('showBillableBreakdown');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
        expect(mockRenderSummaryExpandToggle).toHaveBeenCalled();
    });

    it('binds overtime basis selector', () => {
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('overtimeBasis');
        el.value = 'weekly';
        el.dispatchEvent(new Event('change'));
        expect(store.config.overtimeBasis).toBe('weekly');
        const container = document.getElementById('weeklyThresholdContainer');
        expect(container.classList.contains('hidden')).toBe(false);
    });

    it('binds overtime basis to both — shows weekly container', () => {
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('overtimeBasis');
        el.value = 'both';
        el.dispatchEvent(new Event('change'));
        expect(store.config.overtimeBasis).toBe('both');
    });

    it('binds tab navigation — click', () => {
        bindConfigEvents(handleGenerateReport);
        const detailedTab = document.querySelector('.tab-btn[data-tab="detailed"]');
        detailedTab.dispatchEvent(new MouseEvent('click'));
        expect(store.ui.activeTab).toBe('detailed');
        expect(document.getElementById('detailedCard').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('summaryCard').classList.contains('hidden')).toBe(true);
    });

    it('binds tab navigation — Enter key', () => {
        bindConfigEvents(handleGenerateReport);
        const summaryTab = document.querySelector('.tab-btn[data-tab="summary"]');
        summaryTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(store.ui.activeTab).toBe('summary');
    });

    it('binds tab navigation — Space key', () => {
        bindConfigEvents(handleGenerateReport);
        const detailedTab = document.querySelector('.tab-btn[data-tab="detailed"]');
        detailedTab.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(store.ui.activeTab).toBe('detailed');
    });

    it('ignores non-Enter/Space keydown on tabs', () => {
        bindConfigEvents(handleGenerateReport);
        store.ui.activeTab = 'summary';
        const detailedTab = document.querySelector('.tab-btn[data-tab="detailed"]');
        detailedTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        expect(store.ui.activeTab).toBe('summary'); // unchanged
    });

    it('binds config panel collapse toggle', () => {
        bindConfigEvents(handleGenerateReport);
        const toggle = document.getElementById('configToggle');
        // First click expands (starts collapsed)
        toggle.dispatchEvent(new MouseEvent('click'));
        expect(toggle.classList.contains('collapsed')).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('binds date preset buttons', () => {
        bindConfigEvents(handleGenerateReport);
        document.getElementById('datePresetThisWeek').dispatchEvent(new MouseEvent('click'));
        expect(document.getElementById('startDate').value).toBe('2026-03-09');
        expect(document.getElementById('endDate').value).toBe('2026-03-11');
    });

    it('binds refresh button', () => {
        bindConfigEvents(handleGenerateReport);
        document.getElementById('refreshBtn').dispatchEvent(new MouseEvent('click'));
        expect(handleGenerateReport).toHaveBeenCalledWith(true);
    });

    it('binds filter chips', () => {
        store.analysisResults = [{}];
        bindConfigEvents(handleGenerateReport);
        const chip = document.querySelector('.chip[data-filter="overtime"]');
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockRenderDetailedTable).toHaveBeenCalledWith([{}], 'overtime');
    });

    it('filter chip ignores non-chip targets', () => {
        store.analysisResults = [{}];
        bindConfigEvents(handleGenerateReport);
        const container = document.getElementById('detailedFilters');
        container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockRenderDetailedTable).not.toHaveBeenCalled();
    });

    it('binds groupBy selector', () => {
        store.analysisResults = [{}];
        bindConfigEvents(handleGenerateReport);
        const sel = document.getElementById('groupBySelect');
        sel.value = 'date';
        sel.dispatchEvent(new Event('change'));
        expect(store.ui.summaryGroupBy).toBe('date');
        expect(mockRenderSummaryTable).toHaveBeenCalled();
    });

    it('binds enableTieredOT toggle', () => {
        store.calcParams.overtimeMultiplier = 1.5;
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('enableTieredOT');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
        expect(store.config.enableTieredOT).toBe(true);
        expect(store.calcParams.tier2Multiplier).toBe(1.5);
    });

    it('does not double-bind events', () => {
        bindConfigEvents(handleGenerateReport);
        bindConfigEvents(handleGenerateReport);
        document.getElementById('refreshBtn').dispatchEvent(new MouseEvent('click'));
        expect(handleGenerateReport).toHaveBeenCalledTimes(1);
    });

    it('cleanupConfigEvents removes listeners', () => {
        bindConfigEvents(handleGenerateReport);
        cleanupConfigEvents();
        bindConfigEvents(handleGenerateReport);
        document.getElementById('refreshBtn').dispatchEvent(new MouseEvent('click'));
        expect(handleGenerateReport).toHaveBeenCalledTimes(1);
    });

    it('binds amount display — rejects cost when no cost rates', () => {
        store.ui.hasCostRates = false;
        store.ui.hasAmountRates = true;
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('amountDisplay');
        el.value = 'cost';
        el.dispatchEvent(new Event('change'));
        expect(store.config.amountDisplay).toBe('earned');
    });

    it('binds amount display — accepts cost when cost rates available', () => {
        store.ui.hasCostRates = true;
        store.ui.hasAmountRates = true;
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('amountDisplay');
        el.value = 'cost';
        el.dispatchEvent(new Event('change'));
        expect(store.config.amountDisplay).toBe('cost');
    });

    it('binds summaryExpandToggle', () => {
        store.ui.summaryExpanded = false;
        store.analysisResults = [{}];
        bindConfigEvents(handleGenerateReport);
        const btn = document.getElementById('summaryExpandToggle');
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(store.ui.summaryExpanded).toBe(true);
    });

    it('summaryExpandToggle ignores non-toggle clicks', () => {
        store.ui.summaryExpanded = false;
        bindConfigEvents(handleGenerateReport);
        const container = document.getElementById('summaryExpandToggleContainer');
        container.dispatchEvent(new MouseEvent('click', { bubbles: false }));
        expect(store.ui.summaryExpanded).toBe(false);
    });

    it('non-display toggle triggers runCalculation when rawEntries exist', () => {
        store.rawEntries = [{}];
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('applyHolidays');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
        expect(mockRunCalculation).toHaveBeenCalled();
    });

    it('does not runCalculation when rawEntries is null', () => {
        store.rawEntries = null;
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('applyHolidays');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
        expect(mockRunCalculation).not.toHaveBeenCalled();
    });

    it('overtime basis defaults invalid value to daily', () => {
        store.config.overtimeBasis = 'invalid';
        bindConfigEvents(handleGenerateReport);
        const el = document.getElementById('overtimeBasis');
        expect(el.value).toBe('daily');
    });
});
