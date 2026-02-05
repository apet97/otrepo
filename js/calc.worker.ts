/**
 * @fileoverview Calculation Web Worker
 * Offloads heavy calculation work to a separate thread to keep UI responsive.
 * Receives calculation inputs via postMessage and returns results.
 */

import { calculateAnalysis } from './calc.js';
import type { TimeEntry, DateRange, UserProfile, Holiday, TimeOffInfo, UserOverride, OvertimeConfig, CalculationParams, User } from './types.js';

/**
 * Worker input message structure
 */
interface WorkerInput {
    type: 'calculate';
    requestId: number;
    payload: {
        entries: TimeEntry[];
        dateRange: DateRange;
        store: {
            users: User[];
            profiles: [string, UserProfile][];
            holidays: [string, [string, Holiday][]][];
            timeOff: [string, [string, TimeOffInfo][]][];
            overrides: Record<string, UserOverride>;
            config: OvertimeConfig;
            calcParams: CalculationParams;
        };
    };
}

/**
 * Worker output message structure
 */
interface WorkerOutput {
    type: 'ready' | 'result' | 'error';
    requestId?: number;
    payload?: unknown;
    error?: string;
}

// Web Worker context
const ctx: Worker = self as unknown as Worker;

/**
 * Handle incoming messages from the main thread
 */
ctx.onmessage = (event: MessageEvent<WorkerInput>) => {
    const { type, payload, requestId } = event.data;

    if (type !== 'calculate') {
        ctx.postMessage({
            type: 'error',
            requestId,
            error: `Unknown message type: ${type}`,
        } as WorkerOutput);
        return;
    }

    try {
        const { entries, dateRange, store } = payload;

        // Reconstruct Maps from serialized arrays
        const profiles = new Map(store.profiles);
        const holidays = new Map(store.holidays.map(([userId, hols]) => [userId, new Map(hols)]));
        const timeOff = new Map(store.timeOff.map(([userId, tos]) => [userId, new Map(tos)]));

        // Create store-like object for calculation
        const calcStore = {
            users: store.users,
            profiles,
            holidays,
            timeOff,
            overrides: store.overrides,
            config: store.config,
            calcParams: store.calcParams,
        };

        // Run calculation
        const results = calculateAnalysis(entries, calcStore, dateRange);

        // Serialize results (Maps need to be converted to arrays for transfer)
        const serializedResults = results.map((user) => ({
            ...user,
            days: Array.from(user.days.entries()),
        }));

        ctx.postMessage({
            type: 'result',
            requestId,
            payload: serializedResults,
        } as WorkerOutput);
    } catch (error) {
        ctx.postMessage({
            type: 'error',
            requestId,
            error: error instanceof Error ? error.message : String(error),
        } as WorkerOutput);
    }
};

// Signal that worker is ready
ctx.postMessage({ type: 'ready' } as WorkerOutput);
