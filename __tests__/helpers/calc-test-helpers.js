/**
 * @fileoverview Shared test helpers for calc.ts mutation tests
 * Provides factory functions for creating test fixtures.
 */

/**
 * Minimal store factory for targeted tests
 * @param {object} overrides - Override properties
 * @returns {object} Mock store object
 */
export function createMinimalStore(overrides = {}) {
    const users = overrides.users || [{ id: 'user1', name: 'Test User' }];

    // Build profiles map - assign working capacity and days
    const profiles = overrides.profiles || new Map();
    if (!overrides.profiles) {
        users.forEach(u => {
            profiles.set(u.id, {
                workCapacityHours: 8,
                workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
            });
        });
    }

    return {
        users,
        profiles,
        holidays: overrides.holidays || new Map(),
        timeOff: overrides.timeOff || new Map(),
        overrides: overrides.overrides || {},
        config: {
            applyHolidays: false,
            applyTimeOff: false,
            useProfileCapacity: false,
            useProfileWorkingDays: false,
            enableTieredOT: false,
            showBillableBreakdown: true,
            amountDisplay: 'earned',
            ...overrides.config,
        },
        calcParams: {
            dailyThreshold: 8,
            overtimeMultiplier: 1.5,
            tier2ThresholdHours: 0,
            tier2Multiplier: 2.0,
            ...overrides.calcParams,
        },
    };
}

/**
 * Entry factory for targeted tests
 * @param {object} overrides - Override properties
 * @returns {object} Mock time entry
 */
export function createEntry(overrides = {}) {
    return {
        id: overrides.id || 'entry1',
        userId: overrides.userId || 'user1',
        userName: overrides.userName || 'Test User',
        billable: overrides.billable !== undefined ? overrides.billable : true,
        timeInterval: {
            start: overrides.start || '2024-01-15T09:00:00Z',
            end: overrides.end || '2024-01-15T17:00:00Z',
            duration: overrides.duration || 'PT8H',
        },
        type: overrides.type || 'REGULAR',
        ...overrides,
    };
}
