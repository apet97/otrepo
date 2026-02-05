/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, afterEach } from '@jest/globals';

import { STORAGE_KEYS, CONSTANTS, SUMMARY_COLUMNS, WEEKDAYS } from '../../js/constants.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Constants Module', () => {
  afterEach(() => {
    standardAfterEach();
  });
  describe('STORAGE_KEYS', () => {
    it('exposes stable keys used by persistence', () => {
      expect(STORAGE_KEYS.REPORT_CACHE).toBe('otplus_report_cache');
      expect(STORAGE_KEYS.UI_STATE).toBe('otplus_ui_state');
    });
  });

  describe('CONSTANTS', () => {
    it('defines defaults used by the calculation engine', () => {
      expect(CONSTANTS.DEFAULT_DAILY_CAPACITY).toBe(8);
      expect(CONSTANTS.DEFAULT_MULTIPLIER).toBe(1.5);
    });
  });

  describe('SUMMARY_COLUMNS', () => {
    it('contains unique keys and human-friendly labels', () => {
      const keys = SUMMARY_COLUMNS.map(col => col.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);

      SUMMARY_COLUMNS.forEach(column => {
        expect(typeof column.label).toBe('string');
        expect(column.label.length).toBeGreaterThan(0);
      });
    });
  });

  describe('WEEKDAYS', () => {
    it('produces 7 weekday entries with localized labels', () => {
      expect(WEEKDAYS.length).toBe(7);
      WEEKDAYS.forEach(day => {
        expect(typeof day.key).toBe('string');
        expect(typeof day.label).toBe('string');
        expect(day.label.length).toBeGreaterThan(0);
      });
    });
  });
});
