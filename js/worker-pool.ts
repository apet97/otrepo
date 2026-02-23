/**
 * @fileoverview Web Worker Pool for Parallel Calculations
 *
 * Provides a pool of Web Workers for parallel processing of
 * CPU-intensive calculations without blocking the main thread.
 *
 * ## Features
 *
 * - Configurable pool size (defaults to navigator.hardwareConcurrency)
 * - Automatic task queuing and distribution
 * - Promise-based task execution
 * - Worker lifecycle management
 * - Error handling and recovery
 *
 * ## Usage
 *
 * ```typescript
 * import { WorkerPool, createWorkerPool } from './worker-pool.js';
 *
 * // Create a pool with a worker script
 * const pool = createWorkerPool('./calc-worker.js', { poolSize: 4 });
 *
 * // Execute tasks in parallel
 * const results = await pool.executeAll([
 *     { type: 'calculate', data: entry1 },
 *     { type: 'calculate', data: entry2 },
 * ]);
 *
 * // Execute single task
 * const result = await pool.execute({ type: 'transform', data: input });
 *
 * // Cleanup when done
 * pool.terminate();
 * ```
 *
 * ## Worker Script Format
 *
 * Workers should handle messages like:
 * ```javascript
 * self.onmessage = (e) => {
 *     const { taskId, payload } = e.data;
 *     // Process payload...
 *     self.postMessage({ taskId, result });
 * };
 * ```
 */

import { createLogger } from './logger.js';

const logger = createLogger('WorkerPool');

