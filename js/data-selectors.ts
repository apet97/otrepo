/**
 * @fileoverview Data Selectors
 * Pure data transforms and store selectors for use by export and other non-UI consumers.
 * This module owns the data-layer transforms; UI modules import from here, not vice versa.
 */

import { store } from './state.js';
import type { UserAnalysis, SummaryRow, TimeEntry, DayMeta } from './types.js';
import {
    parseIsoDuration,
    classifyEntryForOvertime,
    formatDate,
    getWeekKey,
    formatWeekKey,
} from './utils.js';

// ========================================================================
// DETAILED ENTRIES — Data transform + reference-equality cache
// ========================================================================

/**
 * Extended entry with day metadata, used by both detailed table UI and export.
 */
export interface DetailedEntry extends TimeEntry {
    dayMeta: DayMeta;
}

let _cachedDetailedEntries: DetailedEntry[] | null = null;
let _cachedDetailedUsersRef: UserAnalysis[] | null = null;

/**
 * Flattens UserAnalysis[] into a sorted list of DetailedEntry objects.
 * Results are cached by reference equality on the input array.
 */
export function getCachedDetailedEntries(users: UserAnalysis[]): DetailedEntry[] {
    if (_cachedDetailedUsersRef !== users || _cachedDetailedEntries === null) {
        _cachedDetailedEntries = users
            .flatMap((u) =>
                Array.from(u.days.values()).flatMap((d) =>
                    d.entries.map((e) => ({
                        ...e,
                        userName: u.userName,
                        dayMeta: {
                            isHoliday: d.meta?.isHoliday || false,
                            holidayName: d.meta?.holidayName || '',
                            isNonWorking: d.meta?.isNonWorking || false,
                            isTimeOff: d.meta?.isTimeOff || false,
                        },
                    }))
                )
            )
            .sort((a, b) => (b.timeInterval.start || '').localeCompare(a.timeInterval.start || ''));
        _cachedDetailedUsersRef = users;
    }
    return _cachedDetailedEntries;
}

/** Clear the detailed entries cache (call when analysis results change). */
export function invalidateDetailedCache(): void {
    _cachedDetailedEntries = null;
    _cachedDetailedUsersRef = null;
}

// ========================================================================
// SUMMARY ROWS — Pure aggregation transform
// ========================================================================

/**
 * Aggregates UserAnalysis[] into summary rows grouped by the specified criterion.
 * Pure function: no side effects, no DOM, no store access.
 */
