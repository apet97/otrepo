/**
 * @fileoverview Performance Metrics Collection Module
 *
 * Provides utilities for tracking and reporting performance metrics:
 * - API call durations
 * - Calculation processing times
 * - Cache hit/miss rates
 * - Render times
 *
 * Metrics can be exported in multiple formats for monitoring systems.
 */

import { createLogger } from './logger.js';

const metricsLogger = createLogger('Metrics');

// ============================================================================
// METRIC TYPES
// ============================================================================

/**
 * Histogram metric for tracking distributions (latencies, sizes, etc.)
 */
interface HistogramMetric {
    type: 'histogram';
    name: string;
    values: number[];
    count: number;
    sum: number;
    min: number;
    max: number;
}

/**
 * Counter metric for tracking cumulative values
 */
interface CounterMetric {
    type: 'counter';
    name: string;
    value: number;
    labels?: Record<string, string>;
}

/**
 * Gauge metric for tracking current values
 */
interface GaugeMetric {
    type: 'gauge';
    name: string;
    value: number;
    timestamp: number;
}

type Metric = HistogramMetric | CounterMetric | GaugeMetric;

// ============================================================================
// METRICS STORE
// ============================================================================

/**
 * Internal store for all collected metrics.
 */
const metrics: Map<string, Metric> = new Map();

/**
 * Configuration for metrics collection.
 */
interface MetricsConfig {
    /** Whether metrics collection is enabled */
    enabled: boolean;
    /** Maximum number of histogram samples to retain */
    maxHistogramSamples: number;
    /** Maximum number of metric entries to retain */
    maxMetricEntries: number;
    /** Whether to log metrics automatically */
    autoLog: boolean;
}

let config: MetricsConfig = {
    enabled: true,
    maxHistogramSamples: 1000,
    maxMetricEntries: 1000,
    autoLog: false,
};

function enforceMetricLimit(): void {
    if (metrics.size <= config.maxMetricEntries) return;
    const excess = metrics.size - config.maxMetricEntries;
    for (let i = 0; i < excess; i += 1) {
        const oldestKey = metrics.keys().next().value;
        if (oldestKey === undefined) break;
        metrics.delete(oldestKey);
    }
}

function touchMetric(key: string, metric: Metric): void {
    if (metrics.has(key)) {
        metrics.delete(key);
    } else if (metrics.size >= config.maxMetricEntries) {
        const oldestKey = metrics.keys().next().value;
        if (oldestKey !== undefined) {
            metrics.delete(oldestKey);
        }
    }
    metrics.set(key, metric);
}

/**
 * Configure the metrics collector.
 */
export function configureMetrics(newConfig: Partial<MetricsConfig>): void {
    config = { ...config, ...newConfig };
    enforceMetricLimit();
}

/**
 * Check if metrics collection is enabled.
 */
export function isMetricsEnabled(): boolean {
    return config.enabled;
}

// ============================================================================
// TIMING UTILITIES
// ============================================================================

/**
 * Timer handle returned by startTimer.
 */
export interface Timer {
    /** End the timer and record the duration */
    end: () => number;
    /** Get elapsed time without ending the timer */
    elapsed: () => number;
    /** Add labels to the metric when ended */
    addLabels: (labels: Record<string, string>) => Timer;
}

/**
 * Start a timer for measuring operation duration.
 *
 * @param metricName - Name of the metric to record
 * @returns Timer handle with end() and elapsed() methods
 *
 * @example
 * const timer = startTimer('api_request_duration');
 * await fetchData();
 * const duration = timer.end(); // Records and returns duration in ms
 */
export function startTimer(metricName: string): Timer {
    const startTime = performance.now();
    let labels: Record<string, string> = {};

    // Create timer object that can reference itself for proper chaining
    const timer: Timer = {
        end: () => {
            const duration = performance.now() - startTime;
            recordHistogram(metricName, duration, labels);
            return duration;
        },
        elapsed: () => performance.now() - startTime,
        addLabels: (newLabels: Record<string, string>) => {
            labels = { ...labels, ...newLabels };
            return timer; // Return the actual timer for proper chaining
        },
    };

    return timer;
}

/**
 * Measure the execution time of a function.
 *
 * @param metricName - Name of the metric to record
 * @param fn - Function to measure
 * @returns The return value of the function
 */
export function measureSync<T>(metricName: string, fn: () => T): T {
    const timer = startTimer(metricName);
    try {
        return fn();
    } finally {
        timer.end();
    }
}