function unrefTimerIfSupported(timerId: ReturnType<typeof setTimeout> | undefined): void {
    if (!timerId || typeof timerId !== 'object') return;
    const maybeTimer = timerId as { unref?: () => void };
    if (typeof maybeTimer.unref === 'function') {
        maybeTimer.unref();
    }
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Worker pool configuration.
 */
export interface WorkerPoolConfig {
    /** Number of workers in the pool (default: navigator.hardwareConcurrency or 4) */
    poolSize: number;
    /** Maximum tasks to queue (default: 1000) */
    maxQueueSize: number;
    /** Timeout for task execution in ms (default: 30000) */
    taskTimeout: number;
    /** Whether to restart workers that crash (default: true) */
    autoRestart: boolean;
}

/**
 * Task to execute in a worker.
 */
export interface WorkerTask<TPayload = unknown, TResult = unknown> {
    /** Unique task identifier (auto-generated if not provided) */
    id?: string;
    /** Task payload to send to worker */
    payload: TPayload;
    /** Optional callback on completion */
    onComplete?: (result: TResult) => void;
    /** Optional callback on error */
    onError?: (error: Error) => void;
}

/**
 * Internal task with promise handlers.
 */
interface PendingTask<TResult> {
    id: string;
    payload: unknown;
    resolve: (result: TResult) => void;
    reject: (error: Error) => void;
    startTime: number;
    timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Worker wrapper with state tracking.
 */
interface PooledWorker {
    worker: Worker;
    id: number;
    busy: boolean;
    currentTaskId: string | null;
    taskCount: number;
}

/**
 * Worker pool statistics.
 */
export interface WorkerPoolStats {
    /** Number of workers in the pool */
    poolSize: number;
    /** Number of busy workers */
    busyWorkers: number;
    /** Number of idle workers */
    idleWorkers: number;
    /** Number of pending tasks in queue */
    pendingTasks: number;
    /** Total tasks completed */
    tasksCompleted: number;
    /** Total tasks failed */
    tasksFailed: number;
    /** Average task duration in ms */
    avgTaskDuration: number;
}

// ============================================================================
// WORKER POOL CLASS
// ============================================================================

/**
 * Pool of Web Workers for parallel task execution.
 */
export class WorkerPool<TPayload = unknown, TResult = unknown> {
    private config: WorkerPoolConfig;
    private workerScript: string | URL;
    private workers: PooledWorker[] = [];
    // Use Map instead of array for O(1) atomic task lookup and deletion
    // This prevents race conditions when concurrent Promise resolutions occur
    private taskQueue = new Map<string, PendingTask<TResult>>();
    private taskIdCounter = 0;
    private tasksCompleted = 0;
    private tasksFailed = 0;
    private totalTaskDuration = 0;
    private isTerminated = false;
    /** Track if workerScript is a blob URL so we can revoke it on terminate */
    private isBlobUrl = false;

    constructor(workerScript: string | URL, config?: Partial<WorkerPoolConfig>) {
        this.workerScript = workerScript;
        // Track blob URLs so we can revoke them on terminate (prevents memory leak)
        const scriptStr = workerScript.toString();
        this.isBlobUrl = scriptStr.startsWith('blob:');
        this.config = {
            poolSize: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
            maxQueueSize: 1000,
            taskTimeout: 30000,
            autoRestart: true,
            ...config,
        };
    }

    /**
     * Initializes the worker pool.
     */
    async initialize(): Promise<void> {
        if (this.isTerminated) {
            throw new Error('Cannot initialize terminated pool');
        }

        if (!this.isSupported()) {
            throw new Error('Web Workers are not supported');
        }

        logger.info('Initializing worker pool', {
            poolSize: this.config.poolSize,
            workerScript: this.workerScript.toString(),
        });

        for (let i = 0; i < this.config.poolSize; i++) {
            this.createWorker(i);
        }
    }

    /**
     * Executes a single task.
     */
    async execute(task: WorkerTask<TPayload, TResult>): Promise<TResult> {
        if (this.isTerminated) {
            throw new Error('Worker pool is terminated');
        }

        if (this.taskQueue.size >= this.config.maxQueueSize) {
            throw new Error('Task queue is full');
        }

        return new Promise((resolve, reject) => {
            const id = task.id || this.generateTaskId();

            const pendingTask: PendingTask<TResult> = {
                id,
                payload: task.payload,
                resolve: (result: TResult) => {
                    task.onComplete?.(result);
                    resolve(result);
                },
                reject: (error: Error) => {
                    task.onError?.(error);
                    reject(error);
                },
                startTime: 0,
            };

            this.taskQueue.set(id, pendingTask);
            this.processQueue();
        });
    }

    /**
     * Executes multiple tasks and returns all results.
     */
    async executeAll(tasks: WorkerTask<TPayload, TResult>[]): Promise<TResult[]> {
        const promises = tasks.map(task => this.execute(task));
        return Promise.all(promises);
    }

    /**
     * Executes multiple tasks and returns results as they complete.
     */
    async *executeStream(tasks: WorkerTask<TPayload, TResult>[]): AsyncGenerator<TResult, void, unknown> {
        const settled: Array<{ result?: TResult; error?: Error }> = [];
        let waiter: { resolve: () => void } | null = null;
        let remaining = tasks.length;

        const notify = () => {
            if (waiter) {
                const w = waiter;
                waiter = null;
                w.resolve();
            }
        };

        for (const task of tasks) {
            const id = task.id || this.generateTaskId();

            this.execute({ ...task, id })
                .then(result => {
                    settled.push({ result });
                    remaining--;
                    notify();
                })
                .catch((error: unknown) => {
                    settled.push({ error: error instanceof Error ? error : new Error(String(error)) });
                    remaining--;
                    notify();
                });
        }

        while (remaining > 0 || settled.length > 0) {
            if (settled.length === 0) {
                // Wait for next completion or error
                await new Promise<void>(resolve => {
                    waiter = { resolve };
                });
            }

            while (settled.length > 0) {
                const item = settled.shift()!;
                if (item.error) {
                    throw item.error;
                }
                yield item.result as TResult;
            }
        }
    }

    /**
     * Terminates all workers and cleans up.
     */
    terminate(): void {
        if (this.isTerminated) return;

        logger.info('Terminating worker pool', {
            tasksCompleted: this.tasksCompleted,
            tasksFailed: this.tasksFailed,
        });

        this.isTerminated = true;

        // Reject pending tasks
        for (const task of this.taskQueue.values()) {
            if (task.timeoutId) {
                clearTimeout(task.timeoutId);
            }
            task.reject(new Error('Worker pool terminated'));
        }
        this.taskQueue.clear();

        // Terminate workers
        for (const pooledWorker of this.workers) {
            pooledWorker.worker.terminate();
        }
        this.workers = [];

        // Revoke blob URL to prevent memory leak
        if (this.isBlobUrl && typeof URL !== 'undefined') {
            URL.revokeObjectURL(this.workerScript.toString());
        }
    }

    /**
     * Gets pool statistics.
     */
    getStats(): WorkerPoolStats {
        const busyWorkers = this.workers.filter(w => w.busy).length;

        return {
            poolSize: this.workers.length,
            busyWorkers,
            idleWorkers: this.workers.length - busyWorkers,
            pendingTasks: this.taskQueue.size,
            tasksCompleted: this.tasksCompleted,
            tasksFailed: this.tasksFailed,
            avgTaskDuration: this.tasksCompleted > 0
                ? this.totalTaskDuration / this.tasksCompleted
                : 0,
        };
    }

    /**
     * Checks if Web Workers are supported.
     */
    isSupported(): boolean {
        return typeof Worker !== 'undefined';
    }

    /**
     * Checks if the pool is initialized.
     */
    isInitialized(): boolean {
        return this.workers.length > 0 && !this.isTerminated;
    }

    /**
     * Gets the number of pending tasks.
     */
    getPendingCount(): number {
        return this.taskQueue.size;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private createWorker(id: number): void {
        const worker = new Worker(this.workerScript);
        const pooledWorker: PooledWorker = {
            worker,
            id,
            busy: false,
            currentTaskId: null,
            taskCount: 0,
        };

        worker.onmessage = (e: MessageEvent) => {
            this.handleWorkerMessage(pooledWorker, e);
        };

        worker.onerror = (e: ErrorEvent) => {
            this.handleWorkerError(pooledWorker, e);
        };

        this.workers.push(pooledWorker);
    }

    private handleWorkerMessage(pooledWorker: PooledWorker, e: MessageEvent): void {
        const { taskId, result, error } = e.data;

        // Use Map.get() + Map.delete() for atomic O(1) lookup and removal
        // This prevents race conditions when concurrent Promise resolutions occur
        const task = this.taskQueue.get(taskId);
        if (!task) {
            logger.warn('Received message for unknown task', { taskId });
            return;
        }

        // Atomic O(1) removal - cannot race with other handlers
        this.taskQueue.delete(taskId);

        if (task.timeoutId) {
            clearTimeout(task.timeoutId);
        }

        const duration = performance.now() - task.startTime;
        this.totalTaskDuration += duration;

        if (error) {
            this.tasksFailed++;
            task.reject(new Error(error));
        } else {
            this.tasksCompleted++;
            task.resolve(result);
        }

        pooledWorker.busy = false;
        pooledWorker.currentTaskId = null;
        pooledWorker.taskCount++;

        // Process next task
        this.processQueue();
    }

    private handleWorkerError(pooledWorker: PooledWorker, e: ErrorEvent): void {
        logger.error('Worker error', {
            workerId: pooledWorker.id,
            error: e.message,
        });

        // Fail current task if any
        if (pooledWorker.currentTaskId) {
            const task = this.taskQueue.get(pooledWorker.currentTaskId);
            if (task) {
                // Atomic O(1) removal
                this.taskQueue.delete(pooledWorker.currentTaskId);

                if (task.timeoutId) {
                    clearTimeout(task.timeoutId);
                }

                this.tasksFailed++;
                task.reject(new Error(`Worker error: ${e.message}`));
            }
        }

        pooledWorker.busy = false;
        pooledWorker.currentTaskId = null;

        // Restart worker if configured
        if (this.config.autoRestart && !this.isTerminated) {
            const workerIndex = this.workers.indexOf(pooledWorker);
            if (workerIndex !== -1) {
                this.workers.splice(workerIndex, 1);
                pooledWorker.worker.terminate();
                this.createWorker(pooledWorker.id);
            }
            this.processQueue();
            return;
        }
        this.processQueue();
    }

    private processQueue(): void {
        if (this.isTerminated || this.taskQueue.size === 0) return;

        const idleWorker = this.workers.find(w => !w.busy);
        if (!idleWorker) return;

        // Find task that hasn't started yet
        let task: PendingTask<TResult> | undefined;
        for (const t of this.taskQueue.values()) {
            if (t.startTime === 0) {
                task = t;
                break;
            }
        }
        if (!task) return;

        // Assign task to worker
        idleWorker.busy = true;
        idleWorker.currentTaskId = task.id;
        task.startTime = performance.now();

        // Set up timeout
        if (this.config.taskTimeout > 0) {
            task.timeoutId = setTimeout(() => {
                this.handleTaskTimeout(task, idleWorker);
            }, this.config.taskTimeout);
            unrefTimerIfSupported(task.timeoutId);
        }

        // Send to worker
        idleWorker.worker.postMessage({
            taskId: task.id,
            payload: task.payload,
        });

        // Process more if possible
        this.processQueue();
    }

    private handleTaskTimeout(task: PendingTask<TResult>, worker: PooledWorker): void {
        logger.warn('Task timeout', { taskId: task.id, timeout: this.config.taskTimeout });

        // Atomic O(1) removal
        this.taskQueue.delete(task.id);

        this.tasksFailed++;
        task.reject(new Error(`Task timeout after ${this.config.taskTimeout}ms`));

        const workerIndex = this.workers.indexOf(worker);
        if (workerIndex !== -1) {
            this.workers.splice(workerIndex, 1);
        }

        worker.busy = false;
        worker.currentTaskId = null;
        worker.worker.terminate();

        if (this.config.autoRestart && !this.isTerminated) {
            this.createWorker(worker.id);
        }

        this.processQueue();
    }

    private generateTaskId(): string {
        return `task-${++this.taskIdCounter}-${Date.now()}`;
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates and initializes a worker pool.
 *
 * @param workerScript - URL or path to worker script
 * @param config - Pool configuration
 * @returns Initialized worker pool
 */
export async function createWorkerPool<TPayload = unknown, TResult = unknown>(
    workerScript: string | URL,
    config?: Partial<WorkerPoolConfig>
): Promise<WorkerPool<TPayload, TResult>> {
    const pool = new WorkerPool<TPayload, TResult>(workerScript, config);
    await pool.initialize();
    return pool;
}

// ============================================================================
// INLINE WORKER HELPER
// ============================================================================
/**
 * Creates a worker from an inline function (for simple use cases).
 *
 * @security This function uses `fn.toString()` to serialize the function body
 * into a Worker Blob. The function must be fully self-contained:
 * - Closures over outer variables will NOT work (undefined at runtime)
 * - External module imports are NOT available inside the worker
 * - Only the function body is transferred; its lexical scope is lost
 *
 * @param fn - Self-contained function to run in worker (no closures/imports)
 * @returns Blob URL for the worker
 */
export function createInlineWorker(fn: (payload: unknown) => unknown): string {
    const workerCode = `
        self.onmessage = function(e) {
            const { taskId, payload } = e.data;
            try {
                const fn = ${fn.toString()};
                const result = fn(payload);
                self.postMessage({ taskId, result });
            } catch (error) {
                self.postMessage({ taskId, error: error.message });
            }
        };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

// ============================================================================
// WINDOW EXPOSURE
// ============================================================================

/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__OTPLUS_WORKER_POOL__ = {
        WorkerPool,
        createWorkerPool,
        createInlineWorker,
        isSupported: () => typeof Worker !== 'undefined',
    };
}
