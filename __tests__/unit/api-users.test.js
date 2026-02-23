/**
 * @jest-environment jsdom
 *
 * API Users Tests - fetchUsers, fetchUserProfile, fetchAllProfiles
 *
 * These tests focus on user-related API operations including:
 * - Fetching workspace users
 * - Fetching individual user profiles
 * - Batched profile fetching
 * - Error tracking for failed profiles
 *
 * @see js/api.ts - User API operations
 * @see docs/guide.md - API constraints
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

describe('API Users', () => {
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

  describe('fetchUsers', () => {
    it('should fetch workspace users', async () => {
      const mockUsers = generateMockUsers(3);
      fetch.mockResolvedValueOnce(mockResponse(mockUsers));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://api.clockify.me/v1/workspaces/workspace_123/users',
        expect.any(Object)
      );
      expect(result).toEqual(mockUsers);
    });

    it('should return empty array on 403 error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
    });

    it('should return empty array on 401 error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 401 }));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
    });

    it('should return empty array when data is null', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null));

      const promise = Api.fetchUsers('workspace_123');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual([]);
    });
  });

  describe('fetchUserProfile', () => {
    it('should fetch single user profile', async () => {
      const mockProfile = {
        workCapacity: 'PT8H',
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      };

      fetch.mockResolvedValueOnce(mockResponse(mockProfile));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.clockify.me/v1/workspaces/workspace_123/member-profile/user_1',
        expect.any(Object)
      );
      expect(result.data).toEqual(mockProfile);
      expect(result.failed).toBe(false);
    });

    it('should return failed=true on 403 error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);
    });

    it('should return failed=true on 404 error', async () => {
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 404 }));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
    });
  });

  describe('fetchAllProfiles', () => {
    it('should fetch all profiles in batches', async () => {
      const users = generateMockUsers(10);

      fetch.mockResolvedValue(mockResponse({
        workCapacity: 'PT8H',
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      }));

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(10);
      expect(store.apiStatus.profilesFailed).toBe(0);
    });

    it('should track failed profile fetches', async () => {
      const users = generateMockUsers(3);

      // First succeeds, second fails, third succeeds
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));
      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT8H', workingDays: [] }));

      await Api.fetchAllProfiles('workspace_123', users);

      expect(store.apiStatus.profilesFailed).toBe(1);
    });

    it('should skip failed profiles and continue', async () => {
      const users = generateMockUsers(3);

      fetch.mockResolvedValueOnce(mockResponse(null, { ok: false, status: 403 }));
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT7H', workingDays: [] }));
      fetch.mockResolvedValueOnce(mockResponse({ workCapacity: 'PT6H', workingDays: [] }));

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.size).toBe(2); // Only 2 succeeded
      expect(store.apiStatus.profilesFailed).toBe(1);
    });

    it('should handle empty users array', async () => {
      const users = [];

      fetch.mockImplementation(() => {
        throw new Error('Should not be called for empty users');
      });

      const profiles = await Api.fetchAllProfiles('workspace_123', users);

      expect(profiles.size).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
