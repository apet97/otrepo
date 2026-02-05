/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Unit tests for health check functionality
 *
 * Tests the health check endpoint that provides application status
 * for monitoring systems and dashboards.
 *
 * @see js/main.ts - getHealthStatus() implementation
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../js/state.js', () => ({
    store: {
        token: null,
        apiStatus: {
            profilesFailed: 0,
            holidaysFailed: 0,
            timeOffFailed: 0,
        },
        diagnostics: {
            sentryInitFailed: false,
            workerPoolInitFailed: false,
            workerPoolTerminated: false,
            workerTaskFailures: 0,
        },
        getEncryptionStatus: jest.fn(() => ({
            enabled: false,
            supported: true,
            keyReady: true,
            pending: false,
        })),
    },
    isUsingFallbackStorage: jest.fn(() => false),
}));

jest.unstable_mockModule('../../js/api.js', () => ({
    getCircuitBreakerState: jest.fn(() => ({
        state: 'CLOSED',
        failureCount: 0,
        isOpen: false,
        nextRetryTime: null,
    })),
    Api: {},
    resetRateLimiter: jest.fn(),
}));

// Import mocked modules
const { store, isUsingFallbackStorage } = await import('../../js/state.js');
const { getCircuitBreakerState } = await import('../../js/api.js');
const { getHealthStatus } = await import('../../js/main.js');

