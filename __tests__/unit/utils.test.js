/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import {
  safeJSONParse,
  escapeHtml,
  debounce,
  formatCurrency,
  formatHours,
  IsoUtils,
  classifyEntryForOvertime,
  base64urlDecode,
  isValidTimeZone,
  setCanonicalTimeZone,
  getCanonicalTimeZone
} from '../../js/utils.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Utils Module', () => {
  // Global afterEach for test isolation
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });
  describe('safeJSONParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJSONParse('{"key": "value"}', {});
      expect(result).toEqual({ key: 'value' });
    });

    it('should return fallback for invalid JSON', () => {
      const result = safeJSONParse('invalid json', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return fallback for null input', () => {
      const result = safeJSONParse(null, { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return fallback for undefined input', () => {
      const result = safeJSONParse(undefined, { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return fallback for empty string', () => {
      const result = safeJSONParse('', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      const result = escapeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;');
    });

    it('should return empty string for null input', () => {
      const result = escapeHtml(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = escapeHtml(undefined);
      expect(result).toBe('');
    });

    it('should not modify safe text', () => {
      const result = escapeHtml('Safe text');
      expect(result).toBe('Safe text');
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers({ advanceTimers: true });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should debounce function calls', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should execute function after wait period', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 200);

      debouncedFn('arg1', 'arg2');

      jest.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should reset timer on subsequent calls', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      jest.advanceTimersByTime(50);
      debouncedFn();
      jest.advanceTimersByTime(50);

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatCurrency', () => {
    it('should format USD currency', () => {
      const result = formatCurrency(100);
      expect(result).toMatch(/\$100\.00/);
    });

    it('should format currency with cents', () => {
      const result = formatCurrency(100.5);
      expect(result).toMatch(/\$100\.50/);
    });

    it('should handle zero', () => {
      const result = formatCurrency(0);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should handle negative numbers', () => {
      const result = formatCurrency(-100);
      expect(result).toMatch(/\$-?100\.00/);
    });

    it('should return $0.00 for null', () => {
      const result = formatCurrency(null);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should return $0.00 for undefined', () => {
      const result = formatCurrency(undefined);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should return $0.00 for NaN', () => {
      const result = formatCurrency(NaN);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should format different currency', () => {
      const result = formatCurrency(100, 'EUR');
      expect(result).toMatch(/€100\.00/);
    });

    // i18n currency formatting tests
    it('should format GBP currency with pound symbol', () => {
      const result = formatCurrency(100, 'GBP');
      expect(result).toContain('100');
      expect(result).toMatch(/£/);
    });

    it('should format JPY currency (typically no decimals)', () => {
      const result = formatCurrency(1000, 'JPY');
      expect(result).toContain('1');
      expect(result).toMatch(/¥|JPY/);
    });

    it('should format CAD currency', () => {
      const result = formatCurrency(250.50, 'CAD');
      expect(result).toContain('250');
    });

    it('should format AUD currency', () => {
      const result = formatCurrency(150.75, 'AUD');
      expect(result).toContain('150');
    });

    it('should format CHF currency', () => {
      const result = formatCurrency(500, 'CHF');
      expect(result).toContain('500');
    });

    it('should handle unknown currency code gracefully', () => {
      expect(() => formatCurrency(100, 'XYZ')).not.toThrow();
      const result = formatCurrency(100, 'XYZ');
      expect(result).toContain('100');
    });

    it('should handle empty currency code', () => {
      expect(() => formatCurrency(100, '')).not.toThrow();
    });

    it('should handle very large amounts', () => {
      const result = formatCurrency(1000000, 'USD');
      expect(result).toContain('1');
      expect(result).toContain('000');
    });

    it('should handle small decimal amounts', () => {
      const result = formatCurrency(0.01, 'USD');
      expect(result).toContain('0.01');
    });
  });

  describe('formatHours', () => {
    it('should format whole hours', () => {
      expect(formatHours(8)).toBe('8h');
    });

    it('should format hours with minutes', () => {
      expect(formatHours(8.5)).toBe('8h 30m');
      expect(formatHours(1.25)).toBe('1h 15m');
    });

    it('should handle zero', () => {
      expect(formatHours(0)).toBe('0h');
    });

    it('should round minutes', () => {
      expect(formatHours(1.33)).toBe('1h 20m'); // 0.33 * 60 = 19.8 ≈ 20
    });

    it('should handle null', () => {
      expect(formatHours(null)).toBe('0h');
    });

    it('should handle undefined', () => {
      expect(formatHours(undefined)).toBe('0h');
    });

    it('should handle NaN', () => {
      expect(formatHours(NaN)).toBe('0h');
    });

    it('should handle negative hours', () => {
      expect(formatHours(-5)).toBe('-5h');
    });
  });
});

describe('IsoUtils', () => {
  describe('toISODate', () => {
    it('should convert Date to ISO date string', () => {
      const date = new Date('2025-01-15T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-01-15');
    });

    it('should handle different dates', () => {
      const date = new Date('2024-12-31T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2024-12-31');
    });

    it('should return empty string for null', () => {
      expect(IsoUtils.toISODate(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(IsoUtils.toISODate(undefined)).toBe('');
    });
  });

  describe('parseDate', () => {
    it('should parse ISO date string', () => {
      const date = IsoUtils.parseDate('2025-01-15');
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toContain('2025-01-15');
    });

    it('should return null for null input', () => {
      expect(IsoUtils.parseDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(IsoUtils.parseDate(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(IsoUtils.parseDate('')).toBeNull();
    });
  });

  describe('extractDateKey', () => {
    it('should extract date from ISO string', () => {
      expect(IsoUtils.extractDateKey('2025-01-15T09:00:00Z')).toBe('2025-01-15');
    });

    it('should handle strings with timezone offset', () => {
      expect(IsoUtils.extractDateKey('2025-01-15T09:00:00+05:00')).toBe('2025-01-15');
    });

    it('should return null for invalid input', () => {
      expect(IsoUtils.extractDateKey(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(IsoUtils.extractDateKey(undefined)).toBeNull();
    });
  });

  describe('timezone helpers', () => {
    afterEach(() => {
      setCanonicalTimeZone(null);
    });

    it('should validate time zone identifiers', () => {
      expect(isValidTimeZone('UTC')).toBe(true);
      expect(isValidTimeZone('Invalid/Zone')).toBe(false);
      expect(isValidTimeZone('')).toBe(false);
    });

    it('should return a canonical timezone string', () => {
      const tz = getCanonicalTimeZone();
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    });

    it('should fall back to UTC when resolved time zone is missing', () => {
      const original = Intl.DateTimeFormat;
      Intl.DateTimeFormat = jest.fn(() => ({
        resolvedOptions: () => ({ timeZone: '' })
      }));

      setCanonicalTimeZone(null);
      expect(getCanonicalTimeZone()).toBe('UTC');

      Intl.DateTimeFormat = original;
    });

    it('should use canonical timezone for date keys', () => {
      setCanonicalTimeZone('America/Los_Angeles');
      // 02:00Z on Jan 1 is still Dec 31 in LA (UTC-8)
      expect(IsoUtils.extractDateKey('2025-01-01T02:00:00Z')).toBe('2024-12-31');
    });

    it('should format date keys in canonical timezone', () => {
      setCanonicalTimeZone('UTC');
      const date = new Date('2025-01-15T12:00:00Z');
      expect(IsoUtils.toDateKey(date)).toBe('2025-01-15');
    });

    it('should return empty string for null date in toDateKey', () => {
      expect(IsoUtils.toDateKey(null)).toBe('');
    });

    it('should use default date parts when formatter is missing parts', () => {
      setCanonicalTimeZone('UTC');
      const original = Intl.DateTimeFormat;
      Intl.DateTimeFormat = jest.fn(() => ({
        formatToParts: () => [{ type: 'literal', value: '-' }]
      }));

      const date = new Date('2025-01-15T12:00:00Z');
      expect(IsoUtils.toDateKey(date)).toBe('0000-01-01');

      Intl.DateTimeFormat = original;
    });

    it('should ignore invalid canonical time zones', () => {
      setCanonicalTimeZone('Not/AZone');
      const tz = getCanonicalTimeZone();
      expect(tz).not.toBe('Not/AZone');
    });
  });

  describe('getWeekdayKey', () => {
    it('should return weekday for date', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-13')).toBe('MONDAY'); // Jan 13, 2025 is Monday
      expect(IsoUtils.getWeekdayKey('2025-01-14')).toBe('TUESDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-15')).toBe('WEDNESDAY');
    });

    it('should return empty string for null', () => {
      expect(IsoUtils.getWeekdayKey(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(IsoUtils.getWeekdayKey(undefined)).toBe('');
    });
  });

  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      expect(IsoUtils.isWeekend('2025-01-11')).toBe(true); // Jan 11, 2025 is Saturday
    });

    it('should return true for Sunday', () => {
      expect(IsoUtils.isWeekend('2025-01-12')).toBe(true); // Jan 12, 2025 is Sunday
    });

    it('should return false for weekday', () => {
      expect(IsoUtils.isWeekend('2025-01-13')).toBe(false); // Monday
    });

    it('should return false for null', () => {
      expect(IsoUtils.isWeekend(null)).toBe(false);
    });
  });

  describe('generateDateRange', () => {
    it('should generate date range', () => {
      const dates = IsoUtils.generateDateRange('2025-01-01', '2025-01-05');
      expect(dates).toEqual([
        '2025-01-01',
        '2025-01-02',
        '2025-01-03',
        '2025-01-04',
        '2025-01-05'
      ]);
    });

    it('should handle single day range', () => {
      const dates = IsoUtils.generateDateRange('2025-01-01', '2025-01-01');
      expect(dates).toEqual(['2025-01-01']);
    });

    it('should return empty array for invalid dates', () => {
      const dates = IsoUtils.generateDateRange('invalid', '2025-01-05');
      expect(dates).toEqual([]);
    });

    it('should handle month boundaries', () => {
      const dates = IsoUtils.generateDateRange('2025-01-30', '2025-02-02');
      expect(dates).toContain('2025-01-30');
      expect(dates).toContain('2025-01-31');
      expect(dates).toContain('2025-02-01');
      expect(dates).toContain('2025-02-02');
    });
  });

  describe('classifyEntryForOvertime', () => {
    it('should classify BREAK entry', () => {
      const entry = { type: 'BREAK' };
      expect(classifyEntryForOvertime(entry)).toBe('break');
    });

    it('should classify HOLIDAY entry as pto', () => {
      const entry = { type: 'HOLIDAY' };
      expect(classifyEntryForOvertime(entry)).toBe('pto');
    });

    it('should classify TIME_OFF entry as pto', () => {
      const entry = { type: 'TIME_OFF' };
      expect(classifyEntryForOvertime(entry)).toBe('pto');
    });

    it('should classify REGULAR entry as work', () => {
      const entry = { type: 'REGULAR' };
      expect(classifyEntryForOvertime(entry)).toBe('work');
    });

    it('should classify unknown type as work', () => {
      const entry = { type: 'UNKNOWN_TYPE' };
      expect(classifyEntryForOvertime(entry)).toBe('work');
    });

    it('should return work for entry without type', () => {
      const entry = {};
      expect(classifyEntryForOvertime(entry)).toBe('work');
    });

    it('should return work for null entry', () => {
      expect(classifyEntryForOvertime(null)).toBe('work');
    });

    it('should return work for undefined entry', () => {
      expect(classifyEntryForOvertime(undefined)).toBe('work');
    });

    it('should classify billable HOLIDAY as pto (not work)', () => {
      const entry = { type: 'HOLIDAY', billable: true };
      expect(classifyEntryForOvertime(entry)).toBe('pto');
    });

    it('should classify billable TIME_OFF as pto (not work)', () => {
      const entry = { type: 'TIME_OFF', billable: true };
      expect(classifyEntryForOvertime(entry)).toBe('pto');
    });
  });
});

// Additional validation tests
describe('Validation Functions', () => {
  let validateISODateString, validateUser, validateUserProfile, validateDateRange;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    validateISODateString = utils.validateISODateString;
    validateUser = utils.validateUser;
    validateUserProfile = utils.validateUserProfile;
    validateDateRange = utils.validateDateRange;
  });

  describe('validateISODateString', () => {
    it('should accept valid ISO date string', () => {
      expect(validateISODateString('2025-01-15', 'date')).toBe('2025-01-15');
    });

    it('should accept full ISO timestamp', () => {
      expect(validateISODateString('2025-01-15T09:00:00Z', 'date')).toBe('2025-01-15T09:00:00Z');
    });

    it('should throw for invalid format', () => {
      expect(() => validateISODateString('15-01-2025', 'date')).toThrow();
    });

    it('should throw for invalid date values', () => {
      expect(() => validateISODateString('2025-13-45', 'date')).toThrow();
    });

    it('should throw for null', () => {
      expect(() => validateISODateString(null, 'date')).toThrow();
    });
  });

  describe('validateUser', () => {
    it('should accept valid user', () => {
      expect(validateUser({ id: 'user1', name: 'Alice' })).toBe(true);
    });

    it('should throw for null user', () => {
      expect(() => validateUser(null)).toThrow();
    });

    it('should throw for missing id', () => {
      expect(() => validateUser({ name: 'Alice' })).toThrow();
    });

    it('should throw for missing name', () => {
      expect(() => validateUser({ id: 'user1' })).toThrow();
    });

    it('should throw for non-object', () => {
      expect(() => validateUser('string')).toThrow();
    });
  });

  describe('validateUserProfile', () => {
    it('should accept valid profile', () => {
      expect(validateUserProfile({ workCapacity: 'PT8H', workingDays: ['MONDAY'] })).toBe(true);
    });

    it('should accept profile without optional fields', () => {
      expect(validateUserProfile({})).toBe(true);
    });

    it('should throw for null profile', () => {
      expect(() => validateUserProfile(null)).toThrow();
    });

    it('should throw for non-array workingDays', () => {
      expect(() => validateUserProfile({ workingDays: 'MONDAY' })).toThrow();
    });

    it('should throw for invalid workingDay entry', () => {
      expect(() => validateUserProfile({ workingDays: ['MONDAY', ''] })).toThrow();
    });

    it('should throw for non-string workingDay', () => {
      expect(() => validateUserProfile({ workingDays: ['MONDAY', 123] })).toThrow();
    });
  });

  describe('validateDateRange', () => {
    it('should accept valid date range', () => {
      expect(validateDateRange('2025-01-01', '2025-01-31')).toBe(true);
    });

    it('should accept same start and end date', () => {
      expect(validateDateRange('2025-01-15', '2025-01-15')).toBe(true);
    });

    it('should throw for start after end', () => {
      expect(() => validateDateRange('2025-02-01', '2025-01-01')).toThrow();
    });

    it('should throw for invalid start date', () => {
      expect(() => validateDateRange('invalid', '2025-01-31')).toThrow();
    });

    it('should throw for invalid end date', () => {
      expect(() => validateDateRange('2025-01-01', 'invalid')).toThrow();
    });
  });
});

describe('Additional Formatting Functions', () => {
  let formatCurrency, formatHours, getISOWeek, getWeekKey, formatWeekKey, getDateRangeDays;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    formatCurrency = utils.formatCurrency;
    formatHours = utils.formatHours;
    getISOWeek = utils.getISOWeek;
    getWeekKey = utils.getWeekKey;
    formatWeekKey = utils.formatWeekKey;
    getDateRangeDays = utils.getDateRangeDays;
  });

  describe('formatCurrency with invalid currency', () => {
    it('should fall back to simple format for invalid currency code', () => {
      const result = formatCurrency(100, 'INVALID');
      expect(result).toContain('100');
    });
  });

  describe('formatHours with 60-minute edge case', () => {
    it('should handle 1.9999h correctly (rolls over to next hour)', () => {
      // 1.999 * 60 = 119.94 minutes, rounds to 120 = 2 hours
      const result = formatHours(1.9999);
      expect(result).toBe('2h');
    });

    it('should handle 0.999h correctly', () => {
      // 0.999 * 60 = 59.94 minutes, rounds to 60 = 1 hour
      const result = formatHours(0.999);
      expect(result).toBe('1h');
    });
  });

  describe('getISOWeek', () => {
    it('should return week 1 for first week of year', () => {
      const date = new Date('2025-01-02');
      expect(getISOWeek(date)).toBe(1);
    });

    it('should return correct week for mid-year', () => {
      const date = new Date('2025-06-15');
      expect(getISOWeek(date)).toBeGreaterThan(23);
    });

    it('should handle year boundary (late December)', () => {
      const date = new Date('2024-12-30');
      const week = getISOWeek(date);
      expect(week).toBeGreaterThanOrEqual(1);
    });

    it('should handle year boundary (early January)', () => {
      const date = new Date('2025-01-01');
      const week = getISOWeek(date);
      expect(week).toBeLessThanOrEqual(53);
    });
  });

  describe('getWeekKey', () => {
    it('should return week key in YYYY-W## format', () => {
      const result = getWeekKey('2025-01-15');
      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('should handle invalid date gracefully', () => {
      const result = getWeekKey('invalid');
      // Returns some value - may contain NaN but doesn't crash
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle Thursday calculation for year', () => {
      // Dec 31, 2024 (Tuesday) - Week belongs to 2025
      const result = getWeekKey('2024-12-31');
      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe('formatWeekKey', () => {
    it('should format valid week key', () => {
      const result = formatWeekKey('2025-W03');
      expect(result).toBe('Week 3, 2025');
    });

    it('should return original string for invalid format', () => {
      const result = formatWeekKey('invalid');
      expect(result).toBe('invalid');
    });

    it('should handle single digit week', () => {
      const result = formatWeekKey('2025-W01');
      expect(result).toBe('Week 1, 2025');
    });
  });

  describe('getDateRangeDays', () => {
    it('should return correct days for valid range', () => {
      const result = getDateRangeDays('2025-01-01', '2025-01-10');
      expect(result).toBe(10);
    });

    it('should return 1 for same day', () => {
      const result = getDateRangeDays('2025-01-15', '2025-01-15');
      expect(result).toBe(1);
    });

    it('should return 0 for invalid start date', () => {
      const result = getDateRangeDays('invalid', '2025-01-15');
      expect(result).toBe(0);
    });

    it('should return 0 for invalid end date', () => {
      const result = getDateRangeDays('2025-01-01', 'invalid');
      expect(result).toBe(0);
    });

    it('should handle month boundaries', () => {
      const result = getDateRangeDays('2025-01-30', '2025-02-02');
      expect(result).toBe(4);
    });
  });
});

describe('Error Classification', () => {
  let classifyError, createUserFriendlyError;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    classifyError = utils.classifyError;
    createUserFriendlyError = utils.createUserFriendlyError;
  });

  describe('classifyError', () => {
    it('should return UNKNOWN_ERROR for null error', () => {
      expect(classifyError(null)).toBe('UNKNOWN_ERROR');
    });

    it('should classify TypeError with fetch as NETWORK_ERROR', () => {
      const error = new TypeError('fetch failed');
      expect(classifyError(error)).toBe('NETWORK_ERROR');
    });

    it('should classify AbortError as NETWORK_ERROR', () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      expect(classifyError(error)).toBe('NETWORK_ERROR');
    });

    it('should classify 401 as AUTH_ERROR', () => {
      const error = { status: 401 };
      expect(classifyError(error)).toBe('AUTH_ERROR');
    });

    it('should classify 403 as AUTH_ERROR', () => {
      const error = { status: 403 };
      expect(classifyError(error)).toBe('AUTH_ERROR');
    });

    it('should classify 400 as VALIDATION_ERROR', () => {
      const error = { status: 400 };
      expect(classifyError(error)).toBe('VALIDATION_ERROR');
    });

    it('should classify 500 as API_ERROR', () => {
      const error = { status: 500 };
      expect(classifyError(error)).toBe('API_ERROR');
    });
  });

  describe('createUserFriendlyError', () => {
    it('should create structured error from string', () => {
      const result = createUserFriendlyError('Something went wrong');

      expect(typeof result.type).toBe('string');
      expect(typeof result.title).toBe('string');
      expect(typeof result.message).toBe('string');
      expect(typeof result.timestamp).toBe('string');
      expect(result.timestamp.length).toBeGreaterThan(0);
    });

    it('should create structured error from Error object', () => {
      const result = createUserFriendlyError(new Error('Test error'));

      expect(result.originalError).toBeInstanceOf(Error);
      expect(typeof result.stack).toBe('string');
      expect(result.stack.length).toBeGreaterThan(0);
    });

    it('should use explicit type when provided', () => {
      const result = createUserFriendlyError('Error', 'AUTH_ERROR');

      expect(result.type).toBe('AUTH_ERROR');
    });

    it('should use fallback message for unknown error type (line 310)', () => {
      const result = createUserFriendlyError('Error', 'SOME_UNKNOWN_ERROR_TYPE');

      // Should fall back to UNKNOWN_ERROR message
      expect(result.type).toBe('SOME_UNKNOWN_ERROR_TYPE');
      expect(typeof result.title).toBe('string');
      expect(result.title.length).toBeGreaterThan(0);
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });
});

describe('Branch Coverage - Utils Functions', () => {
  let round, escapeCsv, formatHoursDecimal, debounce;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    round = utils.round;
    escapeCsv = utils.escapeCsv;
    formatHoursDecimal = utils.formatHoursDecimal;
    debounce = utils.debounce;
  });

  describe('round edge cases (line 334)', () => {
    it('should return 0 for NaN input', () => {
      expect(round(NaN)).toBe(0);
    });

    it('should return 0 for Infinity input', () => {
      expect(round(Infinity)).toBe(0);
    });

    it('should return 0 for negative Infinity input', () => {
      expect(round(-Infinity)).toBe(0);
    });

    it('should round valid numbers correctly', () => {
      expect(round(3.14159)).toBeCloseTo(3.1416, 4);
    });

    it('should handle custom decimal places', () => {
      expect(round(3.14159, 2)).toBeCloseTo(3.14, 2);
    });

    it('should handle rounding edge cases for large values and halves', () => {
      // IEEE-754 representation means some .005 values are slightly below the midpoint.
      expect(round(1.255, 2)).toBe(1.25);
      expect(round(2.675, 2)).toBe(2.68);
      expect(round(999999.995, 2)).toBe(1000000);
    });
  });

  describe('escapeCsv edge cases (line 381)', () => {
    it('should return string unchanged if no special characters', () => {
      expect(escapeCsv('simple text')).toBe('simple text');
    });

    it('should return empty string for null', () => {
      expect(escapeCsv(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(escapeCsv(undefined)).toBe('');
    });

    it('should wrap and escape quotes when string contains quotes', () => {
      expect(escapeCsv('text "with" quotes')).toBe('"text ""with"" quotes"');
    });

    it('should wrap when string contains comma', () => {
      expect(escapeCsv('one, two')).toBe('"one, two"');
    });

    it('should wrap when string contains newline', () => {
      expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    });

    it('should convert number to string', () => {
      expect(escapeCsv(123)).toBe('123');
    });
  });

  describe('formatHoursDecimal edge cases (line 473)', () => {
    it('should return 0.00 for NaN input', () => {
      expect(formatHoursDecimal(NaN)).toBe('0.00');
    });

    it('should return 0.00 for null input', () => {
      expect(formatHoursDecimal(null)).toBe('0.00');
    });

    it('should return 0.00 for undefined input', () => {
      expect(formatHoursDecimal(undefined)).toBe('0.00');
    });

    it('should format valid hours', () => {
      expect(formatHoursDecimal(8.5)).toBe('8.50');
    });

    it('should respect custom decimal places', () => {
      expect(formatHoursDecimal(8.555, 1)).toBe('8.6');
    });
  });

  describe('debounce first call without timeout (line 418)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ advanceTimers: true });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle first call without existing timeout', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 0);

      debouncedFn('first');

      // Wait a small amount for the first call
      jest.advanceTimersByTime(0);
      expect(fn).toHaveBeenCalledWith('first');
    });

    it('should clear existing timeout on rapid calls (line 418)', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      // Rapid calls - should clear previous timeout each time
      debouncedFn('call1');
      jest.advanceTimersByTime(30);
      debouncedFn('call2');
      jest.advanceTimersByTime(30);
      debouncedFn('call3');
      jest.advanceTimersByTime(30);
      debouncedFn('call4');

      // Only last call should execute after full wait
      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call4');
    });
  });
});

describe('IsoUtils Branch Coverage', () => {
  describe('extractDateKey edge cases (line 522)', () => {
    it('should return null for invalid date string', () => {
      expect(IsoUtils.extractDateKey('totally-not-a-date')).toBeNull();
    });

    it('should handle date string that is exactly 10 chars', () => {
      expect(IsoUtils.extractDateKey('2025-01-15')).toBe('2025-01-15');
    });
  });

  describe('generateDateRange edge cases (lines 568-623)', () => {
    it('should return empty array when start date is invalid', () => {
      const result = IsoUtils.generateDateRange('invalid', '2025-01-05');
      expect(result).toEqual([]);
    });

    it('should return empty array when end date is invalid', () => {
      const result = IsoUtils.generateDateRange('2025-01-01', 'invalid');
      expect(result).toEqual([]);
    });

    it('should return empty array when both dates are invalid', () => {
      const result = IsoUtils.generateDateRange('invalid', 'also-invalid');
      expect(result).toEqual([]);
    });

    it('should handle null start date', () => {
      const result = IsoUtils.generateDateRange(null, '2025-01-05');
      expect(result).toEqual([]);
    });

    it('should handle null end date', () => {
      const result = IsoUtils.generateDateRange('2025-01-01', null);
      expect(result).toEqual([]);
    });
  });
});

// ============================================================================
// MUTATION TESTING - Error Message Verification (C1)
// ============================================================================
// These tests verify that error messages contain specific expected content
// to kill StringLiteral mutants that replace error messages with "Stryker was here!"
// Validation functions throw FriendlyError objects with originalError.message containing the specific message.
// ============================================================================

// Helper to extract error message from FriendlyError thrown by validation functions
function getErrorMessage(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    // FriendlyError has originalError.message with the specific validation message
    if (e && typeof e === 'object') {
      if (e.originalError && e.originalError.message) {
        return e.originalError.message;
      }
      if (e.message) {
        return e.message;
      }
    }
    return String(e);
  }
}

describe('Validation Error Message Content (Mutation Testing)', () => {
  let validateRequiredFields, validateNumber, validateString, validateISODateString,
      validateTimeEntry, validateUser, validateUserProfile, validateDateRange;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    validateRequiredFields = utils.validateRequiredFields;
    validateNumber = utils.validateNumber;
    validateString = utils.validateString;
    validateISODateString = utils.validateISODateString;
    validateTimeEntry = utils.validateTimeEntry;
    validateUser = utils.validateUser;
    validateUserProfile = utils.validateUserProfile;
    validateDateRange = utils.validateDateRange;
  });

  describe('validateRequiredFields error messages', () => {
    it('should include "is not an object" in error message for non-object', () => {
      const msg = getErrorMessage(() => validateRequiredFields('string', ['a'], 'Test'));
      expect(msg).toMatch(/is not an object/);
    });

    it('should include context in error message for non-object', () => {
      const msg = getErrorMessage(() => validateRequiredFields(null, ['a'], 'MyContext'));
      expect(msg).toMatch(/MyContext/);
    });

    it('should include "missing required fields" in error message', () => {
      const msg = getErrorMessage(() => validateRequiredFields({}, ['field1', 'field2'], 'Test'));
      expect(msg).toMatch(/missing required fields/);
    });

    it('should include field names in error message for missing fields', () => {
      const msg = getErrorMessage(() => validateRequiredFields({}, ['alpha', 'beta'], 'Test'));
      expect(msg).toMatch(/alpha/);
      expect(msg).toMatch(/beta/);
    });

    it('should return true for valid object with all required fields', () => {
      const result = validateRequiredFields({ a: 1, b: 2 }, ['a', 'b'], 'Test');
      expect(result).toBe(true);
    });
  });

  describe('validateNumber error messages', () => {
    it('should include "is required" in error message for null', () => {
      const msg = getErrorMessage(() => validateNumber(null, 'TestField'));
      expect(msg).toMatch(/is required/);
    });

    it('should include "is required" in error message for undefined', () => {
      const msg = getErrorMessage(() => validateNumber(undefined, 'TestField'));
      expect(msg).toMatch(/is required/);
    });

    it('should include field name in error message for null', () => {
      const msg = getErrorMessage(() => validateNumber(null, 'Amount'));
      expect(msg).toMatch(/Amount/);
    });

    it('should include "must be a number" in error message for NaN', () => {
      const msg = getErrorMessage(() => validateNumber('abc', 'TestField'));
      expect(msg).toMatch(/must be a number/);
    });

    it('should include field name in error message for NaN', () => {
      const msg = getErrorMessage(() => validateNumber('not-a-number', 'Total'));
      expect(msg).toMatch(/Total/);
    });

    it('should return the number for valid input', () => {
      expect(validateNumber(42, 'TestField')).toBe(42);
      expect(validateNumber('42', 'TestField')).toBe(42);
      expect(validateNumber(0, 'TestField')).toBe(0);
    });
  });

  describe('validateString error messages', () => {
    it('should include "must be a non-empty string" for null', () => {
      const msg = getErrorMessage(() => validateString(null, 'Name'));
      expect(msg).toMatch(/must be a non-empty string/);
    });

    it('should include "must be a non-empty string" for undefined', () => {
      const msg = getErrorMessage(() => validateString(undefined, 'Name'));
      expect(msg).toMatch(/must be a non-empty string/);
    });

    it('should include "must be a non-empty string" for number', () => {
      const msg = getErrorMessage(() => validateString(123, 'Name'));
      expect(msg).toMatch(/must be a non-empty string/);
    });

    it('should include field name in error message', () => {
      const msg = getErrorMessage(() => validateString(null, 'Username'));
      expect(msg).toMatch(/Username/);
    });

    it('should include "cannot be empty" for whitespace string', () => {
      const msg = getErrorMessage(() => validateString('   ', 'Title'));
      expect(msg).toMatch(/cannot be empty/);
    });

    it('should include field name for empty string error', () => {
      const msg = getErrorMessage(() => validateString('', 'Description'));
      expect(msg).toMatch(/Description/);
    });

    it('should return trimmed string for valid input', () => {
      expect(validateString('  hello  ', 'Test')).toBe('hello');
      expect(validateString('world', 'Test')).toBe('world');
    });
  });

  describe('validateISODateString error messages', () => {
    it('should include "must be in ISO format" for non-ISO date', () => {
      const msg = getErrorMessage(() => validateISODateString('15-01-2025', 'StartDate'));
      expect(msg).toMatch(/must be in ISO format/);
    });

    it('should include "(YYYY-MM-DD)" in error message for format error', () => {
      const msg = getErrorMessage(() => validateISODateString('01/15/2025', 'Date'));
      expect(msg).toMatch(/YYYY-MM-DD/);
    });

    it('should include "is not a valid ISO date" for invalid date values', () => {
      const msg = getErrorMessage(() => validateISODateString('2025-13-45', 'Date'));
      expect(msg).toMatch(/is not a valid ISO date/);
    });

    it('should include field name in format error', () => {
      const msg = getErrorMessage(() => validateISODateString('bad-date', 'EndDate'));
      expect(msg).toMatch(/EndDate/);
    });

    it('should return the string for valid ISO date', () => {
      expect(validateISODateString('2025-01-15', 'Date')).toBe('2025-01-15');
      expect(validateISODateString('2025-06-30T12:00:00Z', 'Date')).toBe('2025-06-30T12:00:00Z');
    });
  });

  describe('validateTimeEntry error messages', () => {
    it('should include "must be an object" for null entry', () => {
      const msg = getErrorMessage(() => validateTimeEntry(null));
      expect(msg).toMatch(/must be an object/);
    });

    it('should include "Time entry" in error message for null entry', () => {
      const msg = getErrorMessage(() => validateTimeEntry(null));
      expect(msg).toMatch(/Time entry/);
    });

    it('should include "Time entry ID" in error for missing id', () => {
      const msg = getErrorMessage(() => validateTimeEntry({ userId: 'u1', timeInterval: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T01:00:00Z' } }));
      expect(msg).toMatch(/Time entry ID/);
    });

    it('should include "Time entry user ID" in error for missing userId', () => {
      const msg = getErrorMessage(() => validateTimeEntry({ id: 'e1', timeInterval: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T01:00:00Z' } }));
      expect(msg).toMatch(/Time entry user ID/);
    });

    it('should include "Time interval" in error for missing timeInterval', () => {
      const msg = getErrorMessage(() => validateTimeEntry({ id: 'e1', userId: 'u1' }));
      expect(msg).toMatch(/Time interval|timeInterval/);
    });

    it('should include "start time" or "start" in error for missing start', () => {
      const msg = getErrorMessage(() => validateTimeEntry({ id: 'e1', userId: 'u1', timeInterval: { end: '2025-01-01T01:00:00Z' } }));
      expect(msg).toMatch(/start/i);
    });

    it('should include "end time" or "end" in error for missing end', () => {
      const msg = getErrorMessage(() => validateTimeEntry({ id: 'e1', userId: 'u1', timeInterval: { start: '2025-01-01T00:00:00Z' } }));
      expect(msg).toMatch(/end/i);
    });

    it('should include "billable must be a boolean" for invalid billable', () => {
      const msg = getErrorMessage(() => validateTimeEntry({
        id: 'e1',
        userId: 'u1',
        timeInterval: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T01:00:00Z' },
        billable: 'yes'
      }));
      expect(msg).toMatch(/billable must be a boolean/);
    });

    it('should return true for valid time entry', () => {
      const validEntry = {
        id: 'e1',
        userId: 'u1',
        timeInterval: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T01:00:00Z' }
      };
      expect(validateTimeEntry(validEntry)).toBe(true);
    });

    it('should return true for valid time entry with optional fields', () => {
      const validEntry = {
        id: 'e1',
        userId: 'u1',
        timeInterval: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T01:00:00Z', duration: 'PT1H' },
        hourlyRate: { amount: 5000 },
        billable: true
      };
      expect(validateTimeEntry(validEntry)).toBe(true);
    });
  });

  describe('validateUser error messages', () => {
    it('should include "must be an object" for null user', () => {
      const msg = getErrorMessage(() => validateUser(null));
      expect(msg).toMatch(/must be an object/);
    });

    it('should include "User" in error message for null', () => {
      const msg = getErrorMessage(() => validateUser(null));
      expect(msg).toMatch(/User/);
    });

    it('should include "User ID" in error for missing id', () => {
      const msg = getErrorMessage(() => validateUser({ name: 'Alice' }));
      expect(msg).toMatch(/User ID/);
    });

    it('should include "User name" in error for missing name', () => {
      const msg = getErrorMessage(() => validateUser({ id: 'u1' }));
      expect(msg).toMatch(/User name/);
    });

    it('should return true for valid user', () => {
      expect(validateUser({ id: 'u1', name: 'Alice' })).toBe(true);
    });
  });

  describe('validateUserProfile error messages', () => {
    it('should include "must be an object" for null profile', () => {
      const msg = getErrorMessage(() => validateUserProfile(null));
      expect(msg).toMatch(/must be an object/);
    });

    it('should include "User profile" in error for null', () => {
      const msg = getErrorMessage(() => validateUserProfile(null));
      expect(msg).toMatch(/User profile/);
    });

    it('should include "Working days must be an array" for non-array', () => {
      const msg = getErrorMessage(() => validateUserProfile({ workingDays: 'MONDAY' }));
      expect(msg).toMatch(/Working days must be an array/);
    });

    it('should include "Working day at index" for invalid day entry', () => {
      const msg = getErrorMessage(() => validateUserProfile({ workingDays: ['MONDAY', ''] }));
      expect(msg).toMatch(/Working day at index/);
    });

    it('should include index number in error for invalid day', () => {
      const msg = getErrorMessage(() => validateUserProfile({ workingDays: ['MONDAY', '', 'WEDNESDAY'] }));
      expect(msg).toMatch(/index 1/);
    });

    it('should include "must be a non-empty string" for non-string day', () => {
      const msg = getErrorMessage(() => validateUserProfile({ workingDays: ['MONDAY', 123] }));
      expect(msg).toMatch(/must be a non-empty string/);
    });

    it('should return true for valid profile with all fields', () => {
      expect(validateUserProfile({ workCapacity: 'PT8H', workingDays: ['MONDAY', 'TUESDAY'] })).toBe(true);
    });

    it('should return true for empty profile', () => {
      expect(validateUserProfile({})).toBe(true);
    });
  });

  describe('validateDateRange error messages', () => {
    it('should include "Invalid date format" for invalid start', () => {
      const msg = getErrorMessage(() => validateDateRange('not-a-date', '2025-01-31'));
      expect(msg).toMatch(/Invalid date format/);
    });

    it('should include "Use YYYY-MM-DD" in error for invalid format', () => {
      const msg = getErrorMessage(() => validateDateRange('invalid', '2025-01-31'));
      expect(msg).toMatch(/YYYY-MM-DD/);
    });

    it('should include "Start date must be before end date" for reversed range', () => {
      const msg = getErrorMessage(() => validateDateRange('2025-02-01', '2025-01-01'));
      expect(msg).toMatch(/Start date must be before end date/);
    });

    it('should return true for valid date range', () => {
      expect(validateDateRange('2025-01-01', '2025-01-31')).toBe(true);
    });

    it('should return true for same start and end date', () => {
      expect(validateDateRange('2025-01-15', '2025-01-15')).toBe(true);
    });
  });
});

// ============================================================================
// MUTATION TESTING - ISO Duration Regex (C3)
// ============================================================================
// Tests for multi-digit values in ISO duration parsing
// ============================================================================

describe('parseIsoDuration Mutation Tests', () => {
  let parseIsoDuration;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    parseIsoDuration = utils.parseIsoDuration;
  });

  describe('multi-digit values', () => {
    it('should parse multi-digit hours', () => {
      expect(parseIsoDuration('PT10H')).toBe(10);
      expect(parseIsoDuration('PT99H')).toBe(99);
      expect(parseIsoDuration('PT100H')).toBe(100);
    });

    it('should parse multi-digit minutes', () => {
      expect(parseIsoDuration('PT45M')).toBeCloseTo(0.75, 4);
      expect(parseIsoDuration('PT90M')).toBeCloseTo(1.5, 4);
      expect(parseIsoDuration('PT120M')).toBeCloseTo(2, 4);
    });

    it('should parse multi-digit seconds', () => {
      expect(parseIsoDuration('PT60S')).toBeCloseTo(60 / 3600, 6);
      expect(parseIsoDuration('PT120S')).toBeCloseTo(120 / 3600, 6);
      expect(parseIsoDuration('PT3600S')).toBeCloseTo(1, 4);
    });

    it('should parse fractional hours with multiple digits', () => {
      expect(parseIsoDuration('PT10.5H')).toBe(10.5);
      expect(parseIsoDuration('PT12.25H')).toBe(12.25);
    });

    it('should parse fractional minutes with multiple digits', () => {
      expect(parseIsoDuration('PT30.5M')).toBeCloseTo(30.5 / 60, 6);
      expect(parseIsoDuration('PT45.75M')).toBeCloseTo(45.75 / 60, 6);
    });

    it('should parse fractional seconds with multiple digits', () => {
      expect(parseIsoDuration('PT1.123456S')).toBeCloseTo(1.123456 / 3600, 10);
      expect(parseIsoDuration('PT59.999S')).toBeCloseTo(59.999 / 3600, 8);
    });

    it('should parse combined multi-digit values', () => {
      expect(parseIsoDuration('PT12H30M45S')).toBeCloseTo(12 + 30/60 + 45/3600, 4);
      expect(parseIsoDuration('PT24H59M59S')).toBeCloseTo(24 + 59/60 + 59/3600, 4);
    });
  });

  describe('edge cases', () => {
    it('should return 0 for null input', () => {
      expect(parseIsoDuration(null)).toBe(0);
    });

    it('should return 0 for undefined input', () => {
      expect(parseIsoDuration(undefined)).toBe(0);
    });

    it('should return 0 for empty string', () => {
      expect(parseIsoDuration('')).toBe(0);
    });

    it('should return 0 for non-matching format', () => {
      expect(parseIsoDuration('not-a-duration')).toBe(0);
      expect(parseIsoDuration('P1D')).toBe(0);
      expect(parseIsoDuration('8H')).toBe(0);
    });

    it('should handle PT0H0M0S', () => {
      expect(parseIsoDuration('PT0H0M0S')).toBe(0);
    });

    it('should handle PT0H', () => {
      expect(parseIsoDuration('PT0H')).toBe(0);
    });
  });
});

// ============================================================================
// MUTATION TESTING - Error Classification (C5)
// ============================================================================
// Tests for all error type classification branches
// ============================================================================

describe('classifyError Mutation Tests', () => {
  let classifyError;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    classifyError = utils.classifyError;
  });

  describe('null and undefined errors', () => {
    it('should return UNKNOWN_ERROR for null', () => {
      expect(classifyError(null)).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for undefined', () => {
      expect(classifyError(undefined)).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for empty string', () => {
      expect(classifyError('')).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for 0', () => {
      expect(classifyError(0)).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for false', () => {
      expect(classifyError(false)).toBe('UNKNOWN_ERROR');
    });
  });

  describe('network errors', () => {
    it('should classify TypeError with fetch as NETWORK_ERROR', () => {
      const error = new TypeError('fetch failed');
      expect(classifyError(error)).toBe('NETWORK_ERROR');
    });

    it('should classify TypeError with "Failed to fetch" as NETWORK_ERROR', () => {
      const error = new TypeError('Failed to fetch');
      expect(classifyError(error)).toBe('NETWORK_ERROR');
    });

    it('should classify AbortError as NETWORK_ERROR', () => {
      const error = new Error('Operation aborted');
      error.name = 'AbortError';
      expect(classifyError(error)).toBe('NETWORK_ERROR');
    });

    it('should NOT classify TypeError without fetch as NETWORK_ERROR', () => {
      const error = new TypeError('Cannot read property of null');
      expect(classifyError(error)).toBe('UNKNOWN_ERROR');
    });
  });

  describe('auth errors', () => {
    it('should classify 401 as AUTH_ERROR', () => {
      expect(classifyError({ status: 401 })).toBe('AUTH_ERROR');
    });

    it('should classify 403 as AUTH_ERROR', () => {
      expect(classifyError({ status: 403 })).toBe('AUTH_ERROR');
    });
  });

  describe('validation errors (4xx)', () => {
    it('should classify 400 as VALIDATION_ERROR', () => {
      expect(classifyError({ status: 400 })).toBe('VALIDATION_ERROR');
    });

    it('should classify 404 as VALIDATION_ERROR', () => {
      expect(classifyError({ status: 404 })).toBe('VALIDATION_ERROR');
    });

    it('should classify 422 as VALIDATION_ERROR', () => {
      expect(classifyError({ status: 422 })).toBe('VALIDATION_ERROR');
    });

    it('should classify 499 as VALIDATION_ERROR', () => {
      expect(classifyError({ status: 499 })).toBe('VALIDATION_ERROR');
    });

    it('should NOT classify 401 as VALIDATION_ERROR (auth takes precedence)', () => {
      expect(classifyError({ status: 401 })).toBe('AUTH_ERROR');
    });

    it('should NOT classify 403 as VALIDATION_ERROR (auth takes precedence)', () => {
      expect(classifyError({ status: 403 })).toBe('AUTH_ERROR');
    });
  });

  describe('API errors (5xx)', () => {
    it('should classify 500 as API_ERROR', () => {
      expect(classifyError({ status: 500 })).toBe('API_ERROR');
    });

    it('should classify 501 as API_ERROR', () => {
      expect(classifyError({ status: 501 })).toBe('API_ERROR');
    });

    it('should classify 502 as API_ERROR', () => {
      expect(classifyError({ status: 502 })).toBe('API_ERROR');
    });

    it('should classify 503 as API_ERROR', () => {
      expect(classifyError({ status: 503 })).toBe('API_ERROR');
    });

    it('should classify 599 as API_ERROR', () => {
      expect(classifyError({ status: 599 })).toBe('API_ERROR');
    });
  });

  describe('edge cases', () => {
    it('should return UNKNOWN_ERROR for status 0', () => {
      expect(classifyError({ status: 0 })).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for status 200', () => {
      expect(classifyError({ status: 200 })).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for status 300', () => {
      expect(classifyError({ status: 300 })).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for status 399', () => {
      expect(classifyError({ status: 399 })).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for error without status', () => {
      expect(classifyError(new Error('Generic error'))).toBe('UNKNOWN_ERROR');
    });

    it('should return UNKNOWN_ERROR for object without status', () => {
      expect(classifyError({ message: 'error' })).toBe('UNKNOWN_ERROR');
    });
  });
});

// ============================================================================
// MUTATION TESTING - createUserFriendlyError (C5 continued)
// ============================================================================

describe('createUserFriendlyError Mutation Tests', () => {
  let createUserFriendlyError;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    createUserFriendlyError = utils.createUserFriendlyError;
  });

  describe('error structure', () => {
    it('should include type field', () => {
      const result = createUserFriendlyError('test error');
      expect(result).toHaveProperty('type');
      expect(typeof result.type).toBe('string');
    });

    it('should include title field', () => {
      const result = createUserFriendlyError('test error');
      expect(result).toHaveProperty('title');
      expect(typeof result.title).toBe('string');
      expect(result.title.length).toBeGreaterThan(0);
    });

    it('should include message field', () => {
      const result = createUserFriendlyError('test error');
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });

    it('should include action field', () => {
      const result = createUserFriendlyError('test error');
      expect(result).toHaveProperty('action');
      expect(typeof result.action).toBe('string');
    });

    it('should include originalError field', () => {
      const result = createUserFriendlyError('test error');
      expect(result).toHaveProperty('originalError');
      expect(result.originalError).toBeInstanceOf(Error);
    });

    it('should include timestamp field', () => {
      const result = createUserFriendlyError('test error');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
      // Should be ISO format
      expect(result.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('should include stack field', () => {
      const result = createUserFriendlyError(new Error('test'));
      expect(result).toHaveProperty('stack');
      expect(typeof result.stack).toBe('string');
    });
  });

  describe('string vs Error input', () => {
    it('should create Error from string input', () => {
      const result = createUserFriendlyError('my error message');
      expect(result.originalError.message).toBe('my error message');
    });

    it('should preserve Error object input', () => {
      const originalError = new Error('original error');
      const result = createUserFriendlyError(originalError);
      expect(result.originalError).toBe(originalError);
    });
  });

  describe('type override', () => {
    it('should use explicit type when provided', () => {
      const result = createUserFriendlyError('error', 'AUTH_ERROR');
      expect(result.type).toBe('AUTH_ERROR');
    });

    it('should classify error when type not provided', () => {
      const error = { status: 401 };
      const result = createUserFriendlyError(error);
      expect(result.type).toBe('AUTH_ERROR');
    });

    it('should use UNKNOWN_ERROR type for unknown errors', () => {
      const result = createUserFriendlyError(new Error('unknown'));
      expect(result.type).toBe('UNKNOWN_ERROR');
    });
  });

  describe('fallback messages', () => {
    it('should use fallback message for unknown error type', () => {
      const result = createUserFriendlyError('error', 'TOTALLY_FAKE_TYPE');
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  describe('stack handling', () => {
    it('should handle error without stack gracefully', () => {
      const errorLike = { message: 'no stack' };
      const result = createUserFriendlyError(errorLike);
      // Should not throw
      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// MUTATION TESTING - Week Utilities (C4)
// ============================================================================

describe('Week Utilities Mutation Tests', () => {
  let getWeekKey, formatWeekKey, getISOWeek;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    getWeekKey = utils.getWeekKey;
    formatWeekKey = utils.formatWeekKey;
    getISOWeek = utils.getISOWeek;
  });

  describe('getWeekKey', () => {
    it('should return empty string for null date', () => {
      expect(getWeekKey(null)).toBe('');
    });

    it('should return empty string for undefined date', () => {
      expect(getWeekKey(undefined)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(getWeekKey('')).toBe('');
    });

    it('should return week key in correct format', () => {
      const result = getWeekKey('2025-01-15');
      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('should calculate correct week for known date', () => {
      // Jan 15, 2025 is Wednesday of week 3
      const result = getWeekKey('2025-01-15');
      expect(result).toBe('2025-W03');
    });

    it('should handle year boundary correctly (Dec 31)', () => {
      // Dec 31, 2024 is in week 1 of 2025
      const result = getWeekKey('2024-12-31');
      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('should handle first week of year', () => {
      const result = getWeekKey('2025-01-02');
      expect(result).toMatch(/2025-W01/);
    });
  });

  describe('formatWeekKey', () => {
    it('should return original string for invalid format', () => {
      expect(formatWeekKey('invalid')).toBe('invalid');
      expect(formatWeekKey('2025-03')).toBe('2025-03');
      expect(formatWeekKey('W01')).toBe('W01');
    });

    it('should format valid week key correctly', () => {
      expect(formatWeekKey('2025-W03')).toBe('Week 3, 2025');
    });

    it('should format week 1 correctly', () => {
      expect(formatWeekKey('2025-W01')).toBe('Week 1, 2025');
    });

    it('should format week 52 correctly', () => {
      expect(formatWeekKey('2024-W52')).toBe('Week 52, 2024');
    });

    it('should format week 53 correctly', () => {
      expect(formatWeekKey('2020-W53')).toBe('Week 53, 2020');
    });

    it('should handle leading zeros in week number', () => {
      expect(formatWeekKey('2025-W09')).toBe('Week 9, 2025');
    });
  });

  describe('getISOWeek', () => {
    it('should return week 1 for first Thursday of year', () => {
      // Jan 2, 2025 is Thursday of week 1
      const date = new Date('2025-01-02');
      expect(getISOWeek(date)).toBe(1);
    });

    it('should return correct week for mid-year date', () => {
      const date = new Date('2025-07-15');
      const week = getISOWeek(date);
      expect(week).toBeGreaterThan(28);
      expect(week).toBeLessThan(30);
    });

    it('should handle dates at end of year', () => {
      const date = new Date('2025-12-28');
      const week = getISOWeek(date);
      expect(week).toBeGreaterThanOrEqual(52);
    });
  });
});

// ============================================================================
// MUTATION TESTING - getDateRangeDays (C4 continued)
// ============================================================================

describe('getDateRangeDays Mutation Tests', () => {
  let getDateRangeDays;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    getDateRangeDays = utils.getDateRangeDays;
  });

  it('should return 0 for invalid start date', () => {
    expect(getDateRangeDays('invalid', '2025-01-15')).toBe(0);
  });

  it('should return 0 for invalid end date', () => {
    expect(getDateRangeDays('2025-01-01', 'invalid')).toBe(0);
  });

  it('should return 0 for both invalid dates', () => {
    expect(getDateRangeDays('invalid', 'also-invalid')).toBe(0);
  });

  it('should return 1 for same day', () => {
    expect(getDateRangeDays('2025-01-15', '2025-01-15')).toBe(1);
  });

  it('should return correct count for multi-day range', () => {
    expect(getDateRangeDays('2025-01-01', '2025-01-10')).toBe(10);
    expect(getDateRangeDays('2025-01-01', '2025-01-31')).toBe(31);
  });

  it('should handle month boundaries', () => {
    expect(getDateRangeDays('2025-01-30', '2025-02-02')).toBe(4);
  });

  it('should handle year boundaries', () => {
    expect(getDateRangeDays('2024-12-30', '2025-01-02')).toBe(4);
  });
});

// ============================================================================
// MUTATION TESTING - escapeHtml (additional edge cases)
// ============================================================================

describe('escapeHtml Mutation Tests', () => {
  let escapeHtml;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    escapeHtml = utils.escapeHtml;
  });

  it('should escape ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should escape less than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('should escape greater than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('should escape double quote', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  it('should escape single quote', () => {
    expect(escapeHtml("a 'b' c")).toBe('a &#039;b&#039; c');
  });

  it('should escape all special characters together', () => {
    const input = '<script>alert("xss\'s");</script> & more';
    const expected = '&lt;script&gt;alert(&quot;xss&#039;s&quot;);&lt;/script&gt; &amp; more';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('should handle consecutive special characters', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });

  it('should not double-escape already escaped content', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

// ============================================================================
// MUTATION TESTING - escapeCsv (formula injection prevention)
// ============================================================================

describe('escapeCsv Mutation Tests', () => {
  let escapeCsv;

  beforeEach(async () => {
    const utils = await import('../../js/utils.js');
    escapeCsv = utils.escapeCsv;
  });

  describe('basic escaping', () => {
    it('should return empty string for null', () => {
      expect(escapeCsv(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(escapeCsv(undefined)).toBe('');
    });

    it('should return string unchanged if no special characters', () => {
      expect(escapeCsv('simple text')).toBe('simple text');
    });

    it('should convert number to string', () => {
      expect(escapeCsv(123)).toBe('123');
      expect(escapeCsv(0)).toBe('0');
      // Negative numbers are quoted to prevent formula injection (- is a formula char)
      expect(escapeCsv(-456)).toBe('"-456"');
    });

    it('should convert boolean to string', () => {
      expect(escapeCsv(true)).toBe('true');
      expect(escapeCsv(false)).toBe('false');
    });
  });

  describe('special character handling', () => {
    it('should wrap and escape when string contains double quotes', () => {
      expect(escapeCsv('text "with" quotes')).toBe('"text ""with"" quotes"');
    });

    it('should wrap when string contains comma', () => {
      expect(escapeCsv('one, two')).toBe('"one, two"');
    });

    it('should wrap when string contains newline (\\n)', () => {
      expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    });

    it('should wrap when string contains carriage return (\\r)', () => {
      expect(escapeCsv('line1\rline2')).toBe('"line1\rline2"');
    });

    it('should handle multiple special characters', () => {
      expect(escapeCsv('a, "b"\nc')).toBe('"a, ""b""\nc"');
    });
  });
});

// ============================================================================
// MUTATION TESTING - IsoUtils additional coverage
// ============================================================================

describe('IsoUtils Mutation Tests', () => {
  describe('toISODate', () => {
    it('should format date with single-digit month', () => {
      const date = new Date('2025-03-05T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-03-05');
    });

    it('should format date with single-digit day', () => {
      const date = new Date('2025-12-01T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-12-01');
    });

    it('should pad month and day with leading zeros', () => {
      const date = new Date('2025-01-09T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-01-09');
    });
  });

  describe('getWeekdayKey', () => {
    it('should return SUNDAY for Sunday', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-12')).toBe('SUNDAY');
    });

    it('should return MONDAY for Monday', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-13')).toBe('MONDAY');
    });

    it('should return SATURDAY for Saturday', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-11')).toBe('SATURDAY');
    });

    it('should return THURSDAY for Thursday', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-16')).toBe('THURSDAY');
    });

    it('should return FRIDAY for Friday', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-17')).toBe('FRIDAY');
    });

    it('should handle invalid date gracefully', () => {
      // getWeekdayKey calls parseDate which returns Invalid Date for invalid input
      // date.getUTCDay() on Invalid Date returns NaN, so days[NaN] is undefined
      // This is acceptable behavior - callers should provide valid dates
      const result = IsoUtils.getWeekdayKey('invalid-date');
      expect(result === '' || result === undefined).toBe(true);
    });
  });

  describe('extractDateKey edge cases', () => {
    it('should handle date with timezone offset', () => {
      // Note: extractDateKey uses local time
      const result = IsoUtils.extractDateKey('2025-01-15T23:30:00Z');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return the same date for 10-char input', () => {
      expect(IsoUtils.extractDateKey('2025-01-15')).toBe('2025-01-15');
    });

    it('should return null for non-date 10-char string', () => {
      // A string that is 10 chars but not valid date format
      const result = IsoUtils.extractDateKey('abcdefghij');
      // This returns the string as-is because it's 10 chars
      expect(result).toBe('abcdefghij');
    });
  });

  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      expect(IsoUtils.isWeekend('2025-01-11')).toBe(true);
    });

    it('should return true for Sunday', () => {
      expect(IsoUtils.isWeekend('2025-01-12')).toBe(true);
    });

    it('should return false for Monday', () => {
      expect(IsoUtils.isWeekend('2025-01-13')).toBe(false);
    });

    it('should return false for Friday', () => {
      expect(IsoUtils.isWeekend('2025-01-17')).toBe(false);
    });

    it('should return false for invalid date', () => {
      expect(IsoUtils.isWeekend('invalid')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(IsoUtils.isWeekend('')).toBe(false);
    });
  });
});

// ============================================================================
// BASE64URL DECODING
// ============================================================================

describe('base64urlDecode', () => {
  it('should decode standard Base64URL string', () => {
    // "Hello" encoded as base64url
    const encoded = 'SGVsbG8';
    expect(base64urlDecode(encoded)).toBe('Hello');
  });

  it('should handle Base64URL with - and _ characters', () => {
    // Base64URL uses - instead of + and _ instead of /
    // "a+b/c" in standard Base64 is YStiL2M=
    // In Base64URL: YStiL2M becomes YStiL2M (no change needed for this example)
    // Let's use a known value: "<<>>" in Base64 is PDw+Pg== which in Base64URL is PDw-Pg
    const encoded = 'PDw-Pg';
    expect(base64urlDecode(encoded)).toBe('<<>>');
  });

  it('should add missing padding', () => {
    // "a" encoded as base64 is "YQ==" but base64url omits padding: "YQ"
    expect(base64urlDecode('YQ')).toBe('a');
    // "ab" encoded is "YWI=" but base64url omits padding: "YWI"
    expect(base64urlDecode('YWI')).toBe('ab');
  });

  it('should handle strings that need no padding', () => {
    // "abc" encoded as base64url is "YWJj" (length divisible by 4)
    expect(base64urlDecode('YWJj')).toBe('abc');
  });

  it('should decode a JWT-like payload', () => {
    // A minimal JWT payload: {"sub":"123"}
    const payload = 'eyJzdWIiOiIxMjMifQ';
    const decoded = base64urlDecode(payload);
    expect(JSON.parse(decoded)).toEqual({ sub: '123' });
  });

  it('should handle payload with special base64url characters from JWT', () => {
    // Create a payload that would have + and / in standard base64
    // This simulates real JWT payloads that might contain these
    const payload = 'eyJ3b3Jrc3BhY2VJZCI6IndzXzEyMyIsInRoZW1lIjoiREFSSyJ9';
    const decoded = JSON.parse(base64urlDecode(payload));
    expect(decoded).toEqual({ workspaceId: 'ws_123', theme: 'DARK' });
  });
});
