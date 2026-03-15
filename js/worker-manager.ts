/**
 * @fileoverview Worker Pool Management & Calculation Orchestration
 *
 * Manages the Web Worker pool for offloading heavy calculations and provides
 * runCalculation() which bridges data fetching and UI rendering.
 * Extracted from main.ts to reduce module size (CQ-1).
 */

import { store } from './state.js';
import { calculateAnalysis } from './calc.js';
import * as UI from './ui/index.js';
import { createWorkerPool, WorkerPool } from './worker-pool.js';
import { startTimer, incrementCounter, MetricNames } from './metrics.js';
import type {
    CalculationParams,
    DateRange,
    OvertimeConfig,
    TimeEntry,
    User,
    UserAnalysis,
    UserOverride,
} from './types.js';

// ============================================================================
// WORKER POOL FOR LARGE CALCULATIONS
// ============================================================================

/** Threshold for using worker-based calculation. */
export const WORKER_THRESHOLD = 500;

type WorkerPayload = {
    entries: TimeEntry[];
    dateRange: DateRange;
    store: {
        users: typeof store.users;
        profiles: [string, unknown][];
        holidays: [string, [string, unknown][]][];
        timeOff: [string, [string, unknown][]][];
        overrides: typeof store.overrides;
        config: typeof store.config;
        calcParams: typeof store.calcParams;
    };
};
type WorkerResult = unknown[];
let calculationWorkerPool: WorkerPool<WorkerPayload, WorkerResult> | null = null;

/** Checks if Web Workers are supported in the current environment. */
export function isWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
}

/** Initializes the worker pool for background calculations. */
async function initCalculationWorker(): Promise<boolean> {
    if (calculationWorkerPool) return true;
    if (!isWorkerSupported()) return false;

    try {
        calculationWorkerPool = await createWorkerPool<WorkerPayload, WorkerResult>(
            'js/calc.worker.js',
            { poolSize: 1, maxQueueSize: 10, taskTimeout: 120000, autoRestart: true }
        );
        store.diagnostics = {
            ...store.diagnostics,
            workerPoolInitFailed: false,
            workerPoolTerminated: false,
        };
        return true;
    } catch (error) {
        store.diagnostics = {
            ...store.diagnostics,
            workerPoolInitFailed: true,
        };
        console.warn('Failed to initialize calculation worker', error);
        return false;
    }
}

// PERF-2: Cache serialized store for worker — only re-serialize if data changed
interface WorkerStoreSnapshot {
    users: User[];
    profiles: [string, unknown][];
    holidays: [string, [string, unknown][]][];
    timeOff: [string, [string, unknown][]][];
    overrides: Record<string, UserOverride>;
    config: OvertimeConfig;
    calcParams: CalculationParams;
}
let _workerStoreCache: WorkerStoreSnapshot | null = null;
let _workerStoreCacheKeys: {
    users: unknown;
    dataVersion: number;
    overridesVersion: number;
    configVersion: number;
} | null = null;

/** @internal Exported for testing only. */
export function serializeStoreForWorker() {
    // Use version counters for overrides/config/calcParams instead of reference
    // equality, because these objects are mutated in place by store methods.
    if (
        _workerStoreCache &&
        _workerStoreCacheKeys &&
        _workerStoreCacheKeys.users === store.users &&
        _workerStoreCacheKeys.dataVersion === store.dataVersion &&
        _workerStoreCacheKeys.overridesVersion === store.overridesVersion &&
        _workerStoreCacheKeys.configVersion === store.configVersion
    ) {
        return _workerStoreCache;
    }

    _workerStoreCache = {
        users: store.users,
        profiles: Array.from(store.profiles.entries()),
        holidays: Array.from(store.holidays.entries()).map(
            ([userId, map]) => [userId, Array.from(map.entries())] as [string, [string, unknown][]]
        ),
        timeOff: Array.from(store.timeOff.entries()).map(
            ([userId, map]) => [userId, Array.from(map.entries())] as [string, [string, unknown][]]
        ),
        overrides: store.overrides,
        config: store.config,
        calcParams: store.calcParams,
    };
    _workerStoreCacheKeys = {
        users: store.users,
        dataVersion: store.dataVersion,
        overridesVersion: store.overridesVersion,
        configVersion: store.configVersion,
    };
    return _workerStoreCache;
}

