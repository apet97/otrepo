/**
 * @fileoverview Shared UI Utilities
 * Common functions and types used across UI modules.
 */

import { store } from '../state.js';
import { formatHours, formatHoursDecimal, formatCurrency, escapeHtml } from '../utils.js';
// Types from ../types.js are used via exports

/**
 * Cached DOM elements
 */
export interface Elements {
    resultsContainer: HTMLElement | null;
    summaryStrip: HTMLElement | null;
    summaryTableBody: HTMLElement | null;
    loadingState: HTMLElement | null;
    emptyState: HTMLElement | null;
    apiStatusBanner: HTMLElement | null;
    // Overrides page elements
    mainView: HTMLElement | null;
    overridesPage: HTMLElement | null;
    openOverridesBtn: HTMLElement | null;
    closeOverridesBtn: HTMLElement | null;
    overridesUserList: HTMLElement | null;
}

let cachedElements: Elements | null = null;

/**
 * Initialize UI elements (call after DOM is ready).
 * This lazy initialization prevents null references in tests or if the script loads before the body.
 *
 * PATTERN: Lazy DOM Cache
 * We cache DOM references on the first call to avoid repeated `getElementById` lookups during
 * render cycles. This improves performance for frequent updates (like filtering or pagination).
 *
 * @param force - Force re-initialization even if already initialized.
 * @returns Map of cached DOM elements.
 */
export function initializeElements(force = false): Elements {
    if (cachedElements && !force) return cachedElements;

    cachedElements = {
        resultsContainer: document.getElementById('resultsContainer'),
        summaryStrip: document.getElementById('summaryStrip'),
        summaryTableBody: document.getElementById('summaryTableBody'),
        loadingState: document.getElementById('loadingState'),
        emptyState: document.getElementById('emptyState'),
        apiStatusBanner: document.getElementById('apiStatusBanner'),
        // Overrides page elements
        mainView: document.getElementById('mainView'),
        overridesPage: document.getElementById('overridesPage'),
        openOverridesBtn: document.getElementById('openOverridesBtn'),
        closeOverridesBtn: document.getElementById('closeOverridesBtn'),
        overridesUserList: document.getElementById('overridesUserList'),
    };

    return cachedElements;
}

/**
 * Helper to get initialized elements, ensuring they're available.
 * @throws Error If called before initializeElements.
 * @returns Elements map.
 */
export function getElements(): Elements {
    if (!cachedElements) {
        throw new Error('UI elements not initialized. Call initializeElements() first.');
    }
    return cachedElements;
}

/**
 * Set cached elements (for testing)
 */
export function setElements(elements: Elements): void {
    cachedElements = elements;
}

/**
 * Format hours based on display preference
 */
export function formatHoursDisplay(hours: number): string {
    return store.config.showDecimalTime ? formatHoursDecimal(hours) : formatHours(hours);
}

/**
 * Amount stack item definition
 */
export interface AmountStackItem {
    key: string;
    label: string;
}

export const AMOUNT_STACK_ITEMS: AmountStackItem[] = [
    { key: 'earned', label: 'Amt' },
    { key: 'cost', label: 'Cost' },
    { key: 'profit', label: 'Profit' },
];

/**
 * Get amount display mode from config
 */
export function getAmountDisplayMode(): string {
    return String(store.config.amountDisplay || 'earned').toLowerCase();
}

/**
 * Line item for amount rendering
 */
export interface AmountLine {
    label: string;
    value: number;
}

/**
 * Render amount stack HTML
 */
export function renderAmountStack(lines: AmountLine[], align: 'left' | 'right' = 'right'): string {
    const alignmentClass = align === 'left' ? 'amount-stack-left' : 'amount-stack-right';
    const safeLines = Array.isArray(lines) ? lines : [];
    return `<span class="amount-stack ${alignmentClass}">${safeLines
        .map(
            ({ label, value }) => `
    <span class="amount-line"><span class="amount-tag">${label}</span><span class="amount-value">${formatCurrency(value)}</span></span>
  `
        )
        .join('')}</span>`;
}

/**
 * Amount accessor function type
 */
type AmountAccessor = (amounts: Record<string, number>) => number;

/**
 * Amounts by type structure
 */
interface AmountsByType {
    earned?: Record<string, number>;
    cost?: Record<string, number>;
    profit?: Record<string, number>;
}

