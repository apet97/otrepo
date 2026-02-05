/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { showOverridesPage, hideOverridesPage, renderOverridesPage } from '../../js/ui/overrides.js';
import { initializeElements } from '../../js/ui/shared.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Overrides UI', () => {
  let storeSnapshot;

  beforeEach(() => {
    storeSnapshot = {
      users: store.users,
      overrides: store.overrides,
      profiles: store.profiles,
      config: { ...store.config }
    };

    document.body.innerHTML = `
      <div id="mainView"></div>
      <div id="overridesPage" class="hidden"></div>
      <button id="openOverridesBtn"></button>
      <button id="closeOverridesBtn"></button>
      <div id="overridesUserList"></div>
      <input id="startDate" />
      <input id="endDate" />
    `;
    initializeElements(true);
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
    store.users = storeSnapshot.users;
    store.overrides = storeSnapshot.overrides;
    store.profiles = storeSnapshot.profiles;
    store.config = storeSnapshot.config;
  });

  it('toggles overrides page visibility', () => {
    const mainView = document.getElementById('mainView');
    const overridesPage = document.getElementById('overridesPage');

    showOverridesPage();
    expect(mainView?.classList.contains('hidden')).toBe(true);
    expect(overridesPage?.classList.contains('hidden')).toBe(false);

    hideOverridesPage();
    expect(mainView?.classList.contains('hidden')).toBe(false);
    expect(overridesPage?.classList.contains('hidden')).toBe(true);
  });

  it('renders per-day overrides with date range and input constraints', () => {
    store.users = [{ id: 'user1', name: 'Alice' }];
    store.overrides = {
      user1: {
        mode: 'perDay',
        capacity: 8,
        perDayOverrides: {
          '2025-01-15': { capacity: 6 }
        }
      }
    };

    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    startDate.value = '2025-01-15';
    endDate.value = '2025-01-15';

    renderOverridesPage();

    const container = document.getElementById('overridesUserList');
    expect(container?.innerHTML).toContain('2025-01-15');

    const capacityInput = container?.querySelector('input.override-input[data-field="capacity"]');
    expect(capacityInput?.getAttribute('min')).toBe('0');
    expect(capacityInput?.getAttribute('max')).toBe('24');
  });

  it('escapes override values in copy-from-global text', () => {
    store.users = [{ id: 'user1', name: 'Alice' }];
    store.overrides = {
      user1: {
        mode: 'perDay',
        capacity: '<img src=x onerror=alert(1)>',
        multiplier: 1.5,
        perDayOverrides: {}
      }
    };

    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    startDate.value = '2025-01-15';
    endDate.value = '2025-01-15';

    renderOverridesPage();

    const container = document.getElementById('overridesUserList');
    expect(container?.querySelector('img')).toBeNull();
    expect(container?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
