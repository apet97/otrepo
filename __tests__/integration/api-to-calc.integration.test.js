/**
 * @jest-environment node
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Api, resetCircuitBreaker, resetRateLimiter } from '../../js/api.js';
import { calculateAnalysis } from '../../js/calc.js';
import { store } from '../../js/state.js';
import { mockResponse } from '../helpers/api-test-helpers.js';
import { createMockJwtToken } from '../helpers/mock-data.js';

global.fetch = jest.fn();

function makeDetailedEntry({
  id,
  userId,
  userName,
  start,
  end,
  durationSeconds,
  billable,
  projectId,
  projectName,
  clientId,
  clientName,
  taskId,
  taskName,
  earnedRate,
  costRate,
  amounts,
  type = 'REGULAR',
}) {
  return {
    _id: id,
    userId,
    userName,
    billable,
    projectId,
    projectName,
    clientId,
    clientName,
    taskId,
    taskName,
    type,
    earnedRate,
    costRate,
    amounts,
    description: `${projectName} work`,
    timeInterval: {
      start,
      end,
      duration: durationSeconds,
    },
  };
}

describe('integration: api -> calc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();

    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_1',
      backendUrl: 'https://api.clockify.me/api',
      reportsUrl: 'https://reports.api.clockify.me',
    };
    store.users = [];
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.config = {
      ...store.config,
      applyHolidays: false,
      applyTimeOff: false,
      useProfileCapacity: false,
      useProfileWorkingDays: false,
      showBillableBreakdown: true,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
    };
    store.calcParams = {
      ...store.calcParams,
      dailyThreshold: 8,
      overtimeMultiplier: 1.5,
    };
  });

  it('transforms detailed report payloads and calculates multi-user totals from the current API path', async () => {
    const users = [
      { id: 'user1', name: 'Ada Lovelace' },
      { id: 'user2', name: 'Grace Hopper' },
    ];
    const detailedEntries = [
      makeDetailedEntry({
        id: 'ada-1',
        userId: 'user1',
        userName: 'Ada Lovelace',
        start: '2025-01-01T09:00:00Z',
        end: '2025-01-01T19:00:00Z',
        durationSeconds: 36000,
        billable: true,
        projectId: 'project-a',
        projectName: 'Project Alpha',
        clientId: 'client-a',
        clientName: 'Client A',
        taskId: 'task-build',
        taskName: 'Build',
        earnedRate: 5000,
        costRate: 2500,
        amounts: [
          { type: 'EARNED', value: 50000 },
          { type: 'COST', value: 25000 },
          { type: 'PROFIT', value: 25000 },
        ],
      }),
      makeDetailedEntry({
        id: 'grace-1',
        userId: 'user2',
        userName: 'Grace Hopper',
        start: '2025-01-01T10:00:00Z',
        end: '2025-01-01T18:00:00Z',
        durationSeconds: 28800,
        billable: false,
        projectId: 'project-b',
        projectName: 'Project Beta',
        clientId: 'client-b',
        clientName: 'Client B',
        taskId: 'task-review',
        taskName: 'Review',
        earnedRate: 0,
        costRate: 0,
        amounts: [],
      }),
    ];

    fetch.mockImplementation(async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.includes('/users?page=1&page-size=500')) {
        return mockResponse(users);
      }

      if (urlStr.includes('/reports/detailed')) {
        expect(options.method).toBe('POST');
        expect(options.headers).toEqual(expect.objectContaining({
          'Content-Type': 'application/json',
        }));

        const body = JSON.parse(options.body);
        expect(body).toEqual(expect.objectContaining({
          amountShown: 'EARNED',
          amounts: ['EARNED', 'COST', 'PROFIT'],
          detailedFilter: expect.objectContaining({ page: 1, pageSize: 200 }),
        }));

        return mockResponse({ timeEntries: detailedEntries });
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    });

    const fetchedUsers = await Api.fetchUsers('ws_1');
    store.users = fetchedUsers;
    const fetchedEntries = await Api.fetchDetailedReport(
      'ws_1',
      '2025-01-01T00:00:00Z',
      '2025-01-01T23:59:59Z'
    );

    const analysis = calculateAnalysis(fetchedEntries, store, {
      start: '2025-01-01',
      end: '2025-01-01',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetchedEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ada-1',
          userId: 'user1',
          userName: 'Ada Lovelace',
          projectName: 'Project Alpha',
          timeInterval: expect.objectContaining({
            duration: 'PT36000S',
          }),
          hourlyRate: expect.objectContaining({ amount: 5000 }),
          costRate: 2500,
        }),
        expect.objectContaining({
          id: 'grace-1',
          userId: 'user2',
          userName: 'Grace Hopper',
          projectName: 'Project Beta',
          billable: false,
          timeInterval: expect.objectContaining({
            duration: 'PT28800S',
          }),
        }),
      ])
    );

    const ada = analysis.find((user) => user.userId === 'user1');
    const grace = analysis.find((user) => user.userId === 'user2');

    expect(ada).toBeDefined();
    expect(ada.totals.total).toBeCloseTo(10);
    expect(ada.totals.overtime).toBeCloseTo(2);
    expect(ada.totals.amount).toBeGreaterThan(0);

    expect(grace).toBeDefined();
    expect(grace.totals.total).toBeCloseTo(8);
    expect(grace.totals.overtime).toBe(0);
    expect(grace.totals.billableWorked).toBe(0);
  });
});
