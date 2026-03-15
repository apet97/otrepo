/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

// Mock dependencies before importing
const mockCalculateAnalysis = jest.fn();
const mockCreateWorkerPool = jest.fn();
const mockRenderSummaryStrip = jest.fn();
const mockRenderSummaryTable = jest.fn();
const mockRenderDetailedTable = jest.fn();
const mockUpdateLoadingProgress = jest.fn();
const mockStartTimer = jest.fn(() => ({ end: jest.fn() }));
const mockIncrementCounter = jest.fn();

jest.unstable_mockModule('../../js/calc.js', () => ({
    calculateAnalysis: mockCalculateAnalysis,
}));

jest.unstable_mockModule('../../js/worker-pool.js', () => ({
    createWorkerPool: mockCreateWorkerPool,
}));

jest.unstable_mockModule('../../js/ui/index.js', () => ({
    renderSummaryStrip: mockRenderSummaryStrip,
    renderSummaryTable: mockRenderSummaryTable,
    renderDetailedTable: mockRenderDetailedTable,
    updateLoadingProgress: mockUpdateLoadingProgress,
}));

jest.unstable_mockModule('../../js/metrics.js', () => ({
    startTimer: mockStartTimer,
    incrementCounter: mockIncrementCounter,
    MetricNames: {
        CALC_DURATION: 'calc_duration',
        CALC_ENTRY_COUNT: 'calc_entry_count',
        CALC_USER_COUNT: 'calc_user_count',
    },
}));

// Mock state module
const mockStore = {
    rawEntries: [],
    currentDateRange: null,
    analysisResults: null,
    users: [],
    profiles: new Map(),
    holidays: new Map(),
    timeOff: new Map(),
    overrides: {},
    config: {},
    calcParams: { dailyThreshold: 8 },
    diagnostics: {},
    overridesVersion: 0,
    configVersion: 0,
};

jest.unstable_mockModule('../../js/state.js', () => ({
    store: mockStore,
}));

