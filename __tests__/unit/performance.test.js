/**
 * @jest-environment jsdom
 */

/**
 * Performance-sensitive behavior tests
 *
 * These tests validate behavior that protects performance and memory,
 * without relying on timing-based assertions.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderSummaryTable } from '../../js/ui/summary.js';
import { renderOverridesPage } from '../../js/ui/overrides.js';
import { initializeElements } from '../../js/ui/shared.js';
import { store } from '../../js/state.js';
import { STORAGE_KEYS } from '../../js/constants.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Performance-sensitive behaviors', () => {
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
      <div id="resultsContainer" class="hidden"></div>
      <div id="summaryStrip"></div>
      <table>
        <thead><tr id="summaryHeaderRow"></tr></thead>
        <tbody id="summaryTableBody"></tbody>
      </table>
      <div id="mainView"></div>
      <div id="overridesPage" class="hidden"></div>
      <div id="overridesUserList"></div>
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
    store.ui = { ...store.ui, summaryGroupBy: 'user', summaryExpanded: false };
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

  it('renders summary rows using a DocumentFragment', () => {
    const fragmentSpy = jest.spyOn(document, 'createDocumentFragment');

    renderSummaryTable(mockStore.analysisResults);

    expect(fragmentSpy).toHaveBeenCalledTimes(1);
    const rows = document.querySelectorAll('#summaryTableBody tr');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('renders overrides list using a DocumentFragment', () => {
    const fragmentSpy = jest.spyOn(document, 'createDocumentFragment');

    renderOverridesPage();

    expect(fragmentSpy).toHaveBeenCalledTimes(1);
    const cards = document.querySelectorAll('.override-user-card');
    expect(cards.length).toBe(1);
  });

  it('stores report cache in sessionStorage (not localStorage)', () => {
    const originalSessionStorage = global.sessionStorage;
    const originalLocalStorage = global.localStorage;
    const sessionSetItem = jest.fn();
    const localSetItem = jest.fn();

    Object.defineProperty(global, 'sessionStorage', {
      value: { setItem: sessionSetItem, getItem: jest.fn(), removeItem: jest.fn() },
      configurable: true
    });
    Object.defineProperty(global, 'localStorage', {
      value: { setItem: localSetItem, getItem: jest.fn(), removeItem: jest.fn() },
      configurable: true
    });

    store.setCachedReport('report_key_test', [{ id: 'entry1' }]);

    expect(sessionSetItem).toHaveBeenCalledWith(STORAGE_KEYS.REPORT_CACHE, expect.any(String));
    expect(localSetItem).not.toHaveBeenCalled();

    Object.defineProperty(global, 'sessionStorage', {
      value: originalSessionStorage,
      configurable: true
    });
    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      configurable: true
    });
  });
});
