/**
 * @fileoverview Summary UI Module
 * Handles rendering of summary strip and summary table.
 */

import { store } from '../state.js';
import type { UserAnalysis, SummaryRow } from '../types.js';
// Import from utils for these specific functions
import {
    parseIsoDuration,
    classifyEntryForOvertime,
    formatDate,
    getWeekKey,
    formatWeekKey,
} from '../utils.js';
import {
    getElements,
    formatHoursDisplay,
    formatCurrency,
    escapeHtml,
    getAmountDisplayMode,
    getAmountLabels,
    renderAmountStack,
    getSwatchColor,
} from './shared.js';

const SWATCH_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SWATCH_FALLBACK_COLOR = '#64748b';

/**
 * Renders the high-level summary strip (Totals).
 * Aggregates data from all processed users to display global metrics.
 *
 * @param users - List of user analysis objects.
 */
export function renderSummaryStrip(users: UserAnalysis[]): void {
    const Elements = getElements();
    const strip = Elements.summaryStrip;
    /* istanbul ignore next -- defensive: strip element always exists in DOM */
    if (!strip) return;

    // Aggregate totals from every user so strip shows global KPIs
    const totals = users.reduce(
        (acc, u) => {
            acc.users += 1;
            acc.capacity += u.totals.expectedCapacity;
            acc.worked += u.totals.total;
            acc.regular += u.totals.regular;
            acc.overtime += u.totals.overtime;
            acc.dailyOvertime += u.totals.dailyOvertime || 0;
            acc.weeklyOvertime += u.totals.weeklyOvertime || 0;
            acc.overlapOvertime += u.totals.overlapOvertime || 0;
            acc.combinedOvertime += u.totals.combinedOvertime || 0;
            acc.breaks += u.totals.breaks;
            acc.billableWorked += u.totals.billableWorked;
            acc.nonBillableWorked += u.totals.nonBillableWorked;
            acc.billableOT += u.totals.billableOT;
            acc.nonBillableOT += u.totals.nonBillableOT;
            acc.amount += u.totals.amount;
            acc.amountBase += u.totals.amountBase || 0;
            acc.amountEarned += u.totals.amountEarned || 0;
            acc.amountCost += u.totals.amountCost || 0;
            acc.amountProfit += u.totals.amountProfit || 0;
            acc.amountEarnedBase += u.totals.amountEarnedBase || 0;
            acc.amountCostBase += u.totals.amountCostBase || 0;
            acc.amountProfitBase += u.totals.amountProfitBase || 0;
            acc.otPremium += u.totals.otPremium;
            acc.otPremiumTier2 += u.totals.otPremiumTier2 || 0;
            acc.otPremiumEarned += u.totals.otPremiumEarned || 0;
            acc.otPremiumCost += u.totals.otPremiumCost || 0;
            acc.otPremiumProfit += u.totals.otPremiumProfit || 0;
            acc.otPremiumTier2Earned += u.totals.otPremiumTier2Earned || 0;
            acc.otPremiumTier2Cost += u.totals.otPremiumTier2Cost || 0;
            acc.otPremiumTier2Profit += u.totals.otPremiumTier2Profit || 0;
            acc.holidayCount += u.totals.holidayCount;
            acc.timeOffCount += u.totals.timeOffCount;
            acc.holidayHours += u.totals.holidayHours || 0;
            acc.timeOffHours += u.totals.timeOffHours || 0;
            return acc;
        },
        {
            users: 0,
            capacity: 0,
            worked: 0,
            regular: 0,
            overtime: 0,
            dailyOvertime: 0,
            weeklyOvertime: 0,
            overlapOvertime: 0,
            combinedOvertime: 0,
            breaks: 0,
            billableWorked: 0,
            nonBillableWorked: 0,
            billableOT: 0,
            nonBillableOT: 0,
            amount: 0,
            amountBase: 0,
            amountEarned: 0,
            amountCost: 0,
            amountProfit: 0,
            amountEarnedBase: 0,
            amountCostBase: 0,
            amountProfitBase: 0,
            otPremium: 0,
            otPremiumTier2: 0,
            otPremiumEarned: 0,
            otPremiumCost: 0,
            otPremiumProfit: 0,
            otPremiumTier2Earned: 0,
            otPremiumTier2Cost: 0,
            otPremiumTier2Profit: 0,
            holidayCount: 0,
            timeOffCount: 0,
            holidayHours: 0,
            timeOffHours: 0,
        }
    );

    const showBillable =
        store.config.showBillableBreakdown && store.ui.hasAmountRates !== false;
    const showTier2 = store.config.enableTieredOT && showBillable;
    const showBoth = store.config.overtimeBasis === 'both';
    const showAmounts = store.ui.hasAmountRates !== false;
    const amountLabels = getAmountLabels();
    const amountDisplay = getAmountDisplayMode();
    const isProfitMode = amountDisplay === 'profit';
    const overtimeLabel = showBoth ? 'OT (Combined)' : 'Overtime';
    const overtimeValue = showBoth ? totals.combinedOvertime : totals.overtime;

    // SAFE-INNERHTML(summary-strip): All interpolations below are numeric formatters
    // or internal labels. Do not add user-controlled strings without escaping or
    // converting to DOM nodes.
    // Time metrics (always on top row)
    const timeMetrics = `
    <div class="summary-item"><span class="summary-label">Users</span><span class="summary-value">${totals.users}</span></div>
    <div class="summary-item"><span class="summary-label">Capacity</span><span class="summary-value">${formatHoursDisplay(totals.capacity)}</span></div>
    <div class="summary-item"><span class="summary-label">Total time</span><span class="summary-value">${formatHoursDisplay(totals.worked)}</span></div>
    <div class="summary-item"><span class="summary-label">Break</span><span class="summary-value">${formatHoursDisplay(totals.breaks)}</span></div>
    <div class="summary-item"><span class="summary-label">Regular</span><span class="summary-value">${formatHoursDisplay(totals.regular)}</span></div>
    <div class="summary-item danger"><span class="summary-label">${overtimeLabel}</span><span class="summary-value">${formatHoursDisplay(overtimeValue)}</span></div>
    ${
        showBoth
            ? `
      <div class="summary-item"><span class="summary-label">OT Daily</span><span class="summary-value">${formatHoursDisplay(totals.dailyOvertime)}</span></div>
      <div class="summary-item"><span class="summary-label">OT Weekly</span><span class="summary-value">${formatHoursDisplay(totals.weeklyOvertime)}</span></div>
      <div class="summary-item"><span class="summary-label">OT Overlap</span><span class="summary-value">${formatHoursDisplay(totals.overlapOvertime)}</span></div>
    `
            : ''
    }
    ${
        showBillable
            ? `
      <div class="summary-item"><span class="summary-label">Billable time</span><span class="summary-value">${formatHoursDisplay(totals.billableWorked)}</span></div>
      <div class="summary-item"><span class="summary-label">Non-billable time</span><span class="summary-value">${formatHoursDisplay(totals.nonBillableWorked)}</span></div>
      <div class="summary-item"><span class="summary-label">Billable OT</span><span class="summary-value">${formatHoursDisplay(totals.billableOT)}</span></div>
      <div class="summary-item"><span class="summary-label">Non-billable OT</span><span class="summary-value">${formatHoursDisplay(totals.nonBillableOT)}</span></div>
    `
            : ''
    }
    <div class="summary-item"><span class="summary-label">Holidays</span><span class="summary-value">${totals.holidayCount}</span></div>
    <div class="summary-item"><span class="summary-label">Time Off</span><span class="summary-value">${totals.timeOffCount}</span></div>
  `;

    // Money metrics (on bottom row when billable breakdown is ON)
    const moneyMetrics = !showAmounts
        ? ''
        : isProfitMode
        ? `
      <div class="summary-item highlight"><span class="summary-label">${amountLabels.total}</span><span class="summary-value">${renderAmountStack(
          [
              { label: 'Amt', value: totals.amountEarned },
              { label: 'Cost', value: totals.amountCost },
              { label: 'Profit', value: totals.amountProfit },
          ],
          'left'
      )}</span></div>
      <div class="summary-item"><span class="summary-label">OT Premium</span><span class="summary-value">${renderAmountStack(
          [
              { label: 'Amt', value: totals.otPremiumEarned },
              { label: 'Cost', value: totals.otPremiumCost },
              { label: 'Profit', value: totals.otPremiumProfit },
          ],
          'left'
      )}</span></div>
      ${
          showTier2
              ? `<div class="summary-item"><span class="summary-label">Tier 2 Premium</span><span class="summary-value">${renderAmountStack(
                    [
                        { label: 'Amt', value: totals.otPremiumTier2Earned },
                        { label: 'Cost', value: totals.otPremiumTier2Cost },
                        { label: 'Profit', value: totals.otPremiumTier2Profit },
                    ],
                    'left'
                )}</span></div>`
              : ''
      }
      <div class="summary-item"><span class="summary-label">${amountLabels.base}</span><span class="summary-value">${renderAmountStack(
          [
              { label: 'Amt', value: totals.amountEarnedBase },
              { label: 'Cost', value: totals.amountCostBase },
              { label: 'Profit', value: totals.amountProfitBase },
          ],
          'left'
      )}</span></div>
    `
        : `
      <div class="summary-item highlight"><span class="summary-label">${amountLabels.total}</span><span class="summary-value">${formatCurrency(totals.amount)}</span></div>
      <div class="summary-item"><span class="summary-label">OT Premium</span><span class="summary-value">${formatCurrency(totals.otPremium)}</span></div>
      ${showTier2 ? `<div class="summary-item"><span class="summary-label">Tier 2 Premium</span><span class="summary-value">${formatCurrency(totals.otPremiumTier2)}</span></div>` : ''}
      <div class="summary-item"><span class="summary-label">${amountLabels.base}</span><span class="summary-value">${formatCurrency(totals.amountBase)}</span></div>
    `;

    // SAFE-INNERHTML(summary-strip): timeMetrics/moneyMetrics contain only safe
    // formatter output and internal labels. Prefer DOM APIs if adding user content.
    // Two-row layout when billable breakdown is ON
    if (showBillable) {
        // SAFE-INNERHTML(summary-strip): values are numeric formatter output or internal labels.
        strip.innerHTML = showAmounts
            ? `
      <div class="ot-summary-row ot-summary-row-top">${timeMetrics}</div>
      <div class="ot-summary-row ot-summary-row-bottom">${moneyMetrics}</div>
    `
            : `<div class="ot-summary-row ot-summary-row-top">${timeMetrics}</div>`;
    } else {
        // Single row layout when OFF so the strip doesn't look sparse
        // SAFE-INNERHTML(summary-strip): values are numeric formatter output or internal labels.
        strip.innerHTML = `<div class="ot-summary-row ot-summary-row-top">${timeMetrics}${showAmounts ? moneyMetrics : ''}</div>`;
    }
}

