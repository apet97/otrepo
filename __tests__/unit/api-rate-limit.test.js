/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { createMockJwtToken } from '../helpers/mock-data.js';

let Api;
let store;

describe('API Rate Limiting', () => {
    let originalEnv;

    beforeAll(async () => {
        // Mock State
        const token = createMockJwtToken();
        jest.unstable_mockModule('../../js/state.js', () => ({
            store: {
                token,
                claims: { backendUrl: 'https://api.clockify.me' },
                apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 },
                config: {}
            }
        }));

        // Import Api after mocking
        const apiModule = await import('../../js/api.js');
        Api = apiModule.Api;

        // Import store mock for config tests
        const stateModule = await import('../../js/state.js');
        store = stateModule.store;
    });

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

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn();
        jest.useFakeTimers({ advanceTimers: true });
        originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production'; // Enable retries by default
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        jest.useRealTimers();
    });

    it('should retry on 429 Too Many Requests', async () => {
        global.fetch
            .mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429, headers: { 'Retry-After': '1' } }))
            .mockResolvedValueOnce(mockResponse({ id: 'user1' }));

        const fetchPromise = Api.fetchUserProfile('ws1', 'user1');
        
        // Fast-forward time (1s)
        await jest.advanceTimersByTimeAsync(1000);
        
        await fetchPromise;

        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    it('should use default wait time if Retry-After is missing', async () => {
        global.fetch
            .mockResolvedValueOnce(mockResponse(null, { ok: false, status: 429 }))
            .mockResolvedValueOnce(mockResponse({ id: 'user1' }));

        const fetchPromise = Api.fetchUserProfile('ws1', 'user1');
        
        // Advance timers by default wait time (5000ms)
        await jest.advanceTimersByTimeAsync(5000);
        
        await fetchPromise;
        
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    describe('configurable rate limiter', () => {
        it('should accept custom rateLimitCapacity on store.config', () => {
            expect(() => {
                store.config = { ...store.config, rateLimitCapacity: 10 };
            }).not.toThrow();
            expect(store.config.rateLimitCapacity).toBe(10);
        });

        it('should accept custom rateLimitRefillMs on store.config', () => {
            expect(() => {
                store.config = { ...store.config, rateLimitRefillMs: 2000 };
            }).not.toThrow();
            expect(store.config.rateLimitRefillMs).toBe(2000);
        });
    });

    describe('configurable circuit breaker', () => {
        it('should accept custom circuitBreakerFailureThreshold on store.config', () => {
            expect(() => {
                store.config = { ...store.config, circuitBreakerFailureThreshold: 2 };
            }).not.toThrow();
            expect(store.config.circuitBreakerFailureThreshold).toBe(2);
        });

        it('should accept custom circuitBreakerResetMs on store.config', () => {
            expect(() => {
                store.config = { ...store.config, circuitBreakerResetMs: 10000 };
            }).not.toThrow();
            expect(store.config.circuitBreakerResetMs).toBe(10000);
        });
    });
});
