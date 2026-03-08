/**
 * @fileoverview Main Entry Point and Application Controller
 *
 * Handles initialization (JWT parsing, theme, session timeout) and initial data loading.
 * Delegates to extracted modules for specific responsibilities:
 *
 * - `config-manager.ts` — Config control event binding and state sync
 * - `report-orchestrator.ts` — Report generation, caching, and data fetching
 * - `worker-manager.ts` — Web Worker pool and calculation orchestration
 * - `health-check.ts` — Application health monitoring endpoint
 * - `date-presets.ts` — Date range preset calculations
 *
 * ## Key Functions
 *
 * - **init()** — Parse JWT from URL, validate claims, apply theme, start session timeout
 * - **loadInitialData()** — Fetch workspace users, bind config/UI events, set app-ready flag
 */

import { store } from './state.js';
import { Api, resetRateLimiter, initApi } from './api.js';
import * as UI from './ui/index.js';
import {
    IsoUtils,
    base64urlDecode,
    setCanonicalTimeZone,
    isValidTimeZone,
} from './utils.js';
import { initErrorReporting, reportError } from './error-reporting.js';
import { SENTRY_DSN } from './constants.js';
import { initCSPReporter } from './csp-reporter.js';
import { createLogger } from './logger.js';
import { runCalculation } from './worker-manager.js';
import { bindConfigEvents } from './config-manager.js';
import { handleGenerateReport } from './report-orchestrator.js';
import type { TokenClaims, ApiStatus } from './types.js';

// Re-export for backward compatibility with tests
export { handleGenerateReport } from './report-orchestrator.js';
export { getHealthStatus } from './health-check.js';
export type { HealthCheckResult } from './health-check.js';

// Side-effect import: registers window.__OTPLUS_HEALTH_CHECK__
import './health-check.js';

const mainLogger = createLogger('Main');

// ============================================================================
// SESSION TIMEOUT MANAGEMENT
// ============================================================================
// Monitors JWT token expiration and warns users before session expires.
// Provides graceful re-authentication path.
// ============================================================================

/**
 * Timer ID for the session warning timeout.
 * Used to cancel the warning timer if session is renewed.
 */
let sessionWarningTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Timer ID for the session expiration timeout.
 * Used to cancel the expiration timer if session is renewed.
 */
let sessionExpirationTimerId: ReturnType<typeof setTimeout> | null = null;

let encryptionErrorListenerBound = false;

/**
 * Minutes before token expiration to show the warning.
 */
const SESSION_WARNING_MINUTES = 5;

/**
 * In Node/Jest, allow long-lived timers to avoid keeping worker processes alive.
 * Browser timer ids are numeric and simply bypass this.
 */
function unrefTimerIfSupported(timerId: ReturnType<typeof setTimeout> | null): void {
    if (!timerId || typeof timerId !== 'object') return;
    const maybeTimer = timerId as { unref?: () => void };
    if (typeof maybeTimer.unref === 'function') {
        maybeTimer.unref();
    }
}

/**
 * Initializes session timeout monitoring based on JWT expiration.
 * Sets up timers to warn user before expiration and handle expiration.
 *
 * @param claims - Decoded JWT token claims containing exp timestamp
 */
export function initSessionTimeout(claims: TokenClaims): void {
    // Clear any existing timers
    clearSessionTimers();

    // Check if token has expiration claim
    const exp = claims.exp;
    if (typeof exp !== 'number') {
        // No expiration claim; session doesn't expire (or we can't determine)
        return;
    }

    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const expiresInSeconds = exp - now;

    // If already expired, show expired dialog immediately
    if (expiresInSeconds <= 0) {
        store.clearToken();
        UI.showSessionExpiredDialog();
        return;
    }

    // Calculate when to show warning (5 minutes before expiration)
    const warningSeconds = expiresInSeconds - (SESSION_WARNING_MINUTES * 60);

    // Set up warning timer if there's enough time
    if (warningSeconds > 0) {
        sessionWarningTimerId = setTimeout(() => {
            const minutesRemaining = Math.ceil((exp - Math.floor(Date.now() / 1000)) / 60);
            UI.showSessionExpiringWarning(
                minutesRemaining,
                () => {
                    // User chose to reload/re-authenticate
                    location.reload();
                },
                () => {
                    // User dismissed the warning; they'll see expired dialog when it actually expires
                }
            );
        }, warningSeconds * 1000);
        unrefTimerIfSupported(sessionWarningTimerId);
    } else if (expiresInSeconds > 0) {
        // Less than 5 minutes remaining; show warning immediately
        const minutesRemaining = Math.ceil(expiresInSeconds / 60);
        UI.showSessionExpiringWarning(
            minutesRemaining,
            () => location.reload(),
            () => { /* dismissed */ }
        );
    }

    // Set up expiration timer
    sessionExpirationTimerId = setTimeout(() => {
        store.clearToken();
        UI.hideSessionWarning();
        UI.showSessionExpiredDialog();
    }, expiresInSeconds * 1000);
    unrefTimerIfSupported(sessionExpirationTimerId);
}

