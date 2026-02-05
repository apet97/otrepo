/**
 * @fileoverview Dialogs and Status UI Module
 * Handles error banners, loading states, and API status indicators.
 */

import { store } from '../state.js';
import type { FriendlyError } from '../types.js';
import { getElements, escapeHtml } from './shared.js';

const MIN_LOADING_MS = 120;
let loadingStartedAt = 0;
let loadingHideTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Sandbox-safe confirm() wrapper.
 * In sandboxed iframes without 'allow-modals', window.confirm() is silently ignored
 * and returns undefined. This helper detects that and returns a sensible default.
 * @param message - The confirmation message to display.
 * @param defaultValue - Value to return if confirm() is blocked by sandbox (default: true).
 * @returns The user's choice, or defaultValue if sandboxed.
 */
function safeConfirm(message: string, defaultValue: boolean = true): boolean {
    // In sandboxed iframes without allow-modals, confirm() is ignored and returns undefined
    const result = window.confirm(message);
    // If undefined (sandbox blocked), use default; otherwise use actual result
    return result === undefined ? defaultValue : result;
}

/**
 * Toggles the loading state visualization.
 * @param isLoading - True to show loading skeletons, false to hide.
 */
export function renderLoading(isLoading: boolean): void {
    const Elements = getElements();
    const generateBtn = document.getElementById('generateBtn');
    if (isLoading) {
        if (loadingHideTimeout) {
            clearTimeout(loadingHideTimeout);
            loadingHideTimeout = null;
        }
        loadingStartedAt = Date.now();
        Elements.loadingState?.classList.remove('hidden');
        Elements.resultsContainer?.classList.add('hidden');
        Elements.emptyState?.classList.add('hidden');
        generateBtn?.setAttribute('aria-busy', 'true');
    } else {
        const elapsed = Date.now() - loadingStartedAt;
        const remaining = MIN_LOADING_MS - elapsed;
        if (remaining > 0) {
            if (loadingHideTimeout) {
                clearTimeout(loadingHideTimeout);
            }
            loadingHideTimeout = setTimeout(() => {
                Elements.loadingState?.classList.add('hidden');
                generateBtn?.setAttribute('aria-busy', 'false');
                loadingHideTimeout = null;
            }, remaining);
            return;
        }
        Elements.loadingState?.classList.add('hidden');
        generateBtn?.setAttribute('aria-busy', 'false');
    }
}

/**
 * Renders the API status banner (warnings for failed fetches).
 * Shows which data sources (profiles, holidays, etc.) failed, implying fallback usage.
 *
 * STATUS BANNER LOGIC:
 * The banner is a shared resource used for multiple notification types:
 * 1. Partial API Failures (e.g., "Profiles failed - using fallback")
 * 2. General Errors (e.g., "Network error")
 * 3. Rate Limit Warnings (e.g., "Throttled 3 times")
 *
 * This function specifically handles #1. Other functions (showError, renderThrottleStatus)
 * may append to or replace this content.
 */
export function renderApiStatus(): void {
    const Elements = getElements();
    const banner = Elements.apiStatusBanner;
    if (!banner) return;

    const { profilesFailed, holidaysFailed, timeOffFailed } = store.apiStatus;
    const parts: string[] = [];

    if (profilesFailed > 0) parts.push(`Profiles: ${profilesFailed} failed`);
    if (holidaysFailed > 0) parts.push(`Holidays: ${holidaysFailed} failed`);
    if (timeOffFailed > 0) parts.push(`Time Off: ${timeOffFailed} failed`);

    if (parts.length === 0) {
        banner.classList.add('hidden');
        banner.textContent = '';
    } else {
        banner.classList.remove('hidden');
        banner.textContent = `⚠️ ${parts.join(' | ')} — using fallback values`;
    }
}

/**
 * Renders the pagination warning banner if results were truncated due to pagination limits.
 * Shows a warning to the user that results may be incomplete.
 */
