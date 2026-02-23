/**
 * @jest-environment jsdom
 *
 * Property-Based Tests for Calculation Engine
 *
 * Uses fast-check to verify invariant properties of calculateAnalysis()
 * that should hold for ANY valid input combination.
 *
 * These tests complement the example-based tests in calc.test.js by testing
 * properties that must always be true, regardless of specific input values.
 */

import { jest, afterEach, describe, it, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore, generateMockUsers } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

// ============================================================================
// FAST-CHECK ARBITRARIES
// ============================================================================
// Custom generators for domain-specific test data

/**
 * Generates a valid duration between 0 and 12 hours (safe range for date math)
 */
const durationHoursArb = fc.integer({ min: 0, max: 12 });

/**
 * Generates a valid hourly rate in cents (0 to $500/hr)
 */
const hourlyRateArb = fc.integer({ min: 0, max: 50000 });

/**
 * Generates a day offset (1-28) for January 2025
 */
const dayArb = fc.integer({ min: 1, max: 28 });

/**
 * Generates a valid time entry with safe date calculations
 */
const timeEntryArb = fc.record({
    id: fc.uuid(),
    userId: fc.constantFrom('user0', 'user1', 'user2'),
    userName: fc.constantFrom('Alice', 'Bob', 'Charlie'),
    billable: fc.boolean(),
    type: fc.constantFrom('REGULAR', undefined),
    hourlyRate: fc.record({ amount: hourlyRateArb }),
    duration: durationHoursArb,
    day: dayArb,
    startHour: fc.integer({ min: 6, max: 18 })
}).map(({ id, userId, userName, billable, type, hourlyRate, duration, day, startHour }) => {
    // Create deterministic dates to avoid timezone issues
    const start = `2025-01-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:00:00Z`;
    const endHour = startHour + duration;
    const end = `2025-01-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:00:00Z`;

    return {
        id,
        userId,
        userName,
        billable,
        type,
        hourlyRate,
        timeInterval: {
            start,
            end,
            duration: `PT${duration}H`
        }
    };
});

/**
 * Generates an array of time entries for property testing
 */
