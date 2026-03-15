/**
 * @jest-environment jsdom
 */

import { afterEach } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { generateMockUsers, generateMockHoliday, createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Calculation Module - calculateAnalysis', () => {
  let mockStore;
  let mockUsers;
  let dateRange;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
    mockUsers = null;
  });

  beforeEach(() => {
    mockUsers = generateMockUsers(3);
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
    dateRange = { start: '2025-01-01', end: '2025-01-31' };
  });

  describe('Basic Calculation', () => {
    it('should calculate totals for single entry within capacity', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'Alice Johnson',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      expect(results).toHaveLength(3); // All users
      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.billableWorked).toBe(8);
    });

    it('should calculate overtime for entry exceeding capacity', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(10);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.billableOT).toBe(2);
    });

    it('should handle multiple entries on same day', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T12:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T18:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(0);
    });

    it('should split overtime across entries', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
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
      expect(userResult.totals.total).toBe(9);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(1);
    });

    it('should handle duplicate entry IDs without collapsing overtime', () => {
      const entries = [
        {
          id: 'dup_entry',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T15:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'dup_entry',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T15:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(10);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Profile Capacity', () => {
    it('should use profile capacity when enabled', () => {
      mockStore.profiles.set('user0', {
        workCapacityHours: 7,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z', // Wednesday
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(7);
      expect(userResult.totals.overtime).toBe(1);
      // Expected capacity across date range (7 hours * working days in Jan)
      expect(userResult.totals.expectedCapacity).toBeGreaterThan(0);
    });

    it('should fall back to global threshold when profile not available', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(8); // Global threshold
      expect(userResult.totals.overtime).toBe(2);
    });

    it('should use user override over profile', () => {
      mockStore.overrides = {
        'user0': { capacity: 6 }
      };

      mockStore.profiles.set('user0', {
        workCapacityHours: 7,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(6); // Override takes precedence
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Working Days', () => {
    it('should treat non-working days as capacity 0', () => {
      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] // No weekends
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-18T09:00:00Z', // Saturday
          end: '2025-01-18T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
      // Capacity is calculated across ALL days in range, only Jan 18 (Sat) has 0 capacity
      // Jan 2025 has 23 working days (Mon-Fri) = 184 hours capacity
      expect(userResult.totals.expectedCapacity).toBe(184);
    });

    it('should respect working days from profile', () => {
      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'WEDNESDAY', 'FRIDAY'] // 3 days only
      });

      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z', // Wednesday
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-14T09:00:00Z', // Tuesday (not in working days)
            end: '2025-01-14T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.overtime).toBe(8); // Tuesday work is all overtime
    });
  });

  describe('Holidays', () => {
    it('should treat holidays as capacity 0', () => {
      const holiday = generateMockHoliday('user0', '2025-01-01', 'New Year');
      const holidayMap = new Map();
      holidayMap.set('2025-01-01', holiday);
      mockStore.holidays.set('user0', holidayMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-01T09:00:00Z', // Holiday
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
      // Capacity is calculated across ALL days, only Jan 1 has 0 capacity due to holiday
      // But Note: Jan 1, 2025 is a Wednesday (working day), so it has capacity
      // After holiday applied: 0 capacity for Jan 1
      // Total capacity = (23 working days - 1 holiday) * 8 = 176
      expect(userResult.totals.expectedCapacity).toBe(176);
      expect(userResult.totals.holidayCount).toBe(1);
    });

    it('should prioritize holidays over working days', () => {
      const holiday = generateMockHoliday('user0', '2025-01-15', 'Special Day');
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', holiday);
      mockStore.holidays.set('user0', holidayMap);

      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z', // Wednesday but also holiday
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0); // Holiday takes precedence
      expect(userResult.totals.overtime).toBe(8);
    });
  });

  describe('Time Off', () => {
    it('should reduce capacity for partial time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: false, hours: 4 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Effective capacity = 8 - 4 = 4
      expect(userResult.totals.regular).toBe(4);
      expect(userResult.totals.overtime).toBe(4);
      expect(userResult.totals.timeOffCount).toBe(1);
    });

    it('should set capacity to 0 for full day time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
    });
  });

  describe('Billable Breakdown', () => {
    it('should separate billable and non-billable hours', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T14:00:00Z',
            end: '2025-01-15T16:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(6);
      expect(userResult.totals.billableWorked).toBe(4);
      expect(userResult.totals.nonBillableWorked).toBe(2);
    });

    it('should split billable overtime correctly', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T18:00:00Z',
            end: '2025-01-15T20:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: false // Non-billable overtime
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.billableOT).toBe(0); // No billable overtime
      expect(userResult.totals.nonBillableOT).toBe(2); // All non-billable
    });
  });

  describe('Cost Calculation', () => {
    it('should calculate base amount and overtime premium', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour
        costRate: { amount: 3000 }, // $30/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Base cost: 10 hours * $50 = $500
      // OT Premium: 2 hours * $50 * (1.5 - 1) = $50
      // Total: $550
      expect(userResult.totals.amount).toBe(550);
      expect(userResult.totals.otPremium).toBe(50);
    });

    it('should use cost rate when amount display is cost', () => {
      mockStore.config.amountDisplay = 'cost';

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 4000 }, // $40/hour billable
        costRate: { amount: 2500 }, // $25/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(200);
      expect(userResult.totals.otPremium).toBe(0);
    });

    it('should not fall back to earned rate when cost rate is missing', () => {
      mockStore.config.amountDisplay = 'cost';

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T11:00:00Z',
          duration: 'PT2H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour earned
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(0);
      expect(userResult.totals.profit).toBe(100);
    });

    it('should calculate profit from earned minus cost', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour earned
        costRate: { amount: 3000 }, // $30/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.profit).toBe(220);
      const day = userResult.days.get('2025-01-15');
      expect(day.entries[0].analysis.profit).toBe(220);
    });

    it('should use profit amounts when amount display is profit', () => {
      mockStore.config.amountDisplay = 'profit';

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour earned
        costRate: { amount: 3000 }, // $30/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(160);
      expect(userResult.totals.amountEarned).toBe(400);
      expect(userResult.totals.amountCost).toBe(240);
      expect(userResult.totals.amountProfit).toBe(160);
      const day = userResult.days.get('2025-01-15');
      expect(day.entries[0].analysis.hourlyRate).toBe(20);
      expect(day.entries[0].analysis.totalAmountWithOT).toBe(160);
      expect(day.entries[0].analysis.amounts.earned.totalAmountWithOT).toBe(400);
      expect(day.entries[0].analysis.amounts.cost.totalAmountWithOT).toBe(240);
      expect(day.entries[0].analysis.amounts.profit.totalAmountWithOT).toBe(160);
    });

    it('should use earnedRate and costRate (cents) when provided', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T11:00:00Z',
          duration: 'PT2H'
        },
        earnedRate: 6000, // $60/hour in cents
        costRate: 2500, // $25/hour in cents
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(120);
      expect(userResult.totals.profit).toBe(70);
    });

    it('should derive earned rate from amounts when rates are missing', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T13:00:00Z',
          duration: 'PT4H'
        },
        amounts: [{ type: 'EARNED', amount: 200 }],
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(200);
      const day = userResult.days.get('2025-01-15');
      expect(day.entries[0].analysis.amounts.earned.rate).toBe(50);
      expect(day.entries[0].analysis.amounts.profit.totalAmountWithOT).toBe(200);
    });

    it('should use user override multiplier', () => {
      mockStore.overrides = {
        'user0': { multiplier: 2.0 }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Base cost: 10 hours * $50 = $500
      // OT Premium: 2 hours * $50 * (2.0 - 1) = $100
      // Total: $600
      expect(userResult.totals.amount).toBe(600);
      expect(userResult.totals.otPremium).toBe(100);
    });
  });

  describe('Users Without Entries', () => {
    it('should include users with no entries in results', () => {
      const entries = [];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      expect(results).toHaveLength(3); // All users included
      results.forEach(user => {
        expect(user.totals.total).toBe(0);
        expect(user.totals.expectedCapacity).toBeGreaterThan(0);
      });
    });

    it('should calculate expected capacity for users without entries', () => {
      const dateRange = { start: '2025-01-01', end: '2025-01-31' }; // 31 days

      const results = calculateAnalysis([], mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Expected capacity considers working days (Mon-Fri)
      // January 2025 has 23 working days (Mon-Fri)
      // 23 days * 8 hours = 184 hours
      expect(userResult.totals.expectedCapacity).toBe(184);
    });
  });

  describe('Multi-Day Time Off', () => {
    it('should handle multi-day time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.timeOffCount).toBe(1);
    });
  });

  describe('Per-Day Override Calculations', () => {
    let mockStore;
    let dateRange;

    beforeEach(() => {
      mockStore = {
        users: [{ id: 'user0', name: 'User 0' }],
        overrides: {},
        profiles: new Map(),
        holidays: new Map(),
        timeOff: new Map(),
        config: {
          useProfileCapacity: false,
          useProfileWorkingDays: false,
          applyHolidays: false,
          applyTimeOff: false
        },
        calcParams: {
          dailyThreshold: 8,
          overtimeMultiplier: 1.5
        }
      };

      dateRange = {
        start: '2025-01-15',
        end: '2025-01-15'
      };
    });

    it('should use per-day capacity override over global', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 8,  // Global fallback
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Specific day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T15:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use per-day capacity of 4, not global 8
      expect(dayData.meta.capacity).toBe(4);
      // 6 hours of work with 4 hour capacity = 4 regular + 2 OT
      expect(results[0].totals.regular).toBe(4);
      expect(results[0].totals.overtime).toBe(2);
    });

    it('should use per-day multiplier in OT calculations', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          multiplier: 1.5,  // Global fallback
          perDayOverrides: {
            '2025-01-15': { multiplier: 3.0 }  // Triple OT on this day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // 2 hours OT * $50 * 3.0 multiplier = $300 total
      // Premium = (3.0 - 1) * 2 * 50 = $200
      expect(results[0].totals.overtime).toBe(2);
      expect(results[0].totals.otPremium).toBe(200);
    });

    it('should fall back to global override when per-day not set', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 6,  // Global fallback
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Only one day specified
          }
        }
      };

      dateRange = {
        start: '2025-01-15',
        end: '2025-01-16'
      };

      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T15:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-16T09:00:00Z',
            end: '2025-01-16T15:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const day15 = results[0].days.get('2025-01-15');
      const day16 = results[0].days.get('2025-01-16');

      expect(day15.meta.capacity).toBe(4);  // Per-day override
      expect(day16.meta.capacity).toBe(6);  // Falls back to global
    });

    it('should use global mode when mode is not perDay', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'global',
          capacity: 7,
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Should be ignored in global mode
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use global capacity of 7, not per-day 4
      expect(dayData.meta.capacity).toBe(7);
      expect(results[0].totals.regular).toBe(7);
      expect(results[0].totals.overtime).toBe(1);
    });

    it('should handle missing mode as global by default', () => {
      mockStore.overrides = {
        'user0': {
          capacity: 7,
          // No mode field - should default to global behavior
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use global capacity of 7 (backward compatibility)
      expect(dayData.meta.capacity).toBe(7);
    });

    it('should combine per-day capacity and multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': {
              capacity: 6,
              multiplier: 2.0
            }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // 6 hour capacity, so 4 hours OT
      expect(results[0].totals.regular).toBe(6);
      expect(results[0].totals.overtime).toBe(4);
      // Premium = (2.0 - 1) * 4 * 50 = $200
      expect(results[0].totals.otPremium).toBe(200);
    });
  });

  /**
   * Override Mode Interaction Matrix Specification
   *
   * SPECIFICATION:
   * Tests various combinations of override modes and settings to ensure
   * the precedence rules are correctly applied:
   *
   * 1. Per-day capacity + weekly multiplier: multiplier applies
   * 2. Per-day multiplier + global capacity: capacity from global
   * 3. Per-day tier2Threshold + global tier2Multiplier
   * 4. Invalid/undefined override mode defaults to global
   * 5. Weekly override mode behavior
   *
   * @see docs/prd.md - Capacity Precedence section
   */
  describe('Override Mode Interaction Matrix', () => {
    let mockStore;
    let dateRange;

    beforeEach(() => {
      mockStore = {
        users: [{ id: 'user0', name: 'User 0' }],
        overrides: {},
        profiles: new Map(),
        holidays: new Map(),
        timeOff: new Map(),
        config: {
          useProfileCapacity: false,
          useProfileWorkingDays: false,
          applyHolidays: false,
          applyTimeOff: false,
          enableTieredOT: true
        },
        calcParams: {
          dailyThreshold: 8,
          overtimeMultiplier: 1.5,
          tier2ThresholdHours: 4,
          tier2Multiplier: 2.0
        }
      };

      dateRange = { start: '2025-01-15', end: '2025-01-15' };
    });

    it('per-day capacity + global multiplier: uses per-day capacity, global multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          multiplier: 2.0,  // Global multiplier
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Only capacity specified for day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T15:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // Should use per-day capacity of 4
      expect(results[0].totals.regular).toBe(4);
      expect(results[0].totals.overtime).toBe(2);
      // Should use global multiplier of 2.0 for OT premium
      // Premium = (2.0 - 1) * 2 * 50 = $100
      expect(results[0].totals.otPremium).toBe(100);
    });

    it('per-day multiplier + global capacity: uses global capacity, per-day multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 6,  // Global capacity
          perDayOverrides: {
            '2025-01-15': { multiplier: 3.0 }  // Only multiplier specified for day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // Should use global capacity of 6 (per-day doesn't override it)
      expect(results[0].totals.regular).toBe(6);
      expect(results[0].totals.overtime).toBe(2);
      // Should use per-day multiplier of 3.0
      // Premium = (3.0 - 1) * 2 * 50 = $200
      expect(results[0].totals.otPremium).toBe(200);
    });

    it('per-day tier2Threshold + global tier2Multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': {
              capacity: 4,
              tier2ThresholdHours: 2  // Lower threshold for more tier2 hours
            }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // 4h capacity, 6h OT
      expect(results[0].totals.overtime).toBe(6);
    });

    it('invalid mode value defaults to global behavior', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'invalidMode',  // Invalid mode
          capacity: 5,
          perDayOverrides: {
            '2025-01-15': { capacity: 3 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Invalid mode should fall back to global, using capacity 5
      expect(dayData.meta.capacity).toBe(5);
    });

    it('weekly override mode with weekday-specific capacity', () => {
      // 2025-01-15 is a Wednesday
      mockStore.overrides = {
        'user0': {
          mode: 'weekly',
          weeklyOverrides: {
            WEDNESDAY: { capacity: 6, multiplier: 2.0 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use weekly override for Wednesday
      expect(dayData.meta.capacity).toBe(6);
      expect(results[0].totals.overtime).toBe(2);
      // Premium with 2.0 multiplier
      expect(results[0].totals.otPremium).toBe(100);
    });

    it('weekly override falls back to global when weekday not specified', () => {
      // 2025-01-15 is a Wednesday, but we only define Monday
      mockStore.overrides = {
        'user0': {
          mode: 'weekly',
          capacity: 7,  // Global fallback
          weeklyOverrides: {
            MONDAY: { capacity: 6 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Wednesday not in weeklyOverrides, should fall back to global capacity 7
      expect(dayData.meta.capacity).toBe(7);
    });

    it('perDay mode takes precedence over weekly override', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          weeklyOverrides: {
            WEDNESDAY: { capacity: 5 }  // Should be ignored
          },
          perDayOverrides: {
            '2025-01-15': { capacity: 3 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // perDay mode should use perDayOverrides, not weeklyOverrides
      expect(dayData.meta.capacity).toBe(3);
      expect(results[0].totals.overtime).toBe(5);
    });

    it('zero capacity override makes all hours OT', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': { capacity: 0 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // All 8 hours should be OT
      expect(results[0].totals.regular).toBe(0);
      expect(results[0].totals.overtime).toBe(8);
    });

    it('multiplier of 1.0 results in zero OT premium', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': { capacity: 4, multiplier: 1.0 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T15:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      expect(results[0].totals.overtime).toBe(2);
      // Premium = (1.0 - 1) * 2 * 50 = $0
      expect(results[0].totals.otPremium).toBe(0);
    });
  });
});

// ============================================================================
// 5-LEVEL CAPACITY PRECEDENCE CASCADE TEST
// ============================================================================
// Verifies the full priority chain: per-day > weekly > global user > profile > default
// ============================================================================

describe('Capacity Precedence — Full 5-Level Cascade', () => {
  const dateRange = { start: '2025-01-13', end: '2025-01-17' };

  const makeEntry = (date, hours) => ({
    id: `entry_${date}`,
    userId: 'user0',
    userName: 'User 0',
    timeInterval: {
      start: `${date}T09:00:00Z`,
      end: `${date}T${String(9 + hours).padStart(2, '0')}:00:00Z`,
      duration: `PT${hours}H`
    },
    hourlyRate: { amount: 5000 },
    billable: true
  });

  it('each level correctly overrides the ones below it', () => {
    const store = {
      users: [{ id: 'user0', name: 'User 0' }],
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 10,        // Level 5: global default = 10h
        weeklyThreshold: 50,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 9999,
        tier2Multiplier: 2.0
      },
      profiles: new Map([
        ['user0', {
          userId: 'user0',
          workCapacity: 'PT7H',
          workCapacityHours: 7,      // Level 4: profile capacity = 7h
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          hourlyRate: { amount: 5000 }
        }]
      ]),
      overrides: {
        'user0': {
          mode: 'perDay',
          capacity: 6,               // Level 3: global user override = 6h
          perDayOverrides: {
            '2025-01-15': { capacity: 3 }   // Level 1: per-day override = 3h (Wednesday)
          }
          // Note: weeklyOverrides are ignored when mode='perDay' (see calc.ts:596)
        }
      },
      holidays: new Map(),
      timeOff: new Map(),
      apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 }
    };

    // 8h entry on each day
    const entries = [
      makeEntry('2025-01-13', 8),  // Mon — no per-day match → Level 3: global user = 6
      makeEntry('2025-01-14', 8),  // Tue — same → Level 3: global user = 6
      makeEntry('2025-01-15', 8),  // Wed — per-day override exists → Level 1: per-day = 3
      makeEntry('2025-01-16', 8),  // Thu — no per-day match → Level 3: global user = 6
      makeEntry('2025-01-17', 8),  // Fri — same → Level 3: global user = 6
    ];

    const results = calculateAnalysis(entries, store, dateRange);
    const user = results[0];

    // Level 1: per-day override (Wed Jan 15) — capacity 3
    const wed = user.days.get('2025-01-15');
    expect(wed.meta.capacity).toBe(3);

    // Level 3: global user override (Mon, Tue, Thu, Fri) — capacity 6
    const mon = user.days.get('2025-01-13');
    expect(mon.meta.capacity).toBe(6);
    const thu = user.days.get('2025-01-16');
    expect(thu.meta.capacity).toBe(6);

    // Verify totals reflect different capacities across days
    // 5 days × 8h = 40h total; capacities: 6+6+3+6+6 = 27 regular, 13 OT
    expect(user.totals.total).toBe(40);
    expect(user.totals.regular).toBe(27);
    expect(user.totals.overtime).toBe(13);
  });

  it('level 2 (weekly override) used in weekly mode', () => {
    const store = {
      users: [{ id: 'user0', name: 'User 0' }],
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 10,
        weeklyThreshold: 50,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 9999,
        tier2Multiplier: 2.0
      },
      profiles: new Map([
        ['user0', {
          userId: 'user0',
          workCapacity: 'PT7H',
          workCapacityHours: 7,
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          hourlyRate: { amount: 5000 }
        }]
      ]),
      overrides: {
        'user0': {
          mode: 'weekly',
          capacity: 6,               // Level 3: global user override = 6h
          weeklyOverrides: {
            'THURSDAY': { capacity: 5 }  // Level 2: weekly override = 5h
          }
        }
      },
      holidays: new Map(),
      timeOff: new Map(),
      apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 }
    };

    const entries = [
      makeEntry('2025-01-13', 8),  // Mon — no weekly match → Level 3: global user = 6
      makeEntry('2025-01-16', 8),  // Thu — weekly match → Level 2: weekly = 5
    ];

    const results = calculateAnalysis(entries, store, dateRange);
    const user = results[0];

    // Level 2: weekly override for Thursday — capacity 5
    const thu = user.days.get('2025-01-16');
    expect(thu.meta.capacity).toBe(5);

    // Level 3: global user override for Monday — capacity 6
    const mon = user.days.get('2025-01-13');
    expect(mon.meta.capacity).toBe(6);

    // Totals: 16h total; capacities: 6+5 = 11 regular, 5 OT
    expect(user.totals.total).toBe(16);
    expect(user.totals.regular).toBe(11);
    expect(user.totals.overtime).toBe(5);
  });

  it('level 4 (profile) used when no overrides exist', () => {
    const store = {
      users: [{ id: 'user0', name: 'User 0' }],
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 10,        // Level 5: global default = 10h
        weeklyThreshold: 50,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 9999,
        tier2Multiplier: 2.0
      },
      profiles: new Map([
        ['user0', {
          userId: 'user0',
          workCapacity: 'PT7H',
          workCapacityHours: 7,      // Level 4: profile = 7h
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          hourlyRate: { amount: 5000 }
        }]
      ]),
      overrides: {},                 // No overrides — levels 1-3 skipped
      holidays: new Map(),
      timeOff: new Map(),
      apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 }
    };

    const entries = [makeEntry('2025-01-15', 8)];
    const results = calculateAnalysis(entries, store, dateRange);
    const day = results[0].days.get('2025-01-15');

    // Profile capacity = 7, so 8h → 7 regular + 1 OT
    expect(day.meta.capacity).toBe(7);
    const user = results[0];
    expect(user.totals.regular).toBe(7);
    expect(user.totals.overtime).toBe(1);
  });

  it('level 5 (global default) used when no overrides and profile disabled', () => {
    const store = {
      users: [{ id: 'user0', name: 'User 0' }],
      config: {
        useProfileCapacity: false,   // Profile disabled
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 10,        // Level 5: global default = 10h
        weeklyThreshold: 50,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 9999,
        tier2Multiplier: 2.0
      },
      profiles: new Map([
        ['user0', {
          userId: 'user0',
          workCapacity: 'PT7H',
          workCapacityHours: 7,
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
          hourlyRate: { amount: 5000 }
        }]
      ]),
      overrides: {},
      holidays: new Map(),
      timeOff: new Map(),
      apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 }
    };

    const entries = [makeEntry('2025-01-15', 8)];
    const results = calculateAnalysis(entries, store, dateRange);
    const day = results[0].days.get('2025-01-15');

    // Global default = 10, so 8h → all regular, no OT
    expect(day.meta.capacity).toBe(10);
    const user = results[0];
    expect(user.totals.regular).toBe(8);
    expect(user.totals.overtime).toBe(0);
  });
});

