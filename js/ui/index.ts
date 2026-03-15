/**
 * @fileoverview UI Module Entry Point
 * Re-exports all UI functions and handles event binding.
 */

import { store } from '../state.js';
import type { UICallbacks } from '../types.js';
// Import for internal use
import { getElements } from './shared.js';
import { renderDetailedTable } from './detailed.js';
import { renderSummaryTable } from './summary.js';
import { showOverridesPage, hideOverridesPage, renderOverridesPage } from './overrides.js';

// Re-export all public functions
export { initializeElements, getElements } from './shared.js';
export { renderSummaryStrip, renderSummaryExpandToggle, renderSummaryTable } from './summary.js';
export {
    renderDetailedTable,
    destroyDetailedObserver,
    invalidateDetailedCache,
} from './detailed.js';
// Data-layer exports: canonical source is data-selectors, re-exported here for backward compatibility
export {
    computeSummaryRows,
    getCachedDetailedEntries,
    type DetailedEntry,
} from '../data-selectors.js';
export { showOverridesPage, hideOverridesPage, renderOverridesPage } from './overrides.js';
export {
    renderLoading,
    renderApiStatus,
    renderPaginationWarning,
    showError,
    hideError,
    showClearDataConfirmation,
    showLargeDateRangeWarning,
    updateLoadingProgress,
    clearLoadingProgress,
    renderThrottleStatus,
    showCachePrompt,
    showSessionExpiringWarning,
    hideSessionWarning,
    showSessionExpiredDialog,
} from './dialogs.js';
export type { CacheAction } from './dialogs.js';

/** Shared handler: prevent scroll wheel from changing focused number inputs. */
function createWheelHandler(): (e: WheelEvent) => void {
    return (e: WheelEvent) => {
        const target = e.target as HTMLElement;
        if (
            target.tagName === 'INPUT' &&
            (target as HTMLInputElement).type === 'number' &&
            document.activeElement === target
        ) {
            e.preventDefault();
        }
    };
}

/** Toggle collapse on an override card (used by both click and keyboard). */
function toggleCardCollapse(header: Element): void {
    const card = header.closest('.override-user-card');
    if (!card) return;
    card.classList.toggle('collapsed');
    const isExpanded = !card.classList.contains('collapsed');
    header.setAttribute('aria-expanded', String(isExpanded));
    const toggleIcon = header.querySelector('.toggle-icon');
    if (toggleIcon) {
        toggleIcon.textContent = isExpanded ? '\u25BC' : '\u25B6';
    }
}

/** Bind detailed table events (pagination, status popover). Returns cleanup. */
function bindDetailedTableEvents(
    detailedContainer: HTMLElement,
    wheelHandler: (e: WheelEvent) => void
): () => void {
    detailedContainer.addEventListener('wheel', wheelHandler, { passive: false });

    const clickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;

        // Pagination
        if (target.matches('.pagination-btn')) {
            const newPage = parseInt(target.dataset.page || '', 10);
            if (!isNaN(newPage)) {
                store.ui.detailedPage = newPage;
                if (store.analysisResults) {
                    renderDetailedTable(store.analysisResults);
                }
            }
            return;
        }

        // Status info popover toggle
        const btn = target.closest('.status-info-btn') as HTMLElement | null;
        if (btn) {
            e.stopPropagation();
            const headerCell = btn.closest('.status-header-cell');
            if (!headerCell) return;

            let popover = headerCell.querySelector('.status-info-popover') as HTMLElement | null;

            if (popover) {
                popover.classList.toggle('hidden');
            } else {
                popover = document.createElement('div');
                popover.className = 'status-info-popover';
                popover.innerHTML = `
                    <button class="popover-close" aria-label="Close" type="button">&times;</button>
                    <h4>Status Badges</h4>
                    <dl>
                        <dt>HOLIDAY ENTRY</dt>
                        <dd>PTO entry (counts as regular hours)</dd>
                        <dt>TIME-OFF ENTRY</dt>
                        <dd>PTO entry (counts as regular hours)</dd>
                        <dt>HOLIDAY</dt>
                        <dd>Work on a holiday (all work is overtime)</dd>
                        <dt>TIME-OFF</dt>
                        <dd>Day has time-off reducing capacity</dd>
                        <dt>OFF-DAY</dt>
                        <dd>Non-working day (weekend)</dd>
                        <dt>BREAK</dt>
                        <dd>Break entry (counts as regular hours)</dd>
                    </dl>
                `;
                const closeBtn = popover.querySelector('.popover-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        popover?.classList.add('hidden');
                    });
                }
                headerCell.appendChild(popover);
            }
            return;
        }

        // Close popover when clicking outside (but inside container)
        const openPopover = detailedContainer?.querySelector('.status-info-popover:not(.hidden)');
        if (openPopover && !openPopover.contains(target)) {
            openPopover.classList.add('hidden');
        }
    };
    detailedContainer.addEventListener('click', clickHandler);

    return () => {
        detailedContainer.removeEventListener('wheel', wheelHandler, {
            passive: false,
        } as EventListenerOptions);
        detailedContainer.removeEventListener('click', clickHandler);
    };
}

