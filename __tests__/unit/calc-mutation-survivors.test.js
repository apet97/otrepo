/**
 * @jest-environment jsdom
 *
 * Targeted mutation-killing tests for calc.ts survivors (17:12:13 report).
 */

import { afterEach, describe, it, expect } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

afterEach(() => {
  standardAfterEach();
});

const BASE_CONFIG = {
  useProfileCapacity: false,
  useProfileWorkingDays: false,
  applyHolidays: false,
  applyTimeOff: false,
  showBillableBreakdown: true,
  enableTieredOT: false,
  overtimeBasis: 'daily'
};

const BASE_PARAMS = {
  dailyThreshold: 8,
  weeklyThreshold: 40,
  overtimeMultiplier: 1.5,
  tier2ThresholdHours: 4,
  tier2Multiplier: 2.0
};

function createStore(options = {}) {
  return createMockStore({
    userCount: 1,
    config: { ...BASE_CONFIG, ...(options.config || {}) },
    calcParams: { ...BASE_PARAMS, ...(options.calcParams || {}) },
    overrides: options.overrides || {},
    timeOff: options.timeOff || new Map(),
    holidays: options.holidays || new Map()
  });
}

function createEntry(overrides = {}) {
  const hasDuration = Object.prototype.hasOwnProperty.call(overrides, 'duration');
  return {
    id: overrides.id || 'entry1',
    userId: overrides.userId || 'user0',
    userName: overrides.userName || 'User 0',
    billable: overrides.billable !== undefined ? overrides.billable : true,
    type: overrides.type || 'REGULAR',
    hourlyRate: overrides.hourlyRate || { amount: 10000 },
    timeInterval: {
      start: overrides.start || '2025-01-15T09:00:00Z',
      end: overrides.end || '2025-01-15T17:00:00Z',
      duration: hasDuration ? overrides.duration : 'PT8H'
    }
  };
}

describe('Calc mutation survivors', () => {
  it('keeps valid totals when an entry has an invalid end timestamp', () => {
    const store = createStore();
    const entries = [
      createEntry({
        id: 'valid',
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      }),
      createEntry({
        id: 'invalid',
        start: '2025-01-15T18:00:00Z',
        end: 'invalid-date',
        duration: null
      })
    ];

    const results = calculateAnalysis(entries, store, {
      start: '2025-01-15',
      end: '2025-01-15'
    });

    const totals = results[0].totals;
    expect(totals.total).toBe(8);
    expect(totals.regular).toBe(8);
    expect(totals.overtime).toBe(0);
  });

  it('falls back to global override when per-day capacity is invalid', () => {
    const store = createStore({
      overrides: {
        user0: {
          mode: 'perDay',
          capacity: 6,
          perDayOverrides: {
            '2025-01-15': { capacity: 'not-a-number' }
          }
        }
      }
    });

    const results = calculateAnalysis(
      [
        createEntry({
          id: 'work',
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        })
      ],
      store,
      { start: '2025-01-15', end: '2025-01-15' }
    );

    const totals = results[0].totals;
    expect(totals.regular).toBe(6);
    expect(totals.overtime).toBe(2);
  });

  it('does not report weekly overtime when overtimeBasis is daily', () => {
    const store = createStore({
      config: { overtimeBasis: 'daily' }
    });

    const days = ['2025-01-13', '2025-01-14', '2025-01-15', '2025-01-16', '2025-01-17'];
    const entries = days.map((date, index) =>
      createEntry({
        id: `d${index}`,
        start: `${date}T09:00:00Z`,
        end: `${date}T19:00:00Z`,
        duration: 'PT10H'
      })
    );

    const results = calculateAnalysis(entries, store, {
      start: days[0],
      end: days[days.length - 1]
    });

    const fridayEntry = results[0].days.get('2025-01-17')?.entries.find(e => e.id === 'd4');
    expect(fridayEntry.analysis.weeklyOvertime).toBe(0);
    expect(results[0].totals.weeklyOvertime).toBe(0);
  });

  it('forces weekly overtime on full-day time off with zero capacity', () => {
    const timeOffMap = new Map([['2025-01-15', { isFullDay: true, hours: 0 }]]);
    const store = createStore({
      config: { overtimeBasis: 'weekly', applyTimeOff: true },
      timeOff: new Map([['user0', timeOffMap]])
    });

    const results = calculateAnalysis(
      [
        createEntry({
          id: 'work',
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        })
      ],
      store,
      { start: '2025-01-15', end: '2025-01-15' }
    );

    const analysis = results[0].days.get('2025-01-15')?.entries[0]?.analysis;
    expect(analysis.weeklyOvertime).toBe(8);
    expect(results[0].totals.weeklyOvertime).toBe(8);
  });

  it('does not force weekly overtime on partial time off with remaining capacity', () => {
    const timeOffMap = new Map([['2025-01-15', { isFullDay: false, hours: 4 }]]);
    const store = createStore({
      config: { overtimeBasis: 'weekly', applyTimeOff: true },
      timeOff: new Map([['user0', timeOffMap]])
    });

    const results = calculateAnalysis(
      [
        createEntry({
          id: 'work',
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        })
      ],
      store,
      { start: '2025-01-15', end: '2025-01-15' }
    );

    const analysis = results[0].days.get('2025-01-15')?.entries[0]?.analysis;
    expect(analysis.weeklyOvertime).toBe(0);
    expect(results[0].totals.weeklyOvertime).toBe(0);
  });

  it('does not count break entries toward weekly overtime thresholds', () => {
    const store = createStore({
      config: { overtimeBasis: 'weekly' },
      calcParams: { weeklyThreshold: 8 }
    });

    const results = calculateAnalysis(
      [
        createEntry({
          id: 'break',
          type: 'BREAK',
          start: '2025-01-15T08:00:00Z',
          end: '2025-01-15T12:00:00Z',
          duration: 'PT4H'
        }),
        createEntry({
          id: 'work',
          type: 'REGULAR',
          start: '2025-01-15T12:30:00Z',
          end: '2025-01-15T20:30:00Z',
          duration: 'PT8H'
        })
      ],
      store,
      { start: '2025-01-15', end: '2025-01-15' }
    );

    const workEntry = results[0].days.get('2025-01-15')?.entries.find(e => e.id === 'work');
    expect(workEntry.analysis.overtime).toBe(0);
    expect(results[0].totals.overtime).toBe(0);
  });

  it('keeps combinedOvertime aligned with overtime when basis is daily', () => {
    const store = createStore({
      config: { overtimeBasis: 'daily' }
    });

    const results = calculateAnalysis(
      [
        createEntry({
          id: 'work',
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        })
      ],
      store,
      { start: '2025-01-15', end: '2025-01-15' }
    );

    const analysis = results[0].days.get('2025-01-15')?.entries[0]?.analysis;
    expect(analysis.overtime).toBe(2);
    expect(analysis.combinedOvertime).toBe(2);
    expect(results[0].totals.combinedOvertime).toBe(2);
  });
});
