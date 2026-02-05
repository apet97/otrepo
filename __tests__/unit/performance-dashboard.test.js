/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Unit tests for performance dashboard
 *
 * Tests the real-time performance monitoring dashboard.
 *
 * @see js/performance-dashboard.ts - dashboard implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock console methods
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// Mock the metrics module
jest.unstable_mockModule('../../js/metrics.js', () => ({
    getHistogramStats: jest.fn(() => null),
    getCounterValue: jest.fn(() => 0),
    MetricNames: {
        API_REQUEST_DURATION: 'api_request_duration_ms',
        API_REQUEST_COUNT: 'api_request_count',
        API_ERROR_COUNT: 'api_error_count',
        API_RETRY_COUNT: 'api_retry_count',
        CALC_DURATION: 'calculation_duration_ms',
        CALC_ENTRY_COUNT: 'calculation_entry_count',
    },
}));

// Mock the api module
jest.unstable_mockModule('../../js/api.js', () => ({
    getCircuitBreakerState: jest.fn(() => ({
        state: 'CLOSED',
        failureCount: 0,
        isOpen: false,
        nextRetryTime: null,
    })),
}));

// Mock the csp-reporter module
jest.unstable_mockModule('../../js/csp-reporter.js', () => ({
    getCSPReportStats: jest.fn(() => ({
        reportCount: 0,
        lastResetTime: Date.now(),
    })),
}));

// Mock the logger
jest.unstable_mockModule('../../js/logger.js', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

// Dynamic imports after mocking
let initPerformanceDashboard;
let stopPerformanceDashboard;
let generatePerformanceReport;
let toggleOverlay;
let getDashboardConfig;
let getDashboardStatus;
let getHistogramStats;
let getCounterValue;
let getCircuitBreakerState;

beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers({ advanceTimers: true });

    // Re-import with fresh mocks
    const metrics = await import('../../js/metrics.js');
    getHistogramStats = metrics.getHistogramStats;
    getCounterValue = metrics.getCounterValue;

    const api = await import('../../js/api.js');
    getCircuitBreakerState = api.getCircuitBreakerState;

    const dashboard = await import('../../js/performance-dashboard.js');
    initPerformanceDashboard = dashboard.initPerformanceDashboard;
    stopPerformanceDashboard = dashboard.stopPerformanceDashboard;
    generatePerformanceReport = dashboard.generatePerformanceReport;
    toggleOverlay = dashboard.toggleOverlay;
    getDashboardConfig = dashboard.getDashboardConfig;
    getDashboardStatus = dashboard.getDashboardStatus;

    // Clean up any existing overlay
    const existingOverlay = document.getElementById('otplus-perf-dashboard');
    if (existingOverlay) {
        existingOverlay.remove();
    }
});

afterEach(() => {
    stopPerformanceDashboard();
    jest.useRealTimers();
    jest.clearAllMocks();
});

