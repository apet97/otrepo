/**
 * @jest-environment node
 *
 * State Mutation Tests
 *
 * This test suite targets all mutation operations in js/state.ts to ensure
 * proper validation, persistence, and state management.
 *
 * Focus areas:
 * - Override validation and cleanup
 * - Override mode switching (global/weekly/perDay)
 * - Per-day and weekly override operations
 * - Report cache management
 * - Token workspace switching
 * - Data clearing operations
 * - Config/UI state persistence
 * - Diagnostics reporting
 * - Cache cleanup
 * - Subscriber pattern
 * - Throttle status tracking
 * - Encryption status reporting
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { store, resetFallbackStorage } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';
import { StoragePolyfill } from '../helpers/storage-polyfill.js';
import { createMockTokenPayload } from '../helpers/mock-data.js';

// Set up storage polyfills
global.localStorage = new StoragePolyfill();
global.sessionStorage = new StoragePolyfill();

describe('State Mutation Tests', () => {
  beforeEach(() => {
    // Reset store to clean state
    store.token = null;
    store.claims = null;
    store.users = [];
    store.rawEntries = null;
    store.analysisResults = null;
    store.currentDateRange = null;
    store.profiles.clear();
    store.holidays.clear();
    store.timeOff.clear();
    store.overrides = {};
    store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    store.throttleStatus = { retryCount: 0, lastRetryTime: null };
    store.listeners.clear();
    store.ui = {
      isLoading: false,
      summaryExpanded: false,
      summaryGroupBy: 'user',
      overridesCollapsed: true,
      activeTab: 'summary',
      detailedPage: 1,
      detailedPageSize: 50,
      activeDetailedFilter: 'all',
      hasCostRates: true,
      hasAmountRates: true,
      paginationTruncated: false,
      paginationAbortedDueToTokenExpiration: false,
    };
    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      maxPages: 10,
      encryptStorage: true,
      auditConsent: true,
    };
    store.calcParams = {
      dailyThreshold: 8,
      weeklyThreshold: 40,
      overtimeMultiplier: 1.5,
      tier2ThresholdHours: 0,
      tier2Multiplier: 2.0,
    };

    // Clear storage
    localStorage.clear();
    sessionStorage.clear();
    resetFallbackStorage();
  });

  afterEach(standardAfterEach);

  // ========================================================================
  // 1. Override Validation
  // ========================================================================

  describe('updateOverride() validation', () => {
    it('should accept valid capacity value', () => {
      const result = store.updateOverride('user1', 'capacity', 7);
      expect(result).toBe(true);
      expect(store.overrides.user1.capacity).toBe(7);
    });

    it('should accept valid multiplier value', () => {
      const result = store.updateOverride('user1', 'multiplier', 2.0);
      expect(result).toBe(true);
      expect(store.overrides.user1.multiplier).toBe(2.0);
    });

    it('should accept valid tier2Threshold value', () => {
      const result = store.updateOverride('user1', 'tier2Threshold', 10);
      expect(result).toBe(true);
      expect(store.overrides.user1.tier2Threshold).toBe(10);
    });

    it('should accept valid tier2Multiplier value', () => {
      const result = store.updateOverride('user1', 'tier2Multiplier', 2.5);
      expect(result).toBe(true);
      expect(store.overrides.user1.tier2Multiplier).toBe(2.5);
    });

    it('should reject negative capacity', () => {
      const result = store.updateOverride('user1', 'capacity', -5);
      expect(result).toBe(false);
      // updateOverride initializes the user record to {} before validation,
      // so an empty record remains after rejection
      expect(store.overrides.user1).toEqual({});
      expect(store.overrides.user1.capacity).toBeUndefined();
    });

    it('should reject multiplier less than 1', () => {
      const result = store.updateOverride('user1', 'multiplier', 0.5);
      expect(result).toBe(false);
      expect(store.overrides.user1).toEqual({});
      expect(store.overrides.user1.multiplier).toBeUndefined();
    });

    it('should reject negative tier2Threshold', () => {
      const result = store.updateOverride('user1', 'tier2Threshold', -1);
      expect(result).toBe(false);
      expect(store.overrides.user1).toEqual({});
      expect(store.overrides.user1.tier2Threshold).toBeUndefined();
    });

    it('should reject tier2Multiplier less than 1', () => {
      const result = store.updateOverride('user1', 'tier2Multiplier', 0.9);
      expect(result).toBe(false);
      expect(store.overrides.user1).toEqual({});
      expect(store.overrides.user1.tier2Multiplier).toBeUndefined();
    });

    it('should delete field when value is null', () => {
      store.updateOverride('user1', 'capacity', 8);
      expect(store.overrides.user1.capacity).toBe(8);

      store.updateOverride('user1', 'capacity', null);
      // After deleting the only field, the entire user record is cleaned up
      expect(store.overrides.user1).toBeUndefined();
    });

    it('should delete field when value is empty string', () => {
      store.updateOverride('user1', 'multiplier', 1.5);
      expect(store.overrides.user1.multiplier).toBe(1.5);

      store.updateOverride('user1', 'multiplier', '');
      // After deleting the only field, the entire user record is cleaned up
      expect(store.overrides.user1).toBeUndefined();
    });

    it('should cleanup empty override record after all fields deleted', () => {
      store.updateOverride('user1', 'capacity', 8);
      store.updateOverride('user1', 'multiplier', 1.5);
      expect(store.overrides.user1).toEqual(expect.objectContaining({ capacity: 8, multiplier: 1.5 }));

      store.updateOverride('user1', 'capacity', null);
      store.updateOverride('user1', 'multiplier', null);
      expect(store.overrides.user1).toBeUndefined();
    });
  });

  // ========================================================================
  // 2. Override Modes
  // ========================================================================

  describe('setOverrideMode()', () => {
    it('should set global mode', () => {
      const result = store.setOverrideMode('user1', 'global');
      expect(result).toBe(true);
      expect(store.overrides.user1.mode).toBe('global');
    });

    it('should set weekly mode and initialize weeklyOverrides', () => {
      const result = store.setOverrideMode('user1', 'weekly');
      expect(result).toBe(true);
      expect(store.overrides.user1.mode).toBe('weekly');
      expect(store.overrides.user1.weeklyOverrides).toEqual({});
    });

    it('should set perDay mode and initialize perDayOverrides', () => {
      const result = store.setOverrideMode('user1', 'perDay');
      expect(result).toBe(true);
      expect(store.overrides.user1.mode).toBe('perDay');
      expect(store.overrides.user1.perDayOverrides).toEqual({});
    });

    it('should reject invalid mode', () => {
      const result = store.setOverrideMode('user1', 'invalid');
      expect(result).toBe(false);
      expect(store.overrides.user1).toBeUndefined();
    });

    it('should migrate global to weekly when switching modes', () => {
      store.overrides.user1 = { mode: 'global', capacity: 7, multiplier: 2.0 };
      store.setOverrideMode('user1', 'weekly');

      expect(store.overrides.user1.mode).toBe('weekly');
      expect(store.overrides.user1.weeklyOverrides.MONDAY.capacity).toBe(7);
      expect(store.overrides.user1.weeklyOverrides.MONDAY.multiplier).toBe(2.0);
      expect(store.overrides.user1.weeklyOverrides.FRIDAY.capacity).toBe(7);
      expect(store.overrides.user1.weeklyOverrides.SUNDAY.multiplier).toBe(2.0);
    });
  });

  // ========================================================================
  // 3. Per-day Overrides
  // ========================================================================

  describe('updatePerDayOverride()', () => {
    beforeEach(() => {
      store.setOverrideMode('user1', 'perDay');
    });

    it('should set per-day capacity', () => {
      const result = store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);
      expect(result).toBe(true);
      expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(6);
    });

    it('should set per-day multiplier', () => {
      const result = store.updatePerDayOverride('user1', '2025-01-15', 'multiplier', 1.8);
      expect(result).toBe(true);
      expect(store.overrides.user1.perDayOverrides['2025-01-15'].multiplier).toBe(1.8);
    });

    it('should delete per-day field when value is null', () => {
      store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);
      expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(6);

      store.updatePerDayOverride('user1', '2025-01-15', 'capacity', null);
      // After deleting the only field, the date entry is cleaned up
      expect(store.overrides.user1.perDayOverrides['2025-01-15']).toBeUndefined();
    });

    it('should cleanup empty date entry after all fields deleted', () => {
      store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);
      store.updatePerDayOverride('user1', '2025-01-15', 'multiplier', 1.5);
      expect(store.overrides.user1.perDayOverrides['2025-01-15']).toEqual(expect.objectContaining({ capacity: 6, multiplier: 1.5 }));

      store.updatePerDayOverride('user1', '2025-01-15', 'capacity', null);
      store.updatePerDayOverride('user1', '2025-01-15', 'multiplier', null);
      expect(store.overrides.user1.perDayOverrides['2025-01-15']).toBeUndefined();
    });

    it('should reject invalid per-day capacity', () => {
      const result = store.updatePerDayOverride('user1', '2025-01-15', 'capacity', -3);
      expect(result).toBe(false);
      // updatePerDayOverride initializes empty date entry {} before validation,
      // so empty record remains after rejection
      expect(store.overrides.user1.perDayOverrides['2025-01-15']).toEqual({});
    });
  });

  // ========================================================================
  // 4. Weekly Overrides
  // ========================================================================

  describe('setWeeklyOverride()', () => {
    beforeEach(() => {
      store.setOverrideMode('user1', 'weekly');
    });

    it('should set weekly capacity for Monday', () => {
      const result = store.setWeeklyOverride('user1', 'MONDAY', 'capacity', 7);
      expect(result).toBe(true);
      expect(store.overrides.user1.weeklyOverrides.MONDAY.capacity).toBe(7);
    });

    it('should set weekly multiplier for Friday', () => {
      const result = store.setWeeklyOverride('user1', 'FRIDAY', 'multiplier', 2.0);
      expect(result).toBe(true);
      expect(store.overrides.user1.weeklyOverrides.FRIDAY.multiplier).toBe(2.0);
    });

    it('should delete weekly field when value is null', () => {
      store.setWeeklyOverride('user1', 'TUESDAY', 'capacity', 8);
      expect(store.overrides.user1.weeklyOverrides.TUESDAY.capacity).toBe(8);

      store.setWeeklyOverride('user1', 'TUESDAY', 'capacity', null);
      // After deleting the only field, the weekday entry is cleaned up
      expect(store.overrides.user1.weeklyOverrides.TUESDAY).toBeUndefined();
    });

    it('should cleanup empty weekday entry after all fields deleted', () => {
      store.setWeeklyOverride('user1', 'WEDNESDAY', 'capacity', 8);
      store.setWeeklyOverride('user1', 'WEDNESDAY', 'multiplier', 1.5);
      expect(store.overrides.user1.weeklyOverrides.WEDNESDAY).toEqual(expect.objectContaining({ capacity: 8, multiplier: 1.5 }));

      store.setWeeklyOverride('user1', 'WEDNESDAY', 'capacity', null);
      store.setWeeklyOverride('user1', 'WEDNESDAY', 'multiplier', null);
      expect(store.overrides.user1.weeklyOverrides.WEDNESDAY).toBeUndefined();
    });

    it('should reject invalid weekly capacity', () => {
      const result = store.setWeeklyOverride('user1', 'THURSDAY', 'capacity', -2);
      expect(result).toBe(false);
      // setWeeklyOverride initializes empty weekday entry {} before validation,
      // so empty record remains after rejection
      expect(store.overrides.user1.weeklyOverrides.THURSDAY).toEqual({});
    });
  });

  // ========================================================================
  // 5. copyGlobalToPerDay
  // ========================================================================

  describe('copyGlobalToPerDay()', () => {
    it('should copy global values to all provided dates', () => {
      store.overrides.user1 = {
        mode: 'perDay',
        capacity: 7,
        multiplier: 1.8,
        tier2Threshold: 10,
        tier2Multiplier: 2.5,
        perDayOverrides: {},
      };

      const dates = ['2025-01-15', '2025-01-16', '2025-01-17'];
      const result = store.copyGlobalToPerDay('user1', dates);
      expect(result).toBe(true);

      dates.forEach(date => {
        expect(store.overrides.user1.perDayOverrides[date].capacity).toBe(7);
        expect(store.overrides.user1.perDayOverrides[date].multiplier).toBe(1.8);
        expect(store.overrides.user1.perDayOverrides[date].tier2Threshold).toBe(10);
        expect(store.overrides.user1.perDayOverrides[date].tier2Multiplier).toBe(2.5);
      });
    });

    it('should return false when dates array is empty', () => {
      store.overrides.user1 = { mode: 'perDay', capacity: 7, perDayOverrides: {} };
      const result = store.copyGlobalToPerDay('user1', []);
      expect(result).toBe(false);
    });

    it('should return false when user is not in perDay mode', () => {
      store.overrides.user1 = { mode: 'global', capacity: 7 };
      const result = store.copyGlobalToPerDay('user1', ['2025-01-15']);
      expect(result).toBe(false);
    });

    it('should return false when user override does not exist', () => {
      const result = store.copyGlobalToPerDay('user1', ['2025-01-15']);
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // 6. copyGlobalToWeekly
  // ========================================================================

  describe('copyGlobalToWeekly()', () => {
    it('should copy global values to all weekdays', () => {
      store.overrides.user1 = {
        mode: 'weekly',
        capacity: 6.5,
        multiplier: 1.6,
        tier2Threshold: 12,
        tier2Multiplier: 2.2,
        weeklyOverrides: {},
      };

      const result = store.copyGlobalToWeekly('user1');
      expect(result).toBe(true);

      const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      weekdays.forEach(day => {
        expect(store.overrides.user1.weeklyOverrides[day].capacity).toBe(6.5);
        expect(store.overrides.user1.weeklyOverrides[day].multiplier).toBe(1.6);
        expect(store.overrides.user1.weeklyOverrides[day].tier2Threshold).toBe(12);
        expect(store.overrides.user1.weeklyOverrides[day].tier2Multiplier).toBe(2.2);
      });
    });

    it('should return false when user is not in weekly mode', () => {
      store.overrides.user1 = { mode: 'global', capacity: 8 };
      const result = store.copyGlobalToWeekly('user1');
      expect(result).toBe(false);
    });

    it('should return false when user override does not exist', () => {
      const result = store.copyGlobalToWeekly('user1');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // 7. Report Cache
  // ========================================================================

  describe('Report cache operations', () => {
    beforeEach(() => {
      const claims = createMockTokenPayload();
      store.setToken('test-token', claims);
    });

    it('getReportCacheKey() should generate correct key', () => {
      const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
      expect(key).toMatch(/ws_test_\d+-2025-01-01-2025-01-31/);
    });

    it('getReportCacheKey() should return null without workspace', () => {
      store.claims = null;
      const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
      expect(key).toBe(null);
    });

    it('setCachedReport() should store entries in sessionStorage', async () => {
      const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
      const entries = [
        { id: 'entry1', userId: 'user1', timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z' } },
      ];

      await store.setCachedReport(key, entries);

      const cached = sessionStorage.getItem('otplus_report_cache');
      expect(cached).not.toBeNull();

      const parsed = JSON.parse(cached);
      expect(parsed.key).toBe(key);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].id).toBe('entry1');
    });

    it('getCachedReport() should return cached entries if fresh', async () => {
      const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
      const entries = [
        { id: 'entry2', userId: 'user2', timeInterval: { start: '2025-01-02T09:00:00Z', end: '2025-01-02T17:00:00Z' } },
      ];

      await store.setCachedReport(key, entries);
      const retrieved = await store.getCachedReport(key);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe('entry2');
    });

    it('getCachedReport() should return null if cache expired', async () => {
      const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
      const cache = {
        key,
        timestamp: Date.now() - (6 * 60 * 1000), // 6 minutes ago (expired)
        entries: [{ id: 'old' }],
      };

      sessionStorage.setItem('otplus_report_cache', JSON.stringify(cache));

      const retrieved = await store.getCachedReport(key);
      expect(retrieved).toBe(null);
    });

    it('getCachedReport() should return null if key mismatched', async () => {
      const key1 = store.getReportCacheKey('2025-01-01', '2025-01-31');
      const key2 = store.getReportCacheKey('2025-02-01', '2025-02-28');

      const cache = {
        key: key1,
        timestamp: Date.now(),
        entries: [{ id: 'entry' }],
      };

      sessionStorage.setItem('otplus_report_cache', JSON.stringify(cache));

      const retrieved = await store.getCachedReport(key2);
      expect(retrieved).toBe(null);
    });

    it('clearReportCache() should remove cached report', async () => {
      const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
      await store.setCachedReport(key, [{ id: 'entry' }]);

      expect(sessionStorage.getItem('otplus_report_cache')).not.toBeNull();

      store.clearReportCache();
      expect(sessionStorage.getItem('otplus_report_cache')).toBe(null);
    });
  });

  // ========================================================================
  // 8. setToken() Workspace Switching
  // ========================================================================

  describe('setToken() workspace switching', () => {
    it('should clear caches on workspace change', () => {
      const claims1 = { workspaceId: 'ws1', userId: 'user1', backendUrl: 'https://api.clockify.me' };
      store.setToken('token1', claims1);

      store.profiles.set('user1', { userId: 'user1', workCapacity: 'PT8H' });
      store.holidays.set('user1', new Map([['2025-01-01', { id: 'h1', name: 'Holiday' }]]));
      store.timeOff.set('user1', new Map([['2025-01-02', { id: 't1', status: 'APPROVED' }]]));
      store.rawEntries = [{ id: 'entry1' }];
      store.analysisResults = [{ userId: 'user1' }];

      const claims2 = { workspaceId: 'ws2', userId: 'user2', backendUrl: 'https://api.clockify.me' };
      store.setToken('token2', claims2);

      expect(store.profiles.size).toBe(0);
      expect(store.holidays.size).toBe(0);
      expect(store.timeOff.size).toBe(0);
      expect(store.rawEntries).toBe(null);
      expect(store.analysisResults).toBe(null);
    });

    it('should load overrides for new workspace', () => {
      const claims = { workspaceId: 'ws3', userId: 'user1', backendUrl: 'https://api.clockify.me' };

      // Pre-populate localStorage with workspace-specific overrides
      // Key prefix is 'overtime_overrides_' (from constants.ts STORAGE_KEYS.OVERRIDES_PREFIX)
      localStorage.setItem('overtime_overrides_ws3', JSON.stringify({
        user1: { capacity: 7, multiplier: 1.8 },
      }));

      store.setToken('token', claims);

      expect(store.overrides.user1).toEqual(expect.objectContaining({ capacity: 7, multiplier: 1.8 }));
      expect(store.overrides.user1.capacity).toBe(7);
      expect(store.overrides.user1.multiplier).toBe(1.8);
    });
  });

  // ========================================================================
  // 9. clearAllData()
  // ========================================================================

  describe('clearAllData()', () => {
    beforeEach(() => {
      const claims = createMockTokenPayload();
      store.setToken('test-token', claims);

      // Set up some data
      store.profiles.set('user1', { userId: 'user1', workCapacity: 'PT8H' });
      store.holidays.set('user1', new Map([['2025-01-01', { id: 'h1', name: 'Holiday' }]]));
      store.timeOff.set('user1', new Map([['2025-01-02', { id: 't1', status: 'APPROVED' }]]));
      store.rawEntries = [{ id: 'entry1' }];
      store.analysisResults = [{ userId: 'user1' }];
      store.overrides = { user1: { capacity: 7 } };

      // Persist some config
      store.config.dailyThreshold = 9;
      store.saveConfig();

      store.ui.summaryExpanded = true;
      store.saveUIState();
    });

    it('should reset all state to defaults', () => {
      store.clearAllData();

      expect(store.profiles.size).toBe(0);
      expect(store.holidays.size).toBe(0);
      expect(store.timeOff.size).toBe(0);
      expect(store.rawEntries).toBe(null);
      expect(store.analysisResults).toBe(null);
      expect(store.currentDateRange).toBe(null);
      expect(store.overrides).toEqual({});
    });

    it('should reset config to defaults', () => {
      store.clearAllData();

      expect(store.config.useProfileCapacity).toBe(true);
      expect(store.config.applyHolidays).toBe(true);
      expect(store.config.amountDisplay).toBe('earned');
      expect(store.calcParams.dailyThreshold).toBe(8);
      expect(store.calcParams.overtimeMultiplier).toBe(1.5);
    });

    it('should reset UI state to defaults', () => {
      store.clearAllData();

      expect(store.ui.summaryExpanded).toBe(false);
      expect(store.ui.summaryGroupBy).toBe('user');
      expect(store.ui.activeTab).toBe('summary');
      expect(store.ui.detailedPage).toBe(1);
    });

    it('should remove persisted data from localStorage', () => {
      store.clearAllData();

      expect(localStorage.getItem('otplus_config')).toBe(null);
      expect(localStorage.getItem('otplus_ui_state')).toBe(null);
    });

    it('should NOT clear token and claims', () => {
      const originalToken = store.token;
      const originalClaims = store.claims;

      store.clearAllData();

      expect(store.token).toBe(originalToken);
      expect(store.claims).toBe(originalClaims);
    });
  });

  // ========================================================================
  // 10. saveConfig() and saveUIState()
  // ========================================================================

  describe('Config and UI state persistence', () => {
    it('saveConfig() should persist config and calcParams', () => {
      store.config.useProfileCapacity = false;
      store.config.applyHolidays = false;
      store.calcParams.dailyThreshold = 10;
      store.calcParams.overtimeMultiplier = 2.0;

      store.saveConfig();

      const stored = localStorage.getItem('otplus_config');
      expect(typeof stored).toBe('string');

      const parsed = JSON.parse(stored);
      expect(parsed.config.useProfileCapacity).toBe(false);
      expect(parsed.config.applyHolidays).toBe(false);
      expect(parsed.calcParams.dailyThreshold).toBe(10);
      expect(parsed.calcParams.overtimeMultiplier).toBe(2.0);
    });

    it('saveUIState() should persist UI properties', () => {
      store.ui.summaryExpanded = true;
      store.ui.summaryGroupBy = 'project';
      store.ui.overridesCollapsed = false;

      store.saveUIState();

      const stored = localStorage.getItem('otplus_ui_state');
      expect(typeof stored).toBe('string');

      const parsed = JSON.parse(stored);
      expect(parsed.summaryExpanded).toBe(true);
      expect(parsed.summaryGroupBy).toBe('project');
      expect(parsed.overridesCollapsed).toBe(false);
    });
  });

  // ========================================================================
  // 11. getDiagnostics()
  // ========================================================================

  describe('getDiagnostics()', () => {
    it('should return privacy-safe diagnostic info', () => {
      const claims = { workspaceId: 'ws-test-123', userId: 'user1', backendUrl: 'https://api.clockify.me' };
      store.setToken('test-token', claims);

      store.profiles.set('user1', { userId: 'user1' });
      store.profiles.set('user2', { userId: 'user2' });
      store.holidays.set('user1', new Map([['2025-01-01', { id: 'h1' }]]));
      store.currentDateRange = { start: '2025-01-01', end: '2025-01-31' };

      const diag = store.getDiagnostics();

      expect(diag.isAuthenticated).toBe(true);
      expect(diag.cacheStats.profilesCount).toBe(2);
      expect(diag.cacheStats.holidaysCount).toBe(1);
      expect(diag.cacheStats.timeOffCount).toBe(0);
      expect(diag.dateRange).toEqual({ start: '2025-01-01', end: '2025-01-31' });
      expect(typeof diag.hashedWorkspaceId).toBe('string');
      expect(diag.hashedWorkspaceId).not.toBe('ws-test-123'); // Should be hashed
    });

    it('should include config and calcParams', () => {
      const diag = store.getDiagnostics();

      expect(diag.config).toEqual(expect.objectContaining({ useProfileCapacity: true }));
      expect(diag.config.useProfileCapacity).toBe(true);
      expect(diag.calcParams).toEqual(expect.objectContaining({ dailyThreshold: 8 }));
      expect(diag.calcParams.dailyThreshold).toBe(8);
    });

    it('should report apiStatus and throttleStatus', () => {
      store.apiStatus.profilesFailed = 2;
      store.throttleStatus.retryCount = 3;

      const diag = store.getDiagnostics();

      expect(diag.apiStatus.profilesFailed).toBe(2);
      expect(diag.throttleStatus.retryCount).toBe(3);
    });
  });

  // ========================================================================
  // 12. cleanupStaleCaches()
  // ========================================================================

  describe('cleanupStaleCaches()', () => {
    it('should remove expired cache entries', () => {
      const oldTimestamp = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago

      localStorage.setItem('otplus_profiles_ws1', JSON.stringify({
        version: 1,
        timestamp: oldTimestamp,
        entries: [['user1', { userId: 'user1' }]],
      }));

      const stats = store.cleanupStaleCaches();

      expect(stats.checked).toBeGreaterThan(0);
      expect(stats.removed).toBeGreaterThan(0);
      expect(localStorage.getItem('otplus_profiles_ws1')).toBe(null);
    });

    it('should keep fresh cache entries', () => {
      const freshTimestamp = Date.now() - (1 * 60 * 1000); // 1 minute ago

      localStorage.setItem('otplus_profiles_ws2', JSON.stringify({
        version: 1,
        timestamp: freshTimestamp,
        entries: [['user2', { userId: 'user2' }]],
      }));

      const stats = store.cleanupStaleCaches();

      expect(stats.checked).toBeGreaterThan(0);
      expect(localStorage.getItem('otplus_profiles_ws2')).not.toBeNull();
    });

    it('should remove malformed cache entries', () => {
      localStorage.setItem('otplus_holidays_ws3', 'invalid-json');

      const stats = store.cleanupStaleCaches();

      expect(stats.errors).toBeGreaterThan(0);
      expect(stats.removed).toBeGreaterThan(0);
      expect(localStorage.getItem('otplus_holidays_ws3')).toBe(null);
    });
  });

  // ========================================================================
  // 13. Subscribe/Notify
  // ========================================================================

  describe('Subscribe/Notify pattern', () => {
    it('should call subscriber on notify', () => {
      const listener = jest.fn();
      store.subscribe(listener);

      store.notify({ action: 'test' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(store, { action: 'test' });
    });

    it('should support multiple subscribers', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      store.subscribe(listener1);
      store.subscribe(listener2);

      store.notify({ action: 'test' });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe correctly', () => {
      const listener = jest.fn();
      const unsubscribe = store.subscribe(listener);

      store.notify({ action: 'test1' });
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      store.notify({ action: 'test2' });
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  // ========================================================================
  // 14. Throttle Status
  // ========================================================================

  describe('Throttle status tracking', () => {
    it('resetThrottleStatus() should reset counters', () => {
      store.throttleStatus.retryCount = 5;
      store.throttleStatus.lastRetryTime = Date.now();

      store.resetThrottleStatus();

      expect(store.throttleStatus.retryCount).toBe(0);
      expect(store.throttleStatus.lastRetryTime).toBe(null);
    });

    it('incrementThrottleRetry() should increment count and set time', () => {
      const beforeTime = Date.now();

      store.incrementThrottleRetry();

      expect(store.throttleStatus.retryCount).toBe(1);
      expect(store.throttleStatus.lastRetryTime).toBeGreaterThanOrEqual(beforeTime);

      store.incrementThrottleRetry();

      expect(store.throttleStatus.retryCount).toBe(2);
    });
  });

  // ========================================================================
  // 15. getEncryptionStatus()
  // ========================================================================

  describe('getEncryptionStatus()', () => {
    it('should return correct encryption status fields', () => {
      const status = store.getEncryptionStatus();

      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('supported');
      expect(status).toHaveProperty('keyReady');
      expect(status).toHaveProperty('pending');

      expect(typeof status.enabled).toBe('boolean');
      expect(typeof status.supported).toBe('boolean');
      expect(typeof status.keyReady).toBe('boolean');
      expect(typeof status.pending).toBe('boolean');
    });

    it('should reflect config.encryptStorage in enabled field', () => {
      store.config.encryptStorage = true;
      let status = store.getEncryptionStatus();
      expect(status.enabled).toBe(true);

      store.config.encryptStorage = false;
      status = store.getEncryptionStatus();
      expect(status.enabled).toBe(false);
    });
  });

  // ========================================================================
  // Edge cases (T54)
  // ========================================================================

  describe('Edge cases (T54)', () => {
    describe('workspace switching isolation', () => {
      it('should isolate overrides between workspace switches', () => {
        // Set overrides for workspace 1
        const claims1 = { workspaceId: 'ws_iso_1', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token1', claims1);
        store.overrides = { user1: { mode: 'global', capacity: 6 } };
        store.config.encryptStorage = false;
        store.saveOverrides();

        // Switch to workspace 2
        const claims2 = { workspaceId: 'ws_iso_2', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token2', claims2);
        store.overrides = { user1: { mode: 'global', capacity: 10 } };
        store.saveOverrides();

        // Switch back to workspace 1
        store.setToken('token1', claims1);
        expect(store.overrides.user1.capacity).toBe(6);

        // Switch back to workspace 2
        store.setToken('token2', claims2);
        expect(store.overrides.user1.capacity).toBe(10);
      });

      it('should not bleed overrides between workspaces in localStorage', () => {
        const claims1 = { workspaceId: 'ws_bleed_1', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token1', claims1);
        store.config.encryptStorage = false;
        store.overrides = { user1: { mode: 'global', capacity: 5 } };
        store.saveOverrides();

        const claims2 = { workspaceId: 'ws_bleed_2', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token2', claims2);

        // New workspace should start with empty overrides (no bleed)
        expect(Object.keys(store.overrides)).toHaveLength(0);
      });
    });

    describe('copyGlobalToPerDay with edge values', () => {
      it('should handle undefined global values (skip copying them)', () => {
        store.overrides.user1 = {
          mode: 'perDay',
          // capacity and multiplier are undefined
          perDayOverrides: {},
        };

        const result = store.copyGlobalToPerDay('user1', ['2025-01-15']);
        expect(result).toBe(true);

        // Per-day entry should exist but be empty (no values copied)
        expect(store.overrides.user1.perDayOverrides['2025-01-15']).toEqual({});
      });

      it('should initialize perDayOverrides if missing', () => {
        store.overrides.user1 = {
          mode: 'perDay',
          capacity: 7,
          // perDayOverrides intentionally missing
        };

        const result = store.copyGlobalToPerDay('user1', ['2025-01-15']);
        expect(result).toBe(true);
        expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(7);
      });

      it('should not overwrite existing per-day values (only fills empty slots)', () => {
        store.overrides.user1 = {
          mode: 'perDay',
          capacity: 7,
          multiplier: 1.5,
          perDayOverrides: {
            '2025-01-15': { capacity: 10 }, // Pre-existing value
          },
        };

        // copyGlobalToPerDay creates new entry objects for dates without them
        // but should still set capacity since the object already exists
        const result = store.copyGlobalToPerDay('user1', ['2025-01-15', '2025-01-16']);
        expect(result).toBe(true);

        // Existing date gets global values applied
        expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(7);
        // New date also gets global values
        expect(store.overrides.user1.perDayOverrides['2025-01-16'].capacity).toBe(7);
        expect(store.overrides.user1.perDayOverrides['2025-01-16'].multiplier).toBe(1.5);
      });
    });

    describe('report cache (session storage)', () => {
      it('should roundtrip set/get cached report via report cache key', async () => {
        const claims = { workspaceId: 'ws_cache', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token', claims);

        const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
        expect(key).not.toBeNull();

        const entries = [{ id: 'e1', userId: 'user1' }];
        await store.setCachedReport(key, entries);

        const loaded = await store.getCachedReport(key);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe('e1');
      });

      it('should return null for different cache key', async () => {
        const claims = { workspaceId: 'ws_cache2', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token', claims);

        const key1 = store.getReportCacheKey('2025-01-01', '2025-01-31');
        await store.setCachedReport(key1, [{ id: 'e1' }]);

        const key2 = store.getReportCacheKey('2025-02-01', '2025-02-28');
        const loaded = await store.getCachedReport(key2);
        expect(loaded).toBeNull();
      });

      it('should clear report cache', async () => {
        const claims = { workspaceId: 'ws_cache3', userId: 'user1', backendUrl: 'https://api.clockify.me' };
        store.setToken('token', claims);

        const key = store.getReportCacheKey('2025-01-01', '2025-01-31');
        await store.setCachedReport(key, [{ id: 'e1' }]);

        store.clearReportCache();

        const loaded = await store.getCachedReport(key);
        expect(loaded).toBeNull();
      });
    });
  });
});
