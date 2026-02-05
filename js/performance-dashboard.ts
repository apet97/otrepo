/**
 * @fileoverview Real-Time Performance Dashboard
 *
 * Provides a developer-facing performance dashboard for monitoring
 * application health and performance metrics in real-time.
 *
 * ## Features
 *
 * - Real-time metrics visualization via console or overlay
 * - Performance alerts when thresholds are exceeded
 * - Memory usage tracking
 * - API latency monitoring
 * - Calculation performance tracking
 *
 * ## Usage
 *
 * ```typescript
 * import { initPerformanceDashboard } from './performance-dashboard.js';
 *
 * // Initialize with console output
 * initPerformanceDashboard({ mode: 'console', intervalMs: 5000 });
 *
 * // Or with DOM overlay (for development)
 * initPerformanceDashboard({ mode: 'overlay' });
 * ```
 *
 * ## Access via Console
 *
 * ```javascript
 * // Get current dashboard state
 * window.__OTPLUS_PERF_DASHBOARD__.getStatus()
 *
 * // Get performance report
 * window.__OTPLUS_PERF_DASHBOARD__.getReport()
 *
 * // Toggle overlay visibility
 * window.__OTPLUS_PERF_DASHBOARD__.toggleOverlay()
 * ```
 */

import { createLogger } from './logger.js';
import {
    getHistogramStats,
    getCounterValue,
    MetricNames,
} from './metrics.js';
import { getCircuitBreakerState } from './api.js';
import { getCSPReportStats } from './csp-reporter.js';

const logger = createLogger('PerfDash');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Dashboard configuration options.
 */
export interface DashboardConfig {
    /** Display mode: 'console' logs to console, 'overlay' shows DOM element */
    mode: 'console' | 'overlay' | 'silent';
    /** Update interval in milliseconds (default: 10000) */
    intervalMs: number;
    /** Whether to show memory usage (requires performance.memory) */
    trackMemory: boolean;
    /** Thresholds for performance alerts */
    alertThresholds: AlertThresholds;
}

/**
 * Alert thresholds for performance monitoring.
 */
export interface AlertThresholds {
    /** API latency P95 threshold in ms (default: 2000) */
    apiLatencyP95Ms: number;
    /** Calculation time P95 threshold in ms (default: 5000) */
    calcTimeP95Ms: number;
    /** Memory usage threshold in MB (default: 100) */
    memoryUsageMB: number;
    /** Error rate threshold as percentage (default: 5) */
    errorRatePercent: number;
}

/**
 * Performance report structure.
 */
export interface PerformanceReport {
    timestamp: string;
    uptime: number;
    memory: MemoryInfo | null;
    api: ApiPerformance;
    calculations: CalcPerformance;
    circuitBreaker: CircuitBreakerInfo;
    csp: CSPInfo;
    alerts: PerformanceAlert[];
}

interface MemoryInfo {
    usedHeapMB: number;
    totalHeapMB: number;
    heapLimitMB: number;
    usagePercent: number;
}

interface ApiPerformance {
    totalRequests: number;
    errors: number;
    retries: number;
    errorRate: number;
    latency: LatencyStats | null;
}

interface CalcPerformance {
    totalCalculations: number;
    latency: LatencyStats | null;
    entriesProcessed: number;
}

interface LatencyStats {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
}

interface CircuitBreakerInfo {
    state: string;
    failures: number;
    lastFailure: number | null;
}

interface CSPInfo {
    violationsReported: number;
    lastResetTime: number;
}

interface PerformanceAlert {
    type: 'warning' | 'critical';
    metric: string;
    message: string;
    value: number;
    threshold: number;
}

// ============================================================================
// STATE
// ============================================================================

const defaultConfig: DashboardConfig = {
    mode: 'silent',
    intervalMs: 10000,
    trackMemory: true,
    alertThresholds: {
        apiLatencyP95Ms: 2000,
        calcTimeP95Ms: 5000,
        memoryUsageMB: 100,
        errorRatePercent: 5,
    },
};

let config: DashboardConfig = { ...defaultConfig };
let updateInterval: ReturnType<typeof setInterval> | null = null;
let overlayElement: HTMLElement | null = null;
let startTime = Date.now();

// ============================================================================
// MEMORY TRACKING
// ============================================================================

/**
 * Gets memory usage information if available.
 */
