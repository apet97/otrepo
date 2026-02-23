/**
 * @jest-environment node
 */

import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { Api } from '../../js/api.js';
import { calculateAnalysis } from '../../js/calc.js';
import { store } from '../../js/state.js';
import { createMockJwtToken } from '../helpers/mock-data.js';

describe('integration: api -> calc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.token = createMockJwtToken();
    store.claims = {
      workspaceId: 'ws_1',
      backendUrl: 'https://api.clockify.me/api',
      reportsUrl: 'https://reports.api.clockify.me'
    };
    store.users = [];
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
  });

  it('fetches users and entries and produces analysis output', async () => {
    const users = [{ id: 'user1', name: 'Ada Lovelace' }];
    const entries = [
      {
        id: 'entry1',
        userId: 'user1',
        userName: 'Ada Lovelace',
        billable: true,
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H'
        }
      }
    ];

    global.fetch = jest.fn(async (url) => {
      const urlStr = String(url);
      let payload;
      if (urlStr.includes('/users')) {
        payload = users;
      } else if (urlStr.includes('/time-entries')) {
        payload = entries;
      } else {
        throw new Error(`Unexpected URL: ${urlStr}`);
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(payload),
        json: async () => payload
      };
    });

    const fetchedUsers = await Api.fetchUsers('ws_1');
    store.users = fetchedUsers;
    const fetchedEntries = await Api.fetchEntries(
      'ws_1',
      fetchedUsers,
      '2025-01-01T00:00:00Z',
      '2025-01-01T23:59:59Z'
    );

    const analysis = calculateAnalysis(fetchedEntries, store, {
      start: '2025-01-01',
      end: '2025-01-01'
    });

    expect(analysis).toHaveLength(1);
    expect(analysis[0].userId).toBe('user1');
    expect(analysis[0].totals.total).toBeCloseTo(8);
  });
});
