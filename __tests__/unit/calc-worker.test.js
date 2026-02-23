/**
 * @jest-environment node
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// Mock the calc module before importing the worker
const mockCalculateAnalysis = jest.fn();

jest.unstable_mockModule('../../js/calc.js', () => ({
  calculateAnalysis: mockCalculateAnalysis
}));

describe('Calculation Web Worker (calc.worker.ts)', () => {
  let mockPostMessage;
  let originalSelf;
  let workerOnMessage;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Save original self
    originalSelf = global.self;

    // Create mock postMessage (Web Worker postMessage only needs 1 arg)
    mockPostMessage = jest.fn();

    // Set up mock worker context with onmessage capture
    let onmessageHandler = null;
    const workerContext = {
      postMessage: mockPostMessage,
      get onmessage() {
        return onmessageHandler;
      },
      set onmessage(handler) {
        onmessageHandler = handler;
        workerOnMessage = handler;
      }
    };
    global.self = workerContext;
  });

  afterEach(() => {
    standardAfterEach();
    global.self = originalSelf;
    workerOnMessage = null;
  });

  describe('Worker Initialization', () => {
    it('should post ready message on initialization', async () => {
      // Import the worker module (this triggers initialization)
      await import('../../js/calc.worker.js');

      // Verify ready message was posted
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'ready' });
    });

    it('should set up onmessage handler', async () => {
      await import('../../js/calc.worker.js');

      // Verify onmessage handler was set
      expect(workerOnMessage).toBeInstanceOf(Function);
    });
  });

  describe('Message Type Handling', () => {
    beforeEach(async () => {
      await import('../../js/calc.worker.js');
      mockPostMessage.mockClear();
    });

    it('should reject unknown message types with error', () => {
      const unknownMessage = {
        data: {
          type: 'unknown_type',
          payload: {}
        }
      };

      workerOnMessage(unknownMessage);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'Unknown message type: unknown_type'
      });
    });

    it('should reject message with undefined type', () => {
      const undefinedTypeMessage = {
        data: {
          type: undefined,
          payload: {}
        }
      };

      workerOnMessage(undefinedTypeMessage);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'Unknown message type: undefined'
      });
    });

    it('should reject empty string message type', () => {
      const emptyTypeMessage = {
        data: {
          type: '',
          payload: {}
        }
      };

      workerOnMessage(emptyTypeMessage);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'Unknown message type: '
      });
    });
  });

  describe('Calculate Message Processing', () => {
    const createValidPayload = () => ({
      entries: [
        {
          id: 'entry1',
          userId: 'user0',
          userName: 'Test User',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ],
      dateRange: { start: '2025-01-01', end: '2025-01-31' },
      store: {
        users: [{ id: 'user0', name: 'Test User' }],
        profiles: [['user0', { workCapacityHours: 8, workingDays: ['MONDAY'] }]],
        holidays: [['user0', [['2025-01-01', { name: 'New Year' }]]]],
        timeOff: [['user0', []]],
        overrides: {},
        config: { useProfileCapacity: true },
        calcParams: { dailyThreshold: 8 }
      }
    });

    beforeEach(async () => {
      await import('../../js/calc.worker.js');
      mockPostMessage.mockClear();
    });

    it('should reconstruct profiles Map from serialized arrays', () => {
      const payload = createValidPayload();

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        userName: 'Test User',
        days: new Map(),
        totals: { regular: 8, overtime: 0, total: 8 }
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      // Verify calculateAnalysis was called
      expect(mockCalculateAnalysis).toHaveBeenCalled();

      // Get the store argument passed to calculateAnalysis
      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      // Verify profiles is a Map with correct entries
      expect(storeArg.profiles).toBeInstanceOf(Map);
      expect(storeArg.profiles.get('user0')).toEqual({
        workCapacityHours: 8,
        workingDays: ['MONDAY']
      });
    });

    it('should reconstruct nested holidays Map from serialized arrays', () => {
      const payload = createValidPayload();

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      // Verify holidays is a nested Map structure
      expect(storeArg.holidays).toBeInstanceOf(Map);
      expect(storeArg.holidays.get('user0')).toBeInstanceOf(Map);
      expect(storeArg.holidays.get('user0').get('2025-01-01')).toEqual({ name: 'New Year' });
    });

    it('should reconstruct nested timeOff Map from serialized arrays', () => {
      const payload = createValidPayload();
      payload.store.timeOff = [['user0', [['2025-01-15', { hours: 4, isFullDay: false }]]]];

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      // Verify timeOff is a nested Map structure
      expect(storeArg.timeOff).toBeInstanceOf(Map);
      expect(storeArg.timeOff.get('user0')).toBeInstanceOf(Map);
      expect(storeArg.timeOff.get('user0').get('2025-01-15')).toEqual({ hours: 4, isFullDay: false });
    });

    it('should pass entries to calculateAnalysis unchanged', () => {
      const payload = createValidPayload();

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [entriesArg] = mockCalculateAnalysis.mock.calls[0];

      // Verify entries are passed through
      expect(entriesArg).toEqual(payload.entries);
      expect(entriesArg[0].id).toBe('entry1');
    });

    it('should pass dateRange to calculateAnalysis', () => {
      const payload = createValidPayload();

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, , dateRangeArg] = mockCalculateAnalysis.mock.calls[0];

      expect(dateRangeArg).toEqual({ start: '2025-01-01', end: '2025-01-31' });
    });

    it('should pass overrides to store object', () => {
      const payload = createValidPayload();
      payload.store.overrides = {
        user0: { mode: 'global', capacity: '6' }
      };

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      expect(storeArg.overrides).toEqual({
        user0: { mode: 'global', capacity: '6' }
      });
    });

    it('should pass config to store object', () => {
      const payload = createValidPayload();

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      expect(storeArg.config).toEqual({ useProfileCapacity: true });
    });

    it('should pass calcParams to store object', () => {
      const payload = createValidPayload();

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      expect(storeArg.calcParams).toEqual({ dailyThreshold: 8 });
    });
  });

  describe('Result Serialization', () => {
    beforeEach(async () => {
      await import('../../js/calc.worker.js');
      mockPostMessage.mockClear();
    });

    it('should serialize days Map to array in result', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      // Mock result with a Map
      const daysMap = new Map([
        ['2025-01-15', { entries: [], meta: { capacity: 8 } }],
        ['2025-01-16', { entries: [], meta: { capacity: 8 } }]
      ]);

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        userName: 'Test User',
        days: daysMap,
        totals: { regular: 16, overtime: 0, total: 16 }
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      // Verify result message structure
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'result',
        payload: [{
          userId: 'user0',
          userName: 'Test User',
          days: [
            ['2025-01-15', { entries: [], meta: { capacity: 8 } }],
            ['2025-01-16', { entries: [], meta: { capacity: 8 } }]
          ],
          totals: { regular: 16, overtime: 0, total: 16 }
        }]
      });
    });

    it('should handle empty days Map', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockReturnValue([{
        userId: 'user0',
        days: new Map(),
        totals: {}
      }]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'result',
        payload: [{
          userId: 'user0',
          days: [],
          totals: {}
        }]
      });
    });

    it('should handle multiple users in result', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockReturnValue([
        { userId: 'user0', days: new Map(), totals: { total: 40 } },
        { userId: 'user1', days: new Map(), totals: { total: 45 } }
      ]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const resultPayload = mockPostMessage.mock.calls[0][0].payload;
      expect(resultPayload).toHaveLength(2);
      expect(resultPayload[0].userId).toBe('user0');
      expect(resultPayload[1].userId).toBe('user1');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await import('../../js/calc.worker.js');
      mockPostMessage.mockClear();
    });

    it('should post error message when calculateAnalysis throws Error', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockImplementation(() => {
        throw new Error('Calculation failed: invalid entry');
      });

      workerOnMessage({ data: { type: 'calculate', payload } });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'Calculation failed: invalid entry'
      });
    });

    it('should handle non-Error throws by converting to string', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockImplementation(() => {
        throw 'String error thrown';
      });

      workerOnMessage({ data: { type: 'calculate', payload } });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'String error thrown'
      });
    });

    it('should handle null thrown as error', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockImplementation(() => {
        throw null;
      });

      workerOnMessage({ data: { type: 'calculate', payload } });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'null'
      });
    });

    it('should handle undefined thrown as error', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockImplementation(() => {
        throw undefined;
      });

      workerOnMessage({ data: { type: 'calculate', payload } });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'undefined'
      });
    });

    it('should handle object thrown as error', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockImplementation(() => {
        throw { code: 'ERR_INVALID', details: 'some details' };
      });

      workerOnMessage({ data: { type: 'calculate', payload } });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'error',
        error: '[object Object]'
      });
    });
  });

  describe('Store Object Construction', () => {
    beforeEach(async () => {
      await import('../../js/calc.worker.js');
      mockPostMessage.mockClear();
    });

    it('should preserve users array in store object', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [
            { id: 'user0', name: 'Alice' },
            { id: 'user1', name: 'Bob' }
          ],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockReturnValue([]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];
      expect(storeArg.users).toEqual([
        { id: 'user0', name: 'Alice' },
        { id: 'user1', name: 'Bob' }
      ]);
    });

    it('should handle empty profiles array', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockReturnValue([]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];
      expect(storeArg.profiles).toBeInstanceOf(Map);
      expect(storeArg.profiles.size).toBe(0);
    });

    it('should handle empty holidays array', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockReturnValue([]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];
      expect(storeArg.holidays).toBeInstanceOf(Map);
      expect(storeArg.holidays.size).toBe(0);
    });

    it('should handle complex nested holiday structure', () => {
      const payload = {
        entries: [],
        dateRange: { start: '2025-01-01', end: '2025-01-31' },
        store: {
          users: [],
          profiles: [],
          holidays: [
            ['user0', [
              ['2025-01-01', { name: 'New Year', projectId: 'proj1' }],
              ['2025-12-25', { name: 'Christmas', projectId: 'proj2' }]
            ]],
            ['user1', [
              ['2025-07-04', { name: 'Independence Day' }]
            ]]
          ],
          timeOff: [],
          overrides: {},
          config: {},
          calcParams: {}
        }
      };

      mockCalculateAnalysis.mockReturnValue([]);

      workerOnMessage({ data: { type: 'calculate', payload } });

      const [, storeArg] = mockCalculateAnalysis.mock.calls[0];

      expect(storeArg.holidays.size).toBe(2);
      expect(storeArg.holidays.get('user0').size).toBe(2);
      expect(storeArg.holidays.get('user0').get('2025-01-01').name).toBe('New Year');
      expect(storeArg.holidays.get('user0').get('2025-12-25').name).toBe('Christmas');
      expect(storeArg.holidays.get('user1').get('2025-07-04').name).toBe('Independence Day');
    });
  });
});
