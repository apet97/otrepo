/**
 * Performance Test Suite for OTPLUS Calculation Engine
 *
 * Tests the calculation engine with various dataset sizes to ensure
 * performance meets documented capacity limits.
 *
 * @see docs/CAPACITY.md for expected performance characteristics
 */

import { calculateAnalysis } from '../../js/calc.js';
import {
    generateMockEntries,
    generateMockUsers,
    createMockStore,
    generateLargeDataset,
} from '../helpers/mock-data.js';

// Performance thresholds from CAPACITY.md
// Allow looser thresholds in non-CI runs unless explicitly running perf tests
const PERF_MULTIPLIER = process.env.CI
    ? 7
    : (process.env.RUN_PERF_TESTS === 'true' ? 1 : 10);
const PERFORMANCE_THRESHOLDS = {
    entries100: 50 * PERF_MULTIPLIER, // 100 entries: < 50ms
    entries1000: 100 * PERF_MULTIPLIER, // 1,000 entries: < 100ms
    entries5000: 500 * PERF_MULTIPLIER, // 5,000 entries: < 500ms
    entries10000: 1000 * PERF_MULTIPLIER, // 10,000 entries: < 1000ms
};

describe('Calculation Engine Performance', () => {
    const dateRange = { start: '2025-01-01', end: '2025-01-31' };

    // Helper to run calculation and measure time
    const measureCalculation = (entries, store) => {
        const start = performance.now();
        const result = calculateAnalysis(entries, store, dateRange);
        const duration = performance.now() - start;
        return { result, duration };
    };

    // Helper to create store with users matching entry count
    const createStoreForEntries = (userCount) => {
        return createMockStore({ userCount });
    };

    describe('Small Dataset (100 entries)', () => {
        let entries;
        let store;

        beforeEach(() => {
            entries = generateMockEntries(100, 10);
            store = createStoreForEntries(10);
        });

        test('should complete calculation within threshold', () => {
            const { duration } = measureCalculation(entries, store);

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.entries100);
        });

        test('should produce correct number of user results', () => {
            const { result } = measureCalculation(entries, store);

            // Should have analysis for each unique user in entries
            const uniqueUsers = new Set(entries.map((e) => e.userId));
            expect(result.length).toBe(uniqueUsers.size);
        });

        test('should handle multiple iterations consistently', () => {
            const iterations = 10;
            const times = [];

            for (let i = 0; i < iterations; i++) {
                const { duration } = measureCalculation(entries, store);
                times.push(duration);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const maxTime = Math.max(...times);

            // Average should be well under threshold
            expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.entries100);

            // No single iteration should be significantly slower (variance check)
            expect(maxTime).toBeLessThan(PERFORMANCE_THRESHOLDS.entries100 * 2);
        });
    });

    describe('Medium Dataset (1,000 entries)', () => {
        let entries;
        let store;

        beforeEach(() => {
            entries = generateMockEntries(1000, 20);
            store = createStoreForEntries(20);
        });

        test('should complete calculation within threshold', () => {
            const { duration } = measureCalculation(entries, store);

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.entries1000);
        });

        test('should produce valid analysis structure', () => {
            const { result } = measureCalculation(entries, store);

            // Each user analysis should have required fields
            result.forEach((userAnalysis) => {
                expect(userAnalysis).toHaveProperty('userId');
                expect(userAnalysis).toHaveProperty('userName');
                expect(userAnalysis).toHaveProperty('days');
                expect(userAnalysis).toHaveProperty('totals');
                expect(userAnalysis.totals).toHaveProperty('regular');
                expect(userAnalysis.totals).toHaveProperty('overtime');
                expect(userAnalysis.totals).toHaveProperty('total');
            });
        });
    });

    describe('Large Dataset (5,000 entries)', () => {
        let entries;
        let store;

        beforeEach(() => {
            entries = generateMockEntries(5000, 50);
            store = createStoreForEntries(50);
        });

        test('should complete calculation within threshold', () => {
            const { duration } = measureCalculation(entries, store);

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.entries5000);
        });

        test('should maintain data integrity with large dataset', () => {
            const { result } = measureCalculation(entries, store);

            // Calculate expected total hours from entries within the date range
            let expectedTotalHours = 0;
            entries.forEach((entry) => {
                const entryDate = entry.timeInterval?.start?.substring(0, 10);
                // Only count entries that fall within the test's date range
                if (entryDate && entryDate >= dateRange.start && entryDate <= dateRange.end) {
                    if (entry.timeInterval?.duration) {
                        const match = entry.timeInterval.duration.match(/PT(\d+)H/);
                        if (match) {
                            expectedTotalHours += parseInt(match[1], 10);
                        }
                    }
                }
            });

            // Sum up actual calculated hours
            const actualTotalHours = result.reduce(
                (sum, user) => sum + (user.totals?.total || 0),
                0
            );

            // Should be reasonably close (within 1% tolerance for floating point)
            const tolerance = expectedTotalHours * 0.01;
            expect(Math.abs(actualTotalHours - expectedTotalHours)).toBeLessThan(tolerance);
        });
    });

    describe('Extra Large Dataset (10,000 entries)', () => {
        let entries;
        let store;

        beforeEach(() => {
            entries = generateMockEntries(10000, 100);
            store = createStoreForEntries(100);
        });

        test('should complete calculation within threshold', () => {
            const { duration } = measureCalculation(entries, store);

            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.entries10000);
        });

        test('should handle high user count efficiently', () => {
            const { result, duration } = measureCalculation(entries, store);

            // Should produce results for all users
            expect(result.length).toBeGreaterThan(0);

            // Log performance for monitoring
            console.log(
                `10k entries, 100 users: ${duration.toFixed(2)}ms, ` +
                    `${(10000 / duration * 1000).toFixed(0)} entries/sec`
            );
        });
    });

    describe('Memory Efficiency', () => {
        // Note: These tests are approximations since JS doesn't give direct memory access

        test('should not create excessive intermediate objects', () => {
            const entries = generateMockEntries(1000, 20);
            const store = createStoreForEntries(20);

            // Force GC if available (Node.js --expose-gc)
            if (global.gc) {
                global.gc();
            }

            const startHeap = process.memoryUsage?.()?.heapUsed || 0;
            calculateAnalysis(entries, store, dateRange);
            const endHeap = process.memoryUsage?.()?.heapUsed || 0;

            // Memory growth should be reasonable (less than 50MB for 1000 entries)
            const memoryGrowthMB = (endHeap - startHeap) / (1024 * 1024);
            expect(memoryGrowthMB).toBeLessThan(50);
        });
    });

    describe('Edge Cases Performance', () => {
        test('should handle empty entries array efficiently', () => {
            const store = createStoreForEntries(10);
            const { duration } = measureCalculation([], store);

            // Empty array should be nearly instant
            expect(duration).toBeLessThan(5);
        });

        test('should handle single entry efficiently', () => {
            const entries = generateMockEntries(1, 1);
            const store = createStoreForEntries(1);
            const { duration } = measureCalculation(entries, store);

            expect(duration).toBeLessThan(10);
        });

        test('should handle entries with missing data gracefully', () => {
            const entries = generateMockEntries(100, 10);

            // Corrupt some entries
            entries[10].timeInterval = null;
            entries[20].userId = null;
            entries[30].hourlyRate = undefined;

            const store = createStoreForEntries(10);

            // Should not throw and should complete quickly
            expect(() => measureCalculation(entries, store)).not.toThrow();

            const { duration } = measureCalculation(entries, store);
            expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.entries100);
        });
    });

    describe('Scalability Regression Tests', () => {
        test('should maintain linear scaling', () => {
            const sizes = [100, 500, 1000];
            const results = [];

            sizes.forEach((size) => {
                const entries = generateMockEntries(size, Math.min(size / 10, 50));
                const store = createStoreForEntries(Math.min(size / 10, 50));
                const { duration } = measureCalculation(entries, store);

                results.push({ size, duration, perEntry: duration / size });
            });

            // Per-entry time should not increase significantly with scale
            // Allow 3x variance as overhead exists for small datasets
            const smallPerEntry = results[0].perEntry;
            const largePerEntry = results[results.length - 1].perEntry;

            // Handle near-zero timing edge case (sub-millisecond calculations)
            // In shared CI environments, timing variance is high, so we use generous bounds
            if (smallPerEntry > 0.01) {
                expect(largePerEntry).toBeLessThan(smallPerEntry * 10);
            } else {
                // For sub-millisecond calculations, just verify large dataset completes in reasonable time
                expect(results[results.length - 1].duration).toBeLessThan(5000);
            }
        });
    });
});

