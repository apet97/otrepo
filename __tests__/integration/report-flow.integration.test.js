/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { store } from '../../js/state.js';
import { initializeElements, renderSummaryTable } from '../../js/ui/index.js';

function buildDOM() {
  document.body.innerHTML = `
    <div id="resultsContainer" class="hidden"></div>
    <div id="summaryStrip"></div>
    <table>
      <thead>
        <tr id="summaryHeaderRow"></tr>
      </thead>
      <tbody id="summaryTableBody"></tbody>
    </table>
    <div id="summaryPaginationControls"></div>
  `;
}

describe('integration: report flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildDOM();
    initializeElements(true);

    store.users = [
      { id: 'user1', name: 'Ada Lovelace' },
      { id: 'user2', name: 'Grace Hopper' },
    ];
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.ui = {
      ...store.ui,
      summaryGroupBy: 'project',
      summaryExpanded: true,
      summaryPage: 1,
      summaryPageSize: 100,
      hasAmountRates: true,
      hasCostRates: true,
    };
    store.config = {
      ...store.config,
      showBillableBreakdown: true,
      overtimeBasis: 'both',
      amountDisplay: 'earned',
      applyHolidays: false,
      applyTimeOff: false,
      useProfileCapacity: false,
      useProfileWorkingDays: false,
    };
    store.calcParams = {
      ...store.calcParams,
      dailyThreshold: 8,
      overtimeMultiplier: 1.5,
    };
  });

  it('renders grouped project rows with expanded billable and overtime columns', () => {
    const entries = [
      {
        id: 'entry1',
        userId: 'user1',
        userName: 'Ada Lovelace',
        projectId: 'project-b',
        projectName: 'Project Beta',
        clientId: 'client-b',
        clientName: 'Client B',
        taskId: 'task-review',
        taskName: 'Review',
        billable: false,
        hourlyRate: { amount: 5000 },
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H',
        },
      },
      {
        id: 'entry2',
        userId: 'user1',
        userName: 'Ada Lovelace',
        projectId: 'project-a',
        projectName: 'Project Alpha',
        clientId: 'client-a',
        clientName: 'Client A',
        taskId: 'task-build',
        taskName: 'Build',
        billable: true,
        hourlyRate: { amount: 5000 },
        timeInterval: {
          start: '2025-01-01T18:00:00Z',
          end: '2025-01-01T22:00:00Z',
          duration: 'PT4H',
        },
      },
      {
        id: 'entry3',
        userId: 'user2',
        userName: 'Grace Hopper',
        projectId: 'project-a',
        projectName: 'Project Alpha',
        clientId: 'client-a',
        clientName: 'Client A',
        taskId: 'task-build',
        taskName: 'Build',
        billable: true,
        hourlyRate: { amount: 6000 },
        timeInterval: {
          start: '2025-01-02T09:00:00Z',
          end: '2025-01-02T19:00:00Z',
          duration: 'PT10H',
        },
      },
    ];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-02',
    });

    renderSummaryTable(analysis);

    const headerRow = document.getElementById('summaryHeaderRow');
    const summaryBody = document.getElementById('summaryTableBody');
    const rows = [...summaryBody.querySelectorAll('tr')];
    const rowTexts = rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim());
    const projectAlphaCells = [...rows[0].querySelectorAll('td')].map((cell) =>
      cell.textContent.replace(/\s+/g, ' ').trim()
    );

    expect(headerRow.textContent).toContain('Project');
    expect(headerRow.textContent).toContain('Bill. Worked');
    expect(headerRow.textContent).toContain('Bill. OT');
    expect(headerRow.textContent).toContain('OT Daily');
    expect(summaryBody.textContent).toContain('Project Alpha');
    expect(summaryBody.textContent).toContain('Project Beta');
    expect(rowTexts[0]).toContain('Project Alpha');
    expect(rowTexts[1]).toContain('Project Beta');
    expect(projectAlphaCells[1]).toBe('8h');
    expect(projectAlphaCells[2]).toBe('6h');
    expect(projectAlphaCells[7]).toBe('8h');
    expect(projectAlphaCells[8]).toBe('6h');
    expect(projectAlphaCells[10]).toBe('14h');
  });

  it('includes users with zero entries when grouped by user', () => {
    store.ui = {
      ...store.ui,
      summaryGroupBy: 'user',
      summaryExpanded: false,
    };

    const analysis = calculateAnalysis(
      [
        {
          id: 'entry1',
          userId: 'user1',
          userName: 'Ada Lovelace',
          billable: true,
          timeInterval: {
            start: '2025-01-01T09:00:00Z',
            end: '2025-01-01T17:00:00Z',
            duration: 'PT8H',
          },
        },
      ],
      store,
      {
        start: '2025-01-01',
        end: '2025-01-01',
      }
    );

    renderSummaryTable(analysis);

    const rowTexts = [...document.querySelectorAll('#summaryTableBody tr')].map((row) =>
      row.textContent.replace(/\s+/g, ' ').trim()
    );

    expect(rowTexts).toHaveLength(2);
    expect(rowTexts[0]).toContain('Ada Lovelace');
    expect(rowTexts[1]).toContain('Grace Hopper');
    expect(rowTexts[1]).toContain('0h');
  });
});
