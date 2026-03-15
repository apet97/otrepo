/**
 * @jest-environment jsdom
 *
 * Integration test: API response → calc → CSV export.
 * Verifies end-to-end data flow from time entries through calculation to CSV output.
 * Addresses: C11
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { downloadCsv } from '../../js/export.js';
import { store } from '../../js/state.js';
import { createEntry, createMinimalStore } from '../helpers/calc-test-helpers.js';

// Capture Blob content since jsdom Blob doesn't support text()
let _capturedBlobContent = '';
const _OriginalBlob = globalThis.Blob;

class TestBlob extends _OriginalBlob {
  constructor(parts, options) {
    super(parts, options);
    _capturedBlobContent = parts.map((p) => (typeof p === 'string' ? p : '')).join('');
  }
}
globalThis.Blob = TestBlob;

describe('integration: report → calc → CSV export', () => {
  let mockLink;

  beforeEach(() => {
    _capturedBlobContent = '';

    // Mock URL methods
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();

    // Mock link element for download
    mockLink = {
      setAttribute: jest.fn(),
      click: jest.fn(),
      style: {},
    };
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return mockLink;
      return originalCreateElement(tag);
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    // Setup store
    store.config = { auditConsent: true, amountDisplay: 'earned' };
    store.claims = { workspaceId: 'ws_integration_csv' };
    store.currentDateRange = { start: '2024-01-15', end: '2024-01-17' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should produce CSV with correct headers and entry data', () => {
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Ada Lovelace',
        billable: true,
        description: 'Feature work',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T19:00:00Z',
        duration: 'PT10H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [{ id: 'user1', name: 'Ada Lovelace' }],
      config: { amountDisplay: 'earned' },
      calcParams: { dailyThreshold: 8, overtimeMultiplier: 1.5 },
    });

    const dateRange = { start: '2024-01-15', end: '2024-01-15' };
    const analysis = calculateAnalysis(entries, calcStore, dateRange);

    expect(analysis).toHaveLength(1);
    expect(analysis[0].userName).toBe('Ada Lovelace');

    // Export to CSV
    downloadCsv(analysis, 'test-report.csv');

    // Verify download was triggered
    expect(mockLink.click).toHaveBeenCalled();
    expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'test-report.csv');

    // Verify CSV content
    const csv = _capturedBlobContent;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = csv.substring(1).split('\n');

    // Header row
    expect(lines[0]).toContain('Date');
    expect(lines[0]).toContain('User');
    expect(lines[0]).toContain('OvertimeHours');
    expect(lines[0]).toContain('TotalHoursDecimal');

    // Data row with user and date
    expect(lines[1]).toContain('2024-01-15');
    expect(lines[1]).toContain('Ada Lovelace');
  });

  it('should calculate overtime correctly and reflect it in CSV', () => {
    // 10-hour day with 8-hour threshold = 2 hours overtime
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Bob',
        billable: true,
        description: 'Long day',
        start: '2024-01-15T08:00:00Z',
        end: '2024-01-15T18:00:00Z',
        duration: 'PT10H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [{ id: 'user1', name: 'Bob' }],
      calcParams: { dailyThreshold: 8, overtimeMultiplier: 1.5 },
    });

    const dateRange = { start: '2024-01-15', end: '2024-01-15' };
    const analysis = calculateAnalysis(entries, calcStore, dateRange);

    // Verify calc produced correct totals
    const user = analysis[0];
    expect(user.totals.regular).toBe(8);
    expect(user.totals.overtime).toBe(2);
    expect(user.totals.total).toBe(10);

    // Export and verify OT appears in CSV
    downloadCsv(analysis, 'ot-report.csv');
    const csv = _capturedBlobContent.substring(1); // strip BOM
    const lines = csv.split('\n');
    const dataRow = lines[1];

    // RegularHours = 8h, OvertimeHours = 2h (formatHours omits 0m)
    expect(dataRow).toContain(',8h,');
    expect(dataRow).toContain(',2h,');
  });

  it('should handle multiple users and days', () => {
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Alice',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T17:00:00Z',
        duration: 'PT8H',
      }),
      createEntry({
        id: 'e2',
        userId: 'user2',
        userName: 'Charlie',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T18:00:00Z',
        duration: 'PT8H',
      }),
      createEntry({
        id: 'e3',
        userId: 'user1',
        userName: 'Alice',
        start: '2024-01-16T09:00:00Z',
        end: '2024-01-16T19:00:00Z',
        duration: 'PT10H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Charlie' },
      ],
      calcParams: { dailyThreshold: 8, overtimeMultiplier: 1.5 },
    });

    const dateRange = { start: '2024-01-15', end: '2024-01-16' };
    const analysis = calculateAnalysis(entries, calcStore, dateRange);

    expect(analysis).toHaveLength(2);

    downloadCsv(analysis);
    const csv = _capturedBlobContent.substring(1);
    const lines = csv.split('\n');
    const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);

    // Should have rows for multiple user-day combinations
    expect(dataLines.length).toBeGreaterThanOrEqual(3);
    expect(csv).toContain('Alice');
    expect(csv).toContain('Charlie');
    expect(csv).toContain('2024-01-15');
    expect(csv).toContain('2024-01-16');
  });

  it('should sanitize formula injection in descriptions', () => {
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Test User',
        description: '=CMD("malicious")',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T17:00:00Z',
        duration: 'PT8H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [{ id: 'user1', name: 'Test User' }],
    });

    const dateRange = { start: '2024-01-15', end: '2024-01-15' };
    const analysis = calculateAnalysis(entries, calcStore, dateRange);

    downloadCsv(analysis);
    const csv = _capturedBlobContent;

    // Formula should be neutralized with leading single quote
    // The CSV-escaped form is "'=CMD(...)" — the quote prevents formula execution
    expect(csv).toContain("'=CMD");
    // Verify no unescaped formula (without preceding single quote)
    expect(csv).not.toMatch(/[^']=CMD/);
  });

  it('should include BOM for Excel compatibility', () => {
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Test User',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T17:00:00Z',
        duration: 'PT8H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [{ id: 'user1', name: 'Test User' }],
    });

    const analysis = calculateAnalysis(entries, calcStore, { start: '2024-01-15', end: '2024-01-15' });
    downloadCsv(analysis);

    // UTF-8 BOM character at position 0
    expect(_capturedBlobContent.charCodeAt(0)).toBe(0xfeff);
  });

  it('should produce placeholder rows for days without entries', () => {
    // Create entry only for one day of a two-day range
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Test User',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T17:00:00Z',
        duration: 'PT8H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [{ id: 'user1', name: 'Test User' }],
    });

    const dateRange = { start: '2024-01-15', end: '2024-01-16' };
    const analysis = calculateAnalysis(entries, calcStore, dateRange);

    downloadCsv(analysis);
    const csv = _capturedBlobContent.substring(1);

    // Both dates should appear in the CSV (Jan 16 as placeholder)
    expect(csv).toContain('2024-01-15');
    expect(csv).toContain('2024-01-16');
  });

  it('should handle billable vs non-billable breakdown in CSV', () => {
    const entries = [
      createEntry({
        id: 'e1',
        userId: 'user1',
        userName: 'Test User',
        billable: true,
        description: 'Billable work',
        start: '2024-01-15T09:00:00Z',
        end: '2024-01-15T14:00:00Z',
        duration: 'PT5H',
      }),
      createEntry({
        id: 'e2',
        userId: 'user1',
        userName: 'Test User',
        billable: false,
        description: 'Internal meeting',
        start: '2024-01-15T14:00:00Z',
        end: '2024-01-15T17:00:00Z',
        duration: 'PT3H',
      }),
    ];

    const calcStore = createMinimalStore({
      users: [{ id: 'user1', name: 'Test User' }],
      config: { showBillableBreakdown: true },
    });

    const dateRange = { start: '2024-01-15', end: '2024-01-15' };
    const analysis = calculateAnalysis(entries, calcStore, dateRange);

    downloadCsv(analysis);
    const csv = _capturedBlobContent.substring(1);
    const lines = csv.split('\n');

    // Should have header + 2 data rows (one billable, one non-billable entry)
    const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);
    expect(dataLines).toHaveLength(2);

    // Verify billable columns header exists
    expect(lines[0]).toContain('BillableWorkedHours');
    expect(lines[0]).toContain('NonBillableWorkedHours');
  });
});
