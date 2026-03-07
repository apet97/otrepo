/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderDetailedTable, destroyDetailedObserver, invalidateDetailedCache } from '../../js/ui/detailed.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('ui/detailed mutations', () => {
  beforeEach(() => {
    // Set up DOM structure
    document.body.innerHTML = `
      <div id="detailedCard">
        <div id="detailedFilters">
          <span class="chip active" data-filter="all" aria-checked="true">All</span>
          <span class="chip" data-filter="holiday" aria-checked="false">Holiday</span>
          <span class="chip" data-filter="offday" aria-checked="false">Off Day</span>
          <span class="chip" data-filter="billable" aria-checked="false">Billable</span>
        </div>
        <div id="detailedTableContainer"></div>
      </div>
    `;

    // Reset store config to match what renderDetailedTable reads
    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      maxPages: 10,
      encryptStorage: true,
      auditConsent: true,
    };

    store.ui = {
      isLoading: false,
      summaryExpanded: false,
      summaryGroupBy: 'user',
      overridesCollapsed: true,
      activeTab: 'detailed',
      detailedPage: 1,
      detailedPageSize: 50,
      activeDetailedFilter: 'all',
      hasCostRates: true,
      hasAmountRates: true,
      paginationTruncated: false,
      paginationAbortedDueToTokenExpiration: false,
    };
  });

  afterEach(() => {
    standardAfterEach();
  });

  it('renderDetailedTable renders table with entries and columns', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Work task',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  projectId: 'proj1',
                  projectName: 'Project A',
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 8,
          regular: 8,
          overtime: 0,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 8,
          nonBillableWorked: 0,
          billableOT: 0,
          nonBillableOT: 0,
          amount: 100,
          otPremium: 0,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'all');

    const container = document.getElementById('detailedTableContainer');
    // renderDetailedTable renders: Date, Start, End, User, Regular, OT, Billable, amounts, Status
    // description and projectName are NOT rendered as table columns
    expect(container.innerHTML).toContain('Test User');
    expect(container.innerHTML).toContain('2024-01-15');
    expect(container.innerHTML).toContain('8h'); // regular
    expect(container.innerHTML).toContain('0h'); // overtime
  });

  it('filter "all" shows all entries', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Regular work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-16',
            {
              entries: [
                {
                  description: 'Holiday work',
                  timeInterval: {
                    start: '2024-01-16T09:00:00Z',
                    end: '2024-01-16T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 8,
                    isBillable: true,
                    cost: 120,
                    hourlyRate: 15,
                  },
                  type: 'HOLIDAY',
                },
              ],
              meta: {
                capacity: 0,
                isHoliday: true,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 16,
          regular: 8,
          overtime: 8,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 16,
          nonBillableWorked: 0,
          billableOT: 8,
          nonBillableOT: 0,
          amount: 220,
          otPremium: 20,
          otPremiumTier2: 0,
          holidayCount: 1,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'all');

    const container = document.getElementById('detailedTableContainer');
    // description is not rendered; check dates instead
    expect(container.innerHTML).toContain('2024-01-15');
    expect(container.innerHTML).toContain('2024-01-16');
  });

  it('filter "holiday" only shows entries on holiday days', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Regular work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-16',
            {
              entries: [
                {
                  description: 'Holiday work',
                  timeInterval: {
                    start: '2024-01-16T09:00:00Z',
                    end: '2024-01-16T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 8,
                    isBillable: true,
                    cost: 120,
                    hourlyRate: 15,
                  },
                  type: 'HOLIDAY',
                },
              ],
              meta: {
                capacity: 0,
                isHoliday: true,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 16,
          regular: 8,
          overtime: 8,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 16,
          nonBillableWorked: 0,
          billableOT: 8,
          nonBillableOT: 0,
          amount: 220,
          otPremium: 20,
          otPremiumTier2: 0,
          holidayCount: 1,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'holiday');

    const container = document.getElementById('detailedTableContainer');
    // Only holiday day (2024-01-16) entries should appear
    expect(container.innerHTML).not.toContain('2024-01-15');
    expect(container.innerHTML).toContain('2024-01-16');
  });

  it('filter "offday" only shows entries on non-working days', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Regular work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-20',
            {
              entries: [
                {
                  description: 'Weekend work',
                  timeInterval: {
                    start: '2024-01-20T09:00:00Z',
                    end: '2024-01-20T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 8,
                    isBillable: true,
                    cost: 120,
                    hourlyRate: 15,
                  },
                  type: 'OFFDAY',
                },
              ],
              meta: {
                capacity: 0,
                isHoliday: false,
                isNonWorking: true,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 16,
          regular: 8,
          overtime: 8,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 16,
          nonBillableWorked: 0,
          billableOT: 8,
          nonBillableOT: 0,
          amount: 220,
          otPremium: 20,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'offday');

    const container = document.getElementById('detailedTableContainer');
    // Only non-working day (2024-01-20) entries should appear
    expect(container.innerHTML).not.toContain('2024-01-15');
    expect(container.innerHTML).toContain('2024-01-20');
  });

  it('filter "billable" only shows billable entries', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Billable work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
                {
                  description: 'Non-billable work',
                  timeInterval: {
                    start: '2024-01-15T17:00:00Z',
                    end: '2024-01-15T19:00:00Z',
                    duration: 'PT2H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 2,
                    isBillable: false,
                    cost: 0,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 10,
          regular: 8,
          overtime: 2,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 8,
          nonBillableWorked: 2,
          billableOT: 0,
          nonBillableOT: 2,
          amount: 100,
          otPremium: 25,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'billable');

    const container = document.getElementById('detailedTableContainer');
    const rows = container.querySelectorAll('tbody tr');
    // Only the 1 billable entry should appear (not the non-billable one)
    expect(rows.length).toBe(1);
    // The billable entry has regular=8
    expect(rows[0].innerHTML).toContain('8h');
    // Verify the billable badge is shown
    expect(rows[0].innerHTML).toContain('badge-billable');
  });

  it('filter falls back to "all" when showBillableBreakdown is false', () => {
    store.config.showBillableBreakdown = false;

    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Billable work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
                {
                  description: 'Non-billable work',
                  timeInterval: {
                    start: '2024-01-15T17:00:00Z',
                    end: '2024-01-15T19:00:00Z',
                    duration: 'PT2H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 2,
                    isBillable: false,
                    cost: 0,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 10,
          regular: 8,
          overtime: 2,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 8,
          nonBillableWorked: 2,
          billableOT: 0,
          nonBillableOT: 2,
          amount: 100,
          otPremium: 25,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'billable');

    const container = document.getElementById('detailedTableContainer');
    const rows = container.querySelectorAll('tbody tr');
    // Should show all entries since billable filter falls back to 'all'
    expect(rows.length).toBe(2);
  });

  it('pagination shows correct entries per page', () => {
    store.ui.detailedPageSize = 2;
    store.ui.detailedPage = 1;

    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push({
        description: `Entry ${i}`,
        timeInterval: {
          start: `2024-01-15T0${i}:00:00Z`,
          end: `2024-01-15T0${i + 1}:00:00Z`,
          duration: 'PT1H',
        },
        analysis: {
          regular: 1,
          overtime: 0,
          isBillable: true,
          cost: 12.5,
          hourlyRate: 12.5,
        },
        type: 'REGULAR',
      });
    }

    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries,
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 5,
          regular: 5,
          overtime: 0,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 5,
          nonBillableWorked: 0,
          billableOT: 0,
          nonBillableOT: 0,
          amount: 62.5,
          otPremium: 0,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    // Entries sorted by start time descending: 05:00, 04:00, 03:00, 02:00, 01:00
    // Page 1 (2 per page): entries starting at 05:00 and 04:00
    renderDetailedTable(users, 'all');
    let container = document.getElementById('detailedTableContainer');
    let rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    // Page 2: entries starting at 03:00 and 02:00
    // Pass null as filter to avoid resetting page to 1
    store.ui.detailedPage = 2;
    renderDetailedTable(users, null);
    container = document.getElementById('detailedTableContainer');
    rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    // Page 3: 1 remaining entry starting at 01:00
    store.ui.detailedPage = 3;
    renderDetailedTable(users, null);
    container = document.getElementById('detailedTableContainer');
    rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
  });

  it('empty entries shows "No entries found" message', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map(),
        totals: {
          total: 0,
          regular: 0,
          overtime: 0,
          expectedCapacity: 0,
          breaks: 0,
          billableWorked: 0,
          nonBillableWorked: 0,
          billableOT: 0,
          nonBillableOT: 0,
          amount: 0,
          otPremium: 0,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'all');

    const container = document.getElementById('detailedTableContainer');
    expect(container.innerHTML).toContain('No entries found');
  });

  it('entry count formatting is correct', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Entry 1',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
                {
                  description: 'Entry 2',
                  timeInterval: {
                    start: '2024-01-15T17:00:00Z',
                    end: '2024-01-15T19:00:00Z',
                    duration: 'PT2H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 2,
                    isBillable: true,
                    cost: 30,
                    hourlyRate: 15,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 10,
          regular: 8,
          overtime: 2,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 10,
          nonBillableWorked: 0,
          billableOT: 2,
          nonBillableOT: 0,
          amount: 130,
          otPremium: 15,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'all');

    const container = document.getElementById('detailedTableContainer');
    // Verify both entries are rendered as table rows
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('filter chip aria states are correct', () => {
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Work task',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 8,
          regular: 8,
          overtime: 0,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 8,
          nonBillableWorked: 0,
          billableOT: 0,
          nonBillableOT: 0,
          amount: 100,
          otPremium: 0,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'all');

    const allChip = document.querySelector('[data-filter="all"]');
    const holidayChip = document.querySelector('[data-filter="holiday"]');
    const offdayChip = document.querySelector('[data-filter="offday"]');
    const billableChip = document.querySelector('[data-filter="billable"]');

    expect(allChip.getAttribute('aria-checked')).toBe('true');
    expect(holidayChip.getAttribute('aria-checked')).toBe('false');
    expect(offdayChip.getAttribute('aria-checked')).toBe('false');
    expect(billableChip.getAttribute('aria-checked')).toBe('false');

    // Change to holiday filter
    renderDetailedTable(users, 'holiday');

    expect(allChip.getAttribute('aria-checked')).toBe('false');
    expect(holidayChip.getAttribute('aria-checked')).toBe('true');
    expect(offdayChip.getAttribute('aria-checked')).toBe('false');
    expect(billableChip.getAttribute('aria-checked')).toBe('false');
  });

  it('entries are sorted by start time descending', () => {
    // Use entries on different dates to make them clearly distinguishable in the rendered output
    const users = [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-10',
            {
              entries: [
                {
                  description: 'Early work',
                  timeInterval: {
                    start: '2024-01-10T09:00:00Z',
                    end: '2024-01-10T11:00:00Z',
                    duration: 'PT2H',
                  },
                  analysis: {
                    regular: 2,
                    overtime: 0,
                    isBillable: true,
                    cost: 25,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-20',
            {
              entries: [
                {
                  description: 'Late work',
                  timeInterval: {
                    start: '2024-01-20T09:00:00Z',
                    end: '2024-01-20T11:00:00Z',
                    duration: 'PT2H',
                  },
                  analysis: {
                    regular: 2,
                    overtime: 0,
                    isBillable: true,
                    cost: 25,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Mid work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T11:00:00Z',
                    duration: 'PT2H',
                  },
                  analysis: {
                    regular: 2,
                    overtime: 0,
                    isBillable: true,
                    cost: 25,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 6,
          regular: 6,
          overtime: 0,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 6,
          nonBillableWorked: 0,
          billableOT: 0,
          nonBillableOT: 0,
          amount: 75,
          otPremium: 0,
          otPremiumTier2: 0,
          holidayCount: 0,
          timeOffCount: 0,
        },
      },
    ];

    renderDetailedTable(users, 'all');

    const container = document.getElementById('detailedTableContainer');
    const html = container.innerHTML;

    // Dates are rendered in the table; check they appear in descending order
    const latePos = html.indexOf('2024-01-20');
    const midPos = html.indexOf('2024-01-15');
    const earlyPos = html.indexOf('2024-01-10');

    // All dates should be found
    expect(latePos).toBeGreaterThan(-1);
    expect(midPos).toBeGreaterThan(-1);
    expect(earlyPos).toBeGreaterThan(-1);

    // Latest entry should appear first (descending order)
    expect(latePos).toBeLessThan(midPos);
    expect(midPos).toBeLessThan(earlyPos);
  });

  it('destroyDetailedObserver can be called without error', () => {
    expect(() => {
      destroyDetailedObserver();
    }).not.toThrow();

    // Can be called multiple times
    expect(() => {
      destroyDetailedObserver();
      destroyDetailedObserver();
    }).not.toThrow();
  });

  describe('Detailed Entries Cache (Phase 3.1 + 3.2)', () => {
    const makeUsers = () => [
      {
        userId: 'user1',
        userName: 'Test User',
        days: new Map([
          [
            '2024-01-15',
            {
              entries: [
                {
                  description: 'Regular work',
                  timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 8,
                    overtime: 0,
                    isBillable: true,
                    cost: 100,
                    hourlyRate: 12.5,
                  },
                  type: 'REGULAR',
                },
              ],
              meta: {
                capacity: 8,
                isHoliday: false,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-16',
            {
              entries: [
                {
                  description: 'Holiday work',
                  timeInterval: {
                    start: '2024-01-16T09:00:00Z',
                    end: '2024-01-16T17:00:00Z',
                    duration: 'PT8H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 8,
                    isBillable: false,
                    cost: 0,
                    hourlyRate: 15,
                  },
                  type: 'HOLIDAY',
                },
              ],
              meta: {
                capacity: 0,
                isHoliday: true,
                isNonWorking: false,
                isTimeOff: false,
              },
            },
          ],
          [
            '2024-01-20',
            {
              entries: [
                {
                  description: 'Weekend work',
                  timeInterval: {
                    start: '2024-01-20T10:00:00Z',
                    end: '2024-01-20T14:00:00Z',
                    duration: 'PT4H',
                  },
                  analysis: {
                    regular: 0,
                    overtime: 4,
                    isBillable: true,
                    cost: 60,
                    hourlyRate: 15,
                  },
                  type: 'OFFDAY',
                },
              ],
              meta: {
                capacity: 0,
                isHoliday: false,
                isNonWorking: true,
                isTimeOff: false,
              },
            },
          ],
        ]),
        totals: {
          total: 20,
          regular: 8,
          overtime: 12,
          expectedCapacity: 8,
          breaks: 0,
          billableWorked: 12,
          nonBillableWorked: 8,
          billableOT: 4,
          nonBillableOT: 8,
          amount: 160,
          otPremium: 30,
          otPremiumTier2: 0,
          holidayCount: 1,
          timeOffCount: 0,
        },
      },
    ];

    beforeEach(() => {
      invalidateDetailedCache();
    });

    it('cache hit: same users reference produces consistent results', () => {
      const users = makeUsers();

      renderDetailedTable(users, 'all');
      const html1 = document.getElementById('detailedTableContainer').innerHTML;

      // Render again with same reference — should use cache
      renderDetailedTable(users, null);
      const html2 = document.getElementById('detailedTableContainer').innerHTML;

      expect(html1).toBe(html2);
    });

    it('cache miss: new users array rebuilds entries', () => {
      const users1 = makeUsers();
      renderDetailedTable(users1, 'all');
      const rows1 = document.querySelectorAll('#detailedTableContainer tbody tr');
      expect(rows1.length).toBe(3);

      // New array reference with different data
      const users2 = [
        {
          userId: 'user2',
          userName: 'Other User',
          days: new Map([
            [
              '2024-02-01',
              {
                entries: [
                  {
                    description: 'Feb work',
                    timeInterval: {
                      start: '2024-02-01T09:00:00Z',
                      end: '2024-02-01T17:00:00Z',
                      duration: 'PT8H',
                    },
                    analysis: { regular: 8, overtime: 0, isBillable: true, cost: 100, hourlyRate: 12.5 },
                    type: 'REGULAR',
                  },
                ],
                meta: { capacity: 8, isHoliday: false, isNonWorking: false, isTimeOff: false },
              },
            ],
          ]),
          totals: { total: 8, regular: 8, overtime: 0, expectedCapacity: 8, breaks: 0, billableWorked: 8, nonBillableWorked: 0, billableOT: 0, nonBillableOT: 0, amount: 100, otPremium: 0, otPremiumTier2: 0, holidayCount: 0, timeOffCount: 0 },
        },
      ];

      renderDetailedTable(users2, 'all');
      const rows2 = document.querySelectorAll('#detailedTableContainer tbody tr');
      expect(rows2.length).toBe(1);
      expect(document.getElementById('detailedTableContainer').innerHTML).toContain('Other User');
    });

    it('invalidateDetailedCache forces rebuild on next render', () => {
      const users = makeUsers();

      renderDetailedTable(users, 'all');
      const html1 = document.getElementById('detailedTableContainer').innerHTML;

      invalidateDetailedCache();

      // Same reference, but cache was invalidated — should rebuild (same result)
      renderDetailedTable(users, null);
      const html2 = document.getElementById('detailedTableContainer').innerHTML;

      // Content should still be the same since data hasn't changed
      expect(html1).toBe(html2);
    });

    it('invalidateDetailedCache can be called safely when cache is empty', () => {
      expect(() => {
        invalidateDetailedCache();
        invalidateDetailedCache();
      }).not.toThrow();
    });

    it('filter "holiday" subset returns only holiday entries', () => {
      const users = makeUsers();

      renderDetailedTable(users, 'holiday');

      const container = document.getElementById('detailedTableContainer');
      // Only the holiday day (2024-01-16) should appear
      expect(container.innerHTML).toContain('2024-01-16');
      expect(container.innerHTML).not.toContain('2024-01-15');
      expect(container.innerHTML).not.toContain('2024-01-20');
      const rows = container.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1);
    });

    it('filter "offday" subset returns only non-working entries', () => {
      const users = makeUsers();

      renderDetailedTable(users, 'offday');

      const container = document.getElementById('detailedTableContainer');
      // Only the weekend day (2024-01-20) should appear
      expect(container.innerHTML).toContain('2024-01-20');
      expect(container.innerHTML).not.toContain('2024-01-15');
      expect(container.innerHTML).not.toContain('2024-01-16');
      const rows = container.querySelectorAll('tbody tr');
      expect(rows.length).toBe(1);
    });

    it('filter "billable" subset returns only billable entries', () => {
      const users = makeUsers();

      renderDetailedTable(users, 'billable');

      const container = document.getElementById('detailedTableContainer');
      const rows = container.querySelectorAll('tbody tr');
      // 2 billable entries: regular (Jan 15) + weekend (Jan 20)
      expect(rows.length).toBe(2);
      // Non-billable holiday entry (Jan 16) should not appear
      expect(container.innerHTML).not.toContain('2024-01-16');
    });

    it('filter "all" returns all entries', () => {
      const users = makeUsers();

      renderDetailedTable(users, 'all');

      const rows = document.querySelectorAll('#detailedTableContainer tbody tr');
      expect(rows.length).toBe(3);
    });

    it('unknown filter falls back to all entries', () => {
      const users = makeUsers();

      // Use a non-existent filter key
      store.ui.activeDetailedFilter = 'nonexistent';
      renderDetailedTable(users, null);

      const rows = document.querySelectorAll('#detailedTableContainer tbody tr');
      // Should show all 3 entries (fallback)
      expect(rows.length).toBe(3);
    });

    it('switching filters uses cached subsets', () => {
      const users = makeUsers();

      // First render builds cache
      renderDetailedTable(users, 'all');
      expect(document.querySelectorAll('#detailedTableContainer tbody tr').length).toBe(3);

      // Switch to holiday — uses pre-computed subset
      renderDetailedTable(users, 'holiday');
      expect(document.querySelectorAll('#detailedTableContainer tbody tr').length).toBe(1);

      // Switch to offday — uses pre-computed subset
      renderDetailedTable(users, 'offday');
      expect(document.querySelectorAll('#detailedTableContainer tbody tr').length).toBe(1);

      // Switch back to all — uses pre-computed subset
      renderDetailedTable(users, 'all');
      expect(document.querySelectorAll('#detailedTableContainer tbody tr').length).toBe(3);
    });
  });
});
