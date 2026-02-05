/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderSummaryTable } from '../../js/ui/summary.js';
import { initializeElements } from '../../js/ui/shared.js';
import { store } from '../../js/state.js';
import { calculateAnalysis } from '../../js/calc.js';
import { formatWeekKey, getWeekKey, formatDate } from '../../js/utils.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Summary Table grouping behaviors', () => {
  let storeSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();

    storeSnapshot = {
      users: store.users,
      config: { ...store.config },
      calcParams: { ...store.calcParams },
      profiles: store.profiles,
      holidays: store.holidays,
      timeOff: store.timeOff,
      overrides: store.overrides,
      ui: { ...store.ui }
    };

    document.body.innerHTML = `
      <div id="resultsContainer" class="hidden"></div>
      <div id="summaryCard">
        <table><thead><tr id="summaryHeaderRow"></tr></thead></table>
      </div>
      <div id="summaryTableBody"></div>
    `;
    initializeElements(true);

    const mockStore = createMockStore({
      users: [{ id: 'user1', name: 'Alice' }]
    });
    store.users = mockStore.users;
    store.config = mockStore.config;
    store.calcParams = mockStore.calcParams;
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.ui = { ...store.ui, summaryExpanded: true };
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
    store.users = storeSnapshot.users;
    store.config = storeSnapshot.config;
    store.calcParams = storeSnapshot.calcParams;
    store.profiles = storeSnapshot.profiles;
    store.holidays = storeSnapshot.holidays;
    store.timeOff = storeSnapshot.timeOff;
    store.overrides = storeSnapshot.overrides;
    store.ui = storeSnapshot.ui;
  });

  it('renders project grouping with project label', () => {
    store.ui.summaryGroupBy = 'project';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      projectId: 'proj1',
      projectName: 'Project A',
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Project');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Project A');
  });

  it('uses fallback project label when project fields are missing', () => {
    store.ui.summaryGroupBy = 'project';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('(No Project)');
  });

  it('renders client grouping with client label', () => {
    store.ui.summaryGroupBy = 'client';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      clientId: 'client1',
      clientName: 'Client X',
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Client');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Client X');
  });

  it('uses fallback client label when client fields are missing', () => {
    store.ui.summaryGroupBy = 'client';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('(No Client)');
  });

  it('renders task grouping with task label', () => {
    store.ui.summaryGroupBy = 'task';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      taskId: 'task1',
      taskName: 'Development',
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Task');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Development');
  });

  it('uses fallback task label when task fields are missing', () => {
    store.ui.summaryGroupBy = 'task';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('(No Task)');
  });

  it('renders week grouping with week label', () => {
    store.ui.summaryGroupBy = 'week';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Week');
    const expectedLabel = formatWeekKey(getWeekKey('2025-01-15'));
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain(expectedLabel);
  });

  it('renders date grouping with formatted date label', () => {
    store.ui.summaryGroupBy = 'date';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Date');
    const firstRow = document.querySelector('#summaryTableBody tr');
    const expectedLabel = formatDate('2025-01-15');
    expect(firstRow?.textContent).toContain(expectedLabel);
  });

  it('falls back to user grouping for unknown groupBy values', () => {
    store.ui.summaryGroupBy = 'nonsense';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('User');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Alice');
  });

  it('defaults to user grouping when summaryGroupBy is empty', () => {
    store.ui.summaryGroupBy = '';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('User');
  });

  it('hides billable columns when breakdown is disabled', () => {
    store.config.showBillableBreakdown = false;
    store.ui.summaryGroupBy = 'user';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).not.toContain('Bill.');
  });

  it('hides amount columns when amounts are unavailable', () => {
    store.ui.summaryGroupBy = 'user';
    store.ui.hasAmountRates = false;
    store.config.showBillableBreakdown = true;

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).not.toContain('Amount');
    expect(header.textContent).not.toContain('Cost');
    expect(header.textContent).not.toContain('Profit');
  });

  it('falls back to overtime when combinedOvertime is missing', () => {
    store.ui.summaryGroupBy = 'user';
    store.config.overtimeBasis = 'both';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T19:00:00Z',
        duration: 'PT10H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    const entry = analysis[0].days.get('2025-01-15')?.entries[0];
    if (entry?.analysis) {
      entry.analysis.combinedOvertime = undefined;
    }

    renderSummaryTable(analysis);

    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.innerHTML).toContain('2h');
  });

  it('handles entries missing analysis data', () => {
    store.ui.summaryGroupBy = 'user';

    const analysis = [{
      userId: 'user1',
      userName: 'Alice',
      totals: {
        expectedCapacity: 8,
        regular: 0,
        overtime: 0,
        total: 0,
        breaks: 0,
        billableWorked: 0,
        nonBillableWorked: 0,
        billableOT: 0,
        nonBillableOT: 0,
        amount: 0,
        amountBase: 0,
        amountEarned: 0,
        amountCost: 0,
        amountProfit: 0,
        otPremium: 0,
        otPremiumTier2: 0,
        holidayCount: 0,
        timeOffCount: 0
      },
      days: new Map([
        ['2025-01-15', {
          entries: [{
            id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            timeInterval: {
              start: '2025-01-15T09:00:00Z',
              duration: 'PT1H'
            }
          }],
          meta: {
            capacity: 8,
            isHoliday: false,
            isNonWorking: false,
            isTimeOff: false,
            holidayName: ''
          }
        }]
      ])
    }];

    renderSummaryTable(analysis);

    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow).not.toBeNull();
  });

  it('renders expanded both-mode headers and profit columns with break/PTO totals', () => {
    store.ui.summaryGroupBy = 'user';
    store.ui.summaryExpanded = true;
    store.ui.hasAmountRates = true;
    store.config.showBillableBreakdown = true;
    store.config.overtimeBasis = 'both';
    store.config.amountDisplay = 'profit';

    const entries = [
      {
        id: 'break1',
        userId: 'user1',
        userName: 'Alice',
        type: 'BREAK',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T10:30:00Z',
          duration: 'PT1H30M'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      },
      {
        id: 'pto1',
        userId: 'user1',
        userName: 'Alice',
        type: 'TIME_OFF',
        timeInterval: {
          start: '2025-01-15T11:00:00Z',
          end: '2025-01-15T13:15:00Z',
          duration: 'PT2H15M'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      },
      {
        id: 'work1',
        userId: 'user1',
        userName: 'Alice',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T14:00:00Z',
          end: '2025-01-15T18:00:00Z',
          duration: 'PT4H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-15',
      end: '2025-01-15'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('OT Daily');
    expect(header.textContent).toContain('OT Weekly');
    expect(header.textContent).toContain('OT Overlap');
    expect(header.textContent).toContain('Bill. Worked');
    expect(header.textContent).toContain('Bill. OT');
    expect(header.textContent).toContain('Non-Bill OT');
    expect(header.textContent).toContain('Amount');
    expect(header.textContent).toContain('Cost');
    expect(header.textContent).toContain('Profit');

    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.innerHTML).toContain('1h 30m');
    expect(firstRow?.innerHTML).toContain('2h 15m');
  });
});
