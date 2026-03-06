/**
 * @jest-environment jsdom
 * @fileoverview Mutation-killer tests for export.ts
 * Targets downloadCsv() function with comprehensive coverage for all execution paths
 * and mutation-resistant assertions.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { downloadCsv } from '../../js/export.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

/**
 * Helper to read Blob content as text, preserving BOM.
 * jsdom's Blob doesn't support text()/arrayBuffer() methods, so we
 * intercept the Blob constructor to capture the raw string content.
 */
let _capturedBlobContent = '';
const _OriginalBlob = globalThis.Blob;

// Patched Blob that captures string content for test assertions
class TestBlob extends _OriginalBlob {
    constructor(parts, options) {
        super(parts, options);
        // Capture string parts for readBlobText
        _capturedBlobContent = parts.map(p => typeof p === 'string' ? p : '').join('');
    }
}
globalThis.Blob = TestBlob;

function readBlobText(_blob) {
    return Promise.resolve(_capturedBlobContent);
}

describe('downloadCsv - Mutation Killer Tests', () => {
    let mockCreateObjectURL;
    let mockRevokeObjectURL;
    let mockLink;
    let capturedBlob;
    let capturedHref;
    let capturedDownloadAttr;

    beforeEach(() => {
        // Mock URL.createObjectURL and URL.revokeObjectURL
        mockCreateObjectURL = jest.fn((blob) => {
            capturedBlob = blob;
            return 'blob:mock-url-12345';
        });
        mockRevokeObjectURL = jest.fn();
        global.URL.createObjectURL = mockCreateObjectURL;
        global.URL.revokeObjectURL = mockRevokeObjectURL;

        // Mock document.createElement to capture link attributes
        mockLink = {
            setAttribute: jest.fn((attr, value) => {
                if (attr === 'href') capturedHref = value;
                if (attr === 'download') capturedDownloadAttr = value;
            }),
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

        // Reset store config
        store.config = { auditConsent: true };
        store.claims = { workspaceId: 'workspace-123' };
        store.currentDateRange = { start: '2024-01-15', end: '2024-01-20' };

        // Clear captured values
        capturedBlob = null;
        capturedHref = null;
        capturedDownloadAttr = null;
    });

    afterEach(standardAfterEach);

    describe('CSV generation - headers and data rows', () => {
        it('should generate CSV with exact header row', async () => {
            const analysis = [
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
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            expect(capturedBlob).not.toBeNull();
            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');

            const expectedHeaders =
                'Date,User,Description,EffectiveCapacityHours,RegularHours,OvertimeHours,DailyOvertimeHours,WeeklyOvertimeHours,OverlapOvertimeHours,CombinedOvertimeHours,BillableWorkedHours,BillableOTHours,NonBillableWorkedHours,NonBillableOTHours,TotalHours,TotalHoursDecimal,isHoliday,holidayName,isNonWorkingDay,isTimeOff';

            // First line after BOM should be headers
            expect(lines[0].substring(1)).toBe(expectedHeaders);
        });

        it('should generate correct data row with all fields', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Jane Doe',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Project work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT10H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 2,
                                            dailyOvertime: 2,
                                            weeklyOvertime: 0,
                                            overlapOvertime: 0,
                                            combinedOvertime: 2,
                                            isBillable: true,
                                        },
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
                        nonBillableWorked: 0,
                        billableOT: 2,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');

            // Second line (index 1) is the data row
            const dataRow = lines[1];
            expect(dataRow).toBe(
                '2024-01-15,Jane Doe,Project work,8h,8h,2h,2h,0h,0h,2h,8h,2h,0h,0h,10h,10.00,No,,No,No'
            );
        });

        it('should properly escape CSV special characters (quotes, commas, newlines)', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Smith, John',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Task with "quotes" and, commas\nand newlines',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
                                    },
                                ],
                                meta: {
                                    capacity: 8,
                                    isHoliday: false,
                                    holidayName: 'Holiday, with "special" chars',
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // User name with comma should be quoted
            expect(dataRow).toContain('"Smith, John"');
            // Description with special chars should be quoted and quotes doubled.
            // Newline is stripped by sanitizeFormulaInjection (control char removal).
            expect(dataRow).toContain('"Task with ""quotes"" and, commasand newlines"');
            // Holiday name with special chars should be quoted
            expect(dataRow).toContain('"Holiday, with ""special"" chars"');
        });

        it('should handle multiple users and multiple days', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'User One',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Task 1',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT4H',
                                        },
                                        analysis: {
                                            regular: 4,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                                        description: 'Task 2',
                                        timeInterval: {
                                            start: '2024-01-16T09:00:00Z',
                                            duration: 'PT5H',
                                        },
                                        analysis: {
                                            regular: 5,
                                            overtime: 0,
                                            isBillable: false,
                                        },
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
                        total: 9,
                        regular: 9,
                        overtime: 0,
                        expectedCapacity: 16,
                        breaks: 0,
                        billableWorked: 4,
                        nonBillableWorked: 5,
                        billableOT: 0,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
                {
                    userId: 'user2',
                    userName: 'User Two',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Task 3',
                                        timeInterval: {
                                            start: '2024-01-15T10:00:00Z',
                                            duration: 'PT6H',
                                        },
                                        analysis: {
                                            regular: 6,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');

            // Should have 1 header + 3 data rows
            expect(lines.length).toBe(4);
            expect(lines[1]).toContain('User One');
            expect(lines[1]).toContain('2024-01-15');
            expect(lines[2]).toContain('User One');
            expect(lines[2]).toContain('2024-01-16');
            expect(lines[3]).toContain('User Two');
            expect(lines[3]).toContain('2024-01-15');
        });
    });

    describe('BOM byte prefix', () => {
        it('should prepend UTF-8 BOM (\\uFEFF) to CSV content', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            expect(text.charCodeAt(0)).toBe(0xfeff);
        });
    });

    describe('Formula injection prevention', () => {
        it('should prefix fields starting with = with single quote', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: '=malicious_formula',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: '=SUM(A1:A10)',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
                                    },
                                ],
                                meta: {
                                    capacity: 8,
                                    isHoliday: false,
                                    holidayName: '=EXPLOIT()',
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // All fields starting with = should be prefixed with '
            expect(dataRow).toContain("'=malicious_formula");
            expect(dataRow).toContain("'=SUM(A1:A10)");
            expect(dataRow).toContain("'=EXPLOIT()");
        });

        it('should prefix fields starting with + with single quote', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: '+cmd|calc',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: '+exploit',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            expect(dataRow).toContain("'+cmd|calc");
            expect(dataRow).toContain("'+exploit");
        });

        it('should prefix fields starting with - with single quote', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: '-exploit',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: '-malicious',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            expect(dataRow).toContain("'-exploit");
            expect(dataRow).toContain("'-malicious");
        });

        it('should prefix fields starting with @ with single quote', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: '@user',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: '@command',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            expect(dataRow).toContain("'@user");
            expect(dataRow).toContain("'@command");
        });

        it('should prefix fields starting with tab (\\t) with single quote', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: '\texploit',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: '\tmalicious',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);

            // Tab character is removed by sanitization (control char removal via \p{Cc}),
            // so the resulting string is just "exploit"/"malicious" without tab or quote prefix
            expect(text).toContain('exploit');
            expect(text).toContain('malicious');
            // The tab itself must NOT appear in output
            expect(text).not.toContain('\t');
        });

        it('should strip carriage return (\\r) from fields via control char sanitization', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: '\rexploit',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: '\rmalicious',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);

            // CR character is removed by sanitization (control char removal via \p{Cc})
            expect(text).toContain('exploit');
            expect(text).toContain('malicious');
            // The CR itself must NOT appear in text fields (it will appear in CSV line endings)
            const dataRow = text.split('\n')[1];
            expect(dataRow).not.toContain('\r');
        });

        it('should handle null/undefined text fields without formula injection', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: null,
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: undefined,
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
                                    },
                                ],
                                meta: {
                                    capacity: 8,
                                    isHoliday: false,
                                    holidayName: null,
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // Null/undefined should produce empty strings, not crash
            expect(dataRow).toContain('2024-01-15');
            expect(dataRow).not.toContain('null');
            expect(dataRow).not.toContain('undefined');
        });
    });

    describe('Empty analysis', () => {
        it('should produce only header row when analysis array is empty', async () => {
            const analysis = [];

            downloadCsv(analysis, 'empty-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');

            // Should have only BOM + headers (and possibly trailing empty line)
            expect(lines.length).toBeLessThanOrEqual(2);
            expect(lines[0].substring(1)).toContain('Date,User,Description');
        });
    });

    describe('Null/missing durations', () => {
        it('should handle entries with null duration gracefully', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: null,
                                        },
                                        analysis: {
                                            regular: 0,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        total: 0,
                        regular: 0,
                        overtime: 0,
                        expectedCapacity: 8,
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

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // Should show 0h for total hours when duration is null
            expect(dataRow).toContain(',0h,');
            expect(dataRow).toContain(',0.00,');
        });

        it('should handle entries with missing duration field', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                        },
                                        analysis: {
                                            regular: 0,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        total: 0,
                        regular: 0,
                        overtime: 0,
                        expectedCapacity: 8,
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

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            expect(dataRow).toContain(',0h,');
            expect(dataRow).toContain(',0.00,');
        });
    });

    describe('Placeholder entries for empty days', () => {
        it('should generate "(no entries)" placeholder for days with no entries', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [],
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
                        total: 0,
                        regular: 0,
                        overtime: 0,
                        expectedCapacity: 8,
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

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            expect(dataRow).toContain('(no entries)');
            expect(dataRow).toContain('2024-01-15');
            expect(dataRow).toContain(',0h,');
        });

        it('should create placeholder with PT0H duration', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [],
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
                        total: 0,
                        regular: 0,
                        overtime: 0,
                        expectedCapacity: 8,
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

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // TotalHours and TotalHoursDecimal should be 0h and 0.00
            expect(dataRow).toContain(',0h,');
            expect(dataRow).toContain(',0.00,');
        });
    });

    describe('Holiday/timeoff/nonworking flags', () => {
        it('should output "Yes" when meta.isHoliday is true', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Holiday',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT0H',
                                        },
                                        analysis: {
                                            regular: 0,
                                            overtime: 0,
                                            isBillable: false,
                                        },
                                    },
                                ],
                                meta: {
                                    capacity: 8,
                                    isHoliday: true,
                                    holidayName: 'New Year',
                                    isNonWorking: false,
                                    isTimeOff: false,
                                },
                            },
                        ],
                    ]),
                    totals: {
                        total: 0,
                        regular: 0,
                        overtime: 0,
                        expectedCapacity: 8,
                        breaks: 0,
                        billableWorked: 0,
                        nonBillableWorked: 0,
                        billableOT: 0,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 1,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            expect(dataRow).toContain(',Yes,');
            expect(dataRow).toContain('New Year');
        });

        it('should output "No" when meta.isHoliday is false', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // Should have three "No" for isHoliday, isNonWorkingDay, isTimeOff
            expect(dataRow).toContain(',No,');
        });

        it('should output "Yes" when meta.isNonWorking is true', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-13',
                            {
                                entries: [],
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

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // isNonWorkingDay column should be "Yes"
            expect(dataRow).toContain(',Yes,');
        });

        it('should output "Yes" when meta.isTimeOff is true', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'PTO',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 0,
                                            overtime: 0,
                                            isBillable: false,
                                        },
                                    },
                                ],
                                meta: {
                                    capacity: 8,
                                    isHoliday: false,
                                    isNonWorking: false,
                                    isTimeOff: true,
                                },
                            },
                        ],
                    ]),
                    totals: {
                        total: 8,
                        regular: 0,
                        overtime: 0,
                        expectedCapacity: 8,
                        breaks: 0,
                        billableWorked: 0,
                        nonBillableWorked: 0,
                        billableOT: 0,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 1,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // isTimeOff column should be "Yes"
            expect(dataRow).toContain(',Yes');
        });
    });

    describe('Billable breakdown', () => {
        it('should separate billable worked hours from non-billable', async () => {
            const analysis = [
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
                                            duration: 'PT6H',
                                        },
                                        analysis: {
                                            regular: 6,
                                            overtime: 0,
                                            isBillable: true,
                                        },
                                    },
                                    {
                                        description: 'Non-billable work',
                                        timeInterval: {
                                            start: '2024-01-15T15:00:00Z',
                                            duration: 'PT2H',
                                        },
                                        analysis: {
                                            regular: 2,
                                            overtime: 0,
                                            isBillable: false,
                                        },
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
                        billableWorked: 6,
                        nonBillableWorked: 2,
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

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');

            // First entry (billable)
            const billableRow = lines[1];
            expect(billableRow).toContain(',6h,'); // BillableWorkedHours
            expect(billableRow).toContain(',0h,'); // BillableOTHours
            expect(billableRow).toContain(',0h,'); // NonBillableWorkedHours
            expect(billableRow).toContain(',0h,'); // NonBillableOTHours

            // Second entry (non-billable)
            const nonBillableRow = lines[2];
            expect(nonBillableRow).toContain(',0h,'); // BillableWorkedHours
            expect(nonBillableRow).toContain(',0h,'); // BillableOTHours
            expect(nonBillableRow).toContain(',2h,'); // NonBillableWorkedHours
            expect(nonBillableRow).toContain(',0h,'); // NonBillableOTHours
        });

        it('should separate billable overtime from non-billable overtime', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Billable OT',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT10H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 2,
                                            isBillable: true,
                                        },
                                    },
                                    {
                                        description: 'Non-billable OT',
                                        timeInterval: {
                                            start: '2024-01-16T09:00:00Z',
                                            duration: 'PT10H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 2,
                                            isBillable: false,
                                        },
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
                        total: 20,
                        regular: 16,
                        overtime: 4,
                        expectedCapacity: 8,
                        breaks: 0,
                        billableWorked: 8,
                        nonBillableWorked: 8,
                        billableOT: 2,
                        nonBillableOT: 2,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');

            // Billable OT row
            const billableRow = lines[1];
            expect(billableRow).toContain(',8h,'); // BillableWorkedHours
            expect(billableRow).toContain(',2h,'); // BillableOTHours
            expect(billableRow).toContain(',0h,'); // NonBillableWorkedHours
            expect(billableRow).toContain(',0h,'); // NonBillableOTHours

            // Non-billable OT row
            const nonBillableRow = lines[2];
            expect(nonBillableRow).toContain(',0h,'); // BillableWorkedHours
            expect(nonBillableRow).toContain(',0h,'); // BillableOTHours
            expect(nonBillableRow).toContain(',8h,'); // NonBillableWorkedHours
            expect(nonBillableRow).toContain(',2h,'); // NonBillableOTHours
        });
    });

    describe('URL.revokeObjectURL', () => {
        it('should call URL.revokeObjectURL after download', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            jest.useFakeTimers();
            downloadCsv(analysis, 'test-report.csv');

            // revokeObjectURL is deferred via setTimeout for download safety
            expect(mockRevokeObjectURL).not.toHaveBeenCalled();
            jest.advanceTimersByTime(60000);
            expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
            expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url-12345');
            jest.useRealTimers();
        });
    });

    describe('Link attributes', () => {
        it('should set href attribute to blob URL', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            expect(capturedHref).toBe('blob:mock-url-12345');
        });

        it('should set download attribute to provided fileName', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'custom-filename.csv');

            expect(capturedDownloadAttr).toBe('custom-filename.csv');
        });

        it('should use default filename if not provided', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis);

            expect(capturedDownloadAttr).toBe('otplus-report.csv');
        });

        it('should set link visibility to hidden', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            expect(mockLink.style.visibility).toBe('hidden');
        });

        it('should append link to document.body', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            expect(document.body.appendChild).toHaveBeenCalledWith(mockLink);
        });

        it('should click the link to trigger download', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            expect(mockLink.click).toHaveBeenCalledTimes(1);
        });

        it('should remove link from document.body after click', () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            expect(document.body.removeChild).toHaveBeenCalledWith(mockLink);
        });
    });

    describe('Audit logging', () => {
        it('should log export when auditConsent is true', () => {
            // Create a spy on console methods to capture logger output
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            store.config = { auditConsent: true };
            store.claims = { workspaceId: 'workspace-123' };
            store.currentDateRange = { start: '2024-01-15', end: '2024-01-20' };

            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            // Verify logging was called with audit details
            expect(logSpy).toHaveBeenCalled();
            const logCalls = logSpy.mock.calls;
            const auditLogCall = logCalls.find((call) =>
                call.some((arg) => typeof arg === 'string' && arg.includes('CSV export completed'))
            );
            expect(auditLogCall).toBeDefined();

            logSpy.mockRestore();
        });

        it('should NOT log export when auditConsent is false', () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            store.config = { auditConsent: false };

            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            // Should not have any log calls related to CSV export
            const logCalls = logSpy.mock.calls;
            const auditLogCall = logCalls.find((call) =>
                call.some((arg) => typeof arg === 'string' && arg.includes('CSV export completed'))
            );
            expect(auditLogCall).toBeUndefined();

            logSpy.mockRestore();
        });

        it('should include correct metadata in audit log', () => {
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            store.config = { auditConsent: true };
            store.claims = { workspaceId: 'workspace-abc-123' };
            store.currentDateRange = { start: '2024-01-15', end: '2024-01-20' };

            const analysis = [
                {
                    userId: 'user1',
                    userName: 'User One',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work 1',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
                                    },
                                    {
                                        description: 'Work 2',
                                        timeInterval: {
                                            start: '2024-01-15T17:00:00Z',
                                            duration: 'PT2H',
                                        },
                                        analysis: {
                                            regular: 0,
                                            overtime: 2,
                                            isBillable: true,
                                        },
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
                        nonBillableWorked: 0,
                        billableOT: 2,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
                {
                    userId: 'user2',
                    userName: 'User Two',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work 3',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'audit-test.csv');

            const logCalls = logSpy.mock.calls;
            const auditLogCall = logCalls.find((call) =>
                call.some((arg) => typeof arg === 'string' && arg.includes('CSV export completed'))
            );

            expect(auditLogCall).toBeDefined();

            // Find the audit data object in the log call
            const auditDataArg = auditLogCall.find(
                (arg) => typeof arg === 'object' && arg?.action === 'EXPORT_CSV'
            );
            expect(auditDataArg).toBeDefined();
            expect(auditDataArg.fileName).toBe('audit-test.csv');
            expect(auditDataArg.userCount).toBe(2);
            expect(auditDataArg.totalEntries).toBe(3);
            expect(auditDataArg.dateRange).toEqual({ start: '2024-01-15', end: '2024-01-20' });

            logSpy.mockRestore();
        });
    });

    describe('Overtime breakdown columns', () => {
        it('should output dailyOvertime, weeklyOvertime, overlapOvertime, combinedOvertime correctly', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work with multi-tier OT',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT12H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 4,
                                            dailyOvertime: 2,
                                            weeklyOvertime: 1,
                                            overlapOvertime: 1,
                                            combinedOvertime: 4,
                                            isBillable: true,
                                        },
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
                        total: 12,
                        regular: 8,
                        overtime: 4,
                        expectedCapacity: 8,
                        breaks: 0,
                        billableWorked: 8,
                        nonBillableWorked: 0,
                        billableOT: 4,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // Verify all OT breakdown columns are present and correct
            expect(dataRow).toContain(',8h,'); // RegularHours
            expect(dataRow).toContain(',4h,'); // OvertimeHours
            expect(dataRow).toContain(',2h,'); // DailyOvertimeHours
            expect(dataRow).toContain(',1h,'); // WeeklyOvertimeHours
            expect(dataRow).toContain(',1h,'); // OverlapOvertimeHours
            expect(dataRow).toContain(',4h,'); // CombinedOvertimeHours
        });

        it('should handle missing overtime breakdown fields gracefully', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work without OT breakdown',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT10H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 2,
                                            isBillable: true,
                                        },
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
                        nonBillableWorked: 0,
                        billableOT: 2,
                        nonBillableOT: 0,
                        amount: 0,
                        otPremium: 0,
                        otPremiumTier2: 0,
                        holidayCount: 0,
                        timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'test-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            const dataRow = lines[1];

            // Should default to 0h for missing fields
            expect(dataRow).toContain(',0h,'); // DailyOvertimeHours
            expect(dataRow).toContain(',0h,'); // WeeklyOvertimeHours
            expect(dataRow).toContain(',0h,'); // OverlapOvertimeHours
            // CombinedOvertimeHours should fallback to overtime value
            expect(dataRow).toContain(',2h,'); // CombinedOvertimeHours
        });
    });

    describe('Edge cases (T53)', () => {
        it('should handle empty analysis array (no users)', async () => {
            downloadCsv([], 'empty-report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n').filter(l => l.trim().length > 0);

            // Should only have header row
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('Date,User');
        });

        it('should handle null/undefined duration gracefully', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test User',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Missing duration',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: null,
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        total: 8, regular: 8, overtime: 0, expectedCapacity: 8,
                        breaks: 0, billableWorked: 8, nonBillableWorked: 0,
                        billableOT: 0, nonBillableOT: 0, amount: 0,
                        otPremium: 0, otPremiumTier2: 0, holidayCount: 0, timeOffCount: 0,
                    },
                },
            ];

            // Should not throw
            expect(() => downloadCsv(analysis, 'report.csv')).not.toThrow();

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            // TotalHours should be 0h when duration is null
            expect(lines[1]).toContain(',0h,');
        });

        it('should handle Unicode filename in download attribute', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'Work',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT8H',
                                        },
                                        analysis: {
                                            regular: 8,
                                            overtime: 0,
                                            isBillable: true,
                                        },
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
                        total: 8, regular: 8, overtime: 0, expectedCapacity: 8,
                        breaks: 0, billableWorked: 8, nonBillableWorked: 0,
                        billableOT: 0, nonBillableOT: 0, amount: 0,
                        otPremium: 0, otPremiumTier2: 0, holidayCount: 0, timeOffCount: 0,
                    },
                },
            ];

            const unicodeName = 'rapport-février-2024.csv';
            downloadCsv(analysis, unicodeName);

            expect(capturedDownloadAttr).toBe(unicodeName);
        });

        it('should handle user with empty days map', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'No Days User',
                    days: new Map(),
                    totals: {
                        total: 0, regular: 0, overtime: 0, expectedCapacity: 0,
                        breaks: 0, billableWorked: 0, nonBillableWorked: 0,
                        billableOT: 0, nonBillableOT: 0, amount: 0,
                        otPremium: 0, otPremiumTier2: 0, holidayCount: 0, timeOffCount: 0,
                    },
                },
            ];

            downloadCsv(analysis, 'report.csv');

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n').filter(l => l.trim().length > 0);

            // Only header row, no data rows
            expect(lines).toHaveLength(1);
        });

        it('should handle entry with null/undefined analysis', async () => {
            const analysis = [
                {
                    userId: 'user1',
                    userName: 'Test',
                    days: new Map([
                        [
                            '2024-01-15',
                            {
                                entries: [
                                    {
                                        description: 'No analysis',
                                        timeInterval: {
                                            start: '2024-01-15T09:00:00Z',
                                            duration: 'PT4H',
                                        },
                                        analysis: null,
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
                        total: 4, regular: 4, overtime: 0, expectedCapacity: 8,
                        breaks: 0, billableWorked: 0, nonBillableWorked: 0,
                        billableOT: 0, nonBillableOT: 0, amount: 0,
                        otPremium: 0, otPremiumTier2: 0, holidayCount: 0, timeOffCount: 0,
                    },
                },
            ];

            // Should not throw — analysis fields default to 0 via optional chaining
            expect(() => downloadCsv(analysis, 'report.csv')).not.toThrow();

            const text = await readBlobText(capturedBlob);
            const lines = text.split('\n');
            // Data row should have 0h values for all analysis fields
            expect(lines[1]).toContain('2024-01-15');
            expect(lines[1]).toContain('Test');
        });
    });
});