// ============================================================================
// LARGE DATE RANGE TESTS
// ============================================================================
// These tests verify behavior with date ranges exceeding 365 days, which
// may trigger performance warnings and test the calculation engine at scale.
// ============================================================================

describe('Large Date Range Calculations', () => {
  let mockStore;

  beforeEach(() => {
    mockStore = {
      users: [{ id: 'user0', name: 'User 0' }],
      overrides: {},
      profiles: new Map(),
      holidays: new Map(),
      timeOff: new Map(),
      config: {
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 0,
        tier2Multiplier: 1.5
      }
    };
  });

  it('should handle date ranges exceeding 365 days', () => {
    /**
     * SPECIFICATION: Large Date Range Support
     * The calculation engine should handle date ranges > 365 days without
     * errors, correctly generating day maps for all days in range.
     */
    // 400-day range
    const dateRange = { start: '2024-01-01', end: '2025-02-04' };

    // Single entry in the middle of the range
    const entries = [{
      id: 'entry_1',
      userId: 'user0',
      userName: 'User 0',
      timeInterval: {
        start: '2024-06-15T09:00:00Z',
        end: '2024-06-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const results = calculateAnalysis(entries, mockStore, dateRange);

    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe('user0');
    expect(results[0].totals.total).toBe(8);
    expect(results[0].totals.overtime).toBe(0);
    // Days map should be populated (may only have the one entry day)
    expect(results[0].days).toBeInstanceOf(Map);
  });

  it('should handle 730+ day ranges (over 2 years)', () => {
    /**
     * SPECIFICATION: Very Large Date Range Support
     * Date ranges > 730 days may trigger additional warnings in the UI
     * but should still calculate correctly.
     */
    // 750-day range (over 2 years)
    const dateRange = { start: '2023-01-01', end: '2025-01-20' };

    const entries = [
      // Entry in year 1
      {
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2023-06-15T09:00:00Z',
          end: '2023-06-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      // Entry in year 2
      {
        id: 'entry_2',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2024-06-15T09:00:00Z',
          end: '2024-06-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    const results = calculateAnalysis(entries, mockStore, dateRange);

    expect(results).toHaveLength(1);
    expect(results[0].totals.total).toBe(18);
    // Second day has 2h OT (10-8)
    expect(results[0].totals.overtime).toBe(2);
  });

  it('should correctly calculate expected capacity for large ranges with no entries', () => {
    /**
     * SPECIFICATION: Expected Capacity for Large Ranges
     * Even with no entries, expected capacity should be calculated
     * for all working days in the range.
     */
    // 400-day range (roughly 13 months)
    const dateRange = { start: '2024-01-01', end: '2025-02-04' };

    const results = calculateAnalysis([], mockStore, dateRange);

    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe('user0');
    expect(results[0].totals.total).toBe(0);
    // Should have significant expected capacity (working days * 8h)
    expect(results[0].totals.expectedCapacity).toBeGreaterThan(2000); // ~260 working days * 8h
  });
});

// ============================================================================
// COR-2: Weekly sort determinism — entries with identical start times
// ============================================================================
describe('Weekly sort determinism (COR-2)', () => {
  let mockStore;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  it('produces deterministic weekly OT attribution for entries with identical start times', () => {
    const users = generateMockUsers(1);
    mockStore = createMockStore({
      users,
      config: { overtimeBasis: 'weekly' },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 8, // Low threshold so OT triggers
        overtimeMultiplier: 1.5
      }
    });

    // Two entries with identical start times but different IDs
    const entries = [
      {
        id: 'entry_B', // Alphabetically second
        userId: 'user0',
        userName: 'Alice Johnson',
        timeInterval: {
          start: '2025-01-06T09:00:00Z',
          end: '2025-01-06T14:00:00Z',
          duration: 'PT5H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      {
        id: 'entry_A', // Alphabetically first
        userId: 'user0',
        userName: 'Alice Johnson',
        timeInterval: {
          start: '2025-01-06T09:00:00Z', // Same start time as entry_B
          end: '2025-01-06T14:00:00Z',
          duration: 'PT5H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }
    ];

    const dateRange = { start: '2025-01-06', end: '2025-01-06' };

    // Run calculation multiple times — results must be identical
    const results1 = calculateAnalysis(entries, mockStore, dateRange);
    const results2 = calculateAnalysis(entries, mockStore, dateRange);
    const results3 = calculateAnalysis([...entries].reverse(), mockStore, dateRange);

    // All runs should produce the same OT attribution
    const days1 = Array.from(results1[0].days.values());
    const days2 = Array.from(results2[0].days.values());
    const days3 = Array.from(results3[0].days.values());

    // entry_A (alphabetically first) should always be processed first
    const entriesRun1 = days1[0].entries;
    const entriesRun2 = days2[0].entries;
    const entriesRun3 = days3[0].entries;

    expect(entriesRun1[0].id).toBe(entriesRun2[0].id);
    expect(entriesRun1[1].id).toBe(entriesRun2[1].id);
    expect(entriesRun1[0].id).toBe(entriesRun3[0].id);
    expect(entriesRun1[1].id).toBe(entriesRun3[1].id);

    // OT values must match across runs
    expect(entriesRun1[0].analysis.overtime).toBe(entriesRun2[0].analysis.overtime);
    expect(entriesRun1[1].analysis.overtime).toBe(entriesRun2[1].analysis.overtime);
    expect(entriesRun1[0].analysis.overtime).toBe(entriesRun3[0].analysis.overtime);
    expect(entriesRun1[1].analysis.overtime).toBe(entriesRun3[1].analysis.overtime);
  });
});

// ============================================================================
// COR-3: Entry mutation — calculateAnalysis must not mutate input entries
// ============================================================================
describe('Entry immutability (COR-3)', () => {
  let mockStore;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  it('does not mutate input entry objects with analysis property', () => {
    const users = generateMockUsers(1);
    mockStore = createMockStore({
      users,
      config: { overtimeBasis: 'daily' },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5
      }
    });

    const entries = [
      {
        id: 'entry_1',
        userId: 'user0',
        userName: 'Alice Johnson',
        timeInterval: {
          start: '2025-01-06T09:00:00Z',
          end: '2025-01-06T18:00:00Z',
          duration: 'PT9H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      {
        id: 'entry_2',
        userId: 'user0',
        userName: 'Alice Johnson',
        timeInterval: {
          start: '2025-01-07T09:00:00Z',
          end: '2025-01-07T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      }
    ];

    const dateRange = { start: '2025-01-06', end: '2025-01-07' };

    // Snapshot: input entries should NOT have analysis before call
    expect(entries[0]).not.toHaveProperty('analysis');
    expect(entries[1]).not.toHaveProperty('analysis');

    const results = calculateAnalysis(entries, mockStore, dateRange);

    // After calculation: input entries still must NOT have analysis
    expect(entries[0]).not.toHaveProperty('analysis');
    expect(entries[1]).not.toHaveProperty('analysis');

    // But the returned results' entries SHOULD have analysis
    const day1Entries = Array.from(results[0].days.values())[0].entries;
    expect(day1Entries[0]).toHaveProperty('analysis');
    expect(day1Entries[0].analysis.overtime).toBeGreaterThan(0); // 9h - 8h = 1h OT
  });
});

// ============================================================================
// MUTATION TESTING - NaN Checks and Edge Cases (B2, B3, B4, B5, B6, B7)
// ============================================================================
// These tests are specifically designed to kill surviving mutants in calc.ts
// by testing edge cases around NaN handling, boundary conditions, and
// mutation-prone comparison operators.
// ============================================================================
