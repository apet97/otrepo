/**
 * @fileoverview Summary UI Module
 * Handles rendering of summary strip and summary table.
 */

import { store } from '../state.js';
import type { UserAnalysis, SummaryRow } from '../types.js';
import { computeSummaryRows } from '../data-selectors.js';
import {
    getElements,
    formatHoursDisplay,
    formatCurrency,
    escapeHtml,
    getAmountDisplayMode,
    getAmountLabels,
    getSwatchColor,
    buildPaginationControls,
} from './shared.js';

const SWATCH_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SWATCH_FALLBACK_COLOR = '#64748b';

// === Summary rows cache (H5) — avoids recomputing on every pagination click ===
let _cachedSummaryRows: SummaryRow[] | null = null;
let _cachedSummaryUsersRef: UserAnalysis[] | null = null;
let _cachedSummaryGroupBy: string | null = null;

function getCachedSummaryRows(users: UserAnalysis[], groupBy: string): SummaryRow[] {
    if (
        _cachedSummaryUsersRef !== users ||
        _cachedSummaryGroupBy !== groupBy ||
        _cachedSummaryRows === null
    ) {
        _cachedSummaryRows = computeSummaryRows(users, groupBy);
        _cachedSummaryUsersRef = users;
        _cachedSummaryGroupBy = groupBy;
    }
    return _cachedSummaryRows;
}

/**
 * Renders the high-level summary strip with structured KPI cards,
 * secondary stats row, and financial summary cards.
 *
 * Sections:
 * 1. Headline KPI row — 4 primary metric cards (Capacity, Total Time, Regular, Overtime)
 * 2. Secondary stats row — compact inline metrics (Users, Breaks, Holidays, etc.)
 * 3. Financial summary row — 3 financial cards (Total, OT Premium, Base Hours)
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

    const showBillable = store.config.showBillableBreakdown && store.ui.hasAmountRates !== false;
    const showBoth = store.config.overtimeBasis === 'both';
    const showAmounts = store.ui.hasAmountRates !== false;
    const amountLabels = getAmountLabels();
    const amountDisplay = getAmountDisplayMode();
    const isProfitMode = amountDisplay === 'profit';
    const overtimeLabel = showBoth ? 'OT (Combined)' : 'Overtime';
    const overtimeValue = showBoth ? totals.combinedOvertime : totals.overtime;

    // SAFE-INNERHTML(summary-strip): All interpolations are numeric formatters or
    // internal labels. Do not add user-controlled strings without escaping.

    // === 1. Headline KPI bar — single compact row with stat chips ===
    const kpiCards = `
    <section class="kpi-bar">
      <div class="kpi-chip">
        <span class="kpi-chip-label">Capacity</span>
        <span class="kpi-chip-value">${formatHoursDisplay(totals.capacity)}</span>
      </div>
      <div class="kpi-chip">
        <span class="kpi-chip-label">Total time</span>
        <span class="kpi-chip-value">${formatHoursDisplay(totals.worked)}</span>
      </div>
      <div class="kpi-chip">
        <span class="kpi-chip-label">Regular</span>
        <span class="kpi-chip-value">${formatHoursDisplay(totals.regular)}</span>
      </div>
      <div class="kpi-chip">
        <span class="kpi-chip-label">${overtimeLabel}</span>
        <span class="kpi-chip-value${overtimeValue > 0 ? ' kpi-danger' : ''}">${formatHoursDisplay(overtimeValue)}</span>
      </div>
    </section>`;

    // === 2. Secondary stats row ===
    let secondaryStats = `
      <div class="stat-item"><span class="stat-label">Users</span><span class="stat-value">${totals.users}</span></div>
      <div class="stat-item"><span class="stat-label">Breaks</span><span class="stat-value">${formatHoursDisplay(totals.breaks)}</span></div>
      <div class="stat-item"><span class="stat-label">Holidays</span><span class="stat-value">${totals.holidayCount}</span></div>
      <div class="stat-item"><span class="stat-label">Time Off</span><span class="stat-value">${totals.timeOffCount}</span></div>`;

    if (showBoth) {
        secondaryStats += `
      <div class="stat-item"><span class="stat-label">OT Daily</span><span class="stat-value">${formatHoursDisplay(totals.dailyOvertime)}</span></div>
      <div class="stat-item"><span class="stat-label">OT Weekly</span><span class="stat-value">${formatHoursDisplay(totals.weeklyOvertime)}</span></div>
      <div class="stat-item"><span class="stat-label">OT Overlap</span><span class="stat-value">${formatHoursDisplay(totals.overlapOvertime)}</span></div>`;
    }

    if (showBillable) {
        secondaryStats += `
      <div class="stat-item"><span class="stat-label">Billable time</span><span class="stat-value">${formatHoursDisplay(totals.billableWorked)}</span></div>
      <div class="stat-item"><span class="stat-label">Non-billable time</span><span class="stat-value">${formatHoursDisplay(totals.nonBillableWorked)}</span></div>
      <div class="stat-item"><span class="stat-label">Billable OT</span><span class="stat-value">${formatHoursDisplay(totals.billableOT)}</span></div>
      <div class="stat-item"><span class="stat-label">Non-billable OT</span><span class="stat-value">${formatHoursDisplay(totals.nonBillableOT)}</span></div>`;
    }

    const secondaryRow = `<section class="secondary-stats">${secondaryStats}</section>`;

    // === 3. Financial summary — single card with side-by-side columns ===
    let financialCards = '';
    if (showAmounts) {
        const finCol = (
            title: string,
            primary: string,
            rows: Array<{ label: string; value: string }>,
            positive: boolean
        ): string => `
      <div class="fin-col">
        <div class="fin-col-header">
          <span class="fin-label">${title}</span>
          <span class="fin-primary ${positive ? 'fin-positive' : 'fin-default'}">${primary}</span>
        </div>
        <div class="fin-rows">
          ${rows.map((r) => `<div class="fin-row"><span class="fin-row-label">${r.label}</span><span class="fin-row-value">${r.value}</span></div>`).join('')}
        </div>
      </div>`;

        let cols = '';
        if (isProfitMode) {
            cols += finCol(
                amountLabels.total,
                formatCurrency(totals.amountProfit),
                [
                    { label: 'Amount', value: formatCurrency(totals.amountEarned) },
                    { label: 'Cost', value: formatCurrency(totals.amountCost) },
                ],
                totals.amountProfit >= 0
            );
            cols += finCol(
                'OT Premium',
                formatCurrency(totals.otPremiumProfit),
                [
                    { label: 'Amount', value: formatCurrency(totals.otPremiumEarned) },
                    { label: 'Cost', value: formatCurrency(totals.otPremiumCost) },
                ],
                false
            );
            if (store.config.enableTieredOT) {
                cols += finCol(
                    'Tier 2 Premium',
                    formatCurrency(totals.otPremiumTier2Profit),
                    [
                        { label: 'Amount', value: formatCurrency(totals.otPremiumTier2Earned) },
                        { label: 'Cost', value: formatCurrency(totals.otPremiumTier2Cost) },
                    ],
                    false
                );
            }
            cols += finCol(
                amountLabels.base,
                formatCurrency(totals.amountProfitBase),
                [
                    { label: 'Amount', value: formatCurrency(totals.amountEarnedBase) },
                    { label: 'Cost', value: formatCurrency(totals.amountCostBase) },
                ],
                false
            );
        } else {
            cols += finCol(
                amountLabels.total,
                formatCurrency(totals.amount),
                [
                    { label: 'Base hours', value: formatCurrency(totals.amountBase) },
                    { label: 'OT premium', value: formatCurrency(totals.otPremium) },
                ],
                true
            );
            cols += finCol(
                'OT Premium',
                formatCurrency(totals.otPremium),
                [
                    { label: 'Amount', value: formatCurrency(totals.amount) },
                    { label: 'Base', value: formatCurrency(totals.amountBase) },
                ],
                false
            );
            if (store.config.enableTieredOT) {
                cols += finCol(
                    'Tier 2 Premium',
                    formatCurrency(totals.otPremiumTier2),
                    [
                        { label: 'OT Premium', value: formatCurrency(totals.otPremium) },
                        { label: 'Total', value: formatCurrency(totals.amount) },
                    ],
                    false
                );
            }
            cols += finCol(
                amountLabels.base,
                formatCurrency(totals.amountBase),
                [
                    { label: 'Total', value: formatCurrency(totals.amount) },
                    { label: 'OT premium', value: formatCurrency(totals.otPremium) },
                ],
                false
            );
        }
        financialCards = `<section class="financial-bar">${cols}</section>`;
    }

    // SAFE-INNERHTML(summary-strip): values are numeric formatter output or internal labels.
    // Prefer DOM APIs if adding user-supplied content.
    strip.innerHTML = `${kpiCards}${secondaryRow}${financialCards}`;
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

// computeSummaryRows is imported from ../data-selectors.js (canonical source of truth).
// Re-export for backward compatibility with ui/index.ts consumers.
export { computeSummaryRows } from '../data-selectors.js';

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
 * Renders the Summary Table (per-user rows) with pagination.
 *
 * @param users - List of user analysis objects.
 */
