/**
 * @jest-environment jsdom
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { bindEvents, initializeElements } from '../../js/ui/index.js';
import { renderOverridesPage } from '../../js/ui/overrides.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('bindEvents branch coverage', () => {
  let storeSnapshot;

  beforeEach(() => {
    storeSnapshot = {
      users: store.users,
      overrides: store.overrides,
      config: { ...store.config },
      calcParams: { ...store.calcParams },
      profiles: store.profiles,
      holidays: store.holidays,
      timeOff: store.timeOff,
      analysisResults: store.analysisResults,
      ui: { ...store.ui }
    };
  });

  afterEach(() => {
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
  });

  it('handles detailed pagination and status popover interactions', () => {
    document.body.innerHTML = `
      <div id="mainView"></div>
      <div id="overridesPage" class="hidden"></div>
      <div id="overridesUserList"></div>
      <div id="detailedTableContainer">
        <div class="status-header-cell">
          <button class="status-info-btn" type="button">i</button>
        </div>
        <button class="pagination-btn" data-page="2" type="button">2</button>
        <button class="pagination-btn" data-page="bad" type="button">bad</button>
      </div>
    `;
    initializeElements(true);

    store.analysisResults = null;
    store.ui = { ...store.ui, detailedPage: 1 };

    const callbacks = {
      onGenerate: jest.fn(),
      onOverrideChange: jest.fn(),
      onOverrideModeChange: jest.fn(),
      onPerDayOverrideChange: jest.fn(),
      onWeeklyOverrideChange: jest.fn(),
      onCopyFromGlobal: jest.fn(),
      onCopyGlobalToWeekly: jest.fn()
    };

    const cleanup = bindEvents(callbacks);

    const paginationBtn = document.querySelector('.pagination-btn[data-page="2"]');
    paginationBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.ui.detailedPage).toBe(2);

    const invalidBtn = document.querySelector('.pagination-btn[data-page="bad"]');
    invalidBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.ui.detailedPage).toBe(2);

    const statusBtn = document.querySelector('.status-info-btn');
    statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    let popover = document.querySelector('.status-info-popover');
    expect(popover).not.toBeNull();
    expect(popover.classList.contains('hidden')).toBe(false);

    const closeBtn = popover.querySelector('.popover-close');
    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover.classList.contains('hidden')).toBe(true);

    statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover.classList.contains('hidden')).toBe(false);

    statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover.classList.contains('hidden')).toBe(true);

    statusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    popover = document.querySelector('.status-info-popover');
    expect(popover.classList.contains('hidden')).toBe(false);

    const detailedContainer = document.getElementById('detailedTableContainer');
    detailedContainer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popover.classList.contains('hidden')).toBe(true);

    cleanup();
  });

  it('handles override inputs, mode changes, and buttons', () => {
    document.body.innerHTML = `
      <div id="mainView"></div>
      <div id="overridesPage" class="hidden"></div>
      <button id="generateBtn" type="button">Generate</button>
      <button id="openOverridesBtn" type="button">Open Overrides</button>
      <button id="closeOverridesBtn" type="button">Close Overrides</button>
      <div id="overridesUserList"></div>
      <input id="startDate" value="2025-01-15" />
      <input id="endDate" value="2025-01-15" />
    `;
    initializeElements(true);

    store.users = [
      { id: 'user1', name: 'Alice' },
      { id: 'user2', name: 'Bob' }
    ];
    store.overrides = {
      user1: {
        mode: 'perDay',
        capacity: 8,
        multiplier: 1.5,
        perDayOverrides: {
          '2025-01-15': { capacity: 6, multiplier: 1.2 }
        }
      },
      user2: {
        mode: 'weekly',
        capacity: 7,
        weeklyOverrides: {
          MONDAY: { capacity: 5 }
        }
      }
    };
    store.analysisResults = [{ userId: 'user1' }];

    renderOverridesPage();

    const callbacks = {
      onGenerate: jest.fn(),
      onOverrideChange: jest.fn(),
      onOverrideModeChange: jest.fn(),
      onPerDayOverrideChange: jest.fn(),
      onWeeklyOverrideChange: jest.fn(),
      onCopyFromGlobal: jest.fn(),
      onCopyGlobalToWeekly: jest.fn()
    };

    const cleanup = bindEvents(callbacks);

    const generateBtn = document.getElementById('generateBtn');
    generateBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(callbacks.onGenerate).toHaveBeenCalledTimes(1);

    const openOverridesBtn = document.getElementById('openOverridesBtn');
    openOverridesBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('overridesPage').classList.contains('hidden')).toBe(false);

    const closeOverridesBtn = document.getElementById('closeOverridesBtn');
    closeOverridesBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(callbacks.onGenerate).toHaveBeenCalledTimes(2);
    expect(document.getElementById('overridesPage').classList.contains('hidden')).toBe(true);

    const overrideInput = document.querySelector('input.override-input[data-userid="user1"][data-field="capacity"]');
    overrideInput.value = '6';
    overrideInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(callbacks.onOverrideChange).toHaveBeenCalledWith('user1', 'capacity', '6');

    const perDayInput = document.querySelector('input.per-day-input[data-userid="user1"]');
    perDayInput.value = '5';
    perDayInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(callbacks.onPerDayOverrideChange).toHaveBeenCalledWith('user1', '2025-01-15', 'capacity', '5');

    const weeklyInput = document.querySelector('input.weekly-input[data-userid="user2"]');
    weeklyInput.value = '4';
    weeklyInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(callbacks.onWeeklyOverrideChange).toHaveBeenCalledWith('user2', 'MONDAY', 'capacity', '4');

    const modeSelect = document.querySelector('select.mode-select[data-userid="user2"]');
    modeSelect.value = 'global';
    modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(callbacks.onOverrideModeChange).toHaveBeenCalledWith('user2', 'global');

    const header = document.querySelector('.override-user-header');
    const card = header.closest('.override-user-card');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(card.classList.contains('collapsed')).toBe(false);

    card.classList.add('collapsed');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card.classList.contains('collapsed')).toBe(true);

    const copyFromGlobal = document.querySelector('button.copy-from-global-btn');
    copyFromGlobal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(callbacks.onCopyFromGlobal).toHaveBeenCalledWith('user1');

    const copyToWeekly = document.querySelector('button.copy-global-to-weekly-btn');
    copyToWeekly.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(callbacks.onCopyGlobalToWeekly).toHaveBeenCalledWith('user2');

    cleanup();
  });

  it('handles missing optional elements without errors', () => {
    document.body.innerHTML = '<div id="mainView"></div>';
    initializeElements(true);

    const cleanup = bindEvents({
      onGenerate: jest.fn(),
      onOverrideChange: jest.fn(),
      onOverrideModeChange: jest.fn(),
      onPerDayOverrideChange: jest.fn(),
      onWeeklyOverrideChange: jest.fn(),
      onCopyFromGlobal: jest.fn(),
      onCopyGlobalToWeekly: jest.fn()
    });

    cleanup();
  });
});
