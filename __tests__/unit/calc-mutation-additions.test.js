/**
 * @jest-environment jsdom
 *
 * Targeted mutation-killing tests for calc.ts paths not covered elsewhere.
 */

import { afterEach, describe, it, expect } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

function createEntry(overrides = {}) {
  return {
    id: overrides.id || 'entry1',
    userId: overrides.userId || 'user0',
    userName: overrides.userName || 'User 0',
    billable: overrides.billable !== undefined ? overrides.billable : true,
    type: overrides.type || 'REGULAR',
    hourlyRate: overrides.hourlyRate || { amount: 10000 },
    timeInterval: {
      start: overrides.start || '2024-01-15T09:00:00Z',
      end: overrides.end || '2024-01-15T17:00:00Z',
      duration: overrides.duration !== undefined ? overrides.duration : 'PT8H'
    }
  };
}

describe('Calc mutation additions', () => {
  afterEach(() => {
    standardAfterEach();
  });

  it('honors global capacity override', () => {
    const store = createMockStore({
      userCount: 1,
      overrides: {
        user0: { capacity: 6 }
      },
      config: {
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        applyHolidays: false,
        applyTimeOff: false
      },
      calcParams: {
        dailyThreshold: 8
      }
    });

    const entry = createEntry({
      duration: 'PT6H',
      start: '2024-01-15T09:00:00Z',
      end: '2024-01-15T15:00:00Z'
    });

    const result = calculateAnalysis([entry], store, {
      start: '2024-01-15',
      end: '2024-01-15'
    });

    const dayMeta = result[0].days.get('2024-01-15')?.meta;
    expect(dayMeta.capacity).toBe(6);
  });

  it('does not reduce capacity for time-off entries when applyTimeOff is disabled', () => {
    const store = createMockStore({
      userCount: 1,
      config: {
        applyHolidays: false,
        applyTimeOff: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        overtimeBasis: 'weekly'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40
      }
    });

    const timeOffEntry = createEntry({
      id: 'pto1',
      type: 'TIME_OFF',
      duration: 'PT8H',
      start: '2024-01-15T00:00:00Z',
      end: '2024-01-15T08:00:00Z'
    });

    const workEntry = createEntry({
      id: 'work1',
      type: 'REGULAR',
      duration: 'PT2H',
      start: '2024-01-15T09:00:00Z',
      end: '2024-01-15T11:00:00Z'
    });

    const result = calculateAnalysis([timeOffEntry, workEntry], store, {
      start: '2024-01-15',
      end: '2024-01-15'
    });

    const dayMeta = result[0].days.get('2024-01-15')?.meta;
    const workAnalysis = result[0].days
      .get('2024-01-15')
      ?.entries.find((entry) => entry.id === 'work1')?.analysis;

    expect(dayMeta.capacity).toBe(8);
    expect(dayMeta.isTimeOff).toBe(false);
    expect(workAnalysis.weeklyOvertime).toBe(0);
    expect(result[0].totals.timeOffHours).toBe(0);
  });

  it('does not compute daily overtime when overtimeBasis is weekly', () => {
    const store = createMockStore({
      userCount: 1,
      config: {
        applyHolidays: false,
        applyTimeOff: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        overtimeBasis: 'weekly'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 100
      }
    });

    const entry = createEntry({
      duration: 'PT10H',
      start: '2024-01-15T08:00:00Z',
      end: '2024-01-15T18:00:00Z'
    });

    const result = calculateAnalysis([entry], store, {
      start: '2024-01-15',
      end: '2024-01-15'
    });

    const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
    expect(analysis.dailyOvertime).toBe(0);
    expect(analysis.overtime).toBe(0);
  });

  it('computes overlap and combined overtime when overtimeBasis is both', () => {
    const store = createMockStore({
      userCount: 1,
      config: {
        applyHolidays: false,
        applyTimeOff: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        overtimeBasis: 'both'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 9
      }
    });

    const entry = createEntry({
      duration: 'PT10H',
      start: '2024-01-15T08:00:00Z',
      end: '2024-01-15T18:00:00Z'
    });

    const result = calculateAnalysis([entry], store, {
      start: '2024-01-15',
      end: '2024-01-15'
    });

    const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
    expect(analysis.dailyOvertime).toBe(2);
    expect(analysis.weeklyOvertime).toBe(1);
    expect(analysis.overlapOvertime).toBe(1);
    expect(analysis.combinedOvertime).toBe(2);
    expect(analysis.overtime).toBe(2);
    expect(result[0].totals.overlapOvertime).toBe(1);
    expect(result[0].totals.combinedOvertime).toBe(2);
  });

  it('treats break entries as regular hours with no overtime', () => {
    const store = createMockStore({
      userCount: 1,
      config: {
        applyHolidays: false,
        applyTimeOff: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false,
        overtimeBasis: 'daily'
      }
    });

    const entry = createEntry({
      type: 'BREAK',
      duration: 'PT1H',
      start: '2024-01-15T12:00:00Z',
      end: '2024-01-15T13:00:00Z'
    });

    const result = calculateAnalysis([entry], store, {
      start: '2024-01-15',
      end: '2024-01-15'
    });

    const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
    expect(analysis.regular).toBe(1);
    expect(analysis.overtime).toBe(0);
    expect(analysis.dailyOvertime).toBe(0);
    expect(analysis.weeklyOvertime).toBe(0);
  });

  it('keeps duration at 0 when end timestamp is invalid', () => {
    const store = createMockStore({
      userCount: 1,
      config: {
        applyHolidays: false,
        applyTimeOff: false,
        useProfileCapacity: false,
        useProfileWorkingDays: false
      }
    });

    const entry = createEntry({
      duration: null,
      end: 'invalid-date'
    });

    const result = calculateAnalysis([entry], store, {
      start: '2024-01-15',
      end: '2024-01-15'
    });

    const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
    expect(analysis.regular).toBe(0);
  });
});
