/**
 * @jest-environment jsdom
 *
 * API Holidays Tests - fetchHolidays, fetchAllHolidays
 *
 * These tests focus on holiday-related API operations including:
 * - Fetching holidays for individual users
 * - Batched holiday fetching
 * - URL parameter encoding
 * - Error tracking for failed holiday fetches
 *
 * @see js/api.ts - Holiday API operations
 * @see docs/prd.md - Holiday Detection section
 */

import { jest } from '@jest/globals';
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store } from '../../js/state.js';
import { generateMockUsers, createMockTokenPayload, createMockJwtToken } from '../helpers/mock-data.js';

// Mock fetch globally
global.fetch = jest.fn();

/**
 * Creates a mock response object with all required methods for API tests.
 * The API's response size check requires text() method when Content-Length is missing.
 */
function mockResponse(data, { ok = true, status = 200, headers = {} } = {}) {
  const jsonStr = JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => jsonStr,
    headers: {
      get: (name) => {
        if (name === 'Content-Length') return String(jsonStr.length);
        return headers[name] || null;
      }
    }
  };
}

describe('API Holidays', () => {
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

  describe('fetchHolidays', () => {
    it('should fetch holidays for user in period', async () => {
      const mockHolidays = [
        { name: 'New Year', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }
      ];

      fetch.mockResolvedValueOnce(mockResponse(mockHolidays));

      const promise = Api.fetchHolidays(
        'workspace_123',
        'user_1',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/holidays/in-period'),
        expect.any(Object)
      );
      expect(result.data).toEqual(mockHolidays);
    });

    it('should encode URL parameters', async () => {
      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise = Api.fetchHolidays(
        'workspace_123',
        'user with spaces',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('user with spaces')),
        expect.any(Object)
      );
    });

    it('should return failed=true on 403 error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const promise = Api.fetchHolidays(
        'workspace_123',
        'user_1',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);
    });

    it('should return failed=true on 404 error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const promise = Api.fetchHolidays(
        'workspace_123',
        'user_1',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
    });
  });

  describe('fetchAllHolidays', () => {
    it('should fetch all holidays in batches', async () => {
      const users = generateMockUsers(5);

      fetch.mockResolvedValue(mockResponse([
        { name: 'Holiday 1', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }
      ]));

      const promise = Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );
      await jest.runAllTimersAsync();
      const results = await promise;

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(5);
      expect(store.apiStatus.holidaysFailed).toBe(0);
    });

    it('should track failed holiday fetches', async () => {
      const users = generateMockUsers(2);

      fetch.mockResolvedValueOnce(mockResponse([]));
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const promise = Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      await promise;

      expect(store.apiStatus.holidaysFailed).toBe(1);
    });

    it('should handle empty users array', async () => {
      const promise = Api.fetchAllHolidays('workspace_123', [], '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const holidays = await promise;

      expect(holidays.size).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should normalize holiday data structure', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse([
        {
          name: 'Christmas',
          datePeriod: {
            startDate: '2025-12-25T00:00:00Z',
            endDate: '2025-12-25T23:59:59Z'
          },
          projectId: 'proj_123'
        }
      ]));

      const promise = Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-12-01',
        '2025-12-31'
      );
      await jest.runAllTimersAsync();
      const results = await promise;

      const userHolidays = results.get('user0');
      expect(userHolidays).toHaveLength(1);
      expect(userHolidays[0].name).toBe('Christmas');
      expect(userHolidays[0].datePeriod.startDate).toBe('2025-12-25T00:00:00Z');
      expect(userHolidays[0].projectId).toBe('proj_123');
    });

    it('should handle missing holiday name', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse([
        {
          datePeriod: {
            startDate: '2025-12-25T00:00:00Z'
          }
        }
      ]));

      const promise = Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-12-01',
        '2025-12-31'
      );
      await jest.runAllTimersAsync();
      const results = await promise;

      const userHolidays = results.get('user0');
      expect(userHolidays[0].name).toBe('');
    });
  });
});

describe('API Holidays - Batch Processing Mutations', () => {
  beforeEach(async () => {
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
  });

  afterEach(() => {
    fetch.mockReset();
  });

  describe('Loop Boundary Edge Cases', () => {
    it('should not process extra iteration for batch loop', async () => {
      const users = generateMockUsers(5);
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse([]));
      });

      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      expect(callCount).toBe(5);
    });

    it('should slice holidays batch correctly (not use full array)', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users in fetchAllHolidays
      // With 7 users: original makes 7 calls, mutation would make 14 (7+7)
      const users = generateMockUsers(7);
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse([]));
      });

      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      // Original: 5 users in batch 1, 2 users in batch 2 = 7 calls
      // Mutation: 7 users in batch 1, 7 users in batch 2 = 14 calls
      expect(callCount).toBe(7);
    });
  });

  describe('Date Format Handling', () => {
    it('should format dates as full ISO 8601 strings', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      // Check that URL contains properly formatted ISO dates (URL encoded)
      const calledUrl = fetch.mock.calls[0][0];
      // URL encoding converts colons to %3A
      expect(calledUrl).toContain(encodeURIComponent('2025-01-01T00:00:00.000Z'));
      expect(calledUrl).toContain(encodeURIComponent('2025-01-31T23:59:59.999Z'));
    });
  });

  describe('Failed Count Tracking', () => {
    it('should increment failed count exactly by 1 for each failure', async () => {
      const users = generateMockUsers(3);

      // All fail
      fetch.mockResolvedValue(mockResponse(null, { ok: false, status: 403 }));

      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      expect(store.apiStatus.holidaysFailed).toBe(3);
    });
  });

  describe('Map Operations', () => {
    it('should store holiday data in results map', async () => {
      const users = generateMockUsers(2);
      const holidays1 = [{ name: 'H1', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }];
      const holidays2 = [{ name: 'H2', datePeriod: { startDate: '2025-01-15T00:00:00Z' } }];

      fetch.mockResolvedValueOnce(mockResponse(holidays1));
      fetch.mockResolvedValueOnce(mockResponse(holidays2));

      const results = await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      expect(results.has('user0')).toBe(true);
      expect(results.has('user1')).toBe(true);
      expect(results.get('user0')[0].name).toBe('H1');
      expect(results.get('user1')[0].name).toBe('H2');
    });

    it('should default missing holiday startDate to empty string', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse([
        {
          name: 'Floating Holiday',
          datePeriod: {},
          projectId: 'proj_999'
        }
      ]));

      const results = await Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userHolidays = results.get('user0');
      expect(userHolidays).toHaveLength(1);
      expect(userHolidays[0].datePeriod.startDate).toBe('');
    });

    it('should not store data for failed requests', async () => {
      const users = generateMockUsers(2);

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));
      fetch.mockResolvedValueOnce(mockResponse([{ name: 'H1', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }]));

      const results = await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      expect(results.has('user0')).toBe(false);
      expect(results.has('user1')).toBe(true);
    });
  });
});