/**
 * Clears session timeout timers.
 * Called when initializing new session or cleaning up.
 */
export function clearSessionTimers(): void {
    if (sessionWarningTimerId !== null) {
        clearTimeout(sessionWarningTimerId);
        sessionWarningTimerId = null;
    }
    if (sessionExpirationTimerId !== null) {
        clearTimeout(sessionExpirationTimerId);
        sessionExpirationTimerId = null;
    }
}



// ============================================================================
// INITIALIZATION
// ============================================================================
// Application startup sequence: auth token validation, state setup, UI preparation.
// ============================================================================

/**
 * Sets default date range (today) in the UI date input controls.
 *
 * This function is called during application initialization to provide a reasonable
 * default date range for report generation. Both start and end dates default to today,
 * allowing users to quickly generate a same-day report.
 *
 * ## Edge Cases
 * - If the date inputs don't exist in the DOM, this silently returns (no error thrown)
 * - Uses local Date objects (not timezone-aware), so the date range reflects the browser's
 *   local time zone, not UTC
 * - Called before user can manually adjust dates, so it can be overridden immediately
 *
 * ## Related
 * - Persistence: User's chosen date range is persisted via "change" listeners in `bindConfigEvents()`
 */
export function setDefaultDates(): void {
    const today = new Date();

    const startEl = document.getElementById('startDate') as HTMLInputElement | null;
    const endEl = document.getElementById('endDate') as HTMLInputElement | null;

    if (startEl) startEl.value = IsoUtils.toDateKey(today);
    if (endEl) endEl.value = IsoUtils.toDateKey(today);
}

/**
 * Resolves the canonical timezone based on viewer profile claims, workspace claims, and browser default.
 */
function resolveCanonicalTimeZone(claims: TokenClaims | null): string {
    const userTimeZone = claims?.timeZone as string | undefined;
    if (userTimeZone && isValidTimeZone(userTimeZone)) {
        return userTimeZone;
    }
    const workspaceTimeZone =
        (claims?.workspaceTimeZone as string | undefined) ||
        (claims?.workspaceTimezone as string | undefined);
    if (workspaceTimeZone && isValidTimeZone(workspaceTimeZone)) {
        return workspaceTimeZone;
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Main application initialization entry point.
 *
 * This function is the first to run (called at module load time if not in test mode).
 * It orchestrates the authentication and setup sequence:
 *
 * 1. Initialize error reporting (Sentry) for crash capture
 * 2. Extract JWT token from URL query parameter (`auth_token`)
 * 3. Decode and validate JWT payload (must contain `workspaceId` claim)
 * 4. Apply theme setting from JWT claim (Clockify can set DARK/LIGHT theme)
 * 5. Store token in application state (via `store.setToken()`)
 * 6. Set default date range (today)
 * 7. Load initial data (fetch users, bind event handlers)
 *
 * ## Error Handling
 *
 * If any step fails, a user-friendly error message is displayed in the UI and an error
 * is reported to Sentry (if configured). The user is prompted to reload or contact support.
 * Execution stops and no further initialization occurs.
 *
 * ## Security Model
 *
 * - JWT is parsed from the URL (provided by Clockify iframe embed)
 * - Token claims are validated immediately (must have workspaceId)
 * - Token is stored in store.token for subsequent API calls (via X-Addon-Token header)
 * - Token is never logged, persisted, or exposed in error messages
 *
 * ## JWT Claims Handled
 *
 * - `workspaceId` (required) - Clockify workspace identifier
 * - `theme` (optional) - 'DARK' or 'LIGHT' to apply CSS class
 * - Other claims are silently ignored
 *
 * ## Called At
 *
 * - Module load time (bottom of file): `if (process.env.NODE_ENV !== 'test') init()`
 *
 * @throws Does not throw; any error is caught and displayed to user
 */
function isAllowedClockifyUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        return host === 'clockify.me' || host.endsWith('.clockify.me');
    } catch {
        return false;
    }
}