/**
 * Renders the summary expand/collapse toggle button.
 * Only shows when billable breakdown is enabled.
 */
export function renderSummaryExpandToggle(): void {
    const container = document.getElementById('summaryExpandToggleContainer');
    if (!container) return;

    // Only render if billable breakdown is enabled (toggle meaningless otherwise)
    if (!store.config.showBillableBreakdown || store.ui.hasAmountRates === false) {
        container.innerHTML = '';
        return;
    }

    const expanded = store.ui.summaryExpanded;
    const icon = expanded ? '▾' : '▸';
    const text = expanded ? 'Hide breakdown' : 'Show breakdown';

    container.innerHTML = `
    <button type="button" id="summaryExpandToggle" class="btn-text btn-xs"
            style="display: flex; align-items: center; gap: 4px;">
      <span class="expand-icon">${icon}</span>
      <span class="expand-text">${text}</span>
    </button>
  `;
}

/**
 * Computes summary rows grouped by the specified criterion.
 * Iterates through all entries across all users and aggregates metrics
 * (regular, overtime, breaks, billable, amounts) into groups.
 *
 * AGGREGATION STRATEGY:
 * 1. Flatten all user days into a single stream of entries.
 * 2. Key each entry by the selected dimension (User ID, Project ID, Date, etc.).
 * 3. Accumulate hours and amounts into a SummaryRow map.
 * 4. Handle special cases like 'Capacity' which only applies to User grouping.
 *
 * Grouping logic:
 * - 'user': Groups by userId, uses userName as label
 * - 'project': Groups by projectId, uses projectName as label
 * - 'client': Groups by clientId, uses clientName as label
 * - 'task': Groups by taskId, uses taskName as label
 * - 'date': Groups by dateKey (YYYY-MM-DD), formats as readable date
 * - 'week': Groups by week key (YYYY-Wnn), formats as week range
 *
 * @param analysisUsers - List of user analysis objects containing day-level entries.
 * @param groupBy - Grouping criterion ('user', 'project', 'client', 'task', 'date', 'week').
 * @returns Array of grouped summary rows sorted alphabetically by group name.
 */
