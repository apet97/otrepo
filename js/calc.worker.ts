/**
 * @fileoverview Calculation Web Worker
 * Offloads heavy calculation work to a separate thread to keep UI responsive.
 * Receives calculation inputs via postMessage and returns results.
 */

import { calculateAnalysis } from './calc.js';
import type {
    TimeEntry,
    DateRange,
    UserProfile,
    Holiday,
    TimeOffInfo,
    UserOverride,
    OvertimeConfig,
    CalculationParams,
    User,
} from './types.js';

/**
 * WorkerPool protocol input: { taskId, payload }
 * The payload contains the calculation inputs.
 */
interface WorkerPoolMessage {
    taskId: string;
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

// `self` in a Web Worker context is `DedicatedWorkerGlobalScope`; cast to
// `Worker` for `postMessage` type compatibility.
const ctx: Worker = self as unknown as Worker;

/**
 * Handle incoming messages from the WorkerPool.
 * Protocol: receive { taskId, payload }, respond with { taskId, result } or { taskId, error }.
 */
ctx.onmessage = (event: MessageEvent<WorkerPoolMessage>) => {
    const { taskId, payload } = event.data;

    try {
        const { entries, dateRange, store } = payload;

        // The structured clone algorithm (used by postMessage) cannot serialize
        // Maps, so they are transmitted as arrays and reconstructed here.
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

        // Maps are converted back to arrays before posting results since
        // structured clone cannot handle Maps.
        const serializedResults = results.map((user) => ({
            ...user,
            days: Array.from(user.days.entries()),
        }));

        ctx.postMessage({ taskId, result: serializedResults });
    } catch (error) {
        ctx.postMessage({
            taskId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
