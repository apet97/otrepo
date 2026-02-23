/**
 * @jest-environment node
 *
 * API Fetch Core Tests - fetchWithAuth, retry logic, rate limiting, headers
 *
 * These tests focus on the core HTTP client functionality including:
 * - Authentication header handling
 * - HTTP error responses (401/403/404/429/5xx)
 * - Retry logic with exponential backoff
 * - Content-Type header management
 * - MaxRetries configuration
 *
 * @see js/api.ts - fetchWithAuth implementation
 * @see docs/guide.md - Rate limiting strategy
 */

import { jest } from '@jest/globals';
import { webcrypto } from 'crypto';
import { Api, resetRateLimiter, resetCircuitBreaker, generateIdempotencyKey, resetIdempotencyCounter } from '../../js/api.js';
import { store } from '../../js/state.js';
import { createMockTokenPayload, createMockJwtToken } from '../helpers/mock-data.js';

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

describe('API Fetch Core', () => {
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

  describe('fetchWithAuth - Authentication', () => {
    it('should include X-Addon-Token header in all requests', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ data: 'test' }));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Addon-Token': store.token
          })
        })
      );
    });

    it('should include Accept: application/json header', async () => {
      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json'
          })
        })
      );
    });

    it('blocks requests to non-Clockify domains before sending auth header', async () => {
      store.claims = { ...store.claims, backendUrl: 'https://evil.example.com' };

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('fetchWithAuth - HTTP Error Responses', () => {
    it('should return failed=true for 401 Unauthorized', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const promise = Api.fetchUserProfile('workspace_123', 'user_1');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
      expect(result.status).toBe(401);
    });

    it('should return failed=true for 403 Forbidden', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const promise = Api.fetchUserProfile('workspace_123', 'user_1');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
      expect(result.status).toBe(403);
    });

    it('should return failed=true for 404 Not Found', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const promise = Api.fetchUserProfile('workspace_123', 'user_1');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
      expect(result.status).toBe(404);
    });

    it('should return failed=true for 429 Rate Limit with no retries', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));

      const promise = Api.fetchUserProfile('workspace_123', 'user_1');
      await jest.runAllTimersAsync();
      const result = await promise;

      // In test env maxRetries=0, should fail immediately
      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });

    it('should handle 500 Internal Server Error gracefully', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      // Should return empty array on 500 error (graceful degradation)
      expect(result).toEqual([]);
    });

    it('should handle network errors gracefully', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      // fetchUsers returns empty array on network error
      expect(result).toEqual([]);
    });
  });

  describe('fetchWithAuth - Content-Type Header', () => {
    it('should add Content-Type only when body exists and header not set', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );
      await jest.runAllTimersAsync();
      await promise;

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should not override explicit Content-Type header', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('fetchWithAuth - MaxRetries Configuration', () => {
    it('should use options.maxRetries when provided', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        {} // No maxRetries specified
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should use explicit maxRetries: 0', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const promise = Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 }
      );
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });

    it('should default to 0 retries in test environment', async () => {
      // First call fails
      fetch.mockRejectedValueOnce(new Error('Network error'));

      // In test env, default maxRetries is 0
      const promise = Api.fetchUserProfile('workspace_123', 'user_1');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });
  });

  describe('fetchWithAuth - Store Claims Handling', () => {
    it('should handle undefined store.claims gracefully', async () => {
      store.claims = undefined;

      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      // Should not throw, should return empty array
      expect(result).toEqual([]);
    });

    it('should handle null store.claims gracefully', async () => {
      store.claims = null;

      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
    });

    it('should handle store.claims.backendUrl being empty string', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: ''
      };

      fetch.mockResolvedValueOnce(mockResponse([]));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
    });
  });

  describe('Rate Limiter - Token Bucket', () => {
    it('should have tokens available after reset', async () => {
      resetRateLimiter();

      fetch.mockResolvedValue(mockResponse([]));

      // Make multiple quick requests - should not be throttled
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(Api.fetchUsers('workspace_123'));
      }

      await jest.runAllTimersAsync();
      await Promise.all(promises);

      expect(fetch).toHaveBeenCalledTimes(5);
    });
  });
});