/**
 * Measure the execution time of an async function.
 *
 * @param metricName - Name of the metric to record
 * @param fn - Async function to measure
 * @returns Promise resolving to the return value
 */
export async function measureAsync<T>(metricName: string, fn: () => Promise<T>): Promise<T> {
    const timer = startTimer(metricName);
    try {
        return await fn();
    } finally {
        timer.end();
    }
}

// ============================================================================
// METRIC RECORDING
// ============================================================================

/**
 * Record a histogram value (for latencies, sizes, etc.).
 *
 * @param name - Metric name
 * @param value - Value to record
 * @param labels - Optional labels for the metric
 */
export function recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>
): void {
    if (!config.enabled) return;

    const key = labels ? `${name}:${JSON.stringify(labels)}` : name;
    let metric = metrics.get(key) as HistogramMetric | undefined;

    if (!metric) {
        metric = {
            type: 'histogram',
            name,
            values: [],
            count: 0,
            sum: 0,
            min: Infinity,
            max: -Infinity,
        };
    }

    // Trim old values BEFORE push to maintain strict bounds (prevents temporary memory spike)
    if (metric.values.length >= config.maxHistogramSamples) {
        metric.values.shift();
    }

    metric.values.push(value);
    metric.count++;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    touchMetric(key, metric);

    if (config.autoLog) {
        metricsLogger.debug(`${name}: ${value.toFixed(2)}ms`, labels);
    }
}

/**
 * Increment a counter metric.
 *
 * @param name - Metric name
 * @param delta - Amount to increment (default: 1)
 * @param labels - Optional labels for the metric
 */
export function incrementCounter(
    name: string,
    delta = 1,
    labels?: Record<string, string>
): void {
    if (!config.enabled) return;

    const key = labels ? `${name}:${JSON.stringify(labels)}` : name;
    let metric = metrics.get(key) as CounterMetric | undefined;

    if (!metric) {
        metric = {
            type: 'counter',
            name,
            value: 0,
            labels,
        };
    }

    metric.value += delta;
    touchMetric(key, metric);
}

/**
 * Set a gauge metric to a specific value.
 *
 * @param name - Metric name
 * @param value - Current value
 */
export function setGauge(name: string, value: number): void {
    if (!config.enabled) return;

    const metric: GaugeMetric = {
        type: 'gauge',
        name,
        value,
        timestamp: Date.now(),
    };
    touchMetric(name, metric);
}

// ============================================================================
// METRIC RETRIEVAL
// ============================================================================

/**
 * Get histogram statistics for a metric.
 *
 * @param name - Metric name
 * @returns Statistics object or null if not found
 */
export function getHistogramStats(name: string): {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
} | null {
    const metric = metrics.get(name) as HistogramMetric | undefined;
    if (!metric || metric.type !== 'histogram') return null;

    const sorted = [...metric.values].sort((a, b) => a - b);
    // Use standard percentile formula: ceil(n * p) - 1, clamped to valid indices
    // For empty arrays, this defaults to index 0 which will return undefined (handled below)
    const len = sorted.length;
    const p50Index = len > 0 ? Math.min(Math.ceil(len * 0.5) - 1, len - 1) : 0;
    const p95Index = len > 0 ? Math.min(Math.ceil(len * 0.95) - 1, len - 1) : 0;
    const p99Index = len > 0 ? Math.min(Math.ceil(len * 0.99) - 1, len - 1) : 0;

    return {
        count: metric.count,
        sum: metric.sum,
        min: metric.min === Infinity ? 0 : metric.min,
        max: metric.max === -Infinity ? 0 : metric.max,
        avg: metric.count > 0 ? metric.sum / metric.count : 0,
        p50: sorted[p50Index] || 0,
        p95: sorted[p95Index] || 0,
        p99: sorted[p99Index] || 0,
    };
}

/**
 * Get the value of a counter metric.
 *
 * @param name - Metric name
 * @returns Counter value or 0 if not found
 */
export function getCounterValue(name: string): number {
    const metric = metrics.get(name) as CounterMetric | undefined;
    return metric?.value || 0;
}

/**
 * Get the value of a gauge metric.
 *
 * @param name - Metric name
 * @returns Gauge value or null if not found
 */
export function getGaugeValue(name: string): number | null {
    const metric = metrics.get(name) as GaugeMetric | undefined;
    return metric?.value ?? null;
}

// ============================================================================
// EXPORT FORMATS
// ============================================================================

