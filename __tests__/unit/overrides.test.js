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
      <div id="overridesSearchContainer"></div>
      <div id="overridesUserList"></div>
      <div id="overridesPaginationControls"></div>
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

  describe('Overrides Pagination (Phase 3.4)', () => {
    function makeUsers(count) {
      return Array.from({ length: count }, (_, i) => ({
        id: `user${i}`,
        name: `User ${String(i).padStart(3, '0')}`
      }));
    }

    it('renders only pageSize cards when users exceed pageSize', () => {
      store.users = makeUsers(120);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 1;

      renderOverridesPage();

      const container = document.getElementById('overridesUserList');
      const cards = container?.querySelectorAll('.override-user-card');
      expect(cards?.length).toBe(50);
    });

    it('renders remaining cards on last page', () => {
      store.users = makeUsers(120);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 3; // 120 / 50 = 3 pages, last page has 20

      renderOverridesPage();

      const container = document.getElementById('overridesUserList');
      const cards = container?.querySelectorAll('.override-user-card');
      expect(cards?.length).toBe(20);
    });

    it('shows pagination controls when totalPages > 1', () => {
      store.users = makeUsers(120);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 1;

      renderOverridesPage();

      const pagination = document.getElementById('overridesPaginationControls');
      expect(pagination?.innerHTML).toContain('Page 1 of 3');
      const buttons = pagination?.querySelectorAll('.overrides-page-btn');
      expect(buttons?.length).toBe(4); // First, Prev, Next, Last
    });

    it('hides pagination controls when all users fit on one page', () => {
      store.users = makeUsers(10);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 1;

      renderOverridesPage();

      const pagination = document.getElementById('overridesPaginationControls');
      expect(pagination?.innerHTML).toBe('');
    });

    it('disables First/Prev on page 1', () => {
      store.users = makeUsers(120);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 1;

      renderOverridesPage();

      const pagination = document.getElementById('overridesPaginationControls');
      const buttons = pagination?.querySelectorAll('.overrides-page-btn');
      expect(buttons[0].disabled).toBe(true);  // First
      expect(buttons[1].disabled).toBe(true);  // Prev
      expect(buttons[2].disabled).toBe(false); // Next
      expect(buttons[3].disabled).toBe(false); // Last
    });

    it('disables Next/Last on last page', () => {
      store.users = makeUsers(120);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 3;

      renderOverridesPage();

      const pagination = document.getElementById('overridesPaginationControls');
      const buttons = pagination?.querySelectorAll('.overrides-page-btn');
      expect(buttons[0].disabled).toBe(false); // First
      expect(buttons[1].disabled).toBe(false); // Prev
      expect(buttons[2].disabled).toBe(true);  // Next
      expect(buttons[3].disabled).toBe(true);  // Last
    });

    it('clamps page to totalPages when page exceeds range', () => {
      store.users = makeUsers(60);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesPageSize = 50;
      store.ui.overridesPage = 99; // Far beyond total pages

      renderOverridesPage();

      const pagination = document.getElementById('overridesPaginationControls');
      expect(pagination?.innerHTML).toContain('Page 2 of 2');
    });
  });

  describe('Overrides Search (Phase 3.4)', () => {
    function makeUsers(names) {
      return names.map((name, i) => ({
        id: `user${i}`,
        name
      }));
    }

    it('filters users by search term', () => {
      store.users = makeUsers(['Alice', 'Bob', 'Alice Smith', 'Charlie']);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesSearch = 'alice';
      store.ui.overridesPage = 1;
      store.ui.overridesPageSize = 50;

      renderOverridesPage();

      const container = document.getElementById('overridesUserList');
      const cards = container?.querySelectorAll('.override-user-card');
      expect(cards?.length).toBe(2);
    });

    it('shows result count in search container', () => {
      store.users = makeUsers(['Alice', 'Bob', 'Charlie', 'David']);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesSearch = 'ali';
      store.ui.overridesPage = 1;
      store.ui.overridesPageSize = 50;

      renderOverridesPage();

      const searchContainer = document.getElementById('overridesSearchContainer');
      expect(searchContainer?.textContent).toContain('1 of 4 users');
    });

    it('shows all users when search is empty', () => {
      store.users = makeUsers(['Alice', 'Bob', 'Charlie']);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesSearch = '';
      store.ui.overridesPage = 1;
      store.ui.overridesPageSize = 50;

      renderOverridesPage();

      const container = document.getElementById('overridesUserList');
      const cards = container?.querySelectorAll('.override-user-card');
      expect(cards?.length).toBe(3);
    });

    it('paginates filtered results correctly', () => {
      // 80 users with names containing "test"
      const users = Array.from({ length: 80 }, (_, i) => ({
        id: `user${i}`,
        name: `Test User ${i}`
      }));
      // Add some non-matching users
      users.push({ id: 'other1', name: 'Bob' });
      users.push({ id: 'other2', name: 'Charlie' });

      store.users = users;
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesSearch = 'test';
      store.ui.overridesPage = 2;
      store.ui.overridesPageSize = 50;

      renderOverridesPage();

      const container = document.getElementById('overridesUserList');
      const cards = container?.querySelectorAll('.override-user-card');
      expect(cards?.length).toBe(30); // 80 matches, page 2 = 30 remaining
    });

    it('preserves search value in search input', () => {
      store.users = makeUsers(['Alice']);
      store.overrides = {};
      store.profiles = new Map();
      store.ui.overridesSearch = 'alice';
      store.ui.overridesPage = 1;
      store.ui.overridesPageSize = 50;

      renderOverridesPage();

      const input = document.getElementById('overridesSearchInput');
      expect(input?.value).toBe('alice');
    });
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
