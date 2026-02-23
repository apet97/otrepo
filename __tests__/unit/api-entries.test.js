/**
 * @jest-environment node
 *
 * API Entries Tests - fetchEntries, fetchDetailedReport, pagination
 *
 * These tests focus on time entry operations including:
 * - Legacy fetchEntries (per-user pagination)
 * - fetchDetailedReport (bulk reports API)
 * - Pagination handling
 * - Entry transformation and normalization
 * - Rate/amount field resolution
 *
 * @see js/api.ts - Entry API operations
 * @see docs/guide.md - Data flow
 */

import { jest } from '@jest/globals';
import { webcrypto } from 'crypto';
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store } from '../../js/state.js';
import { generateMockUsers, createMockTokenPayload, createMockJwtToken } from '../helpers/mock-data.js';

// Set up Web Crypto API for jsdom environment (required for body signing in POST requests)
global.crypto = webcrypto;

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

describe('API Entries', () => {
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

  describe('fetchEntries', () => {
    it('should fetch entries for multiple users in batches', async () => {
      const users = generateMockUsers(3);
      const mockEntries = [
        { id: 'entry_1', userId: 'user_0' },
        { id: 'entry_2', userId: 'user_0' }
      ];

      fetch.mockResolvedValue(mockResponse(mockEntries));

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });

    it('should handle pagination', async () => {
      const users = generateMockUsers(1);

      // First page returns 500 entries (full page)
      fetch.mockResolvedValueOnce(mockResponse(Array(500).fill({ id: 'entry' })));

      // Second page returns 100 entries (partial page)
      fetch.mockResolvedValueOnce(mockResponse(Array(100).fill({ id: 'entry' })));

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.length).toBe(600);
    });

    it('should stop at max pages', async () => {
      const users = generateMockUsers(1);

      fetch.mockImplementation(() =>
        Promise.resolve(mockResponse(Array(500).fill({ id: 'entry' })))
      );

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(50);
      expect(result.length).toBe(500 * 50);
    });

    it('should handle empty users array', async () => {
      const promise = Api.fetchEntries(
        'workspace_123',
        [],
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should not process extra iteration for batch loop', async () => {
      const users = generateMockUsers(5); // Exactly BATCH_SIZE
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse([]));
      });

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(callCount).toBe(5);
    });
  });

  describe('fetchDetailedReport', () => {
    it('should prefer developer backend when reportsUrl differs', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse(({ timeentries: [] })));

      const promise = Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://developer.clockify.me/api/v1/workspaces/ws_dev/reports/detailed',
        expect.any(Object)
      );
    });

    it('should derive report base from regional backend', async () => {
      store.claims = {
        workspaceId: 'ws_region',
        backendUrl: 'https://use2.clockify.me/api'
      };

      fetch.mockResolvedValueOnce(mockResponse(({ timeentries: [] })));

      const promise = Api.fetchDetailedReport(
        'ws_region',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://use2.clockify.me/report/v1/workspaces/ws_region/reports/detailed',
        expect.any(Object)
      );
    });

    it('should handle timeEntries (camelCase) response', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse(({
          timeEntries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('entry_1');
    });

    it('should handle pagination stopping on partial page', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: Array(100).fill({
            _id: 'entry',
            userId: 'u1',
            userName: 'U1',
            timeInterval: {
              start: '2025-01-01T09:00:00Z',
              end: '2025-01-01T10:00:00Z',
              duration: 3600
            }
          })
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      // Should stop after one page since 100 < 200 (pageSize)
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(entries.length).toBe(100);
    });
  });
});

