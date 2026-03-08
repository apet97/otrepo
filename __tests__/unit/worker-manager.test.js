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
            // No error thrown — syncAmountDisplay is optional
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
});
