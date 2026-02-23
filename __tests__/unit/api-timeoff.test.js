/**
 * @jest-environment node
 *
 * API Time-Off Tests - fetchTimeOffRequests, fetchAllTimeOff
 *
 * These tests focus on time-off API operations including:
 * - Fetching time-off requests via POST endpoint
 * - Processing multi-day time-off periods
 * - Status filtering (APPROVED only)
 * - Date range expansion
 * - Error tracking
 *
 * @see js/api.ts - Time-off API operations
 * @see docs/prd.md - Time-Off Detection section
 */

import { jest } from '@jest/globals';
import { webcrypto } from 'crypto';
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store } from '../../js/state.js';
import { generateMockUsers, createMockTokenPayload, createMockJwtToken } from '../helpers/mock-data.js';

// Set up Web Crypto API for Node environment (required for body signing in POST requests)
global.crypto = webcrypto;

// Mock fetch globally
global.fetch = jest.fn();

/**
 * Creates a mock response object with all required methods for API tests.
 * The API's response size check requires text() method when Content-Length is missing.
 */
function mockResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: {
      get: (name) => name === 'Content-Length' ? String(JSON.stringify(data).length) : null
    }
  };
}

describe('API Time-Off', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('fetchTimeOffRequests', () => {
    it('should fetch time off requests via POST', async () => {
      const responseData = {
        requests: [
          {
            userId: 'user_1',
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            status: 'APPROVED'
          }
        ]
      };

      fetch.mockResolvedValueOnce(mockResponse(responseData));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1', 'user_2'],
        '2025-01-01',
        '2025-01-31'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://api.clockify.me/v1/workspaces/workspace_123/time-off/requests',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"users":["user_1","user_2"]')
        })
      );
      expect(result.data).toEqual(responseData);
    });

    it('should return failed=true on error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.failed).toBe(true);
    });

    it('should include APPROVED status filter in request body', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );
      await jest.runAllTimersAsync();
      await promise;

      const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
      expect(requestBody.statuses).toEqual(['APPROVED']);
    });
  });

  describe('fetchAllTimeOff', () => {
    it('should fetch and process time off for all users', async () => {
      const users = generateMockUsers(2);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS',
            status: { statusType: 'APPROVED' }
          }
        ]
      }));

      const promise = Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );
      await jest.runAllTimersAsync();
      const results = await promise;

      expect(results).toBeInstanceOf(Map);
      expect(results.has('user0')).toBe(true);
      expect(store.apiStatus.timeOffFailed).toBe(0);
    });

    it('should handle approved requests without a timeOffPeriod', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            status: { statusType: 'APPROVED' }
            // timeOffPeriod missing
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      expect(userMap).toBeDefined();
      expect(userMap.size).toBe(0);
    });

    it('should handle time off fetch failure', async () => {
      const users = generateMockUsers(2);

      fetch.mockRejectedValueOnce(new Error('Network error'));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 }
      );

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(0);
      expect(store.apiStatus.timeOffFailed).toBe(2);
    });

    it('should filter requests by APPROVED status (string)', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            status: 'APPROVED'
          },
          {
            userId: 'user0',
            timeOffPeriod: { startDate: '2025-01-20T00:00:00Z' },
            status: 'PENDING'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      expect(userMap.size).toBe(1);
    });

    it('should filter requests by APPROVED status (object)', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            status: { statusType: 'APPROVED' }
          },
          {
            userId: 'user0',
            timeOffPeriod: { startDate: '2025-01-20T00:00:00Z' },
            status: { statusType: 'PENDING' }
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      expect(userMap.size).toBe(1);
    });

    it('should handle data as non-object in time-off response', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });

    it('should handle timeOffRequests response format', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        timeOffRequests: [
          {
            userId: 'user0',
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            status: { statusType: 'APPROVED' }
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.has('user0')).toBe(true);
    });

    it('should handle array response format', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse([
        {
          userId: 'user0',
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          status: { statusType: 'APPROVED' }
        }
      ]));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.has('user0')).toBe(true);
    });

    it('should use half-day hours when provided', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              halfDay: true,
              halfDayHours: 4
            },
            timeUnit: 'HOURS',
            status: { statusType: 'APPROVED' }
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      const day = userMap.get('2025-01-15');
      expect(day.isFullDay).toBe(false);
      expect(day.hours).toBe(4);
    });

    it('should derive partial-day hours from period start/end when halfDayHours is missing', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: {
              period: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T13:00:00Z'
              },
              halfDay: true
            },
            timeUnit: 'HOURS',
            status: { statusType: 'APPROVED' }
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      const day = userMap.get('2025-01-15');
      expect(day.isFullDay).toBe(false);
      expect(day.hours).toBe(4);
    });

    it('should treat HOURS-based requests as partial even without halfDayHours', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: {
              period: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T12:00:00Z'
              },
              halfDay: false
            },
            timeUnit: 'HOURS',
            status: { statusType: 'APPROVED' }
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      const day = userMap.get('2025-01-15');
      expect(day.isFullDay).toBe(false);
      expect(day.hours).toBe(3);
    });

    it('should expand multi-day time off into per-date records', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user0',
            timeOffPeriod: {
              startDate: '2025-01-20T00:00:00Z',
              endDate: '2025-01-22T23:59:59Z',
              halfDay: false
            },
            timeUnit: 'DAYS',
            status: { statusType: 'APPROVED' }
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user0');
      expect(userMap.has('2025-01-20')).toBe(true);
      expect(userMap.has('2025-01-21')).toBe(true);
      expect(userMap.has('2025-01-22')).toBe(true);
    });
  });
});

