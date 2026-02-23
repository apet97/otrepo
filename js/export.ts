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

/**
 * Generates a CSV file from the analysis results and triggers a browser download.
 *
 * Logic:
 * 1. Defines headers corresponding to the PRD requirements.
 * 2. Iterates through all users and their daily entries.
 * 3. Sanitizes and formats each field (escaping CSV characters, preventing formula injection).
 * 4. Creates a Blob and programmatically clicks a hidden link to download.
 *
 * @param analysis - The calculated analysis results (list of user objects).
 * @param fileName - The desired filename for the download.
 */
export function downloadCsv(
    analysis: UserAnalysis[],
    fileName: string = 'otplus-report.csv'
): void {
    // Column headers describing the values in each exported row
    const headers = [
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

    // Build CSV rows with sanitized values, ensuring even empty days appear in the export
    // Build each CSV row with sanitized text to prevent formula injection
    const rows: string[] = [];

    analysis.forEach((user) => {
        Array.from(user.days.entries()).forEach(([dateKey, day]: [string, DayData]) => {
            // Ensure gapless export: include a placeholder row for days with no time entries
            // Even days without entries produce a placeholder row to keep exported data gapless
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

            // eslint-disable-next-line complexity -- CSV row generation with many data fields
            entriesToLoop.forEach((e) => {
                // Sanitize all text fields to prevent CSV injection
                const userName = sanitizeFormulaInjection(user.userName);
                const description = sanitizeFormulaInjection(e.description);
                // Access day.meta.* instead of day.*
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

                // Build row with sanitized metrics, using day metadata for status columns
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
                ].map(escapeCsv); // Use helper for consistent CSV escaping (quotes, commas, newlines)

                rows.push(row.join(','));
            });
        });
    });

    const csvContent = headers.join(',') + '\n' + rows.join('\n');
    // Prepend UTF-8 BOM (\uFEFF) for Excel compatibility with non-ASCII characters
    // Without the BOM, Excel may misinterpret UTF-8 encoded files
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Prevent memory leak by revoking object URL
    URL.revokeObjectURL(url);

    // ========================================================================
    // AUDIT LOGGING
    // ========================================================================
    // Log export operations for compliance tracking. Privacy-safe: no PII,
    // only hashed workspace ID and aggregate counts.
    // Only log if audit consent is enabled (default: true for enterprise compliance)
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