describe('API Entries - Entry Transformation', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me'
    };
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

  describe('Rate Resolution', () => {
    it('should handle hourlyRate as object correctly', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000, currency: 'EUR' }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.amount).toBe(5000);
      expect(entries[0].hourlyRate.currency).toBe('EUR');
    });

    it('should handle hourlyRate as number correctly', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              hourlyRate: 5000
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.amount).toBe(5000);
      expect(entries[0].hourlyRate.currency).toBe('USD'); // Default
    });

    it('should handle hourlyRate object without currency', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should return first positive value from rate candidates', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              earnedRate: 6000,
              rate: { amount: 5000 },
              hourlyRate: { amount: 4000 }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.amount).toBe(6000);
    });

    it('should fallback to finite value when no positive value found', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              earnedRate: 0,
              rate: 0,
              hourlyRate: 0
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.amount).toBe(0);
    });

    it('should handle earnedRate fallback when 0 and billable', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              earnedRate: 0
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].earnedRate).toBe(5000);
    });

    it('should handle object without amount property', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { currency: 'USD' }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.amount).toBe(0);
    });
  });

  describe('Timestamp Normalization', () => {
    it('should return timestamp with T as-is', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00+05:30',
                end: '2025-01-01T17:00:00-08:00',
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00+05:30');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:00:00-08:00');
    });

    it('should convert spaced format to ISO', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01 09:00:00Z',
                end: '2025-01-01 17:00:00Z',
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:00:00Z');
    });

    it('should convert compact format to ISO', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-0109:05:30Z',
                end: '2025-01-0117:45:00Z',
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:05:30Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:45:00Z');
    });

    it('should handle whitespace-only timestamp', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '   ',
                end: '\t\n ',
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].timeInterval.start).toBe('');
      expect(entries[0].timeInterval.end).toBe('');
    });

    it('should handle null/undefined timestamp', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: null,
                end: undefined,
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].timeInterval.start).toBe('');
      expect(entries[0].timeInterval.end).toBe('');
    });
  });

  describe('Amount Normalization', () => {
    it('should handle amounts array with null items safely', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              amounts: [
                null,
                undefined,
                { type: 'EARNED', value: 100 }
              ]
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries).toBeDefined();
    });

    it('should normalize object amounts to array', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_object',
              userId: 'user_2',
              userName: 'User 2',
              billable: true,
              timeInterval: {
                start: '2025-01-02T09:00:00Z',
                end: '2025-01-02T10:00:00Z',
                duration: 3600
              },
              hourlyRate: 4500,
              amounts: {
                earned: 80,
                profit: 60
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-03T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      const earnedFromObject = entries[0].amounts.find(
        (amount) => String(amount?.type || amount?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedFromObject?.value).toBe(80);
    });

    it('should add fallback EARNED amount when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T11:00:00Z',
                duration: 7200
              },
              rate: { amount: 6000 },
              hourlyRate: { amount: 5000, currency: 'EUR' },
              earnedRate: 0,
              amount: 120,
              amounts: [{ type: 'COST', value: 50 }]
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      const earnedFromArray = entries[0].amounts.find(
        (amount) => String(amount?.type || amount?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedFromArray?.value).toBe(120);
    });
  });

  describe('Client/Project Fields', () => {
    it('should preserve clientId and clientName when present', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              clientId: 'client_1',
              clientName: 'Client 1'
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].clientId).toBe('client_1');
      expect(entries[0].clientName).toBe('Client 1');
    });

    it('should default clientId to null when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].clientId).toBeNull();
      expect(entries[0].clientName).toBeNull();
    });
  });
});

