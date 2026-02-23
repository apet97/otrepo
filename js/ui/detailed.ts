/**
 * @fileoverview Detailed Table UI Module
 * Handles rendering of detailed entries table with pagination and filtering.
 */

import { store } from '../state.js';
import { classifyEntryForOvertime, IsoUtils, getCanonicalTimeZone } from '../utils.js';
import type { UserAnalysis, TimeEntry, DayMeta } from '../types.js';
import {
    formatHoursDisplay,
    formatCurrency,
    escapeHtml,
    getAmountDisplayMode,
    buildProfitStacks,
} from './shared.js';

/**
 * Extended entry with day metadata for rendering
 */
interface DetailedEntry extends TimeEntry {
    dayMeta: DayMeta;
}

const NARROW_HEADER_WIDTH = 900;
let detailedHeaderObserver: ResizeObserver | null = null;
let observedDetailedCard: HTMLElement | null = null;

/**
 * Updates the detailed table header layout based on container width.
 * Switches to compact headers in profit mode when the container is narrow
 * or when header cells overflow their bounds.
 *
 * @param card - The detailed card container element.
 */
function updateDetailedHeaderLayout(card: HTMLElement): void {
    const isProfitMode = card.classList.contains('amount-profit');
    const width = card.getBoundingClientRect().width;
    let useCompactHeaders = isProfitMode && width < NARROW_HEADER_WIDTH;
    if (isProfitMode) {
        const table = card.querySelector('.report-table');
        /* istanbul ignore if -- requires browser layout engine for scrollWidth/clientWidth */
        if (table) {
            const headerCells = Array.from(table.querySelectorAll('thead th')).slice(0, 7);
            const hasOverflow = headerCells.some(
                (cell) => cell.scrollWidth > cell.clientWidth + 1
            );
            if (hasOverflow) {
                useCompactHeaders = true;
            }
        }
    }
    card.classList.toggle('narrow-headers', useCompactHeaders);
}

/**
 * Ensures a ResizeObserver is attached to the detailed card for responsive header updates.
 * Creates the observer if it doesn't exist, and manages observation of the current card.
 * When the card resizes, triggers header layout recalculation via updateDetailedHeaderLayout.
 *
 * RESPONSIVE HEADER PATTERN:
 * The "Profit" view adds 3 columns per amount metric (Amt/Cost/Profit), making the table very wide.
 * We use a ResizeObserver to detect when the container is too narrow for full headers,
 * automatically switching to compact abbreviations (e.g., "Regular" -> "Reg") to preserve layout.
 *
 * @param card - The detailed card container element to observe.
 */
function ensureDetailedHeaderObserver(card: HTMLElement): void {
    updateDetailedHeaderLayout(card);
    /* istanbul ignore if -- ResizeObserver requires browser environment */
    if (typeof ResizeObserver === 'undefined') return;
    /* istanbul ignore next -- ResizeObserver callback requires browser environment */
    if (!detailedHeaderObserver) {
        detailedHeaderObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.target instanceof HTMLElement) {
                    updateDetailedHeaderLayout(entry.target);
                }
            });
        });
    }
    if (observedDetailedCard !== card) {
        if (observedDetailedCard) {
            detailedHeaderObserver.unobserve(observedDetailedCard);
        }
        observedDetailedCard = card;
        detailedHeaderObserver.observe(card);
    }
}

/**
 * Disconnects and cleans up the ResizeObserver for the detailed header.
 */
export function destroyDetailedObserver(): void {
    if (detailedHeaderObserver) {
        detailedHeaderObserver.disconnect();
        detailedHeaderObserver = null;
    }
    observedDetailedCard = null;
}

/**
 * Renders the Detailed Table (granular entries).
 * Supports client-side filtering and pagination.
 *
 * @param users - List of user analysis objects.
 * @param activeFilter - Filter key ('all', 'holiday', 'offday', 'billable').
 */