export function isAllowedOrigin(currentOrigin: string): boolean {
    const allowedOrigins = [
        'https://app.clockify.me',
        'https://clockify.me',
        'https://developer.clockify.me',
        'https://apet97.github.io',
        // Regional variants
        /^https:\/\/[a-z]{2}\.app\.clockify\.me$/,
        /^https:\/\/[a-z]{2}\.clockify\.me$/,
        // Development/localhost (only in non-production)
        ...(process.env.NODE_ENV !== 'production'
            ? ['http://localhost', /^http:\/\/localhost:\d+$/]
            : []),
    ];

    return allowedOrigins.some((allowed) => {
        if (typeof allowed === 'string') {
            return currentOrigin === allowed;
        }
        return allowed.test(currentOrigin);
    });
}

export async function init(): Promise<void> {
    // ========================================================================
    // CORS ORIGIN VALIDATION
    // ========================================================================
    // Validate that the addon is loaded from an allowed origin to prevent
    // unauthorized embedding. This protects against clickjacking and ensures
    // the addon only runs within the Clockify context.
    // ========================================================================
    const currentOrigin = window.location.origin;
    const isAllowedOriginResult = isAllowedOrigin(currentOrigin);

    if (!isAllowedOriginResult) {
        console.error('CORS: Unauthorized origin', currentOrigin);
        // Don't expose details in production
        const message = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
            ? 'This addon can only be accessed through Clockify.'
            : `Unauthorized origin: ${currentOrigin}`;

        // Try to show error in UI if possible
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent = message;
            emptyState.classList.remove('hidden');
        }
        // Signal initialization complete (with error) for E2E tests
        document.body.dataset.appReady = 'true';
        return;
    }

    // Initialize error reporting (Sentry) early for crash capture during initialization
    // This must happen before any other async operations to catch initialization errors
    initErrorReporting({
        dsn: SENTRY_DSN,
        environment: typeof process !== 'undefined' && process.env.NODE_ENV === 'production' ? 'production' : 'development',
        release: `otplus@${typeof process !== 'undefined' && process.env.VERSION ? process.env.VERSION : '0.0.0'}`,
        sampleRate: 1.0,
    }).catch((error) => {
        // Log for diagnostics but don't break app - error reporting is optional
        store.diagnostics = {
            ...store.diagnostics,
            sentryInitFailed: true,
        };
        mainLogger.warn('Error reporting initialization failed', {
            error: error?.message || error,
        });
    });

    // Initialize CSP violation reporter for enterprise security monitoring
    // - Console logging: Only in development (disabled in production to reduce noise)
    // - Sentry reporting: Always enabled for security alerting and compliance
    // Rate limiting (10/minute) prevents report flooding from potential attacks
    initCSPReporter({
        reportToConsole: typeof process !== 'undefined' && process.env.NODE_ENV !== 'production',
        reportToSentry: true, // Enterprise: always report CSP violations for security monitoring
    });

    // Initialize API module with store-backed dependencies (CQ-3 decoupling)
    initApi({
        getToken: () => store.token,
        getClaims: () => store.claims,
        getConfig: () => store.config,
        setApiStatus(field: keyof ApiStatus, value: number | boolean) {
            (store.apiStatus as unknown as Record<string, number | boolean>)[field] = value;
        },
        setUiPaginationFlag(flag: 'paginationTruncated' | 'paginationAbortedDueToTokenExpiration') {
            store.ui[flag] = true;
        },
        incrementThrottleRetry: () => store.incrementThrottleRetry(),
    });

    // Initialize DOM element references early so UI functions (like renderLoading) can work
    // even in error paths before loadInitialData() is reached
    UI.initializeElements();

    if (!encryptionErrorListenerBound && typeof window !== 'undefined') {
        encryptionErrorListenerBound = true;
        window.addEventListener('otplus:encryption-error', () => {
            UI.showError({
                title: 'Encryption Error',
                message: 'Override changes could not be encrypted and were not saved. Please reload the addon.',
                action: 'none',
                type: 'UNKNOWN',
                timestamp: new Date().toISOString(),
            });
        });
    }

    // Extract JWT token from URL query parameter.
    // Clockify provides this when embedding OTPLUS as an addon in an iframe.
    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');
    if (token && typeof history !== 'undefined' && typeof history.replaceState === 'function') {
        params.delete('auth_token');
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        history.replaceState({}, document.title, nextUrl);
    }

    // Validate that token exists before attempting to decode
    if (!token) {
        console.error('No auth token');
        reportError(new Error('No auth token provided'), {
            module: 'main',
            operation: 'init',
            level: 'warning',
        });
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent =
                'Error: No authentication token provided. Please access this addon through Clockify.';
            emptyState.classList.remove('hidden');
        }
        // Signal initialization complete (with error) for E2E tests
        document.body.dataset.appReady = 'true';
        return;
    }

    try {
        // Decode JWT: split on '.' to get payload (second part), then base64url decode
        // Format: header.payload.signature, we need payload
        // JWTs use Base64URL encoding which may contain `-` and `_` characters
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
            throw new Error('Invalid token format');
        }

        const payload = JSON.parse(base64urlDecode(tokenParts[1])) as TokenClaims;

        // Validate that payload contains required claims
        if (!payload || !payload.workspaceId) {
            throw new Error('Invalid token payload: missing workspaceId');
        }
        if (!payload.backendUrl || !isAllowedClockifyUrl(payload.backendUrl)) {
            throw new Error('Invalid token payload: untrusted backendUrl');
        }
        if (payload.reportsUrl && !isAllowedClockifyUrl(payload.reportsUrl)) {
            throw new Error('Invalid token payload: untrusted reportsUrl');
        }

        // Apply dark theme CSS class if Clockify sent theme=DARK claim
        // This ensures OTPLUS respects user's Clockify theme preference
        if (payload.theme === 'DARK') {
            document.body.classList.add('cl-theme-dark');
        }

        // Reset rate limiter when workspace changes to prevent cross-workspace throttle state pollution
        if (store.claims && store.claims.workspaceId !== payload.workspaceId) {
            resetRateLimiter();
        }

        // Store token and claims in centralized state (state.ts) for subsequent API calls
        store.setToken(token, payload);

        // Initialize localStorage encryption if configured
        // Await initialization to ensure encrypted writes are ready immediately
        if (store.config.encryptStorage) {
            try {
                await store.initEncryption();
                // Reload overrides with encryption support (handles migration from plaintext)
                await store.loadOverridesEncrypted();
            } catch (error) {
                console.warn('Encryption initialization failed', error);
            }
        }

        // Initialize session timeout monitoring
        initSessionTimeout(payload);

        // Resolve and set canonical timezone before deriving date keys
        const canonicalTimeZone = resolveCanonicalTimeZone(payload);
        setCanonicalTimeZone(canonicalTimeZone);

        // Initialize UI with sensible defaults (today)
        setDefaultDates();

        // Proceed to data load and event binding
        loadInitialData();
    } catch (e) {
        console.error('Invalid token', e);
        reportError(e instanceof Error ? e : new Error('Invalid token'), {
            module: 'main',
            operation: 'init',
            level: 'error',
        });
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent =
                'Error: Invalid authentication token. Please try accessing the addon again.';
            emptyState.classList.remove('hidden');
        }
        // Signal initialization complete (with error) for E2E tests
        document.body.dataset.appReady = 'true';
    }
}

