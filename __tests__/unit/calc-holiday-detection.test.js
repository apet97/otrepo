/**
 * @jest-environment jsdom
 */

import { jest, afterEach } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore, generateMockUsers } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Calculation Module - PTO entries are informational only', () => {
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
        applyHolidays: false, // Disabled API-based holidays for fallback testing
        applyTimeOff: false,  // Disabled API-based time-off for fallback testing
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
    dateRange = { start: '2025-01-20', end: '2025-01-20' };
  });

  describe('HOLIDAY entry type (PTO)', () => {
    it('should count HOLIDAY entry as regular time without reducing capacity', () => {
      const entries = [
        {
          id: 'holiday_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
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
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Holiday entry counts as regular hours, not OT
      expect(userResult.totals.vacationEntryHours).toBe(8);

      // Capacity remains 8h; WORK stays regular
      expect(userResult.totals.regular).toBe(10); // 8h holiday + 2h work
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.total).toBe(10);
    });

    it('should handle multiple WORK entries with HOLIDAY PTO (no capacity reduction)', () => {
      const entries = [
        {
          id: 'holiday_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
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
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T11:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'work_2',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T11:00:00Z',
            end: '2025-01-20T16:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(16); // 8h holiday + 8h work
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.total).toBe(16);
    });
  });

  describe('TIME_OFF entry type (PTO)', () => {
    it('should count TIME_OFF entry as regular time without reducing capacity', () => {
      const entries = [
        {
          id: 'timeoff_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
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
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T18:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Time-off entry counts as regular hours
      expect(userResult.totals.vacationEntryHours).toBe(4);

      // Capacity remains 8h; WORK stays regular
      expect(userResult.totals.regular).toBe(10); // 4h time-off + 6h work
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.total).toBe(10);
    });

    it('should handle full-day TIME_OFF PTO without reducing capacity', () => {
      const entries = [
        {
          id: 'timeoff_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
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
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(10); // 8h time-off + 2h work
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.total).toBe(10);
    });
  });

  describe('API holiday applies even when holiday entries exist', () => {
    it('should use API holiday name and capacity rules', () => {
      // Enable API-based holidays
      mockStore.config.applyHolidays = true;

      // Add holiday to API map
      mockStore.holidays.set('user0', new Map([
        ['2025-01-20', {
          id: 'holiday_api',
          userId: 'user0',
          name: 'National Day (API)',
          date: '2025-01-20'
        }]
      ]));

      const entries = [
        {
          id: 'holiday_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
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
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // API holiday forces capacity=0 regardless of entry types
      expect(userResult.totals.overtime).toBe(2); // All WORK is OT

      // Verify day meta contains API holiday info
      const dayMeta = userResult.days.get('2025-01-20').meta;
      expect(dayMeta.isHoliday).toBe(true);
      expect(dayMeta.holidayName).toBe('National Day (API)'); // Not "detected from entry"
    });
  });

  describe('API time-off applies even when time-off entries exist', () => {
    it('should use API time-off data for capacity reduction', () => {
      // Enable API-based time-off
      mockStore.config.applyTimeOff = true;

      // Add time-off to API map (6h from API)
      mockStore.timeOff.set('user0', new Map([
        ['2025-01-20', {
          id: 'timeoff_api',
          userId: 'user0',
          hours: 6,
          isFullDay: false
        }]
      ]));

      const entries = [
        {
          id: 'timeoff_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'PT4H' // Entry says 4h
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
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T16:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // API says 6h time-off, so capacity = 8 - 6 = 2h
      // WORK: 4h → 2h regular, 2h OT (using API capacity reduction)
      expect(userResult.totals.regular).toBe(6); // 4h time-off entry + 2h work
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Entry types do not set day context', () => {
    it('should NOT mark holiday day from entries when API has no data', () => {
      // Enable API but provide empty maps (simulating no holiday on this day)
      mockStore.config.applyHolidays = true;
      mockStore.holidays.set('user0', new Map()); // Empty map

      const entries = [
        {
          id: 'holiday_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
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
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // HOLIDAY entry counts as PTO only; day meta remains regular
      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(10); // 8h holiday + 2h work
      expect(userResult.totals.overtime).toBe(0);

      const dayMeta = userResult.days.get('2025-01-20').meta;
      expect(dayMeta.isHoliday).toBe(false); // No API data, so not treated as holiday
    });
  });

  describe('Edge cases', () => {
    it('should handle day with no entries gracefully', () => {
      const entries = [];
      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.vacationEntryHours).toBe(0);
    });

    it('should handle malformed TIME_OFF duration', () => {
      const entries = [
        {
          id: 'timeoff_bad',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'INVALID' // Bad duration
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
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T20:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // TIME_OFF entry still counts as PTO even with malformed duration
      // WORK: 8h regular (capacity not reduced)
      expect(userResult.totals.vacationEntryHours).toBe(4); // Entry still processed
      expect(userResult.totals.regular).toBe(12); // 4h + 8h
      expect(userResult.totals.overtime).toBe(0); // No capacity reduction, no OT
    });

    it('should handle BREAK and TIME_OFF on same day', () => {
      const entries = [
        {
          id: 'timeoff_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'break_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T13:00:00Z',
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
            start: '2025-01-20T13:00:00Z',
            end: '2025-01-20T18:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // TIME_OFF + BREAK are regular, capacity unchanged
      // WORK: 5h regular
      expect(userResult.totals.vacationEntryHours).toBe(4);
      expect(userResult.totals.breaks).toBe(1);
      expect(userResult.totals.regular).toBe(10); // 4 + 1 + 5
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.total).toBe(10);
    });
  });
});
