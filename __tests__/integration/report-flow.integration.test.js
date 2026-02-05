/**
 * @jest-environment jsdom
 */

import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { store } from '../../js/state.js';
import { calculateAnalysis } from '../../js/calc.js';
import { initializeElements, renderSummaryTable } from '../../js/ui/index.js';

describe('integration: report flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="resultsContainer" class="hidden"></div>
      <div id="summaryStrip"></div>
      <table>
        <thead>
          <tr id="summaryHeaderRow"></tr>
        </thead>
        <tbody id="summaryTableBody"></tbody>
      </table>
    `;

    initializeElements(true);

    store.users = [{ id: 'user1', name: 'Ada Lovelace' }];
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
  });

  it('renders summary rows for calculated users', () => {
    const entries = [
      {
        id: 'entry1',
        userId: 'user1',
        userName: 'Ada Lovelace',
        billable: true,
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H'
        }
      }
    ];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-01'
    });

    renderSummaryTable(analysis);

    const summaryBody = document.getElementById('summaryTableBody');
    expect(summaryBody).not.toBeNull();
    expect(summaryBody.textContent).toContain('Ada Lovelace');
  });
});