/** Bind summary table pagination. Returns cleanup. */
function bindSummaryPagination(): () => void {
    const container = document.getElementById('summaryPaginationControls');
    if (!container) return () => {};

    const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.matches('.summary-page-btn')) {
            const newPage = parseInt(target.dataset.summaryPage || '', 10);
            if (!isNaN(newPage)) {
                store.ui.summaryPage = newPage;
                if (store.analysisResults) {
                    renderSummaryTable(store.analysisResults);
                }
            }
        }
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
}

/** Bind overrides panel events (pagination, search, inputs, cards). Returns cleanup. */
function bindOverridesEvents(
    callbacks: UICallbacks,
    Elements: ReturnType<typeof getElements>,
    wheelHandler: (e: WheelEvent) => void
): () => void {
    const cleanups: (() => void)[] = [];

    // Wheel handler on overrides list
    const overridesUserList = Elements.overridesUserList;
    if (overridesUserList) {
        overridesUserList.addEventListener('wheel', wheelHandler, { passive: false });
        cleanups.push(() =>
            overridesUserList.removeEventListener('wheel', wheelHandler, {
                passive: false,
            } as EventListenerOptions)
        );
    }

    // Overrides pagination
    const paginationContainer = document.getElementById('overridesPaginationControls');
    if (paginationContainer) {
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.matches('.overrides-page-btn')) {
                const newPage = parseInt(target.dataset.overridesPage || '', 10);
                if (!isNaN(newPage)) {
                    store.ui.overridesPage = newPage;
                    renderOverridesPage();
                }
            }
        };
        paginationContainer.addEventListener('click', handler);
        cleanups.push(() => paginationContainer.removeEventListener('click', handler));
    }

    // Overrides search with debounce
    const searchContainer = document.getElementById('overridesSearchContainer');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    if (searchContainer) {
        const handler = (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target.id === 'overridesSearchInput') {
                if (searchTimer) clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    store.ui.overridesSearch = target.value;
                    store.ui.overridesPage = 1;
                    renderOverridesPage();
                }, 250);
            }
        };
        searchContainer.addEventListener('input', handler);
        cleanups.push(() => {
            searchContainer.removeEventListener('input', handler);
            if (searchTimer) clearTimeout(searchTimer);
        });
    }

    // Card input delegation (global, per-day, weekly overrides)
    const inputHandler = (e: Event) => {
        const target = e.target as HTMLElement;

        if (target.matches('input.override-input')) {
            const input = target as HTMLInputElement;
            const { userid, field } = input.dataset;
            if (userid && field) {
                callbacks.onOverrideChange(userid, field, input.value);
                const card = target.closest('.override-user-card');
                if (card) {
                    const override = store.overrides[userid] || {};
                    const hasCustom =
                        override.capacity != null ||
                        override.multiplier != null ||
                        override.tier2Threshold != null ||
                        override.tier2Multiplier != null;
                    card.classList.toggle('has-custom', !!hasCustom);
                }
            }
        }

        if (target.matches('input.per-day-input')) {
            const input = target as HTMLInputElement;
            const { userid, datekey, field } = input.dataset;
            if (userid && datekey && field) {
                callbacks.onPerDayOverrideChange(userid, datekey, field, input.value);
            }
        }

        if (target.matches('input.weekly-input')) {
            const input = target as HTMLInputElement;
            const { userid, weekday, field } = input.dataset;
            if (userid && weekday && field) {
                callbacks.onWeeklyOverrideChange(userid, weekday, field, input.value);
            }
        }
    };

    // Mode select handler
    const changeHandler = (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.matches('select.mode-select')) {
            const select = target as HTMLSelectElement;
            const { userid } = select.dataset;
            if (userid) {
                callbacks.onOverrideModeChange(userid, select.value);
                renderOverridesPage();
                // Re-expand the card whose mode was just changed
                const escaped =
                    typeof CSS !== 'undefined' && CSS.escape
                        ? CSS.escape(userid)
                        : userid.replace(/["\\]/g, '\\$&');
                const card = overridesUserList?.querySelector(
                    `.override-user-card[data-userid="${escaped}"]`
                );
                if (card) {
                    const hdr = card.querySelector('.override-user-header');
                    if (hdr) toggleCardCollapse(hdr);
                }
            }
        }
    };

    // Keyboard navigation for card headers (Enter/Space)
    const keydownHandler = (e: Event) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
            const target = e.target as HTMLElement;
            const header = target.closest('.override-user-header');
            if (header) {
                e.preventDefault();
                toggleCardCollapse(header);
            }
        }
    };

    // Card click delegation (collapse toggle, copy buttons)
    const clickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;

        const header = target.closest('.override-user-header');
        if (header) {
            toggleCardCollapse(header);
            return;
        }

        if (target.matches('button.copy-from-global-btn')) {
            const { userid } = target.dataset;
            if (userid) {
                callbacks.onCopyFromGlobal(userid);
                renderOverridesPage();
            }
        }

        if (target.matches('button.copy-global-to-weekly-btn')) {
            const { userid } = target.dataset;
            if (userid) {
                callbacks.onCopyGlobalToWeekly(userid);
                renderOverridesPage();
            }
        }
    };

    if (overridesUserList) {
        overridesUserList.addEventListener('input', inputHandler);
        overridesUserList.addEventListener('change', changeHandler);
        overridesUserList.addEventListener('keydown', keydownHandler);
        overridesUserList.addEventListener('click', clickHandler);
        cleanups.push(() => {
            overridesUserList.removeEventListener('input', inputHandler);
            overridesUserList.removeEventListener('change', changeHandler);
            overridesUserList.removeEventListener('keydown', keydownHandler);
            overridesUserList.removeEventListener('click', clickHandler);
        });
    }

    // Open/close overrides page buttons
    const openHandler = () => showOverridesPage();
    const closeHandler = () => {
        hideOverridesPage();
        if (store.rawEntries) callbacks.onRecalculate();
    };
    const openBtn = Elements.openOverridesBtn;
    const closeBtn = Elements.closeOverridesBtn;
    if (openBtn) {
        openBtn.addEventListener('click', openHandler);
        cleanups.push(() => openBtn.removeEventListener('click', openHandler));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', closeHandler);
        cleanups.push(() => closeBtn.removeEventListener('click', closeHandler));
    }

    return () => cleanups.forEach((fn) => fn());
}

