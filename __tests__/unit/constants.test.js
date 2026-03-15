/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, afterEach } from '@jest/globals';

import { STORAGE_KEYS, CONSTANTS, SUMMARY_COLUMNS, WEEKDAYS, DEFAULT_MAX_PAGES, HARD_MAX_PAGES_LIMIT, MAX_ENTRIES_LIMIT } from '../../js/constants.js';
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

  describe('Pagination limits', () => {
    it('DEFAULT_MAX_PAGES supports 1500-user workspaces (2500 pages × 200 = 500K entries)', () => {
      expect(DEFAULT_MAX_PAGES).toBe(2500);
    });

    it('HARD_MAX_PAGES_LIMIT is absolute safety ceiling (5000 pages × 200 = 1M entries)', () => {
      expect(HARD_MAX_PAGES_LIMIT).toBe(5000);
    });

    it('MAX_ENTRIES_LIMIT prevents unbounded memory growth', () => {
      expect(MAX_ENTRIES_LIMIT).toBe(1_000_000);
    });

    it('DEFAULT_MAX_PAGES is less than HARD_MAX_PAGES_LIMIT', () => {
      expect(DEFAULT_MAX_PAGES).toBeLessThan(HARD_MAX_PAGES_LIMIT);
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
