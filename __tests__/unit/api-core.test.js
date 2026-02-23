/**
 * @jest-environment node
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';
import { createMockJwtToken } from '../helpers/mock-data.js';

// Set up Web Crypto API for Node environment
global.crypto = webcrypto;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

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

describe('API Module - Core Behaviors', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.clearAllMocks();
    resetRateLimiter();
    resetCircuitBreaker();
    store.resetThrottleStatus();
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me',
      reportsUrl: 'https://reports.api.clockify.me'
    };
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    standardAfterEach();
    store.token = null;
    store.claims = null;
    global.fetch = mockFetch;
  });

  it('fetchUsers returns data and includes auth header', async () => {
    const users = [
      { id: 'user1', name: 'Alice' },
      { id: 'user2', name: 'Bob' }
    ];

    mockFetch.mockResolvedValue(mockResponse(users));

    const promise = Api.fetchUsers('ws_test');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual(users);
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-Addon-Token']).toBe(store.token);
  });

  it('fetchUsers returns empty array on failure', async () => {
    mockFetch.mockResolvedValue(mockResponse(null, { ok: false, status: 500 }));

    const promise = Api.fetchUsers('ws_test');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual([]);
  });

  it('fetchEntries attaches user metadata to entries', async () => {
    const users = [{ id: 'user1', name: 'Alice' }];

    mockFetch.mockResolvedValue(mockResponse([
      {
        id: 'entry1',
        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z' }
      }
    ]));

    const promise = Api.fetchEntries(
      'ws_test',
      users,
      '2025-01-01T00:00:00Z',
      '2025-01-31T23:59:59Z'
    );
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result[0].userId).toBe('user1');
    expect(result[0].userName).toBe('Alice');
  });

  it('fetchUserProfile marks non-OK responses as failed', async () => {
    mockFetch.mockResolvedValue(mockResponse(null, { ok: false, status: 404 }));

    const promise = Api.fetchUserProfile('ws_test', 'user1');
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.failed).toBe(true);
    expect(result.status).toBe(404);
  });

  it('fetchTimeOffRequests uses POST and passes users list', async () => {
    mockFetch.mockResolvedValue(mockResponse({ requests: [] }));

    const promise = Api.fetchTimeOffRequests('ws_test', ['user1'], '2025-01-01', '2025-01-31');
    await jest.runAllTimersAsync();
    await promise;
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.users).toEqual(['user1']);
  });
});