/**
 * Export all metrics as JSON.
 *
 * @returns JSON object with all metrics
 */
export function exportMetricsJson(): Record<string, unknown> {
    const result: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        metrics: {},
    };

    const metricsObj = result.metrics as Record<string, unknown>;

    metrics.forEach((metric, key) => {
        if (metric.type === 'histogram') {
            const stats = getHistogramStats(key);
            metricsObj[key] = {
                type: 'histogram',
                ...stats,
            };
        } else if (metric.type === 'counter') {
            metricsObj[key] = {
                type: 'counter',
                value: metric.value,
            };
        } else if (metric.type === 'gauge') {
            metricsObj[key] = {
                type: 'gauge',
                value: metric.value,
                timestamp: metric.timestamp,
            };
        }
    });

    return result;
}

/**
 * Export metrics in Prometheus text format.
 *
 * @returns Prometheus-compatible metrics string
 */
export function exportMetricsPrometheus(): string {
    const lines: string[] = [];

    metrics.forEach((metric, key) => {
        const safeName = key.replace(/[^a-zA-Z0-9_]/g, '_');

        if (metric.type === 'histogram') {
            const stats = getHistogramStats(key);
            if (stats) {
                lines.push(`# TYPE ${safeName} histogram`);
                lines.push(`${safeName}_count ${stats.count}`);
                lines.push(`${safeName}_sum ${stats.sum}`);
                lines.push(`${safeName}_bucket{le="50"} ${metric.values.filter(v => v <= 50).length}`);
                lines.push(`${safeName}_bucket{le="100"} ${metric.values.filter(v => v <= 100).length}`);
                lines.push(`${safeName}_bucket{le="500"} ${metric.values.filter(v => v <= 500).length}`);
                lines.push(`${safeName}_bucket{le="1000"} ${metric.values.filter(v => v <= 1000).length}`);
                lines.push(`${safeName}_bucket{le="+Inf"} ${metric.values.length}`);
            }
        } else if (metric.type === 'counter') {
            lines.push(`# TYPE ${safeName} counter`);
            lines.push(`${safeName} ${metric.value}`);
        } else if (metric.type === 'gauge') {
            lines.push(`# TYPE ${safeName} gauge`);
            lines.push(`${safeName} ${metric.value}`);
        }
    });

    return lines.join('\n');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear all collected metrics.
 */
export function clearMetrics(): void {
    metrics.clear();
}

/**
 * Get a summary of all metrics for logging/diagnostics.
 */
export function getMetricsSummary(): Record<string, unknown> {
    const summary: Record<string, unknown> = {};

    metrics.forEach((metric, key) => {
        if (metric.type === 'histogram') {
            const stats = getHistogramStats(key);
            summary[key] = stats ? `avg=${stats.avg.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms, count=${stats.count}` : 'no data';
        } else if (metric.type === 'counter') {
            summary[key] = metric.value;
        } else if (metric.type === 'gauge') {
            summary[key] = metric.value;
        }
    });

    return summary;
}

// ============================================================================
// PREDEFINED METRIC NAMES
// ============================================================================

/**
 * Standard metric names for consistency.
 */
export const MetricNames = {
    // API metrics
    API_REQUEST_DURATION: 'api_request_duration_ms',
    API_REQUEST_COUNT: 'api_request_count',
    API_ERROR_COUNT: 'api_error_count',
    API_RETRY_COUNT: 'api_retry_count',

    // Circuit breaker metrics
    CIRCUIT_BREAKER_STATE: 'circuit_breaker_state',
    CIRCUIT_BREAKER_FAILURE_COUNT: 'circuit_breaker_failure_count',

    // Cache metrics
    CACHE_HIT: 'cache_hit_count',
    CACHE_MISS: 'cache_miss_count',
    CACHE_SIZE: 'cache_size_bytes',

    // Calculation metrics
    CALC_DURATION: 'calculation_duration_ms',
    CALC_ENTRY_COUNT: 'calculation_entry_count',
    CALC_USER_COUNT: 'calculation_user_count',

    // UI metrics
    RENDER_DURATION: 'render_duration_ms',
    EXPORT_DURATION: 'export_duration_ms',
} as const;

// Expose metrics on window for debugging
/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__OTPLUS_METRICS__ = {
        get: exportMetricsJson,
        summary: getMetricsSummary,
        clear: clearMetrics,
        prometheus: exportMetricsPrometheus,
    };
}
