/**
 * @fileoverview Export Module
 * Handles generating and downloading CSV reports from the analysis results.
 * Includes security measures against CSV injection and robust formatting.
 */

import {
    formatHours,
    formatHoursDecimal,
    formatCurrency,
    formatTimeHHmm,
    parseIsoDuration,
    escapeCsv,
    hashString,
    getCanonicalTimeZone,
    classifyEntryForOvertime,
    IsoUtils,
} from './utils.js';
import { createLogger } from './logger.js';
import { store } from './state.js';
import { computeSummaryRows, getCachedDetailedEntries } from './data-selectors.js';
import type { UserAnalysis, TimeEntry } from './types.js';

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
    return new Promise((resolve) => setTimeout(resolve, 0));
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

/** Day-level context pre-computed once per date to avoid redundant work per entry. */
interface DayContext {
    dateKey: string;
    userName: string;
    capacityFormatted: string;
    holidayName: string;
    isHoliday: string;
    isNonWorking: string;
    isTimeOff: string;
}

/** Formats a single entry into a CSV row string. */
function formatEntryRow(ctx: DayContext, e: TimeEntry | PlaceholderEntry): string {
    const a = e.analysis;
    const isBillable = a?.isBillable;
    const regular = a?.regular || 0;
    const overtime = a?.overtime || 0;
    const totalHours = e.timeInterval.duration ? parseIsoDuration(e.timeInterval.duration) : 0;

    return [
        ctx.dateKey,
        ctx.userName,
        sanitizeFormulaInjection(e.description),
        ctx.capacityFormatted,
        formatHours(regular),
        formatHours(overtime),
        formatHours(a?.dailyOvertime || 0),
        formatHours(a?.weeklyOvertime || 0),
        formatHours(a?.overlapOvertime || 0),
        formatHours(a?.combinedOvertime ?? overtime),
        formatHours(isBillable ? regular : 0),
        formatHours(isBillable ? overtime : 0),
        formatHours(isBillable ? 0 : regular),
        formatHours(isBillable ? 0 : overtime),
        formatHours(totalHours),
        formatHoursDecimal(totalHours),
        ctx.isHoliday,
        ctx.holidayName,
        ctx.isNonWorking,
        ctx.isTimeOff,
    ]
        .map(escapeCsv)
        .join(',');
}

/** Placeholder entry for days with no time entries. */
function makePlaceholderEntry(dateKey: string): PlaceholderEntry {
    return {
        description: '(no entries)',
        timeInterval: { start: dateKey + 'T00:00:00Z', duration: 'PT0H' },
        analysis: { regular: 0, overtime: 0, isBillable: false },
    };
}

function buildRowsForUsers(users: UserAnalysis[]): string[] {
    const rows: string[] = [];
    for (const user of users) {
        const userName = sanitizeFormulaInjection(user.userName);
        for (const [dateKey, day] of user.days) {
            const ctx: DayContext = {
                dateKey,
                userName,
                capacityFormatted: formatHours(day.meta?.capacity ?? 0),
                holidayName: sanitizeFormulaInjection(day.meta?.holidayName),
                isHoliday: day.meta?.isHoliday ? 'Yes' : 'No',
                isNonWorking: day.meta?.isNonWorking ? 'Yes' : 'No',
                isTimeOff: day.meta?.isTimeOff ? 'Yes' : 'No',
            };
            const entries = day.entries.length > 0 ? day.entries : [makePlaceholderEntry(dateKey)];
            for (const e of entries) {
                rows.push(formatEntryRow(ctx, e));
            }
        }
    }
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

    let isFirstDataChunk = true;
    for (let i = 0; i < analysis.length; i += CSV_CHUNK_SIZE) {
        const userChunk = analysis.slice(i, i + CSV_CHUNK_SIZE);
        const rows = buildRowsForUsers(userChunk);
        if (rows.length > 0) {
            if (isFirstDataChunk) {
                // Header already ends with '\n', so first data chunk needs no leading newline
                chunks.push(rows.join('\n'));
                isFirstDataChunk = false;
            } else {
                // Subsequent chunks need a leading newline so the last row of the
                // previous chunk doesn't merge with the first row of this chunk
                chunks.push('\n' + rows.join('\n'));
            }
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
                (sum, u) =>
                    sum +
                    Array.from(u.days.values()).reduce((daySum, d) => daySum + d.entries.length, 0),
                0
            ),
            dateRange: store.currentDateRange
                ? { start: store.currentDateRange.start, end: store.currentDateRange.end }
                : null,
        };
        exportLogger.info('CSV export completed', auditEntry);
    }
}

// ========================================================================
// SUMMARY CSV EXPORT
// ========================================================================

