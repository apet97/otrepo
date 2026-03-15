/**
 * @jest-environment jsdom
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';

// Mock the downstream renderers so they don't try to process real data
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

// Now import after mocks are set up
const { bindEvents, initializeElements } = await import('../../js/ui/index.js');
const { renderDetailedTable } = await import('../../js/ui/detailed.js');
const { renderSummaryTable } = await import('../../js/ui/summary.js');
const { renderOverridesPage, showOverridesPage, hideOverridesPage } = await import('../../js/ui/overrides.js');
const { store } = await import('../../js/state.js');
const { standardAfterEach } = await import('../helpers/setup.js');

/**
 * Tests targeting uncovered lines in js/ui/index.ts:
 * - createWheelHandler (50-56)
 * - bindDetailedTableEvents pagination with analysisResults (90)
 * - bindSummaryPagination (161-174)
 * - bindOverridesEvents pagination (199-210)
 * - bindOverridesEvents search debounce (217-231)
 * - toggleCardCollapse via click delegation (306-307)
 * - bindKeyboardAccessibility Escape (367-371)
 * - bindKeyboardAccessibility arrow keys (381-396)
 */

/** Build the full DOM structure needed by bindEvents. */
function buildDOM() {
  document.body.innerHTML = `
    <div id="mainView"></div>
    <div id="overridesPage" class="hidden"></div>
    <div id="detailedTableContainer">
      <div class="status-header-cell">
        <button class="status-info-btn" type="button">i</button>
      </div>
      <button class="pagination-btn" data-page="3" type="button">3</button>
    </div>
    <div id="summaryPaginationControls">
      <button class="summary-page-btn" data-summary-page="2" type="button">2</button>
      <button class="summary-page-btn" data-summary-page="bad" type="button">bad</button>
    </div>
    <div id="overridesPaginationControls">
      <button class="overrides-page-btn" data-overrides-page="4" type="button">4</button>
      <button class="overrides-page-btn" data-overrides-page="nope" type="button">nope</button>
    </div>
    <div id="overridesSearchContainer">
      <input id="overridesSearchInput" type="text" />
    </div>
    <div id="overridesUserList">
      <div class="override-user-card">
        <div class="override-user-header" tabindex="0" aria-expanded="true">
          <span class="toggle-icon">\u25BC</span>
          User
        </div>
        <div class="override-body">
          <input class="override-input" data-userid="u1" data-field="capacity" type="number" value="" />
          <input class="per-day-input" data-userid="u1" data-datekey="2025-01-15" data-field="capacity" type="number" value="" />
          <input class="weekly-input" data-userid="u1" data-weekday="MONDAY" data-field="capacity" type="number" value="" />
          <select class="mode-select" data-userid="u1"><option value="global">global</option><option value="perDay">perDay</option></select>
          <button class="copy-from-global-btn" data-userid="u1" type="button">Copy</button>
          <button class="copy-global-to-weekly-btn" data-userid="u1" type="button">Copy Weekly</button>
        </div>
      </div>
    </div>
    <button id="openOverridesBtn" type="button">Open</button>
    <button id="closeOverridesBtn" type="button">Close</button>
    <button id="generateBtn" type="button">Generate</button>
    <div id="detailedFilters">
      <button class="chip" tabindex="0">All</button>
      <button class="chip" tabindex="-1">OT Only</button>
      <button class="chip" tabindex="-1">Regular</button>
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

describe('ui/index.ts full coverage', () => {
  let storeSnapshot;
  let cleanup;

  beforeEach(() => {
    storeSnapshot = {
      users: store.users,
      overrides: { ...store.overrides },
      config: { ...store.config },
      calcParams: { ...store.calcParams },
      profiles: store.profiles,
      holidays: store.holidays,
      timeOff: store.timeOff,
      analysisResults: store.analysisResults,
      ui: { ...store.ui },
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = null;
    standardAfterEach();
    document.body.innerHTML = '';
    store.users = storeSnapshot.users;
    store.overrides = storeSnapshot.overrides;
    store.config = storeSnapshot.config;
    store.calcParams = storeSnapshot.calcParams;
    store.profiles = storeSnapshot.profiles;
    store.holidays = storeSnapshot.holidays;
    store.timeOff = storeSnapshot.timeOff;
    store.analysisResults = storeSnapshot.analysisResults;
    store.ui = storeSnapshot.ui;
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------
  // createWheelHandler (lines 50-56)
  // ---------------------------------------------------------------
  describe('createWheelHandler', () => {
    it('prevents wheel event on focused number input in detailedContainer', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('detailedTableContainer');
      const testInput = document.createElement('input');
      testInput.type = 'number';
      container.appendChild(testInput);
      testInput.focus();

      const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true });
      testInput.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    });

    it('does not prevent wheel on non-number input', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('detailedTableContainer');
      const textInput = document.createElement('input');
      textInput.type = 'text';
      container.appendChild(textInput);
      textInput.focus();

      const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true });
      textInput.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(false);
    });

    it('does not prevent wheel on unfocused number input', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('detailedTableContainer');
      const numInput = document.createElement('input');
      numInput.type = 'number';
      container.appendChild(numInput);
      // NOT focused

      const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true });
      numInput.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(false);
    });

    it('does not prevent wheel on non-input elements', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('detailedTableContainer');
      const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true });
      container.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // bindDetailedTableEvents — pagination with analysisResults (line 90)
  // ---------------------------------------------------------------
  describe('bindDetailedTableEvents pagination', () => {
    it('calls renderDetailedTable when analysisResults is truthy', () => {
      buildDOM();
      initializeElements(true);
      store.analysisResults = [{ userId: 'u1' }];
      store.ui = { ...store.ui, detailedPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const btn = document.querySelector('.pagination-btn[data-page="3"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.detailedPage).toBe(3);
      expect(renderDetailedTable).toHaveBeenCalledWith(store.analysisResults);
    });

    it('does not call renderDetailedTable when analysisResults is null', () => {
      buildDOM();
      initializeElements(true);
      store.analysisResults = null;
      store.ui = { ...store.ui, detailedPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      renderDetailedTable.mockClear();

      const btn = document.querySelector('.pagination-btn[data-page="3"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.detailedPage).toBe(3);
      expect(renderDetailedTable).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // bindSummaryPagination (lines 161-174)
  // ---------------------------------------------------------------
  describe('bindSummaryPagination', () => {
    it('updates summaryPage and calls renderSummaryTable on valid click', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, summaryPage: 1 };
      store.analysisResults = [{ userId: 'u1' }];
      cleanup = bindEvents(makeCallbacks());

      const btn = document.querySelector('.summary-page-btn[data-summary-page="2"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.summaryPage).toBe(2);
      expect(renderSummaryTable).toHaveBeenCalledWith(store.analysisResults);
    });

    it('does not call renderSummaryTable when analysisResults is null', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, summaryPage: 1 };
      store.analysisResults = null;
      cleanup = bindEvents(makeCallbacks());

      renderSummaryTable.mockClear();

      const btn = document.querySelector('.summary-page-btn[data-summary-page="2"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.summaryPage).toBe(2);
      expect(renderSummaryTable).not.toHaveBeenCalled();
    });

    it('ignores NaN page from summary-page-btn', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, summaryPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const btn = document.querySelector('.summary-page-btn[data-summary-page="bad"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.summaryPage).toBe(1);
    });

    it('ignores click on non-summary-page-btn inside container', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, summaryPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('summaryPaginationControls');
      container.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.summaryPage).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // bindOverridesEvents — pagination (lines 199-210)
  // ---------------------------------------------------------------
  describe('bindOverridesEvents pagination', () => {
    it('updates overridesPage and calls renderOverridesPage on valid click', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      renderOverridesPage.mockClear();

      const btn = document.querySelector('.overrides-page-btn[data-overrides-page="4"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.overridesPage).toBe(4);
      expect(renderOverridesPage).toHaveBeenCalled();
    });

    it('ignores NaN overrides-page-btn', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const btn = document.querySelector('.overrides-page-btn[data-overrides-page="nope"]');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.overridesPage).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // bindOverridesEvents — search debounce (lines 217-231)
  // ---------------------------------------------------------------
  describe('bindOverridesEvents search debounce', () => {
    it('debounces search input and updates store after 250ms', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesSearch: '', overridesPage: 5 };
      cleanup = bindEvents(makeCallbacks());

      renderOverridesPage.mockClear();

      const searchInput = document.getElementById('overridesSearchInput');
      searchInput.value = 'Alice';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Before timeout: store should not be updated
      expect(store.ui.overridesSearch).toBe('');

      jest.advanceTimersByTime(250);

      expect(store.ui.overridesSearch).toBe('Alice');
      expect(store.ui.overridesPage).toBe(1);
      expect(renderOverridesPage).toHaveBeenCalled();
    });

    it('resets debounce timer on rapid input', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesSearch: '', overridesPage: 3 };
      cleanup = bindEvents(makeCallbacks());

      const searchInput = document.getElementById('overridesSearchInput');

      searchInput.value = 'Al';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(100);

      searchInput.value = 'Alice';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(100);

      // Still not fired (only 100ms since last input)
      expect(store.ui.overridesSearch).toBe('');

      jest.advanceTimersByTime(150);

      expect(store.ui.overridesSearch).toBe('Alice');
      expect(store.ui.overridesPage).toBe(1);
    });

    it('ignores input events from non-search inputs', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesSearch: '' };
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('overridesSearchContainer');
      const otherInput = document.createElement('input');
      otherInput.id = 'somethingElse';
      container.appendChild(otherInput);

      otherInput.value = 'test';
      otherInput.dispatchEvent(new Event('input', { bubbles: true }));
      jest.advanceTimersByTime(300);

      expect(store.ui.overridesSearch).toBe('');
    });

    it('clears pending timer on cleanup', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesSearch: '', overridesPage: 2 };
      cleanup = bindEvents(makeCallbacks());

      const searchInput = document.getElementById('overridesSearchInput');
      searchInput.value = 'Bob';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Cleanup before timer fires
      cleanup();
      cleanup = null;

      jest.advanceTimersByTime(300);
      expect(store.ui.overridesSearch).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // toggleCardCollapse via click delegation (lines 306-307)
  // ---------------------------------------------------------------
  describe('toggleCardCollapse via click', () => {
    it('collapses card on header click', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const header = document.querySelector('.override-user-header');
      const card = header.closest('.override-user-card');

      expect(card.classList.contains('collapsed')).toBe(false);

      header.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(card.classList.contains('collapsed')).toBe(true);
      expect(header.getAttribute('aria-expanded')).toBe('false');
      expect(header.querySelector('.toggle-icon').textContent).toBe('\u25B6');
    });

    it('expands card on header click when collapsed', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const header = document.querySelector('.override-user-header');
      const card = header.closest('.override-user-card');

      card.classList.add('collapsed');
      header.setAttribute('aria-expanded', 'false');

      header.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(card.classList.contains('collapsed')).toBe(false);
      expect(header.getAttribute('aria-expanded')).toBe('true');
      expect(header.querySelector('.toggle-icon').textContent).toBe('\u25BC');
    });

    it('toggleCardCollapse does nothing when header has no card parent', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      // Create a bare header outside any card
      const overridesUserList = document.getElementById('overridesUserList');
      const orphanHeader = document.createElement('div');
      orphanHeader.classList.add('override-user-header');
      overridesUserList.appendChild(orphanHeader);

      orphanHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // No DOM mutations should have occurred (early return in toggleCardCollapse)
      expect(orphanHeader.getAttribute('aria-expanded')).toBeNull();
      expect(orphanHeader.classList.contains('collapsed')).toBe(false);
    });

    it('toggleCardCollapse works without toggle-icon', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const header = document.querySelector('.override-user-header');
      // Remove the toggle icon
      const icon = header.querySelector('.toggle-icon');
      icon.remove();

      // Should not throw, just toggle collapsed class
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const card = header.closest('.override-user-card');
      expect(card.classList.contains('collapsed')).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // bindKeyboardAccessibility — Escape to close popover (lines 367-371)
  // ---------------------------------------------------------------
  describe('bindKeyboardAccessibility Escape', () => {
    it('closes open popover on Escape key', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      // Create a popover by clicking the status info button
      const statusBtn = document.querySelector('.status-info-btn');
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const popover = document.querySelector('.status-info-popover');
      expect(popover).not.toBeNull();
      expect(popover.classList.contains('hidden')).toBe(false);

      // Press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(popover.classList.contains('hidden')).toBe(true);
    });

    it('does nothing on Escape when no open popover', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      // No popover should exist (none was created)
      expect(document.querySelector('.status-info-popover')).toBeNull();
    });

    it('does nothing on non-Escape key', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const statusBtn = document.querySelector('.status-info-btn');
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const popover = document.querySelector('.status-info-popover');
      expect(popover.classList.contains('hidden')).toBe(false);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(popover.classList.contains('hidden')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // bindKeyboardAccessibility — arrow key navigation (lines 381-396)
  // ---------------------------------------------------------------
  describe('bindKeyboardAccessibility arrow keys', () => {
    it('moves focus right on ArrowRight', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const chips = document.querySelectorAll('#detailedFilters .chip');
      chips[0].focus();

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      chips[0].dispatchEvent(event);

      expect(document.activeElement).toBe(chips[1]);
    });

    it('wraps from last chip to first on ArrowRight', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const chips = document.querySelectorAll('#detailedFilters .chip');
      chips[2].focus();

      chips[2].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );

      expect(document.activeElement).toBe(chips[0]);
    });

    it('moves focus left on ArrowLeft', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const chips = document.querySelectorAll('#detailedFilters .chip');
      chips[1].focus();

      chips[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );

      expect(document.activeElement).toBe(chips[0]);
    });

    it('wraps from first chip to last on ArrowLeft', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const chips = document.querySelectorAll('#detailedFilters .chip');
      chips[0].focus();

      chips[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );

      expect(document.activeElement).toBe(chips[2]);
    });

    it('prevents default on arrow keys', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const chips = document.querySelectorAll('#detailedFilters .chip');
      chips[0].focus();

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      chips[0].dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores non-arrow keys', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const chips = document.querySelectorAll('#detailedFilters .chip');
      chips[0].focus();

      chips[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );

      expect(document.activeElement).toBe(chips[0]);
    });

    it('ignores arrow keys when target is not a chip', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const filterContainer = document.getElementById('detailedFilters');
      const activeBefore = document.activeElement;
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      filterContainer.dispatchEvent(event);

      // Arrow key on non-chip target should be ignored — no focus change, no preventDefault
      expect(document.activeElement).toBe(activeBefore);
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores arrow keys when filter container has no chips', () => {
      buildDOM();
      initializeElements(true);

      // Remove all chips
      const container = document.getElementById('detailedFilters');
      container.innerHTML = '';

      cleanup = bindEvents(makeCallbacks());

      container.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      // Should not throw
    });
  });

  // ---------------------------------------------------------------
  // Wheel handler on overridesUserList
  // ---------------------------------------------------------------
  describe('wheel handler on overridesUserList', () => {
    it('prevents wheel on focused number input in overrides list', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const numInput = document.querySelector('#overridesUserList input[type="number"]');
      numInput.focus();

      const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true });
      numInput.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Override input handlers
  // ---------------------------------------------------------------
  describe('override input handlers', () => {
    it('fires onOverrideChange for override-input', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.overrides = { u1: {} };
      cleanup = bindEvents(callbacks);

      const input = document.querySelector('input.override-input[data-userid="u1"]');
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onOverrideChange).toHaveBeenCalledWith('u1', 'capacity', '10');
    });

    it('adds has-custom class when override has values', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.overrides = { u1: { capacity: 8 } };
      cleanup = bindEvents(callbacks);

      const input = document.querySelector('input.override-input[data-userid="u1"]');
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const card = input.closest('.override-user-card');
      expect(card.classList.contains('has-custom')).toBe(true);
    });

    it('removes has-custom class when override is empty', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.overrides = { u1: {} };
      cleanup = bindEvents(callbacks);

      const input = document.querySelector('input.override-input[data-userid="u1"]');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const card = input.closest('.override-user-card');
      expect(card.classList.contains('has-custom')).toBe(false);
    });

    it('uses empty object fallback when user has no override entry', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.overrides = {};  // no entry for u1 at all
      cleanup = bindEvents(callbacks);

      const input = document.querySelector('input.override-input[data-userid="u1"]');
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onOverrideChange).toHaveBeenCalledWith('u1', 'capacity', '10');
      const card = input.closest('.override-user-card');
      // With no override, has-custom should be false
      expect(card.classList.contains('has-custom')).toBe(false);
    });

    it('fires onPerDayOverrideChange for per-day-input', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const input = document.querySelector('input.per-day-input[data-userid="u1"]');
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onPerDayOverrideChange).toHaveBeenCalledWith('u1', '2025-01-15', 'capacity', '5');
    });

    it('fires onWeeklyOverrideChange for weekly-input', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const input = document.querySelector('input.weekly-input[data-userid="u1"]');
      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onWeeklyOverrideChange).toHaveBeenCalledWith('u1', 'MONDAY', 'capacity', '4');
    });

    it('fires onOverrideModeChange on mode-select change', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      renderOverridesPage.mockClear();

      const select = document.querySelector('select.mode-select[data-userid="u1"]');
      select.value = 'perDay';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(callbacks.onOverrideModeChange).toHaveBeenCalledWith('u1', 'perDay');
      expect(renderOverridesPage).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Copy buttons
  // ---------------------------------------------------------------
  describe('copy buttons', () => {
    it('fires onCopyFromGlobal on click', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      renderOverridesPage.mockClear();

      const btn = document.querySelector('button.copy-from-global-btn');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(callbacks.onCopyFromGlobal).toHaveBeenCalledWith('u1');
      expect(renderOverridesPage).toHaveBeenCalled();
    });

    it('fires onCopyGlobalToWeekly on click', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      renderOverridesPage.mockClear();

      const btn = document.querySelector('button.copy-global-to-weekly-btn');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(callbacks.onCopyGlobalToWeekly).toHaveBeenCalledWith('u1');
      expect(renderOverridesPage).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Open/close overrides and generate button
  // ---------------------------------------------------------------
  describe('open/close overrides and generate', () => {
    it('opens overrides page on button click', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      showOverridesPage.mockClear();

      document.getElementById('openOverridesBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(showOverridesPage).toHaveBeenCalled();
    });

    it('closes overrides page and calls onRecalculate when rawEntries present', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.rawEntries = [{ id: 'e1' }];
      cleanup = bindEvents(callbacks);

      hideOverridesPage.mockClear();

      document.getElementById('closeOverridesBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(hideOverridesPage).toHaveBeenCalled();
      expect(callbacks.onRecalculate).toHaveBeenCalled();
    });

    it('closes overrides page without calling onRecalculate when rawEntries is null', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.rawEntries = null;
      cleanup = bindEvents(callbacks);

      hideOverridesPage.mockClear();

      document.getElementById('closeOverridesBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(hideOverridesPage).toHaveBeenCalled();
      expect(callbacks.onRecalculate).not.toHaveBeenCalled();
    });

    it('calls onGenerate on generateBtn click', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      document.getElementById('generateBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(callbacks.onGenerate).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // Keyboard navigation on override card headers
  // ---------------------------------------------------------------
  describe('keyboard on override card headers', () => {
    it('toggles collapse on Enter key', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const header = document.querySelector('.override-user-header');
      header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const card = header.closest('.override-user-card');
      expect(card.classList.contains('collapsed')).toBe(true);
    });

    it('toggles collapse on Space key', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const header = document.querySelector('.override-user-header');
      header.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      const card = header.closest('.override-user-card');
      expect(card.classList.contains('collapsed')).toBe(true);
    });

    it('ignores Escape key on card headers', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const header = document.querySelector('.override-user-header');
      header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      const card = header.closest('.override-user-card');
      expect(card.classList.contains('collapsed')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // Missing optional elements
  // ---------------------------------------------------------------
  describe('missing optional elements', () => {
    it('works without detailedTableContainer, summaryPagination, overrides elements', () => {
      document.body.innerHTML = '<div id="mainView"></div>';
      initializeElements(true);

      cleanup = bindEvents(makeCallbacks());
      // Should not throw
      cleanup();
      cleanup = null;
    });
  });

  // ---------------------------------------------------------------
  // Status popover — close button and outside click
  // ---------------------------------------------------------------
  describe('status info popover', () => {
    it('popover close button hides popover', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const statusBtn = document.querySelector('.status-info-btn');
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const popover = document.querySelector('.status-info-popover');
      expect(popover.classList.contains('hidden')).toBe(false);

      const closeBtn = popover.querySelector('.popover-close');
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(popover.classList.contains('hidden')).toBe(true);
    });

    it('toggle existing popover visibility', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const statusBtn = document.querySelector('.status-info-btn');

      // Open
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const popover = document.querySelector('.status-info-popover');
      expect(popover.classList.contains('hidden')).toBe(false);

      // Toggle (close)
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(popover.classList.contains('hidden')).toBe(true);

      // Toggle (open again)
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(popover.classList.contains('hidden')).toBe(false);
    });

    it('closes open popover when clicking outside it in container', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const statusBtn = document.querySelector('.status-info-btn');
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const popover = document.querySelector('.status-info-popover');
      expect(popover.classList.contains('hidden')).toBe(false);

      // Click somewhere else in the detailed container
      const container = document.getElementById('detailedTableContainer');
      container.dispatchEvent(new MouseEvent('click', { bubbles: false }));

      expect(popover.classList.contains('hidden')).toBe(true);
    });

    it('does not close popover when clicking inside it', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const statusBtn = document.querySelector('.status-info-btn');
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const popover = document.querySelector('.status-info-popover');
      expect(popover.classList.contains('hidden')).toBe(false);

      const dl = popover.querySelector('dl');
      // Click inside the popover — should not close it
      dl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Popover should still be open (contains check prevents close)
      expect(popover.classList.contains('hidden')).toBe(false);
    });

    it('popover close button hides popover via stopPropagation', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const statusBtn = document.querySelector('.status-info-btn');
      statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const popover = document.querySelector('.status-info-popover');
      const closeBtn = popover.querySelector('.popover-close');

      // The close btn should stopPropagation and add hidden
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: false }));
      expect(popover.classList.contains('hidden')).toBe(true);
    });

    it('handles popover creation when close button is not found', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      // Add a new status-header-cell with its own info button
      const container = document.getElementById('detailedTableContainer');
      const newCell = document.createElement('div');
      newCell.classList.add('status-header-cell');
      const newBtn = document.createElement('button');
      newBtn.classList.add('status-info-btn');
      newCell.appendChild(newBtn);
      container.appendChild(newCell);

      // Override createElement so the popover div's innerHTML produces no .popover-close
      const origCreateElement = document.createElement.bind(document);
      let interceptNext = true;
      jest.spyOn(document, 'createElement').mockImplementation(function (tag, opts) {
        const el = origCreateElement(tag, opts);
        if (tag === 'div' && interceptNext) {
          interceptNext = false;
          // Override innerHTML setter to produce HTML without the close button
          const origDesc = Object.getOwnPropertyDescriptor(
            Element.prototype,
            'innerHTML'
          );
          Object.defineProperty(el, 'innerHTML', {
            set(val) {
              // Strip out the popover-close button
              const modified = val.replace(/<button class="popover-close"[^>]*>[^<]*<\/button>/, '');
              origDesc.set.call(el, modified);
            },
            get() {
              return origDesc.get.call(el);
            },
            configurable: true,
          });
        }
        return el;
      });

      // Click the new status-info-btn to trigger popover creation
      newBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Restore
      document.createElement = origCreateElement;

      // Verify popover was created but without close button
      const popover = newCell.querySelector('.status-info-popover');
      expect(popover).not.toBeNull();
      expect(popover.querySelector('.popover-close')).toBeNull();
    });

    it('clicking status-info-btn closest logic with null headerCell creates no popover', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const detailedContainer = document.getElementById('detailedTableContainer');
      const orphanBtn = document.createElement('button');
      orphanBtn.classList.add('status-info-btn');
      detailedContainer.appendChild(orphanBtn);

      orphanBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // No popover should be created (early return since no headerCell)
      expect(orphanBtn.getAttribute('aria-expanded')).toBeNull();
      expect(detailedContainer.querySelector('.status-info-popover')).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Branch edge cases: missing data attributes
  // ---------------------------------------------------------------
  describe('missing data attributes on inputs', () => {
    it('override-input without userid does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const input = document.createElement('input');
      input.classList.add('override-input');
      input.type = 'number';
      // No data-userid or data-field
      overridesUserList.appendChild(input);

      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onOverrideChange).not.toHaveBeenCalled();
    });

    it('override-input without field does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const input = document.createElement('input');
      input.classList.add('override-input');
      input.type = 'number';
      input.dataset.userid = 'u1';
      // No data-field
      overridesUserList.appendChild(input);

      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onOverrideChange).not.toHaveBeenCalled();
    });

    it('override-input outside card still fires callback but skips card class toggle (line 246)', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      store.overrides = { u1: { capacity: 8 } };
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      // Create an override-input that is NOT inside an .override-user-card
      const wrapper = document.createElement('div');
      const input = document.createElement('input');
      input.classList.add('override-input');
      input.type = 'number';
      input.dataset.userid = 'u1';
      input.dataset.field = 'capacity';
      wrapper.appendChild(input);
      overridesUserList.appendChild(wrapper);

      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onOverrideChange).toHaveBeenCalledWith('u1', 'capacity', '10');
      // Card toggle skipped because closest('.override-user-card') returns null
    });

    it('per-day-input without datekey does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const input = document.createElement('input');
      input.classList.add('per-day-input');
      input.type = 'number';
      input.dataset.userid = 'u1';
      input.dataset.field = 'capacity';
      // No data-datekey
      overridesUserList.appendChild(input);

      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onPerDayOverrideChange).not.toHaveBeenCalled();
    });

    it('weekly-input without weekday does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const input = document.createElement('input');
      input.classList.add('weekly-input');
      input.type = 'number';
      input.dataset.userid = 'u1';
      input.dataset.field = 'capacity';
      // No data-weekday
      overridesUserList.appendChild(input);

      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onWeeklyOverrideChange).not.toHaveBeenCalled();
    });

    it('mode-select without userid does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const select = document.createElement('select');
      select.classList.add('mode-select');
      // No data-userid
      overridesUserList.appendChild(select);

      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(callbacks.onOverrideModeChange).not.toHaveBeenCalled();
    });

    it('copy-from-global-btn without userid does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const btn = document.createElement('button');
      btn.classList.add('copy-from-global-btn');
      // No data-userid
      overridesUserList.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(callbacks.onCopyFromGlobal).not.toHaveBeenCalled();
    });

    it('copy-global-to-weekly-btn without userid does not fire callback', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const btn = document.createElement('button');
      btn.classList.add('copy-global-to-weekly-btn');
      // No data-userid
      overridesUserList.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(callbacks.onCopyGlobalToWeekly).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Branch edge cases: keydown on non-header target
  // ---------------------------------------------------------------
  describe('keydown handler on non-header target', () => {
    it('Enter/Space on non-header element inside overridesUserList does nothing', () => {
      buildDOM();
      initializeElements(true);
      cleanup = bindEvents(makeCallbacks());

      const overridesUserList = document.getElementById('overridesUserList');
      const randomDiv = document.createElement('div');
      overridesUserList.appendChild(randomDiv);

      // Should not throw
      randomDiv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      randomDiv.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
  });

  // ---------------------------------------------------------------
  // Branch edge cases: pagination with empty/missing data-page
  // ---------------------------------------------------------------
  describe('pagination with empty data-page', () => {
    it('detailed pagination btn without data-page is NaN', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, detailedPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('detailedTableContainer');
      const btn = document.createElement('button');
      btn.classList.add('pagination-btn');
      // No data-page attribute
      container.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.ui.detailedPage).toBe(1);
    });

    it('summary pagination btn without data-summary-page attribute', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, summaryPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('summaryPaginationControls');
      const btn = document.createElement('button');
      btn.classList.add('summary-page-btn');
      // No data-summary-page attribute — parseInt('', 10) = NaN
      container.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.ui.summaryPage).toBe(1);
    });

    it('overrides pagination btn without data-overrides-page attribute', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('overridesPaginationControls');
      const btn = document.createElement('button');
      btn.classList.add('overrides-page-btn');
      // No data-overrides-page attribute
      container.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(store.ui.overridesPage).toBe(1);
    });

    it('click on non-overrides-page-btn inside overrides pagination container', () => {
      buildDOM();
      initializeElements(true);
      store.ui = { ...store.ui, overridesPage: 1 };
      cleanup = bindEvents(makeCallbacks());

      const container = document.getElementById('overridesPaginationControls');
      container.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(store.ui.overridesPage).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // Branch: non-matching events on overridesUserList
  // ---------------------------------------------------------------
  describe('non-matching events on overridesUserList', () => {
    it('input event on non-matching element does nothing', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const div = document.createElement('div');
      overridesUserList.appendChild(div);

      div.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbacks.onOverrideChange).not.toHaveBeenCalled();
      expect(callbacks.onPerDayOverrideChange).not.toHaveBeenCalled();
      expect(callbacks.onWeeklyOverrideChange).not.toHaveBeenCalled();
    });

    it('change event on non-matching element does nothing', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const input = document.createElement('input');
      overridesUserList.appendChild(input);

      input.dispatchEvent(new Event('change', { bubbles: true }));

      expect(callbacks.onOverrideModeChange).not.toHaveBeenCalled();
    });

    it('click on non-matching element in overridesUserList does nothing', () => {
      buildDOM();
      initializeElements(true);
      const callbacks = makeCallbacks();
      cleanup = bindEvents(callbacks);

      const overridesUserList = document.getElementById('overridesUserList');
      const span = document.createElement('span');
      overridesUserList.appendChild(span);

      span.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(callbacks.onCopyFromGlobal).not.toHaveBeenCalled();
      expect(callbacks.onCopyGlobalToWeekly).not.toHaveBeenCalled();
    });
  });
});
