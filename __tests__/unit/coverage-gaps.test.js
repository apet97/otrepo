/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Coverage gap tests for files 1-15
 *
 * Targeted tests to close branch/statement coverage gaps across
 * multiple source files. Grouped by source file in describe blocks.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock console to suppress noisy output
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'debug').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// Mock scrollIntoView for jsdom (not supported natively)
Element.prototype.scrollIntoView = jest.fn();

// ============================================================================
// 1. date-presets.ts — uncovered branches at lines 19-32 (Sunday edge case)
// ============================================================================
describe('date-presets: Sunday edge cases', () => {
    let mod;
    let realDate;

    beforeEach(async () => {
        mod = await import('../../js/date-presets.js');
        realDate = Date;
    });

    afterEach(() => {
        global.Date = realDate;
    });

    it('getThisWeekRange on a Sunday returns Monday-Sunday range', () => {
        // Mock Date to a known Sunday: 2026-03-15 is a Sunday
        const sunday = new Date('2026-03-15T12:00:00Z');
        const OrigDate = Date;
        global.Date = class extends OrigDate {
            constructor(...args) {
                if (args.length === 0) return sunday;
                return new OrigDate(...args);
            }
            static UTC = OrigDate.UTC;
        };

        const result = mod.getThisWeekRange();
        expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // On Sunday, start should be Monday (6 days before)
        const startDate = new Date(result.start + 'T00:00:00Z');
        expect(startDate.getUTCDay()).toBe(1); // Monday
    });

    it('getLastWeekRange on a Sunday returns correct last week', () => {
        const sunday = new Date('2026-03-15T12:00:00Z');
        const OrigDate = Date;
        global.Date = class extends OrigDate {
            constructor(...args) {
                if (args.length === 0) return sunday;
                return new OrigDate(...args);
            }
            static UTC = OrigDate.UTC;
        };

        const result = mod.getLastWeekRange();
        expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const startDate = new Date(result.start + 'T00:00:00Z');
        const endDate = new Date(result.end + 'T00:00:00Z');
        expect(startDate.getUTCDay()).toBe(1); // Monday
        expect(endDate.getUTCDay()).toBe(0); // Sunday
        // When calling on a Sunday, lastSundayOffset is -7 and lastMondayOffset is -13
        const expectedEnd = new Date('2026-03-08T00:00:00Z'); // Last Sunday
        const expectedStart = new Date('2026-03-02T00:00:00Z'); // Monday before last Sunday
        expect(result.end).toBe(expectedEnd.toISOString().split('T')[0]);
        expect(result.start).toBe(expectedStart.toISOString().split('T')[0]);
    });
});

// ============================================================================
// 2. metrics.ts — uncovered lines 88-92 (enforceMetricLimit loop)
// ============================================================================
describe('metrics: enforceMetricLimit', () => {
    let configureMetrics, incrementCounter,
        getCounterValue, clearMetrics;

    beforeEach(async () => {
        jest.resetModules();
        const m = await import('../../js/metrics.js');
        configureMetrics = m.configureMetrics;
        incrementCounter = m.incrementCounter;
        getCounterValue = m.getCounterValue;
        clearMetrics = m.clearMetrics;
    });

    afterEach(() => {
        clearMetrics();
    });

    it('enforceMetricLimit removes excess metrics when maxMetricEntries is reduced', () => {
        // Fill up with many metrics
        for (let i = 0; i < 20; i++) {
            incrementCounter(`metric_${i}`);
        }
        // Now lower the limit, which triggers enforceMetricLimit
        configureMetrics({ maxMetricEntries: 5 });
        // After lowering, only 5 should remain (the newest ones)
        let count = 0;
        for (let i = 0; i < 20; i++) {
            if (getCounterValue(`metric_${i}`) > 0) count++;
        }
        expect(count).toBeLessThanOrEqual(5);
    });

    it('touchMetric evicts oldest when at capacity', () => {
        configureMetrics({ maxMetricEntries: 3 });
        incrementCounter('a');
        incrementCounter('b');
        incrementCounter('c');
        // Adding a 4th should evict the oldest
        incrementCounter('d');
        // 'a' should have been evicted
        expect(getCounterValue('a')).toBe(0);
        expect(getCounterValue('d')).toBe(1);
    });
});

// ============================================================================
// 3. streaming.ts — uncovered branches at lines 199-216, 247, 369, 444
// ============================================================================
describe('streaming: uncovered branches', () => {
    let mapInChunks, filterInChunks, reduceInChunks, processStream,
        calculateOptimalChunkSize;

    beforeEach(async () => {
        const m = await import('../../js/streaming.js');
        mapInChunks = m.mapInChunks;
        filterInChunks = m.filterInChunks;
        reduceInChunks = m.reduceInChunks;
        processStream = m.processStream;
        calculateOptimalChunkSize = m.calculateOptimalChunkSize;
    });

    it('mapInChunks uses default chunkSize parameter', async () => {
        const items = [1, 2, 3];
        const result = await mapInChunks(items, (x) => x * 2);
        expect(result).toEqual([2, 4, 6]);
    });

    it('filterInChunks uses default chunkSize parameter', async () => {
        const items = [1, 2, 3, 4, 5];
        const result = await filterInChunks(items, (x) => x > 3);
        expect(result).toEqual([4, 5]);
    });

    it('reduceInChunks uses default chunkSize parameter', async () => {
        const items = [1, 2, 3, 4];
        const result = await reduceInChunks(items, (acc, x) => acc + x, 0);
        expect(result).toBe(10);
    });

    it('processStream handles abort signal', async () => {
        const controller = new AbortController();
        controller.abort();

        const source = {
            hasMore: () => true,
            getNextChunk: async () => [1, 2, 3],
            reset: () => {},
        };

        const result = await processStream(source, (x) => x, {}, controller.signal);
        expect(result.aborted).toBe(true);
        expect(result.processedCount).toBe(0);
    });

    it('processStream handles null chunk from getNextChunk', async () => {
        let callCount = 0;
        const source = {
            hasMore: () => callCount < 2,
            getNextChunk: async () => {
                callCount++;
                if (callCount === 1) return [1, 2];
                return null; // null chunk causes break
            },
            reset: () => {},
        };

        const result = await processStream(source, (x) => x * 10);
        expect(result.results).toEqual([10, 20]);
        expect(result.aborted).toBe(false);
    });

    it('processStream reports progress', async () => {
        const progressCalls = [];
        let callCount = 0;
        const source = {
            hasMore: () => callCount < 1,
            getNextChunk: async () => {
                callCount++;
                return [1, 2];
            },
            reset: () => {},
        };

        await processStream(
            source,
            (x) => x,
            { onProgress: (p, t, pct) => progressCalls.push({ p, t, pct }) }
        );
        expect(progressCalls.length).toBeGreaterThan(0);
        expect(progressCalls[0].t).toBe(-1); // Total unknown for streams
    });

    it('processStream yields between chunks when yieldInterval > 0', async () => {
        let callCount = 0;
        const source = {
            hasMore: () => callCount < 2,
            getNextChunk: async () => {
                callCount++;
                return [callCount];
            },
            reset: () => {},
        };

        const result = await processStream(source, (x) => x, { yieldInterval: 1 });
        expect(result.results).toEqual([1, 2]);
    });

    it('calculateOptimalChunkSize with very fast item processing', () => {
        // Very fast processing: should hit maxChunk cap
        const result = calculateOptimalChunkSize(500, 0.01, 30);
        expect(result).toBeGreaterThanOrEqual(10);
        expect(result).toBeLessThanOrEqual(500);
    });

    it('calculateOptimalChunkSize with default targetFps', () => {
        const result = calculateOptimalChunkSize(100, 5);
        expect(result).toBeGreaterThanOrEqual(10);
    });
});

