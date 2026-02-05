/**
 * @jest-environment jsdom
 */

import { jest, afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { renderDetailedTable } from '../../js/ui/detailed.js';
import { renderOverridesPage } from '../../js/ui/overrides.js';
import { bindEvents, initializeElements } from '../../js/ui/index.js';
import { calculateAnalysis } from '../../js/calc.js';
import { store } from '../../js/state.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Accessibility - real UI output', () => {
  let storeSnapshot;
  let mockStore;

  beforeEach(() => {
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
      <div id="mainView"></div>
      <div id="overridesPage" class="hidden"></div>
      <div id="overridesUserList"></div>
      <div id="detailedFilters">
        <button class="chip" data-filter="all">All</button>
        <button class="chip" data-filter="holiday">Holidays</button>
        <button class="chip" data-filter="offday">Off-days</button>
        <button class="chip" data-filter="billable">Billable</button>
      </div>
      <div id="detailedCard" class="hidden"></div>
      <div id="detailedTableContainer"></div>
      <input id="startDate" type="date" value="2025-01-13" />
      <input id="endDate" type="date" value="2025-01-17" />
    `;

    initializeElements(true);

    mockStore = createMockStore({
      users: [{ id: 'user1', name: 'Alice' }]
    });

    store.users = mockStore.users;
    store.config = mockStore.config;
    store.calcParams = mockStore.calcParams;
    store.profiles = mockStore.profiles;
    store.holidays = mockStore.holidays;
    store.timeOff = mockStore.timeOff;
    store.overrides = mockStore.overrides;
    store.ui = {
      ...store.ui,
      detailedPage: 1,
      detailedPageSize: 50,
      activeDetailedFilter: 'all'
    };
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

  // Helper to create a basic analysis result for detailed table tests
  function createBasicAnalysis() {
    const entries = [
      {
        id: 'entry_1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    return calculateAnalysis(entries, mockStore, {
      start: '2025-01-01',
      end: '2025-01-31'
    });
  }

  it('renders the status info button with an aria-label', () => {
    const analysis = createBasicAnalysis();
    renderDetailedTable(analysis);

    const infoButton = document.querySelector('.status-info-btn');
    expect(infoButton).not.toBeNull();
    expect(infoButton?.getAttribute('aria-label')).toBe('Status badge explanations');
  });

  it('detailed table has aria-label="Detailed time entries"', () => {
    const analysis = createBasicAnalysis();
    renderDetailedTable(analysis);

    const table = document.querySelector('.report-table');
    expect(table).not.toBeNull();
    expect(table?.getAttribute('aria-label')).toBe('Detailed time entries');
  });

  it('filter chips have aria-selected attribute based on active state', () => {
    const analysis = createBasicAnalysis();
    renderDetailedTable(analysis, 'all');

    const chips = document.querySelectorAll('#detailedFilters .chip');
    expect(chips.length).toBe(4);

    const allChip = document.querySelector('#detailedFilters .chip[data-filter="all"]');
    const holidayChip = document.querySelector('#detailedFilters .chip[data-filter="holiday"]');
    const offDayChip = document.querySelector('#detailedFilters .chip[data-filter="offday"]');
    const billableChip = document.querySelector('#detailedFilters .chip[data-filter="billable"]');

    expect(allChip?.getAttribute('aria-selected')).toBe('true');
    expect(holidayChip?.getAttribute('aria-selected')).toBe('false');
    expect(offDayChip?.getAttribute('aria-selected')).toBe('false');
    expect(billableChip?.getAttribute('aria-selected')).toBe('false');
  });

  it('filter chips update aria-selected when filter changes', () => {
    const analysis = createBasicAnalysis();

    // First render with 'all' filter
    renderDetailedTable(analysis, 'all');
    let allChip = document.querySelector('#detailedFilters .chip[data-filter="all"]');
    expect(allChip?.getAttribute('aria-selected')).toBe('true');

    // Re-render with 'billable' filter
    renderDetailedTable(analysis, 'billable');
    allChip = document.querySelector('#detailedFilters .chip[data-filter="all"]');
    const billableChip = document.querySelector('#detailedFilters .chip[data-filter="billable"]');
    expect(allChip?.getAttribute('aria-selected')).toBe('false');
    expect(billableChip?.getAttribute('aria-selected')).toBe('true');
  });

  it('per-day table headers have scope="col"', () => {
    // Set up user with perDay mode override
    store.overrides = {
      user1: { mode: 'perDay', perDayOverrides: {} }
    };

    renderOverridesPage();

    const perDayHeaders = document.querySelectorAll('.per-day-table thead th');
    expect(perDayHeaders.length).toBeGreaterThan(0);

    perDayHeaders.forEach((th) => {
      expect(th.getAttribute('scope')).toBe('col');
    });
  });

  it('weekly table headers have scope="col"', () => {
    // Set up user with weekly mode override
    store.overrides = {
      user1: { mode: 'weekly', weeklyOverrides: {} }
    };

    renderOverridesPage();

    const weeklyHeaders = document.querySelectorAll('.weekly-table thead th');
    expect(weeklyHeaders.length).toBeGreaterThan(0);

    weeklyHeaders.forEach((th) => {
      expect(th.getAttribute('scope')).toBe('col');
    });
  });

  it('renders override inputs with aria-labels and a toggleable header', () => {
    renderOverridesPage();

    const header = document.querySelector('.override-user-header');
    const modeSelect = document.querySelector('select.mode-select');
    const capacityInput = document.querySelector('input[data-field="capacity"]');
    const multiplierInput = document.querySelector('input[data-field="multiplier"]');

    expect(header?.getAttribute('role')).toBe('button');
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    expect(modeSelect?.getAttribute('aria-label')).toContain('Override mode');
    expect(capacityInput?.getAttribute('aria-label')).toContain('Capacity override');
    expect(multiplierInput?.getAttribute('aria-label')).toContain('Overtime multiplier');
  });

  it('toggles aria-expanded when the override header is clicked', () => {
    renderOverridesPage();

    const callbacks = {
      onGenerate: jest.fn(),
      onOverrideChange: jest.fn(),
      onPerDayOverrideChange: jest.fn(),
      onWeeklyOverrideChange: jest.fn(),
      onOverrideModeChange: jest.fn(),
      onCopyFromGlobal: jest.fn(),
      onCopyGlobalToWeekly: jest.fn()
    };

    bindEvents(callbacks);

    const header = document.querySelector('.override-user-header');
    expect(header?.getAttribute('aria-expanded')).toBe('false');

    header?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(header?.getAttribute('aria-expanded')).toBe('true');
  });
});
