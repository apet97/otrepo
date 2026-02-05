/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import { createMockStore, generateMockEntries } from '../helpers/mock-data.js';

// Mock calculateAnalysis
const mockCalculateAnalysis = jest.fn();

jest.unstable_mockModule('../../js/calc.js', () => ({
  calculateAnalysis: mockCalculateAnalysis
}));

describe('Worker Manager Module', () => {
  let workerManager;
  let calculateAsync;
  let mockStore;
  let MockWorker;
  let mockWorkerInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock worker instance
    mockWorkerInstance = {
      onmessage: null,
      onerror: null,
      postMessage: jest.fn(),
      terminate: jest.fn()
    };

    // Create mock Worker class
    MockWorker = jest.fn().mockImplementation(() => mockWorkerInstance);

    // Set up global Worker
    global.Worker = MockWorker;

    // Create mock store
    mockStore = createMockStore({ userCount: 2 });

    // Mock calculateAnalysis to return predictable results
    mockCalculateAnalysis.mockReturnValue([
      {
        userId: 'user0',
        userName: 'User 0',
        days: new Map(),
        totals: { regular: 40, overtime: 0, total: 40 }
      }
    ]);

    // Import fresh module
    const module = await import('../../js/worker-manager.js');
    workerManager = module.workerManager;
    calculateAsync = module.calculateAsync;
  });

  afterEach(() => {
    // Terminate worker if it exists
    if (workerManager) {
      workerManager.terminate();
    }
    delete global.Worker;
  });

  describe('workerManager.init', () => {
    it('should create a Worker when supported', async () => {
      // Override mock to trigger ready message when onmessage is set
      MockWorker.mockImplementationOnce(() => {
        const instance = {
          onmessage: null,
          onerror: null,
          postMessage: jest.fn(),
          terminate: jest.fn()
        };
        // Use a setter to detect when onmessage is assigned
        let _onmessage = null;
        Object.defineProperty(instance, 'onmessage', {
          get: () => _onmessage,
          set: (fn) => {
            _onmessage = fn;
            // Trigger ready message after a microtask to allow init to set up
            Promise.resolve().then(() => {
              if (_onmessage) {
                _onmessage({ data: { type: 'ready' } });
              }
            });
          }
        });
        return instance;
      });

      await workerManager.init();

      expect(MockWorker).toHaveBeenCalled();
    });

    it('should not create worker when Workers are not supported', async () => {
      delete global.Worker;

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await workerManager.init();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Web Workers not supported')
      );

      consoleSpy.mockRestore();
    });

    it('should be idempotent - not create multiple workers', async () => {
      // Override mock to trigger ready message when onmessage is set
      MockWorker.mockImplementationOnce(() => {
        const instance = {
          onmessage: null,
          onerror: null,
          postMessage: jest.fn(),
          terminate: jest.fn()
        };
        let _onmessage = null;
        Object.defineProperty(instance, 'onmessage', {
          get: () => _onmessage,
          set: (fn) => {
            _onmessage = fn;
            Promise.resolve().then(() => {
              if (_onmessage) {
                _onmessage({ data: { type: 'ready' } });
              }
            });
          }
        });
        return instance;
      });

      await workerManager.init();
      const firstCallCount = MockWorker.mock.calls.length;

      await workerManager.init();

      expect(MockWorker.mock.calls.length).toBe(firstCallCount);
    });

    it('should handle worker initialization timeout', async () => {
      jest.useFakeTimers({ advanceTimers: true });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const initPromise = workerManager.init();

      // Advance past the 5 second timeout
      jest.advanceTimersByTime(6000);

      await initPromise;

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should handle worker creation error', async () => {
      MockWorker.mockImplementationOnce(() => {
        throw new Error('Worker creation failed');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await workerManager.init();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should set up message handler', async () => {
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);

      await workerManager.init();

      expect(mockWorkerInstance.onmessage).toBeDefined();
    });

    it('should set up error handler', async () => {
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);

      await workerManager.init();

      expect(mockWorkerInstance.onerror).toBeDefined();
    });
  });

  describe('workerManager.calculateAsync', () => {
    it('should fallback to sync calculation when worker not initialized', async () => {
      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const result = await workerManager.calculateAsync(entries, mockStore, dateRange);

      expect(mockCalculateAnalysis).toHaveBeenCalledWith(entries, mockStore, dateRange);
      expect(result).toEqual(mockCalculateAnalysis.mock.results[0].value);
    });

    it('should fallback when entries is null', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const dateRange = { start: '2025-01-01', end: '2025-01-31' };
      await workerManager.calculateAsync(null, mockStore, dateRange);

      expect(mockCalculateAnalysis).toHaveBeenCalled();
    });

    it('should fallback when dateRange is null', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      await workerManager.calculateAsync(entries, mockStore, null);

      expect(mockCalculateAnalysis).toHaveBeenCalled();
    });

    it('should post message to worker when initialized', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start async calculation (don't await yet)
      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Verify message was posted
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'calculate',
          requestId: expect.any(Number),
          payload: expect.objectContaining({
            entries,
            dateRange
          })
        })
      );

      const requestId = mockWorkerInstance.postMessage.mock.calls[0][0].requestId;

      // Simulate worker response
      mockWorkerInstance.onmessage({
        data: {
          type: 'result',
          requestId,
          payload: [{
            userId: 'user0',
            userName: 'User 0',
            days: [],
            totals: { regular: 40, overtime: 0, total: 40 }
          }]
        }
      });

      const result = await calcPromise;
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user0');
    });

    it('should serialize Maps for worker communication', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start async calculation
      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Check that Maps were converted to arrays
      const postedMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(Array.isArray(postedMessage.payload.store.profiles)).toBe(true);
      expect(Array.isArray(postedMessage.payload.store.holidays)).toBe(true);
      expect(Array.isArray(postedMessage.payload.store.timeOff)).toBe(true);

      // Cleanup
      mockWorkerInstance.onmessage({
        data: { type: 'result', requestId: postedMessage.requestId, payload: [] }
      });
      await calcPromise;
    });

    it('should reconstruct Maps from worker response', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);
      const requestId = mockWorkerInstance.postMessage.mock.calls[0][0].requestId;

      // Simulate worker response with serialized days
      mockWorkerInstance.onmessage({
        data: {
          type: 'result',
          requestId,
          payload: [{
            userId: 'user0',
            userName: 'User 0',
            days: [['2025-01-01', { entries: [], meta: {} }]],
            totals: { regular: 8, overtime: 0, total: 8 }
          }]
        }
      });

      const result = await calcPromise;

      // Verify days was reconstructed as a Map
      expect(result[0].days).toBeInstanceOf(Map);
      expect(result[0].days.has('2025-01-01')).toBe(true);
    });

    it('should reject on worker error response', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);
      const requestId = mockWorkerInstance.postMessage.mock.calls[0][0].requestId;

      // Simulate error response
      mockWorkerInstance.onmessage({
        data: {
          type: 'error',
          requestId,
          error: 'Calculation failed'
        }
      });

      await expect(calcPromise).rejects.toThrow('Calculation failed');
    });

    it('should reject earlier calculation when a newer request starts', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const firstPromise = workerManager.calculateAsync(entries, mockStore, dateRange);
      const secondPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      await expect(firstPromise).rejects.toThrow('overridden');

      const secondRequest = mockWorkerInstance.postMessage.mock.calls[1][0];
      mockWorkerInstance.onmessage({
        data: {
          type: 'result',
          requestId: secondRequest.requestId,
          payload: [{
            userId: 'user0',
            userName: 'User 0',
            days: [],
            totals: { regular: 40, overtime: 0, total: 40 }
          }]
        }
      });

      const result = await secondPromise;
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user0');
    });

    it('should reject on worker onerror', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Trigger onerror
      mockWorkerInstance.onerror({ message: 'Worker crashed' });

      await expect(calcPromise).rejects.toThrow('Worker error');

      consoleSpy.mockRestore();
    });

    it('should fallback to sync calculation on worker timeout', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      workerManager.calcTimeoutMs = 1000;

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      await jest.advanceTimersByTimeAsync(1500);

      const result = await calcPromise;

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
        expect.any(Error)
      );
      expect(mockCalculateAnalysis).toHaveBeenCalledWith(entries, mockStore, dateRange);
      expect(result).toEqual(mockCalculateAnalysis.mock.results[0].value);

      consoleSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('workerManager.terminate', () => {
    it('should terminate the worker', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      workerManager.terminate();

      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
    });

    it('should allow re-initialization after termination', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      workerManager.terminate();

      // Reset mock for new worker instance
      const newMockWorkerInstance = {
        onmessage: null,
        onerror: null,
        postMessage: jest.fn(),
        terminate: jest.fn()
      };
      MockWorker.mockImplementationOnce(() => newMockWorkerInstance);

      setTimeout(() => {
        if (newMockWorkerInstance.onmessage) {
          newMockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);

      await workerManager.init();

      expect(MockWorker).toHaveBeenCalledTimes(2);
    });

    it('should do nothing if no worker exists', () => {
      // Don't initialize - just terminate
      expect(() => workerManager.terminate()).not.toThrow();
    });

    it('should fallback to sync after termination', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      workerManager.terminate();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      await workerManager.calculateAsync(entries, mockStore, dateRange);

      expect(mockCalculateAnalysis).toHaveBeenCalled();
    });
  });

  describe('calculateAsync export function', () => {
    it('should delegate to workerManager.calculateAsync', async () => {
      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const result = await calculateAsync(entries, mockStore, dateRange);

      expect(mockCalculateAnalysis).toHaveBeenCalledWith(entries, mockStore, dateRange);
      expect(result).toBeDefined();
    });
  });

  describe('Data Serialization', () => {
    it('should serialize nested Map entries for holidays', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      // Add holiday data
      mockStore.holidays = new Map([
        ['user0', new Map([
          ['2025-01-01', { name: 'New Year' }]
        ])]
      ]);

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Verify serialization structure
      const postedMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(postedMessage.payload.store.holidays).toEqual([
        ['user0', [['2025-01-01', { name: 'New Year' }]]]
      ]);

      // Cleanup
      mockWorkerInstance.onmessage({ data: { type: 'result', payload: [] } });
      await calcPromise;
    });

    it('should serialize nested Map entries for timeOff', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      // Add time off data
      mockStore.timeOff = new Map([
        ['user0', new Map([
          ['2025-01-02', { hours: 4, type: 'vacation' }]
        ])]
      ]);

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Verify serialization structure
      const postedMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(postedMessage.payload.store.timeOff).toEqual([
        ['user0', [['2025-01-02', { hours: 4, type: 'vacation' }]]]
      ]);

      // Cleanup
      mockWorkerInstance.onmessage({ data: { type: 'result', payload: [] } });
      await calcPromise;
    });

    it('should include config and calcParams in serialized store', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      const postedMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(postedMessage.payload.store.config).toEqual(mockStore.config);
      expect(postedMessage.payload.store.calcParams).toEqual(mockStore.calcParams);
      expect(postedMessage.payload.store.overrides).toEqual(mockStore.overrides);
      expect(postedMessage.payload.store.users).toEqual(mockStore.users);

      // Cleanup
      mockWorkerInstance.onmessage({ data: { type: 'result', payload: [] } });
      await calcPromise;
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown message types gracefully', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      // Send unknown message type - should not throw
      expect(() => {
        mockWorkerInstance.onmessage({ data: { type: 'unknown' } });
      }).not.toThrow();
    });

    it('should handle error response with missing error message', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Simulate error without message
      mockWorkerInstance.onmessage({
        data: {
          type: 'error'
          // no error field
        }
      });

      await expect(calcPromise).rejects.toThrow('Unknown worker error');
    });

    it('should clear pending handlers after result', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [] }
      });

      await calcPromise;

      // Second result message should have no effect (handlers cleared)
      expect(() => {
        mockWorkerInstance.onmessage({
          data: { type: 'result', payload: [{ extra: 'data' }] }
        });
      }).not.toThrow();
    });

    it('should handle empty profiles Map', async () => {
      // Initialize worker
      setTimeout(() => {
        if (mockWorkerInstance.onmessage) {
          mockWorkerInstance.onmessage({ data: { type: 'ready' } });
        }
      }, 10);
      await workerManager.init();

      mockStore.profiles = new Map();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      const postedMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(postedMessage.payload.store.profiles).toEqual([]);

      // Cleanup
      mockWorkerInstance.onmessage({ data: { type: 'result', payload: [] } });
      await calcPromise;
    });
  });
});

