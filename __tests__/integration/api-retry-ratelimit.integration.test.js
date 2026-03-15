/**
 * @jest-environment node
 *
 * Integration test: API retry + rate limiting end-to-end with fake timers.
 * Tests fetchWithAuth retry behavior, 429 handling, and circuit breaker.
 * Addresses: C11
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store, resetFallbackStorage } from '../../js/state.js';
import { createMockJwtToken, createMockTokenPayload } from '../helpers/mock-data.js';
import { mockResponse } from '../helpers/api-test-helpers.js';

// Provide crypto for Node environment
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

global.fetch = jest.fn();

describe('integration: API retry + rate limiting', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });

    const mockPayload = createMockTokenPayload();
    store.token = createMockJwtToken();
    store.claims = mockPayload;
    store.resetApiStatus();

    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    resetFallbackStorage();

    // Allow timers to settle
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('429 retry behavior', () => {
    // Use fetchTimeOffRequests which correctly forwards maxRetries to fetchWithAuth
    it('should retry after 429 and succeed on second attempt', async () => {
      // First call: 429 with 1-second Retry-After
      fetch.mockResolvedValueOnce(
        mockResponse(null, {
          ok: false,
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      );
      // Second call: success
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        store.claims.workspaceId,
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      await jest.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.failed).toBe(false);
    });

    it('should fail when all retries exhausted on 429', async () => {
      // All calls return 429
      fetch.mockResolvedValue(
        mockResponse(null, {
          ok: false,
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      );

      const promise = Api.fetchTimeOffRequests(
        store.claims.workspaceId,
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      await jest.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });

    it('should respect Retry-After header value', async () => {
      // 429 with 3-second Retry-After
      fetch.mockResolvedValueOnce(
        mockResponse(null, {
          ok: false,
          status: 429,
          headers: { 'Retry-After': '3' },
        })
      );
      fetch.mockResolvedValueOnce(mockResponse({ requests: [] }));

      const promise = Api.fetchTimeOffRequests(
        store.claims.workspaceId,
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 1 }
      );

      // After 2 seconds: retry hasn't fired yet
      await jest.advanceTimersByTimeAsync(2000);
      expect(fetch).toHaveBeenCalledTimes(1);

      // After 4 seconds total: retry should have fired
      await jest.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.failed).toBe(false);
    });

    it('should fail immediately on 429 with no retries (default test env)', async () => {
      fetch.mockResolvedValueOnce(
        mockResponse(null, { ok: false, status: 429 })
      );

      // fetchUserProfile doesn't forward maxRetries → defaults to 0 in test env
      const result = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_1'
      );

      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-retryable errors', () => {
    it('should not retry on 401 unauthorized', async () => {
      fetch.mockResolvedValueOnce(
        mockResponse(null, { ok: false, status: 401 })
      );

      const result = await Api.fetchTimeOffRequests(
        store.claims.workspaceId,
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 2 }
      );

      expect(result.failed).toBe(true);
      expect(result.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 forbidden', async () => {
      fetch.mockResolvedValueOnce(
        mockResponse(null, { ok: false, status: 403 })
      );

      const result = await Api.fetchTimeOffRequests(
        store.claims.workspaceId,
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 2 }
      );

      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after consecutive failures and return 503', async () => {
      // Generate 5 consecutive retryable failures to trip the circuit breaker
      fetch.mockResolvedValue(
        mockResponse(null, {
          ok: false,
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      );

      // Make 5 requests that all fail (default 0 retries, each triggers recordFailure)
      for (let i = 0; i < 5; i++) {
        const result = await Api.fetchUserProfile(
          store.claims.workspaceId,
          `user_${i}`
        );
        expect(result.failed).toBe(true);
        await jest.advanceTimersByTimeAsync(100);
      }

      // 6th request should be blocked by circuit breaker
      const blocked = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_blocked'
      );
      expect(blocked.failed).toBe(true);
      expect(blocked.status).toBe(503);
    });

    it('should recover from OPEN to CLOSED after reset timeout + successes', async () => {
      // Trip the circuit breaker
      fetch.mockResolvedValue(
        mockResponse(null, {
          ok: false,
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      );

      for (let i = 0; i < 5; i++) {
        await Api.fetchUserProfile(store.claims.workspaceId, `user_${i}`);
        await jest.advanceTimersByTimeAsync(100);
      }

      // Advance past the 30-second reset timeout
      await jest.advanceTimersByTimeAsync(31000);

      // Now switch to success responses for recovery
      fetch.mockResolvedValue(
        mockResponse({ workCapacity: 8 })
      );

      // HALF_OPEN: First success
      const result1 = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_recovery_1'
      );
      expect(result1.failed).toBe(false);

      // HALF_OPEN: Second success → should close circuit
      const result2 = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_recovery_2'
      );
      expect(result2.failed).toBe(false);

      // Should be back to normal CLOSED state
      const result3 = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_normal'
      );
      expect(result3.failed).toBe(false);
    });

    it('should reset circuit breaker via resetCircuitBreaker()', async () => {
      // Trip the breaker
      fetch.mockResolvedValue(
        mockResponse(null, { ok: false, status: 429 })
      );

      for (let i = 0; i < 5; i++) {
        await Api.fetchUserProfile(store.claims.workspaceId, `user_${i}`);
        await jest.advanceTimersByTimeAsync(100);
      }

      // Reset it
      resetCircuitBreaker();

      // Should work again immediately
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 8 }));
      const result = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_after_reset'
      );
      expect(result.failed).toBe(false);
    });
  });

  describe('successful requests', () => {
    it('should return data on 200 success', async () => {
      fetch.mockResolvedValueOnce(
        mockResponse({ workCapacity: 8, workingDays: ['MONDAY', 'TUESDAY'] })
      );

      const result = await Api.fetchUserProfile(
        store.claims.workspaceId,
        'user_1'
      );

      expect(result.failed).toBe(false);
      expect(result.data).toBeTruthy();
    });
  });
});
