/**
 * @fileoverview Memory Profiler for Load Testing
 *
 * Provides utilities for profiling memory usage under load conditions.
 * Helps identify memory leaks, excessive allocations, and GC pressure.
 *
 * ## Features
 *
 * - Snapshot-based memory tracking
 * - Automatic periodic sampling
 * - Growth rate detection
 * - Memory leak warnings
 * - GC timing analysis (when available)
 *
 * ## Usage
 *
 * ```typescript
 * import { MemoryProfiler } from './memory-profiler.js';
 *
 * const profiler = new MemoryProfiler();
 *
 * // Start profiling
 * profiler.start({ sampleIntervalMs: 1000, maxSamples: 100 });
 *
 * // ... perform operations ...
 *
 * // Get analysis
 * const analysis = profiler.analyze();
 * console.log(analysis.summary);
 *
 * // Stop profiling
 * profiler.stop();
 * ```
 *
 * ## Access via Console
 *
 * ```javascript
 * // Start memory profiling
 * window.__OTPLUS_MEMORY_PROFILER__.start()
 *
 * // Take a snapshot
 * window.__OTPLUS_MEMORY_PROFILER__.snapshot('after-calculation')
 *
 * // Get analysis
 * window.__OTPLUS_MEMORY_PROFILER__.analyze()
 *
 * // Stop profiling
 * window.__OTPLUS_MEMORY_PROFILER__.stop()
 * ```
 */

import { createLogger } from './logger.js';

const logger = createLogger('MemProfiler');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Memory snapshot data.
 */
export interface MemorySnapshot {
    /** Timestamp of the snapshot */
    timestamp: number;
    /** Label for the snapshot (optional) */
    label?: string;
    /** Used JS heap size in bytes */
    usedHeapSize: number;
    /** Total JS heap size in bytes */
    totalHeapSize: number;
    /** JS heap size limit in bytes */
    heapSizeLimit: number;
    /** Number of DOM nodes (if trackDOMNodes enabled) */
    domNodeCount?: number;
    /** Number of event listeners (estimated) */
    eventListenerCount?: number;
}

/**
 * Memory profiler configuration.
 */
export interface MemoryProfilerConfig {
    /** Interval between automatic samples in ms (default: 1000) */
    sampleIntervalMs: number;
    /** Maximum number of samples to retain (default: 1000) */
    maxSamples: number;
    /** Whether to track DOM node count (default: true) */
    trackDOMNodes: boolean;
    /** Memory growth rate threshold for warnings (MB/sec, default: 1) */
    growthRateWarningThresholdMBPerSec: number;
    /** Enable automatic sampling (default: true) */
    autoSample: boolean;
}

/**
 * Memory analysis result.
 */
export interface MemoryAnalysis {
    /** Summary statistics */
    summary: {
        /** Duration of profiling in ms */
        durationMs: number;
        /** Number of samples collected */
        sampleCount: number;
        /** Initial memory usage in MB */
        initialUsageMB: number;
        /** Final memory usage in MB */
        finalUsageMB: number;
        /** Peak memory usage in MB */
        peakUsageMB: number;
        /** Minimum memory usage in MB */
        minUsageMB: number;
        /** Average memory usage in MB */
        avgUsageMB: number;
        /** Net memory change in MB */
        netChangeMB: number;
        /** Average growth rate in MB/sec */
        growthRateMBPerSec: number;
    };
    /** Potential issues detected */
    issues: MemoryIssue[];
    /** Labeled snapshots for comparison */
    labeledSnapshots: Record<string, MemorySnapshot>;
    /** Raw samples for detailed analysis */
    samples: MemorySnapshot[];
}

/**
 * Memory issue detected during analysis.
 */
export interface MemoryIssue {
    type: 'leak' | 'spike' | 'high_usage' | 'gc_pressure';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    details: Record<string, unknown>;
}

// ============================================================================
// MEMORY PROFILER CLASS
// ============================================================================

/**
 * Memory profiler for tracking and analyzing memory usage.
 */
export class MemoryProfiler {
    private config: MemoryProfilerConfig;
    private samples: MemorySnapshot[] = [];
    private labeledSnapshots: Map<string, MemorySnapshot> = new Map();
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private startTime: number = 0;
    private isRunning: boolean = false;

    constructor(config?: Partial<MemoryProfilerConfig>) {
        this.config = {
            sampleIntervalMs: 1000,
            maxSamples: 1000,
            trackDOMNodes: true,
            growthRateWarningThresholdMBPerSec: 1,
            autoSample: true,
            ...config,
        };
    }

    /**
     * Checks if memory API is available.
     */
    isSupported(): boolean {
        return typeof performance !== 'undefined' && 'memory' in performance;
    }

