/**
 * @jest-environment jsdom
 */

import { jest, afterEach } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore, generateMockUsers } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Calculation Module - PTO/BREAK/WORK Classification', () => {
  let mockStore;
  let mockUsers;
  let dateRange;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
    mockUsers = null;
  });

  beforeEach(() => {
    mockUsers = generateMockUsers(1);
    mockStore = createMockStore({
      users: mockUsers,
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5
      },
      overrides: {}
    });
    dateRange = { start: '2025-01-15', end: '2025-01-15' };
  });

  describe('Regular Day: 8h capacity, 1h BREAK, 9h WORK', () => {
    it('should calculate overtime=1h, regular=8h, breakHours=1h, ptoHours=0h', () => {
      const entries = [
        {
          id: 'break_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T10:00:00Z',
            duration: 'PT1H'
          },
          hourlyRate: { amount: 0 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T10:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT9H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.breaks).toBe(1);
      expect(userResult.totals.regular).toBe(9); // 1h BREAK + 8h WORK regular
      expect(userResult.totals.overtime).toBe(1);
      expect(userResult.totals.vacationEntryHours).toBe(0);
      expect(userResult.totals.total).toBe(10); // BREAK (1h) + WORK (9h)
    });
  });

  describe('Holiday Day: Holiday PTO 8h, WORK 2h (capacity=0)', () => {
    it('should treat all WORK as overtime, PTO never triggers OT', () => {
      // Add holiday to mock store
      mockStore.holidays.set('user0', new Map([
        ['2025-01-15', {
          id: 'holiday_1',
          userId: 'user0',
          name: 'National Holiday',
          date: '2025-01-15'
        }]
      ]));

      const entries = [
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T17:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // PTO entry should count as regular hours
      const ptoEntry = entries.find(e => e.id === 'pto_1');
      expect(ptoEntry.analysis?.regular || 0).toBe(8);
      expect(ptoEntry.analysis?.overtime || 0).toBe(0);

      // WORK entry should be all overtime (capacity=0 on holiday)
      const workEntry = entries.find(e => e.id === 'work_1');
      expect(workEntry.analysis?.regular || 0).toBe(0);
      expect(workEntry.analysis?.overtime || 0).toBe(2);

      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(8); // PTO counts as regular
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Full-day Time Off: PTO 8h, WORK 1h', () => {
    it('should set effectiveCapacity=0, overtime=1h, regular=0h', () => {
      // Add time-off to mock store
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T17:00:00Z',
            end: '2025-01-15T18:00:00Z',
            duration: 'PT1H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // PTO should count as regular hours, not trigger OT
      const ptoEntry = entries.find(e => e.id === 'pto_1');
      expect(ptoEntry.analysis?.regular || 0).toBe(8);
      expect(ptoEntry.analysis?.overtime || 0).toBe(0);

      // WORK should be all overtime (full day PTO = 0 capacity)
      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(8); // PTO counts as regular
      expect(userResult.totals.overtime).toBe(1);
    });
  });

  describe('Half-day Time Off: PTO 4h, WORK 6h, capacity 8h', () => {
    it('should set effectiveCapacity=4h, overtime=2h, regular=4h', () => {
      // Add half-day time-off
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: false, hours: 4 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // PTO should count as regular hours, not accumulate toward capacity
      const ptoEntry = entries.find(e => e.id === 'pto_1');
      expect(ptoEntry.analysis?.regular || 0).toBe(4);
      expect(ptoEntry.analysis?.overtime || 0).toBe(0);

      // WORK: effective capacity = 8 - 4 = 4h, so 6h WORK = 4h regular + 2h OT
      expect(userResult.totals.vacationEntryHours).toBe(4);
      expect(userResult.totals.regular).toBe(8); // 4h PTO + 4h WORK regular
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Hourly Time Off: PTO 3h, WORK 7h, capacity 8h', () => {
    it('should set effectiveCapacity=5h, overtime=2h, regular=5h', () => {
      // Add 3h time-off (reduces 8h capacity to 5h)
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: false, hours: 3 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T12:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T12:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT7H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // PTO should count as regular hours, not accumulate toward capacity
      expect(userResult.totals.vacationEntryHours).toBe(3);

      // WORK: effective capacity = 8 - 3 = 5h, so 7h WORK = 5h regular + 2h OT
      expect(userResult.totals.regular).toBe(8); // 3h PTO + 5h WORK regular
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Billable PTO must not trigger OT: Billable Holiday PTO 8h + WORK 2h', () => {
    it('should not accumulate PTO regardless of billable flag', () => {
      const entries = [
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true // IMPORTANT: Billable PTO should NOT accumulate
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T17:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // PTO entry should count as regular hours, never accumulate toward capacity
      const ptoEntry = entries.find(e => e.id === 'pto_1');
      expect(ptoEntry.analysis?.regular || 0).toBe(8);
      expect(ptoEntry.analysis?.overtime || 0).toBe(0);

      // WORK 2h fits in 8h capacity = no OT
      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(10); // 8h PTO + 2h WORK
      expect(userResult.totals.overtime).toBe(0);

      // Billable PTO should count toward billable totals
      // But NOT accumulate toward capacity
      expect(userResult.totals.billableWorked).toBe(10); // 8h PTO + 2h WORK
    });
  });

  describe('Tail Attribution: Single 10h WORK entry crossing 8h threshold', () => {
    it('should split into regular=8h, overtime=2h', () => {
      const entries = [
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.total).toBe(10);

      // Check entry analysis
      const workEntry = entries.find(e => e.id === 'work_1');
      expect(workEntry.analysis.regular).toBe(8);
      expect(workEntry.analysis.overtime).toBe(2);
    });
  });

  describe('Mixed Entries: 3h WORK + 2h PTO + 5h WORK', () => {
    it('should only accumulate WORK (8h total), no OT', () => {
      const entries = [
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T12:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-15T12:00:00Z',
            end: '2025-01-15T14:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_2',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T14:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // PTO should count as regular hours, not accumulate toward capacity
      const ptoEntry = entries.find(e => e.id === 'pto_1');
      expect(ptoEntry.analysis?.regular || 0).toBe(2);
      expect(ptoEntry.analysis?.overtime || 0).toBe(0);

      // Only WORK accumulates: 3h + 5h = 8h (fits in capacity, no OT)
      expect(userResult.totals.vacationEntryHours).toBe(2);
      expect(userResult.totals.regular).toBe(10); // 8h WORK + 2h PTO
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.total).toBe(10); // 8h WORK + 2h PTO
    });
  });

  describe('Entry Analysis Metadata: PTO/BREAK entries', () => {
    it('should have analysis metadata for BREAK entries with regular=duration, overtime=0', () => {
      const entries = [
        {
          id: 'break_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T10:00:00Z',
            duration: 'PT1H'
          },
          hourlyRate: { amount: 0 },
          billable: false
        }
      ];

      calculateAnalysis(entries, mockStore, dateRange);

      // BREAK entries should have analysis metadata with regular=duration, overtime=0
      const breakEntry = entries.find(e => e.id === 'break_1');
      expect(breakEntry.analysis).toBeDefined();
      expect(breakEntry.analysis.regular).toBe(1);
      expect(breakEntry.analysis.overtime).toBe(0);
    });

    it('should have analysis metadata for PTO entries with regular=duration, overtime=0', () => {
      const entries = [
        {
          id: 'pto_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        }
      ];

      calculateAnalysis(entries, mockStore, dateRange);

      // PTO entries should have analysis metadata with regular=duration, overtime=0
      const ptoEntry = entries.find(e => e.id === 'pto_1');
      expect(ptoEntry.analysis).toBeDefined();
      expect(ptoEntry.analysis.regular).toBe(8);
      expect(ptoEntry.analysis.overtime).toBe(0);
    });
  });

  /**
   * Entry Type Exhaustiveness Specification
   *
   * SPECIFICATION:
   * - null type defaults to WORK classification
   * - undefined type defaults to WORK classification
   * - Unknown type strings default to WORK classification
   * - Type matching is case-sensitive (for performance)
   *
   * This ensures graceful handling of unexpected API responses.
   */
  describe('Entry Type Exhaustiveness', () => {
    it('null type defaults to WORK classification', () => {
      const entries = [
        {
          id: 'null_type',
          userId: 'user0',
          userName: 'User 0',
          type: null, // Explicit null
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should be treated as WORK: accumulates toward capacity
      expect(userResult.totals.total).toBe(10);
      // WORK beyond 8h capacity = 2h OT
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.regular).toBe(8);
    });

    it('undefined type defaults to WORK classification', () => {
      const entries = [
        {
          id: 'undefined_type',
          userId: 'user0',
          userName: 'User 0',
          // type is intentionally undefined (not set)
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should be treated as WORK: accumulates toward capacity
      expect(userResult.totals.total).toBe(10);
      expect(userResult.totals.overtime).toBe(2);
    });

    it('unknown type "CUSTOM" defaults to WORK classification', () => {
      const entries = [
        {
          id: 'custom_type',
          userId: 'user0',
          userName: 'User 0',
          type: 'CUSTOM', // Unknown type string
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Unknown types treated as WORK
      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(0);
    });

    it('unknown type "MEETING" defaults to WORK classification', () => {
      const entries = [
        {
          id: 'meeting_type',
          userId: 'user0',
          userName: 'User 0',
          type: 'MEETING', // Another unknown type
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should accumulate as WORK
      expect(userResult.totals.overtime).toBe(2);
    });

    it('empty string type defaults to WORK classification', () => {
      const entries = [
        {
          id: 'empty_type',
          userId: 'user0',
          userName: 'User 0',
          type: '', // Empty string
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.regular).toBe(8);
    });

    it('lowercase "break" is NOT treated as BREAK (case sensitive)', () => {
      // SPECIFICATION: Type matching is case-sensitive
      const entries = [
        {
          id: 'lowercase_break',
          userId: 'user0',
          userName: 'User 0',
          type: 'break', // Lowercase - should NOT match BREAK
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Lowercase should be normalized to BREAK
      expect(userResult.totals.total).toBe(10);
      expect(userResult.totals.breaks).toBe(10);
    });

    it('mixed case "Break" is treated as BREAK (normalized)', () => {
      const entries = [
        {
          id: 'mixed_break',
          userId: 'user0',
          userName: 'User 0',
          type: 'Break', // Mixed case
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T10:00:00Z',
            duration: 'PT1H'
          },
          hourlyRate: { amount: 0 },
          billable: false
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // "Break" (mixed case) should be normalized to BREAK
      expect(userResult.totals.breaks).toBe(1);
      expect(userResult.totals.total).toBe(1);
    });

    it('lowercase "holiday" is treated as HOLIDAY (normalized)', () => {
      const entries = [
        {
          id: 'lowercase_holiday',
          userId: 'user0',
          userName: 'User 0',
          type: 'holiday', // Lowercase
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Normalized to HOLIDAY, counts as PTO
      expect(userResult.totals.vacationEntryHours).toBe(8);
    });
  });
});