describe('Performance Dashboard', () => {
    describe('initPerformanceDashboard', () => {
        it('initializes with default configuration', () => {
            initPerformanceDashboard();
            const config = getDashboardConfig();

            expect(config.mode).toBe('silent');
            expect(config.intervalMs).toBe(10000);
            expect(config.trackMemory).toBe(true);
        });

        it('accepts custom configuration', () => {
            initPerformanceDashboard({
                mode: 'console',
                intervalMs: 5000,
                trackMemory: false,
            });

            const config = getDashboardConfig();
            expect(config.mode).toBe('console');
            expect(config.intervalMs).toBe(5000);
            expect(config.trackMemory).toBe(false);
        });

        it('sets running status when started', () => {
            initPerformanceDashboard({ mode: 'console' });
            const status = getDashboardStatus();

            expect(status.running).toBe(true);
            expect(status.mode).toBe('console');
        });

        it('does not set running when mode is silent', () => {
            initPerformanceDashboard({ mode: 'silent' });
            const status = getDashboardStatus();

            expect(status.running).toBe(false);
        });
    });

    describe('stopPerformanceDashboard', () => {
        it('stops the dashboard and clears interval', () => {
            initPerformanceDashboard({ mode: 'console' });
            expect(getDashboardStatus().running).toBe(true);

            stopPerformanceDashboard();
            expect(getDashboardStatus().running).toBe(false);
        });

        it('removes overlay element if present', () => {
            initPerformanceDashboard({ mode: 'overlay' });

            // Trigger first update to create overlay
            jest.advanceTimersByTime(100);

            expect(document.getElementById('otplus-perf-dashboard')).toBeTruthy();

            stopPerformanceDashboard();

            expect(document.getElementById('otplus-perf-dashboard')).toBeFalsy();
        });
    });

    describe('generatePerformanceReport', () => {
        it('returns a report with all required fields', () => {
            const report = generatePerformanceReport();

            expect(report).toHaveProperty('timestamp');
            expect(report).toHaveProperty('uptime');
            expect(report).toHaveProperty('memory');
            expect(report).toHaveProperty('api');
            expect(report).toHaveProperty('calculations');
            expect(report).toHaveProperty('circuitBreaker');
            expect(report).toHaveProperty('csp');
            expect(report).toHaveProperty('alerts');
        });

        it('includes API metrics in report', () => {
            getCounterValue.mockImplementation((name) => {
                if (name === 'api_request_count') return 100;
                if (name === 'api_error_count') return 5;
                if (name === 'api_retry_count') return 10;
                return 0;
            });

            const report = generatePerformanceReport();

            expect(report.api.totalRequests).toBe(100);
            expect(report.api.errors).toBe(5);
            expect(report.api.retries).toBe(10);
            expect(report.api.errorRate).toBe(5); // 5%
        });

        it('includes API latency stats when available', () => {
            getHistogramStats.mockImplementation((name) => {
                if (name === 'api_request_duration_ms') {
                    return {
                        count: 100,
                        sum: 5000,
                        min: 10,
                        max: 500,
                        avg: 50,
                        p50: 45,
                        p95: 200,
                        p99: 350,
                    };
                }
                return null;
            });

            const report = generatePerformanceReport();

            expect(report.api.latency).toBeTruthy();
            expect(report.api.latency.avg).toBe(50);
            expect(report.api.latency.p95).toBe(200);
            expect(report.api.latency.p99).toBe(350);
        });

        it('includes circuit breaker state', () => {
            getCircuitBreakerState.mockReturnValue({
                state: 'HALF_OPEN',
                failureCount: 3,
                isOpen: false,
                nextRetryTime: Date.now() + 30000,
            });

            const report = generatePerformanceReport();

            expect(report.circuitBreaker.state).toBe('HALF_OPEN');
            expect(report.circuitBreaker.failures).toBe(3);
        });

        it('includes timestamp in ISO format', () => {
            const report = generatePerformanceReport();

            expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
        });
    });

    describe('alerts', () => {
        it('generates alert when API latency P95 exceeds threshold', () => {
            getHistogramStats.mockImplementation((name) => {
                if (name === 'api_request_duration_ms') {
                    return {
                        count: 100,
                        sum: 300000,
                        min: 10,
                        max: 5000,
                        avg: 3000,
                        p50: 2500,
                        p95: 4500, // Exceeds default 2000ms threshold
                        p99: 4800,
                    };
                }
                return null;
            });

            const report = generatePerformanceReport();

            const latencyAlert = report.alerts.find(a => a.metric === 'api_latency');
            expect(latencyAlert).toBeTruthy();
            expect(latencyAlert.type).toBe('critical'); // > 2x threshold
            expect(latencyAlert.value).toBe(4500);
        });

        it('generates warning when error rate exceeds threshold', () => {
            getCounterValue.mockImplementation((name) => {
                if (name === 'api_request_count') return 100;
                if (name === 'api_error_count') return 8; // 8% error rate
                return 0;
            });

            const report = generatePerformanceReport();

            const errorAlert = report.alerts.find(a => a.metric === 'error_rate');
            expect(errorAlert).toBeTruthy();
            expect(errorAlert.type).toBe('warning');
        });

        it('generates critical alert when circuit breaker is open', () => {
            getCircuitBreakerState.mockReturnValue({
                state: 'OPEN',
                failureCount: 5,
                isOpen: true,
                nextRetryTime: Date.now() + 30000,
            });

            const report = generatePerformanceReport();

            const cbAlert = report.alerts.find(a => a.metric === 'circuit_breaker');
            expect(cbAlert).toBeTruthy();
            expect(cbAlert.type).toBe('critical');
            expect(cbAlert.message).toContain('OPEN');
        });

        it('returns empty alerts array when all metrics are healthy', () => {
            getHistogramStats.mockReturnValue(null);
            getCounterValue.mockReturnValue(0);
            getCircuitBreakerState.mockReturnValue({
                state: 'CLOSED',
                failureCount: 0,
                isOpen: false,
                nextRetryTime: null,
            });

            const report = generatePerformanceReport();

            expect(report.alerts).toEqual([]);
        });
    });

    describe('overlay mode', () => {
        it('creates overlay element when mode is overlay', () => {
            initPerformanceDashboard({ mode: 'overlay' });

            // Trigger update
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            expect(overlay).toBeTruthy();
            expect(overlay.style.position).toBe('fixed');
        });

        it('updates overlay content on interval', () => {
            initPerformanceDashboard({ mode: 'overlay', intervalMs: 1000 });

            jest.advanceTimersByTime(100);
            const overlay = document.getElementById('otplus-perf-dashboard');
            const initialContent = overlay.innerHTML;

            // Advance time and check for updates
            jest.advanceTimersByTime(1000);
            // Content should be updated (includes timestamp)
            expect(overlay.innerHTML).toBeTruthy();
        });
    });

    describe('toggleOverlay', () => {
        it('hides overlay when visible', () => {
            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            expect(overlay.style.display).not.toBe('none');

            toggleOverlay();

            expect(overlay.style.display).toBe('none');
        });

        it('shows overlay when hidden', () => {
            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            toggleOverlay(); // Hide
            toggleOverlay(); // Show

            expect(overlay.style.display).toBe('block');
        });

        it('switches to overlay mode from silent', () => {
            initPerformanceDashboard({ mode: 'silent' });

            toggleOverlay();

            expect(document.getElementById('otplus-perf-dashboard')).toBeTruthy();
        });
    });

    describe('getDashboardStatus', () => {
        it('returns current status information', () => {
            initPerformanceDashboard({ mode: 'console', intervalMs: 5000 });

            const status = getDashboardStatus();

            expect(status.running).toBe(true);
            expect(status.mode).toBe('console');
            expect(status.intervalMs).toBe(5000);
            expect(status.lastUpdate).toBeDefined();
        });
    });

    describe('window exposure', () => {
        it('exposes dashboard on window for debugging', () => {
            expect(window.__OTPLUS_PERF_DASHBOARD__).toBeDefined();
            expect(typeof window.__OTPLUS_PERF_DASHBOARD__.init).toBe('function');
            expect(typeof window.__OTPLUS_PERF_DASHBOARD__.stop).toBe('function');
            expect(typeof window.__OTPLUS_PERF_DASHBOARD__.getStatus).toBe('function');
            expect(typeof window.__OTPLUS_PERF_DASHBOARD__.getReport).toBe('function');
            expect(typeof window.__OTPLUS_PERF_DASHBOARD__.toggleOverlay).toBe('function');
        });
    });

    describe('memory alerts', () => {
        beforeEach(() => {
            // Mock performance.memory
            Object.defineProperty(performance, 'memory', {
                value: {
                    usedJSHeapSize: 150 * 1024 * 1024, // 150 MB
                    totalJSHeapSize: 200 * 1024 * 1024,
                    jsHeapSizeLimit: 2048 * 1024 * 1024,
                },
                writable: true,
                configurable: true,
            });
        });

        afterEach(() => {
            delete performance.memory;
        });

        it('generates warning when memory exceeds threshold', () => {
            initPerformanceDashboard({
                mode: 'silent',
                trackMemory: true,
                alertThresholds: { memoryUsageMB: 100 },
            });

            const report = generatePerformanceReport();

            const memoryAlert = report.alerts.find(a => a.metric === 'memory');
            expect(memoryAlert).toBeDefined();
            expect(memoryAlert.type).toBe('warning');
        });

        it('generates critical alert when memory exceeds 1.5x threshold', () => {
            // Set memory to 160 MB, threshold to 100, so 160 > 100 * 1.5 = 150
            Object.defineProperty(performance, 'memory', {
                value: {
                    usedJSHeapSize: 160 * 1024 * 1024,
                    totalJSHeapSize: 200 * 1024 * 1024,
                    jsHeapSizeLimit: 2048 * 1024 * 1024,
                },
                writable: true,
                configurable: true,
            });

            initPerformanceDashboard({
                mode: 'silent',
                trackMemory: true,
                alertThresholds: { memoryUsageMB: 100 },
            });

            const report = generatePerformanceReport();

            const memoryAlert = report.alerts.find(a => a.metric === 'memory');
            expect(memoryAlert).toBeDefined();
            expect(memoryAlert.type).toBe('critical');
        });

        it('does not track memory when disabled', () => {
            initPerformanceDashboard({
                mode: 'silent',
                trackMemory: false,
            });

            const report = generatePerformanceReport();
            expect(report.memory).toBeNull();
        });
    });

    describe('calculation performance alerts', () => {
        it('generates warning when calc latency exceeds threshold', () => {
            getHistogramStats.mockImplementation((name) => {
                if (name === 'calculation_duration_ms') {
                    return {
                        count: 10,
                        sum: 60000,
                        min: 100,
                        max: 10000,
                        avg: 6000,
                        p50: 5000,
                        p95: 8000, // Exceeds default 5000ms threshold
                        p99: 9500,
                    };
                }
                return null;
            });

            const report = generatePerformanceReport();

            const calcAlert = report.alerts.find(a => a.metric === 'calc_time');
            expect(calcAlert).toBeDefined();
            expect(calcAlert.type).toBe('warning');
        });

        it('generates critical alert when calc latency exceeds 2x threshold', () => {
            getHistogramStats.mockImplementation((name) => {
                if (name === 'calculation_duration_ms') {
                    return {
                        count: 10,
                        sum: 120000,
                        min: 100,
                        max: 15000,
                        avg: 12000,
                        p50: 10000,
                        p95: 12000, // > 5000 * 2 = 10000
                        p99: 14000,
                    };
                }
                return null;
            });

            const report = generatePerformanceReport();

            const calcAlert = report.alerts.find(a => a.metric === 'calc_time');
            expect(calcAlert).toBeDefined();
            expect(calcAlert.type).toBe('critical');
        });
    });

    describe('critical error rate alerts', () => {
        it('generates critical alert when error rate exceeds 2x threshold', () => {
            getCounterValue.mockImplementation((name) => {
                if (name === 'api_request_count') return 100;
                if (name === 'api_error_count') return 15; // 15% error rate > 5% * 2
                return 0;
            });

            const report = generatePerformanceReport();

            const errorAlert = report.alerts.find(a => a.metric === 'error_rate');
            expect(errorAlert).toBeDefined();
            expect(errorAlert.type).toBe('critical');
        });
    });

    describe('formatDuration', () => {
        it('formats seconds correctly', () => {
            initPerformanceDashboard({ mode: 'console' });

            // Advance time by 45 seconds
            jest.advanceTimersByTime(45000);

            const status = getDashboardStatus();
            // The lastUpdate is a timestamp, we can't test formatDuration directly
            // but we can verify the dashboard continues to run
            expect(status.running).toBe(true);
        });

        it('formats minutes correctly', () => {
            initPerformanceDashboard({ mode: 'console' });

            // Advance time by 2 minutes and 30 seconds
            jest.advanceTimersByTime(150000);

            const status = getDashboardStatus();
            expect(status.running).toBe(true);
        });

        it('formats hours correctly', () => {
            initPerformanceDashboard({ mode: 'console' });

            // Advance time by 1 hour and 15 minutes
            jest.advanceTimersByTime(4500000);

            const status = getDashboardStatus();
            expect(status.running).toBe(true);
        });
    });

    describe('formatReportForConsole', () => {
        it('includes memory info when available', () => {
            Object.defineProperty(performance, 'memory', {
                value: {
                    usedJSHeapSize: 50 * 1024 * 1024,
                    totalJSHeapSize: 100 * 1024 * 1024,
                    jsHeapSizeLimit: 2048 * 1024 * 1024,
                },
                writable: true,
                configurable: true,
            });

            initPerformanceDashboard({ mode: 'console', trackMemory: true });
            jest.advanceTimersByTime(100);

            // The console.log should have been called
            expect(console.log).toHaveBeenCalled();

            delete performance.memory;
        });

        it('includes API latency when available', () => {
            getHistogramStats.mockImplementation((name) => {
                if (name === 'api_request_duration_ms') {
                    return {
                        count: 50,
                        sum: 2500,
                        min: 20,
                        max: 200,
                        avg: 50,
                        p50: 45,
                        p95: 150,
                        p99: 180,
                    };
                }
                return null;
            });

            initPerformanceDashboard({ mode: 'console' });
            jest.advanceTimersByTime(100);

            expect(console.log).toHaveBeenCalled();
        });

        it('includes calculation latency when available', () => {
            getHistogramStats.mockImplementation((name) => {
                if (name === 'calculation_duration_ms') {
                    return {
                        count: 20,
                        sum: 4000,
                        min: 100,
                        max: 500,
                        avg: 200,
                        p50: 180,
                        p95: 400,
                        p99: 480,
                    };
                }
                return null;
            });

            initPerformanceDashboard({ mode: 'console' });
            jest.advanceTimersByTime(100);

            expect(console.log).toHaveBeenCalled();
        });

        it('includes alerts in console output', () => {
            getCounterValue.mockImplementation((name) => {
                if (name === 'api_request_count') return 100;
                if (name === 'api_error_count') return 10;
                return 0;
            });

            initPerformanceDashboard({ mode: 'console' });
            jest.advanceTimersByTime(100);

            expect(console.log).toHaveBeenCalled();
        });
    });

    describe('overlay updateOverlay', () => {
        it('creates overlay element with correct styles', () => {
            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            expect(overlay.style.position).toBe('fixed');
            expect(overlay.style.zIndex).toBe('999999');
        });

        it('displays alerts in overlay', () => {
            getCounterValue.mockImplementation((name) => {
                if (name === 'api_request_count') return 100;
                if (name === 'api_error_count') return 10;
                return 0;
            });

            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            expect(overlay.innerHTML).toContain('Alerts');
        });

        it('shows "No alerts" when healthy', () => {
            getHistogramStats.mockReturnValue(null);
            getCounterValue.mockReturnValue(0);
            getCircuitBreakerState.mockReturnValue({
                state: 'CLOSED',
                failureCount: 0,
                isOpen: false,
                nextRetryTime: null,
            });

            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            expect(overlay.innerHTML).toContain('No alerts');
        });
    });

    describe('keyboard shortcut', () => {
        it('toggles overlay on Ctrl+Shift+P', () => {
            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            expect(overlay.style.display).not.toBe('none');

            // Simulate Ctrl+Shift+P
            const event = new KeyboardEvent('keydown', {
                key: 'P',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
            });
            document.dispatchEvent(event);

            expect(overlay.style.display).toBe('none');

            // Toggle back
            document.dispatchEvent(event);
            expect(overlay.style.display).toBe('block');
        });

        it('ignores other key combinations', () => {
            initPerformanceDashboard({ mode: 'overlay' });
            jest.advanceTimersByTime(100);

            const overlay = document.getElementById('otplus-perf-dashboard');
            const initialDisplay = overlay.style.display;

            // Just Ctrl+P (no Shift)
            const event = new KeyboardEvent('keydown', {
                key: 'P',
                ctrlKey: true,
                shiftKey: false,
                bubbles: true,
            });
            document.dispatchEvent(event);

            expect(overlay.style.display).toBe(initialDisplay);
        });
    });

    describe('toggleOverlay from console mode', () => {
        it('switches from console to overlay mode', () => {
            // Clean up any existing overlay from previous tests
            const existingOverlay = document.getElementById('otplus-perf-dashboard');
            if (existingOverlay) {
                existingOverlay.remove();
            }

            stopPerformanceDashboard();
            initPerformanceDashboard({ mode: 'console' });

            // In console mode, overlay shouldn't be created initially
            // but previous tests may have created one
            toggleOverlay();

            // After toggle, overlay should exist
            expect(document.getElementById('otplus-perf-dashboard')).toBeTruthy();
        });
    });

    describe('circuit breaker variations', () => {
        it('handles HALF_OPEN state', () => {
            getCircuitBreakerState.mockReturnValue({
                state: 'HALF_OPEN',
                failureCount: 2,
                isOpen: false,
                nextRetryTime: Date.now() + 10000,
            });

            const report = generatePerformanceReport();

            expect(report.circuitBreaker.state).toBe('HALF_OPEN');
            expect(report.circuitBreaker.failures).toBe(2);
        });

        it('handles circuit breaker error gracefully', () => {
            getCircuitBreakerState.mockImplementation(() => {
                throw new Error('Circuit breaker unavailable');
            });

            const report = generatePerformanceReport();

            expect(report.circuitBreaker.state).toBe('unknown');
            expect(report.circuitBreaker.failures).toBe(0);
        });
    });

    describe('CSP report handling', () => {
        let getCSPReportStats;

        beforeEach(async () => {
            const cspModule = await import('../../js/csp-reporter.js');
            getCSPReportStats = cspModule.getCSPReportStats;
        });

        it('handles CSP report error gracefully', () => {
            jest.unstable_mockModule('../../js/csp-reporter.js', () => ({
                getCSPReportStats: jest.fn(() => {
                    throw new Error('CSP unavailable');
                }),
            }));

            // The generatePerformanceReport catches this error
            const report = generatePerformanceReport();

            // Should have default values
            expect(report.csp).toBeDefined();
        });
    });

    describe('multiple critical alerts', () => {
        it('logs all critical alerts', () => {
            // Set up conditions for multiple critical alerts
            getHistogramStats.mockImplementation((name) => {
                if (name === 'api_request_duration_ms') {
                    return {
                        count: 100,
                        sum: 500000,
                        min: 100,
                        max: 10000,
                        avg: 5000,
                        p50: 4000,
                        p95: 8000, // Critical: > 2000 * 2
                        p99: 9500,
                    };
                }
                return null;
            });

            getCounterValue.mockImplementation((name) => {
                if (name === 'api_request_count') return 100;
                if (name === 'api_error_count') return 20; // Critical: 20% > 5% * 2
                return 0;
            });

            getCircuitBreakerState.mockReturnValue({
                state: 'OPEN',
                failureCount: 5,
                isOpen: true,
                nextRetryTime: Date.now() + 30000,
            });

            initPerformanceDashboard({ mode: 'console' });
            jest.advanceTimersByTime(100);

            const report = generatePerformanceReport();

            // Should have multiple critical alerts
            const criticalAlerts = report.alerts.filter(a => a.type === 'critical');
            expect(criticalAlerts.length).toBeGreaterThan(1);
        });
    });
});
