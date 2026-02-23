/**
 * @jest-environment jsdom
 */

import { jest, afterEach } from '@jest/globals';
import * as UI from '../../js/ui.js';
import { store } from '../../js/state.js';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

// Setup DOM
document.body.innerHTML = `
  <div id="mainView">
    <div id="resultsContainer" class="hidden"></div>
    <div id="summaryStrip"></div>
    <table>
      <tbody id="summaryTableBody"></tbody>
    </table>
    <div id="detailedTableContainer"></div>
    <div id="loadingState" class="hidden"></div>
    <div id="emptyState" class="hidden"></div>
    <div id="apiStatusBanner" class="hidden"></div>
    <button id="generateBtn">Generate</button>
    <button id="exportBtn">Export</button>
    <button id="openOverridesBtn">Overrides</button>
  </div>
  <div id="overridesPage" class="hidden">
    <button id="closeOverridesBtn">Back</button>
    <div id="overridesUserList"></div>
  </div>
`;

describe('UI Module', () => {
  let mockStore;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  beforeEach(() => {
    // Initialize UI elements
    UI.initializeElements();

    mockStore = createMockStore({
      users: [
        { id: 'user_1', name: 'Alice Smith' },
        { id: 'user_2', name: 'Bob Jones' }
      ]
    });

    // Reset DOM classes
    document.getElementById('resultsContainer').classList.add('hidden');
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('apiStatusBanner').classList.add('hidden');
  });

  describe('renderLoading', () => {
    it('should show loading state', () => {
      UI.renderLoading(true);

      expect(document.getElementById('loadingState').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('resultsContainer').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('emptyState').classList.contains('hidden')).toBe(true);
    });

    it('should hide loading state', () => {
      UI.renderLoading(false);

      expect(document.getElementById('loadingState').classList.contains('hidden')).toBe(true);
    });
  });

  describe('renderApiStatus', () => {
    it('should display API status banner when there are failures', () => {
      store.apiStatus.profilesFailed = 2;
      store.apiStatus.holidaysFailed = 1;

      UI.renderApiStatus();

      const banner = document.getElementById('apiStatusBanner');
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.textContent).toContain('Profiles: 2 failed');
      expect(banner.textContent).toContain('Holidays: 1 failed');
    });

    it('should hide API status banner when no failures', () => {
      store.apiStatus.profilesFailed = 0;
      store.apiStatus.holidaysFailed = 0;
      store.apiStatus.timeOffFailed = 0;

      UI.renderApiStatus();

      const banner = document.getElementById('apiStatusBanner');
      expect(banner.classList.contains('hidden')).toBe(true);
    });
  });

  describe('renderSummaryStrip', () => {
    it('should render summary statistics correctly', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'Alice Smith',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      UI.renderSummaryStrip(analysis);

      const strip = document.getElementById('summaryStrip');
      expect(strip.textContent).toContain('Users');
      expect(strip.textContent).toContain('2');
      expect(strip.textContent).toContain('Capacity');
      expect(strip.textContent).toContain('Total time');
    });

    it('should display overtime in danger color', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'Alice Smith',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      UI.renderSummaryStrip(analysis);

      const strip = document.getElementById('summaryStrip');
      expect(strip.textContent).toContain('Overtime');
      expect(strip.textContent).toContain('2h');
    });
  });

  describe('renderOverridesPage', () => {
    beforeEach(() => {
      store.setToken('mock_token', { workspaceId: 'workspace_123' });
      store.users = [
        { id: 'user_1', name: 'Alice Smith' },
        { id: 'user_2', name: 'Bob Jones' }
      ];
    });

    it('should render user override cards', () => {
      UI.renderOverridesPage();

      const userList = document.getElementById('overridesUserList');
      expect(userList.children.length).toBe(2); // Two users
    });

    it('should display CUSTOM badge for users with overrides', () => {
      store.updateOverride('user_1', 'capacity', 6);

      UI.renderOverridesPage();

      const userList = document.getElementById('overridesUserList');
      expect(userList.textContent).toContain('CUSTOM');
    });

    it('should show profile capacity when available', () => {
      store.profiles.set('user_1', {
        workCapacityHours: 7,
        workingDays: ['MONDAY']
      });

      UI.renderOverridesPage();

      const userList = document.getElementById('overridesUserList');
      expect(userList.textContent).toContain('(7h profile)');
    });
  });

  describe('renderSummaryTable', () => {
    it('should render user summary table', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'Alice Smith',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user_2',
          userName: 'Bob Jones',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 6000 },
          billable: false
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      UI.renderSummaryTable(analysis);

      const tbody = document.getElementById('summaryTableBody');
      expect(tbody.children.length).toBe(2); // Two users
    });

    it('should not display HIGH OT badge for users with >30% overtime', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'Alice Smith',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user_1',
          userName: 'Alice Smith',
          timeInterval: {
            start: '2025-01-15T18:00:00Z',
            end: '2025-01-15T22:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      UI.renderSummaryTable(analysis);

      const tbody = document.getElementById('summaryTableBody');
      expect(tbody.innerHTML).not.toContain('HIGH OT');
    });
  });

  describe('Event Binding', () => {
    it('should bind override change events on overrides page', () => {
      store.setToken('mock_token', { workspaceId: 'workspace_123' });
      UI.renderOverridesPage();

      let callbackCalled = false;
      let receivedUserId, receivedField, receivedValue;

      UI.bindEvents({
        onGenerate: () => {},
        onOverrideChange: (userId, field, value) => {
          callbackCalled = true;
          receivedUserId = userId;
          receivedField = field;
          receivedValue = value;
        },
        onOverrideModeChange: () => {},
        onPerDayOverrideChange: () => {},
        onWeeklyOverrideChange: () => {},
        onCopyFromGlobal: () => {},
        onCopyGlobalToWeekly: () => {}
      });

      const input = document.querySelector('#overridesUserList input[data-userid="user_1"]');
      input.value = '6';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(callbackCalled).toBe(true);
      expect(receivedUserId).toBe('user_1');
      expect(receivedField).toBe('capacity');
      expect(receivedValue).toBe('6');
    });
  });

  describe('bindEvents cleanup', () => {
    it('should return a cleanup function', () => {
      const cleanup = UI.bindEvents({
        onGenerate: () => {},
        onOverrideChange: () => {},
        onOverrideModeChange: () => {},
        onPerDayOverrideChange: () => {},
        onWeeklyOverrideChange: () => {},
        onCopyFromGlobal: () => {},
        onCopyGlobalToWeekly: () => {}
      });
      expect(typeof cleanup).toBe('function');
    });

    it('cleanup should remove container wheel listeners', () => {
      const overridesUserList = document.getElementById('overridesUserList');
      const detailedContainer = document.getElementById('detailedTableContainer');
      const overridesSpy = jest.spyOn(overridesUserList, 'removeEventListener');
      const detailedSpy = jest.spyOn(detailedContainer, 'removeEventListener');
      const cleanup = UI.bindEvents({
        onGenerate: () => {},
        onOverrideChange: () => {},
        onOverrideModeChange: () => {},
        onPerDayOverrideChange: () => {},
        onWeeklyOverrideChange: () => {},
        onCopyFromGlobal: () => {},
        onCopyGlobalToWeekly: () => {}
      });
      cleanup();
      expect(overridesSpy).toHaveBeenCalledWith('wheel', expect.any(Function), expect.objectContaining({ passive: false }));
      expect(detailedSpy).toHaveBeenCalledWith('wheel', expect.any(Function), expect.objectContaining({ passive: false }));
      overridesSpy.mockRestore();
      detailedSpy.mockRestore();
    });
  });

  describe('wheel event scoping', () => {
    it('should not add passive:false wheel listener to document', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      UI.bindEvents({
        onGenerate: () => {},
        onOverrideChange: () => {},
        onOverrideModeChange: () => {},
        onPerDayOverrideChange: () => {},
        onWeeklyOverrideChange: () => {},
        onCopyFromGlobal: () => {},
        onCopyGlobalToWeekly: () => {}
      });
      const wheelCalls = addSpy.mock.calls.filter(([event]) => event === 'wheel');
      expect(wheelCalls).toHaveLength(0);
      addSpy.mockRestore();
    });
  });

})