    /**
     * Starts memory profiling.
     */
    start(config?: Partial<MemoryProfilerConfig>): void {
        if (this.isRunning) {
            logger.warn('Memory profiler is already running');
            return;
        }

        if (config) {
            this.config = { ...this.config, ...config };
        }

        this.samples = [];
        this.labeledSnapshots.clear();
        this.startTime = Date.now();
        this.isRunning = true;

        // Take initial snapshot
        this.takeSnapshot('start');

        // Start automatic sampling
        if (this.config.autoSample) {
            this.intervalId = setInterval(() => {
                this.takeSnapshot();
            }, this.config.sampleIntervalMs);
        }

        logger.info('Memory profiler started', {
            sampleIntervalMs: this.config.sampleIntervalMs,
            maxSamples: this.config.maxSamples,
        });
    }

    /**
     * Stops memory profiling.
     */
    stop(): void {
        if (!this.isRunning) return;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        // Take final snapshot
        this.takeSnapshot('end');

        this.isRunning = false;
        logger.info('Memory profiler stopped', {
            sampleCount: this.samples.length,
            durationMs: Date.now() - this.startTime,
        });
    }

    /**
     * Takes a memory snapshot.
     */
    takeSnapshot(label?: string): MemorySnapshot | null {
        if (!this.isSupported()) {
            return null;
        }

        const perf = performance as Performance & {
            memory: {
                usedJSHeapSize: number;
                totalJSHeapSize: number;
                jsHeapSizeLimit: number;
            };
        };

        const snapshot: MemorySnapshot = {
            timestamp: Date.now(),
            label,
            usedHeapSize: perf.memory.usedJSHeapSize,
            totalHeapSize: perf.memory.totalJSHeapSize,
            heapSizeLimit: perf.memory.jsHeapSizeLimit,
        };

        // Track DOM nodes if enabled and available
        if (this.config.trackDOMNodes && typeof document !== 'undefined') {
            snapshot.domNodeCount = document.getElementsByTagName('*').length;
        }

        // Store the snapshot
        this.samples.push(snapshot);

        // Trim old samples if needed
        if (this.samples.length > this.config.maxSamples) {
            this.samples.shift();
        }

        // Store labeled snapshot for later comparison
        if (label) {
            this.labeledSnapshots.set(label, snapshot);
        }

        return snapshot;
    }

    /**
     * Analyzes collected memory data.
     */
    analyze(): MemoryAnalysis {
        const issues: MemoryIssue[] = [];

        if (this.samples.length === 0) {
            return {
                summary: {
                    durationMs: 0,
                    sampleCount: 0,
                    initialUsageMB: 0,
                    finalUsageMB: 0,
                    peakUsageMB: 0,
                    minUsageMB: 0,
                    avgUsageMB: 0,
                    netChangeMB: 0,
                    growthRateMBPerSec: 0,
                },
                issues: [],
                labeledSnapshots: {},
                samples: [],
            };
        }

        const bytesToMB = (bytes: number) => bytes / (1024 * 1024);

        const usages = this.samples.map(s => bytesToMB(s.usedHeapSize));
        const initial = usages[0];
        const final = usages[usages.length - 1];
        const peak = Math.max(...usages);
        const min = Math.min(...usages);
        const avg = usages.reduce((a, b) => a + b, 0) / usages.length;
        const netChange = final - initial;

        const durationMs = this.samples[this.samples.length - 1].timestamp - this.samples[0].timestamp;
        const durationSec = durationMs / 1000;
        const growthRate = durationSec > 0 ? netChange / durationSec : 0;

        // Detect potential memory leaks
        if (growthRate > this.config.growthRateWarningThresholdMBPerSec) {
            issues.push({
                type: 'leak',
                severity: growthRate > 5 ? 'critical' : 'warning',
                message: `Memory growing at ${growthRate.toFixed(2)} MB/sec`,
                details: { growthRate, threshold: this.config.growthRateWarningThresholdMBPerSec },
            });
        }

        // Detect memory spikes
        const stdDev = this.calculateStdDev(usages);
        if (peak > avg + 2 * stdDev && stdDev > 5) {
            issues.push({
                type: 'spike',
                severity: peak > avg + 3 * stdDev ? 'warning' : 'info',
                message: `Memory spike detected: peak ${peak.toFixed(1)}MB vs avg ${avg.toFixed(1)}MB`,
                details: { peak, avg, stdDev },
            });
        }

        // Detect high memory usage
        const heapLimitMB = bytesToMB(this.samples[0].heapSizeLimit);
        const usagePercent = (peak / heapLimitMB) * 100;
        if (usagePercent > 80) {
            issues.push({
                type: 'high_usage',
                severity: usagePercent > 90 ? 'critical' : 'warning',
                message: `High memory usage: ${usagePercent.toFixed(1)}% of heap limit`,
                details: { usagePercent, peakMB: peak, heapLimitMB },
            });
        }

        // Detect GC pressure (frequent drops in memory)
        const gcEvents = this.detectGCEvents(usages);
        if (gcEvents > 10 && durationSec > 60) {
            const gcRate = gcEvents / (durationSec / 60);
            if (gcRate > 5) {
                issues.push({
                    type: 'gc_pressure',
                    severity: gcRate > 20 ? 'warning' : 'info',
                    message: `Possible GC pressure: ${gcEvents} potential GC events (${gcRate.toFixed(1)}/min)`,
                    details: { gcEvents, gcRate },
                });
            }
        }

        // Convert labeled snapshots to plain object
        const labeledObj: Record<string, MemorySnapshot> = {};
        this.labeledSnapshots.forEach((snapshot, label) => {
            labeledObj[label] = snapshot;
        });

        return {
            summary: {
                durationMs,
                sampleCount: this.samples.length,
                initialUsageMB: Math.round(initial * 100) / 100,
                finalUsageMB: Math.round(final * 100) / 100,
                peakUsageMB: Math.round(peak * 100) / 100,
                minUsageMB: Math.round(min * 100) / 100,
                avgUsageMB: Math.round(avg * 100) / 100,
                netChangeMB: Math.round(netChange * 100) / 100,
                growthRateMBPerSec: Math.round(growthRate * 1000) / 1000,
            },
            issues,
            labeledSnapshots: labeledObj,
            samples: [...this.samples],
        };
    }

