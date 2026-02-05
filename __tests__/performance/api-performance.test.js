/**
 * Performance Test Suite for API Module
 *
 * Tests rate limiting, circuit breaker, and request handling performance.
 */

import {
    resetRateLimiter,
    resetCircuitBreaker,
    getCircuitBreakerState,
} from '../../js/api.js';

// Mock fetch for performance testing
const originalFetch = global.fetch;

describe('API Module Performance', () => {
    beforeEach(() => {
        resetRateLimiter();
        resetCircuitBreaker();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe('Rate Limiter Performance', () => {
        test('should handle rapid rate limiter resets efficiently', () => {
            const iterations = 1000;
            const start = performance.now();

            for (let i = 0; i < iterations; i++) {
                resetRateLimiter();
            }

            const duration = performance.now() - start;

            const maxDuration = process.env.CI ? 50 : 15;
            // 1000 resets should complete quickly (relaxed for CI variance)
            expect(duration).toBeLessThan(maxDuration);
        });
    });

    describe('Circuit Breaker Performance', () => {
        test('should check circuit breaker state efficiently', () => {
            const iterations = 10000;
            const start = performance.now();

            for (let i = 0; i < iterations; i++) {
                getCircuitBreakerState();
            }

            const duration = performance.now() - start;

            // 10000 state checks should complete in under 15ms (relaxed for CI)
            expect(duration).toBeLessThan(15);
        });

        test('should handle rapid circuit breaker resets', () => {
            const iterations = 1000;
            const start = performance.now();

            for (let i = 0; i < iterations; i++) {
                resetCircuitBreaker();
            }

            const duration = performance.now() - start;

            const maxDuration = process.env.CI ? 50 : 15;
            // 1000 resets should complete quickly (relaxed for CI variance)
            expect(duration).toBeLessThan(maxDuration);
        });

        test('should return correct state structure', () => {
            const state = getCircuitBreakerState();

            expect(state).toHaveProperty('state');
            expect(state).toHaveProperty('failureCount');
            expect(state).toHaveProperty('isOpen');
            expect(state).toHaveProperty('nextRetryTime');

            expect(state.state).toBe('CLOSED');
            expect(state.failureCount).toBe(0);
            expect(state.isOpen).toBe(false);
        });
    });

    describe('Token Bucket Algorithm', () => {
        test('should initialize with full bucket', () => {
            resetRateLimiter();
            // After reset, the bucket should be full
            // This is a structural test - we can't directly access tokens
            // but we can verify reset doesn't throw
            expect(() => resetRateLimiter()).not.toThrow();
        });
    });
});

describe('API Response Processing Performance', () => {
    // These tests verify that response transformation doesn't add significant overhead

    describe('Entry Transformation', () => {
        test('should transform entries efficiently', () => {
            // Simulate transforming 1000 API response entries
            const mockEntries = Array.from({ length: 1000 }, (_, i) => ({
                _id: `entry_${i}`,
                description: `Test entry ${i}`,
                userId: `user_${i % 10}`,
                userName: `User ${i % 10}`,
                billable: i % 2 === 0,
                timeInterval: {
                    start: '2025-01-01T09:00:00Z',
                    end: '2025-01-01T17:00:00Z',
                    duration: 28800,
                },
                hourlyRate: { amount: 5000, currency: 'USD' },
                amounts: [{ type: 'EARNED', value: 40000 }],
            }));

            const start = performance.now();

            // Simulate the transformation that happens in fetchDetailedReport
            const transformed = mockEntries.map((e) => ({
                id: e._id || e.id || '',
                description: e.description,
                userId: e.userId || '',
                userName: e.userName || '',
                billable: e.billable === true,
                timeInterval: {
                    start: e.timeInterval?.start || '',
                    end: e.timeInterval?.end || '',
                    duration:
                        e.timeInterval?.duration != null
                            ? `PT${e.timeInterval.duration}S`
                            : null,
                },
                hourlyRate: { amount: e.hourlyRate?.amount || 0, currency: 'USD' },
                amounts: e.amounts || [],
            }));

            const duration = performance.now() - start;

            // 1000 transformations should complete in under 20ms
            expect(duration).toBeLessThan(20);
            expect(transformed.length).toBe(1000);
        });
    });

    describe('Large Response Handling', () => {
        test('should handle 10000 entry responses efficiently', () => {
            const mockEntries = Array.from({ length: 10000 }, (_, i) => ({
                _id: `entry_${i}`,
                userId: `user_${i % 100}`,
                billable: true,
                timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z' },
            }));

            const start = performance.now();

            // Simulate array operations that happen during pagination
            const byUser = mockEntries.reduce((acc, entry) => {
                const userId = entry.userId;
                if (!acc[userId]) acc[userId] = [];
                acc[userId].push(entry);
                return acc;
            }, {});

            const duration = performance.now() - start;

            // Grouping 10000 entries should complete in under 50ms
            expect(duration).toBeLessThan(50);
            expect(Object.keys(byUser).length).toBe(100);
        });
    });
});

describe('Cache Performance', () => {
    describe('Map Operations', () => {
        test('should handle large profile cache efficiently', () => {
            const profiles = new Map();
            const userCount = 1000;

            // Populate cache
            const populateStart = performance.now();
            for (let i = 0; i < userCount; i++) {
                profiles.set(`user_${i}`, {
                    workCapacity: 'PT8H',
                    workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
                });
            }
            const populateDuration = performance.now() - populateStart;

            // Lookup operations
            const lookupStart = performance.now();
            for (let i = 0; i < userCount * 10; i++) {
                profiles.get(`user_${i % userCount}`);
            }
            const lookupDuration = performance.now() - lookupStart;

            // Population should be fast
            expect(populateDuration).toBeLessThan(20);

            // 10000 lookups should be very fast
            expect(lookupDuration).toBeLessThan(10);
        });

        test('should handle nested Map (holidays) efficiently', () => {
            const holidays = new Map();
            const userCount = 100;
            const daysPerUser = 30;

            // Populate nested structure
            const populateStart = performance.now();
            for (let u = 0; u < userCount; u++) {
                const userHolidays = new Map();
                for (let d = 0; d < daysPerUser; d++) {
                    userHolidays.set(`2025-01-${String(d + 1).padStart(2, '0')}`, {
                        name: `Holiday ${d}`,
                        isFullDay: true,
                    });
                }
                holidays.set(`user_${u}`, userHolidays);
            }
            const populateDuration = performance.now() - populateStart;

            // Nested lookups
            const lookupStart = performance.now();
            for (let i = 0; i < 10000; i++) {
                const userMap = holidays.get(`user_${i % userCount}`);
                if (userMap) {
                    userMap.get(`2025-01-${String((i % daysPerUser) + 1).padStart(2, '0')}`);
                }
            }
            const lookupDuration = performance.now() - lookupStart;

            // Population of 100 users x 30 days should be fast
            expect(populateDuration).toBeLessThan(50);

            // 10000 nested lookups should be fast
            expect(lookupDuration).toBeLessThan(20);
        });
    });
});
