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
        circuitBreaker: { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; failureCount: number; isHealthy: boolean };
        storage: { type: 'localStorage' | 'memory'; isHealthy: boolean };
        api: { profilesFailed: number; holidaysFailed: number; timeOffFailed: number; isHealthy: boolean };
        auth: { hasToken: boolean; isExpired: boolean; isHealthy: boolean };
        workers: { supported: boolean; initialized: boolean; terminated: boolean; taskFailures: number; isHealthy: boolean };
        encryption: { enabled: boolean; supported: boolean; keyReady: boolean; pending: boolean; isHealthy: boolean };
    };
    /** Array of issues if status is degraded or unhealthy */
    issues: string[];
}

// ============================================================================
// PER-SUBSYSTEM PROBES
// ============================================================================

function probeCircuitBreaker(issues: string[]) {
    const cbState = getCircuitBreakerState();
    const isHealthy = cbState.state === 'CLOSED';
    if (!isHealthy) {
        issues.push(`Circuit breaker ${cbState.state}: ${cbState.failureCount} failures`);
    }
    return { state: cbState.state, failureCount: cbState.failureCount, isHealthy };
}

function probeStorage(issues: string[]) {
    const usingFallback = isUsingFallbackStorage();
    if (usingFallback) {
        issues.push('Using in-memory fallback storage (localStorage unavailable)');
    }
    return { type: (usingFallback ? 'memory' : 'localStorage') as 'localStorage' | 'memory', isHealthy: true };
}

function probeApi(issues: string[]) {
    const { profilesFailed, holidaysFailed, timeOffFailed } = store.apiStatus;
    const isHealthy = profilesFailed === 0 && holidaysFailed === 0 && timeOffFailed === 0;
    if (profilesFailed > 0) issues.push(`${profilesFailed} profile fetch(es) failed`);
    if (holidaysFailed > 0) issues.push(`${holidaysFailed} holiday fetch(es) failed`);
    if (timeOffFailed > 0) issues.push(`${timeOffFailed} time-off fetch(es) failed`);
    if (store.diagnostics?.sentryInitFailed) issues.push('Error reporting initialization failed');
    return { profilesFailed, holidaysFailed, timeOffFailed, isHealthy };
}

function probeAuth(issues: string[]) {
    const hasToken = !!store.token;
    let isExpired = false;
    if (hasToken) {
        try {
            const parts = (store.token ?? '').split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(base64urlDecode(parts[1]));
                if (typeof payload.exp === 'number') {
                    isExpired = payload.exp < Math.floor(Date.now() / 1000);
                }
            } else {
                isExpired = true;
            }
        } catch {
            isExpired = true;
        }
    }
    const isHealthy = hasToken && !isExpired;
    if (!hasToken) issues.push('No authentication token');
    else if (isExpired) issues.push('Authentication token has expired');
    return { hasToken, isExpired, isHealthy };
}

function probeWorkers(issues: string[]) {
    const supported = isWorkerSupported();
    const terminated = store.diagnostics?.workerPoolTerminated ?? false;
    const initFailed = store.diagnostics?.workerPoolInitFailed ?? false;
    const taskFailures = store.diagnostics?.workerTaskFailures ?? 0;
    const isHealthy = !initFailed && !terminated && taskFailures === 0;
    if (initFailed) issues.push('Worker pool initialization failed');
    if (terminated) issues.push('Worker pool terminated');
    if (taskFailures > 0) issues.push(`${taskFailures} worker task(s) failed`);
    return { supported, initialized: !initFailed, terminated, taskFailures, isHealthy };
}

function probeEncryption(issues: string[]) {
    const status = store.getEncryptionStatus?.() ?? {
        enabled: false, supported: false, keyReady: false, pending: false,
    };
    const isHealthy = !status.enabled || status.keyReady;
    if (status.enabled && !status.keyReady) issues.push('Encryption key not initialized');
    return { enabled: status.enabled, supported: status.supported, keyReady: status.keyReady, pending: status.pending, isHealthy };
}

// ============================================================================
// AGGREGATE
// ============================================================================

/**
 * Performs a comprehensive health check of the application.
 */
export function getHealthStatus(): HealthCheckResult {
    const issues: string[] = [];

    const circuitBreaker = probeCircuitBreaker(issues);
    const storage = probeStorage(issues);
    const api = probeApi(issues);
    const auth = probeAuth(issues);
    const workers = probeWorkers(issues);
    const encryption = probeEncryption(issues);

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (!auth.isHealthy || circuitBreaker.state === 'OPEN') {
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
        components: { circuitBreaker, storage, api, auth, workers, encryption },
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