describe('API Time-Off - ISO Format Mutations', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('Template Literal Date Construction', () => {
    it('should construct startIso with T00:00:00.000Z suffix (not empty string)', async () => {
      let capturedBody = null;
      fetch.mockImplementation((url, options) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve(mockResponse({ requests: [] }));
      });

      await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-15',
        '2025-01-20'
      );

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.start).toBe('2025-01-15T00:00:00.000Z');
      expect(capturedBody.start).not.toBe('');
      expect(capturedBody.start).not.toBe('2025-01-15');
      expect(capturedBody.start.endsWith('T00:00:00.000Z')).toBe(true);
    });

    it('should construct endIso with T23:59:59.999Z suffix (not empty string)', async () => {
      let capturedBody = null;
      fetch.mockImplementation((url, options) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve(mockResponse({ requests: [] }));
      });

      await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-15',
        '2025-01-20'
      );

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.end).toBe('2025-01-20T23:59:59.999Z');
      expect(capturedBody.end).not.toBe('');
      expect(capturedBody.end).not.toBe('2025-01-20');
      expect(capturedBody.end.endsWith('T23:59:59.999Z')).toBe(true);
    });

    it('should preserve date portion in ISO format construction', async () => {
      let capturedBody = null;
      fetch.mockImplementation((url, options) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve(mockResponse({ requests: [] }));
      });

      await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-03-01',
        '2025-03-31'
      );

      expect(capturedBody.start).toMatch(/^2025-03-01T/);
      expect(capturedBody.end).toMatch(/^2025-03-31T/);
    });
  });
});

describe('API Time-Off - timeUnit Mutations', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('timeUnit DAYS exact match', () => {
    it('should treat timeUnit === "DAYS" as full day (kills empty string mutation)', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'  // Exact match required
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(true);
    });

    it('should treat timeUnit === "HOURS" as NOT full day', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'HOURS'  // Not DAYS
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
    });

    it('should treat empty timeUnit string as NOT full day when halfDayHours present', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDayHours: 4
          },
          timeUnit: ''  // Empty string - if mutation changes 'DAYS' to '', should fail
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      // timeUnit !== 'DAYS' and halfDayHours present → isFullDay = false
      expect(dayInfo.isFullDay).toBe(false);
    });

    it('should differentiate between DAYS and empty string timeUnit', async () => {
      // Two separate fetches with different timeUnits
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'
        }]
      }));

      const resultsDays = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );
      const isFullDayWithDays = resultsDays.get('user_1')?.get('2025-01-15')?.isFullDay;

      // Reset for second test
      fetch.mockReset();
      resetRateLimiter();

      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDayHours: 4  // Add halfDayHours to make the distinction
          },
          timeUnit: ''  // Empty string
        }]
      }));

      const resultsEmpty = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );
      const isFullDayWithEmpty = resultsEmpty.get('user_1')?.get('2025-01-15')?.isFullDay;

      expect(isFullDayWithDays).toBe(true);
      expect(isFullDayWithEmpty).toBe(false);
    });
  });
});

describe('API Time-Off - isFullDay Logic Mutations (|| vs &&)', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('isFullDay = !halfDay && (timeUnit === DAYS || !halfDayHours)', () => {
    it('should be full day when timeUnit=DAYS even if halfDayHours is present (kills || to && mutation)', async () => {
      // If mutation changes || to &&, this test would fail
      // because (timeUnit === 'DAYS' && !halfDayHours) would be false
      // but (timeUnit === 'DAYS' || !halfDayHours) is true
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDay: false,
            halfDayHours: 4  // halfDayHours IS present (truthy)
          },
          timeUnit: 'DAYS'  // timeUnit IS 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      // With ||: (true || false) = true → isFullDay = true
      // With && (mutation): (true && false) = false → isFullDay = false
      expect(dayInfo.isFullDay).toBe(true);
    });

    it('should NOT be full day when timeUnit NOT DAYS and no halfDayHours', async () => {
      // HOURS units should be treated as partial days even without halfDayHours
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDay: false
            // NO halfDayHours
          },
          timeUnit: 'HOURS'  // NOT 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
    });

    it('should NOT be full day when timeUnit NOT DAYS AND halfDayHours present', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDay: false,
            halfDayHours: 4  // Present
          },
          timeUnit: 'HOURS'  // NOT 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      // (false || false) = false → isFullDay = false
      expect(dayInfo.isFullDay).toBe(false);
    });

    it('should NOT be full day when halfDay is true (regardless of other conditions)', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDay: true  // This alone makes isFullDay = false
          },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
    });
  });
});

