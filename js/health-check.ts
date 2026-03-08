/**
 * @fileoverview Health Check Endpoint
 *
 * Provides application health status for monitoring systems.
 * Aggregates status from circuit breaker, storage, API, worker, and encryption components.
 * Extracted from main.ts to reduce module size (CQ-1).
 */

import { store, isUsingFallbackStorage } from './state.js';
import { getCircuitBreakerState } from './api.js';
import { base64urlDecode } from './utils.js';
import { isWorkerSupported } from './worker-manager.js';

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

/**
 * Health check status result.
 * Provides comprehensive status for monitoring tools and dashboards.
 */
export interface HealthCheckResult {
    /** Overall health status: 'healthy', 'degraded', or 'unhealthy' */
    status: 'healthy' | 'degraded' | 'unhealthy';
    /** ISO timestamp of when the check was performed */
    timestamp: string;
    /** Application version from package.json */
    version: string;
    /** Detailed component status */
    components: {
        /** Circuit breaker status */
        circuitBreaker: {
            state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
            failureCount: number;
            isHealthy: boolean;
        };
        /** Storage subsystem status */
        storage: {
            type: 'localStorage' | 'memory';
            isHealthy: boolean;
        };
        /** API integration status */
        api: {
            profilesFailed: number;
            holidaysFailed: number;
            timeOffFailed: number;
            isHealthy: boolean;
        };
        /** Authentication status */
        auth: {
            hasToken: boolean;
            isExpired: boolean;
            isHealthy: boolean;
        };
        /** Worker subsystem status */
        workers: {
            supported: boolean;
            initialized: boolean;
            terminated: boolean;
            taskFailures: number;
            isHealthy: boolean;
        };
        /** Encryption subsystem status */
        encryption: {
            enabled: boolean;
            supported: boolean;
            keyReady: boolean;
            pending: boolean;
            isHealthy: boolean;
        };
    };
    /** Array of issues if status is degraded or unhealthy */
    issues: string[];
}

/**
 * Performs a comprehensive health check of the application.
 *
 * Aggregates health status from multiple subsystems:
 * - Circuit breaker: Checks if API requests are being blocked due to failures
 * - Storage: Checks if localStorage is available or using fallback
 * - API: Checks for failed profile/holiday/time-off fetches
 * - Auth: Checks token validity and expiration
 * - Workers: Checks worker pool status and task failures
 * - Encryption: Checks encryption key readiness when enabled
 *
 * @returns HealthCheckResult with overall status and component details
 */
export function getHealthStatus(): HealthCheckResult {
    const issues: string[] = [];

    // Check circuit breaker status
    const cbState = getCircuitBreakerState();
    const cbHealthy = cbState.state === 'CLOSED';
    if (!cbHealthy) {
        issues.push(`Circuit breaker ${cbState.state}: ${cbState.failureCount} failures`);
    }

    // Check storage status
    const usingFallback = isUsingFallbackStorage();
    if (usingFallback) {
        issues.push('Using in-memory fallback storage (localStorage unavailable)');
    }

    // Check API status from store
    const apiStatus = store.apiStatus;
    const apiHealthy =
        apiStatus.profilesFailed === 0 &&
        apiStatus.holidaysFailed === 0 &&
        apiStatus.timeOffFailed === 0;
    if (apiStatus.profilesFailed > 0) {
        issues.push(`${apiStatus.profilesFailed} profile fetch(es) failed`);
    }
    if (apiStatus.holidaysFailed > 0) {
        issues.push(`${apiStatus.holidaysFailed} holiday fetch(es) failed`);
    }
    if (apiStatus.timeOffFailed > 0) {
        issues.push(`${apiStatus.timeOffFailed} time-off fetch(es) failed`);
    }

    // Check error reporting status
    if (store.diagnostics?.sentryInitFailed) {
        issues.push('Error reporting initialization failed');
    }

    // Check worker subsystem status
    const workerSupported = isWorkerSupported();
    const workerTerminated = store.diagnostics?.workerPoolTerminated ?? false;
    const workerInitFailed = store.diagnostics?.workerPoolInitFailed ?? false;
    const workerTaskFailures = store.diagnostics?.workerTaskFailures ?? 0;
    const workerHealthy = !workerInitFailed && !workerTerminated && workerTaskFailures === 0;

    if (workerInitFailed) {
        issues.push('Worker pool initialization failed');
    }
    if (workerTerminated) {
        issues.push('Worker pool terminated');
    }
    if (workerTaskFailures > 0) {
        issues.push(`${workerTaskFailures} worker task(s) failed`);
    }

    // Check encryption status
    const encryptionStatus = store.getEncryptionStatus?.() ?? {
        enabled: false,
        supported: false,
        keyReady: false,
        pending: false,
    };
    const encryptionHealthy = !encryptionStatus.enabled || encryptionStatus.keyReady;
    if (encryptionStatus.enabled && !encryptionStatus.keyReady) {
        issues.push('Encryption key not initialized');
    }

    // Check auth status
    const hasToken = !!store.token;
    let isExpired = false;
    if (hasToken) {
        try {
            const parts = (store.token ?? '').split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(base64urlDecode(parts[1]));
                const exp = payload.exp;
                if (typeof exp === 'number') {
                    isExpired = exp < Math.floor(Date.now() / 1000);
                }
            } else {
                isExpired = true;
            }
        } catch {
            isExpired = true;
        }
    }
    const authHealthy = hasToken && !isExpired;
    if (!hasToken) {
        issues.push('No authentication token');
    } else if (isExpired) {
        issues.push('Authentication token has expired');
    }

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (!authHealthy || cbState.state === 'OPEN') {
        status = 'unhealthy';
    } else if (issues.length > 0) {
        status = 'degraded';
    } else {
        status = 'healthy';
    }

    return {
        status,
        timestamp: new Date().toISOString(),
        version: process.env.VERSION ?? '0.0.0',
        components: {
            circuitBreaker: {
                state: cbState.state,
                failureCount: cbState.failureCount,
                isHealthy: cbHealthy,
            },
            storage: {
                type: usingFallback ? 'memory' : 'localStorage',
                isHealthy: true,
            },
            api: {
                profilesFailed: apiStatus.profilesFailed,
                holidaysFailed: apiStatus.holidaysFailed,
                timeOffFailed: apiStatus.timeOffFailed,
                isHealthy: apiHealthy,
            },
            auth: {
                hasToken,
                isExpired,
                isHealthy: authHealthy,
            },
            workers: {
                supported: workerSupported,
                initialized: !workerInitFailed,
                terminated: workerTerminated,
                taskFailures: workerTaskFailures,
                isHealthy: workerHealthy,
            },
            encryption: {
                enabled: encryptionStatus.enabled,
                supported: encryptionStatus.supported,
                keyReady: encryptionStatus.keyReady,
                pending: encryptionStatus.pending,
                isHealthy: encryptionHealthy,
            },
        },
        issues,
    };
}

// Expose health check globally for monitoring tools
declare global {
    interface Window {
        __OTPLUS_HEALTH_CHECK__: typeof getHealthStatus;
    }
}

const isProductionEnv =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

// Stryker disable next-line all: Global exposure is for monitoring, not core functionality
if (typeof window !== 'undefined' && !isProductionEnv) {
    window.__OTPLUS_HEALTH_CHECK__ = getHealthStatus;
}
