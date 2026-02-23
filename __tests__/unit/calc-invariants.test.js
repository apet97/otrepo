/**
 * @jest-environment jsdom
 *
 * Property-Based Testing for Calculation Invariants
 *
 * These tests use fast-check to verify calculation invariants hold
 * across a wide range of randomly generated inputs.
 *
 * @see docs/prd.md - Calculation rules and rounding requirements
 */

import { jest, beforeEach, afterEach } from '@jest/globals';
import * as fc from 'fast-check';
import { calculateAnalysis } from '../../js/calc.js';
import { round } from '../../js/utils.js';
import {
  TestFixtures,
  MOCK_USER_IDS,
  TEST_DATES,
  expectWithinRoundingTolerance
} from '../helpers/fixtures.js';
import { standardAfterEach, standardBeforeEach } from '../helpers/setup.js';

// Number of runs for property tests (1000 as specified in plan)
const NUM_RUNS = 1000;

describe('Calculation Invariants - Property-Based Tests', () => {
  beforeEach(() => {
    standardBeforeEach();
  });

  afterEach(() => {
    standardAfterEach();
  });
  describe('Rounding Stability', () => {
    it('round(total) === round(regular) + round(OT) within tolerance', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(24), noNaN: true }),
          fc.float({ min: Math.fround(0.001), max: Math.fround(16), noNaN: true }),
          (regular, overtime) => {
            const total = regular + overtime;
            const roundedTotal = round(total, 4);
            const roundedSum = round(round(regular, 4) + round(overtime, 4), 4);

            // Rounding should be stable within tolerance
            return Math.abs(roundedTotal - roundedSum) < 0.0002;
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('rounding is idempotent: round(round(x)) === round(x)', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 10000, noNaN: true }),
          (value) => {
            const once = round(value, 4);
            const twice = round(once, 4);
            return once === twice;
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });

    it('rounding preserves non-negativity', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
          (value) => {
            return round(value, 4) >= 0;
          }
        ),
        { numRuns: NUM_RUNS }
      );
    });
  });

  describe('Billable Breakdown Invariants', () => {
    it('billableWorked + nonBillableWorked === total worked', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.1), max: Math.fround(16), noNaN: true }),
          fc.boolean(),
          (duration, isBillable) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${9 + Math.floor(duration)}:00:00Z`,
                duration: `PT${Math.floor(duration)}H`
              },
              hourlyRate: { amount: 5000 },
              billable: isBillable
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

            if (!userResult) return true;

            const billableTotal = userResult.totals.billableWorked + userResult.totals.billableOT;
            const nonBillableTotal = userResult.totals.nonBillableWorked + userResult.totals.nonBillableOT;
            const total = userResult.totals.total;

            // Billable + Non-billable should equal total
            return Math.abs((billableTotal + nonBillableTotal) - total) < 0.001;
          }
        ),
        { numRuns: 100 } // Reduced runs due to calculation overhead
      );
    });

    it('OT is non-negative: overtime >= 0 for any input', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 24 }),
          (durationHours) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${9 + durationHours}:00:00Z`,
                duration: `PT${durationHours}H`
              },
              hourlyRate: { amount: 5000 },
              billable: true
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

            return userResult.totals.overtime >= 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Capacity Precedence Invariants', () => {
    it('override capacity always takes precedence over profile', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 12 }),
          (profileCapacity, overrideCapacity) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }],
              overrides: {
                [MOCK_USER_IDS.primary]: { capacity: overrideCapacity }
              }
            });
            mockStore.profiles.set(MOCK_USER_IDS.primary, {
              workCapacityHours: profileCapacity,
              workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T21:00:00Z`,
                duration: 'PT12H'
              },
              hourlyRate: { amount: 5000 },
              billable: true
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);
            const dayData = userResult.days.get(TEST_DATES.wednesday);

            // Override should always be used
            return dayData.meta.capacity === overrideCapacity;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('regular hours never exceed effective capacity', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 24 }),
          fc.integer({ min: 1, max: 12 }),
          (durationHours, capacity) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }],
              calcParams: { dailyThreshold: capacity, weeklyThreshold: 40, overtimeMultiplier: 1.5 }
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${Math.min(9 + durationHours, 24)}:00:00Z`,
                duration: `PT${durationHours}H`
              },
              hourlyRate: { amount: 5000 },
              billable: true
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);
            const dayData = userResult.days.get(TEST_DATES.wednesday);

            // Regular hours should not exceed the effective capacity for the day
            const dayRegular = dayData?.entries?.reduce((sum, e) => sum + (e.analysis?.regular || 0), 0) || 0;
            return dayRegular <= dayData.meta.capacity + 0.001;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('OT Attribution Determinism', () => {
    it('same inputs produce same outputs (determinism)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 16 }),
          fc.integer({ min: 1, max: 12 }),
          (durationHours, capacity) => {
            const createStore = () => TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }],
              calcParams: { dailyThreshold: capacity, weeklyThreshold: 40, overtimeMultiplier: 1.5 }
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${9 + durationHours}:00:00Z`,
                duration: `PT${durationHours}H`
              },
              hourlyRate: { amount: 5000 },
              billable: true
            }];

            const dateRange = { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday };

            // Run calculation twice
            const results1 = calculateAnalysis(entries, createStore(), dateRange);
            const results2 = calculateAnalysis(entries, createStore(), dateRange);

            const user1 = results1.find(u => u.userId === MOCK_USER_IDS.primary);
            const user2 = results2.find(u => u.userId === MOCK_USER_IDS.primary);

            // Results should be identical
            return (
              user1.totals.regular === user2.totals.regular &&
              user1.totals.overtime === user2.totals.overtime &&
              user1.totals.total === user2.totals.total
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('total = regular + overtime (conservation)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 24 }),
          (durationHours) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${9 + durationHours}:00:00Z`,
                duration: `PT${durationHours}H`
              },
              hourlyRate: { amount: 5000 },
              billable: true
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

            // Total should equal regular + overtime
            const sum = userResult.totals.regular + userResult.totals.overtime;
            return Math.abs(userResult.totals.total - sum) < 0.001;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Cost Calculation Invariants', () => {
    it('cost is non-negative for positive rates and hours', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 100, max: 50000 }),
          (durationHours, rateCents) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${9 + durationHours}:00:00Z`,
                duration: `PT${durationHours}H`
              },
              hourlyRate: { amount: rateCents },
              billable: true
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

            return userResult.totals.amount >= 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('OT premium is proportional to overtime hours', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 9, max: 16 }),  // Ensure some OT
          fc.float({ min: Math.fround(1.0), max: Math.fround(3.0), noNaN: true }),
          (durationHours, multiplier) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }],
              calcParams: { dailyThreshold: 8, weeklyThreshold: 40, overtimeMultiplier: multiplier }
            });

            const entries = [{
              id: 'entry_1',
              userId: MOCK_USER_IDS.primary,
              userName: 'Test',
              timeInterval: {
                start: `${TEST_DATES.wednesday}T09:00:00Z`,
                end: `${TEST_DATES.wednesday}T${9 + durationHours}:00:00Z`,
                duration: `PT${durationHours}H`
              },
              hourlyRate: { amount: 5000 },  // $50/hour
              billable: true
            }];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

            // Premium should be (multiplier - 1) * OT hours * rate
            const expectedPremium = (multiplier - 1) * userResult.totals.overtime * 50;
            return Math.abs(userResult.totals.otPremium - expectedPremium) < 0.01;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Entry Type Handling Invariants', () => {
    it('BREAK entries never become overtime', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 8 }),
          (breakHours) => {
            const mockStore = TestFixtures.createStoreFixture({
              users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
            });

            // 8h work + break - break should never be OT
            const entries = [
              {
                id: 'entry_1',
                userId: MOCK_USER_IDS.primary,
                userName: 'Test',
                type: 'REGULAR',
                timeInterval: {
                  start: `${TEST_DATES.wednesday}T08:00:00Z`,
                  end: `${TEST_DATES.wednesday}T16:00:00Z`,
                  duration: 'PT8H'
                },
                hourlyRate: { amount: 5000 },
                billable: true
              },
              {
                id: 'entry_2',
                userId: MOCK_USER_IDS.primary,
                userName: 'Test',
                type: 'BREAK',
                timeInterval: {
                  start: `${TEST_DATES.wednesday}T12:00:00Z`,
                  end: `${TEST_DATES.wednesday}T${12 + breakHours}:00:00Z`,
                  duration: `PT${breakHours}H`
                },
                hourlyRate: { amount: 5000 },
                billable: false
              }
            ];

            const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
            const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);
            const dayData = userResult.days.get(TEST_DATES.wednesday);

            // Find the break entry
            const breakEntry = dayData.entries.find(e => e.type === 'BREAK');

            // Break should have 0 overtime
            return breakEntry.analysis.overtime === 0;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Boundary Conditions', () => {
    it('handles zero-duration entries gracefully', () => {
      const mockStore = TestFixtures.createStoreFixture({
        users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
      });

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T09:00:00Z`,
          duration: 'PT0H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
      const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

      expect(userResult.totals.total).toBe(0);
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(0);
    });

    it('handles entries with missing hourly rate', () => {
      const mockStore = TestFixtures.createStoreFixture({
        users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
      });

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        // No hourlyRate
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
      const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

      // Should handle gracefully
      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.amount).toBe(0);
    });

    it('handles zero capacity gracefully', () => {
      const mockStore = TestFixtures.createStoreFixture({
        users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }],
        calcParams: { dailyThreshold: 0, weeklyThreshold: 0, overtimeMultiplier: 1.5 }
      });

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, { start: TEST_DATES.wednesday, end: TEST_DATES.wednesday });
      const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);

      // All hours should be OT when capacity is 0
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
    });
  });
});
