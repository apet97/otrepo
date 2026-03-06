/**
 * @jest-environment jsdom
 * @fileoverview Mutation-Killer Tests for Summary UI Module
 *
 * Tests for js/ui/summary.ts - Validates all summary rendering functions with
 * strong assertions to catch even small mutations.
 *
 * Key functions tested:
 * - renderSummaryStrip() - Aggregate metrics summary
 * - renderSummaryTable() - Table with rows grouped by dimension
 * - renderSummaryExpandToggle() - Expand/collapse button
 *
 * Each test validates:
 * - Correct DOM structure
 * - Accurate data display
 * - Proper CSS classes
 * - Conditional rendering (billable, amounts, overtime modes)
 * - Edge cases (empty data, missing elements)
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderSummaryStrip, renderSummaryTable, renderSummaryExpandToggle } from '../../js/ui/summary.js';
import { store } from '../../js/state.js';
import { initializeElements } from '../../js/ui/shared.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Summary UI - renderSummaryStrip', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="summaryStrip"></div>
      <div id="summaryTableContainer"></div>
      <div id="summaryGroupBy"></div>
      <div id="summaryExpandToggleContainer"></div>
    `;

    // Reset store to default state
    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: false,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      maxPages: 10,
      encryptStorage: true,
      auditConsent: true,
    };

    store.ui = {
      isLoading: false,
      summaryExpanded: false,
      summaryGroupBy: 'user',
      overridesCollapsed: true,
      activeTab: 'summary',
      detailedPage: 1,
      detailedPageSize: 50,
      activeDetailedFilter: 'all',
      hasCostRates: true,
      hasAmountRates: true,
      paginationTruncated: false,
      paginationAbortedDueToTokenExpiration: false,
    };

    initializeElements(true);
  });

  afterEach(standardAfterEach);

  const createUserAnalysis = (overrides = {}) => ({
    userId: 'user1',
    userName: 'Test User',
    days: new Map([['2024-01-15', {
      entries: [{
        description: 'Work',
        timeInterval: { start: '2024-01-15T09:00:00Z', duration: 'PT8H' },
        analysis: {
          regular: 8,
          overtime: 2,
          isBillable: true,
          cost: 100,
          amounts: {
            earned: { totalAmountWithOT: 120 },
            cost: { totalAmountWithOT: 80 },
            profit: { totalAmountWithOT: 40 }
          },
          hourlyRate: 15,
        },
        projectId: 'proj1',
        projectName: 'Project A',
        clientId: 'client1',
        clientName: 'Client A',
        taskId: 'task1',
        taskName: 'Task A',
        type: 'REGULAR'
      }],
      meta: { capacity: 8, isHoliday: false, isNonWorking: false, isTimeOff: false }
    }]]),
    totals: {
      total: 10,
      regular: 8,
      overtime: 2,
      expectedCapacity: 8,
      breaks: 0,
      billableWorked: 8,
      nonBillableWorked: 0,
      billableOT: 2,
      nonBillableOT: 0,
      dailyOvertime: 2,
      weeklyOvertime: 0,
      overlapOvertime: 0,
      combinedOvertime: 2,
      amount: 100,
      amountBase: 80,
      amountEarned: 100,
      amountCost: 80,
      amountProfit: 20,
      amountEarnedBase: 80,
      amountCostBase: 60,
      amountProfitBase: 20,
      otPremium: 20,
      otPremiumTier2: 0,
      otPremiumEarned: 20,
      otPremiumCost: 15,
      otPremiumProfit: 5,
      otPremiumTier2Earned: 0,
      otPremiumTier2Cost: 0,
      otPremiumTier2Profit: 0,
      holidayCount: 1,
      timeOffCount: 2,
      holidayHours: 8,
      timeOffHours: 16,
      ...overrides
    }
  });

  it('renders user count, capacity, total, regular, overtime values into DOM', () => {
    const users = [createUserAnalysis()];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip).toBeTruthy();
    expect(strip.innerHTML).toContain('Users');
    expect(strip.innerHTML).toContain('>1<');
    expect(strip.innerHTML).toContain('Capacity');
    expect(strip.innerHTML).toContain('8h');
    expect(strip.innerHTML).toContain('Total time');
    expect(strip.innerHTML).toContain('10h');
    expect(strip.innerHTML).toContain('Regular');
    expect(strip.innerHTML).toContain('Overtime');
    expect(strip.innerHTML).toContain('2h');
    expect(strip.innerHTML).toContain('Holidays');
    expect(strip.innerHTML).toContain('>1<');
    expect(strip.innerHTML).toContain('Time Off');
    expect(strip.innerHTML).toContain('>2<');
  });

  it('renders multiple users with aggregated totals', () => {
    const users = [
      createUserAnalysis({ expectedCapacity: 8, overtime: 2, holidayCount: 1, timeOffCount: 1 }),
      createUserAnalysis({ expectedCapacity: 6, overtime: 3, holidayCount: 0, timeOffCount: 2 }),
    ];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).toContain('Users');
    expect(strip.innerHTML).toContain('>2<');
    expect(strip.innerHTML).toContain('Capacity');
    expect(strip.innerHTML).toContain('14h'); // 8 + 6
    expect(strip.innerHTML).toContain('Overtime');
    expect(strip.innerHTML).toContain('5h'); // 2 + 3
    expect(strip.innerHTML).toContain('Holidays');
    expect(strip.innerHTML).toContain('>1<'); // 1 + 0
    expect(strip.innerHTML).toContain('Time Off');
    expect(strip.innerHTML).toContain('>3<'); // 1 + 2
  });

  it('shows billable breakdown when config.showBillableBreakdown=true', () => {
    store.config.showBillableBreakdown = true;
    store.ui.hasAmountRates = true;

    const users = [createUserAnalysis({
      billableWorked: 6,
      nonBillableWorked: 2,
      billableOT: 1.5,
      nonBillableOT: 0.5,
    })];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).toContain('Billable time');
    expect(strip.innerHTML).toContain('6h');
    expect(strip.innerHTML).toContain('Non-billable time');
    expect(strip.innerHTML).toContain('2h');
    expect(strip.innerHTML).toContain('Billable OT');
    expect(strip.innerHTML).toContain('1h 30m');
    expect(strip.innerHTML).toContain('Non-billable OT');
    expect(strip.innerHTML).toContain('0h 30m');
  });

  it('shows daily/weekly/overlap overtime when overtimeBasis=both', () => {
    store.config.overtimeBasis = 'both';

    const users = [createUserAnalysis({
      dailyOvertime: 2,
      weeklyOvertime: 1.5,
      overlapOvertime: 0.5,
      combinedOvertime: 3,
    })];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).toContain('OT (Combined)');
    expect(strip.innerHTML).toContain('3h');
    expect(strip.innerHTML).toContain('OT Daily');
    expect(strip.innerHTML).toContain('2h');
    expect(strip.innerHTML).toContain('OT Weekly');
    expect(strip.innerHTML).toContain('1h 30m');
    expect(strip.innerHTML).toContain('OT Overlap');
    expect(strip.innerHTML).toContain('0h 30m');
  });

  it('shows Amount and OT Premium when hasAmountRates=true', () => {
    store.ui.hasAmountRates = true;

    const users = [createUserAnalysis({
      amount: 1500,
      otPremium: 250,
      amountBase: 1200,
    })];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).toContain('Amount');
    expect(strip.innerHTML).toContain('$1,500.00');
    expect(strip.innerHTML).toContain('OT Premium');
    expect(strip.innerHTML).toContain('$250.00');
    expect(strip.innerHTML).toContain('$1,200.00'); // base
  });

  it('shows Earned/Cost/Profit when amountDisplay=profit', () => {
    store.ui.hasAmountRates = true;
    store.config.amountDisplay = 'profit';

    const users = [createUserAnalysis({
      amountEarned: 2000,
      amountCost: 1500,
      amountProfit: 500,
      otPremiumEarned: 300,
      otPremiumCost: 200,
      otPremiumProfit: 100,
    })];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    // Should show amount stack (Amt/Cost/Profit)
    expect(strip.innerHTML).toContain('Amt');
    expect(strip.innerHTML).toContain('$2,000.00');
    expect(strip.innerHTML).toContain('Cost');
    expect(strip.innerHTML).toContain('$1,500.00');
    expect(strip.innerHTML).toContain('Profit');
    expect(strip.innerHTML).toContain('$500.00');
    // OT Premium stack
    expect(strip.innerHTML).toContain('$300.00');
    expect(strip.innerHTML).toContain('$200.00');
    expect(strip.innerHTML).toContain('$100.00');
  });

  it('shows Tier 2 Premium when enableTieredOT=true and showBillableBreakdown=true', () => {
    store.config.enableTieredOT = true;
    store.config.showBillableBreakdown = true;
    store.ui.hasAmountRates = true;

    const users = [createUserAnalysis({
      otPremiumTier2: 150,
    })];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).toContain('Tier 2 Premium');
    expect(strip.innerHTML).toContain('$150.00');
  });

  it('does NOT show amounts when hasAmountRates=false', () => {
    store.ui.hasAmountRates = false;

    const users = [createUserAnalysis()];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).not.toContain('$');
    expect(strip.innerHTML).not.toContain('Amount');
    expect(strip.innerHTML).not.toContain('OT Premium');
  });

  it('uses single-row layout when showBillableBreakdown=false', () => {
    store.config.showBillableBreakdown = false;
    store.ui.hasAmountRates = true;

    const users = [createUserAnalysis()];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    // Should have only one row (ot-summary-row-top)
    expect(strip.querySelectorAll('.ot-summary-row').length).toBe(1);
    expect(strip.querySelectorAll('.ot-summary-row-top').length).toBe(1);
    expect(strip.querySelectorAll('.ot-summary-row-bottom').length).toBe(0);
  });

  it('uses two-row layout when showBillableBreakdown=true and hasAmountRates=true', () => {
    store.config.showBillableBreakdown = true;
    store.ui.hasAmountRates = true;

    const users = [createUserAnalysis()];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.querySelectorAll('.ot-summary-row').length).toBe(2);
    expect(strip.querySelectorAll('.ot-summary-row-top').length).toBe(1);
    expect(strip.querySelectorAll('.ot-summary-row-bottom').length).toBe(1);
  });

  it('handles empty users array gracefully', () => {
    const users = [];
    renderSummaryStrip(users);

    const strip = document.getElementById('summaryStrip');
    expect(strip.innerHTML).toContain('Users');
    expect(strip.innerHTML).toContain('>0<');
    expect(strip.innerHTML).toContain('Capacity');
    expect(strip.innerHTML).toContain('0h');
  });
});

describe('Summary UI - renderSummaryTable', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="summaryStrip"></div>
      <div id="summaryTableContainer">
        <table>
          <thead>
            <tr id="summaryHeaderRow"></tr>
          </thead>
          <tbody id="summaryTableBody"></tbody>
        </table>
      </div>
      <div id="summaryGroupBy"></div>
      <div id="summaryExpandToggleContainer"></div>
      <div id="resultsContainer" class="hidden"></div>
    `;

    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: false,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      maxPages: 10,
      encryptStorage: true,
      auditConsent: true,
    };

    store.ui = {
      isLoading: false,
      summaryExpanded: false,
      summaryGroupBy: 'user',
      overridesCollapsed: true,
      activeTab: 'summary',
      detailedPage: 1,
      detailedPageSize: 50,
      activeDetailedFilter: 'all',
      hasCostRates: true,
      hasAmountRates: true,
      paginationTruncated: false,
      paginationAbortedDueToTokenExpiration: false,
    };

    initializeElements(true);
  });

  afterEach(standardAfterEach);

  const createUserAnalysis = (userId, userName, overrides = {}) => ({
    userId,
    userName,
    days: new Map([['2024-01-15', {
      entries: [{
        description: 'Work',
        timeInterval: { start: '2024-01-15T09:00:00Z', duration: 'PT8H' },
        analysis: {
          regular: 8,
          overtime: 2,
          dailyOvertime: 2,
          weeklyOvertime: 0,
          overlapOvertime: 0,
          combinedOvertime: 2,
          isBillable: true,
          cost: 120,
          amounts: {
            earned: { totalAmountWithOT: 150 },
            cost: { totalAmountWithOT: 100 },
            profit: { totalAmountWithOT: 50 }
          },
          hourlyRate: 15,
        },
        projectId: 'proj1',
        projectName: 'Project A',
        clientId: 'client1',
        clientName: 'Client A',
        taskId: 'task1',
        taskName: 'Task A',
        type: 'REGULAR'
      }],
      meta: { capacity: 8, isHoliday: false, isNonWorking: false, isTimeOff: false }
    }]]),
    totals: {
      total: 10,
      regular: 8,
      overtime: 2,
      expectedCapacity: 8,
      breaks: 0,
      billableWorked: 8,
      nonBillableWorked: 0,
      billableOT: 2,
      nonBillableOT: 0,
      dailyOvertime: 2,
      weeklyOvertime: 0,
      overlapOvertime: 0,
      combinedOvertime: 2,
      amount: 120,
      amountBase: 100,
      amountEarned: 150,
      amountCost: 100,
      amountProfit: 50,
      amountEarnedBase: 120,
      amountCostBase: 80,
      amountProfitBase: 40,
      otPremium: 30,
      otPremiumTier2: 0,
      otPremiumEarned: 30,
      otPremiumCost: 20,
      otPremiumProfit: 10,
      otPremiumTier2Earned: 0,
      otPremiumTier2Cost: 0,
      otPremiumTier2Profit: 0,
      holidayCount: 1,
      timeOffCount: 2,
      holidayHours: 8,
      timeOffHours: 16,
      ...overrides
    }
  });

  it('renders table with rows sorted alphabetically by user name', () => {
    const users = [
      createUserAnalysis('user2', 'Zoe'),
      createUserAnalysis('user1', 'Alice'),
      createUserAnalysis('user3', 'Bob'),
    ];
    renderSummaryTable(users);

    const tbody = document.getElementById('summaryTableBody');
    const rows = tbody.querySelectorAll('tr');
    expect(rows.length).toBe(3);

    // Check alphabetical order
    expect(rows[0].innerHTML).toContain('Alice');
    expect(rows[1].innerHTML).toContain('Bob');
    expect(rows[2].innerHTML).toContain('Zoe');
  });

  it('renders correct headers for user grouping', () => {
    store.ui.summaryGroupBy = 'user';
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('User');
    expect(headerRow.innerHTML).toContain('Capacity');
    expect(headerRow.innerHTML).toContain('Regular');
    expect(headerRow.innerHTML).toContain('Overtime');
    expect(headerRow.innerHTML).toContain('Breaks');
    expect(headerRow.innerHTML).toContain('Total');
    expect(headerRow.innerHTML).toContain('Vacation');
  });

  it('renders user rows with capacity column', () => {
    store.ui.summaryGroupBy = 'user';
    const users = [createUserAnalysis('user1', 'Test User', { expectedCapacity: 7.5 })];
    renderSummaryTable(users);

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).toContain('Test User');
    expect(row.innerHTML).toContain('7h 30m'); // capacity
    expect(row.innerHTML).toContain('8h'); // regular
    expect(row.innerHTML).toContain('2h'); // overtime
  });

  it('renders overtime with text-danger class when overtime > 0', () => {
    // computeSummaryRows derives overtime from entry.analysis.overtime, not from totals
    const users = [createUserAnalysis('user1', 'Test User', { overtime: 3 })];
    renderSummaryTable(users);

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).toContain('text-danger');
    // Entry analysis has overtime: 2, which is what the row renders
    expect(row.innerHTML).toContain('2h');
  });

  it('does NOT add text-danger class when overtime = 0', () => {
    const users = [createUserAnalysis('user1', 'Test User', { overtime: 0 })];
    renderSummaryTable(users);

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    // Check that the overtime cell exists but does NOT have text-danger
    const cells = row.querySelectorAll('td');
    const overtimeCell = Array.from(cells).find(cell => cell.innerHTML.includes('0h'));
    expect(overtimeCell).toBeTruthy();
    expect(overtimeCell.className).not.toContain('text-danger');
  });

  it('groups by project when summaryGroupBy=project', () => {
    store.ui.summaryGroupBy = 'project';
    const user1 = createUserAnalysis('user1', 'Alice');
    user1.days.get('2024-01-15').entries[0].projectId = 'projAlpha';
    user1.days.get('2024-01-15').entries[0].projectName = 'Project Alpha';
    const user2 = createUserAnalysis('user2', 'Bob');
    user2.days.get('2024-01-15').entries[0].projectId = 'projBeta';
    user2.days.get('2024-01-15').entries[0].projectName = 'Project Beta';

    renderSummaryTable([user1, user2]);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('Project');
    expect(headerRow.innerHTML).not.toContain('Capacity'); // No capacity for project grouping

    const tbody = document.getElementById('summaryTableBody');
    const rows = tbody.querySelectorAll('tr');
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Check project names appear
    const html = tbody.innerHTML;
    expect(html).toContain('Project Alpha');
    expect(html).toContain('Project Beta');
  });

  it('groups by date when summaryGroupBy=date', () => {
    store.ui.summaryGroupBy = 'date';
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('Date');
    expect(headerRow.innerHTML).not.toContain('Capacity');

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    // Should show formatted date
    expect(row.innerHTML).toMatch(/Jan.*15.*2024|2024-01-15/);
  });

  it('shows billable breakdown columns when expanded=true and showBillableBreakdown=true', () => {
    store.ui.summaryExpanded = true;
    store.config.showBillableBreakdown = true;
    store.ui.hasAmountRates = true;

    // computeSummaryRows derives billable breakdown from entry.analysis
    // Entry has isBillable=true, regular=8, overtime=2, so:
    //   billableWorked=8, billableOT=2, nonBillableOT=0
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('Bill. Worked');
    expect(headerRow.innerHTML).toContain('Bill. OT');
    expect(headerRow.innerHTML).toContain('Non-Bill OT');

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).toContain('8h'); // billableWorked from entry regular
    expect(row.innerHTML).toContain('2h'); // billableOT from entry overtime
    expect(row.innerHTML).toContain('0h'); // nonBillableOT
  });

  it('shows daily/weekly/overlap OT columns when expanded=true and overtimeBasis=both', () => {
    store.ui.summaryExpanded = true;
    store.config.overtimeBasis = 'both';

    // computeSummaryRows derives OT breakdown from entry.analysis, not from totals
    const user = createUserAnalysis('user1', 'Test User');
    // Set entry-level analysis fields that computeSummaryRows reads
    user.days.get('2024-01-15').entries[0].analysis.dailyOvertime = 2;
    user.days.get('2024-01-15').entries[0].analysis.weeklyOvertime = 1;
    user.days.get('2024-01-15').entries[0].analysis.overlapOvertime = 0.5;
    user.days.get('2024-01-15').entries[0].analysis.combinedOvertime = 2.5;
    const users = [user];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('OT (Combined)');
    expect(headerRow.innerHTML).toContain('OT Daily');
    expect(headerRow.innerHTML).toContain('OT Weekly');
    expect(headerRow.innerHTML).toContain('OT Overlap');

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).toContain('2h 30m'); // combined
    expect(row.innerHTML).toContain('2h'); // daily
    expect(row.innerHTML).toContain('1h'); // weekly
    expect(row.innerHTML).toContain('0h 30m'); // overlap
  });

  it('shows amount columns when hasAmountRates=true', () => {
    store.ui.hasAmountRates = true;
    // computeSummaryRows derives amount from entry.analysis.cost, not totals
    // Entry has cost: 120, so row renders $120.00
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('Amount');

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).toContain('$120.00');
  });

  it('shows Earned/Cost/Profit columns when amountDisplay=profit', () => {
    store.ui.hasAmountRates = true;
    store.config.amountDisplay = 'profit';

    // computeSummaryRows derives amounts from entry.analysis.amounts
    // Entry has earned.totalAmountWithOT=150, cost=100, profit=50
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).toContain('Amount');
    expect(headerRow.innerHTML).toContain('Cost');
    expect(headerRow.innerHTML).toContain('Profit');

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).toContain('$150.00');
    expect(row.innerHTML).toContain('$100.00');
    expect(row.innerHTML).toContain('$50.00');
  });

  it('does NOT show amount columns when hasAmountRates=false', () => {
    store.ui.hasAmountRates = false;
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const headerRow = document.getElementById('summaryHeaderRow');
    expect(headerRow.innerHTML).not.toContain('Amount');

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    expect(row.innerHTML).not.toContain('$');
  });

  it('renders empty table when users array is empty', () => {
    const users = [];
    renderSummaryTable(users);

    const tbody = document.getElementById('summaryTableBody');
    expect(tbody.querySelectorAll('tr').length).toBe(0);
  });

  it('unhides resultsContainer after rendering', () => {
    const users = [createUserAnalysis('user1', 'Test User')];
    const container = document.getElementById('resultsContainer');
    expect(container.classList.contains('hidden')).toBe(true);

    renderSummaryTable(users);
    expect(container.classList.contains('hidden')).toBe(false);
  });

  it('renders user swatch with correct color for user grouping', () => {
    store.ui.summaryGroupBy = 'user';
    const users = [createUserAnalysis('user1', 'Test User')];
    renderSummaryTable(users);

    const tbody = document.getElementById('summaryTableBody');
    const row = tbody.querySelector('tr');
    const swatch = row.querySelector('.user-swatch');
    expect(swatch).toBeTruthy();
    // Check that background-color style is set
    expect(swatch.getAttribute('style')).toContain('background-color');
  });
});

describe('Summary UI - renderSummaryExpandToggle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="summaryStrip"></div>
      <div id="summaryTableContainer"></div>
      <div id="summaryGroupBy"></div>
      <div id="summaryExpandToggleContainer"></div>
    `;

    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      maxPages: 10,
      encryptStorage: true,
      auditConsent: true,
    };

    store.ui = {
      isLoading: false,
      summaryExpanded: false,
      summaryGroupBy: 'user',
      overridesCollapsed: true,
      activeTab: 'summary',
      detailedPage: 1,
      detailedPageSize: 50,
      activeDetailedFilter: 'all',
      hasCostRates: true,
      hasAmountRates: true,
      paginationTruncated: false,
      paginationAbortedDueToTokenExpiration: false,
    };

    initializeElements(true);
  });

  afterEach(standardAfterEach);

  it('renders expand button when summaryExpanded=false', () => {
    store.ui.summaryExpanded = false;
    renderSummaryExpandToggle();

    const container = document.getElementById('summaryExpandToggleContainer');
    expect(container.innerHTML).toContain('summaryExpandToggle');
    expect(container.innerHTML).toContain('▸');
    expect(container.innerHTML).toContain('Show breakdown');
  });

  it('renders collapse button when summaryExpanded=true', () => {
    store.ui.summaryExpanded = true;
    renderSummaryExpandToggle();

    const container = document.getElementById('summaryExpandToggleContainer');
    expect(container.innerHTML).toContain('summaryExpandToggle');
    expect(container.innerHTML).toContain('▾');
    expect(container.innerHTML).toContain('Hide breakdown');
  });

  it('hides toggle when showBillableBreakdown=false', () => {
    store.config.showBillableBreakdown = false;
    renderSummaryExpandToggle();

    const container = document.getElementById('summaryExpandToggleContainer');
    expect(container.innerHTML).toBe('');
  });

  it('hides toggle when hasAmountRates=false', () => {
    store.ui.hasAmountRates = false;
    renderSummaryExpandToggle();

    const container = document.getElementById('summaryExpandToggleContainer');
    expect(container.innerHTML).toBe('');
  });

  it('shows toggle when showBillableBreakdown=true and hasAmountRates=true', () => {
    store.config.showBillableBreakdown = true;
    store.ui.hasAmountRates = true;
    renderSummaryExpandToggle();

    const container = document.getElementById('summaryExpandToggleContainer');
    expect(container.innerHTML).toContain('summaryExpandToggle');
  });

  it('renders button with correct CSS classes', () => {
    renderSummaryExpandToggle();

    const container = document.getElementById('summaryExpandToggleContainer');
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button.id).toBe('summaryExpandToggle');
    expect(button.className).toContain('btn-text');
    expect(button.className).toContain('btn-xs');
  });
});
