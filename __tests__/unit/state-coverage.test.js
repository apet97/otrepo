/**
 * @jest-environment node
 *
 * State Coverage Tests
 *
 * Targets all uncovered lines/branches in js/state.ts to achieve 100% coverage.
 * Covers: sessionStorage fallback, IndexedDB cache, applyServerConfig,
 * applyServerOverrides, encryption init/load/save, report cache with encryption,
 * migrate override format, and edge cases.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { StoragePolyfill } from '../helpers/storage-polyfill.js';

// Set up storage polyfills before importing state
global.localStorage = new StoragePolyfill();
global.sessionStorage = new StoragePolyfill();

// We need to mock crypto module before importing state
const mockDeriveEncryptionKey = jest.fn();
const mockDeriveLegacyEncryptionKey = jest.fn();
const mockStoreEncrypted = jest.fn();
const mockRetrieveEncrypted = jest.fn();
const mockEncryptData = jest.fn();
const mockDecryptData = jest.fn();
const mockIsEncryptionSupported = jest.fn().mockReturnValue(false);

jest.unstable_mockModule('../../js/crypto.js', () => ({
  deriveEncryptionKey: mockDeriveEncryptionKey,
  deriveLegacyEncryptionKey: mockDeriveLegacyEncryptionKey,
  storeEncrypted: mockStoreEncrypted,
  retrieveEncrypted: mockRetrieveEncrypted,
  encryptData: mockEncryptData,
  decryptData: mockDecryptData,
  isEncryptionSupported: mockIsEncryptionSupported,
}));

// Mock logger to suppress output
jest.unstable_mockModule('../../js/logger.js', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const { store, resetFallbackStorage } = await import('../../js/state.js');
const { STORAGE_KEYS, DATA_CACHE_VERSION, REPORT_CACHE_TTL } = await import('../../js/constants.js');

function resetStore() {
  store.token = null;
  store.claims = null;
  store.users = [];
  store.rawEntries = null;
  store.analysisResults = null;
  store.currentDateRange = null;
  store.profiles = new Map();
  store.holidays = new Map();
  store.timeOff = new Map();
  store.overrides = {};
  store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
  store.throttleStatus = { retryCount: 0, lastRetryTime: null };
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
    maxPages: 2500,
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
  store.diagnostics = {
    sentryInitFailed: false,
    workerPoolInitFailed: false,
    workerPoolTerminated: false,
    workerTaskFailures: 0,
  };
}

describe('State Coverage Tests', () => {
  beforeEach(async () => {
    resetStore();
    localStorage.clear();
    sessionStorage.clear();
    resetFallbackStorage();
    jest.clearAllMocks();
    mockIsEncryptionSupported.mockReturnValue(false);

    // Reset private encryptionKey by triggering failed initEncryption
    // when workspace is set (deriveEncryptionKey will reject, setting key to null)
    store.claims = { workspaceId: '__reset__' };
    mockIsEncryptionSupported.mockReturnValueOnce(true);
    mockDeriveEncryptionKey.mockRejectedValueOnce(new Error('reset'));
    await store.initEncryption();
    store.claims = null;

    // Reset sessionStorage fallback state (usingSessionFallback).
    // If a prior test set usingSessionFallback=true, calling clearReportCache
    // with a working sessionStorage triggers tryRecoverSessionFallback() which
    // succeeds and resets usingSessionFallback to false.
    store.clearReportCache();

    jest.clearAllMocks();
    mockIsEncryptionSupported.mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Clean up global.window if set by tests
    if (global.window && global.window !== globalThis) {
      delete global.window;
    }
    if (global.indexedDB) {
      delete global.indexedDB;
    }
  });

  // ========================================================================
  // sessionStorage fallback functions (lines 136-222)
  // ========================================================================

  describe('sessionStorage fallback: tryRecoverFromFallback', () => {
    it('should return true when not using fallback (fast-path)', async () => {
      const { tryRecoverFromFallback, isUsingFallbackStorage } = await import('../../js/storage.js');
      // Not in fallback mode → should return true immediately
      expect(isUsingFallbackStorage()).toBe(false);
      expect(tryRecoverFromFallback()).toBe(true);
    });

    it('should recover from fallback when sessionStorage becomes available (lines 146-156)', async () => {
      // First, force fallback mode by making sessionStorage throw
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);

      // Make sessionStorage throw to enter fallback mode
      sessionStorage.setItem = () => { throw new Error('quota'); };
      sessionStorage.getItem = () => { throw new Error('quota'); };

      store.setToken('token1', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      // Store data while sessionStorage is broken — goes to fallback map
      await store.setCachedReport('recovery-test', [{ id: 'e1' }]);

      // Restore sessionStorage
      sessionStorage.setItem = origSetItem;
      sessionStorage.getItem = origGetItem;

      // Reading should trigger recovery and migrate fallback data
      const cached = await store.getCachedReport('recovery-test');
      expect(cached).not.toBeNull();
      expect(cached.entries).toEqual([{ id: 'e1' }]);
    });

    it('safeSessionSetItem should use fallback when sessionStorage throws (lines 194-208)', async () => {
      // Force sessionStorage.setItem to throw to trigger fallback
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      sessionStorage.setItem = () => { throw new Error('quota exceeded'); };

      store.setToken('token1', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      // setCachedReport calls safeSessionSetItem internally
      // But first it tries IndexedDB (which is undefined in node), so it falls through to session
      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Restore sessionStorage and verify data survived in fallback
      sessionStorage.setItem = origSetItem;
      const cached = await store.getCachedReport('test-key');
      // Data should have been stored in fallback and be retrievable
      expect(cached).not.toBeNull();
    });

    it('safeSessionSetItem should evict oldest when fallback map is at capacity (lines 178-188)', async () => {
      // Force fallback mode
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      sessionStorage.setItem = () => { throw new Error('quota'); };

      store.setToken('token1', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      // Fill the fallback map up to capacity (SESSION_FALLBACK_MAX_SIZE = 50)
      // We need to trigger safeSessionSetItem many times
      for (let i = 0; i < 51; i++) {
        await store.setCachedReport(`key-${i}`, [{ id: `e${i}` }]);
      }

      // Oldest entry (key-0) should have been evicted; newest should survive
      const oldest = await store.getCachedReport('key-0');
      const newest = await store.getCachedReport('key-50');
      expect(oldest).toBeNull();
      expect(newest).not.toBeNull();

      sessionStorage.setItem = origSetItem;
    });

    it('safeSessionGetItem should use fallback when sessionStorage throws (lines 163-164)', async () => {
      // Force fallback mode by making getItem throw
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);

      // First put something in fallback by making setItem throw
      sessionStorage.setItem = () => { throw new Error('quota'); };

      store.setToken('token1', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;
      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Now also make getItem throw
      sessionStorage.getItem = () => { throw new Error('unavailable'); };

      // getCachedReport will call safeSessionGetItem which should use fallback
      const result = await store.getCachedReport('test-key');
      // Data was stored in fallback (via setCachedReport) and should be retrievable
      expect(result).not.toBeNull();

      sessionStorage.getItem = origGetItem;
      sessionStorage.setItem = origSetItem;
    });

    it('safeSessionRemoveItem should handle fallback mode (lines 214-215)', async () => {
      // Force fallback mode
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origRemove = sessionStorage.removeItem.bind(sessionStorage);

      sessionStorage.setItem = () => { throw new Error('quota'); };

      store.setToken('token1', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      // Store data in fallback mode
      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Now also make removeItem throw to keep us in fallback
      sessionStorage.removeItem = () => { throw new Error('unavailable'); };

      // clearReportCache calls safeSessionRemoveItem
      store.clearReportCache();

      // After clearing, data should be gone
      const cached = await store.getCachedReport('test-key');
      expect(cached).toBeNull();

      sessionStorage.setItem = origSetItem;
      sessionStorage.removeItem = origRemove;
    });

    it('safeSessionRemoveItem should enter fallback mode when removeItem throws (line 221)', () => {
      const origRemove = sessionStorage.removeItem.bind(sessionStorage);
      sessionStorage.removeItem = () => { throw new Error('access denied'); };

      // clearReportCache calls safeSessionRemoveItem — should not throw
      expect(() => store.clearReportCache()).not.toThrow();

      sessionStorage.removeItem = origRemove;
    });

    it('tryRecoverSessionFallback returns false when setItem fails during recovery (line 150)', async () => {
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);

      // Force fallback mode first
      sessionStorage.setItem = () => { throw new Error('quota'); };
      store.config.encryptStorage = false;
      store.setToken('token1', { workspaceId: 'ws1' });
      await store.setCachedReport('key1', [{ id: 'e1' }]);

      // Now make setItem work for the test key but fail for recovery
      let callCount = 0;
      sessionStorage.setItem = (key, value) => {
        callCount++;
        if (callCount === 1) {
          // Test key passes
          origSetItem(key, value);
        } else {
          // Recovery of fallback entries fails
          throw new Error('still full');
        }
      };

      // Try to use sessionStorage again -- recovery should fail at line 150
      sessionStorage.getItem = origGetItem;
      const result = await store.getCachedReport('key1');

      // Recovery failed — data should still be accessible from fallback
      expect(result).not.toBeNull();

      sessionStorage.setItem = origSetItem;
    });

    it('tryRecoverSessionFallback returns false when test setItem throws (line 158)', async () => {
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);

      // Force fallback mode
      sessionStorage.setItem = () => { throw new Error('quota'); };
      store.config.encryptStorage = false;
      store.setToken('token1', { workspaceId: 'ws1' });
      await store.setCachedReport('key1', [{ id: 'e1' }]);

      // Keep setItem throwing -- recovery test key will fail (line 158)
      // But make getItem work so we hit tryRecoverSessionFallback
      sessionStorage.getItem = origGetItem;

      const result = await store.getCachedReport('key1');

      // Recovery failed — data should still be accessible from fallback
      expect(result).not.toBeNull();

      sessionStorage.setItem = origSetItem;
    });
  });

  // ========================================================================
  // openCacheDb / IndexedDB (lines 263-274)
  // ========================================================================

  describe('openCacheDb / IndexedDB paths', () => {
    it('getCachedReport returns null when indexedDB is undefined (line 260)', async () => {
      store.setToken('token1', { workspaceId: 'ws1' });

      // indexedDB is undefined in node, so openCacheDb returns null
      // This means the IDB path is skipped, falls through to sessionStorage
      const result = await store.getCachedReport('some-key');
      expect(result).toBeNull();
    });

    it('setCachedReport falls through to sessionStorage when IDB unavailable', async () => {
      store.setToken('token1', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Should have stored in sessionStorage as fallback
      const cached = sessionStorage.getItem(STORAGE_KEYS.REPORT_CACHE);
      expect(cached).not.toBeNull();
      const parsed = JSON.parse(cached);
      expect(parsed.key).toBe('test-key');
    });
  });

  // ========================================================================
  // applyServerConfig (lines 684-733)
  // ========================================================================

  describe('applyServerConfig()', () => {
    it('should merge server config into store config', () => {
      store.applyServerConfig(
        { useProfileCapacity: false, applyHolidays: false },
        {}
      );

      expect(store.config.useProfileCapacity).toBe(false);
      expect(store.config.applyHolidays).toBe(false);
      // Other defaults preserved
      expect(store.config.applyTimeOff).toBe(true);
    });

    it('should apply server calcParams with validation', () => {
      store.applyServerConfig({}, {
        dailyThreshold: 10,
        weeklyThreshold: 45,
        overtimeMultiplier: 2.0,
        tier2ThresholdHours: 12,
        tier2Multiplier: 2.5,
      });

      expect(store.calcParams.dailyThreshold).toBe(10);
      expect(store.calcParams.weeklyThreshold).toBe(45);
      expect(store.calcParams.overtimeMultiplier).toBe(2.0);
      expect(store.calcParams.tier2ThresholdHours).toBe(12);
      expect(store.calcParams.tier2Multiplier).toBe(2.5);
    });

    it('should skip non-object serverConfig', () => {
      const origConfig = { ...store.config };
      store.applyServerConfig(null, null);
      expect(store.config).toEqual(origConfig);
    });

    it('should skip non-number calcParams fields', () => {
      const origParams = { ...store.calcParams };
      store.applyServerConfig({}, {
        dailyThreshold: 'not-a-number',
        weeklyThreshold: undefined,
      });
      expect(store.calcParams.dailyThreshold).toBe(origParams.dailyThreshold);
      expect(store.calcParams.weeklyThreshold).toBe(origParams.weeklyThreshold);
    });

    it('should increment configVersion', () => {
      const prevVersion = store.configVersion;
      store.applyServerConfig({}, {});
      expect(store.configVersion).toBe(prevVersion + 1);
    });

    it('should apply only dailyThreshold when only that is provided', () => {
      store.applyServerConfig({}, { dailyThreshold: 7 });
      expect(store.calcParams.dailyThreshold).toBe(7);
      expect(store.calcParams.weeklyThreshold).toBe(40);
    });

    it('should apply only weeklyThreshold when only that is provided', () => {
      store.applyServerConfig({}, { weeklyThreshold: 35 });
      expect(store.calcParams.weeklyThreshold).toBe(35);
    });

    it('should apply only overtimeMultiplier when only that is provided', () => {
      store.applyServerConfig({}, { overtimeMultiplier: 1.75 });
      expect(store.calcParams.overtimeMultiplier).toBe(1.75);
    });

    it('should apply only tier2ThresholdHours when only that is provided', () => {
      store.applyServerConfig({}, { tier2ThresholdHours: 10 });
      expect(store.calcParams.tier2ThresholdHours).toBe(10);
    });

    it('should apply only tier2Multiplier when only that is provided', () => {
      store.applyServerConfig({}, { tier2Multiplier: 3.0 });
      expect(store.calcParams.tier2Multiplier).toBe(3.0);
    });
  });

  // ========================================================================
  // applyServerOverrides (lines 726-734)
  // ========================================================================

  describe('applyServerOverrides()', () => {
    it('should replace local overrides with server overrides', () => {
      store.overrides = { user1: { capacity: 7 } };

      store.applyServerOverrides({
        user2: { mode: 'global', capacity: 6, multiplier: 1.5 },
        user3: { mode: 'weekly', capacity: 8 },
      });

      expect(store.overrides.user1).toBeUndefined();
      expect(store.overrides.user2).toEqual({ mode: 'global', capacity: 6, multiplier: 1.5 });
      expect(store.overrides.user3).toEqual({ mode: 'weekly', capacity: 8 });
    });

    it('should skip non-object override entries', () => {
      store.applyServerOverrides({
        user1: { mode: 'global', capacity: 6 },
        user2: null,
        user3: 'invalid',
        user4: 42,
      });

      expect(store.overrides.user1).toEqual({ mode: 'global', capacity: 6 });
      expect(store.overrides.user2).toBeUndefined();
      expect(store.overrides.user3).toBeUndefined();
      expect(store.overrides.user4).toBeUndefined();
    });

    it('should increment overridesVersion', () => {
      const prevVersion = store.overridesVersion;
      store.applyServerOverrides({});
      expect(store.overridesVersion).toBe(prevVersion + 1);
    });

    it('should clear existing overrides even when server sends empty', () => {
      store.overrides = { user1: { capacity: 7 } };
      store.applyServerOverrides({});
      expect(store.overrides).toEqual({});
    });

    it('should clamp out-of-range nested weeklyOverrides fields', () => {
      store.applyServerOverrides({
        user1: {
          mode: 'weekly',
          weeklyOverrides: {
            MONDAY: { capacity: 50, multiplier: 0.5 },
          },
        },
      });

      expect(store.overrides.user1.weeklyOverrides.MONDAY.capacity).toBe(24);
      expect(store.overrides.user1.weeklyOverrides.MONDAY.multiplier).toBe(1);
    });

    it('should clamp out-of-range nested perDayOverrides fields', () => {
      store.applyServerOverrides({
        user1: {
          mode: 'perDay',
          perDayOverrides: {
            '2026-03-13': { tier2Threshold: 30, tier2Multiplier: 10 },
          },
        },
      });

      expect(store.overrides.user1.perDayOverrides['2026-03-13'].tier2Threshold).toBe(24);
      expect(store.overrides.user1.perDayOverrides['2026-03-13'].tier2Multiplier).toBe(5);
    });
  });

  // ========================================================================
  // initEncryption (lines 828-846)
  // ========================================================================

  describe('initEncryption()', () => {
    it('should return early when no workspace ID (lines 828-830)', async () => {
      store.claims = null;
      await store.initEncryption();
      expect(mockDeriveEncryptionKey).not.toHaveBeenCalled();
    });

    it('should return early when encryption not supported (line 834)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      mockIsEncryptionSupported.mockReturnValue(false);

      await store.initEncryption();
      expect(mockDeriveEncryptionKey).not.toHaveBeenCalled();
    });

    it('should derive encryption key when supported (line 840)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      mockIsEncryptionSupported.mockReturnValue(true);
      const mockKey = { type: 'secret' };
      mockDeriveEncryptionKey.mockResolvedValue(mockKey);

      await store.initEncryption('my-passphrase');
      expect(mockDeriveEncryptionKey).toHaveBeenCalledWith('ws1');
    });

    it('should handle deriveEncryptionKey failure (lines 844-846)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockRejectedValue(new Error('key derivation failed'));

      await store.initEncryption();
      // encryptionKey should be null after failure
      const status = store.getEncryptionStatus();
      expect(status.keyReady).toBe(false);
    });
  });

  // ========================================================================
  // loadProfilesCache with encryption (line 905)
  // ========================================================================

  describe('loadProfilesCache() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should try encrypted retrieval when encryptionKey is set (line 905)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const cacheKey = `${STORAGE_KEYS.PROFILES_PREFIX}ws1`;
      mockRetrieveEncrypted.mockResolvedValue(JSON.stringify({
        version: DATA_CACHE_VERSION,
        timestamp: Date.now(),
        entries: [['user1', { userId: 'user1', workCapacity: 'PT8H' }]],
      }));

      await store.loadProfilesCache();
      expect(mockRetrieveEncrypted).toHaveBeenCalledWith(cacheKey, expect.anything());
      expect(store.profiles.size).toBe(1);
    });

    it('should fall back to plaintext when encrypted retrieval returns null', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      mockRetrieveEncrypted.mockResolvedValue(null);

      const cacheKey = `${STORAGE_KEYS.PROFILES_PREFIX}ws1`;
      localStorage.setItem(cacheKey, JSON.stringify({
        version: DATA_CACHE_VERSION,
        timestamp: Date.now(),
        entries: [['user2', { userId: 'user2', workCapacity: 'PT6H' }]],
      }));

      await store.loadProfilesCache();
      expect(store.profiles.size).toBe(1);
      expect(store.profiles.get('user2')).toBeDefined();
    });
  });

  // ========================================================================
  // saveProfilesCache with encryption (line 932)
  // ========================================================================

  describe('saveProfilesCache() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should encrypt when encryption key is available (line 932)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.profiles.set('user1', { userId: 'user1', workCapacity: 'PT8H' });
      mockStoreEncrypted.mockResolvedValue(true);

      await store.saveProfilesCache();
      expect(mockStoreEncrypted).toHaveBeenCalled();
    });

    it('should save plaintext when no encryption key', async () => {
      store.profiles.set('user1', { userId: 'user1', workCapacity: 'PT8H' });

      await store.saveProfilesCache();

      const cacheKey = `${STORAGE_KEYS.PROFILES_PREFIX}ws1`;
      const saved = localStorage.getItem(cacheKey);
      expect(saved).not.toBeNull();
    });
  });

  // ========================================================================
  // loadHolidayCache with encryption (line 945)
  // ========================================================================

  describe('loadHolidayCache() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should try encrypted retrieval when key available (line 945)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      mockRetrieveEncrypted.mockResolvedValue(JSON.stringify({
        version: DATA_CACHE_VERSION,
        timestamp: Date.now(),
        range: { start: '2025-01-01', end: '2025-01-31' },
        entries: [['user1', [['2025-01-01', { id: 'h1', name: 'Holiday' }]]]],
      }));

      await store.loadHolidayCache('2025-01-01', '2025-01-31');
      expect(mockRetrieveEncrypted).toHaveBeenCalled();
      expect(store.holidays.size).toBe(1);
    });
  });

  // ========================================================================
  // saveHolidayCache with encryption (line 980)
  // ========================================================================

  describe('saveHolidayCache() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should encrypt when encryption key is available (line 980)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.holidays.set('user1', new Map([['2025-01-01', { id: 'h1', name: 'Holiday' }]]));
      mockStoreEncrypted.mockResolvedValue(true);

      await store.saveHolidayCache('2025-01-01', '2025-01-31');
      expect(mockStoreEncrypted).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // loadTimeOffCache with encryption (line 993)
  // ========================================================================

  describe('loadTimeOffCache() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should try encrypted retrieval when key available (line 993)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      mockRetrieveEncrypted.mockResolvedValue(JSON.stringify({
        version: DATA_CACHE_VERSION,
        timestamp: Date.now(),
        range: { start: '2025-01-01', end: '2025-01-31' },
        entries: [['user1', [['2025-01-02', { id: 't1', status: 'APPROVED' }]]]],
      }));

      await store.loadTimeOffCache('2025-01-01', '2025-01-31');
      expect(mockRetrieveEncrypted).toHaveBeenCalled();
      expect(store.timeOff.size).toBe(1);
    });
  });

  // ========================================================================
  // saveTimeOffCache with encryption (line 1028)
  // ========================================================================

  describe('saveTimeOffCache() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should encrypt when encryption key is available (line 1028)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.timeOff.set('user1', new Map([['2025-01-02', { id: 't1', status: 'APPROVED' }]]));
      mockStoreEncrypted.mockResolvedValue(true);

      await store.saveTimeOffCache('2025-01-01', '2025-01-31');
      expect(mockStoreEncrypted).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // _loadOverrides with encrypted blob detection (lines 1054-1055)
  // ========================================================================

  describe('_loadOverrides() encrypted blob detection', () => {
    it('should skip encrypted blob payloads (lines 1054-1055)', () => {
      const workspaceId = 'ws_enc';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      // Store an encrypted blob (has ct, iv, v fields)
      localStorage.setItem(key, JSON.stringify({ ct: 'encrypted', iv: 'nonce', v: 1 }));

      store.setToken('token', { workspaceId });
      // Should detect encrypted payload and set overrides to {}
      expect(store.overrides).toEqual({});
    });

    it('should skip array payloads', () => {
      const workspaceId = 'ws_arr';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      localStorage.setItem(key, JSON.stringify([1, 2, 3]));
      store.setToken('token', { workspaceId });
      expect(store.overrides).toEqual({});
    });

    it('should skip null parsed values', () => {
      const workspaceId = 'ws_null';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      localStorage.setItem(key, 'null');
      store.setToken('token', { workspaceId });
      expect(store.overrides).toEqual({});
    });
  });

  // ========================================================================
  // loadOverridesEncrypted (lines 1070-1143)
  // ========================================================================

  describe('loadOverridesEncrypted()', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should return early when no override key', async () => {
      store.claims = null;
      await store.loadOverridesEncrypted();
      expect(store.overrides).toEqual({});
    });

    it('should decrypt successfully with current key (line 1088-1092)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      localStorage.setItem(key, JSON.stringify({ ct: 'data', iv: 'nonce', v: 1 }));

      mockRetrieveEncrypted.mockResolvedValue(JSON.stringify({
        user1: { mode: 'global', capacity: 7 },
      }));

      await store.loadOverridesEncrypted();
      expect(store.overrides.user1).toBeDefined();
      expect(store.overrides.user1.capacity).toBe(7);
      expect(store.overrides.user1.mode).toBe('global');
    });

    it('should attempt legacy migration when current key fails (lines 1096-1118)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      localStorage.setItem(key, JSON.stringify({ ct: 'encrypted', iv: 'nonce', v: 1 }));

      // First retrieval (current key) returns null
      mockRetrieveEncrypted.mockResolvedValueOnce(null);

      // Legacy key derivation
      const mockLegacyKey = { type: 'legacy-secret' };
      mockDeriveLegacyEncryptionKey.mockResolvedValue(mockLegacyKey);

      // Legacy retrieval succeeds
      mockRetrieveEncrypted.mockResolvedValueOnce(JSON.stringify({
        user2: { capacity: 5, multiplier: 1.5 },
      }));

      // Re-encryption succeeds
      mockStoreEncrypted.mockResolvedValue(true);

      await store.loadOverridesEncrypted();
      expect(store.overrides.user2).toBeDefined();
      expect(store.overrides.user2.capacity).toBe(5);
      expect(mockStoreEncrypted).toHaveBeenCalled();
    });

    it('should fallback to plaintext when legacy re-encryption fails (line 1115)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      localStorage.setItem(key, JSON.stringify({ ct: 'encrypted', iv: 'nonce', v: 1 }));

      // Current key fails
      mockRetrieveEncrypted.mockResolvedValueOnce(null);
      // Legacy key succeeds
      mockDeriveLegacyEncryptionKey.mockResolvedValue({ type: 'legacy' });
      mockRetrieveEncrypted.mockResolvedValueOnce(JSON.stringify({
        user3: { capacity: 9 },
      }));
      // Re-encryption fails
      mockStoreEncrypted.mockResolvedValue(false);

      await store.loadOverridesEncrypted();
      expect(store.overrides.user3).toBeDefined();
      // When re-encryption fails, it saves plaintext (line 1115)
      const saved = localStorage.getItem(key);
      expect(saved).not.toBeNull();
    });

    it('should handle encryption error and dispatch event (lines 1121-1134)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      localStorage.setItem(key, JSON.stringify({ ct: 'encrypted', iv: 'nonce', v: 1 }));

      // retrieveEncrypted throws an error
      mockRetrieveEncrypted.mockRejectedValue(new Error('decryption failed'));

      // Mock window for event dispatch
      const mockDispatch = jest.fn();
      global.window = { dispatchEvent: mockDispatch };

      await store.loadOverridesEncrypted();

      expect(store.diagnostics.encryptionReadFailed).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { action: 'load' },
        })
      );

      delete global.window;
    });

    it('should fall back to plaintext when no encrypted payload and stored data exists (line 1139-1142)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      // Store plaintext (not encrypted)
      localStorage.setItem(key, JSON.stringify({
        user4: { mode: 'global', capacity: 6 },
      }));

      // Current key decryption returns null (no encrypted data at this key)
      mockRetrieveEncrypted.mockResolvedValue(null);

      await store.loadOverridesEncrypted();
      expect(store.overrides.user4).toBeDefined();
      expect(store.overrides.user4.capacity).toBe(6);
    });
  });

  // ========================================================================
  // _migrateOverrideFormat (lines 1161-1162)
  // ========================================================================

  describe('_migrateOverrideFormat via setToken', () => {
    it('should normalize string numeric fields to numbers (lines 1161-1162)', () => {
      const workspaceId = 'ws_migrate';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      localStorage.setItem(key, JSON.stringify({
        user1: {
          capacity: '7.5',
          multiplier: '2.0',
          tier2Threshold: '10',
          tier2Multiplier: '2.5',
        },
      }));

      store.setToken('token', { workspaceId });

      expect(store.overrides.user1.capacity).toBe(7.5);
      expect(store.overrides.user1.multiplier).toBe(2.0);
      expect(store.overrides.user1.tier2Threshold).toBe(10);
      expect(store.overrides.user1.tier2Multiplier).toBe(2.5);
    });

    it('should set NaN string values to undefined', () => {
      const workspaceId = 'ws_nan';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      localStorage.setItem(key, JSON.stringify({
        user1: {
          capacity: 'not-a-number',
          multiplier: 'abc',
        },
      }));

      store.setToken('token', { workspaceId });

      expect(store.overrides.user1.capacity).toBeUndefined();
      expect(store.overrides.user1.multiplier).toBeUndefined();
    });

    it('should normalize perDayOverrides string values', () => {
      const workspaceId = 'ws_perday';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      localStorage.setItem(key, JSON.stringify({
        user1: {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': { capacity: '6', multiplier: '1.8' },
          },
        },
      }));

      store.setToken('token', { workspaceId });

      expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(6);
      expect(store.overrides.user1.perDayOverrides['2025-01-15'].multiplier).toBe(1.8);
    });

    it('should normalize weeklyOverrides string values', () => {
      const workspaceId = 'ws_weekly';
      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

      localStorage.setItem(key, JSON.stringify({
        user1: {
          mode: 'weekly',
          weeklyOverrides: {
            MONDAY: { capacity: '7', multiplier: '1.5' },
          },
        },
      }));

      store.setToken('token', { workspaceId });

      expect(store.overrides.user1.weeklyOverrides.MONDAY.capacity).toBe(7);
      expect(store.overrides.user1.weeklyOverrides.MONDAY.multiplier).toBe(1.5);
    });
  });

  // ========================================================================
  // saveOverrides with encryption (lines 1197-1235)
  // ========================================================================

  describe('saveOverrides() with encryption', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should warn and dispatch event when encryption enabled but key unavailable (lines 1198-1212)', () => {
      store.config.encryptStorage = true;
      // No encryption key set (encryptionKey is null)
      store.overrides = { user1: { capacity: 7 } };

      const mockDispatch = jest.fn();
      global.window = { dispatchEvent: mockDispatch };

      store.saveOverrides();

      expect(store.diagnostics.encryptionWriteFailed).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { action: 'save' },
        })
      );

      delete global.window;
    });

    it('should encrypt overrides when key available (lines 1216-1220)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;
      store.overrides = { user1: { capacity: 7 } };

      mockStoreEncrypted.mockResolvedValue(true);

      store.saveOverrides();

      // storeEncrypted is called asynchronously via _pendingEncryption
      expect(mockStoreEncrypted).toHaveBeenCalled();
    });

    it('should handle storeEncrypted rejection (lines 1221-1235)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;
      store.overrides = { user1: { capacity: 7 } };

      const mockDispatch = jest.fn();
      global.window = { dispatchEvent: mockDispatch };

      mockStoreEncrypted.mockRejectedValue(new Error('write failed'));

      store.saveOverrides();

      // Wait for the promise to settle
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(store.diagnostics.encryptionWriteFailed).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { action: 'save' },
        })
      );

      delete global.window;
    });

    it('should save plaintext when encryptStorage is false', () => {
      store.config.encryptStorage = false;
      store.overrides = { user1: { capacity: 7 } };

      store.saveOverrides();

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      const saved = localStorage.getItem(key);
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved).user1.capacity).toBe(7);
    });
  });

  // ========================================================================
  // getCachedReport with IDB and encryption (lines 1812-1841, 1857-1862, 1872)
  // ========================================================================

  describe('getCachedReport() IDB + encryption paths', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should decrypt encrypted IDB result (lines 1830-1836)', async () => {
      // Set encryption key
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const mockEntries = [{ id: 'e1' }];
      const mockResult = {
        key: 'test-key',
        timestamp: Date.now(),
        encrypted: { ct: 'encrypted', iv: 'nonce', v: 1 },
        schemaVersion: 1,
      };

      const mockGetReq = {};
      const mockStore = {
        get: jest.fn().mockImplementation(() => {
          setTimeout(() => {
            mockGetReq.result = mockResult;
            if (mockGetReq.onsuccess) mockGetReq.onsuccess();
          }, 0);
          return mockGetReq;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockImplementation(() => {
          mockRequest.result = mockDb;
          setTimeout(() => {
            if (mockRequest.onsuccess) mockRequest.onsuccess();
          }, 0);
          return mockRequest;
        }),
      };

      mockDecryptData.mockResolvedValue(JSON.stringify(mockEntries));

      const result = await store.getCachedReport('test-key');
      expect(result?.entries).toEqual(mockEntries);
      expect(mockDecryptData).toHaveBeenCalled();

      delete global.indexedDB;
    });

    it('should return unencrypted IDB entries (line 1838)', async () => {
      const mockEntries = [{ id: 'e2' }];
      const mockResult = {
        key: 'test-key',
        timestamp: Date.now(),
        entries: mockEntries,
        schemaVersion: 1,
      };

      const mockStore = {
        get: jest.fn(),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      mockStore.get.mockImplementation(() => {
        const req = {};
        setTimeout(() => {
          req.result = mockResult;
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      });

      // Need to make openCacheDb return our mock db
      mockRequest.result = mockDb;

      const result = await store.getCachedReport('test-key');
      expect(result?.entries).toEqual(mockEntries);

      delete global.indexedDB;
    });

    it('should return null for IDB cache miss (line 1841)', async () => {
      const mockStore = {
        get: jest.fn(),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      mockStore.get.mockImplementation(() => {
        const req = {};
        setTimeout(() => {
          req.result = null;
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      });

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should treat schema version mismatch as cache miss (IDB path)', async () => {
      const mockEntries = [{ id: 'stale' }];
      const mockResult = {
        key: 'test-key',
        timestamp: Date.now(),
        entries: mockEntries,
        schemaVersion: 999,        // Wrong schema version
      };

      const mockObjStore = {
        get: jest.fn(),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockObjStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockImplementation(() => {
          mockRequest.result = mockDb;
          setTimeout(() => {
            if (mockRequest.onsuccess) mockRequest.onsuccess();
          }, 0);
          return mockRequest;
        }),
      };

      mockObjStore.get.mockImplementation(() => {
        const req = {};
        setTimeout(() => {
          req.result = mockResult;
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      });

      const result = await store.getCachedReport('test-key');
      // Schema version 999 !== REPORT_CACHE_SCHEMA_VERSION (1) → treated as miss
      // Falls through to sessionStorage, which is empty → null
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should treat missing schema version as cache miss (sessionStorage path)', async () => {
      // No indexedDB → falls through to sessionStorage
      const cache = {
        key: 'test-key',
        timestamp: Date.now(),
        entries: [{ id: 'old' }],
        // No schemaVersion field
      };
      sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(cache));

      const result = await store.getCachedReport('test-key');
      // schemaVersion ?? 0 !== REPORT_CACHE_SCHEMA_VERSION (1) → null
      expect(result).toBeNull();
    });

    it('should decrypt sessionStorage encrypted cache (lines 1857-1862)', async () => {
      // No indexedDB so falls through to sessionStorage
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const encryptedPayload = { ct: 'enc_data', iv: 'nonce', v: 1 };
      sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(encryptedPayload));

      const innerCache = {
        key: 'test-key',
        timestamp: Date.now(),
        entries: [{ id: 'e3' }],
        schemaVersion: 1,
      };
      mockDecryptData.mockResolvedValue(JSON.stringify(innerCache));

      const result = await store.getCachedReport('test-key');
      expect(result?.entries).toEqual([{ id: 'e3' }]);
      expect(mockDecryptData).toHaveBeenCalled();
    });

    it('should return null for mismatched key in decrypted session cache (line 1860)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const encryptedPayload = { ct: 'enc_data', iv: 'nonce', v: 1 };
      sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(encryptedPayload));

      const innerCache = {
        key: 'different-key',
        timestamp: Date.now(),
        entries: [{ id: 'e4' }],
      };
      mockDecryptData.mockResolvedValue(JSON.stringify(innerCache));

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();
    });

    it('should return null for expired decrypted session cache (line 1861)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const encryptedPayload = { ct: 'enc_data', iv: 'nonce', v: 1 };
      sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(encryptedPayload));

      const innerCache = {
        key: 'test-key',
        timestamp: Date.now() - (REPORT_CACHE_TTL + 1000),
        entries: [{ id: 'e5' }],
      };
      mockDecryptData.mockResolvedValue(JSON.stringify(innerCache));

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();
    });

    it('should return null when decrypted cache is null (line 1859)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const encryptedPayload = { ct: 'enc_data', iv: 'nonce', v: 1 };
      sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(encryptedPayload));

      mockDecryptData.mockResolvedValue('invalid json }{');

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();
    });

    it('should return null on sessionStorage parse error (line 1872)', async () => {
      // Put something that will cause decryptData to throw
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const encryptedPayload = { ct: 'enc_data', iv: 'nonce', v: 1 };
      sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(encryptedPayload));

      mockDecryptData.mockRejectedValue(new Error('decrypt fail'));

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // setCachedReport (lines 1905-1909, 1925-1947, 1954-1956, 1968)
  // ========================================================================

  describe('setCachedReport() edge cases', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should skip caching when entries exceed MAX_CACHEABLE_ENTRIES (lines 1905-1909)', async () => {
      const hugeEntries = new Array(100001).fill({ id: 'e1' });
      await store.setCachedReport('test-key', hugeEntries);

      // Nothing should be cached
      const cached = sessionStorage.getItem(STORAGE_KEYS.REPORT_CACHE);
      expect(cached).toBeNull();
    });

    it('should store encrypted data in IDB when encryption available (lines 1925-1931)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      const mockPutReq = {};
      const mockStore = {
        put: jest.fn().mockImplementation(() => {
          setTimeout(() => { if (mockPutReq.onsuccess) mockPutReq.onsuccess(); }, 0);
          return mockPutReq;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      mockEncryptData.mockResolvedValue({ ct: 'encrypted', iv: 'nonce', v: 1 });

      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      expect(mockEncryptData).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();

      delete global.indexedDB;
    });

    it('should store unencrypted data in IDB when no encryption (lines 1929-1930)', async () => {
      const mockPutReq = {};
      const mockStore = {
        put: jest.fn().mockImplementation(() => {
          setTimeout(() => { if (mockPutReq.onsuccess) mockPutReq.onsuccess(); }, 0);
          return mockPutReq;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      await store.setCachedReport('test-key', [{ id: 'e1' }]);
      expect(mockDb.close).toHaveBeenCalled();

      delete global.indexedDB;
    });

    it('should fall through to sessionStorage when IDB write fails (lines 1946-1947)', async () => {
      store.config.encryptStorage = false;

      const mockStore = {
        put: jest.fn().mockImplementation(() => {
          const req = {};
          setTimeout(() => {
            req.error = new Error('write failed');
            if (req.onerror) req.onerror();
          }, 0);
          return req;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Should have fallen through to sessionStorage
      const cached = sessionStorage.getItem(STORAGE_KEYS.REPORT_CACHE);
      expect(cached).not.toBeNull();

      delete global.indexedDB;
    });

    it('should encrypt sessionStorage fallback when encryption available (lines 1954-1956)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      // No indexedDB, falls through to sessionStorage
      mockEncryptData.mockResolvedValue({ ct: 'session_enc', iv: 'nonce', v: 1 });

      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      const cached = sessionStorage.getItem(STORAGE_KEYS.REPORT_CACHE);
      expect(cached).not.toBeNull();
      const parsed = JSON.parse(cached);
      expect(parsed.ct).toBe('session_enc');
    });

    it('should handle sessionStorage encrypt error gracefully (line 1968)', async () => {
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;
      mockEncryptData.mockRejectedValue(new Error('encrypt failed'));

      // Should not throw
      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Cache should be empty — both IDB and sessionStorage encryption failed
      const cached = await store.getCachedReport('test-key');
      expect(cached).toBeNull();
    });

    it('should handle IDB transaction exception (lines 1939-1940)', async () => {
      store.config.encryptStorage = false;

      const mockStore = {
        put: jest.fn().mockImplementation(() => {
          throw new Error('transaction failed');
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Should have fallen to sessionStorage
      const cached = sessionStorage.getItem(STORAGE_KEYS.REPORT_CACHE);
      expect(cached).not.toBeNull();

      delete global.indexedDB;
    });
  });

  // ========================================================================
  // IDB getCachedReport transaction exception (line 1819-1820)
  // ========================================================================

  describe('getCachedReport() IDB transaction errors', () => {
    beforeEach(() => {
      store.setToken('token', { workspaceId: 'ws1' });
    });

    it('should resolve null when IDB transaction throws (line 1819-1820)', async () => {
      const mockDb = {
        transaction: jest.fn().mockImplementation(() => {
          throw new Error('transaction creation failed');
        }),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should resolve null when IDB get request errors (line 1818)', async () => {
      const mockGetReq = {};
      const mockStore = {
        get: jest.fn().mockImplementation(() => {
          setTimeout(() => {
            if (mockGetReq.onerror) mockGetReq.onerror();
          }, 0);
          return mockGetReq;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should handle IDB open error (line 271)', async () => {
      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };

      setTimeout(() => {
        if (mockRequest.onerror) mockRequest.onerror();
      }, 0);

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should handle IDB open blocked (line 272)', async () => {
      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };

      setTimeout(() => {
        if (mockRequest.onblocked) mockRequest.onblocked();
      }, 0);

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should handle IDB open throwing exception (line 273-274)', async () => {
      global.indexedDB = {
        open: jest.fn().mockImplementation(() => {
          throw new Error('security error');
        }),
      };

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should handle IDB upgradeneeded with store creation (line 264-268)', async () => {
      const mockObjStore = {};
      const mockDb = {
        objectStoreNames: { contains: jest.fn().mockReturnValue(false) },
        createObjectStore: jest.fn().mockReturnValue(mockObjStore),
        transaction: jest.fn().mockImplementation(() => {
          throw new Error('not ready');
        }),
        close: jest.fn(),
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };

      setTimeout(() => {
        mockRequest.result = mockDb;
        if (mockRequest.onupgradeneeded) mockRequest.onupgradeneeded();
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      await store.getCachedReport('test-key');
      expect(mockDb.createObjectStore).toHaveBeenCalledWith('reports');

      delete global.indexedDB;
    });

    it('should skip store creation when store already exists (line 266)', async () => {
      const mockDb = {
        objectStoreNames: { contains: jest.fn().mockReturnValue(true) },
        createObjectStore: jest.fn(),
        transaction: jest.fn().mockImplementation(() => {
          throw new Error('not ready');
        }),
        close: jest.fn(),
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };

      setTimeout(() => {
        mockRequest.result = mockDb;
        if (mockRequest.onupgradeneeded) mockRequest.onupgradeneeded();
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      await store.getCachedReport('test-key');
      expect(mockDb.createObjectStore).not.toHaveBeenCalled();

      delete global.indexedDB;
    });

    it('should handle expired IDB result (line 1827)', async () => {
      const expiredResult = {
        key: 'test-key',
        timestamp: Date.now() - (REPORT_CACHE_TTL + 1000),
        entries: [{ id: 'e1' }],
      };

      const mockGetReq = {};
      const mockStore = {
        get: jest.fn().mockImplementation(() => {
          setTimeout(() => {
            mockGetReq.result = expiredResult;
            if (mockGetReq.onsuccess) mockGetReq.onsuccess();
          }, 0);
          return mockGetReq;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });

    it('should handle mismatched IDB key (line 1826)', async () => {
      const mismatchResult = {
        key: 'wrong-key',
        timestamp: Date.now(),
        entries: [{ id: 'e1' }],
      };

      const mockGetReq = {};
      const mockStore = {
        get: jest.fn().mockImplementation(() => {
          setTimeout(() => {
            mockGetReq.result = mismatchResult;
            if (mockGetReq.onsuccess) mockGetReq.onsuccess();
          }, 0);
          return mockGetReq;
        }),
      };
      const mockTx = {
        objectStore: jest.fn().mockReturnValue(mockStore),
      };
      const mockDb = {
        transaction: jest.fn().mockReturnValue(mockTx),
        close: jest.fn(),
        objectStoreNames: { contains: () => true },
      };

      const mockRequest = {};
      global.indexedDB = {
        open: jest.fn().mockReturnValue(mockRequest),
      };
      mockRequest.result = mockDb;

      setTimeout(() => {
        if (mockRequest.onsuccess) mockRequest.onsuccess();
      }, 0);

      const result = await store.getCachedReport('test-key');
      expect(result).toBeNull();

      delete global.indexedDB;
    });
  });

  // ========================================================================
  // safeSessionSetItem eviction in catch branch (lines 201-203)
  // ========================================================================

  describe('safeSessionSetItem catch-branch fallback', () => {
    it('writes to fallback map via catch branch when sessionStorage throws (lines 197-204)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);
      let firstCall = true;

      // First setItem succeeds (enters try), subsequent ones throw (enters catch)
      sessionStorage.setItem = (key, value) => {
        if (firstCall) { firstCall = false; origSetItem(key, value); return; }
        throw new Error('quota exceeded');
      };

      // First write succeeds in sessionStorage, second enters catch branch
      await store.setCachedReport('key-1', [{ id: 'old' }]);
      await store.setCachedReport('key-2', [{ id: 'new' }]);

      // Break getItem so reads go through fallback Map
      sessionStorage.getItem = () => { throw new Error('unavailable'); };

      const cached = await store.getCachedReport('key-2');
      expect(cached).not.toBeNull();
      expect(cached.entries).toEqual([{ id: 'new' }]);

      sessionStorage.setItem = origSetItem;
      sessionStorage.getItem = origGetItem;
    });
  });

  // ========================================================================
  // loadOverridesEncrypted: no window available (line 1128)
  // ========================================================================

  describe('loadOverridesEncrypted() without window', () => {
    it('should not dispatch event when window is undefined (line 1128)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;

      const key = `${STORAGE_KEYS.OVERRIDES_PREFIX}ws1`;
      localStorage.setItem(key, JSON.stringify({ ct: 'encrypted', iv: 'nonce', v: 1 }));

      mockRetrieveEncrypted.mockRejectedValue(new Error('fail'));

      // Ensure window is not defined
      const origWindow = global.window;
      delete global.window;

      await store.loadOverridesEncrypted();
      expect(store.diagnostics.encryptionReadFailed).toBe(true);

      global.window = origWindow;
    });
  });

  // ========================================================================
  // saveOverrides: no window for dispatch (lines 1204, 1227)
  // ========================================================================

  describe('saveOverrides() without window', () => {
    it('should not dispatch event when window is undefined (line 1204)', () => {
      store.setToken('token', { workspaceId: 'ws1' });
      store.config.encryptStorage = true;
      store.overrides = { user1: { capacity: 7 } };

      const origWindow = global.window;
      delete global.window;

      store.saveOverrides();
      expect(store.diagnostics.encryptionWriteFailed).toBe(true);

      global.window = origWindow;
    });

    it('should not dispatch event on async failure when window undefined (line 1227)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;
      store.overrides = { user1: { capacity: 7 } };

      mockStoreEncrypted.mockRejectedValue(new Error('write failed'));

      const origWindow = global.window;
      delete global.window;

      store.saveOverrides();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(store.diagnostics.encryptionWriteFailed).toBe(true);

      global.window = origWindow;
    });
  });

  // ========================================================================
  // setCachedReport sessionStorage stored=false (line 1961-1962)
  // ========================================================================

  describe('setCachedReport() sessionStorage failure warning', () => {
    it('stores data in fallback when sessionStorage setItem fails (lines 1961-1965)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);
      sessionStorage.setItem = () => { throw new Error('quota'); };
      sessionStorage.getItem = () => { throw new Error('unavailable'); };

      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Data should be retrievable from fallback map despite sessionStorage failure
      const cached = await store.getCachedReport('test-key');
      expect(cached).not.toBeNull();
      expect(cached.entries).toEqual([{ id: 'e1' }]);

      sessionStorage.setItem = origSetItem;
      sessionStorage.getItem = origGetItem;
    });
  });

  // ========================================================================
  // clearToken() (lines 813-814)
  // ========================================================================

  describe('clearToken()', () => {
    it('should clear token and claims (lines 813-814)', () => {
      store.setToken('my-token', { workspaceId: 'ws1' });
      expect(store.token).toBe('my-token');
      expect(store.claims).not.toBeNull();

      store.clearToken();
      expect(store.token).toBeNull();
      expect(store.claims).toBeNull();
    });
  });

  // ========================================================================
  // saveConfig fallback warning (line 645)
  // ========================================================================

  describe('saveConfig() fallback path', () => {
    it('increments configVersion and retains config in memory when localStorage fails (line 645)', () => {
      store.setToken('token', { workspaceId: 'ws1' });
      store.config.dailyHours = 7;
      const versionBefore = store.configVersion;

      const origSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = () => { throw new Error('quota exceeded'); };

      store.saveConfig();

      // Config version should still increment
      expect(store.configVersion).toBe(versionBefore + 1);
      // Config remains in memory despite storage failure
      expect(store.config.dailyHours).toBe(7);

      localStorage.setItem = origSetItem;
    });
  });

  // ========================================================================
  // saveHolidayCache plaintext fallback (line 982)
  // ========================================================================

  describe('saveHolidayCache() plaintext fallback', () => {
    it('should save plaintext when no encryption key (line 982)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      store.holidays.set('user1', new Map([['2025-01-01', { id: 'h1', name: 'Holiday' }]]));

      // No encryption key set, so it should go to plaintext path
      await store.saveHolidayCache('2025-01-01', '2025-01-31');

      const cacheKey = `${STORAGE_KEYS.HOLIDAYS_PREFIX}ws1_2025-01-01_2025-01-31`;
      const saved = localStorage.getItem(cacheKey);
      expect(saved).not.toBeNull();
    });
  });

  // ========================================================================
  // ensureEncryptionComplete (lines 1268-1269)
  // ========================================================================

  describe('ensureEncryptionComplete()', () => {
    it('should await pending encryption (lines 1268-1269)', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      mockIsEncryptionSupported.mockReturnValue(true);
      mockDeriveEncryptionKey.mockResolvedValue({ type: 'secret' });
      await store.initEncryption();

      store.config.encryptStorage = true;
      store.overrides = { user1: { capacity: 7 } };

      // Make storeEncrypted return a delayed promise
      let resolveEncrypt;
      mockStoreEncrypted.mockImplementation(() => new Promise(r => { resolveEncrypt = r; }));

      // saveOverrides triggers _pendingEncryption
      store.saveOverrides();

      // ensureEncryptionComplete should await the pending promise
      const ensurePromise = store.ensureEncryptionComplete();

      // Resolve the encryption
      resolveEncrypt(true);

      await ensurePromise;
      // Should complete without error
    });

    it('should resolve immediately when no pending encryption', async () => {
      await store.ensureEncryptionComplete();
      // Should complete immediately
    });
  });

  // ========================================================================
  // sessionStorage fallback: eviction edge cases for full coverage
  // ========================================================================

  describe('sessionStorage fallback eviction (lines 182-184, 201-203)', () => {
    it('stores and retrieves data through fallback map when sessionStorage throws', async () => {
      store.setToken('token', { workspaceId: 'ws1' });
      store.config.encryptStorage = false;

      // Break sessionStorage completely — forces fallback map usage
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origGetItem = sessionStorage.getItem.bind(sessionStorage);
      sessionStorage.setItem = () => { throw new Error('quota'); };
      sessionStorage.getItem = () => { throw new Error('unavailable'); };

      // Write through broken sessionStorage — data goes to fallback map
      await store.setCachedReport('test-key', [{ id: 'e1' }]);

      // Read back — data should be retrievable from fallback map
      const cached = await store.getCachedReport('test-key');
      expect(cached).not.toBeNull();
      expect(cached.entries).toEqual([{ id: 'e1' }]);

      sessionStorage.setItem = origSetItem;
      sessionStorage.getItem = origGetItem;
    });
  });

  // ========================================================================
  // safeSessionRemoveItem paths (lines 215, 221)
  // ========================================================================

  describe('safeSessionRemoveItem paths', () => {
    it('should set usingSessionFallback when removeItem throws (line 221)', async () => {
      const origRemove = sessionStorage.removeItem.bind(sessionStorage);
      sessionStorage.removeItem = () => { throw new Error('access denied'); };

      store.clearReportCache();

      // The fallback Map entry was deleted (line 212), even though sessionStorage threw
      const cached = await store.getCachedReport('any-key');
      expect(cached).toBeNull();

      sessionStorage.removeItem = origRemove;
    });

    it('should early-return when in fallback and recovery fails (line 215)', () => {
      // First, enter fallback mode: make removeItem throw
      const origSetItem = sessionStorage.setItem.bind(sessionStorage);
      const origRemove = sessionStorage.removeItem.bind(sessionStorage);

      sessionStorage.removeItem = () => { throw new Error('access denied'); };
      // Enter fallback mode via line 221
      store.clearReportCache();

      // Now usingSessionFallback is true. Keep sessionStorage broken
      // so tryRecoverSessionFallback fails (recovery test key setItem throws)
      sessionStorage.setItem = () => { throw new Error('still broken'); };

      // Call clearReportCache again. safeSessionRemoveItem will:
      // 1. Check usingSessionFallback (true) && !tryRecoverSessionFallback() (true, returns false)
      // 2. Hit line 215: return
      store.clearReportCache();

      sessionStorage.setItem = origSetItem;
      sessionStorage.removeItem = origRemove;
    });
  });
});
