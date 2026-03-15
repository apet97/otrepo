/**
 * @jest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../js/ui/detailed.js', () => ({
  renderDetailedTable: jest.fn(),
  destroyDetailedObserver: jest.fn(),
  getCachedDetailedEntries: jest.fn(() => []),
  invalidateDetailedCache: jest.fn(),
}));

jest.unstable_mockModule('../../js/ui/summary.js', () => ({
  renderSummaryStrip: jest.fn(),
  renderSummaryExpandToggle: jest.fn(),
  renderSummaryTable: jest.fn(),
  computeSummaryRows: jest.fn(() => []),
}));

jest.unstable_mockModule('../../js/ui/overrides.js', () => ({
  showOverridesPage: jest.fn(),
  hideOverridesPage: jest.fn(),
  renderOverridesPage: jest.fn(),
}));

const { bindEvents, initializeElements } = await import('../../js/ui/index.js');
const { renderDetailedTable } = await import('../../js/ui/detailed.js');
const { renderSummaryTable } = await import('../../js/ui/summary.js');
const { renderOverridesPage, hideOverridesPage } = await import('../../js/ui/overrides.js');
const { store } = await import('../../js/state.js');
const { standardAfterEach } = await import('../helpers/setup.js');

function buildDOM() {
  document.body.innerHTML = `
    <div id="mainView"></div>
    <div id="overridesPage" class="hidden"></div>
    <div id="detailedTableContainer">
      <div class="status-header-cell">
        <button class="status-info-btn" type="button">Status help</button>
      </div>
      <button class="pagination-btn" data-page="3" type="button">3</button>
    </div>
    <div id="summaryPaginationControls">
      <button class="summary-page-btn" data-summary-page="2" type="button">2</button>
    </div>
    <div id="overridesSearchContainer">
      <input id="overridesSearchInput" type="text" />
    </div>
    <div id="overridesUserList"></div>
    <button id="openOverridesBtn" type="button">Open</button>
    <button id="closeOverridesBtn" type="button">Close</button>
    <button id="generateBtn" type="button">Generate</button>
    <div id="detailedFilters">
      <button class="chip" type="button">All</button>
      <button class="chip" type="button">OT Only</button>
      <button class="chip" type="button">Regular</button>
    </div>
  `;
}

function makeCallbacks() {
  return {
    onGenerate: jest.fn(),
    onRecalculate: jest.fn(),
    onOverrideChange: jest.fn(),
    onOverrideModeChange: jest.fn(),
    onPerDayOverrideChange: jest.fn(),
    onWeeklyOverrideChange: jest.fn(),
    onCopyFromGlobal: jest.fn(),
    onCopyGlobalToWeekly: jest.fn(),
  };
}

describe('ui/index bindEvents', () => {
  let cleanup;
  let storeSnapshot;

  beforeEach(() => {
    storeSnapshot = {
      analysisResults: store.analysisResults,
      overrides: store.overrides,
      ui: { ...store.ui },
    };
    jest.useFakeTimers();
    buildDOM();
    initializeElements(true);
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    standardAfterEach();
    document.body.innerHTML = '';
    store.analysisResults = storeSnapshot.analysisResults;
    store.overrides = storeSnapshot.overrides;
    store.ui = storeSnapshot.ui;
    jest.useRealTimers();
  });

  it('rerenders the current analysis when table pagination buttons are clicked', () => {
    const callbacks = makeCallbacks();
    const analysis = [{ userId: 'u1' }];
    store.analysisResults = analysis;
    store.ui = { ...store.ui, detailedPage: 1, summaryPage: 1 };

    cleanup = bindEvents(callbacks);

    document
      .querySelector('.pagination-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document
      .querySelector('.summary-page-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(store.ui.detailedPage).toBe(3);
    expect(store.ui.summaryPage).toBe(2);
    expect(renderDetailedTable).toHaveBeenCalledWith(analysis);
    expect(renderSummaryTable).toHaveBeenCalledWith(analysis);
  });

  it('debounces override search, resets pagination, and rerenders when the search settles', () => {
    cleanup = bindEvents(makeCallbacks());
    store.ui = { ...store.ui, overridesSearch: '', overridesPage: 4 };

    const searchInput = document.getElementById('overridesSearchInput');
    searchInput.value = 'Alice';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    jest.advanceTimersByTime(249);
    expect(store.ui.overridesSearch).toBe('');
    expect(renderOverridesPage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(store.ui.overridesSearch).toBe('Alice');
    expect(store.ui.overridesPage).toBe(1);
    expect(renderOverridesPage).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending search update when bindEvents cleanup runs', () => {
    cleanup = bindEvents(makeCallbacks());
    store.ui = { ...store.ui, overridesSearch: '', overridesPage: 2 };

    const searchInput = document.getElementById('overridesSearchInput');
    searchInput.value = 'Bob';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    cleanup();
    cleanup = null;
    jest.advanceTimersByTime(300);

    expect(store.ui.overridesSearch).toBe('');
    expect(renderOverridesPage).not.toHaveBeenCalled();
  });

  it('opens the status popover and closes it on Escape', () => {
    cleanup = bindEvents(makeCallbacks());

    document
      .querySelector('.status-info-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const popover = document.querySelector('.status-info-popover');
    expect(popover).not.toBeNull();
    expect(popover.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover.classList.contains('hidden')).toBe(true);
  });

  it('moves focus and activates the next filter chip on arrow-key navigation', () => {
    cleanup = bindEvents(makeCallbacks());

    const chips = [...document.querySelectorAll('#detailedFilters .chip')];
    const activated = [];
    chips.forEach((chip) =>
      chip.addEventListener('click', () => {
        activated.push(chip.textContent);
      })
    );

    chips[0].focus();
    chips[0].dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      })
    );

    expect(document.activeElement).toBe(chips[1]);
    expect(activated).toEqual(['OT Only']);
  });

  it('recalculates when closing overrides after rawEntries exist', () => {
    const callbacks = makeCallbacks();
    store.rawEntries = [{ id: 'e1' }];

    cleanup = bindEvents(callbacks);

    document
      .getElementById('closeOverridesBtn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(hideOverridesPage).toHaveBeenCalledTimes(1);
    expect(callbacks.onRecalculate).toHaveBeenCalledTimes(1);
    expect(callbacks.onGenerate).not.toHaveBeenCalled();
  });
});
