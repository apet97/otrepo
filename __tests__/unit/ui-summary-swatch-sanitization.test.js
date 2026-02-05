/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { store } from '../../js/state.js';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

const maliciousColor = 'red; background-image: url(evil)';

jest.unstable_mockModule('../../js/ui/shared.js', () => ({
  getElements: jest.fn(() => ({
    summaryTableBody: document.getElementById('summaryTableBody'),
    resultsContainer: document.getElementById('resultsContainer')
  })),
  formatHoursDisplay: jest.fn((value) => `${value}h`),
  formatCurrency: jest.fn((value) => `$${value}`),
  escapeHtml: jest.fn((value) => value),
  getAmountDisplayMode: jest.fn(() => 'earned'),
  getAmountLabels: jest.fn(() => ({
    column: 'Amount',
    total: 'Total',
    base: 'Base',
    rate: 'Rate'
  })),
  renderAmountStack: jest.fn(() => ''),
  getSwatchColor: jest.fn(() => maliciousColor)
}));

const { renderSummaryTable } = await import('../../js/ui/summary.js');

describe('Summary swatch sanitization', () => {
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
    store.ui = { ...store.ui, summaryExpanded: true, summaryGroupBy: 'user' };
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

  it('sanitizes swatch color before injecting style attributes', () => {
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

    const swatch = document.querySelector('.user-swatch');
    const style = swatch?.getAttribute('style') || '';

    expect(style).toMatch(/^background-color:\s*#[0-9a-fA-F]{6};?$/);
    expect(style).not.toContain('background-image');
  });
});
