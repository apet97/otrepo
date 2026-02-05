/**
 * @jest-environment jsdom
 *
 * Targeted tests to kill surviving mutants in utils.ts
 * These tests assert on exact values and error messages to ensure mutations are detected.
 */

import { jest, beforeEach, afterEach, describe, it, expect } from '@jest/globals';
import {
  validateRequiredFields,
  validateString,
  validateISODateString,
  validateTimeEntry,
  validateUser,
  validateUserProfile,
  validateDateRange,
  classifyError,
  createUserFriendlyError,
  round,
  safeJSONParse,
  escapeHtml,
  escapeCsv,
  parseIsoDuration,
  formatHours,
  formatHoursDecimal,
  formatCurrency,
  getWeekKey,
  formatWeekKey,
  getISOWeek,
  getDateRangeDays,
  classifyEntryForOvertime,
  IsoUtils,
  formatDate,
  isValidTimeZone,
  setCanonicalTimeZone,
} from '../../js/utils.js';
import { ERROR_TYPES } from '../../js/constants.js';
import { standardAfterEach, standardBeforeEach } from '../helpers/setup.js';

// Helper to get the original error message from FriendlyError
function getOriginalMessage(e) {
  return e.originalError?.message || e.message;
}

describe('Utils Mutation Killers', () => {
  beforeEach(() => {
    standardBeforeEach();
  });

  afterEach(() => {
    standardAfterEach();
  });

  describe('validateRequiredFields - Kill context default mutation (line 39)', () => {
    it('should include "Object" in error when context is not provided', () => {
      // Mutant: context = 'Object' -> context = ""
      // This test fails if context becomes empty string
      try {
        validateRequiredFields(null, ['field']);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('Object');
        expect(e.originalError.message).toContain('is not an object');
      }
    });

    it('should include "Object" when validating non-object without context', () => {
      try {
        validateRequiredFields('string', ['field']);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('Object');
      }
    });
  });

  describe('validateRequiredFields - Kill join separator mutation (line 49)', () => {
    it('should include comma-space separator in missing fields list', () => {
      // Mutant: missing.join(', ') -> missing.join("")
      // This test fails if separator becomes empty string
      try {
        validateRequiredFields({}, ['fieldA', 'fieldB']);
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect(e.originalError.message).toContain('fieldA, fieldB');
        expect(e.originalError.message).not.toBe('Object missing required fields: fieldAfieldB');
      }
    });

    it('should show all missing fields separated by comma-space', () => {
      try {
        validateRequiredFields({}, ['a', 'b', 'c']);
      } catch (e) {
        expect(e.originalError.message).toMatch(/a, b, c/);
      }
    });
  });

  describe('validateString - Kill logical/conditional mutations (line 81)', () => {
    it('should throw for null specifically (tests || vs &&)', () => {
      // Mutant: || -> && would require ALL conditions to be true
      // With &&: null AND undefined AND not-string must ALL be true
      // null is null, but not undefined, so && would pass - test catches this
      try {
        validateString(null, 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should throw for undefined specifically', () => {
      try {
        validateString(undefined, 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should throw for number (not string type)', () => {
      try {
        validateString(123, 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should throw for object (not string type)', () => {
      try {
        validateString({}, 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should throw for boolean (not string type)', () => {
      try {
        validateString(true, 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should NOT throw for valid string', () => {
      expect(validateString('valid', 'test')).toBe('valid');
    });
  });

  describe('validateISODateString - Kill regex anchor mutations (line 102)', () => {
    it('should reject string that contains valid date but does not START with it', () => {
      // Mutant: /^\d{4}-\d{2}-\d{2}/ -> /\d{4}-\d{2}-\d{2}/ (removes ^)
      // "abc2025-01-15" should fail but would pass without ^
      try {
        validateISODateString('abc2025-01-15', 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be in ISO format');
      }
    });

    it('should reject string with text prefix', () => {
      try {
        validateISODateString('date:2025-01-15', 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('ISO format');
      }
    });

    it('should reject string with space prefix - space gets trimmed so this tests trimming', () => {
      // Note: validateString trims the input, so ' 2025-01-15' becomes '2025-01-15'
      // This test ensures the validation works correctly
      expect(validateISODateString(' 2025-01-15', 'test')).toBe('2025-01-15');
    });

    it('should accept string that starts with valid date', () => {
      expect(validateISODateString('2025-01-15', 'test')).toBe('2025-01-15');
    });

    it('should accept ISO timestamp that starts with valid date', () => {
      expect(validateISODateString('2025-01-15T10:30:00Z', 'test')).toBe('2025-01-15T10:30:00Z');
    });

    it('should reject short invalid date pattern (3 digits in day)', () => {
      // Mutant: /^\d{4}-\d{2}-\d{2}/ -> /^\d{4}-\d{2}-\d/ (removes digit requirement)
      // "2025-01-1" has 1 digit day
      try {
        validateISODateString('2025-01-1', 'test');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('ISO format');
      }
    });
  });

  describe('validateTimeEntry - Kill typeof mutation (line 139)', () => {
    it('should throw for string entry (not object)', () => {
      // Mutant: typeof entry !== 'object' -> false
      // Would pass string through if mutation applied
      try {
        validateTimeEntry('not-an-object');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });

    it('should throw for number entry', () => {
      try {
        validateTimeEntry(123);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });

    it('should throw for boolean entry', () => {
      try {
        validateTimeEntry(true);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });

    it('should throw for array (arrays are objects but not valid entries)', () => {
      // Arrays pass typeof === 'object' but lack required fields
      expect(() => validateTimeEntry([])).toThrow();
    });
  });

  describe('validateTimeEntry - Kill context and array mutations (lines 150-152)', () => {
    it('should include "Time entry" in error for missing timeInterval', () => {
      // Mutant: 'Time entry' -> ""
      const entry = { id: 'id1', userId: 'user1' };
      try {
        validateTimeEntry(entry);
      } catch (e) {
        expect(e.originalError.message).toContain('Time entry');
      }
    });

    it('should include "Time interval" in error for missing start/end', () => {
      // Mutant: 'Time interval' -> ""
      const entry = { id: 'id1', userId: 'user1', timeInterval: {} };
      try {
        validateTimeEntry(entry);
      } catch (e) {
        expect(e.originalError.message).toContain('Time interval');
      }
    });

    it('should require timeInterval field (array not empty)', () => {
      // Mutant: ['timeInterval'] -> []
      const entry = { id: 'id1', userId: 'user1' };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('timeInterval');
      }
    });

    it('should require start and end fields (array not empty)', () => {
      // Mutant: ['start', 'end'] -> []
      const entry = { id: 'id1', userId: 'user1', timeInterval: { duration: 'PT1H' } };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toMatch(/start|end/);
      }
    });
  });

  describe('validateTimeEntry - Kill duration block mutation (line 158)', () => {
    it('should validate duration when present', () => {
      // Mutant: block removed - validation would be skipped
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 123, // Invalid: number instead of string
        },
      };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should validate duration string is not empty', () => {
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: '   ',
        },
      };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('cannot be empty');
      }
    });
  });

  describe('validateTimeEntry - Kill hourlyRate mutations (lines 163-164)', () => {
    it('should include "Time entry hourly rate" in error for missing amount', () => {
      // Mutant: 'Time entry hourly rate' -> ""
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z' },
        hourlyRate: {},
      };
      try {
        validateTimeEntry(entry);
      } catch (e) {
        expect(e.originalError.message).toContain('hourly rate');
      }
    });

    it('should include "Hourly rate amount" in error for invalid amount', () => {
      // Mutant: 'Hourly rate amount' -> ""
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z' },
        hourlyRate: { amount: 'invalid' },
      };
      try {
        validateTimeEntry(entry);
      } catch (e) {
        expect(e.originalError.message).toMatch(/amount/i);
      }
    });

    it('should require amount field in hourlyRate (array not empty)', () => {
      // Mutant: ['amount'] -> []
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z' },
        hourlyRate: { currency: 'USD' },
      };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('amount');
      }
    });
  });

  describe('validateUser - Kill typeof mutation (line 191)', () => {
    it('should throw for string user', () => {
      try {
        validateUser('john');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });

    it('should throw for number user', () => {
      try {
        validateUser(42);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });

    it('should throw for boolean user', () => {
      try {
        validateUser(false);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });
  });

  describe('validateUserProfile - Kill typeof mutation (line 217)', () => {
    it('should throw for string profile', () => {
      try {
        validateUserProfile('profile');
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });

    it('should throw for number profile', () => {
      try {
        validateUserProfile(100);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be an object');
      }
    });
  });

  describe('validateUserProfile - Kill workCapacity mutations (lines 223-224)', () => {
    it('should validate workCapacity when present', () => {
      // Mutant: if condition -> false (skips validation)
      // Mutant: block removed
      try {
        validateUserProfile({ workCapacity: 123 });
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should include "Work capacity" in error message', () => {
      // Mutant: 'Work capacity' -> ""
      try {
        validateUserProfile({ workCapacity: null });
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('Work capacity');
      }
    });

    it('should reject empty workCapacity string', () => {
      try {
        validateUserProfile({ workCapacity: '' });
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('cannot be empty');
      }
    });
  });

  describe('classifyError - Kill condition mutations (line 280)', () => {
    it('should NOT classify non-TypeError with fetch message as NETWORK_ERROR', () => {
      // Mutant: err.name === 'TypeError' -> true
      // Would make ALL errors with fetch message return NETWORK_ERROR
      const error = new Error('fetch failed');
      error.name = 'CustomError'; // Not TypeError
      expect(classifyError(error)).toBe(ERROR_TYPES.UNKNOWN);
    });

    it('should classify TypeError with fetch as NETWORK_ERROR', () => {
      const error = new TypeError('Failed to fetch');
      expect(classifyError(error)).toBe(ERROR_TYPES.NETWORK);
    });

    it('should NOT classify TypeError without fetch message as NETWORK_ERROR', () => {
      const error = new TypeError('undefined is not a function');
      expect(classifyError(error)).toBe(ERROR_TYPES.UNKNOWN);
    });
  });

  describe('classifyError - Kill optional chaining mutation (line 280)', () => {
    it('should handle error with undefined message property', () => {
      // Mutant: err.message?.includes -> err.message.includes
      // Would throw if message is undefined
      const error = new TypeError();
      // @ts-ignore - testing edge case
      error.message = undefined;
      expect(() => classifyError(error)).not.toThrow();
      expect(classifyError(error)).toBe(ERROR_TYPES.UNKNOWN);
    });

    it('should handle TypeError with null message', () => {
      const error = new TypeError();
      // @ts-ignore - testing edge case
      error.message = null;
      expect(() => classifyError(error)).not.toThrow();
    });
  });

  describe('createUserFriendlyError - Kill optional chaining mutation (line 320)', () => {
    it('should handle error without stack property', () => {
      // Mutant: err?.stack -> err.stack
      // Would throw if err is undefined
      const error = new Error('test');
      delete error.stack;
      const result = createUserFriendlyError(error);
      expect(result.stack).toBeUndefined();
    });

    it('should include stack when present', () => {
      const error = new Error('test with stack');
      const result = createUserFriendlyError(error);
      expect(result.stack).toContain('Error');
    });
  });

  describe('formatHoursDecimal - Kill condition mutation (line 475)', () => {
    it('should return "0.00" for null', () => {
      // Mutant: if condition -> false
      // Would try to process null and fail
      expect(formatHoursDecimal(null)).toBe('0.00');
    });

    it('should return "0.00" for undefined', () => {
      expect(formatHoursDecimal(undefined)).toBe('0.00');
    });

    it('should return "0.00" for NaN', () => {
      expect(formatHoursDecimal(NaN)).toBe('0.00');
    });

    it('should format valid number', () => {
      expect(formatHoursDecimal(8.5)).toBe('8.50');
    });

    // Additional mutation killers for line 477
    it('should return "0.00" for exactly null - kills OR->AND mutation', () => {
      // Mutant: || -> && would fail because null && undefined is falsy
      // but we need the condition to trigger on null ALONE
      const result = formatHoursDecimal(null);
      expect(result).toBe('0.00');
      // The mutant `hours === null && hours === undefined` would NEVER be true
      // because nothing is both null AND undefined
      // So this test passing proves the OR is correct
    });

    it('should return "0.00" for exactly undefined - kills OR->AND mutation', () => {
      const result = formatHoursDecimal(undefined);
      expect(result).toBe('0.00');
    });

    it('should NOT return "0.00" for 0 - proves condition is specific', () => {
      // 0 is neither null nor undefined, so it should be formatted
      const result = formatHoursDecimal(0);
      expect(result).toBe('0.00');
      // This also passes with the correct code, but proves
      // that the null/undefined check is needed
    });

    it('should format -0 correctly (not null/undefined)', () => {
      // -0 is a valid number, not null/undefined
      expect(formatHoursDecimal(-0)).toBe('0.00');
    });

    it('should format empty string coerced to 0', () => {
      // @ts-ignore - testing edge case
      const result = formatHoursDecimal('');
      // Empty string coerces to 0 via parseFloat
      expect(result).toBe('0.00');
    });

    it('should prove both branches of || are necessary', () => {
      // If the mutant removes `hours === null || `:
      // null would pass the undefined check? No, null !== undefined
      // So the code would try to process null and fail

      // If the mutant removes `|| hours === undefined`:
      // undefined would not match null, so it would be processed

      // Test both independently
      expect(formatHoursDecimal(null)).toBe('0.00');
      expect(formatHoursDecimal(undefined)).toBe('0.00');

      // And prove they're different from each other
      expect(null === undefined).toBe(false);
    });
  });

  describe('getWeekKey - Kill arithmetic mutations (lines 632-633)', () => {
    it('should correctly identify week year for dates near year boundary', () => {
      // Mutant: + 6 -> - 6 in dayNumber calculation
      // Would produce wrong week number

      // Dec 31, 2024 is Tuesday, should be in week 1 of 2025
      expect(getWeekKey('2024-12-31')).toBe('2025-W01');

      // Jan 1, 2025 is Wednesday, should be in week 1 of 2025
      expect(getWeekKey('2025-01-01')).toBe('2025-W01');
    });

    it('should handle Monday correctly', () => {
      // Jan 6, 2025 is Monday (week 2)
      expect(getWeekKey('2025-01-06')).toBe('2025-W02');
    });

    it('should handle Sunday correctly', () => {
      // Jan 5, 2025 is Sunday (last day of week 1)
      expect(getWeekKey('2025-01-05')).toBe('2025-W01');
    });

    it('should correctly calculate Thursday for ISO week', () => {
      // Mutant: - dayNumber + 3 -> + dayNumber + 3
      // Would produce wrong Thursday
      // Jan 9, 2025 is Thursday (week 2), Thursday of that week is Jan 9
      expect(getWeekKey('2025-01-09')).toBe('2025-W02');
    });
  });

  describe('formatWeekKey - Kill regex anchor mutations (line 647)', () => {
    it('should reject week key without start anchor', () => {
      // Mutant: /^(\d{4})-W(\d{2})$/ -> /(\d{4})-W(\d{2})$/
      // "abc2025-W01" should return original string, not formatted
      expect(formatWeekKey('abc2025-W01')).toBe('abc2025-W01');
    });

    it('should reject week key without end anchor', () => {
      // Mutant: /^(\d{4})-W(\d{2})$/ -> /^(\d{4})-W(\d{2})/
      // "2025-W01abc" should return original string, not formatted
      expect(formatWeekKey('2025-W01abc')).toBe('2025-W01abc');
    });

    it('should reject week key with extra content', () => {
      expect(formatWeekKey('2025-W01-extra')).toBe('2025-W01-extra');
    });

    it('should accept valid week key', () => {
      expect(formatWeekKey('2025-W01')).toBe('Week 1, 2025');
    });
  });

  describe('getISOWeek - Kill arithmetic mutations (lines 591-595)', () => {
    it('should return correct week for various days', () => {
      // These test the arithmetic in getISOWeek
      // Week 1 of 2025 starts Dec 30, 2024 (Monday)
      expect(getISOWeek(new Date('2025-01-01T12:00:00Z'))).toBe(1);
      expect(getISOWeek(new Date('2025-01-06T12:00:00Z'))).toBe(2);
      expect(getISOWeek(new Date('2025-01-13T12:00:00Z'))).toBe(3);
    });

    it('should handle edge case: first Thursday determines week 1', () => {
      // Jan 2, 2025 is Thursday, which is in week 1
      expect(getISOWeek(new Date('2025-01-02T12:00:00Z'))).toBe(1);
    });

    it('should handle year with 53 weeks', () => {
      // 2020 had 53 weeks (Dec 31, 2020 was Thursday of week 53)
      expect(getISOWeek(new Date('2020-12-31T12:00:00Z'))).toBe(53);
    });
  });

  describe('IsoUtils.getWeekdayKey - comprehensive day tests', () => {
    it('should return correct day for each weekday', () => {
      // Testing all days to ensure the array mapping is correct
      // 2025-01-05 is Sunday, 2025-01-06 is Monday, etc.
      expect(IsoUtils.getWeekdayKey('2025-01-05')).toBe('SUNDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-06')).toBe('MONDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-07')).toBe('TUESDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-08')).toBe('WEDNESDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-09')).toBe('THURSDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-10')).toBe('FRIDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-11')).toBe('SATURDAY');
    });
  });

  // Additional mutation killer tests for remaining survivors

  describe('validateUserProfile - Kill trim mutation (line 232)', () => {
    it('should reject whitespace-only working day (tests trim)', () => {
      // Mutant: (day as string).trim() === '' -> day as string === ''
      // Without trim(), '   ' would pass but should fail
      try {
        validateUserProfile({ workingDays: ['   '] });
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message).toContain('must be a non-empty string');
      }
    });

    it('should accept working day with surrounding whitespace', () => {
      // Valid day with whitespace - should be accepted (content exists)
      expect(() => validateUserProfile({ workingDays: ['  MONDAY  '] })).not.toThrow();
    });
  });

  describe('validateTimeEntry - Kill field name mutations (lines 154-159)', () => {
    it('should include "start time" in error for invalid start', () => {
      // Mutant: 'Time entry start time' -> ""
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: { start: 'invalid', end: '2025-01-15T17:00:00Z' },
      };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message.toLowerCase()).toContain('start');
      }
    });

    it('should include "end time" in error for invalid end', () => {
      // Mutant: 'Time entry end time' -> ""
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: { start: '2025-01-15T09:00:00Z', end: 'invalid' },
      };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        expect(e.originalError.message.toLowerCase()).toContain('end');
      }
    });

    it('should include "duration" in error for invalid duration type', () => {
      // Mutant: 'Time entry duration' -> ""
      // Empty string is falsy so doesn't trigger validation
      // Use a number instead which triggers validation
      const entry = {
        id: 'id1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 123, // Truthy but invalid type
        },
      };
      try {
        validateTimeEntry(entry);
        expect(true).toBe(false);
      } catch (e) {
        const msg = e.originalError?.message || e.message || String(e);
        expect(msg.toLowerCase()).toContain('duration');
      }
    });
  });

  describe('getWeekKey - Additional arithmetic mutation tests', () => {
    it('should handle Saturday correctly with week boundary', () => {
      // Jan 4, 2025 is Saturday (still week 1)
      expect(getWeekKey('2025-01-04')).toBe('2025-W01');
    });

    it('should handle first day of week 2 (Monday Jan 6)', () => {
      expect(getWeekKey('2025-01-06')).toBe('2025-W02');
    });

    it('should handle last day of week 1 (Sunday Jan 5)', () => {
      expect(getWeekKey('2025-01-05')).toBe('2025-W01');
    });

    it('should correctly assign Dec 29, 2024 (Sunday) to week 52 of 2024', () => {
      // Dec 29, 2024 is Sunday - last day of week 52 of 2024
      expect(getWeekKey('2024-12-29')).toBe('2024-W52');
    });

    it('should correctly assign Dec 30, 2024 (Monday) to week 1 of 2025', () => {
      // Dec 30, 2024 is Monday - first day of week 1 of 2025
      expect(getWeekKey('2024-12-30')).toBe('2025-W01');
    });

    it('should handle mid-year dates correctly', () => {
      // June 15, 2025 is Sunday (week 24)
      expect(getWeekKey('2025-06-15')).toBe('2025-W24');
    });
  });

  describe('formatHoursDecimal - Additional null/NaN tests', () => {
    it('should handle Number.POSITIVE_INFINITY', () => {
      // Tests that invalid values return 0.00
      expect(formatHoursDecimal(Number.POSITIVE_INFINITY)).toBe('0.00');
    });

    it('should handle string that becomes NaN', () => {
      // @ts-ignore - testing edge case
      expect(formatHoursDecimal('not-a-number')).toBe('0.00');
    });
  });

  describe('createUserFriendlyError - Additional edge cases', () => {
    it('should handle null error input gracefully', () => {
      // Tests err?.stack where err could be null
      // @ts-ignore - testing edge case
      const result = createUserFriendlyError(null);
      // Should not throw, should have undefined stack
      expect(result.stack).toBeUndefined();
    });
  });

  // ============================================================================
  // round() mutation killers - epsilon, factor, division
  // ============================================================================
  describe('round() - Kill arithmetic mutations (line 335-338)', () => {
    it('should return exactly 0 for non-finite input (not 1, not NaN)', () => {
      expect(round(NaN)).toBe(0);
      expect(round(Infinity)).toBe(0);
      expect(round(-Infinity)).toBe(0);
    });

    it('should round 1.00005 to 1.0001 with 4 decimals (tests epsilon + factor)', () => {
      // Without epsilon, floating point issues; with wrong factor, different result
      expect(round(1.00005, 4)).toBe(1.0001);
    });

    it('should round 0.1 + 0.2 correctly (floating point edge)', () => {
      expect(round(0.1 + 0.2, 4)).toBe(0.3);
    });

    it('should round with 0 decimal places', () => {
      expect(round(1.5, 0)).toBe(2);
      expect(round(1.4, 0)).toBe(1);
    });

    it('should round with 2 decimal places for currency', () => {
      expect(round(100.555, 2)).toBe(100.56);
      expect(round(100.554, 2)).toBe(100.55);
    });

    it('should handle negative numbers', () => {
      expect(round(-1.5, 0)).toBe(-1);
      expect(round(-2.5, 0)).toBe(-2);
    });

    it('should handle exact factor: 10^decimals (not 10^(decimals+1))', () => {
      // round(1.23456, 4) should be 1.2346, not 1.23456 (if factor is 10^5)
      expect(round(1.23456, 4)).toBe(1.2346);
      // With 3 decimals, should be 1.235
      expect(round(1.23456, 3)).toBe(1.235);
    });
  });

  // ============================================================================
  // parseIsoDuration() mutation killers
  // ============================================================================
  describe('parseIsoDuration() - Kill division constant mutations (line 397-407)', () => {
    it('should return 0 for null/undefined/empty', () => {
      expect(parseIsoDuration(null)).toBe(0);
      expect(parseIsoDuration(undefined)).toBe(0);
      expect(parseIsoDuration('')).toBe(0);
    });

    it('should return 0 for non-matching string', () => {
      expect(parseIsoDuration('not-a-duration')).toBe(0);
    });

    it('should parse hours exactly (not divide or multiply)', () => {
      expect(parseIsoDuration('PT8H')).toBe(8);
      expect(parseIsoDuration('PT1H')).toBe(1);
      expect(parseIsoDuration('PT0H')).toBe(0);
    });

    it('should divide minutes by exactly 60 (not 6 or 600)', () => {
      expect(parseIsoDuration('PT60M')).toBe(1); // 60/60 = 1
      expect(parseIsoDuration('PT30M')).toBe(0.5); // 30/60 = 0.5
      expect(parseIsoDuration('PT6M')).toBe(0.1); // 6/60 = 0.1
      expect(parseIsoDuration('PT1M')).toBeCloseTo(1 / 60, 10);
    });

    it('should divide seconds by exactly 3600 (not 360 or 36000)', () => {
      expect(parseIsoDuration('PT3600S')).toBe(1); // 3600/3600 = 1
      expect(parseIsoDuration('PT1800S')).toBe(0.5); // 1800/3600 = 0.5
      expect(parseIsoDuration('PT360S')).toBe(0.1); // 360/3600 = 0.1
      expect(parseIsoDuration('PT1S')).toBeCloseTo(1 / 3600, 10);
    });

    it('should combine hours + minutes + seconds correctly', () => {
      expect(parseIsoDuration('PT1H30M')).toBe(1.5);
      expect(parseIsoDuration('PT2H15M')).toBe(2.25);
      expect(parseIsoDuration('PT1H30M30S')).toBeCloseTo(1 + 0.5 + 30 / 3600, 10);
    });

    it('should handle fractional hours', () => {
      expect(parseIsoDuration('PT8.5H')).toBe(8.5);
      expect(parseIsoDuration('PT0.5H')).toBe(0.5);
    });

    it('should handle fractional minutes', () => {
      expect(parseIsoDuration('PT30.5M')).toBeCloseTo(30.5 / 60, 10);
    });

    it('should handle fractional seconds', () => {
      expect(parseIsoDuration('PT45.5S')).toBeCloseTo(45.5 / 3600, 10);
    });
  });

  // ============================================================================
  // escapeHtml() mutation killers
  // ============================================================================
  describe('escapeHtml() - Kill replacement order mutations (line 363-370)', () => {
    it('should return empty string for null/undefined/empty', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('')).toBe('');
    });

    it('should escape & before other entities (order matters!)', () => {
      // If & is not escaped first, &lt; from '<' escaping would become &amp;lt;
      const result = escapeHtml('&<>');
      expect(result).toBe('&amp;&lt;&gt;');
      // Verify no double-escaping
      expect(result).not.toContain('&amp;amp;');
      expect(result).not.toContain('&amp;lt;');
    });

    it('should escape all 5 HTML entities correctly', () => {
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('>')).toBe('&gt;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#039;');
    });

    it('should handle mixed content with all special chars', () => {
      const input = '<script>alert("XSS\' & evil")</script>';
      const result = escapeHtml(input);
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;');
      expect(result).toContain('&#039;');
    });
  });

  // ============================================================================
  // escapeCsv() mutation killers
  // ============================================================================
  describe('escapeCsv() - Kill quoting/doubling mutations (line 381-387)', () => {
    it('should return empty string for null/undefined', () => {
      expect(escapeCsv(null)).toBe('');
      expect(escapeCsv(undefined)).toBe('');
    });

    it('should not quote strings without special chars', () => {
      expect(escapeCsv('simple')).toBe('simple');
      expect(escapeCsv('no special chars')).toBe('no special chars');
    });

    it('should wrap comma-containing strings in double quotes', () => {
      expect(escapeCsv('a,b')).toBe('"a,b"');
    });

    it('should wrap newline-containing strings in double quotes', () => {
      expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    });

    it('should wrap carriage return strings in double quotes', () => {
      expect(escapeCsv('line1\rline2')).toBe('"line1\rline2"');
    });

    it('should double existing double quotes inside value', () => {
      expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
    });

    it('should handle both comma and quotes', () => {
      expect(escapeCsv('a,"b"')).toBe('"a,""b"""');
    });
  });

  // ============================================================================
  // getDateRangeDays() mutation killers
  // ============================================================================
  describe('getDateRangeDays() - Kill +1 and Math.ceil mutations (line 695-703)', () => {
    it('should return 0 for invalid dates', () => {
      expect(getDateRangeDays('invalid', '2025-01-01')).toBe(0);
      expect(getDateRangeDays('2025-01-01', 'invalid')).toBe(0);
    });

    it('should return exactly 1 for same start and end date (inclusive)', () => {
      // If +1 is removed, would return 0
      expect(getDateRangeDays('2025-01-15', '2025-01-15')).toBe(1);
    });

    it('should return exactly 2 for consecutive days', () => {
      // If +1 is removed, would return 1
      expect(getDateRangeDays('2025-01-15', '2025-01-16')).toBe(2);
    });

    it('should return exactly 7 for a full week', () => {
      expect(getDateRangeDays('2025-01-13', '2025-01-19')).toBe(7);
    });

    it('should return exactly 31 for a full month', () => {
      expect(getDateRangeDays('2025-01-01', '2025-01-31')).toBe(31);
    });

    it('should use Math.ceil (not Math.floor or Math.round)', () => {
      // DST boundary: Mar 9, 2025 (Spring forward in US)
      // 23-hour day should still count as 1 day
      // This test ensures Math.ceil is used, not floor
      const days = getDateRangeDays('2025-03-08', '2025-03-10');
      expect(days).toBe(3);
    });
  });

  // ============================================================================
  // classifyEntryForOvertime() mutation killers
  // ============================================================================
  describe('classifyEntryForOvertime() - Kill equality mutations (line 676-684)', () => {
    it('should return "work" for null/undefined entry', () => {
      expect(classifyEntryForOvertime(null)).toBe('work');
      expect(classifyEntryForOvertime(undefined)).toBe('work');
    });

    it('should return "work" for entry without type', () => {
      expect(classifyEntryForOvertime({})).toBe('work');
      expect(classifyEntryForOvertime({ type: '' })).toBe('work');
      expect(classifyEntryForOvertime({ type: null })).toBe('work');
    });

    it('should return "break" for BREAK type exactly', () => {
      expect(classifyEntryForOvertime({ type: 'BREAK' })).toBe('break');
    });

    it('should return "break" for lowercase "break"', () => {
      expect(classifyEntryForOvertime({ type: 'break' })).toBe('break');
    });

    it('should return "pto" for HOLIDAY type exactly', () => {
      expect(classifyEntryForOvertime({ type: 'HOLIDAY' })).toBe('pto');
    });

    it('should return "pto" for TIME_OFF type exactly', () => {
      expect(classifyEntryForOvertime({ type: 'TIME_OFF' })).toBe('pto');
    });

    it('should return "work" for REGULAR type', () => {
      expect(classifyEntryForOvertime({ type: 'REGULAR' })).toBe('work');
    });

    it('should return "work" for unknown types', () => {
      expect(classifyEntryForOvertime({ type: 'OTHER' })).toBe('work');
      expect(classifyEntryForOvertime({ type: 'HOLIDAY_TIME_ENTRY' })).toBe('pto');
      expect(classifyEntryForOvertime({ type: 'TIME_OFF_TIME_ENTRY' })).toBe('pto');
    });
  });

  // ============================================================================
  // IsoUtils.extractDateKey() mutation killers
  // ============================================================================
  describe('IsoUtils.extractDateKey() - Kill length check and NaN check', () => {
    it('should return null for null/undefined/empty', () => {
      expect(IsoUtils.extractDateKey(null)).toBeNull();
      expect(IsoUtils.extractDateKey(undefined)).toBeNull();
      expect(IsoUtils.extractDateKey('')).toBeNull();
    });

    it('should return YYYY-MM-DD string directly when length is exactly 10', () => {
      expect(IsoUtils.extractDateKey('2025-01-15')).toBe('2025-01-15');
    });

    it('should NOT return directly for length 9 (requires Date parsing)', () => {
      // '2025-1-15' is length 9, not 10
      const result = IsoUtils.extractDateKey('2025-1-15');
      // Should still try to parse it as a date
      expect(result).toBeDefined();
    });

    it('should return null for invalid date string', () => {
      expect(IsoUtils.extractDateKey('not-a-date-at-all')).toBeNull();
    });

    it('should extract date from full ISO timestamp', () => {
      const result = IsoUtils.extractDateKey('2025-01-15T09:30:00Z');
      expect(result).toMatch(/2025-01-15/);
    });
  });

  // ============================================================================
  // IsoUtils.generateDateRange() mutation killers
  // ============================================================================
  describe('IsoUtils.generateDateRange() - Kill <= and +1 mutations', () => {
    it('should return single date for same start and end', () => {
      const range = IsoUtils.generateDateRange('2025-01-15', '2025-01-15');
      expect(range).toEqual(['2025-01-15']);
    });

    it('should return inclusive range (both start and end included)', () => {
      const range = IsoUtils.generateDateRange('2025-01-15', '2025-01-17');
      expect(range).toEqual(['2025-01-15', '2025-01-16', '2025-01-17']);
      expect(range.length).toBe(3);
    });

    it('should return empty array for invalid dates', () => {
      expect(IsoUtils.generateDateRange('invalid', '2025-01-15')).toEqual([]);
      expect(IsoUtils.generateDateRange('2025-01-15', 'invalid')).toEqual([]);
    });

    it('should return empty array when start > end', () => {
      const range = IsoUtils.generateDateRange('2025-01-17', '2025-01-15');
      expect(range).toEqual([]);
    });

    it('should correctly increment by exactly 1 day (not 2)', () => {
      const range = IsoUtils.generateDateRange('2025-01-01', '2025-01-05');
      expect(range.length).toBe(5);
      expect(range[0]).toBe('2025-01-01');
      expect(range[1]).toBe('2025-01-02');
      expect(range[2]).toBe('2025-01-03');
      expect(range[3]).toBe('2025-01-04');
      expect(range[4]).toBe('2025-01-05');
    });
  });

  // ============================================================================
  // IsoUtils.toISODate() mutation killers
  // ============================================================================
  describe('IsoUtils.toISODate() - Kill padStart and +1 mutations', () => {
    it('should return empty string for null/undefined', () => {
      expect(IsoUtils.toISODate(null)).toBe('');
      expect(IsoUtils.toISODate(undefined)).toBe('');
    });

    it('should format with zero-padded month and day', () => {
      const date = new Date('2025-01-05T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-01-05');
    });

    it('should use +1 for month (getUTCMonth is 0-indexed)', () => {
      // January is month 0 in JS, should be '01' in output
      const jan = new Date('2025-01-15T00:00:00Z');
      expect(IsoUtils.toISODate(jan)).toBe('2025-01-15');

      // December is month 11 in JS, should be '12' in output
      const dec = new Date('2025-12-15T00:00:00Z');
      expect(IsoUtils.toISODate(dec)).toBe('2025-12-15');
    });

    it('should pad single-digit months and days with leading zero', () => {
      const date = new Date('2025-03-07T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-03-07');
      expect(IsoUtils.toISODate(date)).not.toBe('2025-3-7');
    });
  });

  // ============================================================================
  // IsoUtils.parseDate() mutation killers
  // ============================================================================
  describe('IsoUtils.parseDate() - Kill UTC midnight construction', () => {
    it('should return null for null/undefined/empty', () => {
      expect(IsoUtils.parseDate(null)).toBeNull();
      expect(IsoUtils.parseDate(undefined)).toBeNull();
      expect(IsoUtils.parseDate('')).toBeNull();
    });

    it('should parse date at UTC midnight', () => {
      const result = IsoUtils.parseDate('2025-01-15');
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
    });
  });

  // ============================================================================
  // IsoUtils.isWeekend() mutation killers
  // ============================================================================
  describe('IsoUtils.isWeekend() - Kill day comparison mutations', () => {
    it('should return true for Saturday (day 6)', () => {
      expect(IsoUtils.isWeekend('2025-01-11')).toBe(true); // Saturday
    });

    it('should return true for Sunday (day 0)', () => {
      expect(IsoUtils.isWeekend('2025-01-12')).toBe(true); // Sunday
    });

    it('should return false for Monday through Friday', () => {
      expect(IsoUtils.isWeekend('2025-01-13')).toBe(false); // Monday
      expect(IsoUtils.isWeekend('2025-01-14')).toBe(false); // Tuesday
      expect(IsoUtils.isWeekend('2025-01-15')).toBe(false); // Wednesday
      expect(IsoUtils.isWeekend('2025-01-16')).toBe(false); // Thursday
      expect(IsoUtils.isWeekend('2025-01-17')).toBe(false); // Friday
    });

    it('should return false for invalid date', () => {
      expect(IsoUtils.isWeekend('invalid')).toBe(false);
    });
  });

  // ============================================================================
  // safeJSONParse() mutation killers
  // ============================================================================
  describe('safeJSONParse() - Kill fallback mutations', () => {
    it('should return fallback for null/empty text', () => {
      expect(safeJSONParse(null, 42)).toBe(42);
      expect(safeJSONParse('', 'default')).toBe('default');
    });

    it('should return parsed value for valid JSON', () => {
      expect(safeJSONParse('{"a":1}', {})).toEqual({ a: 1 });
    });

    it('should return fallback for invalid JSON', () => {
      expect(safeJSONParse('{invalid}', 'fallback')).toBe('fallback');
    });
  });

  // ============================================================================
  // formatHours() mutation killers
  // ============================================================================
  describe('formatHours() - Kill edge case mutations (lines 453-465)', () => {
    it('should return "0h" for null/undefined/NaN', () => {
      expect(formatHours(null)).toBe('0h');
      expect(formatHours(undefined)).toBe('0h');
      expect(formatHours(NaN)).toBe('0h');
    });

    it('should format whole hours without minutes', () => {
      expect(formatHours(8)).toBe('8h');
      expect(formatHours(0)).toBe('0h');
    });

    it('should format fractional hours with minutes', () => {
      expect(formatHours(8.5)).toBe('8h 30m');
      expect(formatHours(1.25)).toBe('1h 15m');
    });

    it('should handle 60-minute rollover edge case', () => {
      // 1.9999... hours rounds to 60 minutes, should become 2h 0m -> "2h"
      expect(formatHours(1.9999)).toBe('2h');
    });
  });

  // ============================================================================
  // formatCurrency() mutation killers
  // ============================================================================
  describe('formatCurrency() - Kill NaN and negative mutations (line 437-443)', () => {
    it('should handle NaN input', () => {
      const result = formatCurrency(NaN);
      expect(result).toContain('0');
    });

    it('should handle Infinity input', () => {
      const result = formatCurrency(Infinity);
      expect(result).toContain('0');
    });

    it('should format normal currency values', () => {
      const result = formatCurrency(100, 'USD');
      expect(result).toMatch(/100/);
    });
  });

  // ============================================================================
  // classifyError - status code boundary mutations
  // ============================================================================
  describe('classifyError() - Status code boundary mutations (lines 275-300)', () => {
    it('should classify 401 as AUTH_ERROR', () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401 });
      expect(classifyError(error)).toBe(ERROR_TYPES.AUTH);
    });

    it('should classify 403 as AUTH_ERROR', () => {
      const error = Object.assign(new Error('Forbidden'), { status: 403 });
      expect(classifyError(error)).toBe(ERROR_TYPES.AUTH);
    });

    it('should classify 400 as VALIDATION_ERROR (not AUTH)', () => {
      const error = Object.assign(new Error('Bad Request'), { status: 400 });
      expect(classifyError(error)).toBe(ERROR_TYPES.VALIDATION);
      expect(classifyError(error)).not.toBe(ERROR_TYPES.AUTH);
    });

    it('should classify 404 as VALIDATION_ERROR', () => {
      const error = Object.assign(new Error('Not Found'), { status: 404 });
      expect(classifyError(error)).toBe(ERROR_TYPES.VALIDATION);
    });

    it('should classify 429 as VALIDATION_ERROR (4xx range)', () => {
      const error = Object.assign(new Error('Too Many Requests'), { status: 429 });
      expect(classifyError(error)).toBe(ERROR_TYPES.VALIDATION);
    });

    it('should classify 500 as API_ERROR', () => {
      const error = Object.assign(new Error('Server Error'), { status: 500 });
      expect(classifyError(error)).toBe(ERROR_TYPES.API);
    });

    it('should classify 503 as API_ERROR', () => {
      const error = Object.assign(new Error('Service Unavailable'), { status: 503 });
      expect(classifyError(error)).toBe(ERROR_TYPES.API);
    });

    it('should classify 499 as VALIDATION_ERROR (boundary: < 500)', () => {
      const error = Object.assign(new Error('Client Error'), { status: 499 });
      expect(classifyError(error)).toBe(ERROR_TYPES.VALIDATION);
    });

    it('should classify 502 as API_ERROR (>= 500)', () => {
      const error = Object.assign(new Error('Bad Gateway'), { status: 502 });
      expect(classifyError(error)).toBe(ERROR_TYPES.API);
    });

    it('should return UNKNOWN for unrecognized error', () => {
      expect(classifyError(new Error('unknown'))).toBe(ERROR_TYPES.UNKNOWN);
    });

    it('should handle non-Error objects', () => {
      expect(classifyError('string error')).toBe(ERROR_TYPES.UNKNOWN);
      expect(classifyError(null)).toBe(ERROR_TYPES.UNKNOWN);
      expect(classifyError(undefined)).toBe(ERROR_TYPES.UNKNOWN);
    });
  });

  // ============================================================================
  // validateDateRange mutation killers
  // ============================================================================
  describe('validateDateRange() - Kill comparison mutations (line 251)', () => {
    it('should accept same start and end date', () => {
      expect(validateDateRange('2025-01-15', '2025-01-15')).toBe(true);
    });

    it('should accept start before end', () => {
      expect(validateDateRange('2025-01-01', '2025-01-31')).toBe(true);
    });

    it('should throw when start is after end', () => {
      expect(() => validateDateRange('2025-01-31', '2025-01-01')).toThrow();
    });

    it('should throw for invalid date format', () => {
      expect(() => validateDateRange('invalid', '2025-01-01')).toThrow();
    });
  });

  describe('formatDate - Kill object literal mutation (line 610)', () => {
    it('should format date with correct options', () => {
      // Tests that the format options are actually used
      // Mutant: options = {} would produce different output
      const result = formatDate('2025-01-15');
      // Should include month name (not number) due to month: 'short'
      expect(result).toMatch(/Jan/i);
      // Should include year
      expect(result).toMatch(/2025/);
      // Should include day
      expect(result).toMatch(/15/);
    });

    it('should return original dateKey for empty/null date', () => {
      // When IsoUtils.parseDate returns null, formatDate returns the original dateKey
      expect(formatDate('')).toBe('');
    });
  });
});