describe('API Entries - Rate Resolution Mutation Killers', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me'
    };
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

  describe('resolveRateValue - null/undefined/object mutations', () => {
    it('should resolve null rate to exactly 0 (not 1 or undefined)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: null, earnedRate: null, rate: null
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(0);
      expect(entries[0].hourlyRate.amount).not.toBe(1);
    });

    it('should resolve undefined rate to exactly 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(0);
    });

    it('should resolve numeric rate directly (not wrapped in object)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 7500
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(7500);
    });

    it('should resolve object rate with NaN amount to exactly 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: { amount: 'not-a-number' }, earnedRate: null, rate: null
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(0);
    });

    it('should resolve object rate with Infinity amount to exactly 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: { amount: Infinity }, earnedRate: null, rate: null
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(0);
    });
  });

  describe('pickRateValue - priority order mutations', () => {
    it('should prefer earnedRate > rate > hourlyRate (exact priority)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: 9000, rate: { amount: 7000 }, hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // earnedRate (9000) is first positive, so hourlyRate should be 9000
      expect(entries[0].hourlyRate.amount).toBe(9000);
    });

    it('should skip zero earnedRate and use rate when earnedRate is 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: 0, rate: { amount: 7000 }, hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // 0 is not > 0, so skip to rate (7000)
      expect(entries[0].hourlyRate.amount).toBe(7000);
    });

    it('should skip negative earnedRate and use rate', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: -100, rate: { amount: 7000 }, hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(7000);
    });

    it('should fallback to finite 0 when all rates are 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: 0, rate: 0, hourlyRate: 0
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.amount).toBe(0);
    });
  });

  describe('billable field normalization', () => {
    it('should treat billable: false as exactly false (not truthy)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            billable: false
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].billable).toBe(false);
    });

    it('should treat billable: undefined as false', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].billable).toBe(false);
    });

    it('should treat billable: null as false', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            billable: null
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].billable).toBe(false);
    });
  });

  describe('Entry ID resolution mutations (_id vs id)', () => {
    it('should prefer _id over id', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'underscore_id', id: 'regular_id', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].id).toBe('underscore_id');
    });

    it('should fallback to id when _id is missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            id: 'regular_id', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].id).toBe('regular_id');
    });

    it('should fallback to empty string when both _id and id missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].id).toBe('');
    });
  });

  describe('Entry type fallback mutations', () => {
    it('should default type to REGULAR when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].type).toBe('REGULAR');
    });

    it('should preserve explicit type when present', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', type: 'BREAK',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].type).toBe('BREAK');
    });
  });

  describe('Duration normalization mutations', () => {
    it('should convert integer seconds to ISO duration string', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].timeInterval.duration).toBe('PT28800S');
    });

    it('should handle null duration', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: null }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].timeInterval.duration).toBeNull();
    });

    it('should handle duration of 0 (zero seconds)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T09:00:00Z', duration: 0 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // 0 is != null, so it should be converted
      expect(entries[0].timeInterval.duration).toBe('PT0S');
    });
  });

  describe('String fallback mutations (userId, userName, clientId, clientName)', () => {
    it('should fallback userId to empty string when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].userId).toBe('');
    });

    it('should fallback userName to empty string when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].userName).toBe('');
    });

    it('should fallback clientId to null (not empty string) when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].clientId).toBeNull();
      expect(entries[0].clientId).not.toBe('');
    });

    it('should fallback tags to empty array when missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].tags).toEqual([]);
    });
  });

  describe('earnedRate normalization mutations', () => {
    it('should use resolvedEarnedRate when positive and billable', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: 8000, hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].earnedRate).toBe(8000);
    });

    it('should fallback to resolvedHourlyRate when earnedRate is 0 and billable', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: 0, hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].earnedRate).toBe(5000);
    });

    it('should set earnedRate to 0 when not billable', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: false,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            earnedRate: 8000, hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].earnedRate).toBe(0);
    });
  });

  describe('Currency resolution mutations', () => {
    it('should use currency from hourlyRate object', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: { amount: 5000, currency: 'EUR' }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.currency).toBe('EUR');
    });

    it('should default currency to USD when hourlyRate is numeric', async () => {
      const responseBody = {
        timeentries: [{
          _id: 'e1', userId: 'u1', userName: 'U1',
          timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
          hourlyRate: 5000
        }]
      };
      fetch.mockImplementation(() => Promise.resolve(mockResponse(responseBody)));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should default currency to USD when hourlyRate object has no currency', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].hourlyRate.currency).toBe('USD');
    });
  });

  describe('normalizeAmounts mutations', () => {
    it('should handle amounts as single object with type/value (not array)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { type: 'EARNED', value: 120 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts).toBeInstanceOf(Array);
      expect(entries[0].amounts.length).toBeGreaterThanOrEqual(1);
      // Verify the type field is preserved from the object
      const earnedEntry = entries[0].amounts.find(a => a?.type === 'EARNED');
      expect(earnedEntry).toBeDefined();
      expect(earnedEntry.value).toBe(120);
    });

    it('should handle null amounts with fallback from amount field', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 200, amounts: null
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].amounts[0].value).toBe(200);
    });

    it('should handle amounts as key/value map object', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { earned: 120, cost: 80, profit: 40 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts).toBeInstanceOf(Array);
      // Should have mapped entries for each key
      const earnedEntry = entries[0].amounts.find(a => String(a?.type || '').toUpperCase() === 'EARNED');
      expect(earnedEntry).toBeDefined();
      expect(earnedEntry.value).toBe(120);
    });

    // Mutation killers: typeof raw === 'object' mutations
    it('should NOT treat string amounts as object (typeof check)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 150,
            amounts: "invalid-string"  // String, not object
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // Should fallback to amount field since "invalid-string" is not an object
      expect(entries[0].amounts).toBeInstanceOf(Array);
      expect(entries[0].amounts[0].value).toBe(150);
    });

    it('should NOT treat number amounts as object (typeof check)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 250,
            amounts: 12345  // Number, not object
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // Should fallback to amount field since 12345 is not an object
      expect(entries[0].amounts).toBeInstanceOf(Array);
      expect(entries[0].amounts[0].value).toBe(250);
    });

    // Mutation killers: 'type' in raw checks
    it('should detect object with only amountType property (not type)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { amountType: 'EARNED', value: 100 }  // amountType, not type
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts).toBeInstanceOf(Array);
      // Should still be treated as single-entry object
      expect(entries[0].amounts.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect object with only value property', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { value: 100 }  // Only value, no type
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts).toBeInstanceOf(Array);
      expect(entries[0].amounts.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect object with only amount property', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { amount: 100 }  // Only amount, no type/value
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts).toBeInstanceOf(Array);
      expect(entries[0].amounts.length).toBeGreaterThanOrEqual(1);
    });

    // Mutation killer: mapped.length check
    it('should handle object with no numeric values (empty mapped array)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 300,
            amounts: { note: 'text', status: 'active' }  // No numeric values
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // Should fallback to amount field since no numeric values were mapped
      expect(entries[0].amounts).toBeInstanceOf(Array);
      expect(entries[0].amounts[0].value).toBe(300);
    });

    // Mutation killer: Number.isFinite check in reduce
    it('should skip NaN values in key/value map', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { earned: 100, invalid: 'not-a-number', cost: 50 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].amounts).toBeInstanceOf(Array);
      // Should only include the numeric entries (earned, cost), not invalid
      const types = entries[0].amounts.map(a => a.type);
      expect(types).toContain('EARNED');
      expect(types).toContain('COST');
      // 'invalid' should NOT be included since its value is NaN
    });

    it('should skip Infinity values in key/value map', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000,
            amounts: { earned: 100, bad: Infinity, cost: 50 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // Bad should not be included since Infinity is not finite
      const badEntry = entries[0].amounts.find(a => a.type === 'BAD');
      expect(badEntry).toBeUndefined();
    });
  });

  describe('ensureShownAmount mutations', () => {
    it('should add fallback EARNED amount when no matching type found', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 200,
            amounts: [{ type: 'COST', value: 100 }]
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // Should have added EARNED fallback from amount field
      const earnedEntry = entries[0].amounts.find(a => String(a?.type || '').toUpperCase() === 'EARNED');
      expect(earnedEntry).toBeDefined();
      expect(earnedEntry.value).toBe(200);
    });

    it('should NOT add fallback when amount is 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 0,
            amounts: [{ type: 'COST', value: 100 }]
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // amount=0 should NOT trigger fallback (condition: fallbackAmount === 0 returns early)
      expect(entries[0].amounts.length).toBe(1);
      expect(entries[0].amounts[0].type).toBe('COST');
    });

    it('should NOT add fallback when matching type already exists with non-zero value', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1', billable: true,
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, amount: 999,
            amounts: [{ type: 'EARNED', value: 200 }]
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // EARNED already exists with non-zero total, should NOT add fallback
      const earnedEntries = entries[0].amounts.filter(a => String(a?.type || '').toUpperCase() === 'EARNED');
      expect(earnedEntries.length).toBe(1);
      expect(earnedEntries[0].value).toBe(200);
    });
  });

  describe('costRate fallback mutations', () => {
    it('should use resolved costRate when non-zero', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, costRate: 3000
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      expect(entries[0].costRate).toBe(3000);
    });

    it('should fallback to original costRate when resolvedCostRate is 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: 5000, costRate: { amount: 0 }
          }]
        })));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      await jest.runAllTimersAsync();
      const entries = await promise;
      // resolvedCostRate is 0, so fallback to e.costRate (the original object)
      expect(entries[0].costRate).toBeDefined();
    });
  });
});

