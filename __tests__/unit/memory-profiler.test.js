/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Unit tests for memory profiler
 *
 * Tests the memory profiling utilities for load testing.
 * Note: performance.memory is a Chrome-specific API not available in jsdom,
 * so we test the profiler's behavior when the API is unavailable.
 *
 * @see js/memory-profiler.ts - memory profiler implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock console
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

import { MemoryProfiler, memoryProfiler } from '../../js/memory-profiler.js';

describe('Memory Profiler', () => {
    let profiler;

    beforeEach(() => {
        jest.useFakeTimers({ advanceTimers: true });
        profiler = new MemoryProfiler();
    });

    afterEach(() => {
        profiler.stop();
        jest.useRealTimers();
    });

    describe('MemoryProfiler class', () => {
        describe('isSupported', () => {
            it('returns false when performance.memory is not available', () => {
                // jsdom doesn't have performance.memory
                expect(profiler.isSupported()).toBe(false);
            });
        });

        describe('start', () => {
            it('starts profiling', () => {
                profiler.start();
                const status = profiler.getStatus();

                expect(status.isRunning).toBe(true);
            });

            it('accepts custom configuration', () => {
                profiler.start({
                    sampleIntervalMs: 500,
                    maxSamples: 50,
                });

                const status = profiler.getStatus();
                expect(status.isRunning).toBe(true);
            });

            it('does not start again if already running', () => {
                profiler.start();
                expect(profiler.getStatus().isRunning).toBe(true);

                // Starting again should not throw
                profiler.start();
                expect(profiler.getStatus().isRunning).toBe(true);
            });

            it('starts interval when autoSample is true', () => {
                profiler.start({ sampleIntervalMs: 100, autoSample: true });

                // Advance timers - even though snapshots return null,
                // the interval should still be running
                jest.advanceTimersByTime(300);

                profiler.stop();
            });
        });

        describe('stop', () => {
            it('stops profiling', () => {
                profiler.start();
                profiler.stop();

                const status = profiler.getStatus();
                expect(status.isRunning).toBe(false);
            });

            it('can be called multiple times safely', () => {
                profiler.start();
                profiler.stop();
                profiler.stop(); // Should not throw
                profiler.stop();

                expect(profiler.getStatus().isRunning).toBe(false);
            });

            it('can be called before start', () => {
                // Should not throw
                profiler.stop();
                expect(profiler.getStatus().isRunning).toBe(false);
            });
        });

        describe('takeSnapshot', () => {
            it('returns null when memory API is not available', () => {
                const snapshot = profiler.takeSnapshot();
                expect(snapshot).toBeNull();
            });

            it('accepts optional label', () => {
                // Even if snapshot is null, the method should accept the label
                profiler.takeSnapshot('test-label');
                // Should not throw
            });
        });

        describe('analyze', () => {
            it('returns empty analysis when no samples', () => {
                const analysis = profiler.analyze();

                expect(analysis.summary.sampleCount).toBe(0);
                expect(analysis.issues).toEqual([]);
                expect(analysis.samples).toEqual([]);
                expect(analysis.labeledSnapshots).toEqual({});
            });

            it('returns zeroed summary for empty profiler', () => {
                const analysis = profiler.analyze();

                expect(analysis.summary.durationMs).toBe(0);
                expect(analysis.summary.initialUsageMB).toBe(0);
                expect(analysis.summary.finalUsageMB).toBe(0);
                expect(analysis.summary.peakUsageMB).toBe(0);
                expect(analysis.summary.avgUsageMB).toBe(0);
                expect(analysis.summary.growthRateMBPerSec).toBe(0);
            });
        });

        describe('compare', () => {
            it('handles missing snapshots gracefully', () => {
                const comparison = profiler.compare('nonexistent1', 'nonexistent2');

                expect(comparison.diffMB).toBe(0);
                expect(comparison.diffPercent).toBe(0);
                expect(comparison.snapshot1).toBeNull();
                expect(comparison.snapshot2).toBeNull();
                expect(comparison.label1).toBe('nonexistent1');
                expect(comparison.label2).toBe('nonexistent2');
            });
        });

        describe('getStatus', () => {
            it('returns correct status before start', () => {
                const status = profiler.getStatus();

                expect(status.isRunning).toBe(false);
                expect(status.sampleCount).toBe(0);
                expect(status.durationMs).toBe(0);
            });

            it('returns correct status after start', () => {
                profiler.start();
                const status = profiler.getStatus();

                expect(status.isRunning).toBe(true);
            });

            it('tracks duration while running', () => {
                profiler.start();
                jest.advanceTimersByTime(5000);

                const status = profiler.getStatus();
                expect(status.durationMs).toBeGreaterThanOrEqual(5000);
            });

            it('returns zero duration when stopped', () => {
                profiler.start();
                jest.advanceTimersByTime(5000);
                profiler.stop();

                const status = profiler.getStatus();
                expect(status.durationMs).toBe(0);
            });
        });

        describe('clear', () => {
            it('clears all data', () => {
                profiler.start();
                profiler.stop();
                profiler.clear();

                const status = profiler.getStatus();
                expect(status.sampleCount).toBe(0);

                const analysis = profiler.analyze();
                expect(analysis.labeledSnapshots).toEqual({});
                expect(analysis.samples).toEqual([]);
            });
        });

        describe('configuration', () => {
            it('uses default configuration', () => {
                const defaultProfiler = new MemoryProfiler();
                defaultProfiler.start();

                // Should use default intervalMs of 1000
                const status = defaultProfiler.getStatus();
                expect(status.isRunning).toBe(true);

                defaultProfiler.stop();
            });

            it('allows partial configuration override', () => {
                const customProfiler = new MemoryProfiler({
                    maxSamples: 50,
                });

                customProfiler.start();
                expect(customProfiler.getStatus().isRunning).toBe(true);
                customProfiler.stop();
            });

            it('allows configuration override on start', () => {
                profiler.start({ sampleIntervalMs: 2000 });
                expect(profiler.getStatus().isRunning).toBe(true);
                profiler.stop();
            });
        });
    });

    describe('singleton instance', () => {
        it('exports a default memoryProfiler instance', () => {
            expect(memoryProfiler).toBeDefined();
            expect(typeof memoryProfiler.start).toBe('function');
            expect(typeof memoryProfiler.stop).toBe('function');
            expect(typeof memoryProfiler.takeSnapshot).toBe('function');
            expect(typeof memoryProfiler.analyze).toBe('function');
            expect(typeof memoryProfiler.compare).toBe('function');
            expect(typeof memoryProfiler.getStatus).toBe('function');
            expect(typeof memoryProfiler.clear).toBe('function');
            expect(typeof memoryProfiler.isSupported).toBe('function');
        });
    });

    describe('window exposure', () => {
        it('exposes memory profiler on window for debugging', () => {
            expect(window.__OTPLUS_MEMORY_PROFILER__).toBeDefined();
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.start).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.stop).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.snapshot).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.analyze).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.compare).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.getStatus).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.isSupported).toBe('function');
            expect(typeof window.__OTPLUS_MEMORY_PROFILER__.clear).toBe('function');
        });
    });

    describe('with mocked performance.memory', () => {
        let mockMemory;
        let memoryProfiler;

        beforeEach(() => {
            // Mock performance.memory (Chrome-specific API)
            mockMemory = {
                usedJSHeapSize: 50 * 1024 * 1024, // 50 MB
                totalJSHeapSize: 100 * 1024 * 1024, // 100 MB
                jsHeapSizeLimit: 2048 * 1024 * 1024, // 2 GB
            };

            Object.defineProperty(performance, 'memory', {
                value: mockMemory,
                writable: true,
                configurable: true,
            });

            memoryProfiler = new MemoryProfiler();
        });

        afterEach(() => {
            memoryProfiler.stop();
            // Clean up performance.memory mock
            delete performance.memory;
        });

        describe('isSupported', () => {
            it('returns true when performance.memory is available', () => {
                expect(memoryProfiler.isSupported()).toBe(true);
            });
        });

        describe('takeSnapshot', () => {
            it('returns a snapshot with memory data', () => {
                const snapshot = memoryProfiler.takeSnapshot();

                expect(snapshot).not.toBeNull();
                expect(snapshot.usedHeapSize).toBe(mockMemory.usedJSHeapSize);
                expect(snapshot.totalHeapSize).toBe(mockMemory.totalJSHeapSize);
                expect(snapshot.heapSizeLimit).toBe(mockMemory.jsHeapSizeLimit);
                expect(snapshot.timestamp).toBeDefined();
            });

            it('stores labeled snapshots', () => {
                memoryProfiler.takeSnapshot('test-label');
                const analysis = memoryProfiler.analyze();

                expect(analysis.labeledSnapshots['test-label']).toBeDefined();
            });

            it('tracks DOM node count when enabled', () => {
                // Create some DOM elements
                const div1 = document.createElement('div');
                const div2 = document.createElement('div');
                document.body.appendChild(div1);
                document.body.appendChild(div2);

                const profilerWithDOM = new MemoryProfiler({ trackDOMNodes: true });
                const snapshot = profilerWithDOM.takeSnapshot();

                expect(snapshot.domNodeCount).toBeGreaterThan(0);

                // Cleanup
                document.body.removeChild(div1);
                document.body.removeChild(div2);
            });

            it('trims old samples when maxSamples is exceeded', () => {
                const smallProfiler = new MemoryProfiler({ maxSamples: 5 });

                for (let i = 0; i < 10; i++) {
                    smallProfiler.takeSnapshot();
                }

                const analysis = smallProfiler.analyze();
                expect(analysis.samples.length).toBe(5);
            });
        });

        describe('analyze with samples', () => {
            it('calculates memory statistics correctly', () => {
                // Simulate memory growth over time
                memoryProfiler.takeSnapshot('start');

                mockMemory.usedJSHeapSize = 60 * 1024 * 1024;
                memoryProfiler.takeSnapshot();

                mockMemory.usedJSHeapSize = 70 * 1024 * 1024;
                memoryProfiler.takeSnapshot();

                mockMemory.usedJSHeapSize = 65 * 1024 * 1024;
                memoryProfiler.takeSnapshot('end');

                const analysis = memoryProfiler.analyze();

                expect(analysis.summary.sampleCount).toBe(4);
                expect(analysis.summary.initialUsageMB).toBe(50);
                expect(analysis.summary.finalUsageMB).toBe(65);
                expect(analysis.summary.peakUsageMB).toBe(70);
                expect(analysis.summary.minUsageMB).toBe(50);
            });

            it('detects memory leak when growth rate exceeds threshold', () => {
                // Create a profiler with low threshold
                const leakProfiler = new MemoryProfiler({
                    growthRateWarningThresholdMBPerSec: 0.001,
                });

                // Take snapshots with increasing memory
                mockMemory.usedJSHeapSize = 50 * 1024 * 1024;
                leakProfiler.takeSnapshot();

                // Advance time
                jest.advanceTimersByTime(1000);

                mockMemory.usedJSHeapSize = 100 * 1024 * 1024; // 50 MB growth
                leakProfiler.takeSnapshot();

                const analysis = leakProfiler.analyze();

                const leakIssue = analysis.issues.find(i => i.type === 'leak');
                expect(leakIssue).toBeDefined();
                expect(leakIssue.severity).toBe('critical'); // > 5 MB/sec
            });

            it('detects memory spike', () => {
                const spikeProfiler = new MemoryProfiler();

                // Create samples with a spike
                for (let i = 0; i < 20; i++) {
                    mockMemory.usedJSHeapSize = 50 * 1024 * 1024; // 50 MB
                    spikeProfiler.takeSnapshot();
                }

                // Add a spike (must be > avg + 2 * stdDev, and stdDev > 5)
                mockMemory.usedJSHeapSize = 200 * 1024 * 1024; // 200 MB
                spikeProfiler.takeSnapshot();

                // Add more normal samples to increase stdDev
                for (let i = 0; i < 10; i++) {
                    mockMemory.usedJSHeapSize = (40 + i * 2) * 1024 * 1024;
                    spikeProfiler.takeSnapshot();
                }

                const analysis = spikeProfiler.analyze();

                const spikeIssue = analysis.issues.find(i => i.type === 'spike');
                expect(spikeIssue).toBeDefined();
            });

            it('detects high memory usage', () => {
                // Set memory usage to 85% of limit
                mockMemory.usedJSHeapSize = 0.85 * mockMemory.jsHeapSizeLimit;

                memoryProfiler.takeSnapshot();

                const analysis = memoryProfiler.analyze();

                const highUsageIssue = analysis.issues.find(i => i.type === 'high_usage');
                expect(highUsageIssue).toBeDefined();
                expect(highUsageIssue.severity).toBe('warning');
            });

            it('detects critical high memory usage above 90%', () => {
                // Set memory usage to 92% of limit
                mockMemory.usedJSHeapSize = 0.92 * mockMemory.jsHeapSizeLimit;

                memoryProfiler.takeSnapshot();

                const analysis = memoryProfiler.analyze();

                const highUsageIssue = analysis.issues.find(i => i.type === 'high_usage');
                expect(highUsageIssue).toBeDefined();
                expect(highUsageIssue.severity).toBe('critical');
            });

            it('detects GC pressure with many memory drops', () => {
                const gcProfiler = new MemoryProfiler();

                // Simulate 120 seconds of data with frequent GC events
                const baseTime = Date.now();
                jest.setSystemTime(baseTime);

                for (let i = 0; i < 100; i++) {
                    jest.setSystemTime(baseTime + i * 1000);

                    // Alternate between high and low memory (> 5 MB drops)
                    if (i % 5 === 0) {
                        mockMemory.usedJSHeapSize = 100 * 1024 * 1024; // 100 MB
                    } else {
                        mockMemory.usedJSHeapSize = 50 * 1024 * 1024; // 50 MB (drop > 5 MB)
                    }
                    gcProfiler.takeSnapshot();
                }

                const analysis = gcProfiler.analyze();

                const gcIssue = analysis.issues.find(i => i.type === 'gc_pressure');
                expect(gcIssue).toBeDefined();
            });
        });

        describe('compare with labeled snapshots', () => {
            it('compares two labeled snapshots correctly', () => {
                mockMemory.usedJSHeapSize = 50 * 1024 * 1024;
                memoryProfiler.takeSnapshot('before');

                mockMemory.usedJSHeapSize = 75 * 1024 * 1024;
                memoryProfiler.takeSnapshot('after');

                const comparison = memoryProfiler.compare('before', 'after');

                expect(comparison.snapshot1).not.toBeNull();
                expect(comparison.snapshot2).not.toBeNull();
                expect(comparison.diffMB).toBe(25); // 75 - 50 = 25 MB
                expect(comparison.diffPercent).toBe(50); // 25/50 * 100 = 50%
            });

            it('handles comparison when first snapshot has zero memory', () => {
                // Edge case: zero-division handling
                mockMemory.usedJSHeapSize = 0;
                memoryProfiler.takeSnapshot('zero');

                mockMemory.usedJSHeapSize = 50 * 1024 * 1024;
                memoryProfiler.takeSnapshot('nonzero');

                const comparison = memoryProfiler.compare('zero', 'nonzero');

                expect(comparison.diffPercent).toBe(0); // Protected from division by zero
            });

            it('handles comparison with missing first snapshot', () => {
                mockMemory.usedJSHeapSize = 50 * 1024 * 1024;
                memoryProfiler.takeSnapshot('existing');

                const comparison = memoryProfiler.compare('missing', 'existing');

                expect(comparison.snapshot1).toBeNull();
                expect(comparison.snapshot2).not.toBeNull();
                expect(comparison.diffMB).toBe(0);
            });

            it('handles comparison with missing second snapshot', () => {
                mockMemory.usedJSHeapSize = 50 * 1024 * 1024;
                memoryProfiler.takeSnapshot('existing');

                const comparison = memoryProfiler.compare('existing', 'missing');

                expect(comparison.snapshot1).not.toBeNull();
                expect(comparison.snapshot2).toBeNull();
                expect(comparison.diffMB).toBe(0);
            });
        });

        describe('analyze edge cases', () => {
            it('handles empty values array in stdDev calculation', () => {
                // This tests the edge case where calculateStdDev receives an empty array
                // indirectly through the analyze method
                const analysis = memoryProfiler.analyze();
                expect(analysis.summary.sampleCount).toBe(0);
            });

            it('handles growth rate calculation with zero duration', () => {
                // Single sample means no time difference
                memoryProfiler.takeSnapshot();

                const analysis = memoryProfiler.analyze();

                // Should not throw, growth rate should be 0
                expect(analysis.summary.growthRateMBPerSec).toBe(0);
            });
        });
    });
});