describe('Worker Manager Module', () => {
    let runCalculation;
    let isWorkerSupported;
    let WORKER_THRESHOLD;
    let getCurrentCalculationId;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Reset store state
        mockStore.rawEntries = [];
        mockStore.currentDateRange = null;
        mockStore.analysisResults = null;

        // Default: calculateAnalysis returns empty array
        mockCalculateAnalysis.mockReturnValue([]);

        const module = await import('../../js/worker-manager.js');
        runCalculation = module.runCalculation;
        isWorkerSupported = module.isWorkerSupported;
        WORKER_THRESHOLD = module.WORKER_THRESHOLD;
        getCurrentCalculationId = module.getCurrentCalculationId;
    });

    describe('isWorkerSupported', () => {
        it('returns true when Worker is defined', () => {
            global.Worker = class {};
            expect(isWorkerSupported()).toBe(true);
        });

        it('returns false when Worker is undefined', () => {
            delete global.Worker;
            expect(isWorkerSupported()).toBe(false);
        });
    });

    describe('WORKER_THRESHOLD', () => {
        it('exports a numeric threshold', () => {
            expect(typeof WORKER_THRESHOLD).toBe('number');
            expect(WORKER_THRESHOLD).toBe(500);
        });
    });

    describe('getCurrentCalculationId', () => {
        it('returns the current calculation counter', () => {
            const id = getCurrentCalculationId();
            expect(typeof id).toBe('number');
        });
    });

    describe('runCalculation', () => {
        beforeEach(() => {
            // Ensure Workers are not available (force sync path)
            delete global.Worker;
            mockStore.rawEntries = [{ id: '1' }];
        });

        it('calls calculateAnalysis with store data', () => {
            mockCalculateAnalysis.mockReturnValue([{ userId: 'u1', days: new Map() }]);
            runCalculation({ start: '2024-01-01', end: '2024-01-31' });

            expect(mockCalculateAnalysis).toHaveBeenCalledTimes(1);
            expect(mockCalculateAnalysis).toHaveBeenCalledWith(
                mockStore.rawEntries,
                mockStore,
                { start: '2024-01-01', end: '2024-01-31' }
            );
        });

        it('stores analysisResults and renders UI', () => {
            const analysis = [{ userId: 'u1', days: new Map() }];
            mockCalculateAnalysis.mockReturnValue(analysis);
            runCalculation({ start: '2024-01-01', end: '2024-01-31' });

            expect(mockStore.analysisResults).toBe(analysis);
            expect(mockRenderSummaryStrip).toHaveBeenCalledWith(analysis);
            expect(mockRenderSummaryTable).toHaveBeenCalledWith(analysis);
            expect(mockRenderDetailedTable).toHaveBeenCalledWith(analysis);
        });

        it('persists date range when provided', () => {
            const range = { start: '2024-01-01', end: '2024-01-31' };
            runCalculation(range);
            expect(mockStore.currentDateRange).toBe(range);
        });

        it('uses stored date range when none provided', () => {
            mockStore.currentDateRange = { start: '2024-02-01', end: '2024-02-28' };
            runCalculation();

            expect(mockCalculateAnalysis).toHaveBeenCalledWith(
                mockStore.rawEntries,
                mockStore,
                { start: '2024-02-01', end: '2024-02-28' }
            );
        });

        it('falls back to empty date range when nothing stored', () => {
            mockStore.currentDateRange = null;
            runCalculation();

            expect(mockCalculateAnalysis).toHaveBeenCalledWith(
                mockStore.rawEntries,
                mockStore,
                { start: '', end: '' }
            );
        });

        it('calls syncAmountDisplay callback when provided', () => {
            const syncCallback = jest.fn();
            runCalculation({ start: '2024-01-01', end: '2024-01-31' }, syncCallback);
            expect(syncCallback).toHaveBeenCalledWith(mockStore.rawEntries);
        });

        it('does not call syncAmountDisplay when not provided', () => {
            runCalculation({ start: '2024-01-01', end: '2024-01-31' });
            // Calculation should still proceed without the optional callback
            expect(mockCalculateAnalysis).toHaveBeenCalled();
            expect(mockUpdateLoadingProgress).toHaveBeenCalled();
        });

        it('uses empty entries array when rawEntries is null', () => {
            mockStore.rawEntries = null;
            runCalculation({ start: '2024-01-01', end: '2024-01-31' });

            expect(mockCalculateAnalysis).toHaveBeenCalledWith(
                [],
                mockStore,
                { start: '2024-01-01', end: '2024-01-31' }
            );
        });

        it('increments calculation ID on each call', () => {
            const id1 = getCurrentCalculationId();
            runCalculation();
            const id2 = getCurrentCalculationId();
            runCalculation();
            const id3 = getCurrentCalculationId();

            expect(id2).toBe(id1 + 1);
            expect(id3).toBe(id2 + 1);
        });

        it('updates loading progress for sync calculations', () => {
            runCalculation({ start: '2024-01-01', end: '2024-01-31' });

            expect(mockUpdateLoadingProgress).toHaveBeenCalledWith(
                0, 'Calculating', expect.any(Number)
            );
        });

        it('tracks metrics for sync calculations', () => {
            mockCalculateAnalysis.mockReturnValue([{ userId: 'u1' }]);
            runCalculation({ start: '2024-01-01', end: '2024-01-31' });

            expect(mockStartTimer).toHaveBeenCalled();
            expect(mockIncrementCounter).toHaveBeenCalledTimes(2);
        });
    });

    describe('serializeStoreForWorker — cache invalidation', () => {
        let serializeStoreForWorker;

        beforeEach(async () => {
            const module = await import('../../js/worker-manager.js');
            serializeStoreForWorker = module.serializeStoreForWorker;
            mockStore.overridesVersion = 0;
            mockStore.configVersion = 0;
        });

        it('returns a new snapshot when overridesVersion changes (in-place mutation)', () => {
            const snap1 = serializeStoreForWorker();
            // Simulate in-place override mutation (same object reference)
            mockStore.overrides['user1'] = { capacity: 6 };
            mockStore.overridesVersion++;
            const snap2 = serializeStoreForWorker();

            expect(snap2).not.toBe(snap1);
            expect(snap2.overrides['user1']).toEqual({ capacity: 6 });
        });

        it('returns cached snapshot when nothing changes', () => {
            const snap1 = serializeStoreForWorker();
            const snap2 = serializeStoreForWorker();
            expect(snap2).toBe(snap1);
        });

        it('returns a new snapshot when configVersion changes (in-place mutation)', () => {
            const snap1 = serializeStoreForWorker();
            // Simulate in-place config mutation (same object reference)
            mockStore.config.overtimeBasis = 'weekly';
            mockStore.configVersion++;
            const snap2 = serializeStoreForWorker();

            expect(snap2).not.toBe(snap1);
        });

        it('returns a new snapshot when calcParams mutate via configVersion', () => {
            const snap1 = serializeStoreForWorker();
            mockStore.calcParams.dailyThreshold = 10;
            mockStore.configVersion++;
            const snap2 = serializeStoreForWorker();

            expect(snap2).not.toBe(snap1);
            expect(snap2.calcParams.dailyThreshold).toBe(10);
        });

        it('detects staleness even when overrides object reference is unchanged', () => {
            serializeStoreForWorker(); // prime the cache
            // Mutate the same overrides object in place (the original bug)
            mockStore.overrides['u2'] = { multiplier: 2.0 };
            // Without bumping version, cache would be stale — but we bump it
            mockStore.overridesVersion++;
            const snap = serializeStoreForWorker();

            expect(snap.overrides['u2']).toEqual({ multiplier: 2.0 });
        });

    });
});