/**
 * Build profit stacks for all amount types
 */
export function buildProfitStacks(
    amountsByType: AmountsByType | undefined,
    accessor: AmountAccessor,
    align: 'left' | 'right' = 'right'
): string {
    const lines = AMOUNT_STACK_ITEMS.map(({ key, label }) => ({
        label,
        value: accessor(
            (amountsByType?.[key as keyof AmountsByType] as Record<string, number>) || {}
        ),
    }));
    return renderAmountStack(lines, align);
}

/**
 * UX-8: Currency symbol constant — extracted from hardcoded '$/h' for configurability.
 * To support multi-currency, replace this with a value from workspace settings or Intl.NumberFormat.
 */
const CURRENCY_SYMBOL = '$';
const RATE_SUFFIX = `${CURRENCY_SYMBOL}/h`;

/**
 * Amount label configuration
 */
export interface AmountLabels {
    column: string;
    total: string;
    base: string;
    rate: string;
    isProfit?: boolean;
}

/**
 * Get amount labels based on display mode
 */
export function getAmountLabels(): AmountLabels {
    const amountDisplay = getAmountDisplayMode();
    if (amountDisplay === 'cost') {
        return {
            column: 'Cost',
            total: 'Total Cost (with OT)',
            base: 'Cost (no OT)',
            rate: `Cost rate ${RATE_SUFFIX}`,
        };
    }
    if (amountDisplay === 'profit') {
        return {
            column: 'Profit',
            total: 'Totals (with OT)',
            base: 'Base (no OT)',
            rate: `Rate ${RATE_SUFFIX}`,
            isProfit: true,
        };
    }
    return {
        column: 'Amount',
        total: 'Total (with OT)',
        base: 'Amount (no OT)',
        rate: `Rate ${RATE_SUFFIX}`,
    };
}

/**
 * Swatch colors for user identification
 */
const SWATCH_COLORS = [
    '#3b82f6',
    '#0ea5e9',
    '#22c55e',
    '#f59e0b',
    '#ef4444',
    '#14b8a6',
    '#64748b',
    '#84cc16',
];

/**
 * Get a consistent color for a given key
 */
export function getSwatchColor(key: string | undefined): string {
    const str = String(key || '');
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return SWATCH_COLORS[hash % SWATCH_COLORS.length];
}

/**
 * Builds pagination controls using DOM APIs instead of innerHTML.
 * Used by summary and overrides pagination to avoid unnecessary HTML parsing.
 *
 * @param page - Current page number (1-based)
 * @param totalPages - Total number of pages
 * @param btnClass - CSS class for page buttons (e.g. 'summary-page-btn')
 * @param dataAttr - Data attribute name for page number (e.g. 'summaryPage')
 * @param infoText - Optional info text (e.g. '100 rows')
 * @returns DocumentFragment with pagination controls, or null if only 1 page
 */
export function buildPaginationControls(
    page: number,
    totalPages: number,
    btnClass: string,
    dataAttr: string,
    infoText?: string
): DocumentFragment | null {
    if (totalPages <= 1) return null;

    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'pagination-controls';
    wrapper.style.cssText =
        'display:flex; justify-content:center; align-items:center; gap:10px; margin-top:16px;';

    const makeBtn = (label: string, targetPage: number, disabled: boolean) => {
        const btn = document.createElement('button');
        btn.className = `btn-secondary btn-sm ${btnClass}`;
        btn.textContent = label;
        btn.disabled = disabled;
        btn.dataset[dataAttr] = String(targetPage);
        return btn;
    };

    wrapper.appendChild(makeBtn('First', 1, page === 1));
    wrapper.appendChild(makeBtn('Prev', page - 1, page === 1));

    const info = document.createElement('span');
    info.style.cssText = 'font-size:12px; color:var(--text-secondary);';
    info.textContent = infoText
        ? `Page ${page} of ${totalPages} (${infoText})`
        : `Page ${page} of ${totalPages}`;
    wrapper.appendChild(info);

    wrapper.appendChild(makeBtn('Next', page + 1, page === totalPages));
    wrapper.appendChild(makeBtn('Last', totalPages, page === totalPages));

    fragment.appendChild(wrapper);
    return fragment;
}

// Re-export common utilities
export { formatHours, formatHoursDecimal, formatCurrency, escapeHtml };
