/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  safeSetItem,
  safeGetItem,
  isUsingFallbackStorage,
  resetFallbackStorage,
} from '../../js/storage.js';

describe('Storage fallback recovery', () => {
  let originalSetItem;
  let originalRemoveItem;

  beforeEach(() => {
    resetFallbackStorage();
    localStorage.clear();
    originalSetItem = localStorage.setItem.bind(localStorage);
    originalRemoveItem = localStorage.removeItem.bind(localStorage);
  });

  afterEach(() => {
    localStorage.setItem = originalSetItem;
    localStorage.removeItem = originalRemoveItem;
    localStorage.clear();
    resetFallbackStorage();
  });

  it('recovers from fallback when localStorage becomes available again', () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const firstWrite = safeSetItem('fallback-key', 'fallback-value');
    expect(firstWrite).toBe(false);
    expect(isUsingFallbackStorage()).toBe(true);

    setItemSpy.mockRestore();
    localStorage.setItem = originalSetItem;
    localStorage.removeItem = originalRemoveItem;

    const recoveredWrite = safeSetItem('new-key', 'new-value');
    expect(recoveredWrite).toBe(true);
    expect(isUsingFallbackStorage()).toBe(false);

    expect(safeGetItem('fallback-key')).toBe('fallback-value');
    expect(safeGetItem('new-key')).toBe('new-value');
  });
});