/**
 * Loads initial workspace metadata and prepares the application UI.
 *
 * This function is called after successful authentication. It performs two main tasks:
 *
 * 1. **Fetch workspace users**: Retrieves the list of all users in the Clockify workspace.
 *    This is required before generating reports (to know who to calculate OT for).
 * 2. **Initialize UI controls**: Binds event listeners to config toggles, date pickers,
 *    export button, and other interactive elements.
 *
 * ## Data Loaded
 *
 * - `store.users` - Array of workspace users, used as the basis for report generation.
 *   Each user has `id`, `name`, and other profile metadata.
 *
 * ## Error Handling
 *
 * If fetching users fails (network error, permission error, etc.), an error dialog is shown
 * and execution stops. The user is prompted to reload or check permissions.
 *
 * If no users are found in the workspace, an error is shown (likely a permission issue or
 * the workspace is empty).
 *
 * ## Called By
 *
 * - `init()` - After successful JWT validation
 *
 * ## Sequence
 *
 * 1. Call `UI.initializeElements()` to set up DOM elements
 * 2. Show "Loading" spinner
 * 3. Fetch users from API
 * 4. Validate that we got at least one user
 * 5. Populate override controls with user list
 * 6. Bind configuration event handlers
 * 7. Bind report generation, export, and filter handlers
 * 8. Hide "Loading" spinner
 *
 * @throws Does not throw; errors are caught and displayed to user
 */
