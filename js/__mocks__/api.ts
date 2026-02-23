/**
 * @fileoverview Mock API module for testing
 */

import { jest } from '@jest/globals';

/**
 * Mock reset rate limiter function
 */
export const resetRateLimiter = jest.fn<() => void>();

export const Api = {
    fetchUsers: jest.fn<() => Promise<unknown[]>>(),
    fetchEntries: jest.fn<() => Promise<unknown[]>>(),
    fetchAllProfiles: jest.fn<() => Promise<Map<string, unknown>>>(),
    fetchAllHolidays: jest.fn<() => Promise<Map<string, Map<string, unknown>>>>(),
    fetchAllTimeOff: jest.fn<() => Promise<Map<string, Map<string, unknown>>>>(),
    fetchUserProfile: jest.fn<() => Promise<unknown | null>>(),
    fetchHolidays: jest.fn<() => Promise<Map<string, unknown>>>(),
    fetchTimeOffRequests: jest.fn<() => Promise<Map<string, unknown>>>()
};

/**
 * Reset all mock functions
 */
export function resetApiMocks(): void {
    resetRateLimiter.mockReset();
    Object.values(Api).forEach(fn => fn.mockReset());
}

/**
 * Set up default successful mock responses
 */
export function setupDefaultMocks(): void {
    Api.fetchUsers.mockResolvedValue([]);
    Api.fetchEntries.mockResolvedValue([]);
    Api.fetchAllProfiles.mockResolvedValue(new Map());
    Api.fetchAllHolidays.mockResolvedValue(new Map());
    Api.fetchAllTimeOff.mockResolvedValue(new Map());
    Api.fetchUserProfile.mockResolvedValue(null);
    Api.fetchHolidays.mockResolvedValue(new Map());
    Api.fetchTimeOffRequests.mockResolvedValue(new Map());
}
