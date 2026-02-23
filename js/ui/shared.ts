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
            rate: 'Cost rate $/h',
        };
    }
    if (amountDisplay === 'profit') {
        return {
            column: 'Profit',
            total: 'Totals (with OT)',
            base: 'Base (no OT)',
            rate: 'Rate $/h',
            isProfit: true,
        };
    }
    return { column: 'Amount', total: 'Total (with OT)', base: 'Amount (no OT)', rate: 'Rate $/h' };
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

// Re-export common utilities
export { formatHours, formatHoursDecimal, formatCurrency, escapeHtml };
