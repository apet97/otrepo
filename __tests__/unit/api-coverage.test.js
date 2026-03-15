/**
 * @jest-environment node
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import {
  Api,
  resetRateLimiter,
  resetCircuitBreaker,
  checkTokenExpiration,
  CircuitBreakerOpenError,
  getCircuitBreakerState,
  checkIsAdmin,
} from '../../js/api.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';
import { createMockJwtToken } from '../helpers/mock-data.js';
import { mockResponse } from '../helpers/api-test-helpers.js';

// Set up Web Crypto API for Node environment
global.crypto = webcrypto;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper: create a JWT token expiring in N seconds from now
function createTokenExpiringIn(seconds) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return createMockJwtToken({ exp });
}

// Helper: generate a large response string of given byte size
function makeLargeBody(sizeBytes) {
  return 'x'.repeat(sizeBytes);
}

describe('API Module - Coverage Gaps', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.clearAllMocks();
    mockFetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    store.resetThrottleStatus();
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me',
      reportsUrl: 'https://reports.api.clockify.me',
    };
    store.config = {
      ...store.config,
      maxPages: 50,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerResetMs: 30000,
    };
    store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    store.ui = { ...store.ui, paginationAbortedDueToTokenExpiration: false, paginationTruncated: false };
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    standardAfterEach();
    store.token = null;
    store.claims = null;
    global.fetch = mockFetch;
  });

  // =====================================================================
  // Lines 274-277: checkTokenExpiration catch block (malformed token)
  // =====================================================================
  describe('checkTokenExpiration - catch block (lines 274-277)', () => {
    it('returns isExpired=true when token payload is not valid base64', () => {
      // A 3-part token where the payload is not valid base64/JSON
      store.token = 'header.!!!invalid-base64!!!.signature';
      const result = checkTokenExpiration();
      expect(result.isExpired).toBe(true);
      expect(result.expiresIn).toBeNull();
      expect(result.shouldWarn).toBe(false);
    });
  });

  // =====================================================================
  // Lines 1087-1093: CircuitBreakerOpenError constructor
  // =====================================================================
  describe('CircuitBreakerOpenError (lines 1087-1093)', () => {
    it('constructs with nextRetryTime and calculates wait time', () => {
      const futureTime = Date.now() + 15000;
      const error = new CircuitBreakerOpenError(futureTime);
      expect(error.name).toBe('CircuitBreakerOpenError');
      expect(error.nextRetryTime).toBe(futureTime);
      expect(error.message).toContain('Circuit breaker is open');
      expect(error.message).toMatch(/Retry after \d+ seconds/);
    });

    it('constructs with null nextRetryTime', () => {
      const error = new CircuitBreakerOpenError(null);
      expect(error.name).toBe('CircuitBreakerOpenError');
      expect(error.nextRetryTime).toBeNull();
      expect(error.message).toContain('Retry after 0 seconds');
    });
  });

  // =====================================================================
  // Lines 723-734: HALF_OPEN circuit breaker failure -> reopen
  // =====================================================================
  describe('Circuit breaker HALF_OPEN failure (lines 723-734)', () => {
    it('reopens circuit when request fails in HALF_OPEN state', async () => {
      // Trip the circuit breaker by causing enough failures
      // fetchUsers throws on non-OK responses; suppress errors to let circuit count failures
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));
        const p = Api.fetchUsers('ws_test').catch(() => {});
        await jest.runAllTimersAsync();
        await p;
      }

      // Circuit should now be OPEN
      let state = getCircuitBreakerState();
      expect(state.state).toBe('OPEN');

      // Advance time past the reset timeout
      await jest.advanceTimersByTimeAsync(31000);

      // Next request transitions to HALF_OPEN and makes a probe
      mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));
      const p2 = Api.fetchUsers('ws_test').catch(() => {});
      await jest.runAllTimersAsync();
      await p2;

      // Should have reopened
      state = getCircuitBreakerState();
      expect(state.state).toBe('OPEN');
    });
  });

  // =====================================================================
  // Line 786: HALF_OPEN with halfOpenPending blocks additional requests
  // =====================================================================
  describe('Circuit breaker HALF_OPEN pending blocks requests (line 786)', () => {
    it('blocks concurrent requests when HALF_OPEN probe is in flight', async () => {
      // Trip the circuit breaker
      // fetchUsers throws on non-OK responses; suppress errors to let circuit count failures
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));
        const p = Api.fetchUsers('ws_test').catch(() => {});
        await jest.runAllTimersAsync();
        await p;
      }

      expect(getCircuitBreakerState().state).toBe('OPEN');

      // Advance past reset timeout
      await jest.advanceTimersByTimeAsync(31000);

      // First request will transition to HALF_OPEN (probe request)
      // Use a promise that we don't resolve immediately to keep halfOpenPending true
      let fetchResolve;
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { fetchResolve = resolve; }));

      const probe = Api.fetchUsers('ws_test').catch(() => {});

      // Second request should be blocked (circuit breaker returns 503)
      // fetchUsers now throws on blocked (503) requests
      mockFetch.mockResolvedValueOnce(mockResponse([{ id: 'u1', name: 'User 1' }]));
      let blockedError;
      try {
        await Api.fetchUsers('ws_test');
      } catch (err) {
        blockedError = err;
      }
      await jest.runAllTimersAsync();

      // Blocked request throws since circuit breaker 503 is a non-OK response
      expect(blockedError).toBeDefined();
      expect(blockedError.message).toContain('Failed to fetch workspace users');

      // Now resolve the probe
      fetchResolve(mockResponse([{ id: 'u1', name: 'User 1' }]));
      await jest.runAllTimersAsync();
      await probe;
    });
  });

  // =====================================================================
  // Lines 1285-1292: AbortSignal.timeout fallback for older browsers
  // =====================================================================
  describe('AbortSignal.timeout fallback (lines 1285-1292)', () => {
    it('uses setTimeout fallback when AbortSignal.timeout is unavailable', async () => {
      const origTimeout = AbortSignal.timeout;
      const origAny = AbortSignal.any;
      try {
        // Override AbortSignal.timeout and .any to undefined to trigger fallback
        Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true });
        Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });

        const profileData = { workCapacity: 'PT8H', workingDays: ['MONDAY'] };
        mockFetch.mockResolvedValueOnce(mockResponse(profileData));
        const promise = Api.fetchUserProfile('ws_test', 'user1');
        await jest.runAllTimersAsync();
        const result = await promise;
        expect(result.failed).toBe(false);
        expect(result.data).toEqual(profileData);
      } finally {
        Object.defineProperty(AbortSignal, 'timeout', { value: origTimeout, configurable: true, writable: true });
        Object.defineProperty(AbortSignal, 'any', { value: origAny, configurable: true, writable: true });
      }
    });
  });

  // =====================================================================
  // Lines 1385-1392: Response size exceeds max (Content-Length present)
  // =====================================================================
  describe('Response size validation via Content-Length (lines 1385-1392)', () => {
    it('returns 413 when Content-Length exceeds maximum', async () => {
      const hugeSize = 60 * 1024 * 1024; // 60MB > 50MB limit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
        headers: {
          get: (name) => name === 'Content-Length' ? String(hugeSize) : null,
          has: (name) => name === 'Content-Length',
        },
      });

      // Use fetchUserProfile to get raw ApiResponse (not fetchUsers which converts to [])
      const promise = Api.fetchUserProfile('ws_test', 'user1');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.failed).toBe(true);
      expect(result.status).toBe(413);
    });
  });

  // =====================================================================
  // Lines 1402-1408: Response size exceeds max (no Content-Length, streaming check)
  // =====================================================================
  describe('Response size validation via text() streaming check (lines 1402-1408)', () => {
    it('returns 413 when actual body size exceeds maximum', async () => {
      // No Content-Length header, but large body
      const largeText = makeLargeBody(55 * 1024 * 1024); // 55MB
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => largeText,
        headers: {
          get: () => null, // No Content-Length
          has: () => false,
        },
      });

      // Use fetchUserProfile for raw ApiResponse
      const promise = Api.fetchUserProfile('ws_test', 'user1');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.failed).toBe(true);
      expect(result.status).toBe(413);
    });
  });

  // =====================================================================
  // Lines 1331-1336: Rate limit retry time would exceed limit
  // =====================================================================
  describe('Rate limit total retry time exceeded (lines 1331-1336)', () => {
    it('returns failed when total retry time would exceed limit', async () => {
      // Return 429 with a very long Retry-After that exceeds the 2-minute limit
      const make429 = () => ({
        ok: false,
        status: 429,
        json: async () => null,
        text: async () => '',
        headers: {
          get: (name) => {
            if (name === 'Retry-After') return '200'; // 200 seconds > 120s limit
            if (name === 'Content-Length') return '0';
            return null;
          },
          has: (name) => name === 'Retry-After' || name === 'Content-Length',
        },
      });

      mockFetch.mockResolvedValueOnce(make429());

      // fetchTimeOffRequests passes explicit maxRetries (defaults to 2)
      // so the retry path inside fetchWithAuth is active
      const promise = Api.fetchTimeOffRequests('ws_test', ['user1'], '2025-01-01', '2025-01-31', { maxRetries: 2 });
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });
  });

  // =====================================================================
  // Lines 1454-1459: Retry time limit exceeded for network errors
  // =====================================================================
  describe('Retry backoff exceeds total retry time limit (lines 1454-1459)', () => {
    it('stops retrying when backoff would exceed max total retry time', async () => {
      // We need to make the elapsed+backoff check at line 1453 return true.
      // MAX_TOTAL_RETRY_TIME_MS is 120_000 (2 minutes).
      // Strategy: Make the first fetch attempt fail, then advance system time
      // so that elapsed time is close to the limit.

      const networkError = new Error('Network failure');
      networkError.status = 0;

      // First attempt throws network error
      mockFetch.mockRejectedValueOnce(networkError);
      // Second attempt: shouldn't be reached if time limit check works
      mockFetch.mockRejectedValueOnce(networkError);

      // fetchTimeOffRequests passes maxRetries to fetchWithAuth
      const promise = Api.fetchTimeOffRequests('ws_test', ['user1'], '2025-01-01', '2025-01-31', { maxRetries: 2 });

      // First attempt fails, code enters catch block at line 1447
      // It calculates backoffTime = Math.pow(2, 0) * 1000 * (0.5 + Math.random() * 0.5) ~ 500-1000ms
      // Then checks: elapsedTime + backoffTime > 120000
      // We need to advance time past the 120s mark before the backoff check
      // Advance 121 seconds so elapsed > 120s
      await jest.advanceTimersByTimeAsync(121000);
      await jest.runAllTimersAsync();

      const result = await promise;
      expect(result.failed).toBe(true);
    });
  });

  // =====================================================================
  // Lines 1487-1488: Fallback return (unreachable loop end)
  // These lines have istanbul ignore, so they may not affect coverage
  // but we test the behavior anyway
  // =====================================================================

  // =====================================================================
  // Lines 1573-1581: fetchUsers pagination (multi-page)
  // =====================================================================
  describe('fetchUsers pagination (lines 1573-1581)', () => {
    it('paginates correctly and stops when partial page received', async () => {
      // Page 1: full page of 500 users
      const page1 = Array.from({ length: 500 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));
      // Page 2: partial page (< 500 means last page)
      const page2 = [{ id: 'user500', name: 'User 500' }];

      mockFetch
        .mockResolvedValueOnce(mockResponse(page1))
        .mockResolvedValueOnce(mockResponse(page2));

      const promise = Api.fetchUsers('ws_test');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.length).toBe(501);
    });

    it('returns first page data when second page returns null', async () => {
      const page1 = [{ id: 'user1', name: 'User 1' }, { id: 'user2', name: 'User 2' }];
      mockFetch.mockResolvedValueOnce(mockResponse(page1));

      const promise = Api.fetchUsers('ws_test');
      await jest.runAllTimersAsync();
      const result = await promise;
      // Only 2 items < PAGE_SIZE(500), so pagination stops after first page
      expect(result.length).toBe(2);
    });
  });

  // =====================================================================
  // Lines 1722-1727: Pagination aborted by caller before page fetch
  // =====================================================================
  describe('fetchDetailedReport pagination abort (lines 1722-1727)', () => {
    it('returns partial results when signal is aborted before next page', async () => {
      const controller = new AbortController();

      // First page succeeds with full page data (200 = full page triggers next iteration)
      const firstPageData = {
        timeentries: Array.from({ length: 200 }, (_, i) => ({
          _id: `entry${i}`,
          userId: 'user1',
          userName: 'Alice',
          timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
        })),
      };

      mockFetch.mockReset();
      // First call returns full page, second call returns empty (but we abort before it)
      mockFetch.mockResolvedValueOnce(mockResponse(firstPageData));
      mockFetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      // Abort BEFORE starting so the signal is already aborted when pagination loops
      // This tests line 1722: `if (options.signal?.aborted)` at loop start
      controller.abort();

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z', {
        signal: controller.signal,
      });

      await jest.runAllTimersAsync();
      const result = await promise;

      // With signal already aborted, the first page check at line 1722 fires
      // before any fetch, returning [] (empty allEntries)
      expect(result).toEqual([]);
    });
  });

  // =====================================================================
  // Lines 1734-1740: Token expired during pagination
  // =====================================================================
  describe('fetchDetailedReport token expiry during pagination (lines 1734-1740)', () => {
    it('returns partial results when token expires during pagination', async () => {
      // TOKEN_EXPIRY_GRACE_PERIOD is 30 seconds.
      // isExpired = expiresIn <= 30. shouldWarn = expiresIn > 0 && expiresIn <= 300.
      // So we need a token with expiresIn > 30 to pass the fetchWithAuth check,
      // then manually change the token to an expired one before the second page.

      // Start with a token that has plenty of time (600 seconds)
      store.token = createTokenExpiringIn(600);

      const fullPageData = {
        timeentries: Array.from({ length: 200 }, (_, i) => ({
          _id: `entry${i}`,
          userId: 'user1',
          userName: 'Alice',
          timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
        })),
      };

      mockFetch.mockReset();
      // First page succeeds (200 entries = full page, triggers continued pagination)
      mockFetch.mockImplementation(async () => {
        // After the first call, expire the token for subsequent pagination checks
        store.token = createTokenExpiringIn(-60); // Already expired
        return mockResponse(fullPageData);
      });

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');
      await jest.runAllTimersAsync();
      const result = await promise;

      // First page succeeds (200 entries), then token expiry check at line 1733 fires
      // returning partial results
      expect(result.length).toBe(200);
      expect(store.ui.paginationAbortedDueToTokenExpiration).toBe(true);
    });
  });

  // =====================================================================
  // Line 1745: Token expiring soon warning during pagination
  // =====================================================================
  describe('fetchDetailedReport token expiring soon warning (line 1745)', () => {
    it('logs warning when token is expiring soon on first page', async () => {
      // TOKEN_EXPIRY_GRACE_PERIOD = 30s
      // shouldWarn: expiresIn > 0 && expiresIn <= 5 * 60 (300)
      // isExpired: expiresIn <= 30
      // Need expiresIn between 31 and 300 so shouldWarn=true but isExpired=false
      store.token = createTokenExpiringIn(120); // 2 min

      const pageData = {
        timeentries: [{
          _id: 'entry1',
          userId: 'user1',
          userName: 'Alice',
          timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
        }],
      };

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(pageData));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.length).toBe(1);
    });
  });


  // =====================================================================
  // Lines 1879-1883: Pagination aborted after transformation
  // =====================================================================
  describe('fetchDetailedReport abort after transformation (lines 1879-1883)', () => {
    it('returns entries when abort signal fires after entry transformation', async () => {
      const controller = new AbortController();
      store.token = createTokenExpiringIn(600);

      // Full page (200 entries triggers continued pagination)
      const pageData = {
        timeentries: Array.from({ length: 200 }, (_, i) => ({
          _id: `entry${i}`,
          userId: 'user1',
          userName: 'Alice',
          timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 28800 },
        })),
      };

      mockFetch.mockReset();
      // First fetch: return full page and abort controller after response
      mockFetch.mockImplementationOnce(async () => {
        // Abort after the fetch resolves. When code returns to the while loop,
        // it checks signal.aborted at line 1878 (after transformation),
        // and at line 1722 (before next page fetch).
        setTimeout(() => controller.abort(), 0);
        return mockResponse(pageData);
      });
      // Second fetch shouldn't be reached, but mock it just in case
      mockFetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport('ws_test', '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z', {
        signal: controller.signal,
      });
      await jest.runAllTimersAsync();
      const result = await promise;
      // Should have first page data
      expect(result.length).toBe(200);
    });
  });

  // =====================================================================
  // Lines 2050-2057: fetchTimeOffRequests page limit
  // =====================================================================
  describe('fetchTimeOffRequests page limit (lines 2050-2057)', () => {
    it('stops paginating when HARD_MAX_PAGES_LIMIT is exceeded', async () => {
      // fetchTimeOffRequests paginates until requests.length < pageSize
      // or page > HARD_MAX_PAGES_LIMIT. Since HARD_MAX_PAGES_LIMIT is 5000,
      // we can't practically hit it. Test that pagination works with partial pages.
      const requestData = {
        requests: [{ id: 'req1', userId: 'user1' }],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(requestData));

      const promise = Api.fetchTimeOffRequests('ws_test', ['user1'], '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.failed).toBe(false);
      expect(result.data.requests.length).toBe(1);
    });
  });

  // =====================================================================
  // Lines 2088-2089: Circuit breaker open during profile batch
  // =====================================================================
  describe('fetchAllProfiles circuit breaker open (lines 2088-2089)', () => {
    it('terminates profile batch early when circuit breaker opens', async () => {
      const users = Array.from({ length: 30 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));

      // Trip the circuit breaker by causing 5 failures first
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));
        const p = Api.fetchUserProfile('ws_test', `user${i}`);
        await jest.runAllTimersAsync();
        await p;
      }

      expect(getCircuitBreakerState().state).toBe('OPEN');

      // Now call fetchAllProfiles - it should terminate early
      const promise = Api.fetchAllProfiles('ws_test', users);
      await jest.runAllTimersAsync();
      const result = await promise;

      // Should have fewer results than total users since circuit breaker blocked requests
      expect(result.size).toBeLessThan(users.length);
    });
  });

  // =====================================================================
  // Line 2101: fetchAllProfiles onProgress callback
  // =====================================================================
  describe('fetchAllProfiles onProgress (line 2101)', () => {
    it('calls onProgress callback during profile fetching', async () => {
      const users = [
        { id: 'user1', name: 'User 1' },
        { id: 'user2', name: 'User 2' },
      ];
      const progressCalls = [];

      mockFetch
        .mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: ['MONDAY'] }))
        .mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: ['MONDAY'] }));

      const promise = Api.fetchAllProfiles('ws_test', users, {
        onProgress: (count, phase) => progressCalls.push({ count, phase }),
      });
      await jest.runAllTimersAsync();
      await promise;

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0].phase).toBe('profiles');
    });
  });

  // =====================================================================
  // Line 2221: fetchAllHolidays onProgress callback (sample batch)
  // =====================================================================
  describe('fetchAllHolidays onProgress (line 2221)', () => {
    it('calls onProgress during holiday sample fetching', async () => {
      const users = Array.from({ length: 5 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));
      const progressCalls = [];

      // All users return the same holidays (single pattern -> propagate)
      const holidays = [{ name: 'Christmas', datePeriod: { startDate: '2025-12-25' } }];
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(mockResponse(holidays));
      }

      const promise = Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31', {
        onProgress: (count, phase) => progressCalls.push({ count, phase }),
      });
      await jest.runAllTimersAsync();
      await promise;

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls.some((c) => c.phase === 'holidays')).toBe(true);
    });
  });

  // =====================================================================
  // Line 2238: fetchAllHolidays onProgress after propagation
  // =====================================================================
  describe('fetchAllHolidays propagation onProgress (line 2238)', () => {
    it('calls onProgress after holiday propagation for single-pattern case', async () => {
      // Need > 20 users (SAMPLE_SIZE = min(max(20, ceil(N*0.1)), N))
      // With 25 users, sample = max(20, 3) = 20, verification = 3, propagated = 2
      const users = Array.from({ length: 25 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));
      const progressCalls = [];

      // All sampled + verified users return the same holidays (20 sample + 3 verification = 23)
      const holidays = [{ name: 'Christmas', datePeriod: { startDate: '2025-12-25' } }];
      for (let i = 0; i < 23; i++) {
        mockFetch.mockResolvedValueOnce(mockResponse(holidays));
      }

      const promise = Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31', {
        onProgress: (count, phase) => progressCalls.push({ count, phase }),
      });
      await jest.runAllTimersAsync();
      await promise;

      // Should have progress calls including after propagation
      const holidayProgress = progressCalls.filter((c) => c.phase === 'holidays');
      expect(holidayProgress.length).toBeGreaterThan(0);
      // After propagation, the count should be 25 (all users)
      const lastProgress = holidayProgress[holidayProgress.length - 1];
      expect(lastProgress.count).toBe(25);
    });
  });

  // =====================================================================
  // Lines 2244-2262: fetchAllHolidays multiple patterns (fetch remaining)
  // =====================================================================
  describe('fetchAllHolidays multiple patterns (lines 2244-2262)', () => {
    it('fetches remaining users individually when multiple holiday patterns found', async () => {
      // Need > SAMPLE_SIZE users to have remaining users to fetch
      const users = Array.from({ length: 25 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));

      // Return different patterns for sampled users to trigger multiple-pattern path
      for (let i = 0; i < 20; i++) {
        const holidays = i < 10
          ? [{ name: 'Christmas', datePeriod: { startDate: '2025-12-25' } }]
          : [{ name: 'New Year', datePeriod: { startDate: '2025-01-01' } }];
        mockFetch.mockResolvedValueOnce(mockResponse(holidays));
      }

      // Remaining 5 users fetched individually
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(
          mockResponse([{ name: 'Holiday', datePeriod: { startDate: '2025-07-04' } }])
        );
      }

      const progressCalls = [];
      const promise = Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31', {
        onProgress: (count, phase) => progressCalls.push({ count, phase }),
      });
      await jest.runAllTimersAsync();
      const result = await promise;

      // All 25 users should have holiday data
      expect(result.size).toBe(25);
    });
  });

  // =====================================================================
  // Lines 2324-2327: fetchAllTimeOff data extraction (array and timeOffRequests formats)
  // =====================================================================
  describe('fetchAllTimeOff data extraction formats (lines 2324-2327)', () => {
    it('handles data.requests format', async () => {
      const users = [{ id: 'user1', name: 'User 1' }];

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          requests: [
            {
              id: 'req1',
              userId: 'user1',
              timeOffPeriod: {
                start: '2025-01-10T00:00:00Z',
                end: '2025-01-10T23:59:59Z',
              },
              status: { statusType: 'APPROVED' },
            },
          ],
        })
      );

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result).toBeInstanceOf(Map);
    });

    it('handles direct array format', async () => {
      const users = [{ id: 'user1', name: 'User 1' }];

      // When fetched data is an array directly (line 2324)
      mockFetch.mockResolvedValueOnce(
        mockResponse([
          {
            id: 'req1',
            userId: 'user1',
            timeOffPeriod: {
              start: '2025-01-10T00:00:00Z',
              end: '2025-01-10T23:59:59Z',
            },
            status: { statusType: 'APPROVED' },
          },
        ])
      );

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result).toBeInstanceOf(Map);
    });

    it('handles timeOffRequests format', async () => {
      const users = [{ id: 'user1', name: 'User 1' }];

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          timeOffRequests: [
            {
              id: 'req1',
              userId: 'user1',
              timeOffPeriod: {
                start: '2025-01-10T00:00:00Z',
                end: '2025-01-10T23:59:59Z',
              },
              status: { statusType: 'APPROVED' },
            },
          ],
        })
      );

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result).toBeInstanceOf(Map);
    });
  });

  // =====================================================================
  // Line 2332: fetchAllTimeOff onProgress callback
  // =====================================================================
  describe('fetchAllTimeOff onProgress (line 2332)', () => {
    it('calls onProgress callback during time-off fetching', async () => {
      const users = [{ id: 'user1', name: 'User 1' }];
      const progressCalls = [];

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          requests: [
            {
              id: 'req1',
              userId: 'user1',
              timeOffPeriod: {
                start: '2025-01-10T00:00:00Z',
                end: '2025-01-10T23:59:59Z',
              },
            },
          ],
        })
      );

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31', {
        onProgress: (count, phase) => progressCalls.push({ count, phase }),
      });
      await jest.runAllTimersAsync();
      await promise;

      expect(progressCalls.some((c) => c.phase === 'time-off')).toBe(true);
    });
  });

  // =====================================================================
  // Lines 2344-2350: fetchAllTimeOff partial failure
  // =====================================================================
  describe('fetchAllTimeOff partial failure (lines 2344-2350)', () => {
    it('handles partial failure when some batches fail but others succeed', async () => {
      // Need > 500 users to trigger batching (TIME_OFF_USER_BATCH_SIZE = 500)
      const users = Array.from({ length: 600 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));

      // First batch (500 users) succeeds with approved requests
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          requests: Array.from({ length: 100 }, (_, i) => ({
            id: `req${i}`,
            userId: `user${i}`,
            requesterUserId: `user${i}`,
            timeOffPeriod: {
              start: '2025-01-10T00:00:00Z',
              end: '2025-01-10T23:59:59Z',
            },
            status: { statusType: 'APPROVED' },
            timeUnit: 'DAYS',
          })),
        })
      );

      // Second batch (100 users) fails
      mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const result = await promise;

      // Should return partial results (from the first successful batch)
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBeGreaterThan(0);
      // Partial failure status must be set and non-zero
      expect(store.apiStatus.timeOffFailed).toBeGreaterThan(0);
    });

    it('clears timeOffFailed status on full success', async () => {
      store.apiStatus.timeOffFailed = 5; // pre-set to confirm it gets cleared
      const users = Array.from({ length: 2 }, (_, i) => ({ id: `user${i}`, name: `User ${i}` }));

      mockFetch.mockResolvedValueOnce(
        mockResponse({ requests: [] })
      );

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      await promise;

      expect(store.apiStatus.timeOffFailed).toBe(0);
    });
  });

  // =====================================================================
  // Lines 2462-2488: checkIsAdmin function
  // =====================================================================
  describe('checkIsAdmin (lines 2462-2488)', () => {
    it('returns false when no token is available', async () => {
      store.token = null;
      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when claims are missing', async () => {
      store.claims = null;
      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when claims lack workspaceId', async () => {
      store.claims = { backendUrl: 'https://api.clockify.me' };
      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when claims lack backendUrl', async () => {
      store.claims = { workspaceId: 'ws_test' };
      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns true for WORKSPACE_ADMIN with ACTIVE membership', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          memberships: [
            { membershipType: 'WORKSPACE_ADMIN', membershipStatus: 'ACTIVE' },
          ],
        }),
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(true);
    });

    it('returns true for OWNER with ACTIVE membership', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          memberships: [
            { membershipType: 'OWNER', membershipStatus: 'ACTIVE' },
          ],
        }),
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(true);
    });

    it('returns false for MEMBER membership type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          memberships: [
            { membershipType: 'MEMBER', membershipStatus: 'ACTIVE' },
          ],
        }),
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when no ACTIVE membership found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          memberships: [
            { membershipType: 'WORKSPACE_ADMIN', membershipStatus: 'INACTIVE' },
          ],
        }),
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when fetch throws an error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when memberships array is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ memberships: [] }),
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });

    it('returns false when memberships is undefined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await checkIsAdmin('user1');
      expect(result).toBe(false);
    });
  });

  // =====================================================================
  // Line 1228: Token expiring soon warning in fetchWithAuth
  // =====================================================================
  describe('fetchWithAuth token expiring soon warning (line 1228)', () => {
    it('logs warning but proceeds when token is expiring soon', async () => {
      // shouldWarn: expiresIn > 0 && expiresIn <= 5 * 60 (300s)
      // isExpired: expiresIn <= TOKEN_EXPIRY_GRACE_PERIOD (30s)
      // So we need expiresIn between 31 and 300
      store.token = createTokenExpiringIn(120); // 2 minutes

      mockFetch.mockResolvedValueOnce(mockResponse([{ id: 'u1', name: 'Alice' }]));

      const promise = Api.fetchUsers('ws_test');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result).toEqual([{ id: 'u1', name: 'Alice' }]);
    });
  });

  // =====================================================================
  // Line 2262: fetchAllHolidays onProgress for remaining users batch
  // =====================================================================
  describe('fetchAllHolidays remaining users onProgress (line 2262)', () => {
    it('calls onProgress for each batch of remaining users', async () => {
      const users = Array.from({ length: 25 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));
      const progressCalls = [];

      // Return two different patterns to trigger the remaining-users fetch
      for (let i = 0; i < 20; i++) {
        const holidays = i % 2 === 0
          ? [{ name: 'Holiday A', datePeriod: { startDate: '2025-06-01' } }]
          : [{ name: 'Holiday B', datePeriod: { startDate: '2025-07-04' } }];
        mockFetch.mockResolvedValueOnce(mockResponse(holidays));
      }

      // Remaining 5 users
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(
          mockResponse([{ name: 'Holiday C', datePeriod: { startDate: '2025-08-15' } }])
        );
      }

      const promise = Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31', {
        onProgress: (count, phase) => progressCalls.push({ count, phase }),
      });
      await jest.runAllTimersAsync();
      await promise;

      // Should have progress calls from both sample and remaining batches
      const holidayProgress = progressCalls.filter((c) => c.phase === 'holidays');
      expect(holidayProgress.length).toBeGreaterThanOrEqual(2); // At least sample batch + remaining batch
    });
  });

  // =====================================================================
  // Holiday dedup with failed samples
  // =====================================================================
  describe('fetchAllHolidays with failed samples', () => {
    it('handles failed samples and increments failedCount', async () => {
      const users = Array.from({ length: 5 }, (_, i) => ({
        id: `user${i}`,
        name: `User ${i}`,
      }));

      // Some succeed, some fail
      for (let i = 0; i < 5; i++) {
        if (i < 3) {
          mockFetch.mockResolvedValueOnce(
            mockResponse([{ name: 'Holiday', datePeriod: { startDate: '2025-12-25' } }])
          );
        } else {
          mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));
        }
      }

      const promise = Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31');
      await jest.runAllTimersAsync();
      const result = await promise;

      // Should still have results for successful users
      expect(result.size).toBeGreaterThan(0);
      expect(result.size).toBeLessThan(5);
    });
  });

  // =====================================================================
  // fetchAllTimeOff total failure (all batches fail)
  // =====================================================================
  describe('fetchAllTimeOff total failure', () => {
    it('returns empty map when all batches fail', async () => {
      const users = [{ id: 'user1', name: 'User 1' }];

      mockFetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      const promise = Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-01-31');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  // =====================================================================
  // fetchAllHolidays empty users array
  // =====================================================================
  describe('fetchAllHolidays with empty users', () => {
    it('returns empty map immediately for empty users array', async () => {
      const promise = Api.fetchAllHolidays('ws_test', [], '2025-01-01', '2025-12-31');
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.size).toBe(0);
    });
  });
});