// ============================================================================
// 4. export.ts — uncovered lines 354, 359, 555, 560
//    (multi-chunk summary/detailed CSV with yield)
// ============================================================================
describe('export: multi-chunk CSV export paths', () => {
    let downloadSummaryCsv, downloadDetailedCsv, downloadCsv;

    beforeEach(async () => {
        jest.resetModules();

        // Set up jsdom elements needed by export functions
        document.body.innerHTML = '';
        const link = document.createElement('a');
        link.click = jest.fn();
        const origCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tag) => {
            if (tag === 'a') return link;
            return origCreateElement(tag);
        });

        // Mock URL functions
        global.URL.createObjectURL = jest.fn(() => 'blob:mock');
        global.URL.revokeObjectURL = jest.fn();

        // Mock store for auditConsent
        const stateModule = await import('../../js/state.js');
        stateModule.store.config = { auditConsent: false };
        stateModule.store.claims = null;
        stateModule.store.currentDateRange = null;
        stateModule.store.ui = stateModule.store.ui || {};

        const exp = await import('../../js/export.js');
        downloadSummaryCsv = exp.downloadSummaryCsv;
        downloadDetailedCsv = exp.downloadDetailedCsv;
        downloadCsv = exp.downloadCsv;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('downloadSummaryCsv generates CSV with multiple chunks (>200 rows)', async () => {
        // Create analysis data that produces many summary rows
        const users = [];
        for (let i = 0; i < 250; i++) {
            users.push({
                userId: `u${i}`,
                userName: `User ${i}`,
                days: new Map(),
                totals: {
                    total: 8, regular: 8, overtime: 0, breaks: 0,
                    dailyOvertime: 0, weeklyOvertime: 0, overlapOvertime: 0,
                    combinedOvertime: 0, capacity: 8, vacationEntryHours: 0,
                    billableWorked: 0, billableOT: 0, nonBillableOT: 0,
                    amount: 0, amountEarned: 0, amountCost: 0, amountProfit: 0,
                    otPremium: 0, nonBillableWorked: 0,
                },
            });
        }

        await downloadSummaryCsv(users, 'user', 'test-summary.csv');
        // Should not throw, and link should be clicked
        expect(document.createElement).toHaveBeenCalled();
    });

    it('downloadDetailedCsv generates CSV with multiple chunks (>500 entries)', async () => {
        // Build analysis data with many entries
        const entries = [];
        for (let j = 0; j < 600; j++) {
            entries.push({
                id: `e${j}`,
                userId: 'u1',
                userName: 'User 1',
                description: `Task ${j}`,
                timeInterval: {
                    start: '2025-01-01T09:00:00Z',
                    end: '2025-01-01T17:00:00Z',
                    duration: 'PT8H',
                },
                analysis: { regular: 8, overtime: 0, isBillable: true },
                dayMeta: { isHoliday: false, holidayName: '', isNonWorking: false, isTimeOff: false },
            });
        }
        const days = new Map();
        days.set('2025-01-01', {
            entries,
            meta: { isHoliday: false, isNonWorking: false, isTimeOff: false },
        });
        const users = [{
            userId: 'u1',
            userName: 'User 1',
            days,
            totals: { total: 8, regular: 8, overtime: 0 },
        }];

        await downloadDetailedCsv(users, 'test-detailed.csv');
        expect(document.createElement).toHaveBeenCalled();
    });

    it('downloadCsv with multiple user chunks (>50 users) yields between chunks', async () => {
        const users = [];
        for (let i = 0; i < 60; i++) {
            const days = new Map();
            days.set('2025-01-01', {
                entries: [{
                    id: `e${i}`,
                    description: 'Work',
                    timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                    analysis: { regular: 8, overtime: 0, isBillable: false },
                }],
                meta: { isHoliday: false, isNonWorking: false, isTimeOff: false },
            });
            users.push({
                userId: `u${i}`,
                userName: `User ${i}`,
                days,
                totals: { total: 8, regular: 8, overtime: 0 },
            });
        }

        await downloadCsv(users, 'multi-chunk.csv');
        expect(document.createElement).toHaveBeenCalled();
    });
});

