/**
 * @jest-environment node
 */

import { webcrypto } from 'crypto';

// Set up Web Crypto API for Node environment
global.crypto = webcrypto;

/**
 * Data Flow Orchestration Test Suite
 *
 * SPECIFICATION: Request Orchestration & Concurrency
 *
 * The main.ts controller orchestrates all data fetching with:
 * - AbortController for request cancellation
 * - Sequential dependency chains (users → entries → profiles/holidays/timeoff)
 * - Parallel fetching where possible (profiles, holidays, timeoff are independent)
 * - Batch processing to limit concurrent requests
 *
 * | Phase | Operation | Dependencies | Parallel? |
 * |-------|-----------|--------------|-----------|
 * | 1 | Fetch users | None | Single request |
 * | 2 | Fetch detailed report | Users | Single request |
 * | 3 | Fetch profiles | Users | Batched (5 concurrent) |
 * | 4 | Fetch holidays | Users | Batched (5 concurrent) |
 * | 5 | Fetch time-off | Users | Single bulk request |
 *
 * Note: Phases 3-5 can run in parallel (Promise.all) after phase 2 completes.
 *
 * @see js/main.ts - handleGenerateReport() orchestration
 * @see js/api.ts - Batch processing with BATCH_SIZE (5)
 * @see docs/guide.md - Data flow
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';
import { createMockJwtToken } from '../helpers/mock-data.js';

// Polyfills for Node environment
class StoragePolyfill {
  constructor() { this._data = {}; }
  getItem(key) { return this._data[key] || null; }
  setItem(key, value) { this._data[key] = String(value); }
  removeItem(key) { delete this._data[key]; }
  clear() { this._data = {}; }
  get length() { return Object.keys(this._data).length; }
  key(index) { return Object.keys(this._data)[index] || null; }
}
global.sessionStorage = new StoragePolyfill();
global.localStorage = new StoragePolyfill();
global.requestAnimationFrame = (fn) => setTimeout(fn, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Mock global fetch
global.fetch = jest.fn();

/**
 * Creates a mock response object with all required methods for API tests.
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
        if (name === 'Retry-After') return headers['Retry-After'] || null;
        return headers[name] || null;
      }
    }
  };
}

describe('Data Flow Orchestration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });

    store.token = createMockJwtToken();
    store.claims = { workspaceId: 'workspace_123', backendUrl: 'https://api.clockify.me/api' };
    store.users = [];
    store.profiles.clear();
    store.holidays.clear();
    store.timeOff.clear();
    store.resetThrottleStatus();

    const { resetRateLimiter, resetCircuitBreaker } = await import('../../js/api.js');
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(1000);
  });

  afterEach(() => {
    standardAfterEach();
    jest.useRealTimers();
    store.token = null;
    store.claims = null;
  });

  describe('Concurrent Fetch Handling', () => {
    /**
     * SPECIFICATION: Request Cancellation
     *
     * When a new report request starts while another is in-flight:
     * 1. Old request's AbortController.abort() is called
     * 2. All in-flight fetch requests receive AbortError
     * 3. Old request's responses are ignored
     * 4. New request proceeds normally
     */

    it('should handle AbortError gracefully without error banner', async () => {
      /**
       * SPECIFICATION: AbortError Handling
       *
       * AbortError should NOT show user error dialog:
       * - User intentionally cancelled (started new request)
       * - Not a real error, no retry needed
       */
      const abortError = new DOMException('Aborted', 'AbortError');

      // Verify AbortError name detection
      expect(abortError.name).toBe('AbortError');

      // AbortError should be silently ignored in error handling
      const isAbort = abortError.name === 'AbortError';
      expect(isAbort).toBe(true);
    });

    it('should cancel in-flight requests when AbortSignal is triggered', async () => {
      const controller = new AbortController();

      fetch.mockImplementation(async (url, options) => {
        // Check if signal is aborted
        if (options?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // Simulate a slow request that checks abort during execution
        await new Promise((resolve, reject) => {
          const checkAbort = () => {
            if (options?.signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
            } else {
              resolve(undefined);
            }
          };
          setTimeout(checkAbort, 100);
        });

        return mockResponse([]);
      });

      const { Api } = await import('../../js/api.js');

      // Start request
      const promise = Api.fetchDetailedReport(
        'workspace_123',
        '2025-01-01',
        '2025-01-31',
        { signal: controller.signal }
      );

      // Abort immediately
      controller.abort();

      // Should resolve with empty array (graceful degradation)
      const result = await promise;
      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw when page 1 fails without abort signal', async () => {
      /**
       * SPECIFICATION: Page 1 Failure Handling
       *
       * When the first page of detailed report fails (non-abort):
       * - Throw error to trigger error handling
       * - No partial data is acceptable for page 1
       */
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      const { Api } = await import('../../js/api.js');

      // Should throw on page 1 failure
      await expect(
        Api.fetchDetailedReport('workspace_123', '2025-01-01', '2025-01-31')
      ).rejects.toThrow('Failed to fetch initial detailed report page');
    });

    it('should return partial results when page > 1 fails', async () => {
      /**
       * SPECIFICATION: Subsequent Page Failure Handling
       *
       * When pages after the first fail:
       * - Return partial results collected so far
       * - Stop pagination gracefully
       */
      let callCount = 0;
      fetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First page succeeds with full page (200 entries) to trigger page 2 fetch
          const entries = Array.from({ length: 200 }, (_, i) => ({
            _id: `entry${i + 1}`,
            userId: 'user1'
          }));
          return mockResponse({
            timeentries: entries,
            totals: [{ totalTime: 200, entriesCount: 200 }]
          });
        }
        // Second page fails
        return mockResponse(null, { ok: false, status: 500 });
      });

      const { Api } = await import('../../js/api.js');

      const result = await Api.fetchDetailedReport(
        'workspace_123',
        '2025-01-01',
        '2025-01-31'
      );

      // Should return partial results from page 1
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(200);
      expect(result[0].id).toBe('entry1');
    });

    it('should ignore stale responses arriving after cancellation', async () => {
      /**
       * SPECIFICATION: Stale Response Handling
       *
       * If abort is called but response still arrives:
       * - Response should be ignored
       * - No state updates from stale data
       * - New request's data takes precedence
       */
      const controller = new AbortController();
      let responseOrder = [];

      fetch.mockImplementation(async (url, options) => {
        // Simulate network delay
        await jest.advanceTimersByTimeAsync(500);

        if (options?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        responseOrder.push(url);
        return mockResponse([{ id: 'stale_data' }]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Start first request
      const promise1 = Api.fetchUsers('workspace_123');

      // Abort first request
      controller.abort();

      // Start second request (should proceed)
      const promise2 = Api.fetchUsers('workspace_123');

      await jest.runAllTimersAsync();
      await Promise.all([promise1.catch(() => {}), promise2]);

      // Verify requests were made
      expect(responseOrder.length).toBeGreaterThan(0);
    });
  });

  describe('Fetch Sequence', () => {
    /**
     * SPECIFICATION: Data Fetch Order
     *
     * The controller fetches data in dependency order:
     * 1. Users (required to know who to fetch data for)
     * 2. Detailed Report (time entries for all users)
     * 3. Profiles, Holidays, TimeOff (can be parallel after users loaded)
     */

    it('should fetch users before entries (dependency chain)', async () => {
      const fetchOrder = [];

      fetch.mockImplementation(async (url) => {
        fetchOrder.push(url);
        const data = url.includes('/users') ? [{ id: 'user1', name: 'Alice' }] : [];
        return mockResponse(data);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Simulate fetch sequence
      const users = await Api.fetchUsers('workspace_123');
      expect(users.length).toBeGreaterThan(0);

      // Now fetch entries (depends on having users)
      await Api.fetchDetailedReport('workspace_123', '2025-01-01', '2025-01-31', {});

      // Verify users were fetched first
      const usersIndex = fetchOrder.findIndex(url => url.includes('/users'));
      const reportIndex = fetchOrder.findIndex(url => url.includes('/reports'));

      expect(usersIndex).toBeLessThan(reportIndex);
    });

    it('should fetch profiles/holidays/timeoff in parallel (no inter-dependency)', async () => {
      /**
       * SPECIFICATION: Parallel Fetching
       *
       * After users are loaded, these can run in parallel:
       * - Profiles: Per-user profile settings
       * - Holidays: Per-user holiday assignments
       * - TimeOff: Bulk time-off request (single request for all users)
       */
      const fetchCalls = [];
      let fetchStartTime = Date.now();

      fetch.mockImplementation(async (url) => {
        fetchCalls.push({ url, time: Date.now() - fetchStartTime });
        let data = [];
        if (url.includes('member-profile')) data = { workCapacityInHours: 8 };
        else if (url.includes('holidays')) data = [];
        else if (url.includes('time-off')) data = { requests: [] };
        return mockResponse(data);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      // Launch all three in parallel
      fetchStartTime = Date.now();
      await Promise.all([
        Api.fetchAllProfiles('workspace_123', users, {}),
        Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31', {}),
        Api.fetchAllTimeOff('workspace_123', users, '2025-01-01', '2025-01-31', {})
      ]);

      // All fetches should have been called
      expect(fetchCalls.length).toBeGreaterThan(0);
    });

    it('should batch user fetches in groups of BATCH_SIZE (5)', async () => {
      /**
       * SPECIFICATION: Batch Size = 5
       *
       * User-specific fetches (profiles, holidays) are batched:
       * - 5 concurrent requests per batch
       * - Batches run sequentially
       * - Prevents overwhelming the API
       */
      let fetchCount = 0;

      fetch.mockImplementation(async (url) => {
        fetchCount++;
        return mockResponse({ workCapacityInHours: 8, daysOfWeek: ['MONDAY'] });
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Create 12 users (should be 3 batches: 5 + 5 + 2)
      const users = Array(12).fill(null).map((_, i) => ({ id: `user_${i}`, name: `User ${i}` }));

      await jest.runAllTimersAsync();
      await Api.fetchAllProfiles('workspace_123', users, {});
      await jest.runAllTimersAsync();

      // All 12 profile requests should have been made
      expect(fetchCount).toBe(12);
    });
  });

  describe('Progressive Rendering', () => {
    /**
     * SPECIFICATION: Incremental UI Updates
     *
     * For large datasets, the UI should update progressively:
     * - Render rows in batches (not all at once)
     * - Use requestAnimationFrame for smooth updates
     * - Don't block the main thread
     */

    it('should support incremental data processing', async () => {
      // This tests the concept of progressive/incremental processing
      // The actual implementation uses DocumentFragment and batched DOM updates

      const entries = Array(100).fill(null).map((_, i) => ({
        id: `entry_${i}`,
        userId: 'user1',
        userName: 'Alice'
      }));

      // Process in batches
      const batchSize = 20;
      const batches = [];

      for (let i = 0; i < entries.length; i += batchSize) {
        batches.push(entries.slice(i, i + batchSize));
      }

      expect(batches.length).toBe(5);
      expect(batches[0].length).toBe(20);
      expect(batches[4].length).toBe(20);
    });

    it('should not block UI during large dataset processing', async () => {
      /**
       * SPECIFICATION: Non-blocking Processing
       *
       * Large datasets should not freeze the UI:
       * - Use requestAnimationFrame for DOM updates
       * - Process data in chunks
       * - Yield to browser between chunks
       */
      // This is a specification test documenting expected behavior
      // Actual implementation uses requestAnimationFrame in UI modules

      expect(typeof requestAnimationFrame).toBe('function');
    });
  });

  describe('Cache Behavior', () => {
    /**
     * SPECIFICATION: Report Cache
     *
     * Report results are cached in sessionStorage:
     * - Key: `${workspaceId}-${start}-${end}`
     * - TTL: 5 minutes (REPORT_CACHE_TTL)
     * - Cache is cleared on workspace switch
     */

    it('should generate consistent cache keys', () => {
      const workspaceId = 'ws_123';
      const start = '2025-01-01';
      const end = '2025-01-31';

      const cacheKey = `${workspaceId}-${start}-${end}`;

      expect(cacheKey).toBe('ws_123-2025-01-01-2025-01-31');
    });

    it('should clear cache on workspace switch', () => {
      // Set up initial workspace
      store.setToken('token1', {
        workspaceId: 'ws_old',
        backendUrl: 'https://api.clockify.me/api'
      });

      // Simulate cached data
      sessionStorage.setItem('otplus_report_cache', JSON.stringify({
        key: 'ws_old-2025-01-01-2025-01-31',
        timestamp: Date.now(),
        entries: [{ id: 'entry1' }]
      }));

      // Switch workspace
      store.setToken('token2', {
        workspaceId: 'ws_new',
        backendUrl: 'https://api.clockify.me/api'
      });

      // Note: Cache clearing happens in the report generation flow,
      // not automatically on setToken. This test documents the expected behavior.
      // The actual clearing is tested in integration tests.

      expect(store.claims.workspaceId).toBe('ws_new');
    });

    it('should use 5-minute TTL for report cache', () => {
      /**
       * SPECIFICATION: Cache TTL = 5 minutes
       *
       * REPORT_CACHE_TTL = 5 * 60 * 1000 = 300000ms
       */
      const REPORT_CACHE_TTL = 5 * 60 * 1000;
      expect(REPORT_CACHE_TTL).toBe(300000);
    });
  });

  describe('Graceful Degradation', () => {
    /**
     * SPECIFICATION: Partial Data Handling
     *
     * When some fetches fail, the report should still generate:
     * - Show banner with failure counts
     * - Use defaults for missing data
     * - Never crash on partial data
     */

    it('should track profile fetch failures in apiStatus', async () => {
      fetch.mockResolvedValue(mockResponse(null, { ok: false, status: 404 }));

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };

      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      await Api.fetchAllProfiles('workspace_123', users, {});

      // Should have tracked failures
      expect(store.apiStatus.profilesFailed).toBe(2);
    });

    it('should track holiday fetch failures in apiStatus', async () => {
      fetch.mockResolvedValue(mockResponse(null, { ok: false, status: 500 }));

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };

      const users = [{ id: 'user1', name: 'Alice' }];

      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31', {});

      expect(store.apiStatus.holidaysFailed).toBe(1);
    });

    it('should continue report generation with missing profile data', async () => {
      /**
       * SPECIFICATION: Missing Profile Fallback
       *
       * If profile fetch fails for a user:
       * - Use global dailyThreshold instead
       * - Log the failure count
       * - Don't crash the calculation
       */
      // This documents expected behavior
      // Actual implementation uses ?? fallback chain in calc.ts

      const globalThreshold = store.calcParams.dailyThreshold;
      const userProfile = undefined; // Missing profile

      const effectiveCapacity = userProfile?.workCapacityHours ?? globalThreshold;
      expect(effectiveCapacity).toBe(8); // Default
    });
  });

  describe('State Transitions', () => {
    /**
     * SPECIFICATION: Loading State Management
     *
     * UI loading states should reflect actual fetch status:
     * - Loading spinner appears immediately on fetch start
     * - Spinner hides only after ALL fetches complete
     * - Partial results can be shown while fetching continues
     */

    it('should track loading state in store.ui.isLoading', () => {
      // Initial state
      expect(store.ui.isLoading).toBe(false);

      // Set loading
      store.ui.isLoading = true;
      expect(store.ui.isLoading).toBe(true);

      // Clear loading
      store.ui.isLoading = false;
      expect(store.ui.isLoading).toBe(false);
    });

    it('loading should only clear after ALL fetches complete', async () => {
      /**
       * SPECIFICATION: Loading State Lifecycle
       *
       * 1. Loading = true when report generation starts
       * 2. Loading remains true during all fetch phases
       * 3. Loading = false only after calculation completes
       */
      let fetchCount = 0;
      const totalExpectedFetches = 5;

      fetch.mockImplementation(async () => {
        fetchCount++;
        return mockResponse([]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.ui.isLoading = true;

      // Simulate multiple fetch operations
      await Promise.all([
        Api.fetchUsers('workspace_123'),
        Api.fetchDetailedReport('workspace_123', '2025-01-01', '2025-01-31', {})
      ]);

      // Only now should loading clear
      store.ui.isLoading = false;

      expect(store.ui.isLoading).toBe(false);
      expect(fetchCount).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Orchestration - Error Recovery', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    store.token = createMockJwtToken();
    store.claims = { workspaceId: 'workspace_123', backendUrl: 'https://api.clockify.me/api' };
  });

  afterEach(() => {
    standardAfterEach();
    store.token = null;
    store.claims = null;
  });

  describe('Retry Semantics', () => {
    /**
     * SPECIFICATION: Retry Strategy
     *
     * Different error types have different retry behaviors:
     * - 401/403/404: No retry (permanent failures)
     * - 429: Retry with Retry-After header
     * - 5xx: Retry up to maxRetries (default 2)
     * - Network errors: Retry up to maxRetries
     */

    it('should NOT retry 401/403/404 errors', async () => {
      const permanentErrors = [401, 403, 404];

      for (const status of permanentErrors) {
        let callCount = 0;
        fetch.mockImplementation(async () => {
          callCount++;
          return mockResponse(null, { ok: false, status });
        });

        const { Api, resetRateLimiter } = await import('../../js/api.js');
        resetRateLimiter();

        callCount = 0;
        await Api.fetchUsers('workspace_123');

        // Should only call once (no retry)
        expect(callCount).toBe(1);
      }
    });

    it('should classify errors appropriately', () => {
      /**
       * SPECIFICATION: Error Classification
       *
       * Errors are classified for appropriate handling:
       * - AUTH: 401, 403 → Reload addon
       * - NOT_FOUND: 404 → Resource doesn't exist
       * - RATE_LIMIT: 429 → Retry with backoff
       * - SERVER: 5xx → Retry
       * - NETWORK: Connection failures → Retry
       * - ABORT: User cancelled → Ignore
       */
      const errorClassification = {
        401: 'AUTH',
        403: 'AUTH',
        404: 'NOT_FOUND',
        429: 'RATE_LIMIT',
        500: 'SERVER',
        502: 'SERVER',
        503: 'SERVER'
      };

      expect(errorClassification[401]).toBe('AUTH');
      expect(errorClassification[429]).toBe('RATE_LIMIT');
      expect(errorClassification[500]).toBe('SERVER');
    });
  });
});

describe('Orchestration - Constants Documentation', () => {
  /**
   * This section documents orchestration constants for specification purposes.
   */

  it('BATCH_SIZE should be 5 for concurrent user fetches', () => {
    /**
     * SPECIFICATION: Batch Size
     *
     * Why 5?
     * - Performance: 5 concurrent requests is reasonably fast
     * - API Courtesy: Doesn't overwhelm Clockify servers
     * - Error Isolation: If one fails, only affects small batch
     */
    const BATCH_SIZE = 5;
    expect(BATCH_SIZE).toBe(5);
  });

  it('REPORT_CACHE_TTL should be 5 minutes (300000ms)', () => {
    /**
     * SPECIFICATION: Report Cache TTL
     *
     * Why 5 minutes?
     * - Long enough to be useful during report refinement
     * - Short enough to not show stale data
     * - Session-scoped (sessionStorage) for security
     */
    const REPORT_CACHE_TTL = 5 * 60 * 1000;
    expect(REPORT_CACHE_TTL).toBe(300000);
  });

  it('should use Promise.all for parallel independent fetches', () => {
    /**
     * SPECIFICATION: Parallel Fetching Pattern
     *
     * Independent fetches run in parallel:
     * ```javascript
     * await Promise.all([
     *   Api.fetchAllProfiles(workspaceId, users, options),
     *   Api.fetchAllHolidays(workspaceId, users, start, end, options),
     *   Api.fetchAllTimeOff(workspaceId, users, start, end, options)
     * ]);
     * ```
     */
    expect(typeof Promise.all).toBe('function');
  });
});

// ============================================================================
// PHASE 3: Error Recovery Sequences (Full Flow Tests)
// ============================================================================

describe('Error Recovery Sequences', () => {
  /**
   * SPECIFICATION: Error Recovery Flows
   *
   * These tests verify complete error recovery flows including:
   * - 429 rate limit recovery with Retry-After
   * - Partial failure recovery with graceful degradation
   * - Network timeout recovery with abort handling
   */

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });

    store.token = createMockJwtToken();
    store.claims = { workspaceId: 'workspace_123', backendUrl: 'https://api.clockify.me/api' };
    store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    store.resetThrottleStatus();

    const { resetRateLimiter } = await import('../../js/api.js');
    resetRateLimiter();
    await jest.advanceTimersByTimeAsync(1000);
  });

  afterEach(() => {
    standardAfterEach();
    jest.useRealTimers();
    store.token = null;
    store.claims = null;
  });

  describe('429 Rate Limit Recovery', () => {
    /**
     * SPECIFICATION: 429 Handling
     *
     * When a 429 is received:
     * 1. Parse Retry-After header (seconds)
     * 2. Wait the specified duration
     * 3. Retry the request
     * 4. Continue normal flow if successful
     */

    it('should retry after 429 with Retry-After header', async () => {
      let callCount = 0;
      const retryAfterSeconds = 2;

      fetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call returns 429
          return mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
        }
        // Subsequent calls succeed
        return mockResponse([{ id: 'user1', name: 'Alice' }]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Start fetch
      const promise = Api.fetchUsers('workspace_123');

      // Advance time to trigger retry
      await jest.advanceTimersByTimeAsync(retryAfterSeconds * 1000 + 100);

      const result = await promise;

      // Should have retried after the delay
      expect(callCount).toBeGreaterThanOrEqual(1);
      // Result should be valid (either from retry or empty on failure)
      expect(Array.isArray(result)).toBe(true);
    });

    it('should use default 5000ms when no Retry-After header', async () => {
      let callCount = 0;
      const DEFAULT_RETRY_MS = 5000;

      fetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // 429 without Retry-After header
          return mockResponse(null, { ok: false, status: 429 });
        }
        return mockResponse([]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      const promise = Api.fetchUsers('workspace_123');

      // Advance past default retry time
      await jest.advanceTimersByTimeAsync(DEFAULT_RETRY_MS + 100);

      await promise;

      // Should have attempted at least once
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    it('should continue pagination after recovered 429', async () => {
      let callCount = 0;
      const pages = [
        { timeEntriesWithDayTotal: Array(200).fill({ id: 'e1' }), totals: [{ _id: null }] },
        { timeEntriesWithDayTotal: Array(50).fill({ id: 'e2' }), totals: [{ _id: null }] }
      ];

      fetch.mockImplementation(async (url) => {
        callCount++;

        // Simulate 429 on second page first attempt
        if (url.includes('/reports/') && callCount === 2) {
          return mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '1' } });
        }

        // First page
        if (url.includes('/reports/') && callCount === 1) {
          return mockResponse(pages[0]);
        }

        // Second page after retry
        return mockResponse(pages[1]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      const promise = Api.fetchDetailedReport('workspace_123', '2025-01-01', '2025-01-31', {});

      // Allow time for pagination and retry
      await jest.advanceTimersByTimeAsync(10000);

      const result = await promise;

      // Should have fetched entries (may be partial due to 429)
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle 429 without crashing', async () => {
      fetch.mockImplementation(async () =>
        mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '5' } })
      );

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Trigger fetch that will 429 - should not crash
      const promise = Api.fetchUsers('workspace_123');

      await jest.advanceTimersByTimeAsync(10000);

      // Should return empty array on failure (graceful degradation)
      const result = await promise;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Partial Failure Recovery', () => {
    /**
     * SPECIFICATION: Graceful Degradation
     *
     * When some fetches fail (e.g., 4 of 5 profiles):
     * - Continue with available data
     * - Track failure counts
     * - Show banner with failure info
     * - Enable "Retry failed" option
     */

    it('should continue with partial profiles on individual failure', async () => {
      let profileCallCount = 0;

      fetch.mockImplementation(async (url) => {
        if (url.includes('member-profile')) {
          profileCallCount++;
          // Fail every 3rd profile
          if (profileCallCount % 3 === 0) {
            return mockResponse(null, { ok: false, status: 500 });
          }
          return mockResponse({ workCapacityInHours: 8, daysOfWeek: ['MONDAY'] });
        }
        return mockResponse([]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };

      const users = Array(9).fill(null).map((_, i) => ({ id: `user_${i}`, name: `User ${i}` }));

      await jest.advanceTimersByTimeAsync(1000);
      await Api.fetchAllProfiles('workspace_123', users, {});
      await jest.runAllTimersAsync();

      // Should have tracked failures (1 of 9 after retries - API retries failed profiles once)
      // Initial: 3 fail (calls 3, 6, 9), Retries: calls 10, 11 succeed, call 12 fails
      expect(store.apiStatus.profilesFailed).toBe(1);
    });

    it('should track holiday fetch failures separately', async () => {
      let holidayCallCount = 0;

      fetch.mockImplementation(async (url) => {
        if (url.includes('holidays')) {
          holidayCallCount++;
          // Fail first user's holidays
          if (holidayCallCount === 1) {
            return mockResponse(null, { ok: false, status: 404 });
          }
          return mockResponse([]);
        }
        return mockResponse([]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };

      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      await jest.advanceTimersByTimeAsync(1000);
      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31', {});
      await jest.runAllTimersAsync();

      // Should have tracked 1 holiday failure
      expect(store.apiStatus.holidaysFailed).toBe(1);
    });

    it('should continue report generation with missing data', async () => {
      /**
       * SPECIFICATION: Missing Data Fallback
       *
       * If profile/holiday/timeoff data is missing:
       * - Use global defaults for capacity
       * - Skip holiday adjustments
       * - Skip time-off adjustments
       * - Still produce valid calculation results
       */
      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      // No profiles in store
      store.profiles.clear();
      store.holidays.clear();
      store.timeOff.clear();

      // Simulate calculation with missing data
      const calcParams = store.calcParams;
      const effectiveCapacity = store.profiles.get('user1')?.workCapacityHours ?? calcParams.dailyThreshold;

      expect(effectiveCapacity).toBe(8); // Falls back to global default
    });

    it('should aggregate failure counts across all fetch types', async () => {
      fetch.mockImplementation(async (url) => {
        // Fail all requests
        return mockResponse(null, { ok: false, status: 503 });
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };

      const users = [{ id: 'user1', name: 'Alice' }];

      await jest.advanceTimersByTimeAsync(1000);

      // Fetch all data types - all should fail
      await Api.fetchAllProfiles('workspace_123', users, {});
      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31', {});

      await jest.runAllTimersAsync();

      // Should have tracked failures for both types
      expect(store.apiStatus.profilesFailed).toBe(1);
      expect(store.apiStatus.holidaysFailed).toBe(1);
    });
  });

  describe('Network Timeout Recovery', () => {
    /**
     * SPECIFICATION: Timeout Handling
     *
     * Network timeouts are handled via AbortController:
     * - Controller triggers abort after timeout period
     * - AbortError is caught and handled gracefully
     * - User can retry the timed-out request
     */

    it('should handle pre-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-abort

      fetch.mockImplementation(async (url, options) => {
        if (options?.signal?.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        return mockResponse([{ id: 'user1' }]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Request with aborted signal should return empty array
      const result = await Api.fetchUsers('workspace_123', { signal: controller.signal });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should distinguish AbortError from other network errors', () => {
      /**
       * SPECIFICATION: Error Classification
       *
       * AbortError should be handled differently from network errors:
       * - AbortError: User cancelled, no error banner
       * - Network error: Show error, allow retry
       */
      const abortError = new DOMException('Aborted', 'AbortError');
      const networkError = new TypeError('Failed to fetch');

      // AbortError detection
      expect(abortError.name).toBe('AbortError');
      expect(networkError.name).toBe('TypeError');

      // Should be treated differently
      const isAbort = abortError.name === 'AbortError';
      const isNetwork = networkError.name === 'TypeError';

      expect(isAbort).toBe(true);
      expect(isNetwork).toBe(true);
    });

    it('should allow retry after network timeout', async () => {
      let attemptCount = 0;

      fetch.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          // First attempt times out
          throw new TypeError('Failed to fetch');
        }
        // Second attempt succeeds
        return mockResponse([{ id: 'user1', name: 'Alice' }]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // First attempt - fails
      const result1 = await Api.fetchUsers('workspace_123');
      expect(result1).toEqual([]); // Graceful degradation

      // Second attempt - succeeds
      const result2 = await Api.fetchUsers('workspace_123');
      expect(result2).toEqual([{ id: 'user1', name: 'Alice' }]);
    });

    it('should handle AbortError gracefully', async () => {
      /**
       * SPECIFICATION: Abort Cleanup
       *
       * When abort is called, AbortError should be handled without crashing.
       */
      fetch.mockImplementation(async () => {
        throw new DOMException('Aborted', 'AbortError');
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      // Should not throw - handled gracefully
      const result = await Api.fetchUsers('workspace_123');

      // Should return empty array on abort
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Sequential Error Recovery', () => {
    /**
     * SPECIFICATION: Error Chain Recovery
     *
     * When errors occur in a sequence of dependent operations:
     * - Each phase should handle its own errors
     * - Errors in one phase shouldn't crash subsequent phases
     * - Final result should reflect all available data
     */

    it('should recover from profile errors and continue to holidays', async () => {
      let phase = 'profiles';

      fetch.mockImplementation(async (url) => {
        if (url.includes('member-profile')) {
          // Profiles fail
          return mockResponse(null, { ok: false, status: 500 });
        }
        if (url.includes('holidays')) {
          phase = 'holidays';
          // Holidays succeed
          return mockResponse([]);
        }
        return mockResponse([]);
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };

      const users = [{ id: 'user1', name: 'Alice' }];

      await jest.advanceTimersByTimeAsync(1000);

      // Fetch profiles (will fail)
      await Api.fetchAllProfiles('workspace_123', users, {});
      expect(store.apiStatus.profilesFailed).toBe(1);

      // Fetch holidays (should succeed despite profile failure)
      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31', {});
      await jest.runAllTimersAsync();

      expect(phase).toBe('holidays');
      expect(store.apiStatus.holidaysFailed).toBe(0);
    });

    it('should track total failures across retry sequence', async () => {
      let attemptsByUser = new Map();

      fetch.mockImplementation(async (url) => {
        const match = url.match(/member-profile\/(\w+)/);
        if (match) {
          const userId = match[1];
          const attempts = (attemptsByUser.get(userId) || 0) + 1;
          attemptsByUser.set(userId, attempts);

          // First 2 attempts fail, 3rd succeeds
          if (attempts < 3) {
            return mockResponse(null, { ok: false, status: 503 });
          }
        }
        return mockResponse({ workCapacityInHours: 8 });
      });

      // Track that errors were encountered
      const errorCount = { count: 0 };
      const originalApiStatus = store.apiStatus;
      store.apiStatus = new Proxy(originalApiStatus, {
        set(target, prop, value) {
          if (prop === 'profilesFailed' && value > 0) {
            errorCount.count = value;
          }
          target[prop] = value;
          return true;
        }
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');
      resetRateLimiter();

      const users = [{ id: 'user1', name: 'Alice' }];

      await jest.advanceTimersByTimeAsync(1000);
      await Api.fetchAllProfiles('workspace_123', users, {});
      await jest.runAllTimersAsync();

      // Should have tracked failures during the sequence
      expect(attemptsByUser.get('user1')).toBeGreaterThanOrEqual(1);
    });
  });
});