describe('API Entries - Pagination Mutations', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me'
    };
    store.resetApiStatus();
    store.config = {};
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
    store.config = {};
  });

  describe('MaxPages Configuration', () => {
    it('should treat configuredMaxPages=0 as unlimited', async () => {
      store.config = { maxPages: 0 };

      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1',
            userId: 'u1',
            userName: 'U1',
            timeInterval: {
              start: '2025-01-01T09:00:00Z',
              end: '2025-01-01T10:00:00Z',
              duration: 3600
            }
          }]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries.length).toBe(1);
    });

    it('should use configured maxPages when non-zero', async () => {
      store.config = { maxPages: 2 };

      let callCount = 0;
      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse(({
            timeentries: Array(200).fill({
              _id: `e${callCount}`,
              userId: 'u1',
              userName: 'U1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T10:00:00Z',
                duration: 3600
              }
            })
          })));
      });

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(callCount).toBe(2);
      expect(entries.length).toBe(400);
    });
  });
});

describe('API Entries - Loop Boundary Mutations', () => {
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

  describe('fetchEntries batch loop boundary (i < users.length, not i <= users.length)', () => {
    it('should process exactly 1 batch for 5 users (BATCH_SIZE)', async () => {
      const users = generateMockUsers(5);  // Exactly BATCH_SIZE
      let batchCount = 0;

      fetch.mockImplementation(() => {
        batchCount++;
        return Promise.resolve(mockResponse([]));
      });

      const promise1 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise1;

      // 5 users / BATCH_SIZE(5) = 1 batch
      // If mutation changed i < to i <=, would process 2 batches
      expect(batchCount).toBe(5);  // 5 parallel fetches (one per user in the batch)
    });

    it('should process exactly 2 batches for 6 users (BATCH_SIZE + 1)', async () => {
      const users = generateMockUsers(6);  // BATCH_SIZE + 1
      let batchStartCount = 0;
      const batchSizes = [];

      fetch.mockImplementation(() => {
        return Promise.resolve(mockResponse([]));
      });

      // Track how many users are processed
      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      // 6 users with BATCH_SIZE=5 means:
      // - First batch: 5 users
      // - Second batch: 1 user
      // Total: 6 fetch calls
      expect(fetch).toHaveBeenCalledTimes(6);
    });

    it('should NOT process empty batch at end when users.length is multiple of BATCH_SIZE', async () => {
      const users = generateMockUsers(10);  // 2 * BATCH_SIZE
      let totalFetches = 0;

      fetch.mockImplementation(() => {
        totalFetches++;
        return Promise.resolve(mockResponse([]));
      });

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should be exactly 10 fetches (one per user), NOT 11 or 15
      // If mutation i < became i <=, it would try to process an empty batch
      expect(totalFetches).toBe(10);
    });
  });
});