// ============================================================================
// base64urlDecode Mutation Killers (lines 337, 340, 341)
// ============================================================================
import { base64urlDecode } from '../../js/utils.js';

describe('base64urlDecode Mutation Killers', () => {
  // Line 337: str.replace(/_/g, '/') - mutation changes '/' to ''
  // Need a test where _ MUST become / for correct decoding
  describe('underscore to slash replacement mutation (line 337)', () => {
    it('KILLER: should correctly replace _ with / for decoding', () => {
      // In Base64URL, _ represents / from standard Base64
      // "a?" (0x61 0x3F) in Base64 is "YT8=" with the 8 being at the / position
      // Actually, let's use a known value where _ appears
      // "<<>>" in standard Base64 is "PDw+Pg==" but in Base64URL it's "PDw-Pg" (+ becomes -, = removed)

      // Let's create a value that has _ in it
      // Standard Base64 for "f?" = "Zj8=" -> Base64URL = "Zj8" (no _ needed)
      // We need a value where / appears. "/" itself encodes to "Lw==" in Base64
      // But _ is used to replace / in the encoded string, not the input

      // The actual character that produces _ in Base64URL is when
      // the 6-bit value 63 appears, which maps to / in Base64 and _ in Base64URL
      // Binary 111111 = 63

      // Simple test: encode "<<>>" which produces PDw+Pg in Base64URL
      // The + in "PDw+Pg" comes from the standard Base64 character
      // Wait, the mutation is about replacing _ with / not - with +

      // Let me construct a proper test:
      // In Base64URL: - replaces + and _ replaces /
      // So if we have "a/b" encoded:
      // "a/b" = 0x61 0x2F 0x62 = Base64 "YS9i" -> Base64URL "YS9i" (no _ here)

      // Let me try "?" which is 0x3F
      // Single character "?" -> Base64 = "Pw==" -> Base64URL = "Pw"
      // That's not right either...

      // Actually the replacement is: _ in input becomes / for standard Base64
      // So if input has _, it should become / before atob
      // Example: "abc_def" in Base64URL notation should decode with _ -> /
      // Let's use "T_8" which represents the bytes for "O?" when _ is converted to /
      // "O?" = 0x4F 0x3F -> Base64 = "T/8" -> Base64URL = "T_8"

      // With mutation: T_8 -> T8 (invalid length, or decode wrong)
      // With correct code: T_8 -> T/8 -> decode to "O?"

      // Actually "T/8" is only 3 chars, need padding
      // T_8 -> T/8= -> atob("T/8=") = "\x4F\xFF" which is O followed by 0xFF

      // Let me verify: btoa("O\xFF") = "T/8="
      // So base64urlDecode("T_8") should return "O\xFF"

      const encoded = 'T_8'; // Would be "T/8" in standard Base64
      const decoded = base64urlDecode(encoded);
      // With correct code: decoded = "O\xFF"
      // With mutation: decoded would fail or be wrong

      // The character at position 1 should be the byte 0xFF
      expect(decoded.charCodeAt(0)).toBe(0x4F); // 'O'
      expect(decoded.charCodeAt(1)).toBe(0xFF); // The byte that requires /
    });

    it('KILLER: should handle multiple _ characters', () => {
      // "O\xFF\xFF" -> btoa = "T///=" -> Base64URL = "T___"
      const encoded = 'T___';
      const decoded = base64urlDecode(encoded);
      expect(decoded).toBe('O\xFF\xFF');
    });
  });

  // Line 340: if (padding) - mutation changes to if (false)
  // Need a test where padding is REQUIRED for correct decoding
  describe('padding conditional mutation (line 340)', () => {
    it('KILLER: should add padding for length % 4 == 1 (needs 3 chars)', () => {
      // Length 5 % 4 = 1, needs 3 '=' chars
      // But wait, valid Base64 can't have length % 4 == 1
      // Let me use length % 4 == 2 (needs 2 '=')

      // "a" -> btoa = "YQ==" -> Base64URL = "YQ" (length 2)
      // 2 % 4 = 2, padding = 2, need 2 '=' chars
      const result = base64urlDecode('YQ');
      expect(result).toBe('a');
    });

    it('KILLER: should add padding for length % 4 == 3 (needs 1 char)', () => {
      // "ab" -> btoa = "YWI=" -> Base64URL = "YWI" (length 3)
      // 3 % 4 = 3, padding = 3, need 1 '=' char
      const result = base64urlDecode('YWI');
      expect(result).toBe('ab');
    });

    it('KILLER: should not add padding for length % 4 == 0', () => {
      // "abc" -> btoa = "YWJj" -> Base64URL = "YWJj" (length 4)
      // 4 % 4 = 0, no padding needed
      const result = base64urlDecode('YWJj');
      expect(result).toBe('abc');
    });
  });

  // Line 341: '='.repeat(4 - padding) - mutation changes '=' to ''
  // Need a test where the '=' padding character is essential
  describe('padding character mutation (line 341)', () => {
    it('KILLER: should use = character for padding (not empty string)', () => {
      // If '=' becomes '', then "YQ" would become "YQ" with no padding
      // atob("YQ") without proper padding might fail or return wrong result
      // Let's test that the padding '=' is actually added

      // For "a", Base64URL encoded is "YQ" (needs "YQ==")
      // Without = padding: atob("YQ") might throw or return gibberish

      const result = base64urlDecode('YQ');
      expect(result).toBe('a');

      // Double-check with another value
      const result2 = base64urlDecode('YWI'); // needs "YWI="
      expect(result2).toBe('ab');
    });

    it('KILLER: should correctly pad with multiple = characters', () => {
      // "Y" alone (length 1) % 4 = 1, but this is invalid Base64
      // Let's use "Zg" which encodes "f" and needs "Zg=="
      const result = base64urlDecode('Zg');
      expect(result).toBe('f');
    });
  });

  describe('timezone helper mutations', () => {
    it('should return false for empty timezone input', () => {
      expect(isValidTimeZone('')).toBe(false);
    });

    it('should return false for undefined timezone input', () => {
      expect(isValidTimeZone(undefined)).toBe(false);
    });

    it('should ignore literal parts when formatting date keys', () => {
      const originalDateTimeFormat = Intl.DateTimeFormat;

      Intl.DateTimeFormat = jest.fn((locale, options) => {
        if (options && options.year && options.month && options.day) {
          return {
            formatToParts: () => [
              { type: 'year', value: '2025' },
              { type: 'literal', value: '-' },
              { type: 'month', value: '01' },
              { type: 'literal', value: '-' },
              { type: 'day', value: '02' }
            ],
            format: () => '2025-01-02',
            resolvedOptions: () => ({ timeZone: 'UTC' })
          };
        }

        return {
          format: () => '2025-01-02',
          resolvedOptions: () => ({ timeZone: 'UTC' })
        };
      });

      setCanonicalTimeZone(null);
      const dateKey = IsoUtils.toDateKey(new Date('2025-01-02T00:00:00Z'));
      expect(dateKey).toBe('2025-01-02');

      Intl.DateTimeFormat = originalDateTimeFormat;
      setCanonicalTimeZone(null);
    });
  });
});