/** Column headers for summary CSV export */
const SUMMARY_CSV_HEADERS = [
    'Group',
    'Capacity',
    'Regular',
    'Overtime',
    'DailyOvertime',
    'WeeklyOvertime',
    'OverlapOvertime',
    'CombinedOvertime',
    'Breaks',
    'BillableWorked',
    'BillableOT',
    'NonBillableOT',
    'Total',
    'Vacation',
    'Amount',
    'AmountEarned',
    'AmountCost',
    'AmountProfit',
    'OTPremium',
];

/**
 * Generates a summary CSV from analysis results grouped by the specified criterion.
 *
 * @param analysis - The calculated analysis results.
 * @param groupBy - Grouping criterion ('user', 'project', 'client', 'task', 'date', 'week').
 * @param fileName - The desired filename for the download.
 */
export async function downloadSummaryCsv(
    analysis: UserAnalysis[],
    groupBy: string,
    fileName = 'otplus-summary.csv'
): Promise<void> {
    const rows = computeSummaryRows(analysis, groupBy);

    const headerLine = SUMMARY_CSV_HEADERS.join(',') + '\n';
    const chunks: string[] = ['\uFEFF' + headerLine]; // BOM + header

    const CHUNK_SIZE = 200;
    let isFirstDataChunk = true;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const csvRows = chunk.map((row) =>
            [
                sanitizeFormulaInjection(row.groupName),
                formatHours(row.capacity || 0),
                formatHours(row.regular),
                formatHours(row.overtime),
                formatHours(row.dailyOvertime),
                formatHours(row.weeklyOvertime),
                formatHours(row.overlapOvertime),
                formatHours(row.combinedOvertime),
                formatHours(row.breaks),
                formatHours(row.billableWorked),
                formatHours(row.billableOT),
                formatHours(row.nonBillableOT),
                formatHours(row.total),
                formatHours(row.vacationEntryHours),
                formatCurrency(row.amount),
                formatCurrency(row.amountEarned),
                formatCurrency(row.amountCost),
                formatCurrency(row.amountProfit),
                formatCurrency(row.otPremium),
            ]
                .map(escapeCsv)
                .join(',')
        );

        if (csvRows.length > 0) {
            if (isFirstDataChunk) {
                chunks.push(csvRows.join('\n'));
                isFirstDataChunk = false;
            } else {
                chunks.push('\n' + csvRows.join('\n'));
            }
        }

        if (i + CHUNK_SIZE < rows.length) {
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

    setTimeout(() => URL.revokeObjectURL(url), 60000);

    if (store.config.auditConsent !== false) {
        exportLogger.info('Summary CSV export completed', {
            action: 'EXPORT_SUMMARY_CSV',
            timestamp: new Date().toISOString(),
            hashedWorkspaceId: store.claims?.workspaceId
                ? hashString(store.claims.workspaceId)
                : null,
            fileName,
            groupBy,
            rowCount: rows.length,
        });
    }
}

// ========================================================================
// DETAILED CSV EXPORT
// ========================================================================

/** Column headers for detailed CSV export */
const DETAILED_CSV_HEADERS = [
    'Date',
    'StartTime',
    'EndTime',
    'User',
    'Project',
    'Client',
    'Task',
    'Description',
    'EntryType',
    'Billable',
    'EffectiveCapacity',
    'Regular',
    'Overtime',
    'DailyOT',
    'WeeklyOT',
    'OverlapOT',
    'CombinedOT',
    'BillableWorked',
    'BillableOT',
    'NonBillableWorked',
    'NonBillableOT',
    'TotalHours',
    'TotalDecimal',
    'Rate',
    'RegularAmt',
    'OvertimeAmt',
    'Tier2Amt',
    'TotalAmt',
    'isHoliday',
    'holidayName',
    'isNonWorkingDay',
    'isTimeOff',
    'Status',
];

/** Derive a text status label from entry metadata. */
function deriveStatusLabel(entry: {
    dayMeta: {
        isHoliday: boolean;
        holidayName?: string;
        isNonWorking: boolean;
        isTimeOff: boolean;
    };
    type?: string;
}): string {
    const parts: string[] = [];
    const normalizedType = String(entry.type || '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
    const entryClass = classifyEntryForOvertime(entry);
    const isHolidayEntry = normalizedType === 'HOLIDAY' || normalizedType === 'HOLIDAY_TIME_ENTRY';
    const isTimeOffEntry =
        normalizedType === 'TIME_OFF' ||
        normalizedType === 'TIMEOFF' ||
        normalizedType === 'TIME_OFF_TIME_ENTRY';

    if (isHolidayEntry) parts.push('HOLIDAY ENTRY');
    if (isTimeOffEntry) parts.push('TIME-OFF ENTRY');

    if (!isHolidayEntry && !isTimeOffEntry) {
        if (entry.dayMeta.isHoliday) parts.push('HOLIDAY');
        if (entry.dayMeta.isTimeOff) parts.push('TIME-OFF');
        if (entry.dayMeta.isNonWorking) parts.push('OFF-DAY');
        if (entryClass === 'break') parts.push('BREAK');
    }

    return parts.join('; ');
}

/** Formats a single detailed entry into a CSV row string. */
// eslint-disable-next-line complexity -- Row builder maps 33 columns with many null-coalescing fallbacks
function formatDetailedEntryRow(
    e: TimeEntry & {
        dayMeta: {
            isHoliday: boolean;
            holidayName?: string;
            isNonWorking: boolean;
            isTimeOff: boolean;
            capacity?: number;
        };
    },
    tz: string
): string {
    const a = e.analysis;
    const isBillable = a?.isBillable === true;
    const regular = a?.regular || 0;
    const overtime = a?.overtime || 0;
    const totalHours = e.timeInterval.duration ? parseIsoDuration(e.timeInterval.duration) : 0;
    const date =
        IsoUtils.extractDateKey(e.timeInterval.start) || (e.timeInterval.start || '').split('T')[0];

    return [
        date,
        formatTimeHHmm(e.timeInterval?.start, tz),
        formatTimeHHmm(e.timeInterval?.end, tz),
        sanitizeFormulaInjection(e.userName),
        sanitizeFormulaInjection(e.projectName || ''),
        sanitizeFormulaInjection(e.clientName || ''),
        sanitizeFormulaInjection(e.taskName || ''),
        sanitizeFormulaInjection(e.description),
        sanitizeFormulaInjection(e.type || ''),
        isBillable ? 'Yes' : 'No',
        formatHours(e.dayMeta?.capacity ?? 0),
        formatHours(regular),
        formatHours(overtime),
        formatHours(a?.dailyOvertime || 0),
        formatHours(a?.weeklyOvertime || 0),
        formatHours(a?.overlapOvertime || 0),
        formatHours(a?.combinedOvertime ?? overtime),
        formatHours(isBillable ? regular : 0),
        formatHours(isBillable ? overtime : 0),
        formatHours(isBillable ? 0 : regular),
        formatHours(isBillable ? 0 : overtime),
        formatHours(totalHours),
        formatHoursDecimal(totalHours),
        formatCurrency(a?.hourlyRate || 0),
        formatCurrency(a?.regularAmount || 0),
        formatCurrency((a?.overtimeAmountBase || 0) + (a?.tier1Premium || 0)),
        formatCurrency(a?.tier2Premium || 0),
        formatCurrency(a?.totalAmountWithOT || 0),
        e.dayMeta?.isHoliday ? 'Yes' : 'No',
        sanitizeFormulaInjection(e.dayMeta?.holidayName),
        e.dayMeta?.isNonWorking ? 'Yes' : 'No',
        e.dayMeta?.isTimeOff ? 'Yes' : 'No',
        deriveStatusLabel(e),
    ]
        .map(escapeCsv)
        .join(',');
}

/**
 * Generates a detailed CSV from analysis results (one row per time entry).
 *
 * @param analysis - The calculated analysis results.
 * @param fileName - The desired filename for the download.
 */
export async function downloadDetailedCsv(
    analysis: UserAnalysis[],
    fileName = 'otplus-detailed.csv'
): Promise<void> {
    const entries = getCachedDetailedEntries(analysis);
    const canonicalTimeZone = getCanonicalTimeZone();

    const headerLine = DETAILED_CSV_HEADERS.join(',') + '\n';
    const chunks: string[] = ['\uFEFF' + headerLine]; // BOM + header

    const CHUNK_SIZE = 500;
    let isFirstDataChunk = true;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const csvRows = chunk.map((e) => formatDetailedEntryRow(e, canonicalTimeZone));

        if (csvRows.length > 0) {
            if (isFirstDataChunk) {
                chunks.push(csvRows.join('\n'));
                isFirstDataChunk = false;
            } else {
                chunks.push('\n' + csvRows.join('\n'));
            }
        }

        if (i + CHUNK_SIZE < entries.length) {
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

    setTimeout(() => URL.revokeObjectURL(url), 60000);

    if (store.config.auditConsent !== false) {
        exportLogger.info('Detailed CSV export completed', {
            action: 'EXPORT_DETAILED_CSV',
            timestamp: new Date().toISOString(),
            hashedWorkspaceId: store.claims?.workspaceId
                ? hashString(store.claims.workspaceId)
                : null,
            fileName,
            entryCount: entries.length,
        });
    }
}