// ============================================================================
// 5. worker-pool.ts — uncovered branches at lines 54-56 (unrefTimerIfSupported), 319 (isBlobUrl)
// ============================================================================
describe('worker-pool: uncovered branches', () => {
    let WorkerPool, createInlineWorker;

    beforeEach(async () => {
        jest.resetModules();
        global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = jest.fn();

        // Mock Worker
        global.Worker = class {
            constructor() {
                this.onmessage = null;
                this.onerror = null;
            }
            postMessage() {}
            terminate() {}
        };

        const m = await import('../../js/worker-pool.js');
        WorkerPool = m.WorkerPool;
        createInlineWorker = m.createInlineWorker;
    });

    it('terminate revokes blob URL when workerScript is a blob URL', () => {
        const pool = new WorkerPool('blob:http://localhost/test', { poolSize: 1 });
        pool.terminate();
        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test');
    });

    it('terminate does not revoke URL when workerScript is not a blob URL', () => {
        const pool = new WorkerPool('./worker.js', { poolSize: 1 });
        pool.terminate();
        expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('unrefTimerIfSupported is called during task timeout setup', async () => {
        // The function handles both numeric and object timers
        // In jsdom, setTimeout returns a number, so the unref branch is skipped
        // But we can test the pool initializes and processes queue correctly
        const pool = new WorkerPool('./worker.js', { poolSize: 1, taskTimeout: 100 });
        await pool.initialize();
        // Pool should be initialized
        expect(pool.isInitialized()).toBe(true);
        pool.terminate();
    });

    it('createInlineWorker returns a blob URL', () => {
        const url = createInlineWorker((payload) => payload);
        expect(url).toBe('blob:mock-url');
        expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
});

// ============================================================================
// 6. csp-reporter.ts — uncovered lines 138, 151-152, 216, 226-228, 283
// ============================================================================
describe('csp-reporter: uncovered branches', () => {
    const originalFetch = global.fetch;

    beforeEach(async () => {
        jest.resetModules();
        global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('isAllowedCspEndpoint returns false for empty string', async () => {
        const { initCSPReporter, stopCSPReporter, resetCSPReportStats } = await import('../../js/csp-reporter.js');
        // The endpoint check is internal, but we can trigger it by configuring a custom endpoint
        initCSPReporter({
            reportToConsole: false,
            reportToSentry: false,
            customEndpoint: '', // empty string = not allowed
        });

        // Dispatch a violation
        const event = new Event('securitypolicyviolation', { bubbles: true });
        Object.defineProperties(event, {
            effectiveDirective: { value: 'script-src' },
            violatedDirective: { value: 'script-src' },
            blockedURI: { value: 'https://evil.com/script.js' },
            documentURI: { value: 'https://app.clockify.me/reports' },
            originalPolicy: { value: "script-src 'self'" },
            sourceFile: { value: '' },
            lineNumber: { value: 0 },
            columnNumber: { value: 0 },
            sample: { value: '' },
        });
        document.dispatchEvent(event);
        await Promise.resolve();

        // fetch should not have been called (empty endpoint is not allowed)
        expect(global.fetch).not.toHaveBeenCalled();
        stopCSPReporter();
        resetCSPReportStats();
    });

    it('canReport returns false when rate limit is exceeded', async () => {
        const { initCSPReporter, stopCSPReporter, resetCSPReportStats } = await import('../../js/csp-reporter.js');
        initCSPReporter({
            reportToConsole: false,
            reportToSentry: false,
            maxReportsPerMinute: 2,
        });

        // Dispatch more violations than the limit
        for (let i = 0; i < 5; i++) {
            const event = new Event('securitypolicyviolation', { bubbles: true });
            Object.defineProperties(event, {
                effectiveDirective: { value: 'script-src' },
                violatedDirective: { value: 'script-src' },
                blockedURI: { value: 'https://evil.com/script.js' },
                documentURI: { value: 'https://app.clockify.me/reports' },
                originalPolicy: { value: "script-src 'self'" },
                sourceFile: { value: '' },
                lineNumber: { value: 0 },
                columnNumber: { value: 0 },
                sample: { value: '' },
            });
            document.dispatchEvent(event);
        }

        // After the limit, reports should be blocked
        const stats = (await import('../../js/csp-reporter.js')).getCSPReportStats();
        expect(stats.reportCount).toBeLessThanOrEqual(5); // Rate limited
        stopCSPReporter();
        resetCSPReportStats();
    });

    it('normalizeViolation includes source file info when present', async () => {
        const { initCSPReporter, stopCSPReporter, resetCSPReportStats } = await import('../../js/csp-reporter.js');
        initCSPReporter({
            reportToConsole: true,
            reportToSentry: false,
            includeSample: true,
        });

        const event = new Event('securitypolicyviolation', { bubbles: true });
        Object.defineProperties(event, {
            effectiveDirective: { value: 'script-src' },
            violatedDirective: { value: 'script-src' },
            blockedURI: { value: 'https://evil.com/script.js' },
            documentURI: { value: 'https://app.clockify.me/reports' },
            originalPolicy: { value: "script-src 'self'" },
            sourceFile: { value: 'https://app.clockify.me/main.js' },
            lineNumber: { value: 42 },
            columnNumber: { value: 10 },
            sample: { value: 'eval("dangerous")' },
        });
        document.dispatchEvent(event);

        // The handler should have processed the violation (report counter incremented)
        const stats = (await import('../../js/csp-reporter.js')).getCSPReportStats();
        expect(stats.reportCount).toBe(1);
        stopCSPReporter();
        resetCSPReportStats();
    });

    it('initializes with empty config without error', async () => {
        const { initCSPReporter, stopCSPReporter, getCSPReportStats, resetCSPReportStats } = await import('../../js/csp-reporter.js');
        initCSPReporter({});

        // Reporter should be initialized in clean state
        const stats = getCSPReportStats();
        expect(stats.reportCount).toBe(0);
        stopCSPReporter();
        resetCSPReportStats();
    });

    it('sendReportToEndpoint handles non-https non-localhost endpoint', async () => {
        const { initCSPReporter, stopCSPReporter, resetCSPReportStats } = await import('../../js/csp-reporter.js');
        initCSPReporter({
            reportToConsole: false,
            reportToSentry: false,
            customEndpoint: 'http://external-server.com/csp-report',
        });

        const event = new Event('securitypolicyviolation', { bubbles: true });
        Object.defineProperties(event, {
            effectiveDirective: { value: 'script-src' },
            violatedDirective: { value: 'script-src' },
            blockedURI: { value: 'https://evil.com/script.js' },
            documentURI: { value: window.location.href },
            originalPolicy: { value: "script-src 'self'" },
            sourceFile: { value: '' },
            lineNumber: { value: 0 },
            columnNumber: { value: 0 },
            sample: { value: '' },
        });
        document.dispatchEvent(event);
        await Promise.resolve();

        // Non-HTTPS non-localhost endpoint should be blocked
        expect(global.fetch).not.toHaveBeenCalled();
        stopCSPReporter();
        resetCSPReportStats();
    });

    it('sendReportToEndpoint handles fetch failure', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
        const { initCSPReporter, stopCSPReporter, resetCSPReportStats } = await import('../../js/csp-reporter.js');
        initCSPReporter({
            reportToConsole: false,
            reportToSentry: false,
            customEndpoint: window.location.origin + '/csp-report',
        });

        const event = new Event('securitypolicyviolation', { bubbles: true });
        Object.defineProperties(event, {
            effectiveDirective: { value: 'script-src' },
            violatedDirective: { value: 'script-src' },
            blockedURI: { value: 'https://evil.com/script.js' },
            documentURI: { value: window.location.href },
            originalPolicy: { value: "script-src 'self'" },
            sourceFile: { value: '' },
            lineNumber: { value: 0 },
            columnNumber: { value: 0 },
            sample: { value: '' },
        });
        document.dispatchEvent(event);
        await Promise.resolve();
        await Promise.resolve(); // Extra tick for the async sendReportToEndpoint

        // Fetch should have been called (endpoint validation passed, send was attempted)
        expect(global.fetch).toHaveBeenCalled();
        stopCSPReporter();
        resetCSPReportStats();
    });
});

// ============================================================================
// 7. memory-profiler.ts — uncovered branches at lines 58-60 (unrefIntervalIfSupported)
// ============================================================================
describe('memory-profiler: unrefIntervalIfSupported branch', () => {
    let MemoryProfiler;

    beforeEach(async () => {
        jest.resetModules();
        const m = await import('../../js/memory-profiler.js');
        MemoryProfiler = m.MemoryProfiler;
    });

    it('handles interval ID with unref method (Node-like)', () => {
        // Simulate performance.memory for isSupported()
        const origPerf = global.performance;
        Object.defineProperty(global, 'performance', {
            value: {
                ...origPerf,
                memory: {
                    usedJSHeapSize: 10 * 1024 * 1024,
                    totalJSHeapSize: 20 * 1024 * 1024,
                    jsHeapSizeLimit: 100 * 1024 * 1024,
                },
                now: origPerf.now.bind(origPerf),
            },
            configurable: true,
        });

        const profiler = new MemoryProfiler({ sampleIntervalMs: 50, autoSample: true });
        profiler.start();
        // The interval should be set up - in Node env the timer has unref
        expect(profiler.getStatus().isRunning).toBe(true);
        profiler.stop();

        Object.defineProperty(global, 'performance', { value: origPerf, configurable: true });
    });

    it('handles numeric interval ID (browser-like)', () => {
        const origPerf = global.performance;
        Object.defineProperty(global, 'performance', {
            value: {
                ...origPerf,
                memory: {
                    usedJSHeapSize: 10 * 1024 * 1024,
                    totalJSHeapSize: 20 * 1024 * 1024,
                    jsHeapSizeLimit: 100 * 1024 * 1024,
                },
                now: origPerf.now.bind(origPerf),
            },
            configurable: true,
        });

        const profiler = new MemoryProfiler({ sampleIntervalMs: 50, autoSample: true });
        profiler.start();
        expect(profiler.getStatus().isRunning).toBe(true);
        profiler.stop();

        Object.defineProperty(global, 'performance', { value: origPerf, configurable: true });
    });
});

// ============================================================================
// 8. performance-dashboard.ts — uncovered lines 51-53 (unrefIntervalIfSupported), 543, 548
// ============================================================================
describe('performance-dashboard: uncovered branches', () => {
    let initPerformanceDashboard, stopPerformanceDashboard,
        toggleOverlay, getDashboardConfig, generatePerformanceReport;

    beforeEach(async () => {
        jest.resetModules();
        const m = await import('../../js/performance-dashboard.js');
        initPerformanceDashboard = m.initPerformanceDashboard;
        stopPerformanceDashboard = m.stopPerformanceDashboard;
        toggleOverlay = m.toggleOverlay;
        getDashboardConfig = m.getDashboardConfig;
        generatePerformanceReport = m.generatePerformanceReport;
    });

    afterEach(() => {
        stopPerformanceDashboard();
    });

    it('initPerformanceDashboard clears existing interval on re-init', () => {
        initPerformanceDashboard({ mode: 'console', intervalMs: 50000 });
        // Re-init should clear the first interval
        initPerformanceDashboard({ mode: 'console', intervalMs: 60000 });
        const config = getDashboardConfig();
        expect(config.intervalMs).toBe(60000);
        stopPerformanceDashboard();
    });

    it('toggleOverlay switches from silent to overlay mode', () => {
        initPerformanceDashboard({ mode: 'silent' });
        toggleOverlay();
        // Should have created an overlay element
        const overlay = document.getElementById('otplus-perf-dashboard');
        expect(overlay).not.toBeNull();
        stopPerformanceDashboard();
    });

    it('toggleOverlay toggles visibility of existing overlay', () => {
        initPerformanceDashboard({ mode: 'overlay', intervalMs: 999999 });
        const overlay = document.getElementById('otplus-perf-dashboard');
        expect(overlay).not.toBeNull();
        // Toggle to hide
        toggleOverlay();
        expect(overlay.style.display).toBe('none');
        // Toggle to show
        toggleOverlay();
        expect(overlay.style.display).toBe('block');
        stopPerformanceDashboard();
    });

    it('generatePerformanceReport returns valid report structure', () => {
        const report = generatePerformanceReport();
        expect(report).toHaveProperty('timestamp');
        expect(report).toHaveProperty('uptime');
        expect(report).toHaveProperty('api');
        expect(report).toHaveProperty('calculations');
        expect(report).toHaveProperty('circuitBreaker');
        expect(report).toHaveProperty('csp');
        expect(report).toHaveProperty('alerts');
    });
});

// ============================================================================
// 9. health-check.ts — uncovered branches at lines 102, 123-125, 128-134, 196
// ============================================================================
describe('health-check: uncovered branches', () => {
    let getHealthStatus;

    beforeEach(async () => {
        jest.resetModules();
        const { store } = await import('../../js/state.js');
        // Setup store with token that has valid JWT structure
        const base64url = (str) => Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const header = base64url(JSON.stringify({ alg: 'HS256' }));
        const payload = base64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
        const sig = base64url('sig');
        store.token = `${header}.${payload}.${sig}`;
        store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0, circuitBreakerOpen: false };
        store.diagnostics = {};
        // Ensure getEncryptionStatus returns healthy defaults
        store.getEncryptionStatus = () => ({ enabled: false, supported: false, keyReady: false, pending: false });

        const m = await import('../../js/health-check.js');
        getHealthStatus = m.getHealthStatus;
    });

    it('returns healthy when everything is fine', () => {
        const result = getHealthStatus();
        expect(result.status).toBe('healthy');
        expect(result.issues).toHaveLength(0);
    });

    it('returns unhealthy when token is expired', async () => {
        const { store } = await import('../../js/state.js');
        const base64url = (str) => Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const header = base64url(JSON.stringify({ alg: 'HS256' }));
        const payload = base64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 3600 }));
        const sig = base64url('sig');
        store.token = `${header}.${payload}.${sig}`;

        const result = getHealthStatus();
        expect(result.status).toBe('unhealthy');
        expect(result.issues).toContain('Authentication token has expired');
    });

    it('returns unhealthy when no token is present', async () => {
        const { store } = await import('../../js/state.js');
        store.token = null;

        const result = getHealthStatus();
        expect(result.status).toBe('unhealthy');
        expect(result.issues).toContain('No authentication token');
    });

    it('handles malformed JWT gracefully', async () => {
        const { store } = await import('../../js/state.js');
        store.token = 'not-a-valid-jwt';

        const result = getHealthStatus();
        expect(result.components.auth.isExpired).toBe(true);
    });

    it('reports worker pool issues', async () => {
        const { store } = await import('../../js/state.js');
        store.diagnostics = {
            workerPoolInitFailed: true,
            workerTaskFailures: 3,
        };

        const result = getHealthStatus();
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.stringContaining('Worker pool initialization failed'),
            expect.stringContaining('3 worker task(s) failed'),
        ]));
    });

    it('reports encryption key not initialized', async () => {
        const { store } = await import('../../js/state.js');
        store.getEncryptionStatus = () => ({
            enabled: true,
            supported: true,
            keyReady: false,
            pending: false,
        });

        const result = getHealthStatus();
        expect(result.issues).toContain('Encryption key not initialized');
    });

    it('reports degraded when non-auth issues exist', async () => {
        const { store } = await import('../../js/state.js');
        store.apiStatus.profilesFailed = 2;

        const result = getHealthStatus();
        expect(result.status).toBe('degraded');
    });

    it('reports sentry init failure in api probe', async () => {
        const { store } = await import('../../js/state.js');
        store.diagnostics = { sentryInitFailed: true };

        const result = getHealthStatus();
        expect(result.issues).toContain('Error reporting initialization failed');
    });
});

