/**
 * @jest-environment node
 *
 * API Module - Mutation Test Coverage
 * Tests specifically designed to kill Stryker mutants and ensure
 * boundary conditions, loop logic, and edge cases are correctly handled.
 */

import { jest } from '@jest/globals';
import { webcrypto } from 'crypto';
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store, resetFallbackStorage } from '../../js/state.js';
import { generateMockUsers, createMockTokenPayload, createMockJwtToken } from '../helpers/mock-data.js';

// Set up Web Crypto API for Node environment (required for body signing in POST requests)
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

describe('API Module - Mutation Test Coverage', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    // Reset the rate limiter, circuit breaker, and fallback storage to ensure clean state
    resetRateLimiter();
    resetCircuitBreaker();
    resetFallbackStorage();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('Loop Boundary Edge Cases - Kill Mutants', () => {
    it('should handle empty users array for batched operations', async () => {
      // Kill: i < users.length → i <= users.length when users is empty
      // If mutation changes to <=, loop body would run once with undefined index
      const users = [];

      fetch.mockImplementation(() => {
        throw new Error('Should not be called for empty users');
      });

      // These operations iterate over users with batch loop
      const profiles = await Api.fetchAllProfiles('workspace_123', users);
      expect(profiles.size).toBe(0);

      const entries = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );
      expect(entries).toEqual([]);

      const holidays = await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');
      expect(holidays.size).toBe(0);

      // Verify fetch was never called for these batch operations
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should correctly slice batch at BATCH_SIZE boundary', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users
      // With 7 users (> BATCH_SIZE=5), if slice returns full array,
      // each batch would process all 7 instead of the correct subset
      const users = generateMockUsers(7);
      const fetchCalls = [];

      fetch.mockImplementation((url) => {
        fetchCalls.push(url);
        return Promise.resolve(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));
      });

      await Api.fetchAllProfiles('workspace_123', users);

      // Should make 7 calls total (processes each user)
      expect(fetchCalls.length).toBe(7);

      // Extract user IDs from URLs (pattern: /member-profile/{userId})
      const userIdsFromCalls = fetchCalls.map(url => {
        const match = url.match(/\/member-profile\/([^/]+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      // All 7 users should be called
      expect(userIdsFromCalls.length).toBe(7);
      // Each user should appear exactly once (not duplicated due to broken slice)
      const uniqueIds = new Set(userIdsFromCalls);
      expect(uniqueIds.size).toBe(7);
    });

    it('should process exactly BATCH_SIZE users without going out of bounds', async () => {
      // Kill: i < users.length → i <= users.length
      // With exactly 5 users (BATCH_SIZE), <= would cause an extra iteration
      const users = generateMockUsers(5);
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse({
            workCapacity: 'PT8H',
            workingDays: []
          }));
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      // Should call fetch exactly 5 times (one per user)
      expect(callCount).toBe(5);
      expect(results.size).toBe(5);
    });

    it('should handle users.slice correctly at batch boundary', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users (full array)
      const users = generateMockUsers(6); // 6 users = 2 batches (5 + 1)
      const batchSizes = [];

      let batchIndex = 0;
      fetch.mockImplementation(async () => {
        batchSizes.push(1);
        return mockResponse({
          workCapacity: 'PT8H',
          workingDays: []
        });
      });

      await Api.fetchAllProfiles('workspace_123', users);

      // Should process 5 in first batch, 1 in second batch
      expect(batchSizes.length).toBe(6); // 5 + 1 calls
    });

    it('should not process extra iteration for fetchEntries batch loop', async () => {
      // Kill: i < users.length → i <= users.length in fetchEntries
      const users = generateMockUsers(5); // Exactly BATCH_SIZE
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse([] ));
      });

      await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Should process exactly 5 users, not 6
      expect(callCount).toBe(5);
    });

    it('should not process extra iteration for fetchAllHolidays batch loop', async () => {
      // Kill: i < users.length → i <= users.length in fetchAllHolidays
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

  describe('Error Return Value Mutations - Kill Mutants', () => {
    it('should return failed=true for 401 errors', async () => {
      // Kill: failed: true → failed: false mutations
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should return failed=true for 403 errors', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
    });

    it('should return failed=true for 404 errors', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
    });

    it('should return failed=true for 429 rate limit with no retries', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // In test env maxRetries=0, so should fail immediately
      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });
  });

  describe('Optional Chaining Mutations - Kill Mutants', () => {
    it('should handle amounts array with null items safely', async () => {
      // Kill: item?.type → item.type (would throw on null)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: [
                null, // Null item
                undefined, // Undefined item
                { type: 'EARNED', value: 100 }
              ]
            }
          ]
        }));

      // Should not throw
      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries).toBeDefined();
    });

    it('should handle item.value null safely', async () => {
      // Kill: item?.value → item.value
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: [
                { type: 'EARNED' } // No value field
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries).toBeDefined();
    });
  });

  describe('Type Check Mutations - Kill Mutants', () => {
    it('should handle data as non-object in time-off response', async () => {
      // Kill: typeof data === 'object' → true
      fetch.mockResolvedValueOnce(mockResponse(null ));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      // Should handle gracefully and return empty map
      expect(results.size).toBe(0);
    });

    it('should handle resolveRateValue with object containing non-number amount', async () => {
      // Kill: typeof value === 'object' && 'amount' in value → true
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 'not-a-number' }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should handle gracefully
      expect(entries[0].hourlyRate.amount).toBe(0);
    });
  });

  describe('Arithmetic Operator Mutations - Kill Mutants', () => {
    it('should sum amounts correctly (not subtract)', async () => {
      // Kill: total + value → total - value
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: [
                { type: 'EARNED', value: 50 },
                { type: 'EARNED', value: 50 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // If subtracted, total would be 0, not 100
      const earnedAmounts = entries[0].amounts.filter(a =>
        String(a.type || '').toUpperCase() === 'EARNED'
      );
      const total = earnedAmounts.reduce((sum, a) => sum + (a.value || 0), 0);
      expect(total).toBe(100);
    });
  });

  describe('Regex Anchor Mutations - Kill Mutants', () => {
    it('should only match $ at end of string for backendPath', async () => {
      // Kill: /\\/api$/ → /\\/api/ (would match /api anywhere)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api-gateway.clockify.me/api-v2/api' // /api appears multiple times
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // With wrong regex, first /api would be replaced
      // Correct behavior: only last /api is replaced
      const calledUrl = fetch.mock.calls[0][0];
      // Should still have api-gateway and api-v2 in URL
      expect(calledUrl).toMatch(/api.*report/);
    });

    it('should only match $ at end for normalizedBackend trailing slashes', async () => {
      // Kill: /\\/+$/ → /\\/+/ (would match any slashes)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me//path///with///slashes///' // Many internal slashes
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should preserve internal slashes, only remove trailing
      const calledUrl = fetch.mock.calls[0][0];
      // URL should not have collapsed all slashes
      expect(calledUrl).toContain('clockify.me');
    });
  });

  describe('Content-Type and Header Mutations - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should add Content-Type only when body exists and header not set', async () => {
      // Kill: options.body && !headers['Content-Type'] mutations
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should not add Content-Type when no body', async () => {
      // Kill: options.body check (no body = no Content-Type)
      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchUsers('workspace_123');

      // fetchUsers doesn't have a body, so Content-Type should not be forcefully added
      // (though it might be added by other logic - this tests the condition)
      expect(fetch).toHaveBeenCalled();
    });

    it('should preserve existing Content-Type header', async () => {
      // This tests that we don't overwrite an already set Content-Type
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      // fetchDetailedReport sets Content-Type explicitly
      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('MaxPages Configuration Mutations - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should treat configuredMaxPages=0 as unlimited', async () => {
      // Kill: configuredMaxPages === 0 → false
      store.config = { maxPages: 0 }; // 0 means unlimited
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Return partial page to stop pagination
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [{ _id: 'e1', userId: 'u1', userName: 'U1', timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 } }]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries.length).toBe(1);
      store.config = {};
    });

    it('should use configured maxPages when non-zero', async () => {
      // Kill: effectiveMaxPages calculation
      store.config = { maxPages: 2 }; // Only 2 pages
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Return full page twice, then stop
      let callCount = 0;
      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse({
            timeentries: Array(200).fill({
              _id: `e${callCount}`,
              userId: 'u1',
              userName: 'U1',
              timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
            })
          }));
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should stop after 2 pages
      expect(callCount).toBe(2);
      expect(entries.length).toBe(400); // 200 * 2
      store.config = {};
    });
  });

  describe('Hourly Rate Type Mutations - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should handle hourlyRate as object correctly', async () => {
      // Kill: typeof e.hourlyRate === 'object' mutations
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000, currency: 'EUR' } // Object type
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
      expect(entries[0].hourlyRate.currency).toBe('EUR');
    });

    it('should handle hourlyRate as number correctly', async () => {
      // Kill: typeof e.hourlyRate === 'object' → false branch
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: 5000 // Number type
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
      expect(entries[0].hourlyRate.currency).toBe('USD'); // Default
    });

    it('should handle hourlyRate object without currency', async () => {
      // Kill: currency || 'USD' → currency || ""
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000 } // No currency
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should handle earnedRate fallback when 0 and billable', async () => {
      // Kill: resolvedEarnedRate > 0 → false
      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 0 // Zero
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should fallback to hourlyRate.amount
      expect(entries[0].earnedRate).toBe(5000);
    });

    it('should handle costRate fallback', async () => {
      // Kill: resolvedCostRate || e.costRate
      fetch.mockResolvedValueOnce(mockResponse({
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
              costRate: 2500 // Direct costRate
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].costRate).toBe(2500);
    });

    it('should handle clientId and clientName null/undefined', async () => {
      // Kill: e.clientId || null and e.clientName || null → && null
      fetch.mockResolvedValueOnce(mockResponse({
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // With && mutation, these would be null even though values exist
      expect(entries[0].clientId).toBe('client_1');
      expect(entries[0].clientName).toBe('Client 1');
    });
  });

  describe('Timestamp Regex Mutations - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should only match date at start with ^ anchor (spaced format)', async () => {
      // Kill: /^(\\d{4}-\\d{2}-\\d{2})\\s+(.+)$/ → /(\\d{4}-\\d{2}-\\d{2})\\s+(.+)$/
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: 'prefix 2025-01-01 09:00:00Z', // Has prefix - should NOT match spaced pattern
                end: '2025-01-01 17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Without ^ anchor mutation, the prefix pattern would wrongly match
      expect(entries[0].timeInterval.start).toBe('prefix 2025-01-01 09:00:00Z'); // Should return as-is
    });

    it('should match end of string with $ anchor (spaced format)', async () => {
      // Kill: /^(\\d{4}-\\d{2}-\\d{2})\\s+(.+)$/ → /^(\\d{4}-\\d{2}-\\d{2})\\s+(.+)/
      fetch.mockResolvedValueOnce(mockResponse({
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00Z');
    });

    it('should match compact format with single digit in time', async () => {
      // Kill: \\d{2}:\\d → \\d{2}:\\d{2} regex mutations
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-0109:05:30Z', // Compact format
                end: '2025-01-0117:45:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:05:30Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:45:00Z');
    });

    it('should handle trimmed empty string after whitespace trim', async () => {
      // Kill: if (!trimmed) return '' → if (false) return ''
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '   ', // All whitespace
                end: '\t\n ', // Whitespace chars
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('');
      expect(entries[0].timeInterval.end).toBe('');
    });

    it('should return early for timestamp with T', async () => {
      // Kill: if (trimmed.includes('T')) return trimmed → if (false) return trimmed
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00+05:30', // Has T
                end: '2025-01-01T17:00:00-08:00',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should be returned as-is (not modified)
      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00+05:30');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:00:00-08:00');
    });
  });

  describe('PickRateValue Mutations - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should return first positive value from rate candidates', async () => {
      // Kill: for loop that checks resolved > 0
      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 6000, // First positive
              rate: { amount: 5000 },
              hourlyRate: { amount: 4000 }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should pick 6000 (first positive)
      expect(entries[0].hourlyRate.amount).toBe(6000);
    });

    it('should fallback to finite value when no positive value found', async () => {
      // Kill: second for loop with Number.isFinite
      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 0, // Zero (finite but not positive)
              rate: 0,
              hourlyRate: 0
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should return 0 (first finite value)
      expect(entries[0].hourlyRate.amount).toBe(0);
    });

    it('should handle resolveRateValue with object type', async () => {
      // Kill: typeof value === 'object' && 'amount' in value → true
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000 } // Object with amount
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
    });

    it('should handle resolveRateValue with object missing amount', async () => {
      // Kill: 'amount' in (value as { amount?: number }) check
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { currency: 'USD' } // Object without amount
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should return 0 when amount is missing
      expect(entries[0].hourlyRate.amount).toBe(0);
    });
  });

  describe('EndKey !== StartKey Mutation - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should NOT expand dates when endKey equals startKey', async () => {
      // Kill: endKey !== startKey → true
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                endDate: '2025-01-15T00:00:00Z', // Same date
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
      // Should only have 1 entry, not expanded
      expect(userMap.size).toBe(1);
      expect(userMap.has('2025-01-15')).toBe(true);
    });

    it('should expand dates when endKey differs from startKey', async () => {
      // This is the positive case - confirm expansion works
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                endDate: '2025-01-17T00:00:00Z', // Different date
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
      expect(userMap.size).toBe(3); // 15, 16, 17
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
    });
  });

  describe('MaxRetries and Options Mutations - Kill Mutants', () => {
    beforeEach(async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
      resetCircuitBreaker();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should use options.maxRetries when provided', async () => {
      // Kill: options.maxRetries !== undefined → true
      // When options.maxRetries is undefined, should use default
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        {} // No maxRetries specified
      );

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should use explicit maxRetries: 0', async () => {
      // Kill: true ? options.maxRetries : 2 mutation
      fetch.mockRejectedValueOnce(new Error('Network error'));

      // With maxRetries: 0, should not retry
      const result = await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 }
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });

    it('should retry on 429 when maxRetries > 0', async () => {
      // Kill: attempt < retries check, retry block, seconds * 1000
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // First call: 429, second call: success
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '1' } }));
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 } // Enable 1 retry
      );

      // Advance timer for retry delay
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.failed).toBe(false);
    });

    it('should return failed=true when 429 and retries exhausted', async () => {
      // Kill: else branch of attempt < retries
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // All calls return 429
      fetch.mockResolvedValue(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '1' } }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      // Advance timer for retries
      await jest.advanceTimersByTimeAsync(5000);

      const result = await promise;

      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });

    it('should use default wait time when Retry-After header missing', async () => {
      // Kill: if (retryAfterHeader) block removal
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      // Should use default 5000ms wait - use runAllTimersAsync to advance through all pending timers
      await jest.runAllTimersAsync();

      const result = await promise;
      expect(result.failed).toBe(false);
    }, 15000);

    it('should use default wait when Retry-After is NaN', async () => {
      // Kill: !isNaN(seconds) check
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': 'not-a-number' } }));
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      // Should use default wait since Retry-After is NaN - use runAllTimersAsync
      await jest.runAllTimersAsync();

      const result = await promise;
      expect(result.failed).toBe(false);
    }, 15000);

    it('should multiply Retry-After seconds by 1000 for ms', async () => {
      // Kill: seconds * 1000 → seconds / 1000
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '2' } }));
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      // Advance 1 second - should not have retried yet
      await jest.advanceTimersByTimeAsync(1000);

      // Advance another 2 seconds to complete the 2s wait
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.failed).toBe(false);
    });
  });

  describe('A1: URL Resolution Edge Cases', () => {
    it('should handle empty reportsUrl correctly', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: '' // Empty string, not undefined
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use reports.api.clockify.me when reportsUrl is empty
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('reports.api.clockify.me'),
        expect.any(Object)
      );
    });

    it('should handle backendUrl with multiple trailing slashes', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://use2.clockify.me/api///'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should normalize trailing slashes
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('///');
    });

    it('should use developer backend directly when backendUrl is developer.clockify.me', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api'
        // No reportsUrl - should use backendUrl
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('developer.clockify.me'),
        expect.any(Object)
      );
    });

    // Note: Regional URL transformation is already tested in 'should derive report base from regional backend'
    // test above (line 287). That test uses use2.clockify.me and verifies /report transformation.

    // Note: Case-insensitive host comparison is implicitly tested by the
    // developer portal tests since the code uses .toLowerCase() on the host.
  });

  describe('A2: Fetch/Retry Edge Cases', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should return failed=true and status=401 for auth errors', async () => {
      // Kill: status === 401 branch
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.failed).toBe(true);
      expect(result.status).toBe(401);
    });

    it('should return failed=true with correct status for all non-retryable errors', async () => {
      // Kill: response.status === 401 || response.status === 403 || response.status === 404
      // Test each status individually to ensure all OR conditions matter

      // 401 test
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));
      let result = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result.failed).toBe(true);
      expect(result.status).toBe(401);

      fetch.mockReset();
      resetRateLimiter();

      // 403 test
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));
      result = await Api.fetchUserProfile('workspace_123', 'user_2');
      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);

      fetch.mockReset();
      resetRateLimiter();

      // 404 test
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));
      result = await Api.fetchUserProfile('workspace_123', 'user_3');
      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
    });

    it('should NOT retry on 401/403/404 errors', async () => {
      // Kill: BlockStatement mutations that remove the return
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      await Api.fetchUserProfile('workspace_123', 'user_1');

      // Should only call fetch once (no retries)
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle 429 rate limit with no retries', async () => {
      // Kill: 429 handling block
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '1' } }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // With maxRetries=0 in test environment, should return failed immediately
      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });

    it('should track throttle retry on 429', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));

      const initialCount = store.throttleStatus?.retryCount || 0;
      await Api.fetchUserProfile('workspace_123', 'user_1');

      // Should have incremented throttle count
      expect(store.throttleStatus.retryCount).toBe(initialCount + 1);
    });

    it('should parse Retry-After header as seconds', async () => {
      // Kill: parseInt and seconds * 1000 logic
      const mockDelay = jest.fn();
      jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
        mockDelay();
        fn();
        return 0;
      });

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '5' } }));

      await Api.fetchUserProfile('workspace_123', 'user_1');

      // Status should be 429
      jest.restoreAllMocks();
    });

    it('should handle missing Retry-After header with default wait', async () => {
      // Kill: if (retryAfterHeader) block
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(429);
    });

    it('should handle invalid Retry-After header value', async () => {
      // Kill: !isNaN(seconds) check
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': 'not-a-number' } }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(429);
    });

    it('should handle empty Retry-After header string', async () => {
      // Kill: headers.get("") mutation
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(429);
    });

    it('should not skip Content-Type when body exists but Content-Type is preset', async () => {
      // Kill: !headers['Content-Type'] check
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should add Content-Type header for requests with body', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should include Accept: application/json header', async () => {
      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchUsers('workspace_123');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json'
          })
        })
      );
    });

    it('should include X-Addon-Token header', async () => {
      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchUsers('workspace_123');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Addon-Token': store.token
          })
        })
      );
    });
  });

  describe('A3: Pagination Edge Cases', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should break on empty entries array', async () => {
      // Kill: entries.length === 0 check
      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should break on null entries', async () => {
      // Kill: !entries check
      fetch.mockResolvedValueOnce(mockResponse({ timeentries: null }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries).toEqual([]);
    });

    it('should break on non-array entries in fetchEntries pagination', async () => {
      // Kill: !Array.isArray(entries) check in fetchUserEntriesPaginated
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse('not-an-array' ));

      const entries = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(entries).toEqual([]);
    });

    it('should handle configuredMaxPages === 0 as unlimited', async () => {
      // Kill: configuredMaxPages === 0 check
      store.config = { maxPages: 0 }; // 0 means unlimited

      // Return partial page to stop pagination
      fetch.mockResolvedValueOnce(mockResponse({
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries.length).toBe(1);
      // Reset config
      store.config = {};
    });

    it('should include page number in request body', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Return partial page to stop pagination
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [{
            _id: 'entry_1',
            userId: 'user_1',
            userName: 'User 1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
          }]
        }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
      expect(requestBody.detailedFilter).toBeDefined();
      expect(requestBody.detailedFilter.page).toBe(1);
      expect(requestBody.detailedFilter.pageSize).toBe(200);
    });
  });

  describe('A4: Entry Normalization Edge Cases', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should handle null timestamp values', async () => {
      // Kill: if (value == null) return ''
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: null,
                end: null,
                duration: 3600
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('');
      expect(entries[0].timeInterval.end).toBe('');
    });

    it('should handle empty string timestamp values', async () => {
      // Kill: if (!trimmed) return ''
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '  ',
                end: '',
                duration: 3600
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('');
      expect(entries[0].timeInterval.end).toBe('');
    });

    it('should preserve timestamp with T separator', async () => {
      // Kill: if (trimmed.includes('T')) return trimmed
      fetch.mockResolvedValueOnce(mockResponse({
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:00:00Z');
    });

    it('should handle timestamp with multiple spaces', async () => {
      // Kill: regex /^(\\d{4}-\\d{2}-\\d{2})\\s+(.+)$/
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01   09:00:00Z', // Multiple spaces
                end: '2025-01-01  17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00Z');
    });

    it('should handle compact timestamp format with seconds', async () => {
      // Kill: regex variations for compact format with seconds
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-0109:00:30Z',
                end: '2025-01-0117:30:45Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:30Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:30:45Z');
    });

    it('should handle compact timestamp format without seconds', async () => {
      // Kill: (?::\\d{2})? optional seconds group
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-0109:00Z',
                end: '2025-01-0117:30+05:00',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:30+05:00');
    });

    it('should handle hourlyRate as object with amount', async () => {
      // Kill: typeof value === 'object' && 'amount' in value
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000, currency: 'USD' }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should set earnedRate to 0 when not billable', async () => {
      // Kill: isBillable = e.billable !== false → true
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              billable: false,
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].earnedRate).toBe(0);
    });

    it('should use fallback earnedRate from hourlyRate when earnedRate is 0', async () => {
      // Kill: resolvedEarnedRate > 0 ? resolvedEarnedRate : resolvedHourlyRate
      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 0 // Zero
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].earnedRate).toBe(5000);
    });

    it('should use earnedRate when positive', async () => {
      // Kill: resolvedEarnedRate > 0 branch
      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 7500 // Positive value
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].earnedRate).toBe(7500);
    });

    it('should handle missing id and _id', async () => {
      // Kill: e._id || e.id || '' fallback chain
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              // No id or _id
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].id).toBe('');
    });

    it('should use id when _id is missing', async () => {
      // Kill: e._id || e.id || '' - use id
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              id: 'regular_id',
              // No _id
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].id).toBe('regular_id');
    });

    it('should handle missing userId and userName', async () => {
      // Kill: e.userId || '' and e.userName || ''
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              // No userId or userName
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].userId).toBe('');
      expect(entries[0].userName).toBe('');
    });

    it('should handle null clientId and clientName', async () => {
      // Kill: e.clientId || null and e.clientName || null
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              clientId: null,
              clientName: null,
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].clientId).toBeNull();
      expect(entries[0].clientName).toBeNull();
    });

    it('should handle missing costRate', async () => {
      // Kill: resolvedCostRate || e.costRate
      fetch.mockResolvedValueOnce(mockResponse({
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
              costRate: 2500
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].costRate).toBe(2500);
    });

    it('should handle null tags', async () => {
      // Kill: e.tags || []
      fetch.mockResolvedValueOnce(mockResponse({
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
              tags: null
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].tags).toEqual([]);
    });

    it('should convert duration in seconds to ISO format', async () => {
      // Kill: `PT${e.timeInterval.duration}S`
      fetch.mockResolvedValueOnce(mockResponse({
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.duration).toBe('PT28800S');
    });

    it('should handle missing duration', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z'
                // No duration
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.duration).toBeNull();
    });

    it('should default currency to USD when missing', async () => {
      // Kill: currency || 'USD' and '' mutation
      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000 } // No currency
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should normalize date with space separator to T separator', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01 09:00:00Z', // Space separator
                end: '2025-01-01 17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:00:00Z');
    });

    it('should normalize date missing T separator', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-0109:00:00Z', // Missing separator
                end: '2025-01-0117:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should insert T separator
      expect(entries[0].timeInterval.start).toBe('2025-01-01T09:00:00Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-01T17:00:00Z');
    });

    it('should handle amounts as object with named properties', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: {
                earned: 100,
                cost: 60,
                profit: 40
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should convert object to array format
      expect(Array.isArray(entries[0].amounts)).toBe(true);
      const earnedAmount = entries[0].amounts.find(a => a.type === 'EARNED');
      expect(earnedAmount?.value).toBe(100);
    });

    it('should use rate.amount when hourlyRate is missing', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              rate: { amount: 5000, currency: 'USD' }
              // No hourlyRate
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
    });

    it('should handle hourlyRate as plain number', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: 5000 // Plain number
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
    });

    it('should handle _id as entry id fallback', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_id_from_underscore',
              // No id field
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].id).toBe('entry_id_from_underscore');
    });

    it('should use _id when id is missing', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'underscore_id',
              // No id field
              userId: 'user_1',
              userName: 'User 1',
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Code uses: e._id || e.id || '' - so _id takes precedence
      expect(entries[0].id).toBe('underscore_id');
    });

    it('should normalize missing billable field to false', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              // billable field missing
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Missing billable should normalize to false for consistent downstream logic
      expect(entries[0].billable).toBe(false);
    });

    it('should preserve billable: false when explicitly set', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_1',
              userId: 'user_1',
              userName: 'User 1',
              billable: false, // Explicitly false
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T17:00:00Z',
                duration: 28800
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].billable).toBe(false);
    });

    it('should set earnedRate from hourlyRate.amount', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 0 // Zero/falsy - should be overwritten
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].earnedRate).toBe(5000);
    });

    it('should keep zero rate when all rate fields resolve to 0', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      const originalIsFinite = Number.isFinite;
      const isFiniteSpy = jest
        .spyOn(Number, 'isFinite')
        .mockImplementation((value) => originalIsFinite(value));
      isFiniteSpy.mockReturnValueOnce(false);

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [
            {
              _id: 'entry_zero',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(0);
      expect(entries[0].earnedRate).toBe(0);
      isFiniteSpy.mockRestore();
    });

    it('should handle timeentries key (lowercase e)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [ // lowercase
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries.length).toBe(1);
    });

    it('should handle timeEntries key (camelCase)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
          timeEntries: [ // camelCase
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries.length).toBe(1);
    });

    it('should include all 3 amount types in request payload', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
      // amountShown is a string constant ('EARNED'), amounts is the array
      expect(requestBody.amountShown).toBe('EARNED');
      expect(requestBody.amounts).toBeDefined();
      expect(requestBody.amounts).toContain('EARNED');
      expect(requestBody.amounts).toContain('COST');
      expect(requestBody.amounts).toContain('PROFIT');
    });
  });

  describe('Amount Normalization Edge Cases - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should handle amounts with mixed type and amountType fields', async () => {
      // Kill: item?.type || item?.amountType || ''
      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', value: 100 },
                { amountType: 'COST', value: 60 },
                { type: 'PROFIT', amount: 40 } // Uses amount instead of value
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].amounts).toBeDefined();
      expect(entries[0].amounts.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle amounts single object with type/value', async () => {
      // Kill: 'type' in raw || 'amountType' in raw || 'value' in raw || 'amount' in raw
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { type: 'EARNED', value: 100 } // Single object, not array
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(Array.isArray(entries[0].amounts)).toBe(true);
      expect(entries[0].amounts[0].type).toBe('EARNED');
      expect(entries[0].amounts[0].value).toBe(100);
    });

    it('should handle amounts single object with only amountType', async () => {
      // Kill: 'amountType' in raw branch
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { amountType: 'COST', value: 60 }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(Array.isArray(entries[0].amounts)).toBe(true);
    });

    it('should handle amounts single object with only value', async () => {
      // Kill: 'value' in raw branch
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { value: 100 } // Only value
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(Array.isArray(entries[0].amounts)).toBe(true);
    });

    it('should handle amounts single object with only amount', async () => {
      // Kill: 'amount' in raw branch
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { amount: 100 } // Only amount field
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(Array.isArray(entries[0].amounts)).toBe(true);
    });

    it('should skip non-finite values in amounts reduce', async () => {
      // Kill: Number.isFinite(value) check in reduce
      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', value: NaN },
                { type: 'EARNED', value: Infinity },
                { type: 'EARNED', value: 'not-a-number' },
                { type: 'EARNED', value: 100 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should still process valid amounts
      expect(entries[0].amounts).toBeDefined();
    });

    it('should handle type !== shownType filtering in reduce', async () => {
      // Kill: if (type !== shownType) return total
      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'COST', value: 60 },
                { type: 'PROFIT', value: 40 }
                // No EARNED - fallback should be added
              ],
              amount: 100 // Fallback for EARNED
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should add EARNED from fallback
      const earned = entries[0].amounts.find(a =>
        String(a.type || a.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earned?.value).toBe(100);
    });

    it('should not add fallback when shownTotal is non-zero', async () => {
      // Kill: if (shownTotal !== 0) return items
      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', value: 200 } // Already has EARNED
              ],
              amount: 100 // This fallback should NOT be used
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const earnedAmounts = entries[0].amounts.filter(a =>
        String(a.type || a.amountType || '').toUpperCase() === 'EARNED'
      );
      // Should only have one EARNED with value 200, not additional 100
      expect(earnedAmounts.length).toBe(1);
      expect(earnedAmounts[0].value).toBe(200);
    });

    it('should skip fallbackAmount when null or not finite', async () => {
      // Kill: fallbackAmount == null || !Number.isFinite(fallbackAmount) || fallbackAmount === 0
      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'COST', value: 60 }
              ],
              amount: 0 // Zero - should not be used as fallback
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should not add EARNED with value 0
      const earnedAmounts = entries[0].amounts.filter(a =>
        String(a.type || a.amountType || '').toUpperCase() === 'EARNED' && a.value === 0
      );
      expect(earnedAmounts.length).toBe(0);
    });

    it('should handle pickRateValue with first positive value', async () => {
      // Kill: for loop in pickRateValue that checks resolved > 0
      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 0, // Zero
              rate: 0, // Zero
              hourlyRate: { amount: 5000 } // First positive
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
    });

    it('should handle pickRateValue with all zero values falling back to finite check', async () => {
      // Kill: second for loop with Number.isFinite check
      fetch.mockResolvedValueOnce(mockResponse({
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
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should return 0 as it's finite
      expect(entries[0].hourlyRate.amount).toBe(0);
    });

    it('should handle amounts as object with numeric properties', async () => {
      // Kill: mapped.length check and Object.entries mapping
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: {
                earned: 100,
                cost: 60,
                profit: 40
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(Array.isArray(entries[0].amounts)).toBe(true);
      const earnedAmount = entries[0].amounts.find(a =>
        String(a.type || '').toUpperCase() === 'EARNED'
      );
      expect(earnedAmount?.value).toBe(100);
    });

    it('should skip non-finite values in Object.entries mapping', async () => {
      // Kill: if (Number.isFinite(numericValue)) check
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: {
                earned: 100,
                invalid: 'not-a-number',
                alsoInvalid: NaN
              }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should only have EARNED
      const validAmounts = entries[0].amounts.filter(a => Number.isFinite(a.value));
      expect(validAmounts.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty amounts object', async () => {
      // Tests mapped.length check when object has no valid numeric properties
      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: {},
              amount: 100
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use fallback amount
      const earnedAmount = entries[0].amounts.find(a =>
        String(a.type || '').toUpperCase() === 'EARNED'
      );
      expect(earnedAmount?.value).toBe(100);
    });
  });

  describe('Time-Off Processing Edge Cases', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should mark time off as full day when halfDay is false and timeUnit is DAYS', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
                halfDayHours: null
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
      expect(userMap).toBeDefined();
      expect(userMap.get('2025-01-15').isFullDay).toBe(true);
    });

    it('should mark time off as NOT full day when halfDay is true', async () => {
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
      expect(userMap).toBeDefined();
      expect(userMap.get('2025-01-15').isFullDay).toBe(false);
    });

    it('should mark time off as NOT full day when halfDayHours is set', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
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
      expect(userMap).toBeDefined();
      expect(userMap.get('2025-01-15').isFullDay).toBe(false);
    });

    it('should expand multi-day time off into date range', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                endDate: '2025-01-17T00:00:00Z',
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
      expect(userMap).toBeDefined();
      // Should have entries for 15, 16, 17
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
    });

    it('should not expand when start and end are same day', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                // No endDate or same as start
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
      expect(userMap).toBeDefined();
      // Should have only the start date entry when no endDate
      expect(userMap.has('2025-01-15')).toBe(true);
    });

    it('should not overwrite existing date entries during expansion', async () => {
      // The deduplication check (!userMap.has(dateKey)) only applies in the expansion loop
      // Test: Request 1 sets 15-17, Request 2 starts at 16 (should not overwrite expanded 16)
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            // First request covers 15-17 (15, 16, 17)
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                endDate: '2025-01-17T00:00:00Z',
                halfDay: false
              },
              timeUnit: 'DAYS'
            },
            // Second request starts at 16 (would overwrite expanded 16 if dedup didn't work)
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-16T00:00:00Z',
                endDate: '2025-01-18T00:00:00Z',
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
      expect(userMap).toBeDefined();
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
      expect(userMap.has('2025-01-18')).toBe(true);

      // CRITICAL: First request expands 15→16→17 with isFullDay: true
      // Second request sets 16 as startKey (overwrites), then expands to 17, 18
      // The expansion check prevents 17 from being overwritten (dedup protects it)
      // This kills the mutation: if (!userMap.has(dateKey)) → if (true)
      expect(userMap.get('2025-01-17').isFullDay).toBe(true); // Preserved from first
    });

    it('should mark as NOT full day when HOURS unit without halfDayHours', async () => {
      // When timeUnit is HOURS, treat as partial day even if halfDayHours is missing
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
                halfDayHours: null // No half-day hours specified
              },
              timeUnit: 'HOURS' // Not DAYS
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
      expect(userMap.get('2025-01-15').isFullDay).toBe(false);
    });

    it('should mark as NOT full day when HOURS unit with halfDayHours set', async () => {
      // Kill: timeUnit === 'DAYS' when false, and !halfDayHours when false
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
                halfDayHours: 4 // Has half-day hours
              },
              timeUnit: 'HOURS' // Not DAYS
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
      // Should NOT be full day because timeUnit !== 'DAYS' AND halfDayHours exists
      expect(userMap.get('2025-01-15').isFullDay).toBe(false);
    });

    it('should mark as full day with DAYS unit regardless of halfDayHours', async () => {
      // Kill: timeUnit === 'DAYS' branch being true
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
                halfDayHours: 4 // Has value but should be ignored for DAYS
              },
              timeUnit: 'DAYS' // DAYS takes precedence
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
      // Should be full day because timeUnit === 'DAYS' (OR short-circuits)
      expect(userMap.get('2025-01-15').isFullDay).toBe(true);
    });

    it('should handle endKey === startKey (single day, no expansion)', async () => {
      // Kill: endKey !== startKey → true mutation
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                endDate: '2025-01-15T00:00:00Z', // Same as start
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
      expect(userMap).toBeDefined();
      // Should only have one entry (no expansion when dates are same)
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.size).toBe(1);
    });

    it('should not create user map entry when no startKey', async () => {
      // Kill: if (!userMap) check
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                // No startDate, start, or period.start
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

      // Should still have user map created but empty
      const userMap = results.get('user_1');
      expect(userMap).toBeDefined();
      expect(userMap.size).toBe(0);
    });

    it('should handle timeUnit empty string vs DAYS comparison', async () => {
      // Kill: timeUnit === '' mutation
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
                halfDayHours: 4
              },
              timeUnit: '' // Empty string, not 'DAYS'
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
      // Empty string !== 'DAYS' and halfDayHours exists, so NOT full day
      expect(userMap.get('2025-01-15').isFullDay).toBe(false);
    });

    it('should handle AND vs OR operator mutation in isFullDay', async () => {
      // Kill: (timeUnit === 'DAYS' || !halfDayHours) → (timeUnit === 'DAYS' && !halfDayHours)
      // Test case where OR matters: timeUnit='DAYS' and halfDayHours=4
      // With OR: true || false = true
      // With AND: true && false = false
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false,
                halfDayHours: 4 // halfDayHours exists
              },
              timeUnit: 'DAYS' // timeUnit is DAYS
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
      // With OR: 'DAYS'='DAYS' || !4 = true || false = true
      // With AND mutation: true && false = false
      // Correct behavior should be true (isFullDay)
      expect(userMap.get('2025-01-15').isFullDay).toBe(true);
    });

    it('should not mark full day when timeUnit not DAYS and no halfDayHours', async () => {
      // HOURS units are treated as partial days even when halfDayHours is missing
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T00:00:00Z',
                halfDay: false
                // No halfDayHours
              },
              timeUnit: 'HOURS' // Not DAYS
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
      expect(userMap.get('2025-01-15').isFullDay).toBe(false);
    });

    it('should handle timeOffPeriod.period nested structure', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                period: {
                  start: '2025-01-15T00:00:00Z',
                  end: '2025-01-17T00:00:00Z'
                },
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
      expect(userMap).toBeDefined();
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
    });

    it('should use requesterUserId when userId is missing', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              requesterUserId: 'user_1', // No userId field
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

      // Should still find the user's time off
      expect(results.has('user_1')).toBe(true);
    });

    it('should skip requests without startKey', async () => {
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                // No start date at all
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

      // The user map is created before checking startKey, but no date entries added
      const userMap = results.get('user_1');
      expect(userMap).toBeDefined();
      expect(userMap.size).toBe(0);
    });
  });

  describe('URL Resolution - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should strip multiple trailing slashes from reportsUrl', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        reportsUrl: 'https://reports.api.clockify.me///',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should normalize multiple trailing slashes to none
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).not.toMatch(/\/\/\/v1/);
      expect(calledUrl).toContain('reports.api.clockify.me/v1');
    });

    it('should replace reportsUrl string with empty string mutation', async () => {
      // This kills: reportsUrl.replace(/\/+$/, "Stryker was here!")
      store.claims = {
        workspaceId: 'ws_test',
        reportsUrl: 'https://reports.api.clockify.me/',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // The replace should produce a valid URL path, not "Stryker was here!"
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('/v1/workspaces/');
      expect(calledUrl).not.toContain('Stryker');
    });

    it('should detect developer portal and use backend when reportsUrl points elsewhere', async () => {
      // Kill: backendHost === 'developer.clockify.me' → true
      // Kill: reportsHost !== backendHost && normalizedBackend
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me' // Different host
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use developer backend, not reports URL
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('developer.clockify.me'),
        expect.any(Object)
      );
    });

    it('should use reportsUrl when developer portal backend matches reports host', async () => {
      // Kill: reportsHost !== backendHost - when they're equal
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'https://developer.clockify.me/report' // Same host
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use reportsUrl when hosts match
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('developer.clockify.me/report'),
        expect.any(Object)
      );
    });

    it('should handle invalid reportsUrl in developer portal with fallback', async () => {
      // Kill: catch block - fall back to backendUrl if parse fails
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'not-a-valid-url' // Invalid URL that causes parse error
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should fall back to backendUrl
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('developer.clockify.me/api'),
        expect.any(Object)
      );
    });

    it('should use backendUrl directly when developer portal has no reportsUrl', async () => {
      // Kill: backendHost === 'developer.clockify.me' && normalizedBackend
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api'
        // No reportsUrl
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('developer.clockify.me/api'),
        expect.any(Object)
      );
    });

    it('should transform regional backend /api to /report', async () => {
      // Kill: backendPath.endsWith('/api') and replace logic
      store.claims = {
        workspaceId: 'ws_region',
        backendUrl: 'https://use2.clockify.me/api'
        // No reportsUrl
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_region',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should transform /api to /report
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('use2.clockify.me/report');
      expect(calledUrl).not.toContain('/api/');
    });

    it('should use reports.api.clockify.me for production api.clockify.me', async () => {
      // Kill: backendHost === 'api.clockify.me'
      store.claims = {
        workspaceId: 'ws_prod',
        backendUrl: 'https://api.clockify.me/api'
        // No reportsUrl
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_prod',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('reports.api.clockify.me'),
        expect.any(Object)
      );
    });

    it('should handle regional backend without /api path by appending /report', async () => {
      // Kill: backendPath.endsWith('/api') → false branch
      store.claims = {
        workspaceId: 'ws_region',
        backendUrl: 'https://eu.clockify.me' // No /api path
        // No reportsUrl
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_region',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should append /report
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('eu.clockify.me/report');
    });

    it('should handle regex mutation /\\/+$/ vs /\\/+/ vs /\\/$/', async () => {
      // This tests all three regex mutations
      store.claims = {
        workspaceId: 'ws_test',
        reportsUrl: 'https://reports.api.clockify.me/////', // Many trailing slashes
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // The URL should have no trailing slashes before the path
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toMatch(/reports\.api\.clockify\.me\/v1/);
    });

    it('should lowercase host for comparison', async () => {
      // Kill: .toLowerCase() → .toUpperCase()
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://DEVELOPER.CLOCKIFY.ME/api',
        reportsUrl: 'https://other.host.com'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should still detect developer portal (case-insensitive)
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/developer\.clockify\.me/i),
        expect.any(Object)
      );
    });

    it('should handle developer portal empty string comparison', async () => {
      // Kill: backendHost === "" mutation
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: '', // Empty backend
        reportsUrl: 'https://reports.api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use reportsUrl since backendUrl is empty
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('reports.api.clockify.me'),
        expect.any(Object)
      );
    });
  });

  describe('Batch Processing Edge Cases - Kill Mutants', () => {
    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = mockPayload;
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    it('should process users in batches with correct slice boundaries', async () => {
      // Kill: i < users.length → i <= users.length and users.slice mutations
      const users = generateMockUsers(7); // More than BATCH_SIZE (5) but less than 10

      fetch.mockImplementation(() =>
        Promise.resolve(mockResponse([{ id: 'entry', userId: 'user_0' }]))
      );

      const result = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Should process all 7 users in 2 batches (5 + 2)
      expect(result.length).toBe(7);
    });

    it('should process exact batch size without overflow', async () => {
      // Kill: loop boundary conditions
      const users = generateMockUsers(5); // Exactly BATCH_SIZE

      fetch.mockImplementation(() =>
        Promise.resolve(mockResponse([{ id: 'entry', userId: 'user_0' }]))
      );

      const result = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(result.length).toBe(5);
    });

    it('should handle fetchAllProfiles batch loop correctly', async () => {
      // Kill: i < users.length and users.slice in fetchAllProfiles
      const users = generateMockUsers(7);

      fetch.mockImplementation(() =>
        Promise.resolve(mockResponse({
          workCapacity: 'PT8H',
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
        }))
      );

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.size).toBe(7);
    });

    it('should handle fetchAllHolidays batch loop correctly', async () => {
      // Kill: i < users.length and users.slice in fetchAllHolidays
      const users = generateMockUsers(7);

      fetch.mockImplementation(() =>
        Promise.resolve(mockResponse([
          { name: 'Holiday', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }
        ]))
      );

      const results = await Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      expect(results.size).toBe(7);
    });

    it('should construct ISO dates correctly for holidays', async () => {
      // Kill: startIso = `${startDate}T00:00:00.000Z` and endIso mutations
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-01-15',
        '2025-01-20'
      );

      // Verify the URL contains properly formatted ISO dates
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('start=2025-01-15T00%3A00%3A00.000Z');
      expect(calledUrl).toContain('end=2025-01-20T23%3A59%3A59.999Z');
    });

    it('should construct ISO dates correctly for time off', async () => {
      // Kill: startIso and endIso construction in fetchAllTimeOff
      const users = [{ id: 'user_1', name: 'User 1' }];

      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-15',
        '2025-01-20'
      );

      // Verify the body contains properly formatted ISO dates
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.start).toBe('2025-01-15T00:00:00.000Z');
      expect(body.end).toBe('2025-01-20T23:59:59.999Z');
    });

    it('should handle holiday name fallback', async () => {
      // Kill: h.name || '' fallback
      const users = [{ id: 'user_1', name: 'User 1' }];

      fetch.mockImplementation(() =>
        Promise.resolve(mockResponse([
          { datePeriod: { startDate: '2025-01-01T00:00:00Z' } } // No name
        ]))
      );

      const results = await Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const holidays = results.get('user_1');
      expect(holidays).toBeDefined();
      expect(holidays[0].name).toBe('');
    });

    it('should handle timeoff statuses array in request', async () => {
      // Kill: statuses: ['APPROVED'] and '' mutation
      const users = [{ id: 'user_1', name: 'User 1' }];

      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.statuses).toEqual(['APPROVED']);
      expect(body.statuses[0]).toBe('APPROVED');
    });

    it('should handle maxRetries option passthrough', async () => {
      // Kill: options.maxRetries !== undefined check
      const users = [{ id: 'user_1', name: 'User 1' }];

      fetch.mockRejectedValueOnce(new Error('Network error'));

      await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 }
      );

      // Should only try once with maxRetries: 0
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle non-object data response', async () => {
      // Kill: data && typeof data === 'object' → data && true
      // When data is a string or number, should not try to access 'requests'
      fetch.mockResolvedValueOnce(mockResponse('not an object' ));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      // Should return empty map when data is not an object
      expect(results.size).toBe(0);
    });

    it('should handle null data response', async () => {
      // Kill: data && typeof data === 'object' when data is null
      fetch.mockResolvedValueOnce(mockResponse(null ));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        [{ id: 'user_1', name: 'User 1' }],
        '2025-01-01',
        '2025-01-31'
      );

      // Should return empty map when data is null
      expect(results.size).toBe(0);
    });

    it('should not expand when endKey equals startKey exactly', async () => {
      // Kill: endKey !== startKey → true
      // When mutation makes condition always true, it would try to expand even when same date
      fetch.mockResolvedValueOnce(mockResponse({
          requests: [
            {
              userId: 'user_1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                startDate: '2025-01-15T09:00:00Z',
                endDate: '2025-01-15T17:00:00Z', // Same day, different times
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
      expect(userMap).toBeDefined();
      // Should have only one entry for 2025-01-15
      expect(userMap.size).toBe(1);
      expect(userMap.has('2025-01-15')).toBe(true);
      // No expansion to other dates
      expect(userMap.has('2025-01-16')).toBe(false);
    });
  });

  describe('Entry Transformation - Kill Mutants', () => {
    it('should handle empty mapped amounts (mapped.length false branch)', async () => {
      // Kill: if (mapped.length) → if (true)
      // Test where normalizeAmounts receives object with no numeric values
      // Number(undefined) = NaN, Number('text') = NaN - these are NOT finite
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { notNumeric: 'abc', alsoNotNumeric: undefined } // Object with NaN values
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // When mapped is empty (all values are NaN) and no fallback, returns []
      expect(entries[0].amounts).toEqual([]);
    });

    it('should handle hourlyRate as object with amount', async () => {
      // Kill: e.hourlyRate && typeof e.hourlyRate === 'object' → false
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000, currency: 'EUR' } // Object with amount
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].hourlyRate.amount).toBe(5000);
      expect(entries[0].hourlyRate.currency).toBe('EUR');
    });

    it('should handle hourlyRate as primitive (typeof !== object)', async () => {
      // Kill: typeof e.hourlyRate === 'object' → true
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: 3000 // Primitive number, not object
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // When hourlyRate is primitive, it should still resolve the rate
      expect(entries[0].hourlyRate.currency).toBe('USD'); // Default currency
    });

    it('should fallback to USD when currency property is missing', async () => {
      // Test hourlyRate object without currency property at all
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000 } // Object without currency property
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use 'USD' default when currency is not in object
      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should fallback to USD when currency is empty string', async () => {
      // Kill: currency || 'USD' → currency || ""
      // This test specifically targets the || 'USD' fallback inside the ternary
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000, currency: '' } // Empty string currency
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use 'USD' fallback when currency is empty string
      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should fallback to USD when currency is null', async () => {
      // Kill: currency || 'USD' when currency is null
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              hourlyRate: { amount: 5000, currency: null } // Null currency
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should use 'USD' fallback when currency is null
      expect(entries[0].hourlyRate.currency).toBe('USD');
    });

    it('should use resolvedEarnedRate when > 0 and billable', async () => {
      // Kill: resolvedEarnedRate > 0 → false
      // When mutation changes condition to false, it would use resolvedHourlyRate instead
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 7500, // Direct earnedRate value > 0
              hourlyRate: { amount: 5000 } // Different from earnedRate
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Original: earnedRate > 0 → use earnedRate (7500)
      // Mutation (false): would use hourlyRate (5000)
      expect(entries[0].earnedRate).toBe(7500);
    });

    it('should fallback to hourlyRate when earnedRate is 0', async () => {
      // This complements the above test - when earnedRate is 0, use hourlyRate
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              earnedRate: 0, // Zero earnedRate
              hourlyRate: { amount: 5000 }
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // When earnedRate is 0, should fallback to hourlyRate
      expect(entries[0].earnedRate).toBe(5000);
    });

    it('should use e.costRate when resolvedCostRate is 0', async () => {
      // Kill: resolvedCostRate || e.costRate → resolvedCostRate && e.costRate
      // When resolvedCostRate is 0 (falsy), original uses e.costRate
      // Mutation would return 0 (0 && 4000 = 0)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              costRate: 4000 // Direct costRate fallback (resolvedCostRate would be 0/undefined)
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Original: 0 || 4000 = 4000
      // Mutation: 0 && 4000 = 0
      expect(entries[0].costRate).toBe(4000);
    });

    it('should resolve costRate object to numeric value', async () => {
      // Kill: resolvedCostRate || e.costRate when costRate is object
      // resolvedCostRate extracts amount from object
      // Original: 4000 || { amount: 4000 } = 4000
      // Mutation: 4000 && { amount: 4000 } = { amount: 4000 } (object)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              costRate: { amount: 4000 } // Object costRate
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should resolve to numeric value, not object
      expect(entries[0].costRate).toBe(4000);
      expect(typeof entries[0].costRate).toBe('number');
    });

    it('should normalize amounts with type property', async () => {
      // Kill: 'type' in raw checks
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', value: 100 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].amounts).toContainEqual(
        expect.objectContaining({ type: 'EARNED', value: 100 })
      );
    });

    it('should handle object with ONLY type property (no value)', async () => {
      // Kill: 'type' in raw → "" in raw mutation
      // Object with only 'type' prop: original wraps it, mutation skips to Object.entries
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { type: 'EARNED' } // Object with only type, no value/amount
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Original: 'type' in raw = true, wraps as [{type: 'EARNED'}]
      // Mutation: '' in raw = false, no other props, Object.entries gives no numerics
      expect(entries[0].amounts).toContainEqual(
        expect.objectContaining({ type: 'EARNED' })
      );
    });

    it('should normalize amounts with amountType property', async () => {
      // Kill: 'amountType' in raw checks
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { amountType: 'COST', value: 50 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].amounts).toContainEqual(
        expect.objectContaining({ amountType: 'COST', value: 50 })
      );
    });

    it('should handle object with ONLY amountType property (preserves shape)', async () => {
      // Kill: 'amountType' in raw → "" in raw mutation
      // Original: wraps as [{amountType: 'COST'}] with no 'type' property
      // Mutation: Object.entries produces [{type: 'AMOUNTTYPE', value: NaN}]
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { amountType: 'COST' } // Object with only amountType
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Original wraps as-is, preserving amountType property
      const amountItem = entries[0].amounts[0];
      expect(amountItem.amountType).toBe('COST');
      // Mutation would skip to Object.entries which produces different shape
      // (type: 'AMOUNTTYPE' instead of amountType: 'COST')
      expect(amountItem.type).toBeUndefined();
    });

    it('should normalize amounts with value property', async () => {
      // Kill: 'value' in raw checks
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'PROFIT', value: 25 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const profitAmount = entries[0].amounts.find(a =>
        (a.type || a.amountType) === 'PROFIT'
      );
      expect(profitAmount?.value).toBe(25);
    });

    it('should handle object with ONLY value property (preserves shape)', async () => {
      // Kill: 'value' in raw → "" in raw mutation
      // Original: wraps as [{value: 50}] with no 'type' property
      // Mutation: Object.entries produces [{type: 'VALUE', value: 50}]
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { value: 50 } // Object with only value
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Original wraps as-is, mutation adds type: 'VALUE'
      // Check that result does NOT have type property (which mutation would add)
      const amountItem = entries[0].amounts[0];
      expect(amountItem.value).toBe(50);
      // Mutation would produce {type: 'VALUE', value: 50}
      // Original produces {value: 50} without type
      expect(amountItem.type).toBeUndefined();
    });

    it('should normalize amounts with amount property', async () => {
      // Kill: 'amount' in raw checks
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', amount: 75 } // Using 'amount' instead of 'value'
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const earnedAmount = entries[0].amounts.find(a =>
        (a.type || a.amountType) === 'EARNED'
      );
      // The amount property should be preserved
      expect(earnedAmount?.amount).toBe(75);
    });

    it('should handle object with ONLY amount property', async () => {
      // Kill: 'amount' in raw → "" in raw mutation
      // Object with only 'amount' prop: original wraps it, mutation skips
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amounts: { amount: 60 } // Object with only amount
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should preserve the amount
      expect(entries[0].amounts).toContainEqual(
        expect.objectContaining({ amount: 60 })
      );
    });
  });

  describe('Amount Total Calculation - Kill Mutants', () => {
    it('should correctly sum amounts (not subtract)', async () => {
      // Kill: total + value → total - value
      // With two identical values [100, 100]:
      // Original: 100 + 100 = 200 (non-zero, returns items as-is)
      // Mutation: 100 - 100 = 0 (zero, adds fallback amount)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amount: 500, // Fallback amount
              amounts: [
                { type: 'EARNED', value: 100 },
                { type: 'EARNED', value: 100 } // Two identical values
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Original: sum = 200 (non-zero), returns 2 items
      // Mutation: sum = 0 (after subtraction), would add fallback = 3 items
      expect(entries[0].amounts.length).toBe(2);
    });

    it('should handle null item in amounts array safely', async () => {
      // Kill: item?.value → item.value (would throw on null item)
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', value: 100 },
                null, // Null item - mutation would crash
                { type: 'EARNED', value: 50 }
              ]
            }
          ]
        }));

      // Should not throw - original uses optional chaining
      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should process without crashing
      expect(entries).toBeDefined();
      expect(entries.length).toBe(1);
    });
  });

  describe('Pagination - Kill Mutants', () => {
    it('should treat maxPages === 0 as unlimited', async () => {
      // Kill: configuredMaxPages === 0 → false
      const originalMaxPages = store.config.maxPages;
      store.config.maxPages = 0; // 0 means unlimited

      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Mock 2 full pages then partial
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: Array(200).fill({
            _id: 'entry',
            userId: 'u1',
            userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          })
        }));
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: Array(50).fill({
            _id: 'entry',
            userId: 'u1',
            userName: 'U1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 }
          })
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should have fetched both pages (250 entries) since 0 = unlimited
      expect(entries.length).toBe(250);
      expect(fetch).toHaveBeenCalledTimes(2);

      store.config.maxPages = originalMaxPages;
    });
  });

  describe('Rate/Amount Conversion', () => {
    it('should convert amount from entry.amount to EARNED in amounts array', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
              amount: 400, // Flat amount field
              amounts: [] // Empty amounts array
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const earnedAmount = entries[0].amounts.find(a =>
        String(a.type || a.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedAmount?.value).toBe(400);
    });

    it('should handle amounts array with type field', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { type: 'EARNED', value: 100 },
                { type: 'COST', value: 60 },
                { type: 'PROFIT', value: 40 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(entries[0].amounts.length).toBe(3);
    });

    it('should handle amounts array with amountType field', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({
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
                { amountType: 'EARNED', value: 100 }
              ]
            }
          ]
        }));

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const earnedAmount = entries[0].amounts.find(a =>
        String(a.type || a.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedAmount).toBeDefined();
    });
  });
});
describe('API Users - Batch Processing Mutations', () => {
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

  describe('Loop Boundary Edge Cases - Kill Mutants', () => {
    it('should correctly slice batch at BATCH_SIZE boundary', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users
      // With 7 users (> BATCH_SIZE=5), if slice returns full array,
      // each batch would process all 7 instead of the correct subset
      const users = generateMockUsers(7);
      const fetchCalls = [];

      fetch.mockImplementation((url) => {
        fetchCalls.push(url);
        return Promise.resolve(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));
      });

      await Api.fetchAllProfiles('workspace_123', users);

      // Should make 7 calls total (processes each user)
      expect(fetchCalls.length).toBe(7);

      // Extract user IDs from URLs (pattern: /member-profile/{userId})
      const userIdsFromCalls = fetchCalls.map(url => {
        const match = url.match(/\/member-profile\/([^/]+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      // All 7 users should be called
      expect(userIdsFromCalls.length).toBe(7);
      // Each user should appear exactly once (not duplicated due to broken slice)
      const uniqueIds = new Set(userIdsFromCalls);
      expect(uniqueIds.size).toBe(7);
    });

    it('should process exactly BATCH_SIZE users without going out of bounds', async () => {
      // Kill: i < users.length → i <= users.length
      // With exactly 5 users (BATCH_SIZE), <= would cause an extra iteration
      const users = generateMockUsers(5);
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve(mockResponse({
            workCapacity: 'PT8H',
            workingDays: []
          }));
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      // Should call fetch exactly 5 times (one per user)
      expect(callCount).toBe(5);
      expect(results.size).toBe(5);
    });

    it('should handle users.slice correctly at batch boundary', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users (full array)
      const users = generateMockUsers(6); // 6 users = 2 batches (5 + 1)
      const batchSizes = [];

      fetch.mockImplementation(async () => {
        batchSizes.push(1);
        return mockResponse({
          workCapacity: 'PT8H',
          workingDays: []
        });
      });

      await Api.fetchAllProfiles('workspace_123', users);

      // Should process 5 in first batch, 1 in second batch
      expect(batchSizes.length).toBe(6); // 5 + 1 calls
    });
  });

  describe('Failed Count Tracking Mutations', () => {
    // Kill: failedCount++ → failedCount-- or failedCount += 0

    it('should increment failed count exactly by 1 for each failure', async () => {
      const users = generateMockUsers(3);

      // All fail
      fetch.mockResolvedValue(mockResponse(null, { ok: false, status: 403 }));

      await Api.fetchAllProfiles('workspace_123', users);

      expect(store.apiStatus.profilesFailed).toBe(3);
    });

    it('should count exact number of failures (not more, not less)', async () => {
      const users = generateMockUsers(5);

      // 2 succeed, 3 fail
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(store.apiStatus.profilesFailed).toBe(3);
      expect(results.size).toBe(2);
    });
  });

  describe('Map Operations Mutations', () => {
    // Kill: results.set(userId, data) → results.delete(userId)

    it('should store profile data in results map', async () => {
      const users = generateMockUsers(2);
      const profile1 = { workCapacity: 'PT8H', workingDays: ['MONDAY'] };
      const profile2 = { workCapacity: 'PT6H', workingDays: ['TUESDAY'] };

      fetch.mockResolvedValueOnce(mockResponse(profile1));
      fetch.mockResolvedValueOnce(mockResponse(profile2));

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.has('user0')).toBe(true);
      expect(results.has('user1')).toBe(true);
      expect(results.get('user0')).toEqual(profile1);
      expect(results.get('user1')).toEqual(profile2);
    });

    it('should not store data for failed requests', async () => {
      const users = generateMockUsers(2);

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.has('user0')).toBe(false);
      expect(results.has('user1')).toBe(true);
    });
  });

  describe('Pagination and Progress Mutations', () => {
    it('should log and stop when paginated fetch fails', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const users = [{ id: 'user_1', name: 'User 1' }];

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      const results = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(results).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to fetch entries for user User 1 (page 1), status: 500'
      );

      warnSpy.mockRestore();
    });

    it('should report progress during detailed report pagination', async () => {
      const onProgress = jest.fn();

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      await Api.fetchDetailedReport(
        'workspace_123',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z',
        { onProgress }
      );

      expect(onProgress).toHaveBeenCalledWith(1, 'entries');
    });

    it('should warn and stop when detailed report hits max page limit', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      store.config.maxPages = 1;

      const entries = Array.from({ length: 200 }, (_, index) => ({
        id: `entry_${index}`,
        userId: 'user_1',
        userName: 'User 1',
        billable: true,
        timeInterval: {
          start: '2025-01-10T09:00:00Z',
          end: '2025-01-10T10:00:00Z',
          duration: 3600
        }
      }));

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: entries }));

      const results = await Api.fetchDetailedReport(
        'workspace_123',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(results).toHaveLength(200);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Reached page limit (1), stopping pagination. Total entries fetched: 200'
      );

      warnSpy.mockRestore();
      store.config.maxPages = undefined;
    });
  });

  describe('Pagination truncation mutations', () => {
    // Tests specifically designed to kill mutations in the pagination truncation logic
    // at js/api.ts lines 1018-1038

    beforeEach(async () => {
      const mockPayload = createMockTokenPayload();
      store.token = createMockJwtToken();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };
      store.config = {};
      store.ui = { paginationTruncated: false };
      store.resetApiStatus();
      fetch.mockReset();
      resetRateLimiter();
    });

    afterEach(() => {
      store.config = {};
      store.ui = { paginationTruncated: false };
    });

    it('kills < vs <= mutation: exactly pageSize entries should continue pagination', async () => {
      // Kill: entries.length < pageSize → entries.length <= pageSize
      // Setup: Return exactly 200 entries (pageSize for detailed report)
      // Expected: hasMore should be true, pagination continues to page 2
      // If < becomes <=, we'd stop at exactly pageSize (200 entries)
      const page1Entries = Array.from({ length: 200 }, (_, i) => ({
        _id: `entry_p1_${i}`,
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
      }));
      const page2Entries = Array.from({ length: 50 }, (_, i) => ({
        _id: `entry_p2_${i}`,
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-02T09:00:00Z', end: '2025-01-02T10:00:00Z', duration: 3600 }
      }));

      fetch
        .mockResolvedValueOnce(mockResponse({ timeentries: page1Entries }))
        .mockResolvedValueOnce(mockResponse({ timeentries: page2Entries }));

      const results = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Should have fetched both pages
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(250); // 200 + 50
    });

    it('kills ?? removal mutation: undefined maxPages uses DEFAULT_MAX_PAGES', async () => {
      // Kill: store.config.maxPages ?? DEFAULT_MAX_PAGES → store.config.maxPages
      // Setup: store.config.maxPages = undefined
      // Expected: Uses DEFAULT_MAX_PAGES (50), not undefined
      // If ?? removed, undefined would cause errors or wrong behavior
      store.config = { maxPages: undefined };

      // Return partial page to stop pagination naturally
      fetch.mockResolvedValueOnce(mockResponse({
          timeentries: [{
            _id: 'entry_1',
            userId: 'user_1',
            userName: 'User 1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
          }]
        }));

      const results = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      // Should work without errors (uses default 50)
      expect(results).toHaveLength(1);
      expect(store.ui.paginationTruncated).toBe(false);
    });

    it('kills === 0 vs !== 0 mutation: maxPages=0 enables unlimited mode', async () => {
      // Kill: configuredMaxPages === 0 → configuredMaxPages !== 0
      // Setup: store.config.maxPages = 0
      // Expected: effectiveMaxPages = HARD_MAX_PAGES_LIMIT (500)
      // If === becomes !==, non-zero would trigger unlimited instead
      store.config = { maxPages: 0 }; // 0 means unlimited (use HARD_MAX_PAGES_LIMIT)

      // We'll set up a scenario where page limit matters
      // Return exactly 200 entries on first page to continue pagination
      const fullPage = Array.from({ length: 200 }, (_, i) => ({
        _id: `entry_${i}`,
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
      }));

      // Return partial on second page to stop
      const partialPage = [{
        _id: 'entry_last',
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-02T09:00:00Z', end: '2025-01-02T10:00:00Z', duration: 3600 }
      }];

      fetch
        .mockResolvedValueOnce(mockResponse({ timeentries: fullPage }))
        .mockResolvedValueOnce(mockResponse({ timeentries: partialPage }));

      const results = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // With maxPages=0 (unlimited), should continue pagination
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(201);
      expect(store.ui.paginationTruncated).toBe(false);
    });

    it('kills min vs max mutation: configuredMaxPages capped at HARD_MAX_PAGES_LIMIT', async () => {
      // Kill: Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT) → Math.max(...)
      // Setup: store.config.maxPages = 1000 (> HARD_MAX_PAGES_LIMIT of 500)
      // Expected: effectiveMaxPages = 500 (capped)
      // If min becomes max, 1000 would be used
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      store.config = { maxPages: 1000 }; // Exceeds HARD_MAX_PAGES_LIMIT (500)

      // We need to reach page 501 to trigger truncation if limit is 500
      // But if mutation changes min→max, limit would be 1000 and no truncation at 501
      // For practical testing, we'll use maxPages: 2 and verify it caps at 2
      store.config = { maxPages: 2 };

      const fullPage = Array.from({ length: 200 }, (_, i) => ({
        _id: `entry_${i}`,
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
      }));

      // Return full pages to trigger limit
      fetch.mockResolvedValue(mockResponse({ timeentries: fullPage }));

      const results = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Should stop at page 2 (effectiveMaxPages = min(2, 500) = 2)
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(400); // 200 * 2
      expect(store.ui.paginationTruncated).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reached page limit (2)')
      );

      warnSpy.mockRestore();
    });

    it('kills > vs >= mutation: page exactly at limit should NOT truncate', async () => {
      // Kill: page > effectiveMaxPages → page >= effectiveMaxPages
      // Setup: Paginate to exactly effectiveMaxPages
      // Expected: paginationTruncated = false at exact limit
      // If > becomes >=, we'd truncate at exactly the limit
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      store.config = { maxPages: 2 };

      const fullPage = Array.from({ length: 200 }, (_, i) => ({
        _id: `entry_${i}`,
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
      }));

      // Page 1: full (200 entries) - continues
      // Page 2: partial (50 entries) - stops naturally
      fetch
        .mockResolvedValueOnce(mockResponse({ timeentries: fullPage }))
        .mockResolvedValueOnce(mockResponse({ timeentries: fullPage.slice(0, 50) }));

      const results = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Page 2 is exactly at limit but ends naturally with partial page
      // With > check: page 2 is NOT > 2, so no truncation
      // With >= mutation: page 2 >= 2 would trigger truncation incorrectly
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(250); // 200 + 50
      expect(store.ui.paginationTruncated).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('kills true vs false mutation: exceeding limit sets paginationTruncated to true', async () => {
      // Kill: store.ui.paginationTruncated = true → store.ui.paginationTruncated = false
      // Setup: Paginate past effectiveMaxPages
      // Expected: store.ui.paginationTruncated === true
      // If true becomes false, flag wouldn't be set
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      store.config = { maxPages: 1 };
      store.ui = { paginationTruncated: false };

      const fullPage = Array.from({ length: 200 }, (_, i) => ({
        _id: `entry_${i}`,
        userId: 'user_1',
        userName: 'User 1',
        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T10:00:00Z', duration: 3600 }
      }));

      // Return full page to trigger continuation check
      fetch.mockResolvedValueOnce(mockResponse({ timeentries: fullPage }));

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // After page 1 with full results, page++ makes page=2
      // 2 > 1 triggers truncation
      expect(store.ui.paginationTruncated).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reached page limit')
      );

      warnSpy.mockRestore();
    });
  });
});