// eslint-disable-next-line complexity -- Table rendering with many columns, filters, and conditional formatting
export function renderDetailedTable(
    users: UserAnalysis[],
    activeFilter: string | null = null
): void {
    const container = document.getElementById('detailedTableContainer');
    if (!container) return;
    const detailedCard = document.getElementById('detailedCard');
    const showBillable =
        store.config.showBillableBreakdown && store.ui.hasAmountRates !== false;
    const showAmounts = store.ui.hasAmountRates !== false;
    const showTier2 = store.config.enableTieredOT && showAmounts;
    const amountDisplay = showAmounts ? getAmountDisplayMode() : 'earned';
    const isProfitMode = showAmounts && amountDisplay === 'profit';
    // SAFE-INNERHTML(detailed-table): All HTML interpolations below must use escapeHtml
    // for API-sourced strings or numeric formatters. Prefer DOM APIs if adding user content.
    /* istanbul ignore else -- detailedCard always exists when this function is called */
    if (detailedCard) {
        detailedCard.classList.toggle('billable-off', !showBillable);
        detailedCard.classList.toggle('amount-profit', isProfitMode);
    }

    // Use stored filter if not provided, otherwise update store
    if (activeFilter) {
        store.ui.activeDetailedFilter = activeFilter as typeof store.ui.activeDetailedFilter;
        store.ui.detailedPage = 1; // Reset to page 1 on filter change
    }
    let currentFilter = store.ui.activeDetailedFilter || 'all';
    if (!showBillable && currentFilter === 'billable') {
        currentFilter = 'all';
        store.ui.activeDetailedFilter = 'all';
    }

    // Flatten entries, attach day-level metadata, and sort by start time
    let allEntries: DetailedEntry[] = users.flatMap((u) =>
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
    ).sort(/* istanbul ignore next -- defensive: timeInterval.start is always present */ (a, b) =>
        (b.timeInterval.start || '').localeCompare(a.timeInterval.start || '')
    );

    // Apply user-selected filter chips
    if (currentFilter === 'holiday') {
        allEntries = allEntries.filter((e) => e.dayMeta.isHoliday);
    } else if (currentFilter === 'offday') {
        allEntries = allEntries.filter((e) => e.dayMeta.isNonWorking);
    } else if (currentFilter === 'billable') {
        allEntries = allEntries.filter((e) => e.analysis?.isBillable);
    }

    // Update Chips UI
    document.querySelectorAll('#detailedFilters .chip').forEach((chip) => {
        const el = chip as HTMLElement;
        const isActive = el.dataset.filter === currentFilter;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', String(isActive));
    });

    if (allEntries.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:40px; color:var(--text-muted);">No entries found for filter: <strong>${escapeHtml(currentFilter)}</strong></p>`;
        return;
    }

    // Pagination Logic
    /* istanbul ignore next -- defensive: pageSize and page are always set by UI */
    const pageSize = store.ui.detailedPageSize || 50;
    /* istanbul ignore next -- defensive: pageSize and page are always set by UI */
    const page = store.ui.detailedPage || 1;
    const totalPages = Math.ceil(allEntries.length / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageEntries = allEntries.slice(start, end);

    // Helper to format time as HH:mm
    const canonicalTimeZone = getCanonicalTimeZone();
    const formatTime = (isoString: string | undefined): string => {
        if (!isoString) return '—';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: canonicalTimeZone,
            });
        } catch /* istanbul ignore next -- Date constructor rarely throws */ {
            return '—';
        }
    };

    /* istanbul ignore next -- UI formatting: isProfitMode determines header note */
    const amountHeaderNote = isProfitMode
        ? '<div class="amount-header-sub">Amt / Cost / Profit</div>'
        : '';
    /* istanbul ignore next -- UI label: depends on amountDisplay config */
    const detailedRateLabel = amountDisplay === 'cost' ? 'Rate (Cost)' : 'Rate';
    /* istanbul ignore next -- UI formatting: responsive header labels */
    const headerLabel = (long: string, short?: string): string =>
        short
            ? `<span class="header-label header-label-long">${long}</span><span class="header-label header-label-short">${short}</span>`
            : long;

    let html = `
  <div class="table-scroll" style="margin-top: 10px;">
    <table class="report-table" aria-label="Detailed time entries">
      <thead>
        <tr>
          <th>${headerLabel('Date', 'Dt')}</th>
          <th>${headerLabel('Start', 'St')}</th>
          <th>${headerLabel('End', 'En')}</th>
          <th>${headerLabel('User', 'Usr')}</th>
          <th class="text-right">${headerLabel('Regular', 'Reg')}</th>
          <th class="text-right">${headerLabel('Overtime', 'OT')}</th>
          <th class="text-right">${headerLabel('Billable', 'Bill')}</th>
          ${
              showAmounts
                  ? `
          <th class="text-right amount-cell">${detailedRateLabel}${amountHeaderNote}</th>
          <th class="text-right amount-cell">${headerLabel('Regular', 'Reg')} $${amountHeaderNote}</th>
          <th class="text-right amount-cell">${headerLabel('Overtime', 'OT')} $${amountHeaderNote}</th>
          ${showTier2 ? `<th class="text-right amount-cell">T2 $${amountHeaderNote}</th>` : ''}
          <th class="text-right amount-cell">Total $${amountHeaderNote}</th>
          `
                  : ''
          }
          <th class="text-right status-header-cell">Status <button type="button" class="status-info-btn" aria-label="Status badge explanations">ⓘ</button></th>
        </tr>
      </thead>
      <tbody>`;

    // Build table rows for the current page
    // eslint-disable-next-line complexity -- Row generation with many conditional columns and status tags
    pageEntries.forEach((e) => {
        const date =
            IsoUtils.extractDateKey(e.timeInterval.start) ||
            (e.timeInterval.start || '').split('T')[0];
        const tags: string[] = [];
        const tagKeys = new Set<string>();
        /* istanbul ignore next -- defensive: prevents duplicate tags in status column */
        const addTag = (key: string, tagHtml: string) => {
            if (tagKeys.has(key)) return;
            tagKeys.add(key);
            tags.push(tagHtml);
        };

        const normalizedType = String(e.type || '')
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, '_');
        const entryClass = classifyEntryForOvertime(e);
        const isHolidayEntry =
            normalizedType === 'HOLIDAY' || normalizedType === 'HOLIDAY_TIME_ENTRY';
        const isTimeOffEntry =
            normalizedType === 'TIME_OFF' ||
            normalizedType === 'TIMEOFF' ||
            normalizedType === 'TIME_OFF_TIME_ENTRY';
        const isPtoEntry = isHolidayEntry || isTimeOffEntry;

        if (isHolidayEntry) {
            addTag(
                'HOLIDAY-TIME-ENTRY',
                '<span class="badge badge-holiday" title="Holiday time entry (counts as regular hours, not overtime)">HOLIDAY ENTRY</span>'
            );
        }
        if (isTimeOffEntry) {
            addTag(
                'TIME-OFF-TIME-ENTRY',
                '<span class="badge badge-timeoff" title="Time-off entry (counts as regular hours, not overtime)">TIME-OFF ENTRY</span>'
            );
        }

        if (!isPtoEntry) {
            if (e.dayMeta.isHoliday) {
                addTag(
                    'HOLIDAY',
                    `<span class="badge badge-holiday" title="${escapeHtml(e.dayMeta.holidayName || 'Holiday')}">HOLIDAY</span>`
                );
            }
            if (e.dayMeta.isTimeOff) {
                addTag('TIME-OFF', '<span class="badge badge-timeoff">TIME-OFF</span>');
            }
            if (e.dayMeta.isNonWorking) {
                addTag('OFF-DAY', '<span class="badge badge-offday">OFF-DAY</span>');
            }
            if (entryClass === 'break') {
                addTag('BREAK', '<span class="badge badge-break">BREAK</span>');
            }
        }

        // Billable indicator
        const billable = e.analysis?.isBillable
            ? '<span class="badge badge-billable">✓</span>'
            : '<span style="color:var(--text-muted)">—</span>';

        let amountCells = '';
        if (showAmounts) {
            // Use precomputed amount breakdowns
            const amountsByType = e.analysis?.amounts || {};
            /* istanbul ignore next -- UI conditional: profit mode shows stacked amounts */
            const rateCell = isProfitMode
                ? buildProfitStacks(amountsByType, (amount) => amount.rate || 0, 'right')
                : formatCurrency(e.analysis?.hourlyRate || 0);
            /* istanbul ignore next -- UI conditional: profit mode shows stacked amounts */
            const regularCell = isProfitMode
                ? buildProfitStacks(amountsByType, (amount) => amount.regularAmount || 0, 'right')
                : formatCurrency(e.analysis?.regularAmount || 0);
            /* istanbul ignore next -- UI conditional: profit mode shows stacked amounts */
            const otCell = isProfitMode
                ? buildProfitStacks(
                      amountsByType,
                      (amount) =>
                          (amount.overtimeAmountBase || 0) + (amount.tier1Premium || 0),
                      'right'
                  )
                : formatCurrency(
                      (e.analysis?.overtimeAmountBase || 0) + (e.analysis?.tier1Premium || 0)
                  );
            /* istanbul ignore next -- UI conditional: tier2 column shown when enabled */
            const t2Cell = showTier2
                ? (isProfitMode
                    ? buildProfitStacks(amountsByType, (amount) => amount.tier2Premium || 0, 'right')
                    : formatCurrency(e.analysis?.tier2Premium || 0))
                : '';
            const totalCell = isProfitMode
                ? buildProfitStacks(
                      amountsByType,
                      (amount) => amount.totalAmountWithOT || 0,
                      'right'
                  )
                : formatCurrency(e.analysis?.totalAmountWithOT || 0);

            amountCells = `
        <td class="text-right amount-cell">${rateCell}</td>
        <td class="text-right amount-cell">${regularCell}</td>
        <td class="text-right amount-cell">${otCell}</td>
        ${showTier2 ? `<td class="text-right amount-cell">${t2Cell}</td>` : ''}
        <td class="text-right highlight amount-cell">${totalCell}</td>
      `;
        }

        html += `
    <tr>
        <td>${escapeHtml(date)}</td>
        <td>${formatTime(e.timeInterval?.start)}</td>
        <td>${formatTime(e.timeInterval?.end)}</td>
        <td>${escapeHtml(e.userName)}</td>
        <td class="text-right">${formatHoursDisplay(e.analysis?.regular || 0)}</td>
        <td class="text-right ${(e.analysis?.overtime || 0) > 0 ? 'text-danger' : ''}">${formatHoursDisplay(e.analysis?.overtime || 0)}</td>
        <td class="text-right">${billable}</td>
        ${amountCells}
        <td class="text-right"><div class="tags-cell">${tags.join(' ') || '—'}</div></td>
    </tr>`;
    });

    html += `</tbody></table></div>`;

    // Pagination Controls
    if (totalPages > 1) {
        html += `
      <div class="pagination-controls" style="display:flex; justify-content:center; align-items:center; gap:10px; margin-top:16px;">
          <button class="btn-secondary btn-sm pagination-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">Previous</button>
          <span style="font-size:12px; color:var(--text-secondary);">Page ${page} of ${totalPages}</span>
          <button class="btn-secondary btn-sm pagination-btn" ${page === totalPages ? 'disabled' : ''} data-page="${page + 1}">Next</button>
      </div>`;
    }

    // SAFE-INNERHTML(detailed-table): html is built from escaped strings/formatters only.
    container.innerHTML = html;
    /* istanbul ignore else -- detailedCard always exists when this function is called */
    if (detailedCard) {
        ensureDetailedHeaderObserver(detailedCard);
    }
}