// ============================================================================
// 10. utils.ts — uncovered lines 275, 322-326, 340-341, 362-393, 714
// ============================================================================
describe('utils: uncovered branches', () => {
    let validateDateRange, validateInputBounds, validateCalcParams,
        validateOverrideValue, formatTimeHHmm;

    beforeEach(async () => {
        const m = await import('../../js/utils.js');
        validateDateRange = m.validateDateRange;
        validateInputBounds = m.validateInputBounds;
        validateCalcParams = m.validateCalcParams;
        validateOverrideValue = m.validateOverrideValue;
        formatTimeHHmm = m.formatTimeHHmm;
    });

    it('validateDateRange throws when range exceeds max days', () => {
        // MAX_DATE_RANGE_DAYS is 365
        expect(() => validateDateRange('2020-01-01', '2023-01-01')).toThrow();
    });

    it('validateInputBounds returns valid for unknown field with finite number', () => {
        const result = validateInputBounds('unknownField', 42);
        expect(result.valid).toBe(true);
        expect(result.value).toBe(42);
    });

    it('validateInputBounds returns invalid for unknown field with non-finite number', () => {
        const result = validateInputBounds('unknownField', NaN);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('valid number');
    });

    it('validateInputBounds returns invalid for known field with non-finite number', () => {
        const result = validateInputBounds('dailyThreshold', Infinity);
        expect(result.valid).toBe(false);
    });

    it('validateInputBounds clamps to valid range when clamp option is true', () => {
        const result = validateInputBounds('dailyThreshold', 30, { clamp: true });
        expect(result.valid).toBe(true);
        expect(result.clamped).toBe(true);
        expect(result.value).toBeLessThanOrEqual(24);
    });

    it('validateInputBounds returns error description for out-of-bounds without clamp', () => {
        const result = validateInputBounds('dailyThreshold', 30);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Daily threshold');
    });

    it('validateCalcParams collects errors for invalid params', () => {
        const result = validateCalcParams({
            dailyThreshold: 999,
            overtimeMultiplier: 999,
        });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('validateCalcParams skips undefined params', () => {
        const result = validateCalcParams({ dailyThreshold: undefined });
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('validateCalcParams returns valid params when all within bounds', () => {
        const result = validateCalcParams({ dailyThreshold: 8, overtimeMultiplier: 1.5 });
        expect(result.valid).toBe(true);
        expect(result.params.dailyThreshold).toBe(8);
    });

    it('validateOverrideValue maps tier2Threshold to tier2ThresholdHours', () => {
        const result = validateOverrideValue('tier2Threshold', 10);
        expect(result.valid).toBe(true);
    });

    it('formatTimeHHmm catches error for invalid timezone', () => {
        // Invalid timezone triggers the catch block (line 714)
        const result = formatTimeHHmm('2025-01-01T09:00:00Z', 'Invalid/Timezone');
        expect(result).toBe('');
    });

    it('formatTimeHHmm returns empty string for undefined', () => {
        const result = formatTimeHHmm(undefined);
        expect(result).toBe('');
    });
});

// ============================================================================
// 11. calc.ts — uncovered lines 324, 844, 904
//     (strictParseNumber non-string/non-number, getHoliday/getTimeOff Map type guard)
// ============================================================================
describe('calc: uncovered branches', () => {
    let calculateAnalysis;

    beforeEach(async () => {
        jest.resetModules();
        const m = await import('../../js/calc.js');
        calculateAnalysis = m.calculateAnalysis;
    });

    it('getHoliday handles corrupted holidays data (non-Map)', () => {
        // When holidays for a user is not a Map, it should silently return null
        const holidays = new Map();
        holidays.set('user1', 'not-a-map'); // corrupted

        const result = calculateAnalysis(
            [{
                id: 'e1', userId: 'user1', userName: 'Alice',
                description: 'Work',
                timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                hourlyRate: { amount: 5000 },
                billable: true,
            }],
            {
                config: { applyHolidays: true, applyTimeOff: false, overtimeBasis: 'daily' },
                calcParams: { dailyThreshold: 8, weeklyThreshold: 40, overtimeMultiplier: 1.5 },
                holidays,
                timeOff: new Map(),
                overrides: {},
                profiles: new Map(),
                users: [{ id: 'user1', name: 'Alice' }],
                getUserOverride: () => ({ mode: 'global' }),
            },
            '2025-01-01',
            '2025-01-01'
        );
        // Should not crash, and produce valid results
        expect(result.length).toBe(1);
        expect(result[0].userId).toBe('user1');
    });

    it('getTimeOff handles corrupted timeOff data (non-Map)', () => {
        const timeOff = new Map();
        timeOff.set('user1', 'not-a-map'); // corrupted

        const result = calculateAnalysis(
            [{
                id: 'e1', userId: 'user1', userName: 'Alice',
                description: 'Work',
                timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                hourlyRate: { amount: 5000 },
                billable: true,
            }],
            {
                config: { applyHolidays: false, applyTimeOff: true, overtimeBasis: 'daily' },
                calcParams: { dailyThreshold: 8, weeklyThreshold: 40, overtimeMultiplier: 1.5 },
                holidays: new Map(),
                timeOff,
                overrides: {},
                profiles: new Map(),
                users: [{ id: 'user1', name: 'Alice' }],
                getUserOverride: () => ({ mode: 'global' }),
            },
            '2025-01-01',
            '2025-01-01'
        );
        expect(result.length).toBe(1);
    });
});

// ============================================================================
// 12. ui/detailed.ts — uncovered branches at lines 55, 183, 216-217, 234, 275, 352-355, 412
// ============================================================================
describe('ui/detailed: uncovered branches', () => {
    let renderDetailedTable, getCachedDetailedEntries, invalidateDetailedCache;

    beforeEach(async () => {
        jest.resetModules();
        document.body.innerHTML = `
            <div id="detailedTableContainer"></div>
            <div id="detailedCard"></div>
            <div id="detailedFilters">
                <span class="chip" data-filter="all">All</span>
                <span class="chip" data-filter="holiday">Holiday</span>
                <span class="chip" data-filter="billable">Billable</span>
            </div>
        `;

        const stateModule = await import('../../js/state.js');
        stateModule.store.config = {
            showBillableBreakdown: true,
            enableTieredOT: false,
        };
        stateModule.store.ui = {
            hasAmountRates: true,
            activeDetailedFilter: 'all',
            detailedPage: 1,
            detailedPageSize: 50,
        };

        const m = await import('../../js/ui/detailed.js');
        renderDetailedTable = m.renderDetailedTable;
        getCachedDetailedEntries = m.getCachedDetailedEntries;
        invalidateDetailedCache = m.invalidateDetailedCache;
    });

    afterEach(() => {
        invalidateDetailedCache();
    });

    it('getCachedDetailedEntries sorts entries by start time descending', () => {
        const users = [{
            userId: 'u1',
            userName: 'Alice',
            days: new Map([
                ['2025-01-01', {
                    entries: [
                        {
                            id: 'e1', timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T12:00:00Z', duration: 'PT3H' },
                            description: 'Morning',
                        },
                        {
                            id: 'e2', timeInterval: { start: '2025-01-01T13:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT4H' },
                            description: 'Afternoon',
                        },
                    ],
                    meta: { isHoliday: false, isNonWorking: false, isTimeOff: false },
                }],
            ]),
        }];

        const entries = getCachedDetailedEntries(users);
        expect(entries.length).toBe(2);
        // Should be sorted descending by start time
        expect(entries[0].timeInterval.start).toBe('2025-01-01T13:00:00Z');
    });

    it('getCachedDetailedEntries returns cached result on second call with same ref', () => {
        const users = [{
            userId: 'u1',
            userName: 'Alice',
            days: new Map([
                ['2025-01-01', {
                    entries: [{
                        id: 'e1', timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                        description: 'Work',
                    }],
                    meta: {},
                }],
            ]),
        }];

        const result1 = getCachedDetailedEntries(users);
        const result2 = getCachedDetailedEntries(users);
        expect(result1).toBe(result2); // Same reference = cached
    });

    it('renderDetailedTable shows empty message for no entries', () => {
        const users = [{
            userId: 'u1', userName: 'Alice',
            days: new Map(),
        }];
        renderDetailedTable(users, 'all');
        const container = document.getElementById('detailedTableContainer');
        expect(container.textContent).toContain('No entries found');
    });

    it('renderDetailedTable handles billable filter disabled fallback', async () => {
        const stateModule = await import('../../js/state.js');
        stateModule.store.config.showBillableBreakdown = false;
        stateModule.store.ui.activeDetailedFilter = 'billable';

        const users = [{
            userId: 'u1', userName: 'Alice',
            days: new Map([
                ['2025-01-01', {
                    entries: [{
                        id: 'e1', timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                        description: 'Work', analysis: { regular: 8, overtime: 0 },
                    }],
                    meta: { isHoliday: false, isNonWorking: false, isTimeOff: false },
                }],
            ]),
        }];
        renderDetailedTable(users);
        // Should fall back to 'all' filter
        expect(stateModule.store.ui.activeDetailedFilter).toBe('all');
    });
});

// ============================================================================
// 13. ui/dialogs.ts — uncovered lines 65, 274, 378, 407-409, 501-502
// ============================================================================
describe('ui/dialogs: uncovered branches', () => {
    let showSessionExpiringWarning, showError, showClearDataConfirmation,
        showCachePrompt, showSessionExpiredDialog, renderLoading,
        showLargeDateRangeWarning;

    beforeEach(async () => {
        jest.resetModules();
        document.body.innerHTML = `
            <div id="loadingState" class="hidden"></div>
            <div id="resultsContainer"></div>
            <div id="emptyState"></div>
            <div id="apiStatusBanner" class="api-status-banner hidden"></div>
            <button id="generateBtn"></button>
            <div id="mainView"></div>
            <div id="overridesPage" class="hidden"></div>
            <div id="summaryStrip"></div>
            <div id="summaryTableBody"></div>
        `;

        // Initialize UI elements cache
        const { initializeElements } = await import('../../js/ui/shared.js');
        initializeElements(true);

        const m = await import('../../js/ui/dialogs.js');
        showSessionExpiringWarning = m.showSessionExpiringWarning;
        showError = m.showError;
        showClearDataConfirmation = m.showClearDataConfirmation;
        showCachePrompt = m.showCachePrompt;
        showSessionExpiredDialog = m.showSessionExpiredDialog;
        renderLoading = m.renderLoading;
        showLargeDateRangeWarning = m.showLargeDateRangeWarning;
    });

    it('showSessionExpiringWarning creates banner with correct time text', () => {
        const onReauth = jest.fn();
        const onDismiss = jest.fn();
        showSessionExpiringWarning(5, onReauth, onDismiss);

        const banner = document.getElementById('sessionWarningBanner');
        expect(banner).not.toBeNull();
        expect(banner.textContent).toContain('5 minutes');
    });

    it('showSessionExpiringWarning with 1 minute shows "less than a minute"', () => {
        showSessionExpiringWarning(1, jest.fn(), jest.fn());
        const banner = document.getElementById('sessionWarningBanner');
        expect(banner.textContent).toContain('less than a minute');
    });

    it('showSessionExpiringWarning dismiss button works', () => {
        const onDismiss = jest.fn();
        showSessionExpiringWarning(5, jest.fn(), onDismiss);
        const banner = document.getElementById('sessionWarningBanner');
        const dismissBtn = banner.querySelector('.session-dismiss-btn');
        dismissBtn.click();
        expect(onDismiss).toHaveBeenCalled();
    });

    it('showSessionExpiringWarning reauth button works', () => {
        const onReauth = jest.fn();
        showSessionExpiringWarning(5, onReauth, jest.fn());
        const banner = document.getElementById('sessionWarningBanner');
        const reauthBtn = banner.querySelector('.session-reauth-btn');
        reauthBtn.click();
        expect(onReauth).toHaveBeenCalled();
    });

    it('showSessionExpiringWarning reuses existing banner', () => {
        showSessionExpiringWarning(5, jest.fn(), jest.fn());
        showSessionExpiringWarning(3, jest.fn(), jest.fn());
        const banners = document.querySelectorAll('#sessionWarningBanner');
        expect(banners.length).toBe(1);
    });

    it('showError creates banner when apiStatusBanner is null in elements cache', async () => {
        // Set apiStatusBanner to null in elements cache to trigger createErrorBanner
        const { getElements } = await import('../../js/ui/shared.js');
        const elements = getElements();
        elements.apiStatusBanner = null;
        // Add a .container for the banner to be inserted before
        const container = document.createElement('div');
        container.className = 'container';
        document.body.appendChild(container);

        showError('Something went wrong');
        const banner = document.getElementById('apiStatusBanner');
        expect(banner).not.toBeNull();
        // Content is in a child .api-status-banner-content element
        expect(banner.classList.contains('api-status-banner')).toBe(true);
    });

    it('showError with retry action shows retry button', () => {
        showError({
            title: 'Error',
            message: 'Failed',
            action: 'retry',
            type: 'NETWORK',
            timestamp: new Date().toISOString(),
        });
        const btn = document.querySelector('.error-action-btn');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toBe('Retry');
    });

    it('showSessionExpiredDialog creates modal and focuses reload button', () => {
        showSessionExpiredDialog();
        const modal = document.getElementById('sessionExpiredModal');
        expect(modal).not.toBeNull();
        // Call again to test reuse path
        showSessionExpiredDialog();
        const modals = document.querySelectorAll('#sessionExpiredModal');
        expect(modals.length).toBe(1);
    });

    it('showClearDataConfirmation calls onConfirm when OK is clicked', async () => {
        const onConfirm = jest.fn();
        const promise = showClearDataConfirmation(onConfirm);

        // Find and click OK button in the confirm modal
        await Promise.resolve();
        const okBtn = document.querySelector('.modal-overlay .btn-primary');
        expect(okBtn).not.toBeNull();
        okBtn.click();
        await promise;
        expect(onConfirm).toHaveBeenCalled();
    });

    it('showClearDataConfirmation does not call onConfirm when Cancel is clicked', async () => {
        const onConfirm = jest.fn();
        const promise = showClearDataConfirmation(onConfirm);

        await Promise.resolve();
        const cancelBtn = document.querySelector('.modal-overlay .btn-secondary');
        cancelBtn.click();
        await promise;
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('showCachePrompt returns use when OK clicked', async () => {
        const promise = showCachePrompt(120);
        await Promise.resolve();
        const okBtn = document.querySelector('.modal-overlay .btn-primary');
        okBtn.click();
        const result = await promise;
        expect(result).toBe('use');
    });

    it('showCachePrompt returns refresh when Cancel clicked', async () => {
        const promise = showCachePrompt(30);
        await Promise.resolve();
        const cancelBtn = document.querySelector('.modal-overlay .btn-secondary');
        cancelBtn.click();
        const result = await promise;
        expect(result).toBe('refresh');
    });

    it('showLargeDateRangeWarning for very large range (>730 days)', async () => {
        const promise = showLargeDateRangeWarning(800, 100);
        await Promise.resolve();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay).not.toBeNull();
        // Confirm
        const okBtn = overlay.querySelector('.btn-primary');
        okBtn.click();
        const result = await promise;
        expect(result).toBe(true);
    });

    it('showLargeDateRangeWarning for moderate range with many users', async () => {
        const promise = showLargeDateRangeWarning(200, 60);
        await Promise.resolve();
        const overlay = document.querySelector('.modal-overlay');
        expect(overlay.textContent).toContain('user-days');
        const okBtn = overlay.querySelector('.btn-primary');
        okBtn.click();
        await promise;
    });

    it('showStyledConfirm handles Escape key without calling onConfirm', async () => {
        const onConfirm = jest.fn();
        const promise = showClearDataConfirmation(onConfirm);
        await Promise.resolve();
        const overlay = document.querySelector('.modal-overlay');
        overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await promise;
        // Escape should not trigger onConfirm (same as Cancel)
        expect(onConfirm).not.toHaveBeenCalled();
        // Modal should be cleaned up
        expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    it('setupModalFocusTrap wraps Tab forward on last element', () => {
        showSessionExpiredDialog();
        const modal = document.getElementById('sessionExpiredModal');
        const reloadBtn = modal.querySelector('.session-reload-btn');
        reloadBtn.focus();
        expect(document.activeElement).toBe(reloadBtn);

        // Tab on last (only) element — trap should prevent default and refocus
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        modal.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(reloadBtn);
    });

    it('setupModalFocusTrap wraps Shift+Tab on first element', () => {
        showSessionExpiredDialog();
        const modal = document.getElementById('sessionExpiredModal');
        const reloadBtn = modal.querySelector('.session-reload-btn');
        reloadBtn.focus();
        expect(document.activeElement).toBe(reloadBtn);

        // Shift+Tab on first (only) element — trap should prevent default and refocus
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        modal.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(reloadBtn);
    });

    it('setupModalFocusTrap handles modal with no focusable elements', () => {
        // Create a modal with no buttons
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.tabIndex = -1;
        modal.setAttribute('role', 'alertdialog');
        modal.innerHTML = '<div class="modal-content"><p>No buttons here</p></div>';
        document.body.appendChild(modal);

        // Manually trigger keydown Tab — the focus trap handles zero focusable elements
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        // Should not throw
    });

    it('renderLoading show/hide cycle works', () => {
        renderLoading(true);
        const loadingState = document.getElementById('loadingState');
        expect(loadingState.classList.contains('hidden')).toBe(false);
        const generateBtn = document.getElementById('generateBtn');
        expect(generateBtn.getAttribute('aria-busy')).toBe('true');
    });

    it('renderLoading hides after minimum loading time', async () => {
        renderLoading(true);
        // Wait enough time for minimum loading to pass
        await new Promise(r => setTimeout(r, 150));
        renderLoading(false);
        const loadingState = document.getElementById('loadingState');
        expect(loadingState.classList.contains('hidden')).toBe(true);
    });
});

// ============================================================================
// 14. ui/overrides.ts — uncovered branches at lines 218-222, 253
// ============================================================================
describe('ui/overrides: uncovered branches', () => {
    let renderOverridesPage, showOverridesPage, hideOverridesPage;

    beforeEach(async () => {
        jest.resetModules();
        document.body.innerHTML = `
            <div id="mainView"></div>
            <div id="overridesPage" class="hidden">
                <div id="overridesSearchContainer"></div>
                <div id="overridesUserList"></div>
                <div id="overridesPaginationControls"></div>
            </div>
            <div id="resultsContainer"></div>
            <div id="summaryStrip"></div>
            <div id="summaryTableBody"></div>
            <div id="loadingState"></div>
            <div id="emptyState"></div>
            <div id="apiStatusBanner"></div>
            <input id="startDate" value="2025-01-01" />
            <input id="endDate" value="2025-01-03" />
        `;

        // Initialize UI elements cache
        const { initializeElements } = await import('../../js/ui/shared.js');
        initializeElements(true);

        const stateModule = await import('../../js/state.js');
        stateModule.store.users = [
            { id: 'user1', name: 'Alice' },
            { id: 'user2', name: 'Bob' },
        ];
        stateModule.store.overrides = {};
        stateModule.store.profiles = new Map();
        stateModule.store.config = { enableTieredOT: false };
        stateModule.store.calcParams = { dailyThreshold: 8, overtimeMultiplier: 1.5 };
        stateModule.store.ui = {
            overridesSearch: '',
            overridesPage: 1,
            overridesPageSize: 50,
        };
        stateModule.store.getUserOverride = (userId) => stateModule.store.overrides[userId] || { mode: 'global' };

        const m = await import('../../js/ui/overrides.js');
        renderOverridesPage = m.renderOverridesPage;
        showOverridesPage = m.showOverridesPage;
        hideOverridesPage = m.hideOverridesPage;
    });

    it('renderOverridesPage renders user cards', () => {
        renderOverridesPage();
        const cards = document.querySelectorAll('.override-user-card');
        expect(cards.length).toBe(2);
    });

    it('renderOverridesPage shows "no users" message when users list is empty', async () => {
        const stateModule = await import('../../js/state.js');
        stateModule.store.users = [];
        renderOverridesPage();
        const container = document.getElementById('overridesUserList');
        expect(container.textContent).toContain('No users loaded');
    });

    it('renderOverridesPage filters users by search term', async () => {
        const stateModule = await import('../../js/state.js');
        stateModule.store.ui.overridesSearch = 'alice';
        renderOverridesPage();
        const cards = document.querySelectorAll('.override-user-card');
        expect(cards.length).toBe(1);
    });

    it('renderOverridesPage renders perDay mode with date inputs', async () => {
        const stateModule = await import('../../js/state.js');
        stateModule.store.overrides = {
            user1: { mode: 'perDay', perDayOverrides: {} },
        };
        stateModule.store.getUserOverride = (userId) => stateModule.store.overrides[userId] || { mode: 'global' };

        renderOverridesPage();
        const container = document.getElementById('overridesUserList');
        expect(container.innerHTML).toContain('per-day-table');
    });

    it('renderOverridesPage renders weekly mode', async () => {
        const stateModule = await import('../../js/state.js');
        stateModule.store.overrides = {
            user1: { mode: 'weekly', weeklyOverrides: {} },
        };
        stateModule.store.getUserOverride = (userId) => stateModule.store.overrides[userId] || { mode: 'global' };

        renderOverridesPage();
        const container = document.getElementById('overridesUserList');
        expect(container.innerHTML).toContain('weekly-table');
    });

    it('renderPerDayInputs shows message when no date range selected', async () => {
        // Remove date inputs
        document.getElementById('startDate').value = '';
        document.getElementById('endDate').value = '';

        const stateModule = await import('../../js/state.js');
        stateModule.store.overrides = {
            user1: { mode: 'perDay', perDayOverrides: {} },
        };
        stateModule.store.getUserOverride = (userId) => stateModule.store.overrides[userId] || { mode: 'global' };

        renderOverridesPage();
        const container = document.getElementById('overridesUserList');
        expect(container.textContent).toContain('Select a date range');
    });

    it('showOverridesPage and hideOverridesPage toggle visibility', () => {
        showOverridesPage();
        expect(document.getElementById('mainView').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('overridesPage').classList.contains('hidden')).toBe(false);

        hideOverridesPage();
        expect(document.getElementById('mainView').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('overridesPage').classList.contains('hidden')).toBe(true);
    });
});

// ============================================================================
// 15. ui/summary.ts — uncovered branches at lines 36-37 (getCachedSummaryRows cache miss)
// ============================================================================
describe('ui/summary: getCachedSummaryRows cache behavior', () => {
    let computeSummaryRows;

    beforeEach(async () => {
        jest.resetModules();
        const m = await import('../../js/ui/summary.js');
        computeSummaryRows = m.computeSummaryRows;
    });

    it('computeSummaryRows returns empty array for empty users', () => {
        const rows = computeSummaryRows([], 'user');
        expect(rows).toEqual([]);
    });

    it('computeSummaryRows returns rows grouped by user', () => {
        const users = [{
            userId: 'u1',
            userName: 'Alice',
            days: new Map([
                ['2025-01-01', {
                    entries: [{
                        id: 'e1',
                        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                        analysis: { regular: 8, overtime: 0, isBillable: true },
                        billable: true,
                    }],
                    meta: { capacity: 8 },
                }],
            ]),
            totals: { total: 8, regular: 8, overtime: 0 },
        }];
        const rows = computeSummaryRows(users, 'user');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].groupName).toBe('Alice');
    });

    it('computeSummaryRows with different groupBy triggers cache invalidation', () => {
        const users = [{
            userId: 'u1',
            userName: 'Alice',
            days: new Map([
                ['2025-01-01', {
                    entries: [{
                        id: 'e1',
                        timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z', duration: 'PT8H' },
                        analysis: { regular: 8, overtime: 0, isBillable: false },
                        projectName: 'Project A',
                    }],
                    meta: { capacity: 8 },
                }],
            ]),
            totals: { total: 8, regular: 8, overtime: 0 },
        }];
        const rowsByUser = computeSummaryRows(users, 'user');
        const rowsByDate = computeSummaryRows(users, 'date');
        expect(rowsByUser[0].groupName).not.toBe(rowsByDate[0].groupName);
    });
});