/** Deserializes worker results back into UserAnalysis format. */
function deserializeWorkerResults(results: unknown[]): UserAnalysis[] {
    return (results as Array<{ days: [string, unknown][] }>).map((user) => ({
        ...user,
        days: new Map(user.days),
    })) as UserAnalysis[];
}

/** Runs calculation in a background worker. */
async function runCalculationInWorker(
    entries: TimeEntry[],
    dateRange: DateRange
): Promise<UserAnalysis[]> {
    if (!calculationWorkerPool) {
        throw new Error('Worker pool not initialized');
    }

    const result = await calculationWorkerPool.execute({
        payload: {
            entries,
            dateRange,
            store: serializeStoreForWorker(),
        },
    });

    return deserializeWorkerResults(result);
}

// ============================================================================
// CALCULATION ORCHESTRATION
// ============================================================================

/** Monotonic calculation run counter for stale-result detection. */
let currentCalculationId = 0;

/** Returns the current calculation ID (for stale-result checks in report orchestrator). */
export function getCurrentCalculationId(): number {
    return currentCalculationId;
}

function storeAndRender(analysis: UserAnalysis[]): void {
    store.analysisResults = analysis;
    UI.renderSummaryStrip(analysis);
    UI.renderSummaryTable(analysis);
    UI.renderDetailedTable(analysis);
}

/**
 * Triggers the calculation engine and updates all UI views with analysis results.
 * @param dateRange - Optional date range; uses stored range if omitted.
 * @param syncAmountDisplay - Callback to sync amount display dropdown availability.
 */
export function runCalculation(
    dateRange?: DateRange,
    syncAmountDisplay?: (entries: TimeEntry[] | null) => void
): void {
    const thisCalculationId = ++currentCalculationId;

    const effectiveDateRange = dateRange || store.currentDateRange || { start: '', end: '' };
    if (dateRange) {
        store.currentDateRange = dateRange;
    }

    if (syncAmountDisplay) {
        syncAmountDisplay(store.rawEntries);
    }

    const entries = store.rawEntries ?? [];
    const isConfigOnlyChange = !dateRange;
    const shouldUseWorker =
        isWorkerSupported() && entries.length > WORKER_THRESHOLD && !isConfigOnlyChange;

    if (shouldUseWorker) {
        runCalculationAsync(entries, effectiveDateRange, thisCalculationId);
    } else {
        UI.updateLoadingProgress(0, 'Calculating', entries.length);
        const calcTimer = startTimer(MetricNames.CALC_DURATION);
        const analysis = calculateAnalysis(entries, store, effectiveDateRange);
        calcTimer.end();
        incrementCounter(MetricNames.CALC_ENTRY_COUNT, entries.length);
        incrementCounter(MetricNames.CALC_USER_COUNT, analysis.length);
        storeAndRender(analysis);
    }
}

/** Runs calculation asynchronously using a background worker. */
async function runCalculationAsync(
    entries: TimeEntry[],
    dateRange: DateRange,
    calculationId: number
): Promise<void> {
    const calcTimer = startTimer(MetricNames.CALC_DURATION);

    try {
        const workerReady = await initCalculationWorker();
        let analysis: UserAnalysis[];

        if (workerReady && calculationWorkerPool) {
            UI.updateLoadingProgress(0, 'Calculating (worker)', entries.length);
            analysis = await runCalculationInWorker(entries, dateRange);
        } else {
            UI.updateLoadingProgress(0, 'Calculating', entries.length);
            analysis = calculateAnalysis(entries, store, dateRange);
        }

        // COR-8: Check calculationId immediately after await
        if (calculationId !== currentCalculationId) {
            return;
        }
        calcTimer.end();
        incrementCounter(MetricNames.CALC_ENTRY_COUNT, entries.length);
        incrementCounter(MetricNames.CALC_USER_COUNT, analysis.length);
        storeAndRender(analysis);
    } catch (error) {
        console.error('Async calculation failed, falling back to sync', error);
        calcTimer.end();

        if (calculationId !== currentCalculationId) {
            return;
        }

        UI.updateLoadingProgress(0, 'Calculating (fallback)', entries.length);
        const analysis = calculateAnalysis(entries, store, dateRange);
        incrementCounter(MetricNames.CALC_ENTRY_COUNT, entries.length);
        incrementCounter(MetricNames.CALC_USER_COUNT, analysis.length);
        storeAndRender(analysis);
    }
}
