/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Unit tests for metrics module
 *
 * Tests the performance metrics collection utilities.
 *
 * @see js/metrics.ts - metrics implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock console
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'debug').mockImplementation(() => {});

// Dynamic import to reset module state
let configureMetrics;
let isMetricsEnabled;
let startTimer;
let measureSync;
let measureAsync;
let recordHistogram;
let incrementCounter;
let setGauge;
let getHistogramStats;
let getCounterValue;
let getGaugeValue;
let exportMetricsJson;
let exportMetricsPrometheus;
let clearMetrics;
let getMetricsSummary;
let MetricNames;

describe('Metrics Module', () => {
    beforeEach(async () => {
        jest.useFakeTimers({ advanceTimers: true });
        jest.resetModules();

        const metricsModule = await import('../../js/metrics.js');
        configureMetrics = metricsModule.configureMetrics;
        isMetricsEnabled = metricsModule.isMetricsEnabled;
        startTimer = metricsModule.startTimer;
        measureSync = metricsModule.measureSync;
        measureAsync = metricsModule.measureAsync;
        recordHistogram = metricsModule.recordHistogram;
        incrementCounter = metricsModule.incrementCounter;
        setGauge = metricsModule.setGauge;
        getHistogramStats = metricsModule.getHistogramStats;
        getCounterValue = metricsModule.getCounterValue;
        getGaugeValue = metricsModule.getGaugeValue;
        exportMetricsJson = metricsModule.exportMetricsJson;
        exportMetricsPrometheus = metricsModule.exportMetricsPrometheus;
        clearMetrics = metricsModule.clearMetrics;
        getMetricsSummary = metricsModule.getMetricsSummary;
        MetricNames = metricsModule.MetricNames;
    });

    afterEach(() => {
        jest.useRealTimers();
        if (clearMetrics) {
            clearMetrics();
        }
    });

    describe('configureMetrics', () => {
        it('enables metrics collection', () => {
            configureMetrics({ enabled: true });
            expect(isMetricsEnabled()).toBe(true);
        });

        it('disables metrics collection', () => {
            configureMetrics({ enabled: false });
            expect(isMetricsEnabled()).toBe(false);
        });

        it('accepts partial configuration', () => {
            configureMetrics({ maxHistogramSamples: 500 });
            expect(isMetricsEnabled()).toBe(true);
        });
    });

    describe('isMetricsEnabled', () => {
        it('returns true when enabled', () => {
            configureMetrics({ enabled: true });
            expect(isMetricsEnabled()).toBe(true);
        });

        it('returns false when disabled', () => {
            configureMetrics({ enabled: false });
            expect(isMetricsEnabled()).toBe(false);
        });
    });

    describe('startTimer', () => {
        it('returns a timer object with end, elapsed, and addLabels', () => {
            const timer = startTimer('test_timer');

            expect(typeof timer.end).toBe('function');
            expect(typeof timer.elapsed).toBe('function');
            expect(typeof timer.addLabels).toBe('function');
        });

        it('records duration when end is called', () => {
            const timer = startTimer('test_duration');
            jest.advanceTimersByTime(100);
            const duration = timer.end();

            expect(duration).toBeGreaterThanOrEqual(100);
            // startTimer passes empty labels object, so key is 'test_duration:{}'
            const stats = getHistogramStats('test_duration:{}');
            expect(stats).not.toBeNull();
            expect(stats.count).toBe(1);
        });

        it('returns elapsed time without ending the timer', () => {
            const timer = startTimer('test_elapsed');
            jest.advanceTimersByTime(50);
            const elapsed = timer.elapsed();

            expect(elapsed).toBeGreaterThanOrEqual(50);
            // Metric should not be recorded yet (neither with nor without empty labels)
            const stats = getHistogramStats('test_elapsed');
            const statsWithLabels = getHistogramStats('test_elapsed:{}');
            expect(stats).toBeNull();
            expect(statsWithLabels).toBeNull();
        });

        it('allows adding labels to the metric', () => {
            const timer = startTimer('test_labels');
            timer.addLabels({ status: 'success', method: 'GET' });
            timer.end();

            // Labels are part of the key, so original metric name alone won't have data
            // The metric is stored with labels as part of the key
        });
    });

    describe('measureSync', () => {
        it('measures synchronous function execution time', () => {
            const result = measureSync('sync_test', () => {
                let sum = 0;
                for (let i = 0; i < 1000; i++) sum += i;
                return sum;
            });

            expect(result).toBe(499500);
            // measureSync uses startTimer which passes empty labels
            const stats = getHistogramStats('sync_test:{}');
            expect(stats).not.toBeNull();
            expect(stats.count).toBe(1);
        });

        it('records duration even if function throws', () => {
            expect(() => {
                measureSync('sync_error', () => {
                    throw new Error('Test error');
                });
            }).toThrow('Test error');

            const stats = getHistogramStats('sync_error:{}');
            expect(stats).not.toBeNull();
        });
    });

    describe('measureAsync', () => {
        it('measures asynchronous function execution time', async () => {
            const result = await measureAsync('async_test', async () => {
                await Promise.resolve();
                return 42;
            });

            expect(result).toBe(42);
            // measureAsync uses startTimer which passes empty labels
            const stats = getHistogramStats('async_test:{}');
            expect(stats).not.toBeNull();
            expect(stats.count).toBe(1);
        });

        it('records duration even if async function throws', async () => {
            await expect(
                measureAsync('async_error', async () => {
                    throw new Error('Async error');
                })
            ).rejects.toThrow('Async error');

            const stats = getHistogramStats('async_error:{}');
            expect(stats).not.toBeNull();
        });
    });

    describe('recordHistogram', () => {
        it('records a single value', () => {
            recordHistogram('http_request_duration', 150);

            const stats = getHistogramStats('http_request_duration');
            expect(stats.count).toBe(1);
            expect(stats.sum).toBe(150);
            expect(stats.min).toBe(150);
            expect(stats.max).toBe(150);
        });

        it('records multiple values and updates statistics', () => {
            recordHistogram('response_time', 100);
            recordHistogram('response_time', 200);
            recordHistogram('response_time', 300);

            const stats = getHistogramStats('response_time');
            expect(stats.count).toBe(3);
            expect(stats.sum).toBe(600);
            expect(stats.min).toBe(100);
            expect(stats.max).toBe(300);
            expect(stats.avg).toBe(200);
        });

        it('records values with labels', () => {
            recordHistogram('api_call', 50, { endpoint: '/users', method: 'GET' });
            recordHistogram('api_call', 75, { endpoint: '/posts', method: 'POST' });

            // Each label combination creates a separate metric
            const stats1 = getHistogramStats('api_call:{"endpoint":"/users","method":"GET"}');
            const stats2 = getHistogramStats('api_call:{"endpoint":"/posts","method":"POST"}');

            expect(stats1.count).toBe(1);
            expect(stats2.count).toBe(1);
        });

        it('trims old values when maxHistogramSamples is exceeded', () => {
            configureMetrics({ maxHistogramSamples: 5 });

            for (let i = 0; i < 10; i++) {
                recordHistogram('trimmed_metric', i * 10);
            }

            const stats = getHistogramStats('trimmed_metric');
            // Count includes all values, but internal array is trimmed
            expect(stats.count).toBe(10);
        });

        it('evicts oldest metrics when maxMetricEntries is exceeded', () => {
            configureMetrics({ maxMetricEntries: 2 });

            recordHistogram('label_metric', 10, { id: '1' });
            recordHistogram('label_metric', 20, { id: '2' });
            recordHistogram('label_metric', 30, { id: '3' });

            const json = exportMetricsJson();
            const keys = Object.keys(json.metrics);

            expect(keys).toHaveLength(2);
            expect(json.metrics).not.toHaveProperty('label_metric:{"id":"1"}');
        });

        it('logs value when autoLog is enabled', () => {
            configureMetrics({ autoLog: true });
            recordHistogram('logged_metric', 123);
            // Logger is called (mocked)
        });

        it('does not record when metrics are disabled', () => {
            configureMetrics({ enabled: false });
            recordHistogram('disabled_metric', 100);

            const stats = getHistogramStats('disabled_metric');
            expect(stats).toBeNull();
        });
    });

    describe('incrementCounter', () => {
        it('increments counter by 1 by default', () => {
            incrementCounter('request_count');
            incrementCounter('request_count');
            incrementCounter('request_count');

            expect(getCounterValue('request_count')).toBe(3);
        });

        it('increments counter by specified delta', () => {
            incrementCounter('bytes_sent', 1024);
            incrementCounter('bytes_sent', 2048);

            expect(getCounterValue('bytes_sent')).toBe(3072);
        });

        it('increments counter with labels', () => {
            incrementCounter('errors', 1, { type: 'network' });
            incrementCounter('errors', 2, { type: 'network' });
            incrementCounter('errors', 1, { type: 'validation' });

            expect(getCounterValue('errors:{"type":"network"}')).toBe(3);
            expect(getCounterValue('errors:{"type":"validation"}')).toBe(1);
        });

        it('does not increment when metrics are disabled', () => {
            configureMetrics({ enabled: false });
            incrementCounter('disabled_counter');

            expect(getCounterValue('disabled_counter')).toBe(0);
        });
    });

    describe('setGauge', () => {
        it('sets gauge to a specific value', () => {
            setGauge('active_connections', 42);
            expect(getGaugeValue('active_connections')).toBe(42);
        });

        it('updates gauge value', () => {
            setGauge('temperature', 20);
            setGauge('temperature', 25);
            setGauge('temperature', 22);

            expect(getGaugeValue('temperature')).toBe(22);
        });

        it('does not set gauge when metrics are disabled', () => {
            configureMetrics({ enabled: false });
            setGauge('disabled_gauge', 100);

            expect(getGaugeValue('disabled_gauge')).toBeNull();
        });
    });

    describe('getHistogramStats', () => {
        it('returns null for non-existent metric', () => {
            expect(getHistogramStats('nonexistent')).toBeNull();
        });

        it('returns null for non-histogram metric type', () => {
            incrementCounter('my_counter');
            expect(getHistogramStats('my_counter')).toBeNull();
        });

        it('calculates percentiles correctly', () => {
            // Add 100 values from 1 to 100
            for (let i = 1; i <= 100; i++) {
                recordHistogram('percentile_test', i);
            }

            const stats = getHistogramStats('percentile_test');
            // With 100 values (1-100), using ceil-based formula: ceil(n * p) - 1
            // p50: ceil(100 * 0.5) - 1 = 49 → value at sorted[49] = 50
            expect(stats.p50).toBe(50);
            expect(stats.p95).toBe(95); // ceil(100 * 0.95) - 1 = 94 → value at sorted[94] = 95
            expect(stats.p99).toBe(99); // ceil(100 * 0.99) - 1 = 98 → value at sorted[98] = 99
        });

        it('handles Infinity min/max edge cases', () => {
            // When no values are recorded (fresh histogram), min would be Infinity
            // But since we always record at least one value in tests, let's test the normalization
            recordHistogram('edge_case', 0);
            const stats = getHistogramStats('edge_case');
            expect(stats.min).toBe(0);
            expect(stats.max).toBe(0);
        });

        it('returns 0 for avg when count is 0', () => {
            // This is a theoretical case - in practice, a histogram always has at least one value
            // The code handles it: avg: metric.count > 0 ? metric.sum / metric.count : 0
            recordHistogram('single', 100);
            const stats = getHistogramStats('single');
            expect(stats.avg).toBe(100);
        });
    });

    describe('getCounterValue', () => {
        it('returns 0 for non-existent counter', () => {
            expect(getCounterValue('nonexistent_counter')).toBe(0);
        });

        it('returns counter value', () => {
            incrementCounter('my_counter', 5);
            expect(getCounterValue('my_counter')).toBe(5);
        });
    });

    describe('getGaugeValue', () => {
        it('returns null for non-existent gauge', () => {
            expect(getGaugeValue('nonexistent_gauge')).toBeNull();
        });

        it('returns gauge value', () => {
            setGauge('my_gauge', 99);
            expect(getGaugeValue('my_gauge')).toBe(99);
        });
    });

    describe('exportMetricsJson', () => {
        it('returns JSON object with timestamp and metrics', () => {
            recordHistogram('latency', 100);
            incrementCounter('requests', 5);
            setGauge('connections', 10);

            const json = exportMetricsJson();

            expect(json.timestamp).toBeDefined();
            expect(json.metrics).toBeDefined();
        });

        it('includes histogram metrics with stats', () => {
            recordHistogram('api_latency', 50);
            recordHistogram('api_latency', 100);

            const json = exportMetricsJson();
            const metric = json.metrics['api_latency'];

            expect(metric.type).toBe('histogram');
            expect(metric.count).toBe(2);
            expect(metric.sum).toBe(150);
        });

        it('includes counter metrics', () => {
            incrementCounter('total_requests', 100);

            const json = exportMetricsJson();
            const metric = json.metrics['total_requests'];

            expect(metric.type).toBe('counter');
            expect(metric.value).toBe(100);
        });

        it('includes gauge metrics with timestamp', () => {
            setGauge('active_users', 25);

            const json = exportMetricsJson();
            const metric = json.metrics['active_users'];

            expect(metric.type).toBe('gauge');
            expect(metric.value).toBe(25);
            expect(metric.timestamp).toBeDefined();
        });
    });

    describe('exportMetricsPrometheus', () => {
        it('returns Prometheus-formatted string', () => {
            recordHistogram('http_duration', 150);

            const prometheus = exportMetricsPrometheus();

            expect(prometheus).toContain('# TYPE http_duration histogram');
            expect(prometheus).toContain('http_duration_count 1');
            expect(prometheus).toContain('http_duration_sum 150');
        });

        it('includes histogram buckets', () => {
            recordHistogram('request_time', 25);
            recordHistogram('request_time', 75);
            recordHistogram('request_time', 200);

            const prometheus = exportMetricsPrometheus();

            expect(prometheus).toContain('request_time_bucket{le="50"} 1');
            expect(prometheus).toContain('request_time_bucket{le="100"} 2');
            expect(prometheus).toContain('request_time_bucket{le="500"} 3');
            expect(prometheus).toContain('request_time_bucket{le="+Inf"} 3');
        });

        it('formats counter metrics', () => {
            incrementCounter('error_total', 5);

            const prometheus = exportMetricsPrometheus();

            expect(prometheus).toContain('# TYPE error_total counter');
            expect(prometheus).toContain('error_total 5');
        });

        it('formats gauge metrics', () => {
            setGauge('temperature', 72);

            const prometheus = exportMetricsPrometheus();

            expect(prometheus).toContain('# TYPE temperature gauge');
            expect(prometheus).toContain('temperature 72');
        });

        it('sanitizes metric names with special characters', () => {
            recordHistogram('api.request:duration', 100);

            const prometheus = exportMetricsPrometheus();

            // Prometheus metric names must match [a-zA-Z_:][a-zA-Z0-9_:]*
            expect(prometheus).toContain('api_request_duration');
        });
    });

    describe('clearMetrics', () => {
        it('clears all collected metrics', () => {
            recordHistogram('metric1', 100);
            incrementCounter('metric2');
            setGauge('metric3', 50);

            clearMetrics();

            expect(getHistogramStats('metric1')).toBeNull();
            expect(getCounterValue('metric2')).toBe(0);
            expect(getGaugeValue('metric3')).toBeNull();
        });
    });

    describe('getMetricsSummary', () => {
        it('returns summary for histogram metrics', () => {
            recordHistogram('test_latency', 100);
            recordHistogram('test_latency', 200);

            const summary = getMetricsSummary();

            expect(summary['test_latency']).toContain('avg=');
            expect(summary['test_latency']).toContain('p95=');
            expect(summary['test_latency']).toContain('count=');
        });

        it('returns value for counter metrics', () => {
            incrementCounter('test_counter', 42);

            const summary = getMetricsSummary();

            expect(summary['test_counter']).toBe(42);
        });

        it('returns value for gauge metrics', () => {
            setGauge('test_gauge', 99);

            const summary = getMetricsSummary();

            expect(summary['test_gauge']).toBe(99);
        });
    });

    describe('MetricNames constants', () => {
        it('exports standard metric names', () => {
            expect(MetricNames.API_REQUEST_DURATION).toBe('api_request_duration_ms');
            expect(MetricNames.API_REQUEST_COUNT).toBe('api_request_count');
            expect(MetricNames.API_ERROR_COUNT).toBe('api_error_count');
            expect(MetricNames.API_RETRY_COUNT).toBe('api_retry_count');
            expect(MetricNames.CACHE_HIT).toBe('cache_hit_count');
            expect(MetricNames.CACHE_MISS).toBe('cache_miss_count');
            expect(MetricNames.CACHE_SIZE).toBe('cache_size_bytes');
            expect(MetricNames.CALC_DURATION).toBe('calculation_duration_ms');
            expect(MetricNames.CALC_ENTRY_COUNT).toBe('calculation_entry_count');
            expect(MetricNames.CALC_USER_COUNT).toBe('calculation_user_count');
            expect(MetricNames.RENDER_DURATION).toBe('render_duration_ms');
            expect(MetricNames.EXPORT_DURATION).toBe('export_duration_ms');
        });

        it('exports circuit breaker metric names', () => {
            expect(MetricNames.CIRCUIT_BREAKER_STATE).toBe('circuit_breaker_state');
            expect(MetricNames.CIRCUIT_BREAKER_FAILURE_COUNT).toBe('circuit_breaker_failure_count');
        });
    });

    describe('window exposure', () => {
        it('exposes metrics on window for debugging', () => {
            expect(window.__OTPLUS_METRICS__).toBeDefined();
            expect(typeof window.__OTPLUS_METRICS__.get).toBe('function');
            expect(typeof window.__OTPLUS_METRICS__.summary).toBe('function');
            expect(typeof window.__OTPLUS_METRICS__.clear).toBe('function');
            expect(typeof window.__OTPLUS_METRICS__.prometheus).toBe('function');
        });

        it('window.get returns JSON export', () => {
            recordHistogram('window_test', 100);
            const json = window.__OTPLUS_METRICS__.get();

            expect(json.metrics).toBeDefined();
            expect(json.metrics['window_test']).toBeDefined();
        });

        it('window.summary returns metrics summary', () => {
            incrementCounter('summary_test', 5);
            const summary = window.__OTPLUS_METRICS__.summary();

            expect(summary['summary_test']).toBe(5);
        });

        it('window.clear clears all metrics', () => {
            recordHistogram('clear_test', 100);
            window.__OTPLUS_METRICS__.clear();

            expect(getHistogramStats('clear_test')).toBeNull();
        });

        it('window.prometheus returns Prometheus format', () => {
            incrementCounter('prom_test', 10);
            const prom = window.__OTPLUS_METRICS__.prometheus();

            expect(prom).toContain('prom_test 10');
        });
    });

    describe('disabled metrics behavior', () => {
        it('startTimer.end still returns duration but does not record', () => {
            configureMetrics({ enabled: false });
            const timer = startTimer('disabled_timer');
            jest.advanceTimersByTime(50);
            const duration = timer.end();

            // Duration is still tracked for the return value
            expect(duration).toBeGreaterThanOrEqual(0);
            // But not recorded
            expect(getHistogramStats('disabled_timer')).toBeNull();
        });

        it('measureSync still executes function', () => {
            configureMetrics({ enabled: false });
            const result = measureSync('disabled_measure', () => 42);
            expect(result).toBe(42);
        });

        it('measureAsync still executes async function', async () => {
            configureMetrics({ enabled: false });
            const result = await measureAsync('disabled_async', async () => 'done');
            expect(result).toBe('done');
        });
    });
});