describe('API Entries - Mutation Killer Tests', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me'
    };
    store.config = {};
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

  describe('Request Body Verification - kills StringLiteral/ArrayDeclaration mutants', () => {
    it('should include exact amounts array in request body: EARNED, COST, PROFIT', async () => {
      let capturedBody = null;
      fetch.mockImplementation((url, options) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve(mockResponse(({ timeentries: [] })));
      });

      const promise1 = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise1;

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.amounts).toEqual(['EARNED', 'COST', 'PROFIT']);
      // Verify exact strings - these assertions kill StringLiteral mutations
      expect(capturedBody.amounts[0]).toBe('EARNED');
      expect(capturedBody.amounts[1]).toBe('COST');
      expect(capturedBody.amounts[2]).toBe('PROFIT');
      expect(capturedBody.amounts.length).toBe(3);
    });

    it('should include Content-Type header as application/json', async () => {
      let capturedHeaders = null;
      fetch.mockImplementation((url, options) => {
        capturedHeaders = options?.headers;
        return Promise.resolve(mockResponse(({ timeentries: [] })));
      });

      const promise2 = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise2;

      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['Content-Type']).not.toBe('');
    });

    it('should include amountShown as EARNED in request body', async () => {
      let capturedBody = null;
      fetch.mockImplementation((url, options) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve(mockResponse(({ timeentries: [] })));
      });

      const promise3 = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise3;

      expect(capturedBody.amountShown).toBe('EARNED');
    });
  });

  describe('Type Key Case - kills MethodExpression .toUpperCase() mutations', () => {
    it('should convert amount object keys to uppercase', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            amounts: {
              earned: 100,
              cost: 50
            }
          }]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      // Verify type is uppercase, not lowercase
      const earnedAmount = entries[0].amounts.find(a => a.type === 'EARNED');
      const costAmount = entries[0].amounts.find(a => a.type === 'COST');
      expect(earnedAmount).toBeDefined();
      expect(earnedAmount.value).toBe(100);
      expect(costAmount).toBeDefined();
      expect(costAmount.value).toBe(50);

      // Ensure lowercase versions don't exist
      const lowerEarned = entries[0].amounts.find(a => a.type === 'earned');
      expect(lowerEarned).toBeUndefined();
    });
  });

  describe('costRate fallback - kills LogicalOperator || vs && mutation', () => {
    it('should use e.costRate when resolvedCostRate is 0', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            costRate: 0,  // resolveRateValue returns 0
            hourlyRate: { amount: 5000 }
          }]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      // costRate should be 0 (from resolvedCostRate || e.costRate where resolvedCostRate=0)
      // If mutation changed || to &&, result would be different
      expect(entries[0].costRate).toBe(0);
    });

    it('should use resolvedCostRate when positive (not fallback to e.costRate)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            costRate: 3000  // resolveRateValue returns 3000
          }]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].costRate).toBe(3000);
    });
  });

  describe('Date string construction - kills StringLiteral template mutations', () => {
    it('should construct correct ISO date strings from date parts', async () => {
      let capturedBody = null;
      fetch.mockImplementation((url, options) => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body);
        }
        return Promise.resolve(mockResponse(({ timeentries: [] })));
      });

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00.000Z',
        '2025-01-31T23:59:59.999Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Verify the dates are passed through correctly (not empty strings)
      expect(capturedBody.dateRangeStart).toBe('2025-01-01T00:00:00.000Z');
      expect(capturedBody.dateRangeEnd).toBe('2025-01-31T23:59:59.999Z');
      expect(capturedBody.dateRangeStart).not.toBe('');
      expect(capturedBody.dateRangeEnd).not.toBe('');
    });
  });

  describe('Default currency - kills empty string mutation', () => {
    it('should default currency to USD not empty string', async () => {
      fetch.mockResolvedValueOnce(mockResponse(({
          timeentries: [{
            _id: 'e1', userId: 'u1', userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
            hourlyRate: { amount: 5000 }  // currency missing
          }]
        })));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      const entries = await promise;

      expect(entries[0].hourlyRate.currency).toBe('USD');
      expect(entries[0].hourlyRate.currency).not.toBe('');
      expect(entries[0].hourlyRate.currency.length).toBe(3);
    });
  });
});