export function renderPaginationWarning(): void {
    const banner = document.getElementById('paginationWarningBanner');
    if (!banner) return;

    if (store.ui.paginationTruncated) {
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

/**
 * Display error banner for user-friendly error messages.
 * @param error - Error object or message string.
 */
export function showError(error: FriendlyError | string): void {
    const Elements = getElements();

    // Hide loading state if visible
    Elements.loadingState?.classList.add('hidden');

    const errorData: FriendlyError =
        typeof error === 'string'
            ? {
                  title: 'Error',
                  message: error,
                  action: 'none',
                  type: 'UNKNOWN',
                  timestamp: new Date().toISOString(),
              }
            : error;

    const banner = Elements.apiStatusBanner || createErrorBanner();

    // Clear existing content and detach any old event listeners
    // by replacing innerHTML with empty string before rebuilding
    banner.textContent = '';

    // Build banner content using DOM API to properly manage listeners
    const showButton = errorData.action === 'retry' || errorData.action === 'reload';
    const content = document.createElement('div');
    content.className = 'api-status-banner-content';

    const strong = document.createElement('strong');
    strong.textContent = errorData.title;
    content.appendChild(strong);
    content.appendChild(document.createTextNode(`: ${errorData.message}`));

    // Attach event listener with { once: true } to auto-cleanup
    if (showButton) {
        const btn = document.createElement('button');
        btn.className = 'btn-sm btn-secondary error-action-btn';
        btn.textContent = 'Retry';
        /* istanbul ignore next -- reload callback cannot be safely tested in jsdom */
        btn.addEventListener('click', () => location.reload(), { once: true });
        content.appendChild(document.createTextNode(' '));
        content.appendChild(btn);
    }

    banner.appendChild(content);

    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide error banner.
 */
export function hideError(): void {
    const Elements = getElements();
    const banner = Elements.apiStatusBanner;
    if (banner) {
        banner.classList.add('hidden');
        banner.textContent = '';
    }
}

/**
 * Creates the error banner DOM element if it doesn't exist.
 * @returns The banner element.
 */
function createErrorBanner(): HTMLElement {
    const banner = document.createElement('div');
    banner.id = 'apiStatusBanner';
    banner.className = 'api-status-banner';
    const container = document.querySelector('.container');
    if (container) {
        document.body.insertBefore(banner, container);
    } else {
        document.body.appendChild(banner);
    }
    // Update cached elements
    const Elements = getElements();
    Elements.apiStatusBanner = banner;
    return banner;
}

/**
 * Shows a session expiring warning dialog.
 * Provides options to re-authenticate or dismiss the warning.
 * @param minutesRemaining - Minutes until session expires.
 * @param onReauth - Callback when user chooses to re-authenticate.
 * @param onDismiss - Callback when user dismisses the warning.
 */
export function showSessionExpiringWarning(
    minutesRemaining: number,
    onReauth: () => void,
    onDismiss: () => void
): void {
    // Create or reuse the session warning banner
    let banner = document.getElementById('sessionWarningBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sessionWarningBanner';
        banner.className = 'api-status-banner session-warning-banner';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'assertive');

        const container = document.querySelector('.container');
        if (container && container.firstChild) {
            container.insertBefore(banner, container.firstChild);
        } else if (container) {
            container.appendChild(banner);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }

    const timeText = minutesRemaining <= 1
        ? 'less than a minute'
        : `${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}`;

    banner.innerHTML = `
        <div class="session-warning-content">
            <span class="session-warning-icon" aria-hidden="true">&#9888;</span>
            <span class="session-warning-text">
                Your session will expire in <strong>${escapeHtml(timeText)}</strong>.
                Please save your work and reload the addon to continue.
            </span>
            <div class="session-warning-actions">
                <button class="btn-sm btn-primary session-reauth-btn" type="button">Reload Now</button>
                <button class="btn-sm btn-secondary session-dismiss-btn" type="button">Dismiss</button>
            </div>
        </div>
    `;

    // Attach event listeners
    const reauthBtn = banner.querySelector('.session-reauth-btn');
    const dismissBtn = banner.querySelector('.session-dismiss-btn');

    if (reauthBtn) {
        reauthBtn.addEventListener('click', () => {
            hideSessionWarning();
            onReauth();
        }, { once: true });
    }

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            hideSessionWarning();
            onDismiss();
        }, { once: true });
    }

    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Hides the session expiring warning banner.
 */
export function hideSessionWarning(): void {
    const banner = document.getElementById('sessionWarningBanner');
    if (banner) {
        banner.classList.add('hidden');
    }
}

/**
 * Shows a session expired dialog.
 * Forces user to reload to re-authenticate.
 */
export function showSessionExpiredDialog(): void {
    const Elements = getElements();

    // Hide loading state if visible
    Elements.loadingState?.classList.add('hidden');

    // Create modal overlay
    let modal = document.getElementById('sessionExpiredModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sessionExpiredModal';
        modal.className = 'modal-overlay';
        modal.tabIndex = -1;
        modal.setAttribute('role', 'alertdialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'sessionExpiredTitle');
        modal.setAttribute('aria-describedby', 'sessionExpiredDesc');

        modal.innerHTML = `
            <div class="modal-content session-expired-modal">
                <h2 id="sessionExpiredTitle">Session Expired</h2>
                <p id="sessionExpiredDesc">
                    Your authentication session has expired. Please reload the addon to continue.
                </p>
                <div class="modal-actions">
                    <button class="btn-primary session-reload-btn" type="button">Reload Addon</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const reloadBtn = modal.querySelector('.session-reload-btn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => {
                location.reload();
            });
        }
    }

    modal.classList.remove('hidden');
    setupModalFocusTrap(modal);

    // Focus the reload button for accessibility
    const reloadBtn = modal.querySelector('.session-reload-btn') as HTMLButtonElement | null;
    if (reloadBtn) {
        reloadBtn.focus();
    }
}

function setupModalFocusTrap(modal: HTMLElement): void {
    if (modal.dataset.focusTrap === 'true') return;
    modal.dataset.focusTrap = 'true';

    modal.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;

        const focusable = Array.from(
            modal.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
        ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

        if (focusable.length === 0) {
            event.preventDefault();
            modal.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
            if (!active || active === first || !modal.contains(active)) {
                event.preventDefault();
                last.focus();
            }
            return;
        }

        if (active === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

/**
 * Shows a confirmation dialog for clearing all data.
 * @param onConfirm - Callback when user confirms.
 */
export function showClearDataConfirmation(onConfirm: () => void): void {
    // Default false: don't clear data without explicit user consent
    const confirmed = safeConfirm(
        'Are you sure you want to clear all stored data? This will remove:\n\n' +
            '• All saved configuration settings\n' +
            '• User override settings\n' +
            '• Cached profile data\n\n' +
            'This action cannot be undone.',
        false
    );

    if (confirmed) {
        onConfirm();
    }
}

/**
 * Shows a warning dialog for large date ranges.
 * @param days - Number of days in the selected range.
 * @returns Promise that resolves to true if user confirms, false if cancelled.
 */
export function showLargeDateRangeWarning(days: number): Promise<boolean> {
    const isVeryLarge = days > 730; // More than 2 years
    const message = isVeryLarge
        ? `You selected a ${days}-day range (over 2 years).\n\n` +
          'Very large ranges may cause significant slowdowns and may exceed API limits.\n\n' +
          'Are you sure you want to proceed?'
        : `You selected a ${days}-day range.\n\n` +
          'Large date ranges may take longer to process.\n\n' +
          'Continue?';

    // Default true: proceed with report generation if sandbox blocks confirm
    return Promise.resolve(safeConfirm(message, true));
}

/**
 * Updates the loading progress display during fetch operations.
 * @param current - Current item number.
 * @param phase - Current phase description (e.g., 'entries', 'profiles').
 */
export function updateLoadingProgress(current: number, phase: string): void {
    const Elements = getElements();
    const loadingState = Elements.loadingState;
    if (!loadingState) return;

    // Find or create the progress text element
    let progressText = loadingState.querySelector('.loading-progress') as HTMLElement | null;
    if (!progressText) {
        progressText = document.createElement('div');
        progressText.className = 'loading-progress';
        progressText.style.cssText = 'font-size: 13px; color: var(--text-muted); margin-top: 8px; text-align: center;';
        loadingState.appendChild(progressText);
    }

    progressText.textContent = `Fetching ${phase} (page ${current})...`;
}

/**
 * Clears the loading progress display.
 */
export function clearLoadingProgress(): void {
    const Elements = getElements();
    const loadingState = Elements.loadingState;
    if (!loadingState) return;

    const progressText = loadingState.querySelector('.loading-progress');
    if (progressText) {
        progressText.remove();
    }
}

/**
 * Renders the throttle status banner when rate limiting is detected.
 * @param retryCount - Number of 429 retries encountered.
 */
export function renderThrottleStatus(retryCount: number): void {
    const Elements = getElements();
    const banner = Elements.apiStatusBanner;
    if (!banner) return;

    // Only show throttle warning if 3+ retries occurred
    if (retryCount < 3) {
        return;
    }

    // Don't replace existing error content, append throttle info
    const existingContent = banner.textContent || '';
    if (existingContent.includes('Rate limiting')) {
        return; // Already showing throttle warning
    }

    const throttleMessage = `\u26A0\uFE0F Rate limiting detected (${retryCount} retries). Report generation may be slower than usual.`;

    if (existingContent && !existingContent.includes('Rate limiting')) {
        banner.textContent = existingContent + ' | ' + throttleMessage;
    } else {
        banner.textContent = throttleMessage;
    }
    banner.classList.remove('hidden');
}

/**
 * Cache action type for report caching
 */
export type CacheAction = 'use' | 'refresh';

/**
 * Shows a prompt asking the user whether to use cached report data or refresh.
 * @param cacheAgeSeconds - Age of the cache in seconds.
 * @returns Promise resolving to 'use' to use cache, 'refresh' to fetch fresh data.
 */
export function showCachePrompt(cacheAgeSeconds: number): Promise<CacheAction> {
    const ageMinutes = Math.round(cacheAgeSeconds / 60);
    const ageText = ageMinutes < 1 ? 'less than a minute' : `${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''}`;

    const message =
        `Cached report data found (${ageText} old).\n\n` +
        'Use cached data for faster loading, or refresh to fetch the latest?\n\n' +
        'Click OK to use cache, Cancel to refresh.';

    // Default true: use cache for faster loading if sandbox blocks confirm
    const useCached = safeConfirm(message, true);
    return Promise.resolve(useCached ? 'use' : 'refresh');
}