// eslint-disable-next-line complexity -- Aggregation across 6 grouping dimensions with many metric calculations
function computeSummaryRows(
    analysisUsers: UserAnalysis[],
    groupBy: string
): SummaryRow[] {
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

                // Cost: totals are based on the detailed per-entry amount view selected via the dropdown
                group.amount += entry.analysis?.cost || 0;
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
                const otCost = (entry.analysis?.cost || 0) - regularCost;
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

    return Array.from(groups.values()).sort((a, b) =>
        a.groupName.localeCompare(b.groupName)
    );
}

/**
 * Renders summary table headers based on grouping and expanded state.
 * Dynamically adjusts columns shown:
 * - Capacity column only shown for user grouping
 * - Billable breakdown columns (Bill. Worked, Bill. OT, Non-Bill OT) shown when expanded
 * - Profit mode shows separate Amount/Cost/Profit columns vs single Amount column
 *
 * @param groupBy - Current grouping criterion (determines first column label).
 * @param expanded - Whether billable breakdown is expanded.
 * @param showBillable - Whether billable breakdown feature is enabled.
 * @returns HTML string for table header row.
 */
function renderSummaryHeaders(
    groupBy: string,
    expanded: boolean,
    showBillable: boolean,
    showBoth: boolean,
    showAmounts: boolean
): string {
    const groupLabel: Record<string, string> = {
        user: 'User',
        project: 'Project',
        client: 'Client',
        task: 'Task',
        date: 'Date',
        week: 'Week',
    };
    const label = groupLabel[groupBy] || 'User';
    const amountLabel = getAmountLabels().column;
    const amountDisplay = getAmountDisplayMode();
    const isProfitMode = amountDisplay === 'profit';

    let headers = `<th>${label}</th>`;

    // Capacity only shown for user grouping
    if (groupBy === 'user') {
        headers += `<th class="text-right">Capacity</th>`;
    }

    const overtimeLabel = showBoth ? 'OT (Combined)' : 'Overtime';

    headers += `
    <th class="text-right">Regular</th>
    <th class="text-right">${overtimeLabel}</th>
    <th class="text-right">Breaks</th>
  `;

    if (expanded && showBoth) {
        headers += `
      <th class="text-right">OT Daily</th>
      <th class="text-right">OT Weekly</th>
      <th class="text-right">OT Overlap</th>
    `;
    }

    // Advanced columns (shown when expanded and billable breakdown enabled)
    if (expanded && showBillable) {
        headers += `
      <th class="text-right">Bill. Worked</th>
      <th class="text-right">Bill. OT</th>
      <th class="text-right">Non-Bill OT</th>
    `;
    }

    headers += `
    <th class="text-right">Total</th>
    <th class="text-right">Vacation</th>
  `;
    if (showAmounts) {
        if (isProfitMode) {
            headers += `
      <th class="text-right">Amount</th>
      <th class="text-right">Cost</th>
      <th class="text-right">Profit</th>
    `;
        } else {
            headers += `<th class="text-right">${amountLabel}</th>`;
        }
    }

    return headers;
}

