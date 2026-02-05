/**
 * @fileoverview Worker Manager Module
 * Manages the lifecycle of the calculation Web Worker for offloading heavy
 * overtime calculations to a separate thread, keeping the main thread responsive.
 *
 * ## Worker Lifecycle
 *
 * ```
 * ┌─────────────────┐
 * │   init()        │──► Creates Worker from calc.worker.js
 * └────────┬────────┘    Waits for 'ready' message (configurable timeout, default 5s)
 *          │
 *          ▼
 * ┌─────────────────┐
 * │   isReady=true  │──► Worker ready to accept calculations
 * └────────┬────────┘
 *          │
 *          ▼
 * ┌─────────────────┐    Serializes store data (Maps → Arrays)
 * │ calculateAsync()│──► Posts message to worker
 * └────────┬────────┘    Returns Promise awaiting result
 *          │
 *          ▼
 * ┌─────────────────┐
 * │ handleMessage() │──► Reconstructs Maps from serialized data
 * └────────┬────────┘    Resolves pending Promise
 *          │
 *          ▼
 * ┌─────────────────┐
 * │  terminate()    │──► Cleans up worker on page unload
 * └─────────────────┘
 * ```
 *
 * ## Fallback Behavior
 * If Web Workers are unavailable or initialization fails, calculations
 * run synchronously on the main thread using calculateAnalysis() directly.
 *
 * ## Data Serialization
 * Store contains Map objects which cannot be transferred to workers directly.
 * The manager serializes Maps to arrays before posting and reconstructs
 * them from the response.
 */

import { calculateAnalysis } from './calc.js';
import type { TimeEntry, DateRange, UserAnalysis, DayData } from './types.js';
import type { Store } from './state.js';

/**
 * Serialized user analysis from worker
 */
interface SerializedUserAnalysis {
    userId: string;
    userName: string;
    days: [string, DayData][];
    totals: UserAnalysis['totals'];
}

/**
 * Worker response structure
 */
interface WorkerResponse {
    type: 'ready' | 'result' | 'error';
    requestId?: number;
    payload?: SerializedUserAnalysis[];
    error?: string;
}

interface PendingRequest {
    resolve: (results: UserAnalysis[]) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Manages Web Worker lifecycle for calculation offloading.
 *
 * Responsibilities:
 * - Creates and initializes the calculation worker
 * - Handles worker ready state and error conditions
 * - Serializes/deserializes data for worker communication
 * - Provides fallback to main-thread calculation if worker unavailable
 * - Manages pending calculation promises
 *
 * Usage:
 * ```typescript
 * await workerManager.init();
 * const results = await workerManager.calculateAsync(entries, store, dateRange);
 * ```
 */
/**
 * Default worker initialization timeout in milliseconds.
 * Can be overridden via WorkerManager.initTimeoutMs for slow devices/networks.
 */
const DEFAULT_WORKER_INIT_TIMEOUT_MS = 5000;
const DEFAULT_WORKER_CALC_TIMEOUT_MS = 60000;

class WorkerManager {
    private worker: Worker | null = null;
    private isReady = false;
    private pendingRequests = new Map<number, PendingRequest>();
    private nextRequestId = 0;

    /**
     * Configurable worker initialization timeout in milliseconds.
     * Increase this value for slow devices or network conditions.
     * Default: 5000ms (5 seconds)
     */
    public initTimeoutMs: number = DEFAULT_WORKER_INIT_TIMEOUT_MS;
    /**
     * Configurable worker calculation timeout in milliseconds.
     * If exceeded, the worker calculation falls back to sync processing.
     * Default: 60000ms (60 seconds)
     */
    public calcTimeoutMs: number = DEFAULT_WORKER_CALC_TIMEOUT_MS;