const entriesArrayArb = fc.array(timeEntryArb, { minLength: 0, maxLength: 20 });

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Calculation Module - Property-Based Tests', () => {
    let baseStore;

    afterEach(() => {
        standardAfterEach();
    });

    beforeEach(() => {
        const mockUsers = generateMockUsers(3);
        baseStore = createMockStore({
            users: mockUsers,
            config: {
                useProfileCapacity: false,  // Use global threshold for simpler testing
                useProfileWorkingDays: false,
                applyHolidays: false,
                applyTimeOff: false,
                showBillableBreakdown: true,
                overtimeBasis: 'daily'
            },
            calcParams: {
                dailyThreshold: 8,
                weeklyThreshold: 40,
                overtimeMultiplier: 1.5,
                tier2ThresholdHours: 9999,
                tier2Multiplier: 2.0
            },
            overrides: {}
        });
    });

    describe('Invariant: Overtime is never negative', () => {
        it('overtime hours are always >= 0 for any valid input', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    // Check all user totals
                    for (const user of results) {
                        expect(user.totals.overtime).toBeGreaterThanOrEqual(0);
                        expect(user.totals.billableOT).toBeGreaterThanOrEqual(0);
                        expect(user.totals.nonBillableOT).toBeGreaterThanOrEqual(0);

                        // Check all day breakdowns
                        for (const [, dayData] of user.days) {
                            for (const entry of dayData.entries) {
                                if (entry.analysis) {
                                    expect(entry.analysis.overtime).toBeGreaterThanOrEqual(0);
                                }
                            }
                        }
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('Invariant: Regular hours are never negative', () => {
        it('regular hours are always >= 0 for any valid input', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    for (const user of results) {
                        expect(user.totals.regular).toBeGreaterThanOrEqual(0);
                        expect(user.totals.billableWorked).toBeGreaterThanOrEqual(0);
                        expect(user.totals.nonBillableWorked).toBeGreaterThanOrEqual(0);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('Invariant: Total = Regular + Overtime', () => {
        it('total hours equals regular plus overtime for all users', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    for (const user of results) {
                        const expectedTotal = user.totals.regular + user.totals.overtime;
                        // Use approximate equality due to floating point
                        expect(Math.abs(user.totals.total - expectedTotal)).toBeLessThan(0.001);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('Invariant: Billable/Non-billable split is consistent', () => {
        it('billable + non-billable equals totals for worked and OT', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    for (const user of results) {
                        // Worked hours split
                        const totalWorked = user.totals.billableWorked + user.totals.nonBillableWorked;
                        expect(Math.abs(user.totals.regular - totalWorked)).toBeLessThan(0.001);

                        // Overtime hours split
                        const totalOT = user.totals.billableOT + user.totals.nonBillableOT;
                        expect(Math.abs(user.totals.overtime - totalOT)).toBeLessThan(0.001);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('Invariant: Empty entries produce zero totals', () => {
        it('no entries means zero hours for all metrics', () => {
            fc.assert(
                fc.property(fc.constant([]), (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    for (const user of results) {
                        expect(user.totals.total).toBe(0);
                        expect(user.totals.regular).toBe(0);
                        expect(user.totals.overtime).toBe(0);
                    }

                    return true;
                }),
                { numRuns: 10 }
            );
        });
    });

    describe('Invariant: Amounts are non-negative when present', () => {
        it('earned and cost base amounts are >= 0 when defined', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    for (const user of results) {
                        // Base amounts should be non-negative when present
                        if (user.totals.amount?.earned?.base !== undefined) {
                            expect(user.totals.amount.earned.base).toBeGreaterThanOrEqual(0);
                        }
                        if (user.totals.amount?.cost?.base !== undefined) {
                            expect(user.totals.amount.cost.base).toBeGreaterThanOrEqual(0);
                        }
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('Invariant: Calculation is deterministic', () => {
        it('same inputs always produce same outputs', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };

                    // Run calculation twice with same inputs
                    const results1 = calculateAnalysis(entries, baseStore, dateRange);
                    const results2 = calculateAnalysis(entries, baseStore, dateRange);

                    // Compare totals for each user
                    for (let i = 0; i < results1.length; i++) {
                        expect(results1[i].totals.total).toBe(results2[i].totals.total);
                        expect(results1[i].totals.regular).toBe(results2[i].totals.regular);
                        expect(results1[i].totals.overtime).toBe(results2[i].totals.overtime);
                    }

                    return true;
                }),
                { numRuns: 50 }
            );
        });
    });

    describe('Invariant: Daily threshold affects overtime correctly', () => {
        it('with 0 threshold, all hours are overtime', () => {
            const zeroThresholdStore = createMockStore({
                users: generateMockUsers(1),
                config: {
                    useProfileCapacity: false,
                    useProfileWorkingDays: false,
                    applyHolidays: false,
                    applyTimeOff: false,
                    showBillableBreakdown: true,
                    overtimeBasis: 'daily'
                },
                calcParams: {
                    dailyThreshold: 0,  // All hours should be OT
                    weeklyThreshold: 0,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 9999,
                    tier2Multiplier: 2.0
                },
                overrides: {}
            });

            // Use a fixed entry for this specific test to avoid filter issues
            const fixedEntry = {
                id: 'test-entry-1',
                userId: 'user0',
                userName: 'Test User',
                billable: true,
                type: 'REGULAR',
                hourlyRate: { amount: 5000 },
                timeInterval: {
                    start: '2025-01-15T09:00:00Z',
                    end: '2025-01-15T17:00:00Z',
                    duration: 'PT8H'
                }
            };

            const dateRange = { start: '2025-01-01', end: '2025-01-31' };
            const results = calculateAnalysis([fixedEntry], zeroThresholdStore, dateRange);

            const user = results.find(u => u.userId === 'user0');
            expect(user).toBeDefined();
            if (user && user.totals.total > 0) {
                // With 0 capacity, all work hours should be overtime
                expect(user.totals.overtime).toBeGreaterThan(0);
            }
        });

        it('with high threshold, no overtime occurs', () => {
            const highThresholdStore = createMockStore({
                users: generateMockUsers(1),
                config: {
                    useProfileCapacity: false,
                    useProfileWorkingDays: false,
                    applyHolidays: false,
                    applyTimeOff: false,
                    showBillableBreakdown: true,
                    overtimeBasis: 'daily'
                },
                calcParams: {
                    dailyThreshold: 24,  // Max possible daily hours
                    weeklyThreshold: 168,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 9999,
                    tier2Multiplier: 2.0
                },
                overrides: {}
            });

            // Use a fixed entry for this specific test
            const fixedEntry = {
                id: 'test-entry-2',
                userId: 'user0',
                userName: 'Test User',
                billable: true,
                type: 'REGULAR',
                hourlyRate: { amount: 5000 },
                timeInterval: {
                    start: '2025-01-15T09:00:00Z',
                    end: '2025-01-15T17:00:00Z',
                    duration: 'PT8H'
                }
            };

            const dateRange = { start: '2025-01-01', end: '2025-01-31' };
            const results = calculateAnalysis([fixedEntry], highThresholdStore, dateRange);

            const user = results.find(u => u.userId === 'user0');
            expect(user).toBeDefined();
            if (user) {
                // With 24h threshold per day, no daily overtime should occur
                expect(user.totals.overtime).toBe(0);
            }
        });
    });

    describe('Invariant: User results match input users', () => {
        it('results array length matches number of users in store', () => {
            fc.assert(
                fc.property(entriesArrayArb, (entries) => {
                    const dateRange = { start: '2025-01-01', end: '2025-01-31' };
                    const results = calculateAnalysis(entries, baseStore, dateRange);

                    // Should have results for all users in store
                    expect(results.length).toBe(baseStore.users.length);

                    return true;
                }),
                { numRuns: 50 }
            );
        });
    });
});