/**
 * Renders a single summary table row with all metrics.
 * Handles user grouping specially (shows avatar swatch).
 * Highlights overtime values in danger color when > 0.
 * Adapts columns based on grouping, expansion, and billable settings.
 *
 * @param row - Summary row data containing aggregated metrics.
 * @param groupBy - Current grouping criterion (affects first column rendering).
 * @param expanded - Whether billable breakdown columns are shown.
 * @param showBillable - Whether billable breakdown feature is enabled.
 * @returns HTML string for table row (without wrapping <tr> tags).
 */
function renderSummaryRow(
    row: SummaryRow,
    groupBy: string,
    expanded: boolean,
    showBillable: boolean,
    showBoth: boolean,
    showAmounts: boolean
): string {
    const amountDisplay = getAmountDisplayMode();
    const isProfitMode = amountDisplay === 'profit';

    // For user grouping, show avatar
    let nameCell: string;
    /* istanbul ignore else -- UI rendering: else branch is for non-user grouping */
    if (groupBy === 'user') {
        /* istanbul ignore next -- defensive: row.groupKey is usually present */
        const swatchColor = getSwatchColor(row.groupKey || row.groupName);
        const safeSwatchColor = SWATCH_COLOR_PATTERN.test(swatchColor)
            ? swatchColor
            : SWATCH_FALLBACK_COLOR;
        nameCell = `
      <td class="text-left">
        <div class="user-cell">
          <span class="user-swatch" style="background-color: ${safeSwatchColor};"></span>
          <span class="user-name">${escapeHtml(row.groupName)}</span>
        </div>
      </td>
    `;
    } else {
        nameCell = `<td class="text-left">${escapeHtml(row.groupName)}</td>`;
    }

    let html = nameCell;

    // Capacity column (only for user grouping)
    /* istanbul ignore next -- UI rendering: capacity column only for user grouping */
    if (groupBy === 'user') {
        html += `<td class="text-right">${formatHoursDisplay(row.capacity || 0)}</td>`;
    }

    const overtimeValue = showBoth ? row.combinedOvertime : row.overtime;

    html += `
    <td class="text-right">${formatHoursDisplay(row.regular)}</td>
    <td class="text-right ${overtimeValue > 0 ? 'text-danger' : ''}">${formatHoursDisplay(overtimeValue)}</td>
    <td class="text-right">${formatHoursDisplay(row.breaks)}</td>
  `;

    if (expanded && showBoth) {
        html += `
      <td class="text-right">${formatHoursDisplay(row.dailyOvertime)}</td>
      <td class="text-right">${formatHoursDisplay(row.weeklyOvertime)}</td>
      <td class="text-right">${formatHoursDisplay(row.overlapOvertime)}</td>
    `;
    }

    // Advanced columns
    if (expanded && showBillable) {
        html += `
      <td class="text-right">${formatHoursDisplay(row.billableWorked)}</td>
      <td class="text-right">${formatHoursDisplay(row.billableOT)}</td>
      <td class="text-right">${formatHoursDisplay(row.nonBillableOT)}</td>
    `;
    }

    html += `
    <td class="text-right font-bold">${formatHoursDisplay(row.total)}</td>
    <td class="text-right" title="Vacation Entry Hours">${formatHoursDisplay(row.vacationEntryHours)}</td>
  `;
    if (showAmounts) {
        if (isProfitMode) {
            html += `
      <td class="text-right font-bold">${formatCurrency(row.amountEarned)}</td>
      <td class="text-right font-bold">${formatCurrency(row.amountCost)}</td>
      <td class="text-right font-bold">${formatCurrency(row.amountProfit)}</td>
    `;
        } else {
            html += `<td class="text-right font-bold">${formatCurrency(row.amount)}</td>`;
        }
    }

    return html;
}

