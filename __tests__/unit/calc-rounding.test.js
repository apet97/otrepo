/**
 * @jest-environment jsdom
 */

/**
 * Rounding at Aggregation Boundary Specification Tests
 *
 * This file documents the rounding strategy per docs/prd.md:
 * - Hours: 4 decimal places (0.0001h = 0.36s precision)
 * - Currency: 2 decimal places
 * - Rounding is applied at AGGREGATION BOUNDARY (after summing), not per-entry
 *
 * SPECIFICATION:
 * - round() is applied AFTER summing individual values, not before
 * - This prevents cumulative floating-point drift across large summations
 * - The invariant round(total) ≈ round(regular) + round(overtime) should hold
 *
 * RATIONALE:
 * - Per-entry rounding can cause drift: 0.001 * 1000 entries = 1.0 hour error
 * - Aggregation-boundary rounding preserves precision during calculation
 * - Final display values are rounded for human readability
 *
 * @see docs/prd.md - Rounding rules
 * @see js/calc.ts - round() usage pattern
 * @see js/utils.ts - round() implementation
 */

import { jest, afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { round } from '../../js/utils.js';
import { createMockStore, generateMockUsers } from '../helpers/mock-data.js';
import { EntryBuilder } from '../helpers/entry-builder.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Rounding at Aggregation Boundary Specification', () => {
  let mockStore;
  let mockUsers;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
    mockUsers = null;
  });

  beforeEach(() => {
    mockUsers = generateMockUsers(1);
    mockStore = createMockStore({
      users: mockUsers,
      config: {
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5
      },
      overrides: {}
    });
  });

  describe('round() Function Specification', () => {
    it('should round to 4 decimal places for hours by default', () => {
      expect(round(1.23456789, 4)).toBe(1.2346);
      expect(round(0.00005, 4)).toBe(0.0001);
      expect(round(0.00004, 4)).toBe(0);
    });

    it('should round to 2 decimal places for currency', () => {
      expect(round(123.456, 2)).toBe(123.46);
      expect(round(123.454, 2)).toBe(123.45);
      expect(round(99.995, 2)).toBe(100);
    });

    it('should handle negative values correctly', () => {
      expect(round(-1.2345, 4)).toBe(-1.2345);
      expect(round(-1.23456, 4)).toBe(-1.2346);
    });

    it('should handle zero correctly', () => {
      expect(round(0, 4)).toBe(0);
      expect(round(0.0, 2)).toBe(0);
    });

    it('should handle very small values', () => {
      expect(round(0.00001, 4)).toBe(0);
      expect(round(0.00005, 4)).toBe(0.0001);
    });

    it('should handle very large values', () => {
      expect(round(999999.12345, 4)).toBe(999999.1235);
      expect(round(1000000.99, 2)).toBe(1000000.99);
    });
  });

  describe('Aggregation-Boundary Rounding', () => {
    it('should apply rounding AFTER summing, not per-entry', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // Create entries with awkward durations that would cause drift if rounded per-entry
      const entries = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          id: `entry_${i}`,
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: `2025-01-15T0${i}:00:00Z`,
            end: `2025-01-15T0${i}:36:00Z`,
            duration: 'PT0H36M' // 0.6 hours each
          },
          hourlyRate: { amount: 5000 },
          billable: true
        });
      }

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 10 * 0.6h = 6h exactly
      expect(userResult.totals.total).toBe(6);
      expect(userResult.totals.regular).toBe(6);
      expect(userResult.totals.overtime).toBe(0);
    });

    it('should maintain 4 decimal precision for hours', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // Duration that results in 4+ decimal places
      // 2h 7m 30s = 2.125 hours exactly
      const entry = {
        id: 'precise',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T11:07:30Z',
          duration: 'PT2H7M30S'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should preserve precision
      expect(userResult.totals.total).toBe(2.125);
    });

    it('should maintain 2 decimal precision for currency', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // Rate that results in awkward currency values
      // 3h at $33.33/hr = $99.99
      const entry = {
        id: 'currency',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T12:00:00Z',
          duration: 'PT3H'
        },
        hourlyRate: { amount: 3333 }, // $33.33/hr in cents
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Amount should be rounded to 2 decimal places
      // 3h * $33.33 = $99.99
      expect(userResult.totals.amount).toBeCloseTo(99.99, 2);
    });
  });

  describe('Cumulative Drift Prevention', () => {
    it('should prevent cumulative drift with 100+ entries', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // 100 entries of 0.01h each = 1h total
      const entries = [];
      for (let i = 0; i < 100; i++) {
        entries.push({
          id: `micro_${i}`,
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T09:00:36Z', // 36 seconds = 0.01h
            duration: 'PT36S'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        });
      }

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should be exactly 1h (100 * 0.01), not drift due to rounding errors
      expect(userResult.totals.total).toBeCloseTo(1, 2);
    });

    it('should handle entries with repeating decimal durations', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // 3 entries of 1/3 hour each = 1h total
      const entries = [];
      for (let i = 0; i < 3; i++) {
        entries.push({
          id: `third_${i}`,
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T09:20:00Z', // 20 minutes = 1/3 hour
            duration: 'PT20M'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        });
      }

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 3 * 20min = 60min = 1h
      expect(userResult.totals.total).toBe(1);
    });
  });

  describe('Regular + Overtime Sum Invariant', () => {
    it('should verify round(total) ≈ round(regular) + round(overtime)', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // Entry with split overtime
      const entry = {
        id: 'split',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:30:00Z', // 10.5h
          duration: 'PT10H30M'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      const total = userResult.totals.total;
      const regular = userResult.totals.regular;
      const overtime = userResult.totals.overtime;

      // The invariant: total = regular + overtime (within rounding tolerance)
      expect(total).toBeCloseTo(regular + overtime, 4);

      // Also verify explicit values
      expect(total).toBe(10.5);
      expect(regular).toBe(8);
      expect(overtime).toBe(2.5);
    });

    it('should maintain invariant across multiple entries', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // Multiple entries totaling 11.25h
      const entries = [
        {
          id: 'entry1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T08:00:00Z',
            end: '2025-01-15T14:15:00Z',
            duration: 'PT6H15M' // 6.25h
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry2',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T15:00:00Z',
            end: '2025-01-15T20:00:00Z',
            duration: 'PT5H' // 5h
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 6.25 + 5 = 11.25h total
      expect(userResult.totals.total).toBe(11.25);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(3.25);
      expect(userResult.totals.total).toBe(userResult.totals.regular + userResult.totals.overtime);
    });
  });

  describe('Billable Split Rounding', () => {
    it('should maintain billable + nonBillable = total invariant', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      const entries = [
        {
          id: 'billable',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T14:20:00Z',
            duration: 'PT5H20M' // 5.333... hours
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'nonbillable',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T15:00:00Z',
            end: '2025-01-15T17:40:00Z',
            duration: 'PT2H40M' // 2.666... hours
          },
          hourlyRate: { amount: 5000 },
          billable: false
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      const billableTotal = userResult.totals.billableWorked + userResult.totals.billableOT;
      const nonBillableTotal = userResult.totals.nonBillableWorked + userResult.totals.nonBillableOT;

      // billable + nonBillable should equal total
      expect(billableTotal + nonBillableTotal).toBeCloseTo(userResult.totals.total, 4);
    });
  });

  describe('Amount Calculation Rounding', () => {
    it('should round amounts to 2 decimal places', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // Rate that produces many decimal places
      const entry = {
        id: 'awkward_rate',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T12:00:00Z',
          duration: 'PT3H'
        },
        hourlyRate: { amount: 3333 }, // $33.33/hr
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Amount should be a number with at most 2 decimal places
      const amountStr = userResult.totals.amount.toString();
      const decimalPlaces = (amountStr.split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    it('should handle OT premium rounding correctly', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      // 10h at $33.33/hr with 1.5x OT
      // Regular: 8h * $33.33 = $266.64
      // OT: 2h * $33.33 * 1.5 = $99.99
      // Total: $366.63
      const entry = {
        id: 'ot_test',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 3333 },
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // OT premium should be rounded properly
      // Premium = (multiplier - 1) * OT hours * rate = 0.5 * 2 * 33.33 = $33.33
      expect(userResult.totals.otPremium).toBeCloseTo(33.33, 2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero duration entries', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      const entry = {
        id: 'zero',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T09:00:00Z',
          duration: 'PT0H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.total).toBe(0);
      expect(userResult.totals.amount).toBe(0);
    });

    it('should handle very small durations (seconds)', () => {
      const dateRange = { start: '2025-01-15', end: '2025-01-15' };

      const entry = {
        id: 'tiny',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T09:00:01Z', // 1 second
          duration: 'PT1S'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      };

      const results = calculateAnalysis([entry], mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 1 second = 0.000277... hours, rounds to 0.0003
      expect(userResult.totals.total).toBeLessThan(0.001);
      expect(userResult.totals.total).toBeGreaterThanOrEqual(0);
    });
  });
});