export function renderSummaryTable(users: UserAnalysis[]): void {
    const Elements = getElements();
    const groupBy = store.ui.summaryGroupBy || 'user';
    const expanded = store.ui.summaryExpanded || false;
    const showBillable = store.config.showBillableBreakdown && store.ui.hasAmountRates !== false;
    const showBoth = store.config.overtimeBasis === 'both';
    const showAmounts = store.ui.hasAmountRates !== false;

    // Compute grouped rows (cached — only recomputes when users or groupBy changes)
    const rows = getCachedSummaryRows(users, groupBy);

    // Pagination
    /* istanbul ignore next -- defensive: pageSize and page are always set by UI */
    const pageSize = store.ui.summaryPageSize || 100;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Math.max(1, store.ui.summaryPage || 1), totalPages);
    const startIdx = (page - 1) * pageSize;
    const pageRows = rows.slice(startIdx, startIdx + pageSize);

    // Update header
    const thead = document.getElementById('summaryHeaderRow');
    if (thead) {
        thead.innerHTML = renderSummaryHeaders(
            groupBy,
            expanded,
            showBillable,
            showBoth,
            showAmounts
        );
    }

    // Render rows using a document fragment to minimize DOM thrashing
    const fragment = document.createDocumentFragment();
    for (const row of pageRows) {
        const tr = document.createElement('tr');
        tr.innerHTML = renderSummaryRow(
            row,
            groupBy,
            expanded,
            showBillable,
            showBoth,
            showAmounts
        );
        fragment.appendChild(tr);
    }

    /* istanbul ignore else -- Elements are always initialized when this function is called */
    if (Elements.summaryTableBody) {
        Elements.summaryTableBody.innerHTML = '';
        Elements.summaryTableBody.appendChild(fragment);
    }

    // Render pagination controls (DOM-based, no innerHTML)
    const paginationContainer = document.getElementById('summaryPaginationControls');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        const controls = buildPaginationControls(
            page,
            totalPages,
            'summary-page-btn',
            'summaryPage',
            `${rows.length} rows`
        );
        if (controls) paginationContainer.appendChild(controls);
    }

    /* istanbul ignore else -- Elements are always initialized when this function is called */
    if (Elements.resultsContainer) {
        Elements.resultsContainer.classList.remove('hidden');
    }
}