/**
 * Renders the Summary Table (per-user rows).
 *
 * @param users - List of user analysis objects.
 */
export function renderSummaryTable(users: UserAnalysis[]): void {
    const Elements = getElements();
    const groupBy = store.ui.summaryGroupBy || 'user';
    const expanded = store.ui.summaryExpanded || false;
    const showBillable =
        store.config.showBillableBreakdown && store.ui.hasAmountRates !== false;
    const showBoth = store.config.overtimeBasis === 'both';
    const showAmounts = store.ui.hasAmountRates !== false;

    // Compute grouped rows
    const rows = computeSummaryRows(users, groupBy);

    // Update header
    const thead = document.getElementById('summaryHeaderRow');
    if (thead) {
        thead.innerHTML = renderSummaryHeaders(groupBy, expanded, showBillable, showBoth, showAmounts);
    }

    // Render rows using a document fragment to minimize DOM thrashing
    // PERFORMANCE: Building the entire table body in a fragment before appending
    // prevents browser reflow/repaint for each row, critical for large datasets.
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = renderSummaryRow(row, groupBy, expanded, showBillable, showBoth, showAmounts);
        fragment.appendChild(tr);
    }

    /* istanbul ignore else -- Elements are always initialized when this function is called */
    if (Elements.summaryTableBody) {
        Elements.summaryTableBody.innerHTML = '';
        Elements.summaryTableBody.appendChild(fragment);
    }
    /* istanbul ignore else -- Elements are always initialized when this function is called */
    if (Elements.resultsContainer) {
        Elements.resultsContainer.classList.remove('hidden');
    }
}