    /**
     * Compares two labeled snapshots.
     */
    compare(label1: string, label2: string): {
        label1: string;
        label2: string;
        diffMB: number;
        diffPercent: number;
        snapshot1: MemorySnapshot | null;
        snapshot2: MemorySnapshot | null;
    } {
        const s1 = this.labeledSnapshots.get(label1) || null;
        const s2 = this.labeledSnapshots.get(label2) || null;

        if (!s1 || !s2) {
            return {
                label1,
                label2,
                diffMB: 0,
                diffPercent: 0,
                snapshot1: s1,
                snapshot2: s2,
            };
        }

        const bytesToMB = (bytes: number) => bytes / (1024 * 1024);
        const mb1 = bytesToMB(s1.usedHeapSize);
        const mb2 = bytesToMB(s2.usedHeapSize);
        const diffMB = mb2 - mb1;
        const diffPercent = mb1 > 0 ? ((mb2 - mb1) / mb1) * 100 : 0;

        return {
            label1,
            label2,
            diffMB: Math.round(diffMB * 100) / 100,
            diffPercent: Math.round(diffPercent * 100) / 100,
            snapshot1: s1,
            snapshot2: s2,
        };
    }

    /**
     * Gets current profiler status.
     */
    getStatus(): {
        isRunning: boolean;
        sampleCount: number;
        durationMs: number;
        isSupported: boolean;
    } {
        return {
            isRunning: this.isRunning,
            sampleCount: this.samples.length,
            durationMs: this.isRunning ? Date.now() - this.startTime : 0,
            isSupported: this.isSupported(),
        };
    }

    /**
     * Clears all collected data.
     */
    clear(): void {
        this.samples = [];
        this.labeledSnapshots.clear();
    }

    /**
     * Calculates standard deviation.
     */
    private calculateStdDev(values: number[]): number {
        if (values.length === 0) return 0;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const squareDiffs = values.map(v => Math.pow(v - avg, 2));
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(avgSquareDiff);
    }

    /**
     * Detects potential GC events (significant memory drops).
     */
    private detectGCEvents(usages: number[]): number {
        let gcEvents = 0;
        for (let i = 1; i < usages.length; i++) {
            const drop = usages[i - 1] - usages[i];
            // Consider a drop of more than 5MB as a potential GC event
            if (drop > 5) {
                gcEvents++;
            }
        }
        return gcEvents;
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Default memory profiler instance.
 */
export const memoryProfiler = new MemoryProfiler();

// ============================================================================
// WINDOW EXPOSURE
// ============================================================================

/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__OTPLUS_MEMORY_PROFILER__ = {
        start: (config?: Partial<MemoryProfilerConfig>) => memoryProfiler.start(config),
        stop: () => memoryProfiler.stop(),
        snapshot: (label?: string) => memoryProfiler.takeSnapshot(label),
        analyze: () => memoryProfiler.analyze(),
        compare: (l1: string, l2: string) => memoryProfiler.compare(l1, l2),
        getStatus: () => memoryProfiler.getStatus(),
        clear: () => memoryProfiler.clear(),
        isSupported: () => memoryProfiler.isSupported(),
    };
}
