/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Unit tests for Web Worker pool
 *
 * Tests the worker pool utilities for parallel calculations.
 * Note: jsdom doesn't fully support Web Workers, so we test
 * the pool's behavior and interface rather than actual worker execution.
 *
 * @see js/worker-pool.ts - worker pool implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock console
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// Mock URL.createObjectURL for inline worker tests
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// Mock Worker class
class MockWorker {
    constructor(url) {
        this.url = url;
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
        MockWorker.instances.push(this);
    }

    postMessage(data) {
        if (this.terminated) return;
        // Simulate sync response using Promise.resolve to stay in microtask queue
        Promise.resolve().then(() => {
            if (this.onmessage && !this.terminated) {
                this.onmessage({
                    data: {
                        taskId: data.taskId,
                        result: { processed: data.payload },
                    },
                });
            }
        });
    }

    terminate() {
        this.terminated = true;
    }

    // For testing error scenarios
    simulateError(message) {
        if (this.onerror) {
            this.onerror({ message });
        }
    }

    static instances = [];
    static reset() {
        MockWorker.instances = [];
    }
}

// Set up global Worker mock
global.Worker = MockWorker;

import {
    WorkerPool,
    createWorkerPool,
    createInlineWorker,
} from '../../js/worker-pool.js';

describe('Worker Pool', () => {
    beforeEach(() => {
        MockWorker.reset();
    });

    afterEach(() => {
        // Terminate any leftover pools
        MockWorker.instances.forEach(w => w.terminate());
    });

    describe('WorkerPool class', () => {
        describe('constructor', () => {
            it('creates pool with default config', () => {
                const pool = new WorkerPool('./test-worker.js');
                expect(pool.isSupported()).toBe(true);
                expect(pool.isInitialized()).toBe(false);
            });

            it('accepts custom config', () => {
                const pool = new WorkerPool('./test-worker.js', {
                    poolSize: 2,
                    maxQueueSize: 100,
                    taskTimeout: 5000,
                });

                expect(pool.isSupported()).toBe(true);
            });
        });

        describe('initialize', () => {
            it('creates workers based on pool size', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 3 });
                await pool.initialize();

                expect(pool.isInitialized()).toBe(true);
                expect(MockWorker.instances.length).toBe(3);

                pool.terminate();
            });

            it('throws if already terminated', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();
                pool.terminate();

                await expect(pool.initialize()).rejects.toThrow('Cannot initialize terminated pool');
            });
        });

        describe('execute', () => {
            it('throws if pool is terminated', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();
                pool.terminate();

                await expect(
                    pool.execute({ payload: { test: true } })
                ).rejects.toThrow('Worker pool is terminated');
            });

            it('throws if queue is full', async () => {
                const pool = new WorkerPool('./test-worker.js', {
                    poolSize: 1,
                    maxQueueSize: 1,
                });
                await pool.initialize();

                // Fill the queue
                pool.execute({ payload: 'task1' });

                // This should throw
                await expect(
                    pool.execute({ payload: 'task2' })
                ).rejects.toThrow('Task queue is full');

                pool.terminate();
            });

            it('executes task and returns result', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                const result = await pool.execute({ payload: { value: 42 } });

                expect(result).toEqual({ processed: { value: 42 } });

                pool.terminate();
            });

            it('calls onComplete callback', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                const onComplete = jest.fn();

                await pool.execute({
                    payload: { test: true },
                    onComplete,
                });

                expect(onComplete).toHaveBeenCalledWith({ processed: { test: true } });

                pool.terminate();
            });

            it('assigns custom task id', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                const result = await pool.execute({
                    id: 'custom-id-123',
                    payload: { value: 1 },
                });

                expect(result).toBeDefined();

                pool.terminate();
            });
        });

        describe('executeAll', () => {
            it('executes multiple tasks in parallel', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 2 });
                await pool.initialize();

                const results = await pool.executeAll([
                    { payload: { value: 1 } },
                    { payload: { value: 2 } },
                    { payload: { value: 3 } },
                ]);

                expect(results).toHaveLength(3);
                expect(results).toEqual([
                    { processed: { value: 1 } },
                    { processed: { value: 2 } },
                    { processed: { value: 3 } },
                ]);

                pool.terminate();
            });
        });

        describe('terminate', () => {
            it('terminates all workers', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 2 });
                await pool.initialize();

                pool.terminate();

                expect(pool.isInitialized()).toBe(false);
                expect(MockWorker.instances.every(w => w.terminated)).toBe(true);
            });

            it('can be called multiple times safely', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                pool.terminate();
                pool.terminate();
                pool.terminate();

                expect(pool.isInitialized()).toBe(false);
            });

            it('rejects pending tasks', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                // Create a mock that doesn't respond
                MockWorker.instances[0].postMessage = () => {};

                const taskPromise = pool.execute({ payload: 'test' });
                pool.terminate();

                await expect(taskPromise).rejects.toThrow('Worker pool terminated');
            });
        });

        describe('getStats', () => {
            it('returns pool statistics', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 2 });
                await pool.initialize();

                const stats = pool.getStats();

                expect(stats.poolSize).toBe(2);
                expect(stats.busyWorkers).toBe(0);
                expect(stats.idleWorkers).toBe(2);
                expect(stats.pendingTasks).toBe(0);
                expect(stats.tasksCompleted).toBe(0);
                expect(stats.tasksFailed).toBe(0);

                pool.terminate();
            });

            it('tracks completed tasks', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                await pool.execute({ payload: 'task1' });
                await pool.execute({ payload: 'task2' });

                const stats = pool.getStats();
                expect(stats.tasksCompleted).toBe(2);

                pool.terminate();
            });

            it('calculates average task duration', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                await pool.execute({ payload: 'task' });

                const stats = pool.getStats();
                expect(stats.avgTaskDuration).toBeGreaterThanOrEqual(0);

                pool.terminate();
            });
        });

        describe('getPendingCount', () => {
            it('returns pending task count', async () => {
                const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
                await pool.initialize();

                expect(pool.getPendingCount()).toBe(0);

                pool.terminate();
            });
        });

        describe('isSupported', () => {
            it('returns true when Worker is available', () => {
                const pool = new WorkerPool('./test-worker.js');
                expect(pool.isSupported()).toBe(true);
            });
        });
    });

    describe('createWorkerPool factory', () => {
        it('creates and initializes a pool', async () => {
            const pool = await createWorkerPool('./test-worker.js', { poolSize: 2 });

            expect(pool.isInitialized()).toBe(true);
            expect(MockWorker.instances.length).toBe(2);

            pool.terminate();
        });
    });

    describe('createInlineWorker', () => {
        it('creates blob URL from function', () => {
            const url = createInlineWorker((data) => data * 2);

            expect(url).toMatch(/^blob:/);

            // Clean up
            URL.revokeObjectURL(url);
        });

        it('creates worker code that handles messages', () => {
            const fn = (payload) => ({ result: payload.value * 2 });
            const url = createInlineWorker(fn);

            expect(url).toBeDefined();
            expect(typeof url).toBe('string');

            URL.revokeObjectURL(url);
        });
    });

    describe('window exposure', () => {
        it('exposes worker pool on window', () => {
            expect(window.__OTPLUS_WORKER_POOL__).toBeDefined();
            expect(window.__OTPLUS_WORKER_POOL__.WorkerPool).toBe(WorkerPool);
            expect(typeof window.__OTPLUS_WORKER_POOL__.createWorkerPool).toBe('function');
            expect(typeof window.__OTPLUS_WORKER_POOL__.createInlineWorker).toBe('function');
            expect(typeof window.__OTPLUS_WORKER_POOL__.isSupported).toBe('function');
        });

        it('isSupported returns true when Worker available', () => {
            expect(window.__OTPLUS_WORKER_POOL__.isSupported()).toBe(true);
        });
    });

    describe('task timeout handling', () => {
        beforeEach(() => {
            jest.useFakeTimers({ advanceTimers: true });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('rejects task when timeout is exceeded', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                taskTimeout: 100, // 100ms timeout
            });
            await pool.initialize();

            // Make worker not respond
            MockWorker.instances[0].postMessage = () => {
                // Do nothing - simulate worker not responding
            };

            const promise = pool.execute({ payload: 'test' });

            // Advance time past timeout
            jest.advanceTimersByTime(150);

            await expect(promise).rejects.toThrow('Task timeout after 100ms');

            pool.terminate();
        });

        it('terminates and replaces worker on timeout', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                taskTimeout: 100,
                autoRestart: true,
            });
            await pool.initialize();

            const hungWorker = MockWorker.instances[0];
            hungWorker.postMessage = () => {
                // Do nothing - simulate worker not responding
            };

            const promise = pool.execute({ payload: 'test' });

            jest.advanceTimersByTime(150);

            await expect(promise).rejects.toThrow('Task timeout after 100ms');
            expect(hungWorker.terminated).toBe(true);
            expect(MockWorker.instances.length).toBe(2);

            const result = await pool.execute({ payload: 'recovery' });
            expect(result).toEqual({ processed: 'recovery' });

            pool.terminate();
        });

        it('clears timeout when task completes successfully', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                taskTimeout: 5000,
            });
            await pool.initialize();

            const result = await pool.execute({ payload: { value: 1 } });

            expect(result).toEqual({ processed: { value: 1 } });

            pool.terminate();
        });
    });

    describe('worker error handling', () => {
        it('handles worker error and fails the current task', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                autoRestart: false,
            });
            await pool.initialize();

            // Override postMessage to simulate error
            const worker = MockWorker.instances[0];
            worker.postMessage = function(data) {
                // Simulate an error instead of completing the task
                Promise.resolve().then(() => {
                    if (this.onerror) {
                        this.onerror({ message: 'Worker crashed' });
                    }
                });
            };

            const promise = pool.execute({ payload: 'test' });

            await expect(promise).rejects.toThrow('Worker error: Worker crashed');

            const stats = pool.getStats();
            expect(stats.tasksFailed).toBe(1);

            pool.terminate();
        });

        it('auto-restarts worker after error when configured', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                autoRestart: true,
            });
            await pool.initialize();

            const initialWorkerCount = MockWorker.instances.length;

            // Simulate worker error
            const worker = MockWorker.instances[0];
            worker.postMessage = function(data) {
                Promise.resolve().then(() => {
                    if (this.onerror) {
                        this.onerror({ message: 'Worker crashed' });
                    }
                });
            };

            const promise = pool.execute({ payload: 'test' });
            await expect(promise).rejects.toThrow('Worker error');

            // Worker should have been restarted
            expect(MockWorker.instances.length).toBe(initialWorkerCount + 1);

            pool.terminate();
        });

        it('processes tasks on replacement worker after error', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                autoRestart: true,
            });
            await pool.initialize();

            const worker = MockWorker.instances[0];
            worker.postMessage = function(data) {
                Promise.resolve().then(() => {
                    if (this.onerror) {
                        this.onerror({ message: 'Worker crashed' });
                    }
                });
            };

            const promise = pool.execute({ payload: 'test' });
            await expect(promise).rejects.toThrow('Worker error');

            const result = await pool.execute({ payload: 'recovery-task' });
            expect(result).toEqual({ processed: 'recovery-task' });

            pool.terminate();
        });
    });

    describe('message handling edge cases', () => {
        it('handles message for unknown task ID', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            // Manually trigger a message with unknown task ID
            const worker = MockWorker.instances[0];
            if (worker.onmessage) {
                worker.onmessage({
                    data: {
                        taskId: 'unknown-task-id',
                        result: { data: 'test' },
                    },
                });
            }

            // Should not throw, just log a warning
            pool.terminate();
        });

        it('handles task with error in result', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            // Override to return an error
            MockWorker.instances[0].postMessage = function(data) {
                Promise.resolve().then(() => {
                    if (this.onmessage) {
                        this.onmessage({
                            data: {
                                taskId: data.taskId,
                                error: 'Task failed in worker',
                            },
                        });
                    }
                });
            };

            const promise = pool.execute({ payload: 'test' });

            await expect(promise).rejects.toThrow('Task failed in worker');

            pool.terminate();
        });

        it('calls onError callback when task fails', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            const onError = jest.fn();

            // Make task fail
            MockWorker.instances[0].postMessage = function(data) {
                Promise.resolve().then(() => {
                    if (this.onmessage) {
                        this.onmessage({
                            data: {
                                taskId: data.taskId,
                                error: 'Processing error',
                            },
                        });
                    }
                });
            };

            await expect(pool.execute({
                payload: 'test',
                onError,
            })).rejects.toThrow();

            expect(onError).toHaveBeenCalled();

            pool.terminate();
        });
    });

    describe('isSupported when Worker not available', () => {
        it('returns false when Worker is undefined', () => {
            const originalWorker = global.Worker;
            delete global.Worker;

            const pool = new WorkerPool('./test-worker.js');
            expect(pool.isSupported()).toBe(false);

            global.Worker = originalWorker;
        });

        it('throws when initializing unsupported pool', async () => {
            const originalWorker = global.Worker;
            delete global.Worker;

            const pool = new WorkerPool('./test-worker.js');
            await expect(pool.initialize()).rejects.toThrow('Web Workers are not supported');

            global.Worker = originalWorker;
        });
    });

    describe('queue processing', () => {
        it('processes queue when worker becomes available', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            // Queue multiple tasks
            const promise1 = pool.execute({ payload: 'task1' });
            const promise2 = pool.execute({ payload: 'task2' });

            const [result1, result2] = await Promise.all([promise1, promise2]);

            expect(result1).toEqual({ processed: 'task1' });
            expect(result2).toEqual({ processed: 'task2' });

            pool.terminate();
        });

        it('does not process queue when terminated', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            // Make worker not respond immediately
            MockWorker.instances[0].postMessage = () => {};

            const promise = pool.execute({ payload: 'test' });
            pool.terminate();

            await expect(promise).rejects.toThrow('Worker pool terminated');
        });
    });

    describe('executeStream', () => {
        it('creates an async generator', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 2 });
            await pool.initialize();

            const tasks = [{ payload: 'a' }];

            // executeStream returns an async generator
            const stream = pool.executeStream(tasks);
            expect(typeof stream[Symbol.asyncIterator]).toBe('function');

            pool.terminate();
        });

        it('propagates errors to async generator consumer', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            // Override postMessage to simulate a worker error instead of success
            const worker = MockWorker.instances[0];
            worker.postMessage = (data) => {
                if (worker.terminated) return;
                Promise.resolve().then(() => {
                    if (worker.onerror && !worker.terminated) {
                        worker.onerror({ message: 'Stream task failed' });
                    }
                });
            };

            const tasks = [{ payload: 'fail-me' }];
            const stream = pool.executeStream(tasks);

            await expect(stream.next()).rejects.toThrow();

            pool.terminate();
        });

        it('yields results before throwing on subsequent error', async () => {
            const pool = new WorkerPool('./test-worker.js', { poolSize: 1 });
            await pool.initialize();

            let callCount = 0;
            const worker = MockWorker.instances[0];
            const originalPostMessage = worker.postMessage.bind(worker);

            worker.postMessage = (data) => {
                if (worker.terminated) return;
                callCount++;
                if (callCount === 1) {
                    // First task succeeds
                    Promise.resolve().then(() => {
                        if (worker.onmessage && !worker.terminated) {
                            worker.onmessage({
                                data: {
                                    taskId: data.taskId,
                                    result: { processed: data.payload },
                                },
                            });
                        }
                    });
                } else {
                    // Second task fails
                    Promise.resolve().then(() => {
                        if (worker.onerror && !worker.terminated) {
                            worker.onerror({ message: 'Second task failed' });
                        }
                    });
                }
            };

            const tasks = [
                { payload: 'success-task' },
                { payload: 'fail-task' },
            ];
            const stream = pool.executeStream(tasks);

            // First result should be yielded successfully
            const first = await stream.next();
            expect(first.done).toBe(false);
            expect(first.value).toEqual({ processed: 'success-task' });

            // Second iteration should throw
            await expect(stream.next()).rejects.toThrow();

            pool.terminate();
        });
    });

    describe('terminate edge cases', () => {
        it('clears timeout on pending tasks during termination', async () => {
            const pool = new WorkerPool('./test-worker.js', {
                poolSize: 1,
                taskTimeout: 10000,
            });
            await pool.initialize();

            // Make worker not respond
            MockWorker.instances[0].postMessage = () => {};

            const promise = pool.execute({ payload: 'test' });
            pool.terminate();

            await expect(promise).rejects.toThrow('Worker pool terminated');
        });
    });
});