export async function loadInitialData(): Promise<void> {
    // DOM elements already initialized in init() — no need to re-query (PERF-3)

    // Show "Loading..." spinner while we fetch initial data
    UI.renderLoading(true);
    try {
        // Verify that init() successfully set the workspace ID
        if (!store.claims?.workspaceId) {
            throw new Error('No workspace ID');
        }

        // Fetch all workspace users from Clockify API
        // This is essential - we need to know which users exist before generating reports
        store.users = await Api.fetchUsers(store.claims.workspaceId);

        // Validate that we have at least one user to report on
        // Empty user list likely means: permission denied, workspace is empty, or API error
        if (!store.users || store.users.length === 0) {
            UI.renderLoading(false);
            UI.showError({
                title: 'No Users Found',
                message:
                    'No workspace members were found. Please check your permissions or try again.',
                action: 'reload',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
            });
            // Signal initialization complete (with error) for E2E tests
            document.body.dataset.appReady = 'true';
            return;
        }

        // Populate the overrides page (user override controls) now that we know which users exist
        // This must happen before bindConfigEvents() so the user list is ready
        UI.renderOverridesPage();
    } catch (error) {
        reportError(error instanceof Error ? error : new Error(String(error)), {
            module: 'main',
            operation: 'loadInitialData',
            level: 'error',
        });
        // Any error fetching users means we can't proceed with report generation
        UI.renderLoading(false);
        UI.showError({
            title: 'Failed to Load Users',
            message:
                'Could not fetch workspace members. Please check your connection and try again.',
            action: 'reload',
            type: 'API_ERROR',
            timestamp: new Date().toISOString(),
        });
        // Signal initialization complete (with error) for E2E tests
        document.body.dataset.appReady = 'true';
        return;
    }

    // Hide "Loading..." spinner now that initial data is loaded
    UI.renderLoading(false);

    // Bind event listeners to all configuration controls
    // This includes date pickers, config toggles, export button, etc.
    bindConfigEvents(handleGenerateReport);

    // Bind event listeners for report generation, overrides, filters, and other interactive elements
    // These handlers are triggered when the user interacts with the UI
    UI.bindEvents({
        onGenerate: handleGenerateReport,
        onOverrideChange: (userId: string, field: string, value: string) => {
            store.updateOverride(userId, field, value);
            if (store.rawEntries) runCalculation();
        },
        onOverrideModeChange: (userId: string, mode: string) => {
            store.setOverrideMode(userId, mode);
            // Note: renderOverridesPage() is called by the UI event handler when mode changes
            if (store.rawEntries) runCalculation();
        },
        onPerDayOverrideChange: (
            userId: string,
            dateKey: string,
            field: string,
            value: string
        ) => {
            store.updatePerDayOverride(userId, dateKey, field, value);
            if (store.rawEntries) runCalculation();
        },
        onCopyFromGlobal: (userId: string) => {
            const startInput = document.getElementById('startDate') as HTMLInputElement | null;
            const endInput = document.getElementById('endDate') as HTMLInputElement | null;
            if (startInput?.value && endInput?.value) {
                const dates = IsoUtils.generateDateRange(startInput.value, endInput.value);
                store.copyGlobalToPerDay(userId, dates);
                // Note: renderOverridesPage() is called by the UI event handler
                if (store.rawEntries) runCalculation();
            }
        },
        onWeeklyOverrideChange: (
            userId: string,
            weekday: string,
            field: string,
            value: string
        ) => {
            store.setWeeklyOverride(userId, weekday, field, value);
            if (store.rawEntries) runCalculation();
        },
        onCopyGlobalToWeekly: (userId: string) => {
            store.copyGlobalToWeekly(userId);
            // Note: renderOverridesPage() is called by the UI event handler
            if (store.rawEntries) runCalculation();
        },
    });

    // Signal that the app has finished initialization and event handlers are bound.
    // E2E tests wait for this attribute before interacting with the UI.
    document.body.dataset.appReady = 'true';
}



// ============================================================================
// APPLICATION ENTRY POINT
// ============================================================================
// Auto-initialize the application on module load (unless in test mode).
// Tests import functions directly and call them manually.
// ============================================================================

// Initialize OTPLUS application when the module loads
// (Skip init() in test environment; tests will call init() manually if needed)
if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    void init();
}
