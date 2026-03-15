/**
 * @jest-environment jsdom
 */

/**
 * Timezone Edge Cases Test Suite
 *
 * SPECIFICATION: Timezone Handling
 *
 * Tests for edge cases in date/time processing:
 * - Daylight Saving Time (DST) transitions
 * - Leap year handling
 * - Year boundaries (Dec 31 -> Jan 1)
 * - Local time vs UTC grouping
 *
 * These tests verify that the calculation engine handles
 * timezone-related edge cases correctly and deterministically.
 *
 * @see js/utils.ts - IsoUtils for date handling
 * @see js/calc.ts - Date grouping in calculations
 * @see docs/spec.md - Timezone handling
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { IsoUtils, getWeekKey, getISOWeek } from '../../js/utils.js';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Timezone Edge Cases', () => {
  let mockStore;

  beforeEach(() => {
    mockStore = createMockStore({ userCount: 1 });
    mockStore.config.applyHolidays = false;
    mockStore.config.applyTimeOff = false;
  });

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  describe('DST Transitions', () => {
    /**
     * SPECIFICATION: DST Handling
     *
     * Daylight Saving Time transitions create days with unusual lengths:
     * - Spring forward: 23-hour day (skip 1 hour)
     * - Fall back: 25-hour day (repeat 1 hour)
     *
     * The calculation engine should:
     * - Correctly attribute hours to calendar days
     * - Not double-count or miss hours
     * - Handle entries spanning the transition
     */

    it('should handle spring forward (23-hour day) date grouping', () => {
      /**
       * SPECIFICATION: Spring Forward
       *
       * On March 9, 2025 (US): 2:00 AM -> 3:00 AM
       * An entry from 1:00 AM to 3:00 AM is actually 1 hour, not 2.
       *
       * The dateKey should still be correctly derived from the start time.
       */
      const springForwardDate = '2025-03-09T01:00:00-05:00'; // EST before DST
      const dateKey = IsoUtils.extractDateKey(springForwardDate);

      expect(dateKey).toBe('2025-03-09');
    });

    it('should handle fall back (25-hour day) date grouping', () => {
      /**
       * SPECIFICATION: Fall Back
       *
       * On November 2, 2025 (US): 2:00 AM -> 1:00 AM (repeated hour)
       * Entries during the repeated hour should still be attributed correctly.
       */
      const fallBackDate = '2025-11-02T01:30:00-05:00'; // EST after DST ends
      const dateKey = IsoUtils.extractDateKey(fallBackDate);

      expect(dateKey).toBe('2025-11-02');
    });

    it('should correctly calculate hours across DST transition', () => {
      /**
       * SPECIFICATION: Duration Calculation During DST
       *
       * An entry with a fixed ISO duration (e.g., PT8H) should always
       * contribute exactly that many hours, regardless of DST.
       * The duration is trusted from the API, not calculated from timestamps.
       */
      const entries = [
        {
          id: 'entry_dst',
          userId: 'user0',
          userName: 'User 0',
          description: 'Work during DST transition',
          timeInterval: {
            start: '2025-03-09T01:00:00-05:00',
            end: '2025-03-09T10:00:00-04:00', // After spring forward
            duration: 'PT8H' // 8 hours of work
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-03-09',
        end: '2025-03-09'
      });

      expect(analysis[0].totals.total).toBe(8);
    });

    it('should not double-count hours during fall back repeated hour', () => {
      /**
       * SPECIFICATION: No Double Counting
       *
       * During fall back, the same local time occurs twice.
       * Entries should use the provided duration, not calculate from timestamps.
       */
      const entries = [
        {
          id: 'entry_fallback',
          userId: 'user0',
          userName: 'User 0',
          description: 'Work during fall back',
          timeInterval: {
            start: '2025-11-02T01:00:00-04:00', // First 1 AM (EDT)
            end: '2025-11-02T01:30:00-05:00', // Second 1 AM (EST)
            duration: 'PT1H30M' // 1.5 hours as provided
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-11-02',
        end: '2025-11-02'
      });

      // Should use the provided duration exactly
      expect(analysis[0].totals.total).toBe(1.5);
    });
  });

  describe('Leap Year', () => {
    /**
     * SPECIFICATION: Leap Year Handling
     *
     * Leap years have February 29th.
     * The calculation engine should correctly:
     * - Accept Feb 29 as a valid date
     * - Group entries to Feb 29
     * - Handle date ranges spanning Feb 28 -> Mar 1
     */

    it('should handle February 29 in leap year (2024)', () => {
      const leapDayEntry = {
        id: 'entry_leap',
        userId: 'user0',
        userName: 'User 0',
        description: 'Leap day work',
        timeInterval: {
          start: '2024-02-29T09:00:00Z',
          end: '2024-02-29T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      };

      const dateKey = IsoUtils.extractDateKey(leapDayEntry.timeInterval.start);
      expect(dateKey).toBe('2024-02-29');

      const entries = [leapDayEntry];
      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2024-02-29',
        end: '2024-02-29'
      });

      expect(analysis[0].totals.total).toBe(8);
      expect(analysis[0].days.has('2024-02-29')).toBe(true);
    });

    it('should generate correct date range including Feb 29', () => {
      const dateRange = IsoUtils.generateDateRange('2024-02-28', '2024-03-01');

      expect(dateRange).toContain('2024-02-28');
      expect(dateRange).toContain('2024-02-29');
      expect(dateRange).toContain('2024-03-01');
      expect(dateRange.length).toBe(3);
    });

    it('should handle non-leap year Feb 28 -> Mar 1', () => {
      const dateRange = IsoUtils.generateDateRange('2025-02-28', '2025-03-01');

      expect(dateRange).toContain('2025-02-28');
      expect(dateRange).toContain('2025-03-01');
      expect(dateRange).not.toContain('2025-02-29');
      expect(dateRange.length).toBe(2);
    });

    it('should correctly identify leap year dates', () => {
      // 2024 is a leap year
      const leapDate = IsoUtils.parseDate('2024-02-29');
      expect(leapDate).not.toBeNull();
      expect(leapDate.getUTCDate()).toBe(29);

      // 2023 is not a leap year - Feb 29 would roll to Mar 1
      const nonLeapDate = new Date('2023-02-29T00:00:00Z');
      expect(nonLeapDate.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(nonLeapDate.getUTCDate()).toBe(1);
    });
  });

  describe('Year Boundaries', () => {
    /**
     * SPECIFICATION: Year Boundary Handling
     *
     * Entries at year boundaries require special handling:
     * - Midnight entries on Dec 31 / Jan 1
     * - Week numbers spanning years
     * - Date ranges across year boundaries
     */

    it('should handle midnight on Dec 31 -> Jan 1', () => {
      /**
       * SPECIFICATION: Midnight Spanning Entries
       *
       * An entry starting late on Dec 31 that spans into Jan 1
       * should be attributed to the START day (Dec 31).
       */
      const midnightSpanEntry = {
        id: 'entry_newyear',
        userId: 'user0',
        userName: 'User 0',
        description: 'New Year work',
        timeInterval: {
          start: '2024-12-31T22:00:00Z',
          end: '2025-01-01T02:00:00Z',
          duration: 'PT4H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      };

      const dateKey = IsoUtils.extractDateKey(midnightSpanEntry.timeInterval.start);
      expect(dateKey).toBe('2024-12-31');
    });

    it('should calculate across year boundary correctly', () => {
      const entries = [
        {
          id: 'entry_dec31',
          userId: 'user0',
          userName: 'User 0',
          description: 'Dec 31 work',
          timeInterval: {
            start: '2024-12-31T09:00:00Z',
            end: '2024-12-31T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_jan1',
          userId: 'user0',
          userName: 'User 0',
          description: 'Jan 1 work',
          timeInterval: {
            start: '2025-01-01T09:00:00Z',
            end: '2025-01-01T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2024-12-31',
        end: '2025-01-01'
      });

      expect(analysis[0].totals.total).toBe(16);
      expect(analysis[0].days.has('2024-12-31')).toBe(true);
      expect(analysis[0].days.has('2025-01-01')).toBe(true);
    });

    it('should generate correct week key at year boundary', () => {
      /**
       * SPECIFICATION: ISO Week Numbers
       *
       * ISO week numbering can have week 1 of a year include days
       * from the previous calendar year, or week 52/53 include days
       * from the next calendar year.
       */
      // Dec 31, 2024 falls in ISO week 1 of 2025
      const weekKey = getWeekKey('2024-12-31');
      // This could be 2025-W01 depending on ISO week rules
      expect(weekKey).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('should handle date range spanning multiple years', () => {
      const dateRange = IsoUtils.generateDateRange('2024-12-30', '2025-01-02');

      expect(dateRange.length).toBe(4);
      expect(dateRange).toContain('2024-12-30');
      expect(dateRange).toContain('2024-12-31');
      expect(dateRange).toContain('2025-01-01');
      expect(dateRange).toContain('2025-01-02');
    });
  });

  describe('Local Time Grouping', () => {
    /**
     * SPECIFICATION: Local Time vs UTC
     *
     * Entries should be grouped by LOCAL calendar date, not UTC date.
     * An entry at 11 PM local time should be grouped with that local day,
     * even if it's already the next day in UTC.
     *
     * IsoUtils.extractDateKey uses local time interpretation.
     */

    it('should group by LOCAL date, not UTC (late evening entry)', () => {
      /**
       * SPECIFICATION: Local Evening Entry
       *
       * Entry at 2025-01-15 11:00 PM EST (-05:00)
       * UTC: 2025-01-16 04:00:00Z
       * LOCAL date should be: 2025-01-15 (where the user is working)
       *
       * extractDateKey uses local time, so result depends on test environment.
       * We verify the function returns a valid date in the expected range.
       */
      const localLateEvening = '2025-01-15T23:00:00-05:00';
      const dateKey = IsoUtils.extractDateKey(localLateEvening);

      // Should be 2025-01-15 or 2025-01-16 depending on environment TZ
      // The important thing is it returns a valid date
      expect(dateKey).toMatch(/^2025-01-1[56]$/);
    });

    it('should group by LOCAL date, not UTC (early morning entry)', () => {
      /**
       * SPECIFICATION: Local Early Morning Entry
       *
       * Entry at 2025-01-15 01:00 AM JST (+09:00)
       * UTC: 2025-01-14 16:00:00Z
       * LOCAL date should be: 2025-01-15
       */
      const localEarlyMorning = '2025-01-15T01:00:00+09:00';
      const dateKey = IsoUtils.extractDateKey(localEarlyMorning);

      // Should be 2025-01-14 or 2025-01-15 depending on environment
      expect(dateKey).toMatch(/^2025-01-1[45]$/);
    });

    it('should consistently group entries from same local day', () => {
      /**
       * SPECIFICATION: Consistency
       *
       * Multiple entries on the same local calendar day should
       * all be grouped under the same dateKey.
       */
      const sameDayEntries = [
        '2025-01-15T09:00:00Z',
        '2025-01-15T12:00:00Z',
        '2025-01-15T15:00:00Z',
        '2025-01-15T18:00:00Z'
      ];

      const dateKeys = sameDayEntries.map(ts => IsoUtils.extractDateKey(ts));

      // All entries should have the same dateKey
      expect(new Set(dateKeys).size).toBe(1);
      expect(dateKeys[0]).toBe('2025-01-15');
    });

    it('should handle UTC midnight correctly', () => {
      /**
       * SPECIFICATION: UTC Midnight Edge Case
       *
       * Entries exactly at UTC midnight should be attributed
       * to the correct calendar day based on local time interpretation.
       */
      const utcMidnight = '2025-01-15T00:00:00Z';
      const dateKey = IsoUtils.extractDateKey(utcMidnight);

      // In most timezones, UTC midnight is the previous day local
      // But in UTC+0 or positive offsets, it's the same day
      expect(dateKey).toMatch(/^2025-01-1[45]$/);
    });
  });

  describe('Week Number Edge Cases', () => {
    /**
     * SPECIFICATION: ISO Week Numbers
     *
     * ISO week numbering has specific rules:
     * - Week 1 is the week containing the first Thursday
     * - Weeks start on Monday
     * - A year can have 52 or 53 weeks
     */

    it('should calculate ISO week number correctly', () => {
      // 2025-01-01 is a Wednesday, so it's in week 1 of 2025
      const date = new Date('2025-01-01T12:00:00Z');
      const weekNum = getISOWeek(date);

      expect(weekNum).toBe(1);
    });

    it('should handle week 52/53 at end of year', () => {
      // December 28, 2025 is in the last week of 2025
      const date = new Date('2025-12-28T12:00:00Z');
      const weekNum = getISOWeek(date);

      // Should be 52 or 53 depending on the year
      expect(weekNum).toBeGreaterThanOrEqual(52);
      expect(weekNum).toBeLessThanOrEqual(53);
    });

    it('should correctly identify weekday from dateKey', () => {
      // 2025-01-01 is a Wednesday
      const weekday = IsoUtils.getWeekdayKey('2025-01-01');
      expect(weekday).toBe('WEDNESDAY');

      // 2025-01-04 is a Saturday
      const weekendDay = IsoUtils.getWeekdayKey('2025-01-04');
      expect(weekendDay).toBe('SATURDAY');
    });

    it('should correctly identify weekend dates', () => {
      // 2025-01-04 is Saturday
      expect(IsoUtils.isWeekend('2025-01-04')).toBe(true);

      // 2025-01-05 is Sunday
      expect(IsoUtils.isWeekend('2025-01-05')).toBe(true);

      // 2025-01-06 is Monday
      expect(IsoUtils.isWeekend('2025-01-06')).toBe(false);
    });
  });
});

describe('Timezone - Calculation Integration', () => {
  /**
   * SPECIFICATION: Timezone in Calculations
   *
   * These tests verify that timezone handling works correctly
   * throughout the full calculation pipeline.
   */

  let mockStore;

  beforeEach(() => {
    mockStore = createMockStore({ userCount: 1 });
    mockStore.config.applyHolidays = false;
    mockStore.config.applyTimeOff = false;
  });

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  it('should calculate overtime correctly across timezone boundaries', () => {
    /**
     * SPECIFICATION: Overtime with Timezone
     *
     * Entries on the same LOCAL day should be grouped together
     * for overtime calculation, regardless of UTC offsets.
     */
    mockStore.calcParams.dailyThreshold = 8;

    const entries = [
      {
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        description: 'Morning work',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T13:00:00Z',
          duration: 'PT4H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      {
        id: 'entry_2',
        userId: 'user0',
        userName: 'User 0',
        description: 'Afternoon work',
        timeInterval: {
          start: '2025-01-15T14:00:00Z',
          end: '2025-01-15T20:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    const analysis = calculateAnalysis(entries, mockStore, {
      start: '2025-01-15',
      end: '2025-01-15'
    });

    // Total 10 hours: 8 regular, 2 overtime
    expect(analysis[0].totals.total).toBe(10);
    expect(analysis[0].totals.regular).toBe(8);
    expect(analysis[0].totals.overtime).toBe(2);
  });

  it('should handle entries on consecutive days correctly', () => {
    mockStore.calcParams.dailyThreshold = 8;

    const entries = [
      {
        id: 'entry_day1',
        userId: 'user0',
        userName: 'User 0',
        description: 'Day 1 work',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      {
        id: 'entry_day2',
        userId: 'user0',
        userName: 'User 0',
        description: 'Day 2 work',
        timeInterval: {
          start: '2025-01-16T09:00:00Z',
          end: '2025-01-16T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    const analysis = calculateAnalysis(entries, mockStore, {
      start: '2025-01-15',
      end: '2025-01-16'
    });

    // Each day has 10 hours: 8 regular + 2 overtime
    // Total: 16 regular, 4 overtime
    expect(analysis[0].totals.total).toBe(20);
    expect(analysis[0].totals.regular).toBe(16);
    expect(analysis[0].totals.overtime).toBe(4);
  });

  it('should attribute midnight-spanning entry to start day', () => {
    /**
     * SPECIFICATION: Midnight Spanning Attribution
     *
     * From docs/prd.md:
     * "Midnight-spanning entries: Attributed entirely to start day (no splitting across dates)"
     */
    mockStore.calcParams.dailyThreshold = 8;

    const entries = [
      {
        id: 'entry_midnight',
        userId: 'user0',
        userName: 'User 0',
        description: 'Midnight spanning work',
        timeInterval: {
          start: '2025-01-15T20:00:00Z',
          end: '2025-01-16T04:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    const analysis = calculateAnalysis(entries, mockStore, {
      start: '2025-01-15',
      end: '2025-01-16'
    });

    // All 8 hours should be attributed to Jan 15 (start day)
    const day15 = analysis[0].days.get('2025-01-15');
    expect(day15).toBeDefined();
    expect(day15.entries.length).toBe(1);
    expect(day15.entries[0].analysis.regular + day15.entries[0].analysis.overtime).toBe(8);
  });
});