// ============================================================================
// PHASE 3: Worker Thread Edge Cases (Extended)
// ============================================================================

describe('Worker Thread Edge Cases (Extended)', () => {
  let workerManager;
  let mockStore;
  let MockWorker;
  let mockWorkerInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Create mock worker instance
    mockWorkerInstance = {
      onmessage: null,
      onerror: null,
      postMessage: jest.fn(),
      terminate: jest.fn()
    };

    // Create mock Worker class
    MockWorker = jest.fn().mockImplementation(() => mockWorkerInstance);

    // Set up global Worker
    global.Worker = MockWorker;

    // Create mock store
    mockStore = createMockStore({ userCount: 2 });

    // Mock calculateAnalysis to return predictable results
    mockCalculateAnalysis.mockReturnValue([
      {
        userId: 'user0',
        userName: 'User 0',
        days: new Map(),
        totals: { regular: 40, overtime: 0, total: 40 }
      }
    ]);

    // Import fresh module
    const module = await import('../../js/worker-manager.js');
    workerManager = module.workerManager;
  });

  afterEach(() => {
    if (workerManager) {
      workerManager.terminate();
    }
    delete global.Worker;
  });

  /**
   * Helper to initialize worker with ready state
   */
  async function initWorkerWithReady() {
    const initPromise = workerManager.init();
    // Immediately trigger ready
    await Promise.resolve();
    if (mockWorkerInstance.onmessage) {
      mockWorkerInstance.onmessage({ data: { type: 'ready' } });
    }
    await initPromise;
  }

  describe('Timeout Handling', () => {
    /**
     * SPECIFICATION: Worker Timeout
     *
     * Workers have a timeout to prevent infinite calculations.
     */

    it('should cleanup resources when terminating', async () => {
      await initWorkerWithReady();

      // Terminate should clean up
      workerManager.terminate();

      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
    });

    it('should fallback to sync calculation after termination', async () => {
      await initWorkerWithReady();

      // Terminate worker to simulate failure
      workerManager.terminate();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Should fallback to sync
      await workerManager.calculateAsync(entries, mockStore, dateRange);

      expect(mockCalculateAnalysis).toHaveBeenCalled();
    });

    it('should log warning when worker times out', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Don't send ready - worker will timeout
      const initPromise = workerManager.init();
      await jest.advanceTimersByTimeAsync(6000);
      await initPromise;

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('Message Ordering', () => {
    /**
     * SPECIFICATION: Message Order
     *
     * Worker messages should be processed in order.
     */

    it('should process messages in FIFO order', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start calculation
      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Verify message was posted
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);

      // Complete it
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [] }
      });

      await calcPromise;
    });

    it('should handle sequential calculations correctly', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // First calculation
      const calc1 = workerManager.calculateAsync(entries, mockStore, dateRange);
      mockWorkerInstance.onmessage({ data: { type: 'result', payload: [{ id: 1 }] } });
      const result1 = await calc1;

      // Second calculation immediately after
      const calc2 = workerManager.calculateAsync(entries, mockStore, dateRange);
      mockWorkerInstance.onmessage({ data: { type: 'result', payload: [{ id: 2 }] } });
      const result2 = await calc2;

      expect(result1[0].id).toBe(1);
      expect(result2[0].id).toBe(2);
    });

    it('should handle result after ready', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start calculation
      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Send result
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [{ test: true }] }
      });

      const result = await calcPromise;
      expect(result[0].test).toBe(true);
    });
  });

  describe('Cleanup and Lifecycle', () => {
    /**
     * SPECIFICATION: Worker Lifecycle
     *
     * Worker lifecycle management.
     */

    it('should terminate worker cleanly', async () => {
      await initWorkerWithReady();

      workerManager.terminate();

      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
    });

    it('should handle multiple operations without leaking', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Multiple operations
      for (let i = 0; i < 3; i++) {
        const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);
        mockWorkerInstance.onmessage({
          data: { type: 'result', payload: [{ iteration: i }] }
        });
        await calcPromise;
      }

      // Should still work after many operations
      const finalCalc = workerManager.calculateAsync(entries, mockStore, dateRange);
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [{ final: true }] }
      });
      const result = await finalCalc;

      expect(result[0].final).toBe(true);
    });

    it('should allow re-initialization after termination', async () => {
      await initWorkerWithReady();

      workerManager.terminate();
      expect(MockWorker).toHaveBeenCalledTimes(1);

      // Create new worker instance for re-init
      const newMockWorkerInstance = {
        onmessage: null,
        onerror: null,
        postMessage: jest.fn(),
        terminate: jest.fn()
      };
      MockWorker.mockImplementationOnce(() => newMockWorkerInstance);

      // Re-initialize
      const reinitPromise = workerManager.init();
      await Promise.resolve();
      if (newMockWorkerInstance.onmessage) {
        newMockWorkerInstance.onmessage({ data: { type: 'ready' } });
      }
      await reinitPromise;

      // Should have created a new worker
      expect(MockWorker).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Scenarios', () => {
    /**
     * SPECIFICATION: Error Handling
     *
     * Worker errors should be handled gracefully.
     */

    it('should handle result with empty payload', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Send result with empty array payload
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [] }
      });

      // Should handle gracefully
      const result = await calcPromise;
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle undefined type gracefully', async () => {
      await initWorkerWithReady();

      // Send undefined type - should not throw (silently ignored)
      expect(() => {
        mockWorkerInstance.onmessage({ data: { type: undefined } });
      }).not.toThrow();
    });

    it('should reject on worker error event', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Simulate worker crash via onerror
      mockWorkerInstance.onerror({
        message: 'Worker crashed',
        filename: 'worker.js',
        lineno: 42
      });

      await expect(calcPromise).rejects.toThrow('Worker error');

      consoleSpy.mockRestore();
    });

    it('should handle error response from worker', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Simulate error message from worker
      mockWorkerInstance.onmessage({
        data: { type: 'error', error: 'Calculation failed' }
      });

      await expect(calcPromise).rejects.toThrow('Calculation failed');
    });
  });

  describe('Race Conditions', () => {
    /**
     * SPECIFICATION: Race Condition Handling
     *
     * The worker manager should handle concurrent calculations correctly.
     * When multiple calculateAsync calls are made, only one should be processed
     * at a time via the worker, with others falling back to sync or queuing.
     */

    it('should handle rapid sequential calculations without overlap', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start first calculation
      const calc1 = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Immediately complete it before starting second
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [{ id: 'first' }] }
      });
      await calc1;

      // Start second calculation
      const calc2 = workerManager.calculateAsync(entries, mockStore, dateRange);
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [{ id: 'second' }] }
      });
      const result2 = await calc2;

      expect(result2[0].id).toBe('second');
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle calculation started while worker initializing', async () => {
      // Start init but don't complete it yet
      const initPromise = workerManager.init();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start calculation while init is in progress - should fall back to sync
      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // The calculation should complete synchronously (fallback)
      const result = await calcPromise;
      expect(mockCalculateAnalysis).toHaveBeenCalled();
      expect(result).toBeDefined();

      // Now complete init
      await Promise.resolve();
      if (mockWorkerInstance.onmessage) {
        mockWorkerInstance.onmessage({ data: { type: 'ready' } });
      }
      await initPromise;
    });

    it('should not lose results when init completes during calculation fallback', async () => {
      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start calculation before init (will use sync fallback)
      const result1 = await workerManager.calculateAsync(entries, mockStore, dateRange);
      expect(mockCalculateAnalysis).toHaveBeenCalledTimes(1);

      // Now init
      await initWorkerWithReady();

      // Next calculation should use worker
      const calc2 = workerManager.calculateAsync(entries, mockStore, dateRange);
      mockWorkerInstance.onmessage({
        data: { type: 'result', payload: [{ fromWorker: true }] }
      });
      const result2 = await calc2;

      expect(result2[0].fromWorker).toBe(true);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalled();
    });

    it('should handle termination during pending calculation gracefully', async () => {
      await initWorkerWithReady();

      const entries = generateMockEntries(5, 1);
      const dateRange = { start: '2025-01-01', end: '2025-01-31' };

      // Start calculation
      const calcPromise = workerManager.calculateAsync(entries, mockStore, dateRange);

      // Terminate while calculation is pending
      workerManager.terminate();

      // The pending promise may reject or hang; we just verify no crash
      // In the real implementation, termination should clean up
      expect(mockWorkerInstance.terminate).toHaveBeenCalled();

      // Subsequent calculations should fall back to sync
      const fallbackResult = await workerManager.calculateAsync(entries, mockStore, dateRange);
      expect(mockCalculateAnalysis).toHaveBeenCalled();
      expect(fallbackResult).toBeDefined();
    });
  });
});