function getMemoryInfo(): MemoryInfo | null {
    // performance.memory is Chrome-specific
    const perf = performance as Performance & {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
        };
    };

    if (!perf.memory) return null;

    const usedMB = perf.memory.usedJSHeapSize / (1024 * 1024);
    const totalMB = perf.memory.totalJSHeapSize / (1024 * 1024);
    const limitMB = perf.memory.jsHeapSizeLimit / (1024 * 1024);

    return {
        usedHeapMB: Math.round(usedMB * 100) / 100,
        totalHeapMB: Math.round(totalMB * 100) / 100,
        heapLimitMB: Math.round(limitMB * 100) / 100,
        usagePercent: Math.round((usedMB / limitMB) * 100),
    };
}

// ============================================================================
// PERFORMANCE REPORT GENERATION
// ============================================================================

/**
 * Generates a comprehensive performance report.
 */
export function generatePerformanceReport(): PerformanceReport {
    const alerts: PerformanceAlert[] = [];

    // Memory info
    const memory = config.trackMemory ? getMemoryInfo() : null;
    if (memory && memory.usedHeapMB > config.alertThresholds.memoryUsageMB) {
        alerts.push({
            type: memory.usedHeapMB > config.alertThresholds.memoryUsageMB * 1.5 ? 'critical' : 'warning',
            metric: 'memory',
            message: `High memory usage: ${memory.usedHeapMB.toFixed(1)}MB`,
            value: memory.usedHeapMB,
            threshold: config.alertThresholds.memoryUsageMB,
        });
    }

    // API performance
    const apiLatency = getHistogramStats(MetricNames.API_REQUEST_DURATION);
    const totalRequests = getCounterValue(MetricNames.API_REQUEST_COUNT);
    const errors = getCounterValue(MetricNames.API_ERROR_COUNT);
    const retries = getCounterValue(MetricNames.API_RETRY_COUNT);
    const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

    if (apiLatency && apiLatency.p95 > config.alertThresholds.apiLatencyP95Ms) {
        alerts.push({
            type: apiLatency.p95 > config.alertThresholds.apiLatencyP95Ms * 2 ? 'critical' : 'warning',
            metric: 'api_latency',
            message: `High API latency P95: ${apiLatency.p95.toFixed(0)}ms`,
            value: apiLatency.p95,
            threshold: config.alertThresholds.apiLatencyP95Ms,
        });
    }

    if (errorRate > config.alertThresholds.errorRatePercent) {
        alerts.push({
            type: errorRate > config.alertThresholds.errorRatePercent * 2 ? 'critical' : 'warning',
            metric: 'error_rate',
            message: `High error rate: ${errorRate.toFixed(1)}%`,
            value: errorRate,
            threshold: config.alertThresholds.errorRatePercent,
        });
    }

    // Calculation performance
    const calcLatency = getHistogramStats(MetricNames.CALC_DURATION);
    const entriesProcessed = getCounterValue(MetricNames.CALC_ENTRY_COUNT);

    if (calcLatency && calcLatency.p95 > config.alertThresholds.calcTimeP95Ms) {
        alerts.push({
            type: calcLatency.p95 > config.alertThresholds.calcTimeP95Ms * 2 ? 'critical' : 'warning',
            metric: 'calc_time',
            message: `Slow calculations P95: ${calcLatency.p95.toFixed(0)}ms`,
            value: calcLatency.p95,
            threshold: config.alertThresholds.calcTimeP95Ms,
        });
    }

    // Circuit breaker state
    let circuitBreaker: CircuitBreakerInfo;
    try {
        const cbState = getCircuitBreakerState();
        circuitBreaker = {
            state: cbState.state,
            failures: cbState.failureCount,
            lastFailure: cbState.nextRetryTime,
        };

        if (cbState.state === 'OPEN') {
            alerts.push({
                type: 'critical',
                metric: 'circuit_breaker',
                message: 'Circuit breaker is OPEN - API calls are being blocked',
                value: cbState.failureCount,
                threshold: 5,
            });
        }
    } catch {
        circuitBreaker = { state: 'unknown', failures: 0, lastFailure: null };
    }

    // CSP violations
    let csp: CSPInfo;
    try {
        const cspStats = getCSPReportStats();
        csp = {
            violationsReported: cspStats.reportCount,
            lastResetTime: cspStats.lastResetTime,
        };
    } catch {
        csp = { violationsReported: 0, lastResetTime: 0 };
    }

    return {
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        memory,
        api: {
            totalRequests,
            errors,
            retries,
            errorRate: Math.round(errorRate * 100) / 100,
            latency: apiLatency ? {
                avg: Math.round(apiLatency.avg * 100) / 100,
                p50: Math.round(apiLatency.p50 * 100) / 100,
                p95: Math.round(apiLatency.p95 * 100) / 100,
                p99: Math.round(apiLatency.p99 * 100) / 100,
                min: Math.round(apiLatency.min * 100) / 100,
                max: Math.round(apiLatency.max * 100) / 100,
            } : null,
        },
        calculations: {
            totalCalculations: calcLatency?.count || 0,
            latency: calcLatency ? {
                avg: Math.round(calcLatency.avg * 100) / 100,
                p50: Math.round(calcLatency.p50 * 100) / 100,
                p95: Math.round(calcLatency.p95 * 100) / 100,
                p99: Math.round(calcLatency.p99 * 100) / 100,
                min: Math.round(calcLatency.min * 100) / 100,
                max: Math.round(calcLatency.max * 100) / 100,
            } : null,
            entriesProcessed,
        },
        circuitBreaker,
        csp,
        alerts,
    };
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Formats a performance report for console output.
 */
function formatReportForConsole(report: PerformanceReport): string {
    const lines: string[] = [
        '╔══════════════════════════════════════════════════════════════╗',
        '║              OTPLUS Performance Dashboard                    ║',
        '╠══════════════════════════════════════════════════════════════╣',
        `║  Time: ${report.timestamp}                    ║`,
        `║  Uptime: ${formatDuration(report.uptime)}                                    ║`,
        '╠══════════════════════════════════════════════════════════════╣',
    ];

    // Memory
    if (report.memory) {
        lines.push('║  MEMORY                                                      ║');
        lines.push(`║    Heap: ${report.memory.usedHeapMB.toFixed(1)}MB / ${report.memory.heapLimitMB.toFixed(1)}MB (${report.memory.usagePercent}%)`.padEnd(64) + '║');
    }

    // API
    lines.push('║  API PERFORMANCE                                             ║');
    lines.push(`║    Requests: ${report.api.totalRequests}, Errors: ${report.api.errors}, Retries: ${report.api.retries}`.padEnd(64) + '║');
    lines.push(`║    Error Rate: ${report.api.errorRate.toFixed(2)}%`.padEnd(64) + '║');
    if (report.api.latency) {
        lines.push(`║    Latency: avg=${report.api.latency.avg.toFixed(0)}ms, p95=${report.api.latency.p95.toFixed(0)}ms, p99=${report.api.latency.p99.toFixed(0)}ms`.padEnd(64) + '║');
    }

    // Calculations
    lines.push('║  CALCULATIONS                                                ║');
    lines.push(`║    Total: ${report.calculations.totalCalculations}, Entries: ${report.calculations.entriesProcessed}`.padEnd(64) + '║');
    if (report.calculations.latency) {
        lines.push(`║    Duration: avg=${report.calculations.latency.avg.toFixed(0)}ms, p95=${report.calculations.latency.p95.toFixed(0)}ms`.padEnd(64) + '║');
    }

    // Circuit Breaker
    lines.push('║  CIRCUIT BREAKER                                             ║');
    lines.push(`║    State: ${report.circuitBreaker.state}, Failures: ${report.circuitBreaker.failures}`.padEnd(64) + '║');

    // Alerts
    if (report.alerts.length > 0) {
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push('║  ALERTS                                                      ║');
        for (const alert of report.alerts) {
            const icon = alert.type === 'critical' ? '🔴' : '🟡';
            lines.push(`║    ${icon} ${alert.message}`.padEnd(64) + '║');
        }
    }

    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
}

/**
 * Formats duration in human-readable format.
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Creates or updates the overlay element.
 */
function updateOverlay(report: PerformanceReport): void {
    if (!overlayElement) {
        overlayElement = document.createElement('div');
        overlayElement.id = 'otplus-perf-dashboard';
        overlayElement.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.85);
            color: #0f0;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            padding: 10px;
            border-radius: 4px;
            z-index: 999999;
            max-width: 350px;
            max-height: 400px;
            overflow: auto;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(overlayElement);
    }

    const alertsHtml = report.alerts.length > 0
        ? report.alerts.map(a => `<div style="color: ${a.type === 'critical' ? '#f00' : '#ff0'}">⚠ ${a.message}</div>`).join('')
        : '<div style="color: #0f0">No alerts</div>';

    overlayElement.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px; color: #0ff;">OTPLUS Performance</div>
        <div>Uptime: ${formatDuration(report.uptime)}</div>
        ${report.memory ? `<div>Memory: ${report.memory.usedHeapMB.toFixed(1)}MB (${report.memory.usagePercent}%)</div>` : ''}
        <hr style="border-color: #333; margin: 5px 0;">
        <div style="color: #0ff;">API</div>
        <div>Requests: ${report.api.totalRequests} | Errors: ${report.api.errors}</div>
        ${report.api.latency ? `<div>Latency P95: ${report.api.latency.p95.toFixed(0)}ms</div>` : ''}
        <hr style="border-color: #333; margin: 5px 0;">
        <div style="color: #0ff;">Circuit: ${report.circuitBreaker.state}</div>
        <hr style="border-color: #333; margin: 5px 0;">
        <div style="color: #0ff;">Alerts</div>
        ${alertsHtml}
        <div style="font-size: 9px; color: #666; margin-top: 5px;">
            Press Ctrl+Shift+P to toggle
        </div>
    `;
}

// ============================================================================
// DASHBOARD CONTROL
// ============================================================================

/**
 * Updates the dashboard display.
 */
function updateDashboard(): void {
    const report = generatePerformanceReport();

    if (config.mode === 'console') {
        // eslint-disable-next-line no-console -- Intentional console output in console mode
        console.log(formatReportForConsole(report));
    } else if (config.mode === 'overlay') {
        updateOverlay(report);
    }

    // Log critical alerts regardless of mode
    for (const alert of report.alerts) {
        if (alert.type === 'critical') {
            logger.warn(`Performance Alert: ${alert.message}`, {
                metric: alert.metric,
                value: alert.value,
                threshold: alert.threshold,
            });
        }
    }
}

/**
 * Initializes the performance dashboard.
 *
 * @param customConfig - Optional configuration overrides
 */
export function initPerformanceDashboard(customConfig?: Partial<DashboardConfig>): void {
    config = { ...defaultConfig, ...customConfig };
    startTime = Date.now();

    // Only run in browser environment
    if (typeof window === 'undefined') {
        return;
    }

    // Clear existing interval
    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Start periodic updates
    if (config.mode !== 'silent') {
        updateDashboard();
        updateInterval = setInterval(updateDashboard, config.intervalMs);
    }

    // Add keyboard shortcut for overlay toggle
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            toggleOverlay();
        }
    });

    logger.debug('Performance dashboard initialized', {
        mode: config.mode,
        intervalMs: config.intervalMs,
    });
}

/**
 * Stops the performance dashboard.
 */
export function stopPerformanceDashboard(): void {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }

    if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
    }
}

/**
 * Toggles the overlay visibility.
 */
export function toggleOverlay(): void {
    if (overlayElement) {
        overlayElement.style.display = overlayElement.style.display === 'none' ? 'block' : 'none';
    } else if (config.mode === 'silent' || config.mode === 'console') {
        // Switch to overlay mode
        config.mode = 'overlay';
        updateDashboard();
    }
}

/**
 * Gets the current dashboard configuration.
 */
export function getDashboardConfig(): DashboardConfig {
    return { ...config };
}

/**
 * Gets the current dashboard status.
 */
export function getDashboardStatus(): {
    running: boolean;
    mode: string;
    intervalMs: number;
    lastUpdate: string;
} {
    return {
        running: updateInterval !== null,
        mode: config.mode,
        intervalMs: config.intervalMs,
        lastUpdate: new Date().toISOString(),
    };
}

// ============================================================================
// WINDOW EXPOSURE
// ============================================================================

/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__OTPLUS_PERF_DASHBOARD__ = {
        init: initPerformanceDashboard,
        stop: stopPerformanceDashboard,
        getStatus: getDashboardStatus,
        getReport: generatePerformanceReport,
        toggleOverlay,
        getConfig: getDashboardConfig,
    };
}