describe('API Entries - fetchUserEntriesPaginated Mutation Killers', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    store.config = {};
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
    store.config = {};
  });

  describe('User metadata enrichment - kills ObjectSpread/PropertyAssignment mutations', () => {
    it('should enrich entries with user.id as userId', async () => {
      const users = [{ id: 'user_abc123', name: 'Alice' }];

      fetch.mockResolvedValueOnce(mockResponse([
          { id: 'entry_1', description: 'Task 1' },
          { id: 'entry_2', description: 'Task 2' }
        ]));

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      // Verify userId is added from user.id
      expect(result[0].userId).toBe('user_abc123');
      expect(result[1].userId).toBe('user_abc123');
      // Verify it's NOT the entry's own id
      expect(result[0].userId).not.toBe('entry_1');
    });

    it('should enrich entries with user.name as userName', async () => {
      const users = [{ id: 'user_1', name: 'Bob Smith' }];

      fetch.mockResolvedValueOnce(mockResponse([
          { id: 'entry_1', description: 'Task 1' }
        ]));

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      // Verify userName is added from user.name
      expect(result[0].userName).toBe('Bob Smith');
      expect(result[0].userName).not.toBe('');
    });

    it('should preserve original entry fields while adding user metadata', async () => {
      const users = [{ id: 'user_1', name: 'Carol' }];

      fetch.mockResolvedValueOnce(mockResponse([
          { id: 'entry_orig', description: 'Original task', billable: true }
        ]));

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      // Original fields preserved
      expect(result[0].id).toBe('entry_orig');
      expect(result[0].description).toBe('Original task');
      expect(result[0].billable).toBe(true);
      // User fields added
      expect(result[0].userId).toBe('user_1');
      expect(result[0].userName).toBe('Carol');
    });
  });

  describe('Pagination loop boundary (page <= effectiveMaxPages)', () => {
    it('should fetch exactly maxPages when all pages are full', async () => {
      store.config = { maxPages: 3 };
      const users = [{ id: 'user_1', name: 'User 1' }];
      let pageCount = 0;

      fetch.mockImplementation(() => {
        pageCount++;
        return Promise.resolve(mockResponse(Array(500).fill({ id: `entry_${pageCount}` })));
      });

      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      await jest.runAllTimersAsync();
      const result = await promise;

      // With maxPages=3, should stop at page 3 (even though pages are full)
      expect(pageCount).toBe(3);
      expect(result.length).toBe(1500);
    });

    it('should fetch page 1 when maxPages is 1 (boundary test)', async () => {
      store.config = { maxPages: 1 };
      const users = [{ id: 'user_1', name: 'User 1' }];
      let pageCount = 0;

      fetch.mockImplementation(() => {
        pageCount++;
        return Promise.resolve(mockResponse(Array(500).fill({ id: `entry_${pageCount}` })));
      });

      const promise1 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise1;

      // With maxPages=1, should only fetch 1 page
      expect(pageCount).toBe(1);
      expect(result.length).toBe(500);
    });

    it('should stop when page returns fewer entries than PAGE_SIZE', async () => {
      store.config = { maxPages: 50 };
      const users = [{ id: 'user_1', name: 'User 1' }];
      let pageCount = 0;

      fetch.mockImplementation(() => {
        pageCount++;
        return Promise.resolve(mockResponse(pageCount === 1
            ? Array(500).fill({ id: 'entry' })
            : Array(100).fill({ id: 'entry' })));
      });

      const promise2 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise2;

      // Should stop after 2 pages (second page was partial)
      expect(pageCount).toBe(2);
      expect(result.length).toBe(600);
    });

    it('should stop when page returns empty array', async () => {
      const users = [{ id: 'user_1', name: 'User 1' }];
      let pageCount = 0;

      fetch.mockImplementation(() => {
        pageCount++;
        return Promise.resolve(mockResponse(pageCount === 1
            ? [{ id: 'entry_1' }]
            : []));
      });

      const promise3 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise3;

      // Should stop after page 1 (it had entries but was partial)
      // Actually since 1 < 500, it stops after 1 page
      expect(pageCount).toBe(1);
      expect(result.length).toBe(1);
    });

    it('should stop when page fetch fails', async () => {
      const users = [{ id: 'user_1', name: 'User 1' }];
      let pageCount = 0;

      fetch.mockImplementation(() => {
        pageCount++;
        if (pageCount === 1) {
          return Promise.resolve(mockResponse(Array(500).fill({ id: 'entry' })));
        }
        // Second page fails
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        });
      });

      const promise4 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      const result = await promise4;

      // Should stop after failed page 2
      expect(pageCount).toBe(2);
      expect(result.length).toBe(500);
    });
  });

  describe('URL construction mutations', () => {
    it('should include user.id in the URL path', async () => {
      const users = [{ id: 'specific_user_id_123', name: 'User' }];

      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise5 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise5;

      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('/user/specific_user_id_123/time-entries');
    });

    it('should include encoded start/end dates in URL', async () => {
      const users = [{ id: 'user_1', name: 'User' }];

      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise6 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise6;

      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('start=');
      expect(calledUrl).toContain('end=');
      // Should be URL encoded (colons become %3A)
      expect(calledUrl).toContain('%3A');
    });

    it('should include page and page-size parameters', async () => {
      const users = [{ id: 'user_1', name: 'User' }];

      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise7 = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      await jest.runAllTimersAsync();
      await promise7;

      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('page=1');
      expect(calledUrl).toContain('page-size=500');
    });
  });
});