// eslint-disable-next-line complexity -- Aggregation across 6 grouping dimensions with many metric calculations
export function computeSummaryRows(analysisUsers: UserAnalysis[], groupBy: string): SummaryRow[] {
    const groups = new Map<string, SummaryRow>();

    // Aggregate metrics by the selected grouping dimension to keep summary rows consistent
    for (const user of analysisUsers) {
        for (const [dateKey, dayData] of user.days) {
            for (const entry of dayData.entries) {
                // Determine group key and name
                let groupKey: string;
                let groupName: string;
                switch (groupBy) {
                    case 'user':
                        groupKey = user.userId;
                        groupName = user.userName;
                        break;
                    case 'project':
                        groupKey = entry.projectId || '(No Project)';
                        groupName = entry.projectName || '(No Project)';
                        break;
                    case 'client':
                        groupKey = entry.clientId || '(No Client)';
                        groupName = entry.clientName || '(No Client)';
                        break;
                    case 'task':
                        groupKey = entry.taskId || '(No Task)';
                        groupName = entry.taskName || '(No Task)';
                        break;
                    case 'date':
                        groupKey = dateKey;
                        groupName = formatDate(dateKey);
                        break;
                    case 'week':
                        groupKey = getWeekKey(dateKey);
                        groupName = formatWeekKey(groupKey);
                        break;
                    default:
                        groupKey = user.userId;
                        groupName = user.userName;
                }

                // Initialize group if not exists
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, {
                        groupKey,
                        groupName,
                        capacity: groupBy === 'user' ? user.totals.expectedCapacity : null,
                        regular: 0,
                        overtime: 0,
                        dailyOvertime: 0,
                        weeklyOvertime: 0,
                        overlapOvertime: 0,
                        combinedOvertime: 0,
                        breaks: 0,
                        total: 0,
                        billableWorked: 0,
                        billableOT: 0,
                        nonBillableOT: 0,
                        vacationEntryHours: 0,
                        amount: 0,
                        amountEarned: 0,
                        amountCost: 0,
                        amountProfit: 0,
                        otPremium: 0,
                    });
                }

                const group = groups.get(groupKey);
                /* istanbul ignore next -- defensive: group just created above */
                if (!group) continue;
                // Fallback to zero if duration metadata is missing
                const duration = parseIsoDuration(entry.timeInterval?.duration || 'PT0H');

                // Accumulate regular and overtime from entry analysis
                group.regular += entry.analysis?.regular || 0;
                group.overtime += entry.analysis?.overtime || 0;
                group.dailyOvertime += entry.analysis?.dailyOvertime || 0;
                group.weeklyOvertime += entry.analysis?.weeklyOvertime || 0;
                group.overlapOvertime += entry.analysis?.overlapOvertime || 0;
                group.combinedOvertime +=
                    entry.analysis?.combinedOvertime ?? entry.analysis?.overtime ?? 0;
                group.total += duration;

                // Accumulate breaks and vacation
                const entryClass = classifyEntryForOvertime(entry);
                if (entryClass === 'break') {
                    group.breaks += duration;
                } else if (entryClass === 'pto') {
                    group.vacationEntryHours += duration;
                }

                // Billable breakdown
                const isBillable = entry.analysis?.isBillable === true;
                if (isBillable) {
                    group.billableWorked += entry.analysis?.regular || 0;
                    group.billableOT += entry.analysis?.overtime || 0;
                } else {
                    // Non-billable includes both worked and OT, but we only track non-billable OT separately
                    group.nonBillableOT += entry.analysis?.overtime || 0;
                }

                // Amount: totals are based on the per-entry display amount (earned/cost/profit per config)
                group.amount += entry.analysis?.displayAmount || 0;
                const amountsByType = entry.analysis?.amounts;
                /* istanbul ignore else -- amounts are always present after calculation */
                if (amountsByType) {
                    group.amountEarned += amountsByType.earned?.totalAmountWithOT || 0;
                    group.amountCost += amountsByType.cost?.totalAmountWithOT || 0;
                    group.amountProfit += amountsByType.profit?.totalAmountWithOT || 0;
                }

                // Calculate OT premium
                const baseRate = entry.analysis?.hourlyRate || 0;
                const regularCost = (entry.analysis?.regular || 0) * baseRate;
                const otCost = (entry.analysis?.displayAmount || 0) - regularCost;
                const otPremiumOnly = otCost - (entry.analysis?.overtime || 0) * baseRate;
                group.otPremium += otPremiumOnly;
            }
        }

        // For user grouping, if a user has no entries, still include them
        if (groupBy === 'user' && !groups.has(user.userId)) {
            groups.set(user.userId, {
                groupKey: user.userId,
                groupName: user.userName,
                capacity: user.totals.expectedCapacity,
                regular: 0,
                overtime: 0,
                dailyOvertime: 0,
                weeklyOvertime: 0,
                overlapOvertime: 0,
                combinedOvertime: 0,
                breaks: 0,
                total: 0,
                billableWorked: 0,
                billableOT: 0,
                nonBillableOT: 0,
                vacationEntryHours: 0,
                amount: 0,
                amountEarned: 0,
                amountCost: 0,
                amountProfit: 0,
                otPremium: 0,
            });
        }
    }

    return Array.from(groups.values()).sort((a, b) => a.groupName.localeCompare(b.groupName));
}

// ========================================================================
// STORE SELECTORS
// ========================================================================

/** Returns a copy of the current config from store. */
export function getConfig() {
    return { ...store.config };
}

/** Returns a copy of the current calc params from store. */
export function getCalcParams() {
    return { ...store.calcParams };
}

/** Returns analysis results from store (may be null if not yet computed). */
export function getAnalysisResults(): UserAnalysis[] | null {
    return store.analysisResults;
}

/** Returns whether current user is admin. */
export function isAdmin(): boolean {
    return store.claims?.workspaceRole === 'OWNER' || store.claims?.workspaceRole === 'ADMIN';
}