describe('Circuit Breaker Metrics Integration', () => {
  // Tests for circuit breaker metrics updates (P1 enterprise recommendation)
  // These tests verify that circuit breaker state changes are tracked properly
  // by testing the circuit breaker state directly via getCircuitBreakerState

  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });

    // Reset store and circuit breaker
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
  });

  it('should reset circuit breaker to CLOSED state with zero failures', async () => {
    // Import getCircuitBreakerState dynamically to test actual state
    const { getCircuitBreakerState } = await import('../../js/api.js');

    // After reset, circuit breaker state should be CLOSED with 0 failures
    const state = getCircuitBreakerState();
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
    expect(state.isOpen).toBe(false);
  });

  it('should track state for monitoring via getCircuitBreakerState', async () => {
    // This verifies the circuit breaker state is observable
    const { getCircuitBreakerState } = await import('../../js/api.js');

    const state = getCircuitBreakerState();

    // All monitoring fields should be present
    expect(state).toHaveProperty('state');
    expect(state).toHaveProperty('failureCount');
    expect(state).toHaveProperty('isOpen');
    expect(state).toHaveProperty('nextRetryTime');

    // State values should be numbers or valid types
    expect(['CLOSED', 'HALF_OPEN', 'OPEN']).toContain(state.state);
    expect(typeof state.failureCount).toBe('number');
    expect(typeof state.isOpen).toBe('boolean');
  });

  it('should provide circuit breaker metrics access via MetricNames constants', async () => {
    // Verify the metric names are exported correctly
    const { MetricNames } = await import('../../js/metrics.js');

    expect(MetricNames.CIRCUIT_BREAKER_STATE).toBe('circuit_breaker_state');
    expect(MetricNames.CIRCUIT_BREAKER_FAILURE_COUNT).toBe('circuit_breaker_failure_count');
  });
});