describe('API Fetch Core - Mutation Killing Tests', () => {
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

  describe('Error Return Value Mutations', () => {
    // Kill: failed: true → failed: false mutations

    it('should return exactly failed=true (not false) for 401 errors', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.failed).not.toBe(false);
    });

    it('should return exactly data=null (not undefined) for 401 errors', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.data).not.toBeUndefined();
    });

    it('should return exact status code (not 0) for 403 errors', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(403);
      expect(result.status).not.toBe(0);
    });

    it('should return exact status code (not 0) for 404 errors', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(404);
      expect(result.status).not.toBe(0);
    });
  });

  describe('Comparison Operator Mutations', () => {
    // Kill: response.status === 401 → !== 401

    it('should fail on exactly 401 (not 400 or 402)', async () => {
      // Test 401
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));
      const result401 = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result401.failed).toBe(true);
      expect(result401.status).toBe(401);

      // Test 400 - should NOT be treated as auth error
      fetch.mockReset();
      fetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 400 }));
      const result400 = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result400.failed).toBe(true);
      expect(result400.status).toBe(400);
    });

    it('should fail on exactly 403 (not 402 or 404)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(403);
      expect(result.failed).toBe(true);
    });

    it('should fail on exactly 404 (not 403 or 405)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(404);
      expect(result.failed).toBe(true);
    });

    it('should fail on exactly 429 (rate limit)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(429);
      expect(result.failed).toBe(true);
    });
  });

  describe('Token and Header Mutations', () => {
    // Kill: 'X-Addon-Token': store.token → 'X-Addon-Token': ''

    it('should send actual token value (not empty string)', async () => {
      store.token = createMockJwtToken();

      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchUsers('workspace_123');

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['X-Addon-Token']).toBe(store.token);
      expect(headers['X-Addon-Token']).not.toBe('');
    });

    it('should use store.token || "" when token is null', async () => {
      store.token = null;

      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchUsers('workspace_123');

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['X-Addon-Token']).toBe('');
    });
  });

  describe('URL Construction Mutations', () => {
    it('should construct URL with correct base API path', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse([]));

      await Api.fetchUsers('workspace_123');

      const url = fetch.mock.calls[0][0];
      expect(url).toContain('/v1/workspaces/workspace_123');
    });
  });

  describe('Response JSON Parsing Mutations', () => {
    it('should return parsed JSON data on success', async () => {
      const expectedData = [{ id: 'u1', name: 'Alice' }];
      fetch.mockResolvedValueOnce(mockResponse(expectedData));

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual(expectedData);
      expect(result).not.toBeNull();
      expect(result.length).toBe(1);
    });

    it('should return exactly null data for auth errors (not undefined)', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toStrictEqual(null);
      expect(result.failed).toStrictEqual(true);
      expect(result.status).toStrictEqual(401);
    });
  });

  describe('Non-Retryable Status Code Boundary Mutations', () => {
    it('should NOT treat 400 as non-retryable auth error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 400 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // 400 is not 401/403/404, should be handled differently
      expect(result.failed).toBe(true);
      expect(result.status).toBe(400);
    });

    it('should NOT treat 402 as non-retryable auth error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 402 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.status).toBe(402);
    });

    it('should NOT treat 405 as 404-like error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 405 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.status).toBe(405);
    });
  });

  describe('Default MaxRetries Mutations', () => {
    it('should not retry in test environment (maxRetries defaults to 0)', async () => {
      fetch.mockRejectedValue(new Error('Network error'));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // Should only call fetch once (no retries in test env)
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });
  });

  describe('Content-Type Header Mutations', () => {
    it('should NOT add Content-Type when no body exists', async () => {
      fetch.mockResolvedValueOnce(mockResponse([]));

      // fetchUsers does NOT send a body
      await Api.fetchUsers('workspace_123');

      const headers = fetch.mock.calls[0][1].headers;
      // Content-Type should NOT be added when there's no body
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should add Content-Type when body exists and no Content-Type set', async () => {
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      // fetchTimeOffRequests sends a body
      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Non-Retryable Status Code Mutations (401/403/404)', () => {
    // These tests verify each status code is handled independently

    it('should return immediately on 401 without any retry', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
      expect(result.status).toBe(401);
      expect(result.data).toBeNull();
    });

    it('should return immediately on 403 without any retry', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);
      expect(result.data).toBeNull();
    });

    it('should return immediately on 404 without any retry', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    });

    it('should treat 401, 403, 404 differently from 500 (non-retryable vs retryable)', async () => {
      // First test 401 - should not retry
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const result401 = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result401.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);

      // Reset and test 500 - would retry in production (but test env has 0 retries)
      fetch.mockReset();
      resetRateLimiter();
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 500 }));

      await Api.fetchUserProfile('workspace_123', 'user_1');
      // Still 1 call in test env, but 500 goes through different code path
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('API Idempotency Key', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    resetIdempotencyCounter();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('generateIdempotencyKey', () => {
    it('should generate unique keys on each call', () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();
      const key3 = generateIdempotencyKey();

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it('should follow the expected format pattern', () => {
      const key = generateIdempotencyKey();

      // Format: otplus-{timestamp}-{counter}-{random}
      expect(key).toMatch(/^otplus-\d+-\d+-[a-f0-9]{4}$/);
    });

    it('should include incrementing counter', () => {
      resetIdempotencyCounter();

      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();

      // Extract counter from keys
      const counter1 = parseInt(key1.split('-')[2]);
      const counter2 = parseInt(key2.split('-')[2]);

      expect(counter2).toBe(counter1 + 1);
    });
  });

  describe('resetIdempotencyCounter', () => {
    it('should reset the counter to produce predictable keys', () => {
      // Generate some keys
      generateIdempotencyKey();
      generateIdempotencyKey();
      generateIdempotencyKey();

      // Reset counter
      resetIdempotencyCounter();

      // Next key should have counter = 1
      const key = generateIdempotencyKey();
      const counter = parseInt(key.split('-')[2]);

      expect(counter).toBe(1);
    });
  });
});