describe('Health Check', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset store to healthy defaults
        store.token = 'valid.eyJleHAiOjk5OTk5OTk5OTl9.sig'; // Token expiring far in future
        store.apiStatus = {
            profilesFailed: 0,
            holidaysFailed: 0,
            timeOffFailed: 0,
        };
        store.diagnostics = {
            sentryInitFailed: false,
            workerPoolInitFailed: false,
            workerPoolTerminated: false,
            workerTaskFailures: 0,
        };
        store.getEncryptionStatus.mockReturnValue({
            enabled: false,
            supported: true,
            keyReady: true,
            pending: false,
        });
        isUsingFallbackStorage.mockReturnValue(false);
        getCircuitBreakerState.mockReturnValue({
            state: 'CLOSED',
            failureCount: 0,
            isOpen: false,
            nextRetryTime: null,
        });
    });

    describe('healthy status', () => {
        it('returns healthy when all components are working', () => {
            const result = getHealthStatus();

            expect(result.status).toBe('healthy');
            expect(result.issues).toHaveLength(0);
            // Version is injected at build time; in tests it falls back to '0.0.0'
            expect(result.version).toBe('0.0.0');
            expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it('reports all components as healthy', () => {
            const result = getHealthStatus();

            expect(result.components.circuitBreaker.isHealthy).toBe(true);
            expect(result.components.circuitBreaker.state).toBe('CLOSED');
            expect(result.components.storage.isHealthy).toBe(true);
            expect(result.components.storage.type).toBe('localStorage');
            expect(result.components.api.isHealthy).toBe(true);
            expect(result.components.auth.isHealthy).toBe(true);
            expect(result.components.workers.isHealthy).toBe(true);
            expect(result.components.encryption.isHealthy).toBe(true);
        });
    });

    describe('degraded status', () => {
        it('returns degraded when using fallback storage', () => {
            isUsingFallbackStorage.mockReturnValue(true);

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.storage.type).toBe('memory');
            expect(result.issues).toContain('Using in-memory fallback storage (localStorage unavailable)');
        });

        it('returns degraded when error reporting initialization failed', () => {
            store.diagnostics.sentryInitFailed = true;

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.issues).toContain('Error reporting initialization failed');
        });

        it('returns degraded when worker pool initialization failed', () => {
            store.diagnostics.workerPoolInitFailed = true;

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.workers.isHealthy).toBe(false);
            expect(result.issues).toContain('Worker pool initialization failed');
        });

        it('returns degraded when encryption is enabled but key is missing', () => {
            store.getEncryptionStatus.mockReturnValue({
                enabled: true,
                supported: true,
                keyReady: false,
                pending: false,
            });

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.encryption.isHealthy).toBe(false);
            expect(result.issues).toContain('Encryption key not initialized');
        });

        it('returns degraded when profile fetches failed', () => {
            store.apiStatus.profilesFailed = 2;

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.api.profilesFailed).toBe(2);
            expect(result.components.api.isHealthy).toBe(false);
            expect(result.issues).toContain('2 profile fetch(es) failed');
        });

        it('returns degraded when holiday fetches failed', () => {
            store.apiStatus.holidaysFailed = 1;

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.api.holidaysFailed).toBe(1);
            expect(result.issues).toContain('1 holiday fetch(es) failed');
        });

        it('returns degraded when time-off fetches failed', () => {
            store.apiStatus.timeOffFailed = 3;

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.api.timeOffFailed).toBe(3);
            expect(result.issues).toContain('3 time-off fetch(es) failed');
        });

        it('returns degraded when circuit breaker is half-open', () => {
            getCircuitBreakerState.mockReturnValue({
                state: 'HALF_OPEN',
                failureCount: 3,
                isOpen: false,
                nextRetryTime: null,
            });

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.components.circuitBreaker.state).toBe('HALF_OPEN');
            expect(result.components.circuitBreaker.isHealthy).toBe(false);
            expect(result.issues).toContain('Circuit breaker HALF_OPEN: 3 failures');
        });

        it('accumulates multiple issues', () => {
            store.apiStatus.profilesFailed = 1;
            store.apiStatus.holidaysFailed = 2;
            isUsingFallbackStorage.mockReturnValue(true);

            const result = getHealthStatus();

            expect(result.status).toBe('degraded');
            expect(result.issues.length).toBe(3);
        });
    });

    describe('unhealthy status', () => {
        it('returns unhealthy when circuit breaker is open', () => {
            getCircuitBreakerState.mockReturnValue({
                state: 'OPEN',
                failureCount: 5,
                isOpen: true,
                nextRetryTime: Date.now() + 30000,
            });

            const result = getHealthStatus();

            expect(result.status).toBe('unhealthy');
            expect(result.components.circuitBreaker.state).toBe('OPEN');
            expect(result.issues).toContain('Circuit breaker OPEN: 5 failures');
        });

        it('returns unhealthy when no auth token', () => {
            store.token = null;

            const result = getHealthStatus();

            expect(result.status).toBe('unhealthy');
            expect(result.components.auth.hasToken).toBe(false);
            expect(result.components.auth.isHealthy).toBe(false);
            expect(result.issues).toContain('No authentication token');
        });

        it('returns unhealthy when auth token is expired', () => {
            // Token expired 1 hour ago
            const expiredTime = Math.floor(Date.now() / 1000) - 3600;
            const payload = JSON.stringify({ exp: expiredTime });
            const base64Payload = Buffer.from(payload).toString('base64')
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            store.token = `header.${base64Payload}.signature`;

            const result = getHealthStatus();

            expect(result.status).toBe('unhealthy');
            expect(result.components.auth.isExpired).toBe(true);
            expect(result.components.auth.isHealthy).toBe(false);
            expect(result.issues).toContain('Authentication token has expired');
        });
    });

    describe('component details', () => {
        it('includes circuit breaker failure count', () => {
            getCircuitBreakerState.mockReturnValue({
                state: 'CLOSED',
                failureCount: 2,
                isOpen: false,
                nextRetryTime: null,
            });

            const result = getHealthStatus();

            expect(result.components.circuitBreaker.failureCount).toBe(2);
            // Still healthy because circuit is closed
            expect(result.components.circuitBreaker.isHealthy).toBe(true);
        });

        it('storage is always healthy (even with fallback)', () => {
            isUsingFallbackStorage.mockReturnValue(true);

            const result = getHealthStatus();

            // Storage subsystem works, just using fallback
            expect(result.components.storage.isHealthy).toBe(true);
            expect(result.components.storage.type).toBe('memory');
        });

        it('treats malformed token as expired', () => {
            // Token with invalid structure (not 3 parts)
            store.token = 'not-a-valid-jwt';

            const result = getHealthStatus();

            // Has token but invalid format, treated as expired
            expect(result.components.auth.hasToken).toBe(true);
            expect(result.components.auth.isExpired).toBe(true);
            expect(result.components.auth.isHealthy).toBe(false);
            expect(result.status).toBe('unhealthy');
        });

        it('handles token with invalid base64 payload', () => {
            // Token with 3 parts but invalid base64 in payload
            store.token = 'header.!!!invalid-base64!!!.signature';

            const result = getHealthStatus();

            // Decode fails, treated as expired
            expect(result.status).toBe('unhealthy');
            expect(result.components.auth.isExpired).toBe(true);
            expect(result.issues).toContain('Authentication token has expired');
        });

        it('handles token without expiration claim', () => {
            const payload = JSON.stringify({ sub: 'user123' }); // No exp claim
            const base64Payload = Buffer.from(payload).toString('base64')
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            store.token = `header.${base64Payload}.signature`;

            const result = getHealthStatus();

            // Token exists but no exp, treated as not expired
            expect(result.components.auth.hasToken).toBe(true);
            expect(result.components.auth.isExpired).toBe(false);
            expect(result.components.auth.isHealthy).toBe(true);
        });
    });

    describe('timestamp', () => {
        it('includes ISO 8601 timestamp', () => {
            const before = new Date().toISOString();
            const result = getHealthStatus();
            const after = new Date().toISOString();

            expect(result.timestamp >= before).toBe(true);
            expect(result.timestamp <= after).toBe(true);
        });
    });
});
