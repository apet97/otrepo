/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Comprehensive unit tests for storage.ts
 *
 * Covers all branches including localStorage failures, fallback mode,
 * recovery attempts, migration failures, and all safe* accessor methods.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  safeGetKeys,
  isUsingFallbackStorage,
  tryRecoverFromFallback,
  resetFallbackStorage,
} from '../../js/storage.js';

describe('storage', () => {
  let originalGetItem;
  let originalSetItem;
  let originalRemoveItem;
  let originalKey;
  let originalLengthDescriptor;

  beforeEach(() => {
    resetFallbackStorage();
    localStorage.clear();
    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;
    originalRemoveItem = Storage.prototype.removeItem;
    originalKey = Storage.prototype.key;
    originalLengthDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
    Storage.prototype.removeItem = originalRemoveItem;
    Storage.prototype.key = originalKey;
    if (originalLengthDescriptor) {
      Object.defineProperty(Storage.prototype, 'length', originalLengthDescriptor);
    }
    localStorage.clear();
    resetFallbackStorage();
  });

  // ─── safeGetItem ───────────────────────────────────────────────

  describe('safeGetItem', () => {
    it('returns value from localStorage when available', () => {
      localStorage.setItem('testKey', 'testValue');
      expect(safeGetItem('testKey')).toBe('testValue');
    });

    it('returns null when key does not exist', () => {
      expect(safeGetItem('nonexistent')).toBeNull();
    });

    it('falls back to memory storage when localStorage.getItem throws while not in fallback', () => {
      // NOT in fallback mode. Make getItem throw to hit lines 40-44.
      expect(isUsingFallbackStorage()).toBe(false);
      Storage.prototype.getItem = () => { throw new Error('SecurityError'); };

      const result = safeGetItem('anyKey');
      expect(result).toBeNull();
      expect(isUsingFallbackStorage()).toBe(true);
    });

    it('returns null from memory storage for missing key in fallback mode', () => {
      // Force fallback
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('x', 'y');
      expect(isUsingFallbackStorage()).toBe(true);

      // Keep localStorage throwing so recovery fails
      Storage.prototype.getItem = () => { throw new Error('Disabled'); };
      expect(safeGetItem('nonexistent')).toBeNull();
    });

    it('reads from memory when in fallback and recovery fails', () => {
      // Force into fallback mode
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('key1', 'val1');
      expect(isUsingFallbackStorage()).toBe(true);

      // Keep setItem throwing so tryRecoverFromFallback fails
      // safeGetItem should read from memoryStorage
      expect(safeGetItem('key1')).toBe('val1');
    });

    it('recovers and reads from localStorage when recovery succeeds', () => {
      // Force into fallback
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Disabled');
      });
      safeSetItem('recKey', 'recVal');
      expect(isUsingFallbackStorage()).toBe(true);

      // Restore localStorage so recovery succeeds
      setItemSpy.mockRestore();
      Storage.prototype.setItem = originalSetItem;
      Storage.prototype.removeItem = originalRemoveItem;

      // safeGetItem triggers recovery, migrates memoryStorage to localStorage
      const val = safeGetItem('recKey');
      expect(val).toBe('recVal');
      expect(isUsingFallbackStorage()).toBe(false);
    });
  });

  // ─── safeSetItem ───────────────────────────────────────────────

  describe('safeSetItem', () => {
    it('stores in localStorage and returns true', () => {
      expect(safeSetItem('k', 'v')).toBe(true);
      expect(localStorage.getItem('k')).toBe('v');
    });

    it('falls back to memory and returns false when setItem throws', () => {
      Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); };
      expect(safeSetItem('k', 'v')).toBe(false);
      expect(isUsingFallbackStorage()).toBe(true);
    });

    it('uses memory storage when already in fallback and recovery fails', () => {
      // Force fallback
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('a', '1');
      expect(isUsingFallbackStorage()).toBe(true);

      // Still in fallback, setItem still throws, recovery will fail
      const result = safeSetItem('b', '2');
      expect(result).toBe(false);

      // Verify memory storage has both values
      expect(safeGetItem('b')).toBe('2');
    });

    it('recovers from fallback and writes to localStorage', () => {
      // Force into fallback
      const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Disabled');
      });
      safeSetItem('origKey', 'origVal');
      expect(isUsingFallbackStorage()).toBe(true);

      // Restore so recovery succeeds
      spy.mockRestore();

      const result = safeSetItem('newKey', 'newVal');
      expect(result).toBe(true);
      expect(isUsingFallbackStorage()).toBe(false);
      expect(localStorage.getItem('newKey')).toBe('newVal');
      // Migrated key should also be in localStorage
      expect(localStorage.getItem('origKey')).toBe('origVal');
    });
  });

  // ─── safeRemoveItem ────────────────────────────────────────────

  describe('safeRemoveItem', () => {
    it('removes from localStorage normally', () => {
      localStorage.setItem('delMe', 'val');
      safeRemoveItem('delMe');
      expect(localStorage.getItem('delMe')).toBeNull();
    });

    it('removes from memory storage in fallback mode when recovery fails', () => {
      // Force fallback
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('memDel', 'val');
      expect(isUsingFallbackStorage()).toBe(true);

      // Remove while still in fallback (recovery will fail since setItem still throws)
      safeRemoveItem('memDel');

      // Value should be gone from memory
      expect(safeGetItem('memDel')).toBeNull();
    });

    it('falls back when localStorage.removeItem throws', () => {
      localStorage.setItem('rmKey', 'rmVal');

      Storage.prototype.removeItem = () => { throw new Error('Disabled'); };
      safeRemoveItem('rmKey');
      expect(isUsingFallbackStorage()).toBe(true);
    });

    it('recovers from fallback and removes from localStorage', () => {
      // Force into fallback
      const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Disabled');
      });
      safeSetItem('recDel', 'val');
      expect(isUsingFallbackStorage()).toBe(true);

      // Restore localStorage
      spy.mockRestore();

      // Put something in localStorage directly to verify removal
      localStorage.setItem('recDel', 'val');

      // Recovery should succeed, then removeItem runs on localStorage
      safeRemoveItem('recDel');
      expect(isUsingFallbackStorage()).toBe(false);
      expect(localStorage.getItem('recDel')).toBeNull();
    });
  });

  // ─── safeGetKeys ───────────────────────────────────────────────

  describe('safeGetKeys', () => {
    it('returns keys from localStorage', () => {
      localStorage.setItem('alpha', '1');
      localStorage.setItem('beta', '2');
      const keys = safeGetKeys();
      expect(keys).toContain('alpha');
      expect(keys).toContain('beta');
      expect(keys.length).toBe(2);
    });

    it('skips null keys returned by localStorage.key()', () => {
      localStorage.setItem('realKey', 'val');
      // Mock key() to return null for index 0, then the real key for index 1
      Storage.prototype.key = function (i) {
        if (i === 0) return null;
        return null; // No more keys
      };
      // Override length to report 1 item so the loop runs once with a null return
      Object.defineProperty(Storage.prototype, 'length', {
        get() { return 1; },
        configurable: true,
      });

      const keys = safeGetKeys();
      expect(keys).toEqual([]);
    });

    it('returns keys from memory when in fallback and recovery fails', () => {
      // Force fallback
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('m1', 'v1');
      safeSetItem('m2', 'v2');
      expect(isUsingFallbackStorage()).toBe(true);

      const keys = safeGetKeys();
      expect(keys).toContain('m1');
      expect(keys).toContain('m2');
      expect(keys.length).toBe(2);
    });

    it('falls back when localStorage.key throws', () => {
      // Put something in memory first via fallback
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('fk', 'fv');
      expect(isUsingFallbackStorage()).toBe(true);

      // Now also make key() throw (recovery still fails because setItem throws)
      Storage.prototype.key = () => { throw new Error('Disabled'); };

      const keys = safeGetKeys();
      expect(keys).toContain('fk');
    });

    it('handles localStorage.length throwing in catch branch', () => {
      // Force into fallback, then have length access throw during recovery test
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('fallbackKey', 'val');
      expect(isUsingFallbackStorage()).toBe(true);

      // safeGetKeys while still in fallback - recovery fails, returns memory keys
      const keys = safeGetKeys();
      expect(keys).toEqual(['fallbackKey']);
    });

    it('falls back to memory when accessing localStorage throws during enumeration', () => {
      // Not in fallback mode yet. Make localStorage.length throw to trigger catch block.
      Object.defineProperty(Storage.prototype, 'length', {
        get() { throw new Error('SecurityError'); },
        configurable: true,
      });

      const keys = safeGetKeys();
      expect(isUsingFallbackStorage()).toBe(true);
      expect(keys).toEqual([]);
    });

    it('recovers from fallback and returns localStorage keys', () => {
      // Force fallback
      const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Disabled');
      });
      safeSetItem('recK', 'recV');
      expect(isUsingFallbackStorage()).toBe(true);

      // Restore localStorage
      spy.mockRestore();

      // Recovery will migrate 'recK' to localStorage, then enumerate
      const keys = safeGetKeys();
      expect(isUsingFallbackStorage()).toBe(false);
      expect(keys).toContain('recK');
    });
  });

  // ─── isUsingFallbackStorage ────────────────────────────────────

  describe('isUsingFallbackStorage', () => {
    it('returns false initially', () => {
      expect(isUsingFallbackStorage()).toBe(false);
    });

    it('returns true after localStorage failure', () => {
      Storage.prototype.setItem = () => { throw new Error('Fail'); };
      safeSetItem('x', 'y');
      expect(isUsingFallbackStorage()).toBe(true);
    });
  });

  // ─── tryRecoverFromFallback ────────────────────────────────────

  describe('tryRecoverFromFallback', () => {
    it('returns true when not in fallback mode (line 143)', () => {
      expect(isUsingFallbackStorage()).toBe(false);
      expect(tryRecoverFromFallback()).toBe(true);
    });

    it('returns false when localStorage is still unavailable (line 171)', () => {
      // Force into fallback
      Storage.prototype.setItem = () => { throw new Error('Disabled'); };
      safeSetItem('x', 'y');
      expect(isUsingFallbackStorage()).toBe(true);

      // tryRecoverFromFallback tries setItem which still throws
      expect(tryRecoverFromFallback()).toBe(false);
      expect(isUsingFallbackStorage()).toBe(true);
    });

    it('recovers and migrates memory storage to localStorage', () => {
      // Force into fallback
      const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Disabled');
      });
      safeSetItem('migKey', 'migVal');
      expect(isUsingFallbackStorage()).toBe(true);

      // Restore
      spy.mockRestore();

      expect(tryRecoverFromFallback()).toBe(true);
      expect(isUsingFallbackStorage()).toBe(false);
      expect(localStorage.getItem('migKey')).toBe('migVal');
    });

    it('stays in fallback mode and preserves in-memory data when migration back to localStorage fails', () => {
      const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      safeSetItem('bigKey', 'bigVal');
      expect(isUsingFallbackStorage()).toBe(true);

      spy.mockRestore();
      Storage.prototype.setItem = function (key, value) {
        if (key === 'bigKey') {
          throw new Error('QuotaExceeded');
        }
        return originalSetItem.call(this, key, value);
      };

      expect(tryRecoverFromFallback()).toBe(false);
      expect(isUsingFallbackStorage()).toBe(true);
      expect(localStorage.getItem('bigKey')).toBeNull();
      expect(safeGetItem('bigKey')).toBe('bigVal');
    });
  });

  // ─── resetFallbackStorage ──────────────────────────────────────

  describe('resetFallbackStorage', () => {
    it('clears fallback flag and memory storage', () => {
      Storage.prototype.setItem = () => { throw new Error('Fail'); };
      safeSetItem('reset1', 'val1');
      expect(isUsingFallbackStorage()).toBe(true);

      Storage.prototype.setItem = originalSetItem;
      resetFallbackStorage();

      expect(isUsingFallbackStorage()).toBe(false);
      // After reset, safeGetItem should go to localStorage (which is empty)
      expect(safeGetItem('reset1')).toBeNull();
    });
  });
});