// ============================================================================
// ASYNC WORKER PATH TESTS
// ============================================================================
// These tests use jest.resetModules() to get fresh module state so
// the module-level `calculationWorkerPool` starts as null each time.

describe('Worker Manager — async worker path', () => {
    // Re-declare mocks at this scope so they persist across resetModules
    const mockCalculateAnalysis2 = jest.fn();
    const mockCreateWorkerPool2 = jest.fn();
    const mockRenderSummaryStrip2 = jest.fn();
    const mockRenderSummaryTable2 = jest.fn();
    const mockRenderDetailedTable2 = jest.fn();
    const mockUpdateLoadingProgress2 = jest.fn();
    const mockEndTimer2 = jest.fn();
    const mockStartTimer2 = jest.fn(() => ({ end: mockEndTimer2 }));
    const mockIncrementCounter2 = jest.fn();

    const mockStore2 = {
        rawEntries: [],
        currentDateRange: null,
        analysisResults: null,
        users: [{ id: 'u1', name: 'Alice' }],
        profiles: new Map(),
        holidays: new Map(),
        timeOff: new Map(),
        overrides: {},
        config: {},
        calcParams: { dailyThreshold: 8 },
        diagnostics: {},
        overridesVersion: 0,
        configVersion: 0,
    };

    const mockWorkerPool = {
        execute: jest.fn(),
        terminate: jest.fn(),
    };

    /** Generate entries exceeding WORKER_THRESHOLD (500) */
    function makeEntries(count) {
        return Array.from({ length: count }, (_, i) => ({ id: `e${i}` }));
    }

    async function flushCalculation(turns = 2) {
        for (let i = 0; i < turns; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // Provide Worker global so isWorkerSupported() returns true
        global.Worker = class {};

        // Reset store state
        mockStore2.rawEntries = makeEntries(600);
        mockStore2.currentDateRange = null;
        mockStore2.analysisResults = null;
        mockStore2.diagnostics = {};
        mockStore2.users = [{ id: 'u1', name: 'Alice' }];
        mockStore2.profiles = new Map();
        mockStore2.holidays = new Map();
        mockStore2.timeOff = new Map();
        mockStore2.overrides = {};
        mockStore2.config = {};
        mockStore2.calcParams = { dailyThreshold: 8 };
        mockStore2.overridesVersion = 0;
        mockStore2.configVersion = 0;

        // Default: worker pool creation succeeds
        mockCreateWorkerPool2.mockResolvedValue(mockWorkerPool);

        // Default: worker execute returns valid results
        mockWorkerPool.execute.mockResolvedValue([
            { userId: 'u1', totalOvertime: 3600, days: [['2024-01-01', { overtime: 3600 }]] },
        ]);

        // Default: calculateAnalysis returns analysis
        mockCalculateAnalysis2.mockReturnValue([
            { userId: 'u1', totalOvertime: 3600, days: new Map() },
        ]);

        // Register mocks for fresh module import
        jest.unstable_mockModule('../../js/calc.js', () => ({
            calculateAnalysis: mockCalculateAnalysis2,
        }));
        jest.unstable_mockModule('../../js/worker-pool.js', () => ({
            createWorkerPool: mockCreateWorkerPool2,
        }));
        jest.unstable_mockModule('../../js/ui/index.js', () => ({
            renderSummaryStrip: mockRenderSummaryStrip2,
            renderSummaryTable: mockRenderSummaryTable2,
            renderDetailedTable: mockRenderDetailedTable2,
            updateLoadingProgress: mockUpdateLoadingProgress2,
        }));
        jest.unstable_mockModule('../../js/metrics.js', () => ({
            startTimer: mockStartTimer2,
            incrementCounter: mockIncrementCounter2,
            MetricNames: {
                CALC_DURATION: 'calc_duration',
                CALC_ENTRY_COUNT: 'calc_entry_count',
                CALC_USER_COUNT: 'calc_user_count',
            },
        }));
        jest.unstable_mockModule('../../js/state.js', () => ({
            store: mockStore2,
        }));
    });

    afterEach(() => {
        delete global.Worker;
    });

    it('uses the worker path for large reports and stores deserialized results', async () => {
        mockStore2.holidays = new Map([['u1', new Map([['2024-01-01', { name: 'New Year' }]])]]);
        mockStore2.timeOff = new Map([
            ['u1', new Map([['2024-01-15', { type: 'vacation', hours: 8 }]])],
        ]);
        mockStore2.configVersion++;

        const mod = await import('../../js/worker-manager.js');

        mod.runCalculation({ start: '2024-01-01', end: '2024-01-31' });

        await flushCalculation();

        expect(mockCreateWorkerPool2).toHaveBeenCalledTimes(1);
        expect(mockWorkerPool.execute).toHaveBeenCalledTimes(1);
        const executeArg = mockWorkerPool.execute.mock.calls[0][0];
        expect(executeArg.payload.entries).toHaveLength(600);
        expect(executeArg.payload.dateRange).toEqual({ start: '2024-01-01', end: '2024-01-31' });
        expect(executeArg.payload.store.holidays).toEqual([
            ['u1', [['2024-01-01', { name: 'New Year' }]]],
        ]);
        expect(executeArg.payload.store.timeOff).toEqual([
            ['u1', [['2024-01-15', { type: 'vacation', hours: 8 }]]],
        ]);
        expect(mockUpdateLoadingProgress2).toHaveBeenCalledWith(0, 'Calculating (worker)', 600);
        expect(mockStore2.analysisResults).toHaveLength(1);
        expect(mockStore2.analysisResults[0].days).toBeInstanceOf(Map);
        expect(mockStore2.diagnostics.workerPoolInitFailed).toBe(false);
        expect(mockStore2.diagnostics.workerPoolTerminated).toBe(false);
        expect(mockStartTimer2).toHaveBeenCalled();
        expect(mockEndTimer2).toHaveBeenCalled();
        expect(mockIncrementCounter2).toHaveBeenCalledWith('calc_entry_count', 600);
        expect(mockIncrementCounter2).toHaveBeenCalledWith('calc_user_count', 1);
        expect(mockRenderSummaryStrip2).toHaveBeenCalledTimes(1);
        expect(mockRenderSummaryTable2).toHaveBeenCalledTimes(1);
        expect(mockRenderDetailedTable2).toHaveBeenCalledTimes(1);
    });

    it('falls back to synchronous calculation when worker pool initialization fails', async () => {
        mockCreateWorkerPool2.mockRejectedValue(new Error('Worker script 404'));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const mod = await import('../../js/worker-manager.js');

        mod.runCalculation({ start: '2024-01-01', end: '2024-01-31' });

        await flushCalculation();

        expect(mockStore2.diagnostics.workerPoolInitFailed).toBe(true);
        expect(mockCalculateAnalysis2).toHaveBeenCalledTimes(1);
        expect(mockUpdateLoadingProgress2).toHaveBeenCalledWith(0, 'Calculating', 600);
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to initialize calculation worker',
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });

    it('falls back to synchronous calculation when worker execution fails', async () => {
        mockWorkerPool.execute.mockRejectedValue(new Error('Worker crashed'));
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const mod = await import('../../js/worker-manager.js');

        mod.runCalculation({ start: '2024-01-01', end: '2024-01-31' });

        await flushCalculation(3);

        expect(errorSpy).toHaveBeenCalledWith(
            'Async calculation failed, falling back to sync',
            expect.any(Error)
        );
        expect(mockCalculateAnalysis2).toHaveBeenCalledTimes(1);
        expect(mockUpdateLoadingProgress2).toHaveBeenCalledWith(0, 'Calculating (fallback)', 600);
        expect(mockIncrementCounter2).toHaveBeenCalledWith('calc_entry_count', 600);
        expect(mockIncrementCounter2).toHaveBeenCalledWith('calc_user_count', 1);
        expect(mockRenderSummaryStrip2).toHaveBeenCalledTimes(1);
        expect(mockRenderSummaryTable2).toHaveBeenCalledTimes(1);
        expect(mockRenderDetailedTable2).toHaveBeenCalledTimes(1);

        errorSpy.mockRestore();
    });

    it('ignores stale worker results when a newer calculation starts before completion', async () => {
        let resolveWorkerExecute;
        mockWorkerPool.execute.mockReturnValue(
            new Promise((resolve) => { resolveWorkerExecute = resolve; })
        );

        const mod = await import('../../js/worker-manager.js');

        mod.runCalculation({ start: '2024-01-01', end: '2024-01-31' });
        await flushCalculation(1);
        delete global.Worker;
        mod.runCalculation();
        resolveWorkerExecute([
            { userId: 'u1', totalOvertime: 9999, days: [['2024-01-01', { overtime: 9999 }]] },
        ]);
        await flushCalculation();

        const lastAnalysis = mockStore2.analysisResults;
        expect(lastAnalysis).toEqual(mockCalculateAnalysis2.mock.results[0].value);
    });

    it('ignores stale worker failures once a newer calculation has already completed', async () => {
        let rejectWorkerExecute;
        mockWorkerPool.execute.mockReturnValue(
            new Promise((_, reject) => { rejectWorkerExecute = reject; })
        );
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const mod = await import('../../js/worker-manager.js');

        mod.runCalculation({ start: '2024-01-01', end: '2024-01-31' });
        await flushCalculation(1);
        delete global.Worker;
        const syncAnalysis = [{ userId: 'u1', totalOvertime: 100, days: new Map() }];
        mockCalculateAnalysis2.mockReturnValue(syncAnalysis);
        mod.runCalculation();
        rejectWorkerExecute(new Error('Worker crashed'));
        await flushCalculation();

        expect(mockCalculateAnalysis2).toHaveBeenCalledTimes(1);
        expect(mockStore2.analysisResults).toBe(syncAnalysis);

        errorSpy.mockRestore();
    });

    it('skips worker for config-only changes (no dateRange)', async () => {
        const mod = await import('../../js/worker-manager.js');

        // No dateRange → isConfigOnlyChange=true → shouldUseWorker=false
        mod.runCalculation();

        // Should go sync immediately, no worker init
        expect(mockCreateWorkerPool2).not.toHaveBeenCalled();
        expect(mockCalculateAnalysis2).toHaveBeenCalledTimes(1);
    });

    it('skips worker when entries are below threshold', async () => {
        mockStore2.rawEntries = [{ id: 'e1' }, { id: 'e2' }]; // well under 500

        const mod = await import('../../js/worker-manager.js');

        mod.runCalculation({ start: '2024-01-01', end: '2024-01-31' });

        // Should go sync immediately, no worker init
        expect(mockCreateWorkerPool2).not.toHaveBeenCalled();
        expect(mockCalculateAnalysis2).toHaveBeenCalledTimes(1);
    });

});