describe('API Time-Off - Map Count Mutations', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('User Map Creation Exactness', () => {
    it('should create exactly 1 user map for 1 user with 1 request', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      // Exactly 1 user in the results map
      expect(results.size).toBe(1);
      expect(results.has('user_1')).toBe(true);
    });

    it('should create exactly 2 user maps for 2 users with separate requests', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS'
          },
          {
            userId: 'user_2',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-16T00:00:00Z' },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }, { id: 'user_2', name: 'User 2' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(2);
      expect(results.has('user_1')).toBe(true);
      expect(results.has('user_2')).toBe(true);
    });

    it('should NOT duplicate user map when same user has multiple requests', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS'
          },
          {
            userId: 'user_1',  // Same user
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-20T00:00:00Z' },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      // Still exactly 1 user map
      expect(results.size).toBe(1);
      const userMap = results.get('user_1');
      // But 2 date entries
      expect(userMap.size).toBe(2);
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-20')).toBe(true);
    });
  });

  describe('Date Entry Deduplication', () => {
    it('should NOT overwrite existing date entry when multi-day range overlaps', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              endDate: '2025-01-17T00:00:00Z'
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      // Should have exactly 3 dates: 15, 16, 17
      expect(userMap.size).toBe(3);
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
    });

    it('should preserve expanded entries when overlapping time-off periods exist', async () => {
      // NOTE: The startKey is always overwritten (userMap.set(startKey, ...))
      // but expanded dates check if (!userMap.has(dateKey)) before setting
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              endDate: '2025-01-17T00:00:00Z'
            },
            timeUnit: 'DAYS'  // isFullDay = true
          },
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-16T00:00:00Z',  // Overlaps - this becomes the new startKey
              endDate: '2025-01-18T00:00:00Z',
              halfDay: true  // isFullDay = false
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      // 15, 16, 17 from first request + 18 from second = 4 unique dates
      expect(userMap.size).toBe(4);

      // 15 is from first request (isFullDay=true)
      expect(userMap.get('2025-01-15').isFullDay).toBe(true);
      // 16 is OVERWRITTEN by second request's startKey (halfDay:true → isFullDay=false)
      expect(userMap.get('2025-01-16').isFullDay).toBe(false);
      // 17 was already set from first request's expansion, so preserved (isFullDay=true)
      // because of the if (!userMap.has(dateKey)) check in the forEach
      expect(userMap.get('2025-01-17').isFullDay).toBe(true);
      // 18 is new from second request's expansion (isFullDay=false)
      expect(userMap.get('2025-01-18').isFullDay).toBe(false);
    });
  });
});

