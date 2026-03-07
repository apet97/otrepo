/**
 * @fileoverview Export Module
 * Handles generating and downloading CSV reports from the analysis results.
 * Includes security measures against CSV injection and robust formatting.
 */

import { formatHours, formatHoursDecimal, parseIsoDuration, escapeCsv, hashString } from './utils.js';
import { createLogger } from './logger.js';
import { store } from './state.js';
import type { UserAnalysis, TimeEntry, DayData } from './types.js';

/** Logger for export audit events */
const exportLogger = createLogger('Export');

/**
 * Sanitizes a string to prevent CSV formula injection (DDE attacks).
 *
 * ## Attack Vector: CSV Injection (Formula Injection)
 * If a CSV field starts with =, +, -, @, tab, or carriage return, spreadsheet
 * applications (Excel, Google Sheets, LibreOffice) may interpret it as a formula
 * instead of text. This can be exploited to execute arbitrary commands on the
 * victim's machine (DDE injection) or exfiltrate data via external links.
 *
 * ## Mitigation Strategy: Character Escaping
 * We prepend a single quote (') to any field starting with a trigger character.
 * This forces the spreadsheet software to treat the cell content as a string literal.
 * This is the industry-standard mitigation recommended by OWASP.
 *
 * ## Trade-offs & Compatibility
 * - **Visible Quote**: The single quote might be visible in plain text editors or
 *   some CSV parsers. This is an acceptable security trade-off.
 * - **Excel/Sheets**: These apps hide the leading quote when displaying the cell,
 *   so the user experience remains clean.
 *
 * @param str - The string to sanitize.
 * @returns Sanitized string safe for CSV, or empty string if input is falsy.
 */
function sanitizeFormulaInjection(str: string | null | undefined): string {
    if (!str) return '';
    const value = String(str)
        .replace(/\p{Cc}/gu, '')
        .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
    // Check for formula injection characters at start: =, +, -, @, tab, CR, LF, pipe
    if (/^[=+\-@\t\r\n|]/.test(value)) {
        return "'" + value;
    }
    return value;
}

/**
 * Placeholder entry for days without time entries
 */
interface PlaceholderEntry {
    description: string;
    timeInterval: {
        start: string;
        duration: string;
    };
    analysis: {
        regular: number;
        overtime: number;
        dailyOvertime?: number;
        weeklyOvertime?: number;
        overlapOvertime?: number;
        combinedOvertime?: number;
        isBillable: boolean;
    };
}

/** Number of users per chunk when building CSV rows */
const CSV_CHUNK_SIZE = 50;

/**
 * Yields control back to the event loop to prevent UI freezing during large exports.
 */
function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/** Column headers describing the values in each exported row */
const CSV_HEADERS = [
    'Date',
    'User',
    'Description',
    'EffectiveCapacityHours',
    'RegularHours',
    'OvertimeHours',
    'DailyOvertimeHours',
    'WeeklyOvertimeHours',
    'OverlapOvertimeHours',
    'CombinedOvertimeHours',
    'BillableWorkedHours',
    'BillableOTHours',
    'NonBillableWorkedHours',
    'NonBillableOTHours',
    'TotalHours',
    'TotalHoursDecimal',
    'isHoliday',
    'holidayName',
    'isNonWorkingDay',
    'isTimeOff',
];

/**
 * Builds CSV rows for a chunk of users.
 * Extracted to keep the main export function focused on orchestration.
 */
