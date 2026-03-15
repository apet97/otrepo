/**
 * @jest-environment jsdom
 *
 * Property-Based Testing for Utils Invariants
 *
 * These tests use fast-check to verify utility function invariants hold
 * across a wide range of randomly generated inputs. They serve as an
 * executable specification for the utils module.
 *
 * @see js/utils.ts - Utility functions implementation
 * @see docs/spec.md - Security requirements and rounding rules
 */

import { jest, beforeEach, afterEach, describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  round,
  escapeHtml,
  escapeCsv,
  parseIsoDuration,
  formatHours,
  formatHoursDecimal,
  formatCurrency,
  IsoUtils,
  getISOWeek,
  formatWeekKey,
  classifyEntryForOvertime,
  safeJSONParse,
  getDateRangeDays,
  validateNumber,
  validateString,
  validateDateRange
} from '../../js/utils.js';
import { standardAfterEach, standardBeforeEach } from '../helpers/setup.js';

// Number of runs for property tests
const NUM_RUNS = 1000;

describe('Utils Invariants - Property-Based Tests', () => {
  beforeEach(() => {
    standardBeforeEach();
  });

  afterEach(() => {
    standardAfterEach();
  });

  describe('round() Invariants', () => {
    it('round(round(x)) === round(x) (idempotent)', () => {
      fc.assert(
        fc.property(
          fc.float({ min: -1000000, max: 1000000, noNaN: true }),
          (x) => {
            const once = round(x, 4);
            const twice = round(once, 4);
            return once === twice;
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('round(0) === 0', () => {
      expect(round(0)).toBe(0);
      expect(round(0, 2)).toBe(0);
      expect(round(0, 10)).toBe(0);
    });

    it('round(NaN) === 0 (safe fallback)', () => {
      expect(round(NaN)).toBe(0);
    });

    it('round(Infinity) === 0 (safe fallback)', () => {
      expect(round(Infinity)).toBe(0);
      expect(round(-Infinity)).toBe(0);
    });

    it('preserves precision up to specified decimals', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: -100000, max: 100000 }),
          (decimals, wholePart) => {
            // Create a number with exact decimal representation
            const value = wholePart / 100;
            const rounded = round(value, decimals);
            // Rounding should not introduce precision errors beyond decimals
            const factor = Math.pow(10, decimals);
            const reconstructed = Math.round(rounded * factor) / factor;
            return Math.abs(rounded - reconstructed) < Number.EPSILON;
          }
        ),
        { numRuns: 500, seed: 424242 }
      );
    });

    it('round(x, 0) produces integers', () => {
      fc.assert(
        fc.property(
          fc.float({ min: -10000, max: 10000, noNaN: true }),
          (x) => {
            if (!Number.isFinite(x)) return true;
            const rounded = round(x, 0);
            return Number.isInteger(rounded);
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });
  });

  describe('escapeHtml() Security Invariants', () => {
    it('output never contains raw < or > characters', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 1000 }),
          (s) => {
            const result = escapeHtml(s);
            // After escaping, should not contain raw angle brackets
            return !result.includes('<') && !result.includes('>');
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('output never contains raw & except in entities', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 500 }),
          (s) => {
            const result = escapeHtml(s);
            // All & should be followed by valid entity patterns
            // Match bare & not followed by entity pattern
            const bareAmpersand = /&(?!(amp;|lt;|gt;|quot;|#039;))/;
            return !bareAmpersand.test(result);
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('escapeHtml(null) === ""', () => {
      expect(escapeHtml(null)).toBe('');
    });

    it('escapeHtml(undefined) === ""', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    it('escapeHtml("") === ""', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('escapes all dangerous HTML characters', () => {
      const dangerous = '<script>alert("xss")</script>';
      const escaped = escapeHtml(dangerous);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
    });

    it('handles embedded quotes correctly', () => {
      const input = 'onclick="alert(1)"';
      const escaped = escapeHtml(input);
      expect(escaped).toContain('&quot;');
      expect(escaped).not.toMatch(/[^&]"/); // No raw quotes
    });
  });

  describe('escapeCsv() Security Invariants', () => {
    it('values with commas are quoted', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 200 }),
          (s) => {
            if (!s.includes(',')) return true;
            const result = escapeCsv(s);
            return result.startsWith('"') && result.endsWith('"');
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('values with newlines are quoted', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 200 }),
          (s) => {
            if (!s.includes('\n') && !s.includes('\r')) return true;
            const result = escapeCsv(s);
            return result.startsWith('"') && result.endsWith('"');
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('internal quotes are doubled when quoted', () => {
      const input = 'value with "quotes" inside';
      const result = escapeCsv(input);
      expect(result).toBe('"value with ""quotes"" inside"');
    });

    it('escapeCsv(null) === ""', () => {
      expect(escapeCsv(null)).toBe('');
    });

    it('escapeCsv(undefined) === ""', () => {
      expect(escapeCsv(undefined)).toBe('');
    });

    it('plain values are returned as-is', () => {
      fc.assert(
        fc.property(
          // Filter out CSV special chars AND formula injection chars (=,+,-,@,tab,CR) and quote prefix (')
          fc.string({ maxLength: 100 }).filter(s => !/[",\n\r]/.test(s) && !/^['=+\-@\t\r]/.test(s)),
          (s) => {
            return escapeCsv(s) === s;
          }
        ),
        { numRuns: 500, seed: 424242 }
      );
    });
  });

  describe('parseIsoDuration() Invariants', () => {
    it('PT{H}H returns exactly H hours', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (hours) => {
            return parseIsoDuration(`PT${hours}H`) === hours;
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('PT{M}M returns M/60 hours', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          (minutes) => {
            const result = parseIsoDuration(`PT${minutes}M`);
            const expected = minutes / 60;
            return Math.abs(result - expected) < 0.0001;
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('PT{S}S returns S/3600 hours', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          (seconds) => {
            const result = parseIsoDuration(`PT${seconds}S`);
            const expected = seconds / 3600;
            return Math.abs(result - expected) < 0.0001;
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('handles combined H, M, S', () => {
      expect(parseIsoDuration('PT1H30M')).toBeCloseTo(1.5, 4);
      expect(parseIsoDuration('PT2H15M30S')).toBeCloseTo(2.2583, 3);
    });

    it('handles fractional values', () => {
      expect(parseIsoDuration('PT8.5H')).toBeCloseTo(8.5, 4);
      expect(parseIsoDuration('PT30.5M')).toBeCloseTo(0.5083, 3);
    });

    it('parseIsoDuration(null) === 0', () => {
      expect(parseIsoDuration(null)).toBe(0);
    });

    it('parseIsoDuration(undefined) === 0', () => {
      expect(parseIsoDuration(undefined)).toBe(0);
    });

    it('parseIsoDuration("") === 0', () => {
      expect(parseIsoDuration('')).toBe(0);
    });

    it('parseIsoDuration("invalid") === 0', () => {
      expect(parseIsoDuration('invalid')).toBe(0);
      expect(parseIsoDuration('8H')).toBe(0); // Missing PT prefix
    });
  });

  describe('formatHours() Invariants', () => {
    it('output contains "h" suffix', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 100, noNaN: true }),
          (hours) => {
            if (!Number.isFinite(hours)) return true;
            const result = formatHours(hours);
            return result.includes('h');
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('formatHours(0) === "0h"', () => {
      expect(formatHours(0)).toBe('0h');
    });

    it('formatHours(null) === "0h"', () => {
      expect(formatHours(null)).toBe('0h');
    });

    it('formatHours(NaN) === "0h"', () => {
      expect(formatHours(NaN)).toBe('0h');
    });

    it('whole hours have no minutes suffix', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (hours) => {
            const result = formatHours(hours);
            // Should be "{hours}h" without "m"
            return !result.includes('m');
          }
        ),
        { numRuns: 500, seed: 424242 }
      );
    });

    it('handles edge case: 59.99 rounds to 60m which becomes next hour', () => {
      // 0.9999 hours = 59.99 minutes, rounds to 60, should become 1h 0m
      const result = formatHours(0.9999);
      // Should handle gracefully
      expect(result).toMatch(/^1h$|^0h 59m$|^0h 60m$/); // Depends on rounding
    });
  });

  describe('formatHoursDecimal() Invariants', () => {
    it('output has exactly specified decimal places', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1000, noNaN: true }),
          fc.integer({ min: 0, max: 4 }),
          (hours, decimals) => {
            if (!Number.isFinite(hours)) return true;
            const result = formatHoursDecimal(hours, decimals);
            const parts = result.split('.');
            if (decimals === 0) return parts.length === 1;
            return parts.length === 2 && parts[1].length === decimals;
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('formatHoursDecimal(null) === "0.00"', () => {
      expect(formatHoursDecimal(null)).toBe('0.00');
    });

    it('formatHoursDecimal(NaN) === "0.00"', () => {
      expect(formatHoursDecimal(NaN)).toBe('0.00');
    });
  });

  describe('IsoUtils Invariants', () => {
    describe('toISODate', () => {
      it('output matches YYYY-MM-DD pattern', () => {
        fc.assert(
          fc.property(
            fc.date({ min: new Date('2000-01-01'), max: new Date('2100-12-31'), noInvalidDate: true }),
            (date) => {
              if (!date || isNaN(date.getTime())) return true; // Skip invalid dates
              const result = IsoUtils.toISODate(date);
              return /^\d{4}-\d{2}-\d{2}$/.test(result);
            }
          ),
          { numRuns: NUM_RUNS, seed: 424242 }
        );
      });

      it('toISODate(null) === ""', () => {
        expect(IsoUtils.toISODate(null)).toBe('');
      });

      it('toISODate(undefined) === ""', () => {
        expect(IsoUtils.toISODate(undefined)).toBe('');
      });
    });

    describe('parseDate', () => {
      it('parseDate returns valid Date for YYYY-MM-DD input', () => {
        fc.assert(
          fc.property(
            fc.integer({ min: 2000, max: 2100 }),
            fc.integer({ min: 1, max: 12 }),
            fc.integer({ min: 1, max: 28 }), // Avoid month overflow
            (year, month, day) => {
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const result = IsoUtils.parseDate(dateStr);
              return result !== null && !isNaN(result.getTime());
            }
          ),
          { numRuns: NUM_RUNS, seed: 424242 }
        );
      });

      it('parseDate(null) === null', () => {
        expect(IsoUtils.parseDate(null)).toBeNull();
      });

      it('parseDate("") === null', () => {
        expect(IsoUtils.parseDate('')).toBeNull();
      });
    });

    describe('extractDateKey', () => {
      it('returns YYYY-MM-DD from ISO timestamp', () => {
        fc.assert(
          fc.property(
            fc.date({ min: new Date('2000-01-01'), max: new Date('2100-12-31'), noInvalidDate: true }),
            (date) => {
              if (!date || isNaN(date.getTime())) return true; // Skip invalid dates
              const iso = date.toISOString();
              const result = IsoUtils.extractDateKey(iso);
              return result !== null && /^\d{4}-\d{2}-\d{2}$/.test(result);
            }
          ),
          { numRuns: NUM_RUNS, seed: 424242 }
        );
      });

      it('returns input if already YYYY-MM-DD', () => {
        expect(IsoUtils.extractDateKey('2025-01-15')).toBe('2025-01-15');
      });

      it('extractDateKey(null) === null', () => {
        expect(IsoUtils.extractDateKey(null)).toBeNull();
      });
    });

    describe('generateDateRange', () => {
      it('generates correct number of days', () => {
        const dates = IsoUtils.generateDateRange('2025-01-01', '2025-01-10');
        expect(dates).toHaveLength(10);
      });

      it('single day range returns single date', () => {
        const dates = IsoUtils.generateDateRange('2025-01-15', '2025-01-15');
        expect(dates).toHaveLength(1);
        expect(dates[0]).toBe('2025-01-15');
      });

      it('returns empty array for invalid dates', () => {
        expect(IsoUtils.generateDateRange('invalid', '2025-01-01')).toEqual([]);
        expect(IsoUtils.generateDateRange('2025-01-01', 'invalid')).toEqual([]);
      });
    });

    describe('getWeekdayKey', () => {
      it('returns valid weekday name', () => {
        const validDays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        expect(validDays).toContain(IsoUtils.getWeekdayKey('2025-01-15'));
      });

      it('2025-01-15 is WEDNESDAY', () => {
        expect(IsoUtils.getWeekdayKey('2025-01-15')).toBe('WEDNESDAY');
      });
    });

    describe('isWeekend', () => {
      it('Saturday is weekend', () => {
        expect(IsoUtils.isWeekend('2025-01-18')).toBe(true); // Saturday
      });

      it('Sunday is weekend', () => {
        expect(IsoUtils.isWeekend('2025-01-19')).toBe(true); // Sunday
      });

      it('Wednesday is not weekend', () => {
        expect(IsoUtils.isWeekend('2025-01-15')).toBe(false); // Wednesday
      });
    });
  });

  describe('getISOWeek() Invariants', () => {
    it('returns value between 1 and 53', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2000-01-01'), max: new Date('2100-12-31'), noInvalidDate: true }),
          (date) => {
            if (!date || isNaN(date.getTime())) return true; // Skip invalid dates
            const week = getISOWeek(date);
            return week >= 1 && week <= 53;
          }
        ),
        { numRuns: NUM_RUNS, seed: 424242 }
      );
    });

    it('Jan 1, 2025 is week 1', () => {
      expect(getISOWeek(new Date('2025-01-01T00:00:00Z'))).toBe(1);
    });
  });

  describe('formatWeekKey() Invariants', () => {
    it('formats YYYY-W## correctly', () => {
      expect(formatWeekKey('2025-W01')).toBe('Week 1, 2025');
      expect(formatWeekKey('2025-W52')).toBe('Week 52, 2025');
    });

    it('returns input for invalid format', () => {
      expect(formatWeekKey('invalid')).toBe('invalid');
      expect(formatWeekKey('2025-1')).toBe('2025-1');
    });
  });

  describe('classifyEntryForOvertime() Invariants', () => {
    it('returns "work" for null/undefined entry', () => {
      expect(classifyEntryForOvertime(null)).toBe('work');
      expect(classifyEntryForOvertime(undefined)).toBe('work');
    });

    it('returns "work" for entry without type', () => {
      expect(classifyEntryForOvertime({})).toBe('work');
      expect(classifyEntryForOvertime({ type: '' })).toBe('work');
    });

    it('returns "break" for BREAK type', () => {
      expect(classifyEntryForOvertime({ type: 'BREAK' })).toBe('break');
    });

    it('returns "pto" for HOLIDAY type', () => {
      expect(classifyEntryForOvertime({ type: 'HOLIDAY' })).toBe('pto');
    });

    it('returns "pto" for TIME_OFF type', () => {
      expect(classifyEntryForOvertime({ type: 'TIME_OFF' })).toBe('pto');
    });

    it('returns "work" for REGULAR type', () => {
      expect(classifyEntryForOvertime({ type: 'REGULAR' })).toBe('work');
    });

    it('returns "work" for unknown types', () => {
      expect(classifyEntryForOvertime({ type: 'UNKNOWN' })).toBe('work');
      expect(classifyEntryForOvertime({ type: 'meeting' })).toBe('work');
    });
  });

  describe('safeJSONParse() Invariants', () => {
    it('parses valid JSON correctly', () => {
      fc.assert(
        fc.property(
          fc.json(),
          (jsonValue) => {
            const str = JSON.stringify(jsonValue);
            const parsed = safeJSONParse(str, null);
            return JSON.stringify(parsed) === str;
          }
        ),
        { numRuns: 500, seed: 424242 }
      );
    });

    it('returns fallback for null input', () => {
      const fallback = { default: true };
      expect(safeJSONParse(null, fallback)).toBe(fallback);
    });

    it('returns fallback for invalid JSON', () => {
      const fallback = { default: true };
      expect(safeJSONParse('not json', fallback)).toBe(fallback);
      expect(safeJSONParse('{invalid}', fallback)).toBe(fallback);
    });
  });

  describe('getDateRangeDays() Invariants', () => {
    it('same date returns 1', () => {
      expect(getDateRangeDays('2025-01-15', '2025-01-15')).toBe(1);
    });

    it('returns correct count for multi-day range', () => {
      expect(getDateRangeDays('2025-01-01', '2025-01-10')).toBe(10);
    });

    it('returns 0 for invalid dates', () => {
      expect(getDateRangeDays('invalid', '2025-01-01')).toBe(0);
      expect(getDateRangeDays('2025-01-01', 'invalid')).toBe(0);
    });
  });

  describe('Validation Functions', () => {
    describe('validateNumber', () => {
      it('returns number for valid numeric input', () => {
        fc.assert(
          fc.property(
            fc.integer({ min: -1000000, max: 1000000 }),
            (n) => {
              return validateNumber(n, 'test') === n;
            }
          ),
          { numRuns: 500, seed: 424242 }
        );
      });

      it('throws for null', () => {
        expect(() => validateNumber(null, 'test')).toThrow();
      });

      it('throws for undefined', () => {
        expect(() => validateNumber(undefined, 'test')).toThrow();
      });

      it('throws for NaN string', () => {
        expect(() => validateNumber('not a number', 'test')).toThrow();
      });
    });

    describe('validateString', () => {
      it('returns trimmed string for valid input', () => {
        expect(validateString('  hello  ', 'test')).toBe('hello');
      });

      it('throws for null', () => {
        expect(() => validateString(null, 'test')).toThrow();
      });

      it('throws for empty string', () => {
        expect(() => validateString('', 'test')).toThrow();
      });

      it('throws for whitespace-only string', () => {
        expect(() => validateString('   ', 'test')).toThrow();
      });
    });

    describe('validateDateRange', () => {
      it('accepts valid date range', () => {
        expect(validateDateRange('2025-01-01', '2025-01-31')).toBe(true);
      });

      it('accepts same start and end', () => {
        expect(validateDateRange('2025-01-15', '2025-01-15')).toBe(true);
      });

      it('throws for start after end', () => {
        expect(() => validateDateRange('2025-01-31', '2025-01-01')).toThrow();
      });

      it('throws for invalid date format', () => {
        expect(() => validateDateRange('invalid', '2025-01-01')).toThrow();
      });
    });
  });
});