/** Bind keyboard accessibility events (Escape, arrow keys). Returns cleanup. */
function bindKeyboardAccessibility(detailedContainer: HTMLElement | null): () => void {
    const cleanups: (() => void)[] = [];

    // Close popover on Escape
    const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && detailedContainer) {
            const openPopover = detailedContainer.querySelector(
                '.status-info-popover:not(.hidden)'
            );
            if (openPopover) {
                openPopover.classList.add('hidden');
            }
        }
    };
    document.addEventListener('keydown', escapeHandler);
    cleanups.push(() => document.removeEventListener('keydown', escapeHandler));

    // Arrow key navigation for filter chips (radiogroup pattern)
    const filterChipContainer = document.getElementById('detailedFilters');
    if (filterChipContainer) {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const chips = Array.from(filterChipContainer.querySelectorAll<HTMLElement>('.chip'));
            if (chips.length === 0) return;
            const currentIndex = chips.indexOf(e.target as HTMLElement);
            if (currentIndex === -1) return;
            e.preventDefault();
            const nextIndex =
                e.key === 'ArrowRight'
                    ? (currentIndex + 1) % chips.length
                    : (currentIndex - 1 + chips.length) % chips.length;
            chips[nextIndex].focus();
            chips[nextIndex].click();
        };
        filterChipContainer.addEventListener('keydown', handler);
        cleanups.push(() => filterChipContainer.removeEventListener('keydown', handler));
    }

    return () => cleanups.forEach((fn) => fn());
}

/**
 * Binds global UI events (scrolling, inputs, buttons).
 * Uses delegation for dynamic elements like pagination.
 *
 * @param callbacks - Callback functions for actions (onGenerate, onOverrideChange).
 */
let _eventsBound = false;

/** Reset bindEvents guard (for testing only). */
export function resetBindEventsGuard(): void {
    _eventsBound = false;
}

export function bindEvents(callbacks: UICallbacks): () => void {
    if (_eventsBound) return () => {};
    _eventsBound = true;

    const Elements = getElements();
    const wheelHandler = createWheelHandler();
    const detailedContainer = document.getElementById('detailedTableContainer');
    const cleanups: (() => void)[] = [];

    // Detailed table events (pagination, popover)
    if (detailedContainer) {
        cleanups.push(bindDetailedTableEvents(detailedContainer, wheelHandler));
    }

    // Summary pagination
    cleanups.push(bindSummaryPagination());

    // Overrides panel (pagination, search, inputs, cards, open/close)
    cleanups.push(bindOverridesEvents(callbacks, Elements, wheelHandler));

    // Keyboard accessibility (Escape, arrow keys)
    cleanups.push(bindKeyboardAccessibility(detailedContainer));

    // Generate button
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        const handler = () => callbacks.onGenerate();
        generateBtn.addEventListener('click', handler);
        cleanups.push(() => generateBtn.removeEventListener('click', handler));
    }

    return () => {
        cleanups.forEach((fn) => fn());
        _eventsBound = false;
    };
}