// eslint-disable-next-line complexity -- CSV row generation with many data fields
function buildRowsForUsers(users: UserAnalysis[]): string[] {
    const rows: string[] = [];
    users.forEach((user) => {
        Array.from(user.days.entries()).forEach(([dateKey, day]: [string, DayData]) => {
            const entriesToLoop: (TimeEntry | PlaceholderEntry)[] =
                day.entries.length > 0
                    ? day.entries
                    : [
                          {
                              description: '(no entries)',
                              timeInterval: {
                                  start: dateKey + 'T00:00:00Z',
                                  duration: 'PT0H',
                              },
                              analysis: { regular: 0, overtime: 0, isBillable: false },
                          },
                      ];

            entriesToLoop.forEach((e) => {
                const userName = sanitizeFormulaInjection(user.userName);
                const description = sanitizeFormulaInjection(e.description);
                const holidayName = sanitizeFormulaInjection(day.meta?.holidayName);

                const billableWorked = e.analysis?.isBillable ? e.analysis?.regular || 0 : 0;
                const billableOT = e.analysis?.isBillable ? e.analysis?.overtime || 0 : 0;
                const nonBillableWorked = !e.analysis?.isBillable ? e.analysis?.regular || 0 : 0;
                const nonBillableOT = !e.analysis?.isBillable ? e.analysis?.overtime || 0 : 0;
                const dailyOT = e.analysis?.dailyOvertime || 0;
                const weeklyOT = e.analysis?.weeklyOvertime || 0;
                const overlapOT = e.analysis?.overlapOvertime || 0;
                const combinedOT = e.analysis?.combinedOvertime ?? e.analysis?.overtime ?? 0;
                const totalHours = e.timeInterval.duration
                    ? parseIsoDuration(e.timeInterval.duration)
                    : 0;

                const row = [
                    dateKey,
                    userName,
                    description,
                    formatHours(day.meta?.capacity ?? 0),
                    formatHours(e.analysis?.regular || 0),
                    formatHours(e.analysis?.overtime || 0),
                    formatHours(dailyOT),
                    formatHours(weeklyOT),
                    formatHours(overlapOT),
                    formatHours(combinedOT),
                    formatHours(billableWorked),
                    formatHours(billableOT),
                    formatHours(nonBillableWorked),
                    formatHours(nonBillableOT),
                    formatHours(totalHours),
                    formatHoursDecimal(totalHours),
                    day.meta?.isHoliday ? 'Yes' : 'No',
                    holidayName,
                    day.meta?.isNonWorking ? 'Yes' : 'No',
                    day.meta?.isTimeOff ? 'Yes' : 'No',
                ].map(escapeCsv);

                rows.push(row.join(','));
            });
        });
    });
    return rows;
}

/**
 * Generates a CSV file from the analysis results and triggers a browser download.
 *
 * Processes users in chunks of CSV_CHUNK_SIZE (50) to avoid blocking the UI thread.
 * For datasets with <= CSV_CHUNK_SIZE users, completes synchronously within the
 * same microtask (no yield). Constructs the final Blob from pre-built chunk strings
 * to avoid a single large concatenation.
 *
 * @param analysis - The calculated analysis results (list of user objects).
 * @param fileName - The desired filename for the download.
 */
export async function downloadCsv(
    analysis: UserAnalysis[],
    fileName: string = 'otplus-report.csv'
): Promise<void> {
    // Build CSV in chunks, yielding between chunks for large datasets
    const headerLine = CSV_HEADERS.join(',') + '\n';
    const chunks: string[] = ['\uFEFF' + headerLine]; // BOM + header as first chunk

    for (let i = 0; i < analysis.length; i += CSV_CHUNK_SIZE) {
        const userChunk = analysis.slice(i, i + CSV_CHUNK_SIZE);
        const rows = buildRowsForUsers(userChunk);
        if (rows.length > 0) {
            // Add newline prefix for chunks after the header
            chunks.push(rows.join('\n'));
        }
        // Yield to event loop between chunks (but not after the last one)
        if (i + CSV_CHUNK_SIZE < analysis.length) {
            await yieldToEventLoop();
        }
    }

    const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Delay cleanup to ensure the browser has time to initiate the download
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    // ========================================================================
    // AUDIT LOGGING
    // ========================================================================
    if (store.config.auditConsent !== false) {
        const auditEntry = {
            action: 'EXPORT_CSV',
            timestamp: new Date().toISOString(),
            hashedWorkspaceId: store.claims?.workspaceId
                ? hashString(store.claims.workspaceId)
                : null,
            fileName,
            userCount: analysis.length,
            totalEntries: analysis.reduce(
                (sum, u) => sum + Array.from(u.days.values()).reduce((daySum, d) => daySum + d.entries.length, 0),
                0
            ),
            dateRange: store.currentDateRange
                ? { start: store.currentDateRange.start, end: store.currentDateRange.end }
                : null,
        };
        exportLogger.info('CSV export completed', auditEntry);
    }
}