describe('API Time-Off - Date Expansion Mutations', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('EndKey !== StartKey Mutation', () => {
    it('should NOT expand dates when endKey equals startKey', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              endDate: '2025-01-15T00:00:00Z'
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      expect(userMap.size).toBe(1);
      expect(userMap.has('2025-01-15')).toBe(true);
    });

    it('should expand dates when endKey differs from startKey', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              endDate: '2025-01-17T00:00:00Z'
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      expect(userMap.size).toBe(3);
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
    });
  });

  describe('Nested Period Handling', () => {
    it('should handle timeOffPeriod.period nested structure', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              period: {
                start: '2025-01-15T00:00:00Z',
                end: '2025-01-16T00:00:00Z'
              }
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
    });

    it('should fallback to direct timeOffPeriod fields', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              start: '2025-01-15T00:00:00Z',
              end: '2025-01-15T00:00:00Z'
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      expect(userMap.has('2025-01-15')).toBe(true);
    });
  });

  describe('User ID Resolution', () => {
    it('should use userId when available', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.has('user_1')).toBe(true);
    });

    it('should fallback to requesterUserId when userId missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            requesterUserId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.has('user_1')).toBe(true);
    });

    it('should skip request when no userId found', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });
  });

  describe('Half Day / Full Day Handling', () => {
    it('should mark as full day when timeUnit is DAYS', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              halfDay: false
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      const dayInfo = userMap.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(true);
    });

    it('should mark as not full day when halfDay is true', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              halfDay: true,
              halfDayHours: 4
            },
            timeUnit: 'HOURS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      const dayInfo = userMap.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
    });
  });

  describe('Response Format Detection Mutations', () => {
    it('should handle data that is non-object (string)', async () => {
      fetch.mockResolvedValueOnce(mockResponse('not-an-object'));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });

    it('should handle data with empty requests array', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });

    it('should handle data with non-array requests field', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: 'not-array' }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });
  });

  describe('Status Type Resolution Mutations', () => {
    it('should reject PENDING status string', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: 'PENDING',
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });

    it('should reject PENDING status object', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'PENDING' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });

    it('should reject REJECTED status', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'REJECTED' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(0);
    });
  });

  describe('isFullDay Logic Mutations', () => {
    it('should mark as NOT full day when halfDay is true even if timeUnit is DAYS', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDay: true,
            halfDayHours: 4
          },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
    });

    it('should mark as full day when halfDay is false and timeUnit is DAYS', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDay: false
          },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(true);
    });

    it('should mark as NOT full day when halfDayHours is present', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDayHours: 4
          },
          timeUnit: 'HOURS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
    });

    it('should mark as full day when no halfDay indicators and timeUnit is DAYS', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z'
          },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(true);
    });
  });

  describe('hours field initialization mutations', () => {
    it('should initialize hours to exactly 0 (not null or undefined)', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.hours).toBe(0);
      expect(dayInfo.hours).not.toBeNull();
      expect(dayInfo.hours).not.toBeUndefined();
    });

    it('should set hours for half-day time off when halfDayHours provided', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            startDate: '2025-01-15T00:00:00Z',
            halfDayHours: 4
          },
          timeUnit: 'HOURS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
      expect(dayInfo.hours).toBe(4);
    });

    it('should ignore halfDayHours for full-day requests when timeUnit is DAYS', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            halfDay: false,
            halfDayHours: 4,
            period: {
              start: '2025-01-15T08:00:00Z',
              end: '2025-01-15T12:00:00Z'
            }
          },
          timeUnit: 'DAYS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(true);
      expect(dayInfo.hours).toBe(0);
    });

    it('should derive hours from period when halfDayHours is missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            halfDay: true,
            period: {
              start: '2025-01-15T08:00:00Z',
              end: '2025-01-15T12:30:00Z'
            }
          },
          timeUnit: 'HOURS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
      expect(dayInfo.hours).toBe(4.5);
    });

    it('should fall back to period hours when halfDayHours is invalid', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            halfDay: true,
            halfDayHours: -2,
            period: {
              start: '2025-01-15T08:00:00Z',
              end: '2025-01-15T12:00:00Z'
            },
            startDate: '2025-01-15T00:00:00Z'
          },
          timeUnit: 'HOURS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
      expect(dayInfo.hours).toBe(4);
    });

    it('should keep hours at 0 when period end is before start', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            halfDay: true,
            period: {
              start: '2025-01-15T12:00:00Z',
              end: '2025-01-15T08:00:00Z'
            },
            startDate: '2025-01-15T00:00:00Z'
          },
          timeUnit: 'HOURS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
      expect(dayInfo.hours).toBe(0);
    });

    it('should keep hours at 0 when period end is invalid', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [{
          userId: 'user_1',
          status: { statusType: 'APPROVED' },
          timeOffPeriod: {
            halfDay: true,
            endDate: 'not-a-date',
            startDate: '2025-01-15T00:00:00Z'
          },
          timeUnit: 'HOURS'
        }]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const dayInfo = results.get('user_1')?.get('2025-01-15');
      expect(dayInfo.isFullDay).toBe(false);
      expect(dayInfo.hours).toBe(0);
    });
  });

  describe('API status tracking mutations', () => {
    it('should reset timeOffFailed to 0 on success', async () => {
      store.apiStatus.timeOffFailed = 5;

      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(store.apiStatus.timeOffFailed).toBe(0);
    });

    it('should set timeOffFailed to user count on failure', async () => {
      const users = [{ id: 'u1', name: 'U1' }, { id: 'u2', name: 'U2' }, { id: 'u3', name: 'U3' }];

      fetch.mockRejectedValueOnce(new Error('Network error'));

      await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 }
      );

      expect(store.apiStatus.timeOffFailed).toBe(3);
    });
  });

  describe('Map Initialization', () => {
    it('should create user map if not exists', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'new_user',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'new_user', name: 'New User' }],
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.has('new_user')).toBe(true);
      expect(results.get('new_user')).toBeInstanceOf(Map);
    });

    it('should not duplicate dates in multi-day range', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
        requests: [
          {
            userId: 'user_1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              startDate: '2025-01-15T00:00:00Z',
              endDate: '2025-01-17T00:00:00Z'
            },
            timeUnit: 'DAYS'
          }
        ]
      }));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_1');
      // Should have exactly 3 entries, no duplicates
      expect(userMap.size).toBe(3);
    });
  });
});