    /**
     * Initialize the Web Worker.
     * Creates worker from calc.worker.js and waits for ready confirmation.
     * Fails gracefully if Workers are unsupported or initialization times out.
     *
     * @throws Never - errors are caught and logged, falling back to main thread.
     */
    async init(): Promise<void> {
        if (this.worker) return;

        // Check if Web Workers are supported
        if (typeof Worker === 'undefined') {
            console.warn('Web Workers not supported, calculations will run on main thread');
            return;
        }

        try {
            // Create worker - in production this would be the bundled worker file
            this.worker = new Worker(new URL('./calc.worker.js', import.meta.url), {
                type: 'module',
            });

            // Set up message handler
            this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                this.handleMessage(event.data);
            };

            // Set up error handler
            this.worker.onerror = (error) => {
                console.error('Worker error:', error);
                this.rejectAllPending(new Error('Worker error'));
            };

            // Wait for worker to be ready
            await new Promise<void>((resolve, reject) => {
                const worker = this.worker;
                if (!worker) {
                    reject(new Error('Worker not available'));
                    return;
                }

                const timeout = setTimeout(() => {
                    reject(new Error('Worker initialization timeout'));
                }, this.initTimeoutMs);

                const originalHandler = worker.onmessage;
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        this.isReady = true;
                        worker.onmessage = originalHandler;
                        resolve();
                    }
                };
            });
        } catch (error) {
            console.warn('Failed to initialize Web Worker, falling back to main thread:', error);
            this.worker = null;
        }
    }

    private rejectAllPending(error: Error): void {
        for (const pending of this.pendingRequests.values()) {
            if (pending.timeoutId) {
                clearTimeout(pending.timeoutId);
            }
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }

    /**
     * Handle messages from the worker.
     * Processes 'result' messages by reconstructing Maps and resolving promises.
     * Processes 'error' messages by rejecting pending promises.
     *
     * SERIALIZATION NOTE:
     * Web Workers use the Structured Clone Algorithm for message passing.
     * While it supports Maps, they are sometimes stripped of their prototype methods
     * or cause issues in certain environments when complex nested structures are passed.
     * To ensure robustness, we manually re-hydrate the `days` Map from the serialized array
     * returned by the worker.
     *
     * @param data - Response from worker containing type and payload.
     */
    private handleMessage(data: WorkerResponse): void {
        if (data.type !== 'result' && data.type !== 'error') {
            return;
        }

        let requestId = data.requestId;
        if (typeof requestId !== 'number') {
            if (this.pendingRequests.size === 1) {
                requestId = this.pendingRequests.keys().next().value as number;
            } else {
                console.warn('Worker response missing requestId');
                return;
            }
        }

        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            console.warn('No pending worker request for id', requestId);
            return;
        }

        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        this.pendingRequests.delete(requestId);

        if (data.type === 'result' && data.payload) {
            // Reconstruct Maps from serialized data (Worker transfer strips Map prototypes)
            const results: UserAnalysis[] = data.payload.map((user) => ({
                ...user,
                days: new Map(user.days),
            }));
            pending.resolve(results);
        } else if (data.type === 'error') {
            pending.reject(new Error(data.error || 'Unknown worker error'));
        }
    }

    /**
     * Run calculation asynchronously using the Web Worker.
     * Falls back to synchronous calculation on main thread if:
     * - Worker not initialized or not ready
     * - Entries or date range are null
     * - Worker initialization previously failed
     *
     * @param entries - Time entries to analyze (null triggers fallback).
     * @param store - Application store with config, profiles, holidays, etc.
     * @param dateRange - Date range for analysis (null triggers fallback).
     * @returns Promise resolving to array of UserAnalysis results.
     */
    async calculateAsync(
        entries: TimeEntry[] | null,
        store: Store,
        dateRange: DateRange | null
    ): Promise<UserAnalysis[]> {
        // Fallback to synchronous calculation if worker not available
        if (!this.worker || !this.isReady || !entries || !dateRange) {
            return calculateAnalysis(entries, store, dateRange);
        }

        const worker = this.worker;
        if (!worker) {
            return calculateAnalysis(entries, store, dateRange);
        }

        if (this.pendingRequests.size > 0) {
            this.rejectAllPending(new Error('Worker calculation overridden by newer request'));
        }

        const requestId = ++this.nextRequestId;
        let timedOut = false;

        try {
            return await new Promise<UserAnalysis[]>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    timedOut = true;
                    if (!this.pendingRequests.has(requestId)) return;
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Worker calculation timeout after ${this.calcTimeoutMs}ms`));
                }, this.calcTimeoutMs);

                this.pendingRequests.set(requestId, {
                    resolve,
                    reject,
                    timeoutId,
                });

                // Serialize store data for transfer to worker
                const serializedStore = {
                    users: store.users,
                    profiles: Array.from(store.profiles.entries()),
                    holidays: Array.from(store.holidays.entries()).map(([userId, hMap]) => [
                        userId,
                        Array.from(hMap.entries()),
                    ] as [string, [string, unknown][]]),
                    timeOff: Array.from(store.timeOff.entries()).map(([userId, tMap]) => [
                        userId,
                        Array.from(tMap.entries()),
                    ] as [string, [string, unknown][]]),
                    overrides: store.overrides,
                    config: store.config,
                    calcParams: store.calcParams,
                };

                worker.postMessage({
                    type: 'calculate',
                    requestId,
                    payload: {
                        entries,
                        dateRange,
                        store: serializedStore,
                    },
                });
            });
        } catch (error) {
            if (timedOut) {
                console.warn('Worker calculation timed out, falling back to sync', error);
                this.terminate();
                return calculateAnalysis(entries, store, dateRange);
            }
            throw error;
        }
    }

    /**
     * Terminate the worker and clean up resources.
     * Should be called on page unload or when worker is no longer needed.
     * After termination, init() must be called again to use the worker.
     */
    terminate(): void {
        if (this.pendingRequests.size > 0) {
            for (const pending of this.pendingRequests.values()) {
                if (pending.timeoutId) {
                    clearTimeout(pending.timeoutId);
                }
            }
            this.pendingRequests.clear();
        }
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}

// Export singleton instance
export const workerManager = new WorkerManager();

// Export function for async calculation
export async function calculateAsync(
    entries: TimeEntry[] | null,
    store: Store,
    dateRange: DateRange | null
): Promise<UserAnalysis[]> {
    return workerManager.calculateAsync(entries, store, dateRange);
}