describe('Calculation Engine Stress Tests', () => {
    const dateRange = { start: '2025-01-01', end: '2025-01-31' };

    // Skip stress tests in CI unless explicitly enabled
    const runStressTests =
        process.env.RUN_STRESS_TESTS === 'true' || process.env.CI !== 'true';
    const STRESS_MULTIPLIER =
        process.env.RUN_STRESS_TESTS === 'true' ? 1 : PERF_MULTIPLIER;

    (runStressTests ? describe : describe.skip)('Extended Stress Tests', () => {
        test('should handle 50,000 entries', () => {
            const entries = generateMockEntries(50000, 200);
            const store = createMockStore({ userCount: 200 });

            const start = performance.now();
            const result = calculateAnalysis(entries, store, dateRange);
            const duration = performance.now() - start;

            // Should complete within 5 seconds (relaxed outside strict perf runs)
            expect(duration).toBeLessThan(5000 * STRESS_MULTIPLIER);
            expect(result.length).toBeGreaterThan(0);

            console.log(
                `Stress test: 50k entries in ${duration.toFixed(2)}ms ` +
                    `(${(50000 / duration * 1000).toFixed(0)} entries/sec)`
            );
        });

        test('should handle long date ranges (90 days)', () => {
            const entries = generateMockEntries(5000, 50);
            const store = createMockStore({ userCount: 50 });
            const longDateRange = { start: '2025-01-01', end: '2025-03-31' };

            const start = performance.now();
            const result = calculateAnalysis(entries, store, longDateRange);
            const duration = performance.now() - start;

            // Should complete within 2 seconds for 90-day range (relaxed outside strict perf runs)
            expect(duration).toBeLessThan(2000 * STRESS_MULTIPLIER);
            expect(result.length).toBeGreaterThan(0);
        });
    });
});
