/**
 * @fileoverview Main Entry Point and Application Controller
 *
 * This module orchestrates the entire OTPLUS application lifecycle, from initialization
 * through report generation, calculation, and UI rendering. It acts as the central hub
 * that coordinates interactions between the API layer, calculation engine, state management,
 * and UI components.
 *
 * ## Module Responsibilities
 *
 * 1. **Initialization**: Parse JWT from URL, validate token claims, apply theme settings
 * 2. **Data Orchestration**: Coordinate parallel fetches (entries, profiles, holidays, time-off)
 * 3. **Configuration Management**: Bind config controls, persist settings, trigger recalculations
 * 4. **Report Generation**: Main orchestrator that coordinates data fetch → calculation → render
 * 5. **UI Event Binding**: Wire up user interactions (date pickers, filters, export, etc.)
 * 6. **Abort/Cancellation**: Handle concurrent request cancellation (prevent stale response race)
 *
 * ## Dependencies
 *
 * **State Management**:
 * - `store` (state.ts) - Centralized application state, config, persistence
 *
 * **Data Layer**:
 * - `Api` (api.ts) - Clockify API client with rate limiting and pagination
 *
 * **Calculation**:
 * - `calculateAnalysis()` (calc.ts) - Pure overtime/billable calculation engine
 *
 * **UI**:
 * - `UI/*` (ui/*.ts) - Rendering modules for tables, summaries, dialogs
 *
 * **Export**:
 * - `downloadCsv` (export.ts) - CSV generation with formula injection protection
 *
 * **Utilities**:
 * - `IsoUtils, debounce, parseIsoDuration, getDateRangeDays` (utils.ts)
 * - `initErrorReporting, reportError` (error-reporting.ts)
 * - `SENTRY_DSN` (constants.ts)
 *
 * ## Data Flow Diagram
 *
 * ```
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                           INITIALIZATION                               │
 * │  URL params ──► JWT decode ──► store.setToken() ──► loadInitialData() │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                         DATA FETCHING (Parallel)                       │
 * │                                                                        │
 * │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
 * │  │ fetchEntries │  │fetchProfiles │  │fetchHolidays │  │fetchTimeOff│ │
 * │  │ (Reports API)│  │  (per user)  │  │  (per user)  │  │ (per user) │ │
 * │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
 * │         │                 │                 │                │        │
 * │         ▼                 ▼                 ▼                ▼        │
 * │  store.rawEntries    store.profiles    store.holidays   store.timeOff │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                          CALCULATION                                   │
 * │                                                                        │
 * │  runCalculation() calls calculateAnalysis()                            │
 * │                                                                        │
 * │  Input: entries, store (profiles, holidays, timeOff, config, params)  │
 * │  Output: UserAnalysis[] with daily OT breakdowns                       │
 * │                                                                        │
 * │  ┌─────────────────────────────────────────────────────────────────┐  │
 * │  │ For each user:                                                   │  │
 * │  │   1. Group entries by dateKey                                    │  │
 * │  │   2. Determine effective capacity (overrides > profile > global) │  │
 * │  │   3. Apply holiday/time-off/non-working day adjustments          │  │
 * │  │   4. Tail attribution: sort by start, assign OT to tail          │  │
 * │  │   5. Split billable/non-billable, apply tiered multipliers       │  │
 * │  └─────────────────────────────────────────────────────────────────┘  │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                           RENDERING                                    │
 * │                                                                        │
 * │  store.analysisResults ──► UI.renderSummaryStrip()                    │
 * │                        ──► UI.renderSummaryTable()                     │
 * │                        ──► UI.renderDetailedTable() (paginated)        │
 * │                        ──► UI.renderOverridesTable()                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                            EXPORT                                      │
 * │                                                                        │
 * │  User clicks Export ──► downloadCsv(analysisResults)                  │
 * │                         - Formula injection protection                 │
 * │                         - Decimal hours column                         │
 * └────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Functions
 *
 * - **init()** - Application entry point; parses auth token from URL, validates claims, applies theme
 * - **loadInitialData()** - Fetches workspace users and initializes UI event bindings
 * - **handleGenerateReport()** - Main orchestrator for report generation: validates dates, fetches data,
 *   handles caching, triggers calculation, updates UI
 * - **runCalculation()** - Delegates to calculation engine and renders all output tables
 * - **bindConfigEvents()** - Wires up config controls (toggles, inputs, date pickers, tabs)
 *
 * ## Concurrency & Cancellation
 *
 * Multiple `handleGenerateReport()` calls can fire rapidly (e.g., date picker changes). To prevent
 * race conditions where a newer request's calculation completes after an older one:
 *
 * 1. **AbortController**: Each request creates an AbortController and passes its signal to API calls.
 *    If a new request starts before the old one finishes, `abortController.abort()` signals cancellation.
 * 2. **Request ID**: Each request increments `currentRequestId`. Before updating UI, we check if the
 *    response matches `thisRequestId === currentRequestId`. Stale responses are silently discarded.
 * 3. **Graceful Degradation**: Optional fetches (profiles, holidays, time-off) use `Promise.allSettled()`
 *    so a single failure doesn't block the report. Failures are tracked in `store.apiStatus` for UI display.
 *
 * ## Error Handling Strategy
 *
 * - **Auth errors**: Handled at init(); display error banner with retry prompt
 * - **API errors**: Graceful degradation - optional data (profiles, holidays) can fail without blocking report
 * - **Calculation errors**: Any calculation error stops the report (this should be rare with pure calc.ts)
 * - **Sentry integration**: Error-reporting.ts captures exceptions with context metadata (module, operation, level)
 *
 * ## Performance Considerations
 *
 * - **Debouncing**: Config inputs (daily threshold, multiplier) use 300ms debounce to avoid redundant calculations
 * - **Caching**: Detailed report results are cached in sessionStorage by date range, with user prompt for stale data
 * - **Incremental rendering**: Each UI render function updates its own section independently
 * - **Request cancellation**: New requests abort old ones to save bandwidth and prevent UI churn
 *
 * ## Security Notes
 *
 * - **No token logging**: Auth token is never logged or persisted (only set in store.token for API use)
 * - **XSS prevention**: All user inputs and API-provided strings are escaped by UI modules (not here)
 * - **Sentry privacy**: Error reports don't include PII (user names, workspace IDs not logged in errors)
 *
 * ## Related Documentation
 *
 * - `docs/prd.md` - Product requirements and feature specifications
 * - `docs/spec.md` - Technical specification for calculation rules
 * - `docs/guide.md` - Operational guide and API call reference
 * - `CONTRIBUTING.md` - Development guidelines and contribution rules
 */

import { store, isUsingFallbackStorage } from './state.js';
import { Api, resetRateLimiter, getCircuitBreakerState } from './api.js';
import { calculateAnalysis } from './calc.js';
import { downloadCsv } from './export.js';
import * as UI from './ui/index.js';
import {
    IsoUtils,
    debounce,
    parseIsoDuration,
    getDateRangeDays,
    base64urlDecode,
    setCanonicalTimeZone,
    isValidTimeZone,
} from './utils.js';
import { initErrorReporting, reportError } from './error-reporting.js';
import { SENTRY_DSN } from './constants.js';
import { initCSPReporter } from './csp-reporter.js';
import { startTimer, incrementCounter, MetricNames } from './metrics.js';
import { createWorkerPool, WorkerPool } from './worker-pool.js';
import { createLogger } from './logger.js';
import type { DateRange, TimeEntry, TokenClaims, UserAnalysis } from './types.js';

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
// HEALTH CHECK ENDPOINT
// ============================================================================
// Provides application health status for monitoring systems.
// Aggregates status from circuit breaker, storage, API, worker, and encryption components.
// ============================================================================

/**
 * Health check status result.
 * Provides comprehensive status for monitoring tools and dashboards.
 */
export interface HealthCheckResult {
    /** Overall health status: 'healthy', 'degraded', or 'unhealthy' */
    status: 'healthy' | 'degraded' | 'unhealthy';
    /** ISO timestamp of when the check was performed */
    timestamp: string;
    /** Application version from package.json */
    version: string;
    /** Detailed component status */
    components: {
        /** Circuit breaker status */
        circuitBreaker: {
            state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
            failureCount: number;
            isHealthy: boolean;
        };
        /** Storage subsystem status */
        storage: {
            type: 'localStorage' | 'memory';
            isHealthy: boolean;
        };
        /** API integration status */
        api: {
            profilesFailed: number;
            holidaysFailed: number;
            timeOffFailed: number;
            isHealthy: boolean;
        };
        /** Authentication status */
        auth: {
            hasToken: boolean;
            isExpired: boolean;
            isHealthy: boolean;
        };
        /** Worker subsystem status */
        workers: {
            supported: boolean;
            initialized: boolean;
            terminated: boolean;
            taskFailures: number;
            isHealthy: boolean;
        };
        /** Encryption subsystem status */
        encryption: {
            enabled: boolean;
            supported: boolean;
            keyReady: boolean;
            pending: boolean;
            isHealthy: boolean;
        };
    };
    /** Array of issues if status is degraded or unhealthy */
    issues: string[];
}

/**
 * Performs a comprehensive health check of the application.
 *
 * This function aggregates health status from multiple subsystems:
 * - Circuit breaker: Checks if API requests are being blocked due to failures
 * - Storage: Checks if localStorage is available or using fallback
 * - API: Checks for failed profile/holiday/time-off fetches
 * - Auth: Checks token validity and expiration
 * - Workers: Checks worker pool status and task failures
 * - Encryption: Checks encryption key readiness when enabled
 *
 * ## Status Levels
 * - **healthy**: All components functioning normally
 * - **degraded**: Some components have issues but app is functional
 * - **unhealthy**: Critical components failing, app may not function
 *
 * ## Usage
 * ```javascript
 * // From browser console or monitoring tools:
 * const health = window.__OTPLUS_HEALTH_CHECK__();
 * console.log(health.status); // 'healthy', 'degraded', or 'unhealthy'
 * ```
 *
 * ## Monitoring Integration
 * This function is exposed on `window.__OTPLUS_HEALTH_CHECK__` for external
 * monitoring tools to call. The result is JSON-serializable.
 *
 * @returns HealthCheckResult with overall status and component details
 */
export function getHealthStatus(): HealthCheckResult {
    const issues: string[] = [];

    // Check circuit breaker status
    const cbState = getCircuitBreakerState();
    const cbHealthy = cbState.state === 'CLOSED';
    if (!cbHealthy) {
        issues.push(`Circuit breaker ${cbState.state}: ${cbState.failureCount} failures`);
    }

    // Check storage status
    const usingFallback = isUsingFallbackStorage();
    if (usingFallback) {
        issues.push('Using in-memory fallback storage (localStorage unavailable)');
    }

    // Check API status from store
    const apiStatus = store.apiStatus;
    const apiHealthy =
        apiStatus.profilesFailed === 0 &&
        apiStatus.holidaysFailed === 0 &&
        apiStatus.timeOffFailed === 0;
    if (apiStatus.profilesFailed > 0) {
        issues.push(`${apiStatus.profilesFailed} profile fetch(es) failed`);
    }
    if (apiStatus.holidaysFailed > 0) {
        issues.push(`${apiStatus.holidaysFailed} holiday fetch(es) failed`);
    }
    if (apiStatus.timeOffFailed > 0) {
        issues.push(`${apiStatus.timeOffFailed} time-off fetch(es) failed`);
    }

    // Check error reporting status
    if (store.diagnostics?.sentryInitFailed) {
        issues.push('Error reporting initialization failed');
    }

    // Check worker subsystem status
    const workerSupported = isWorkerSupported();
    const workerStats = calculationWorkerPool?.getStats();
    const workerInitialized = calculationWorkerPool?.isInitialized() ?? false;
    const workerTerminated =
        (store.diagnostics?.workerPoolTerminated ?? false) ||
        (!!calculationWorkerPool && !workerInitialized);
    const workerInitFailed = store.diagnostics?.workerPoolInitFailed ?? false;
    const workerTaskFailures =
        workerStats?.tasksFailed ?? store.diagnostics?.workerTaskFailures ?? 0;
    const workerHealthy = !workerInitFailed && !workerTerminated && workerTaskFailures === 0;

    if (workerInitFailed) {
        issues.push('Worker pool initialization failed');
    }
    if (workerTerminated) {
        issues.push('Worker pool terminated');
    }
    if (workerTaskFailures > 0) {
        issues.push(`${workerTaskFailures} worker task(s) failed`);
    }

    // Check encryption status
    const encryptionStatus = store.getEncryptionStatus?.() ?? {
        enabled: false,
        supported: false,
        keyReady: false,
        pending: false,
    };
    const encryptionHealthy = !encryptionStatus.enabled || encryptionStatus.keyReady;
    if (encryptionStatus.enabled && !encryptionStatus.keyReady) {
        issues.push('Encryption key not initialized');
    }

    // Check auth status
    const hasToken = !!store.token;
    let isExpired = false;
    if (hasToken) {
        try {
            // Decode token to check expiration (same logic as init)
            const parts = (store.token ?? '').split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(base64urlDecode(parts[1]));
                const exp = payload.exp;
                if (typeof exp === 'number') {
                    isExpired = exp < Math.floor(Date.now() / 1000);
                }
            } else {
                isExpired = true;
            }
        } catch {
            // Token decode failed, treat as unhealthy
            isExpired = true;
        }
    }
    const authHealthy = hasToken && !isExpired;
    if (!hasToken) {
        issues.push('No authentication token');
    } else if (isExpired) {
        issues.push('Authentication token has expired');
    }

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (!authHealthy || cbState.state === 'OPEN') {
        status = 'unhealthy';
    } else if (issues.length > 0) {
        status = 'degraded';
    } else {
        status = 'healthy';
    }

    return {
        status,
        timestamp: new Date().toISOString(),
        version: process.env.VERSION ?? '0.0.0',
        components: {
            circuitBreaker: {
                state: cbState.state,
                failureCount: cbState.failureCount,
                isHealthy: cbHealthy,
            },
            storage: {
                type: usingFallback ? 'memory' : 'localStorage',
                isHealthy: true, // Storage always works (either localStorage or fallback)
            },
            api: {
                profilesFailed: apiStatus.profilesFailed,
                holidaysFailed: apiStatus.holidaysFailed,
                timeOffFailed: apiStatus.timeOffFailed,
                isHealthy: apiHealthy,
            },
            auth: {
                hasToken,
                isExpired,
                isHealthy: authHealthy,
            },
            workers: {
                supported: workerSupported,
                initialized: workerInitialized,
                terminated: workerTerminated,
                taskFailures: workerTaskFailures,
                isHealthy: workerHealthy,
            },
            encryption: {
                enabled: encryptionStatus.enabled,
                supported: encryptionStatus.supported,
                keyReady: encryptionStatus.keyReady,
                pending: encryptionStatus.pending,
                isHealthy: encryptionHealthy,
            },
        },
        issues,
    };
}

// Expose health check globally for monitoring tools
// This allows external monitoring systems to check app health via browser console or scripts
declare global {
    interface Window {
        __OTPLUS_HEALTH_CHECK__: typeof getHealthStatus;
    }
}

const isProductionEnv =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

// Stryker disable next-line all: Global exposure is for monitoring, not core functionality
if (typeof window !== 'undefined' && !isProductionEnv) {
    window.__OTPLUS_HEALTH_CHECK__ = getHealthStatus;
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
    // Initialize DOM elements that will be referenced throughout the app
    // This includes the report table containers, config controls, event listener hooks, etc.
    UI.initializeElements();

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
    bindConfigEvents();

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
// CONFIGURATION MANAGEMENT
// ============================================================================
// Event binding and state synchronization for application config controls.
// Handles toggles, sliders, dropdowns, and date inputs; persists to localStorage.
// ============================================================================

/**
 * Updates the visual state of the Daily Threshold input based on Profile Capacity setting.
 *
 * **Rationale**: When "Use Profile Capacity" is enabled, the Daily Threshold input becomes
 * redundant (users' profile-defined capacities override the global threshold). This function
 * disables the input and shows a helper message to clarify that the global threshold is ignored.
 *
 * ## Behavior
 *
 * - If `useProfileCapacity` is ON: disable input, reduce opacity, show helper text
 * - If `useProfileCapacity` is OFF: enable input, full opacity, hide helper text
 *
 * ## Called By
 *
 * - `bindConfigEvents()` - During initialization
 * - Config "useProfileCapacity" toggle handler - When user toggles the profile capacity setting
 *
 * @see docs/prd.md - Capacity precedence rules
 */
function updateDailyThresholdState(): void {
    const dailyInput = document.getElementById('configDaily') as HTMLInputElement | null;
    const helper = document.getElementById('dailyThresholdHelper') as HTMLElement | null;
    if (!dailyInput || !helper) return;

    // Read the current config setting
    const useProfile = store.config.useProfileCapacity;

    // Disable input when profile capacity is enabled (input becomes redundant)
    dailyInput.disabled = useProfile;
    helper.style.display = useProfile ? 'inline' : 'none';

    // Visual feedback: reduce opacity and change cursor to indicate disabled state
    if (useProfile) {
        dailyInput.style.opacity = '0.5';
        dailyInput.style.cursor = 'not-allowed';
    } else {
        dailyInput.style.opacity = '1';
        dailyInput.style.cursor = '';
    }
}

/**
 * Toggles weekly threshold visibility based on overtime basis selection.
 */
function updateWeeklyThresholdState(): void {
    const weeklyContainer = document.getElementById('weeklyThresholdContainer');
    if (!weeklyContainer) return;
    const basis = (store.config.overtimeBasis || 'daily').toLowerCase();
    const showWeekly = basis === 'weekly' || basis === 'both';
    weeklyContainer.classList.toggle('hidden', !showWeekly);
}

type TabKey = 'summary' | 'detailed';

function setActiveTab(tab: TabKey): void {
    const summaryBtn = document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="summary"]');
    const detailedBtn = document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="detailed"]');
    const summaryCard = document.getElementById('summaryCard');
    const detailedCard = document.getElementById('detailedCard');

    const isSummary = tab === 'summary';

    if (summaryBtn) {
        summaryBtn.classList.toggle('active', isSummary);
        summaryBtn.setAttribute('aria-selected', isSummary ? 'true' : 'false');
    }
    if (detailedBtn) {
        detailedBtn.classList.toggle('active', !isSummary);
        detailedBtn.setAttribute('aria-selected', !isSummary ? 'true' : 'false');
    }

    if (summaryCard) summaryCard.classList.toggle('hidden', !isSummary);
    if (detailedCard) detailedCard.classList.toggle('hidden', isSummary);

    store.ui.activeTab = tab;
}

function parseTabKey(value: string | undefined): TabKey | null {
    if (value === 'summary' || value === 'detailed') return value;
    return null;
}

/**
 * Determines whether the current time entries include cost/profit rate information.
 *
 * **Rationale**: OTPLUS can display "Earned" (billable × rate), "Cost" (internal cost),
 * or "Profit" (earned - cost). However, cost/profit data is optional in Clockify time entries.
 * This function checks if entries actually have cost/profit rates before offering those display modes.
 *
 * ## Algorithm
 *
 * 1. If entries list is empty or null, return `true` (assume available, disable gracefully later)
 * 2. Check if ANY entry has a non-zero `costRate` (direct cost field)
 * 3. Check if ANY entry has `amounts[]` with COST or PROFIT type and non-zero value
 * 4. Return `true` if either condition is met, `false` otherwise
 *
 * ## Edge Cases
 *
 * - Empty entries: returns `true` (assume available; gracefully disable if no data loaded)
 * - Entries with zero cost: treated as unavailable (zero cost is not useful)
 * - Mixed data: if ANY entry has cost/profit, all display modes are offered
 *
 * ## Called By
 *
 * - `syncAmountDisplayAvailability()` - To determine which dropdown options to show
 *
 * @param entries - Array of time entries from Clockify API (may be null)
 * @returns `true` if cost/profit data appears to be available, `false` otherwise
 */
function hasCostRates(entries: TimeEntry[] | null): boolean {
    // Empty entries: optimistically return true (cost data might be added later)
    if (!Array.isArray(entries) || entries.length === 0) return true;

    // Check if ANY entry has cost/profit data
    return entries.some((entry) => {
        // Check direct costRate field (Clockify API property)
        const rawCostRate = (entry?.costRate as { amount?: number })?.amount ?? entry?.costRate;
        const costRate = Number(rawCostRate);
        // Only treat as available when a non-zero cost rate exists
        // (zero cost is not useful for display)
        if (Number.isFinite(costRate) && costRate !== 0) return true;

        // Check amounts array (alternative cost/profit fields)
        const amounts = Array.isArray(entry?.amounts) ? entry.amounts : [];
        return amounts.some((amount) => {
            const type = String(amount?.type || amount?.amountType || '').toUpperCase();
            // Only interested in COST or PROFIT types
            if (type !== 'COST' && type !== 'PROFIT') return false;
            const value = Number(amount?.value ?? amount?.amount);
            return Number.isFinite(value) && value !== 0;
        });
    });
}

/**
 * Determines whether the current time entries include any amount/rate data.
 *
 * When billability is disabled at the workspace level, Clockify does not emit
 * meaningful rates or amounts. In that case we hide all money columns and
 * amount selectors and only show time-based metrics.
 *
 * @param entries - Array of time entries from Clockify API (may be null)
 * @returns `true` if any entry contains non-zero money data, `false` otherwise
 */
function hasAmountRates(entries: TimeEntry[] | null): boolean {
    // Empty entries: optimistically return true so the UI doesn't hide controls pre-fetch
    if (!Array.isArray(entries) || entries.length === 0) return true;

    return entries.some((entry) => {
        const hourlyRate = Number((entry?.hourlyRate as { amount?: number })?.amount);
        const rawEarnedRate = (entry?.earnedRate as { amount?: number })?.amount ?? entry?.earnedRate;
        const earnedRate = Number(rawEarnedRate);
        const rawCostRate = (entry?.costRate as { amount?: number })?.amount ?? entry?.costRate;
        const costRate = Number(rawCostRate);

        if (
            (Number.isFinite(hourlyRate) && hourlyRate !== 0) ||
            (Number.isFinite(earnedRate) && earnedRate !== 0) ||
            (Number.isFinite(costRate) && costRate !== 0)
        ) {
            return true;
        }

        const amounts = Array.isArray(entry?.amounts) ? entry.amounts : [];
        return amounts.some((amount) => {
            const value = Number(amount?.value ?? amount?.amount);
            return Number.isFinite(value) && value !== 0;
        });
    });
}

/**
 * Synchronizes the "Amount Display" dropdown availability based on actual data.
 *
 * **Rationale**: The UI offers three display modes:
 * - "Earned" (billable hours × hourly rate) - always available
 * - "Cost" (internal cost per entry) - only available if cost data exists
 * - "Profit" (earned - cost) - only available if cost data exists
 *
 * This function checks if the loaded time entries actually have cost/profit data,
 * then updates the UI dropdown to hide/disable unavailable options.
 *
 * ## Algorithm
 *
 * 1. Check if current entries have cost rates (via `hasCostRates()`)
 * 2. Hide/disable cost and profit options if data unavailable
 * 3. If user's selected mode is now unavailable, switch to "earned"
 * 4. Update dropdown to reflect available options
 *
 * ## Side Effects
 *
 * - Modifies `store.ui.hasCostRates` (tracks availability for UI layer)
 * - Modifies `store.config.amountDisplay` if current selection is unavailable
 * - Calls `store.saveConfig()` if config changes
 *
 * ## Called By
 *
 * - `runCalculation()` - Before rendering tables (ensures dropdown reflects current data)
 *
 * @param entries - Array of time entries from Clockify API
 */
function syncAmountDisplayAvailability(entries: TimeEntry[] | null): void {
    // Determine whether any amount data exists (billability enabled)
    const amountRatesAvailable = hasAmountRates(entries);
    store.ui.hasAmountRates = amountRatesAvailable;

    // Only check cost/profit availability if amounts exist at all
    const costRatesAvailable = amountRatesAvailable ? hasCostRates(entries) : false;
    store.ui.hasCostRates = costRatesAvailable;

    const amountDisplayEl = document.getElementById('amountDisplay') as HTMLSelectElement | null;
    if (!amountDisplayEl) return;
    const amountDisplayContainer = document.getElementById('amountDisplayContainer');
    if (amountDisplayContainer) {
        amountDisplayContainer.classList.toggle('hidden', !amountRatesAvailable);
    }
    amountDisplayEl.disabled = !amountRatesAvailable;

    if (!amountRatesAvailable) {
        if (store.config.amountDisplay !== 'earned') {
            store.config.amountDisplay = 'earned';
            store.saveConfig();
        }
        amountDisplayEl.value = 'earned';
        return;
    }

    // Find cost and profit options in the dropdown
    const costOption = amountDisplayEl.querySelector(
        'option[value="cost"]'
    ) as HTMLOptionElement | null;
    const profitOption = amountDisplayEl.querySelector(
        'option[value="profit"]'
    ) as HTMLOptionElement | null;

    // Hide and disable cost/profit options when data doesn't provide them
    // (Users won't see these options; they can't select them)
    if (costOption) {
        costOption.hidden = !costRatesAvailable;
        costOption.disabled = !costRatesAvailable;
    }
    if (profitOption) {
        profitOption.hidden = !costRatesAvailable;
        profitOption.disabled = !costRatesAvailable;
    }

    // Normalize current config: valid options are 'earned', 'cost', 'profit'
    const validDisplays = new Set(['earned', 'cost', 'profit']);
    let nextDisplay = String(store.config.amountDisplay || '').toLowerCase();
    if (!validDisplays.has(nextDisplay)) nextDisplay = 'earned';

    // If cost/profit data is unavailable but user has cost/profit selected, switch to earned
    if (!costRatesAvailable && (nextDisplay === 'cost' || nextDisplay === 'profit')) {
        nextDisplay = 'earned';
    }

    // Persist config change if display mode changed
    if (store.config.amountDisplay !== nextDisplay) {
        store.config.amountDisplay = nextDisplay as 'earned' | 'cost' | 'profit';
        store.saveConfig();
    }

    // Update dropdown to reflect the current (possibly adjusted) selection
    amountDisplayEl.value = nextDisplay;
}

/**
 * Binds event listeners to all configuration controls and UI interactive elements.
 *
 * This function wires up the entire application's interactive surface. It handles:
 * - Configuration toggles (profile capacity, holidays, time-off, decimal display, etc.)
 * - Numeric inputs (daily threshold, OT multiplier, tier 2 settings)
 * - Date pickers and date preset buttons (this week, last week, etc.)
 * - Export and refresh buttons
 * - Tab navigation
 * - Summary table grouping and expansion
 * - Detailed report filters
 * - Clear data confirmation
 *
 * ## Pattern: Config → Store → Persist → Recalculate
 *
 * For most config changes, the flow is:
 * 1. User changes a control (toggle, slider, input)
 * 2. Event handler updates `store.config` or `store.calcParams`
 * 3. Call `store.saveConfig()` to persist to localStorage
 * 4. If raw entries exist, trigger `runCalculation()` to recalculate analysis
 * 5. UI tables automatically re-render with new results
 *
 * ## Debouncing
 *
 * Numeric inputs (daily threshold, multipliers) use 300ms debounce to avoid triggering
 * calculations on every keystroke. This improves performance for rapid user input.
 *
 * ## Special Cases
 *
 * - **showDecimalTime**: Formatting-only change; re-renders tables without recalculation
 * - **useProfileCapacity**: Updates Daily Threshold input state when toggled
 * - **showBillableBreakdown**: Updates summary expand toggle visibility
 * - **Date changes**: Auto-trigger report generation after 300ms debounce
 *
 * ## Called By
 *
 * - `loadInitialData()` - After fetching users, before any reports generated
 *
 * @see docs/spec.md for configuration details
 */
/* eslint-disable complexity, max-lines-per-function -- Config event binding requires handling many form fields */
export function bindConfigEvents(): void {
    // ========== Boolean Configuration Toggles ==========
    // Map of checkbox IDs to config keys for easy wiring of boolean toggles
    const configToggles = [
        { id: 'useProfileCapacity', key: 'useProfileCapacity' },
        { id: 'useProfileWorkingDays', key: 'useProfileWorkingDays' },
        { id: 'applyHolidays', key: 'applyHolidays' },
        { id: 'applyTimeOff', key: 'applyTimeOff' },
        { id: 'showBillableBreakdown', key: 'showBillableBreakdown' },
        { id: 'showDecimalTime', key: 'showDecimalTime' },
    ] as const;

    // Wire up each toggle: read current state, listen for changes, persist and recalculate
    configToggles.forEach(({ id, key }) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
            // Initialize checkbox with current config value
            el.checked = store.config[key];

            // Add change listener
            el.addEventListener('change', (e) => {
                // Update config in memory
                store.config[key] = (e.target as HTMLInputElement).checked;
                // Persist to localStorage
                store.saveConfig();

                // Handle side effects for specific toggles

                // When billable breakdown toggle changes, show/hide the expand control
                if (key === 'showBillableBreakdown') {
                    UI.renderSummaryExpandToggle();
                }

                // When profile capacity toggle changes, update the Daily Threshold input state
                // (disabled/enabled, visible helper text)
                if (key === 'useProfileCapacity') {
    updateDailyThresholdState();
    updateWeeklyThresholdState();
}

                // Trigger recalculation if we have raw entries
                // NOTE: showDecimalTime is special - it only affects formatting, not calculation
                if (store.rawEntries) {
                    if (key === 'showDecimalTime') {
                        // Formatting change: re-render without recalculation
                        if (store.analysisResults) {
                            UI.renderSummaryStrip(store.analysisResults);
                            UI.renderSummaryTable(store.analysisResults);
                            UI.renderDetailedTable(store.analysisResults);
                        }
                    } else {
                        // Calculation change: full recalculation needed
                        runCalculation();
                    }
                }
            });
        }
    });

    // ========== Amount Display Mode Selector ==========
    // Dropdown to choose between "Earned", "Cost", or "Profit" display modes
    // (Availability depends on whether cost data exists in entries)
    const amountDisplayEl = document.getElementById('amountDisplay') as HTMLSelectElement | null;
    if (amountDisplayEl) {
        const validDisplays = new Set(['earned', 'cost', 'profit']);
        const currentDisplay = String(store.config.amountDisplay || '').toLowerCase();
        amountDisplayEl.value = validDisplays.has(currentDisplay) ? currentDisplay : 'earned';
        amountDisplayEl.addEventListener('change', (e) => {
            const nextValue = String((e.target as HTMLSelectElement).value || '').toLowerCase();
            const allowCost = store.ui.hasCostRates !== false && store.ui.hasAmountRates !== false;
            // Normalize to valid display mode
            let normalized: 'earned' | 'cost' | 'profit' = validDisplays.has(nextValue)
                ? (nextValue as 'earned' | 'cost' | 'profit')
                : 'earned';
            // Fall back to earned if cost data unavailable
            if (!allowCost && (normalized === 'cost' || normalized === 'profit')) {
                normalized = 'earned';
            }
            store.config.amountDisplay = normalized;
            store.saveConfig();
            amountDisplayEl.value = store.config.amountDisplay;
            // Re-render tables with new amount display mode
            if (store.rawEntries) runCalculation();
        });
    }

    // ========== Overtime Basis Selector ==========
    const overtimeBasisEl = document.getElementById('overtimeBasis') as HTMLSelectElement | null;
    if (overtimeBasisEl) {
        const validBases = new Set(['daily', 'weekly', 'both']);
        const currentBasis = String(store.config.overtimeBasis || '').toLowerCase();
        overtimeBasisEl.value = validBases.has(currentBasis) ? currentBasis : 'daily';
        overtimeBasisEl.addEventListener('change', (e) => {
            const nextValue = String((e.target as HTMLSelectElement).value || '').toLowerCase();
            store.config.overtimeBasis = (validBases.has(nextValue) ? nextValue : 'daily') as
                | 'daily'
                | 'weekly'
                | 'both';
            store.saveConfig();
            updateWeeklyThresholdState();
            if (store.rawEntries) runCalculation();
        });
        updateWeeklyThresholdState();
    }

    // ========== Numeric Configuration Inputs ==========
    // These use debouncing to avoid triggering recalculations on every keystroke

    // Daily Threshold (default hours per day that don't count as OT)
    const dailyEl = document.getElementById('configDaily') as HTMLInputElement | null;
    if (dailyEl) {
        dailyEl.value = String(store.calcParams.dailyThreshold);
        dailyEl.addEventListener(
            'input',
            debounce((e: Event) => {
                // Parse float; default to 8 if invalid
                store.calcParams.dailyThreshold =
                    parseFloat((e.target as HTMLInputElement).value) || 8;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    // Weekly Threshold (hours per week that don't count as OT in weekly/both modes)
    const weeklyEl = document.getElementById('configWeekly') as HTMLInputElement | null;
    if (weeklyEl) {
        weeklyEl.value = String(store.calcParams.weeklyThreshold);
        weeklyEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.weeklyThreshold =
                    parseFloat((e.target as HTMLInputElement).value) || 40;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    // Overtime Multiplier (1.5 = time-and-a-half)
    // See docs/prd.md "Cost Calculation" for how this is applied
    const multEl = document.getElementById('configMultiplier') as HTMLInputElement | null;
    if (multEl) {
        multEl.value = String(store.calcParams.overtimeMultiplier);
        multEl.addEventListener(
            'input',
            debounce((e: Event) => {
                // Parse float; default to 1.5 if invalid
                store.calcParams.overtimeMultiplier =
                    parseFloat((e.target as HTMLInputElement).value) || 1.5;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    // Enable Tiered OT Toggle
    const enableTieredOTEl = document.getElementById('enableTieredOT') as HTMLInputElement | null;
    const tier2ConfigEls = document.querySelectorAll('.tier2-config');

    function updateTier2Visibility(enabled: boolean) {
        tier2ConfigEls.forEach(el => {
            (el as HTMLElement).style.display = enabled ? '' : 'none';
        });
    }

    if (enableTieredOTEl) {
        enableTieredOTEl.checked = store.config.enableTieredOT;
        updateTier2Visibility(store.config.enableTieredOT);

        enableTieredOTEl.addEventListener('change', () => {
            store.config.enableTieredOT = enableTieredOTEl.checked;

            // When enabling Tiered OT, sync tier2Multiplier to match regular OT multiplier
            // This prevents unexpected rate increases when first enabling the feature
            if (enableTieredOTEl.checked) {
                store.calcParams.tier2Multiplier = store.calcParams.overtimeMultiplier;
                // Update the UI input to reflect the synced value
                const tier2MultEl = document.getElementById('configTier2Multiplier') as HTMLInputElement | null;
                if (tier2MultEl) {
                    tier2MultEl.value = String(store.calcParams.tier2Multiplier);
                }
            }

            store.saveConfig();
            updateTier2Visibility(enableTieredOTEl.checked);
            if (store.rawEntries) runCalculation();
        });
    }

    // Tier 2 Threshold (OT hours before switching to tier 2 multiplier)
    // When tier2ThresholdHours = 40, first 40 OT hours use overtimeMultiplier,
    // additional hours use tier2Multiplier (double overtime)
    const tier2ThresholdEl = document.getElementById(
        'configTier2Threshold'
    ) as HTMLInputElement | null;
    if (tier2ThresholdEl) {
        tier2ThresholdEl.value = String(store.calcParams.tier2ThresholdHours || 0);
        tier2ThresholdEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.tier2ThresholdHours =
                    parseFloat((e.target as HTMLInputElement).value) || 0;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    // Tier 2 Multiplier (e.g., 2.0 for double overtime after threshold)
    const tier2MultiplierEl = document.getElementById(
        'configTier2Multiplier'
    ) as HTMLInputElement | null;
    if (tier2MultiplierEl) {
        tier2MultiplierEl.value = String(store.calcParams.tier2Multiplier || 2.0);
        tier2MultiplierEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.tier2Multiplier =
                    parseFloat((e.target as HTMLInputElement).value) || 2.0;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    // ========== Initialize Dependent UI States ==========
    // Set up states that depend on multiple config values
    updateDailyThresholdState();

    // ========== Config Panel Collapse Toggle ==========
    // Allow users to collapse the config section to reduce screen clutter
    const configToggle = document.getElementById('configToggle');
    const configContent = document.getElementById('configContent');
    if (configToggle && configContent) {
        configToggle.addEventListener('click', () => {
            const isCollapsed = configToggle.classList.toggle('collapsed');
            configContent.classList.toggle('hidden');
            configToggle.setAttribute('aria-expanded', String(!isCollapsed));
        });
    }

    // ========== Tab Navigation (Summary vs Detailed) ==========
    // Allow users to switch between summary and detailed report views
    // Uses event delegation for cleaner code (single listener on parent)
    const tabNavCard = document.getElementById('tabNavCard') as HTMLElement | null;
    if (tabNavCard && !tabNavCard.dataset.listenerAttached) {
        tabNavCard.dataset.listenerAttached = 'true';
        const tabButtons = Array.from(tabNavCard.querySelectorAll<HTMLButtonElement>('.tab-btn'));

        const activate = (tabValue: string | undefined) => {
            const tab = parseTabKey(tabValue);
            if (tab) setActiveTab(tab);
        };

        tabButtons.forEach((btn) => {
            btn.addEventListener('click', () => activate(btn.dataset.tab));
            btn.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate(btn.dataset.tab);
                }
            });
        });
    }

    // ========== Export Button ==========
    // Generates and downloads a CSV file with analysis results
    // CSV includes formula injection protection (see export.ts)
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (store.analysisResults) {
                downloadCsv(store.analysisResults);
            }
        });
    }

    // ========== Refresh Button ==========
    // Force a fresh report generation, bypassing any caches
    // Clears the report cache and calls handleGenerateReport with forceRefresh=true
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Clear cached report data
            store.clearReportCache();
            // Fetch fresh data from Clockify API
            handleGenerateReport(true);
        });
    }

    // ========== Date Range Selection ==========
    // Users can either manually pick dates or use preset buttons for quick selection
    // Date selection is debounced to avoid multiple rapid report generations

    // Helper function to update the date input values
    const setDateRange = (start: Date, end: Date) => {
        const startEl = document.getElementById('startDate') as HTMLInputElement | null;
        const endEl = document.getElementById('endDate') as HTMLInputElement | null;
        if (startEl) startEl.value = IsoUtils.toISODate(start);
        if (endEl) endEl.value = IsoUtils.toISODate(end);
    };

    const startInput = document.getElementById('startDate') as HTMLInputElement | null;
    const endInput = document.getElementById('endDate') as HTMLInputElement | null;

    // Auto-generate report when dates change (debounced to 300ms)
    // This allows smooth date picker interaction without multiple API calls
    const queueAutoGenerate = debounce(() => {
        const startValue = startInput?.value;
        const endValue = endInput?.value;
        // Only proceed if both dates are set
        if (!startValue || !endValue) return;
        // Only proceed if start <= end (validate date range)
        if (startValue > endValue) return;
        // Trigger report generation
        handleGenerateReport();
    }, 300);

    // Listen for changes to manual date inputs
    if (startInput) {
        startInput.addEventListener('change', queueAutoGenerate);
    }
    if (endInput) {
        endInput.addEventListener('change', queueAutoGenerate);
    }

    // ========== Date Preset Buttons ==========
    // Quick shortcuts for common date ranges (this week, last week, etc.)
    // Each preset calculates the appropriate date range and triggers report generation

    // "This Week" - Monday (start of week) to today
    document.getElementById('datePresetThisWeek')?.addEventListener('click', () => {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        // Calculate offset to Monday (ISO 8601: Monday = 1, Sunday = 0)
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const start = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset)
        );
        const end = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        );
        setDateRange(start, end);
        queueAutoGenerate();
    });

    // "Last Week" - Last Monday to last Sunday
    document.getElementById('datePresetLastWeek')?.addEventListener('click', () => {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        // Calculate offsets to last week's Monday and Sunday
        const lastMondayOffset = dayOfWeek === 0 ? -13 : -6 - dayOfWeek;
        const lastSundayOffset = dayOfWeek === 0 ? -7 : -dayOfWeek;
        const start = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() + lastMondayOffset
            )
        );
        const end = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() + lastSundayOffset
            )
        );
        setDateRange(start, end);
        queueAutoGenerate();
    });

    // "Last 2 Weeks" - 14 days ago to today
    document.getElementById('datePresetLast2Weeks')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13)
        );
        const end = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        );
        setDateRange(start, end);
        queueAutoGenerate();
    });

    // "Last Month" - First to last day of previous calendar month
    document.getElementById('datePresetLastMonth')?.addEventListener('click', () => {
        const now = new Date();
        // Date.UTC(year, month, 0) gives the last day of the previous month
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
        setDateRange(start, end);
        queueAutoGenerate();
    });

    // "This Month" - First day to last day of current calendar month
    document.getElementById('datePresetThisMonth')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        // Date.UTC(year, month+1, 0) gives the last day of current month
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
        setDateRange(start, end);
        queueAutoGenerate();
    });

    // ========== Detailed Report Filter Chips ==========
    // Allow users to filter detailed table by user, project, client, task, or billability
    // Uses event delegation for cleaner event binding
    const filterContainer = document.getElementById('detailedFilters');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            // Check if the clicked element is a filter chip
            if (target.classList.contains('chip')) {
                const filter = target.dataset.filter;
                // Re-render detailed table with the selected filter applied
                if (filter && store.analysisResults) {
                    UI.renderDetailedTable(store.analysisResults, filter);
                }
            }
        });
    }

    // ========== Summary Table Grouping Selector ==========
    // Allow users to group summary results by: user, project, client, task, or week
    // Grouping changes how the summary table is aggregated (see summary.ts)
    const groupBySelect = document.getElementById('groupBySelect') as HTMLSelectElement | null;
    if (groupBySelect) {
        groupBySelect.value = store.ui.summaryGroupBy || 'user';

        groupBySelect.addEventListener('change', (e) => {
            // Update UI state with new grouping preference
            store.ui.summaryGroupBy = (e.target as HTMLSelectElement).value as typeof store.ui.summaryGroupBy;
            // Persist grouping preference to localStorage
            store.saveUIState();
            // Re-render summary table with new grouping
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        });
    }

    // ========== Summary Billable Breakdown Expansion Toggle ==========
    // When "Show Billable Breakdown" is enabled, users can expand/collapse billable details
    // This toggle is only visible when billable breakdown is enabled
    const summaryExpandToggleContainer = document.getElementById('summaryExpandToggleContainer');
    if (summaryExpandToggleContainer) {
        // Render the toggle button (only visible if billable breakdown enabled)
        UI.renderSummaryExpandToggle();

        // Listen for clicks on the toggle button using event delegation
        summaryExpandToggleContainer.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('#summaryExpandToggle');
            if (!btn) return;

            // Toggle expanded state
            store.ui.summaryExpanded = !store.ui.summaryExpanded;
            // Persist to localStorage
            store.saveUIState();

            // Re-render the toggle button itself (to update visual state)
            UI.renderSummaryExpandToggle();

            // Re-render the summary table with new expansion state
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        });
    }

    // ========== Clear All Data Button ==========
    // Dangerous: removes all cached reports and configuration from localStorage
    // Shows a confirmation dialog before proceeding
    const clearDataBtn = document.getElementById('clearAllDataBtn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            // Show confirmation dialog; if confirmed, clear all data and reload
            UI.showClearDataConfirmation(() => {
                store.clearAllData();
                location.reload();
            });
        });
    }
}

// ============================================================================
// REPORT GENERATION & CALCULATION
// ============================================================================
// Main orchestration logic: validate dates, fetch data, calculate analysis, render UI.
// Includes concurrency control (AbortController) and caching (sessionStorage).
// ============================================================================

/**
 * Reference to the AbortController for the active report generation request.
 * Used to cancel in-flight API calls if a new report generation starts.
 * @see handleGenerateReport() for usage pattern
 */
let abortController: AbortController | null = null;

/**
 * Request ID counter to detect stale responses from concurrent requests.
 * Incremented on each new report generation request.
 * Used to ensure only the most recent request updates the UI.
 * @see handleGenerateReport() for usage pattern
 */
let currentRequestId = 0;

/**
 * Orchestrates the complete report generation workflow.
 *
 * This is the main orchestrator function that coordinates:
 * 1. Date validation and range safeguards
 * 2. Cache checks (reuse recent results if unchanged)
 * 3. Data fetching (entries, profiles, holidays, time-off)
 * 4. Graceful error handling (optional fetches can fail without blocking)
 * 5. Calculation delegation
 * 6. UI rendering
 *
 * ## Flow
 *
 * ```
 * handleGenerateReport()
 *  ├─ Cancel previous request (if any)
 *  ├─ Validate dates
 *  ├─ Check cache (reuse if exists and user agrees)
 *  ├─ Show loading spinner
 *  ├─ Fetch all data in parallel:
 *  │  ├─ Detailed report (entries) [REQUIRED]
 *  │  ├─ Profiles (capacity, working days) [OPTIONAL]
 *  │  ├─ Holidays [OPTIONAL]
 *  │  └─ Time off [OPTIONAL]
 *  ├─ Check if this request is still current (detect stale responses)
 *  ├─ Call runCalculation() to compute analysis
 *  ├─ Render all UI tables
 *  ├─ Show API status banner (if optional fetches failed)
 *  └─ Hide loading spinner
 * ```
 *
 * ## Concurrency Control
 *
 * When a user rapidly changes dates or clicks "Generate" multiple times, multiple
 * report generation requests can be in flight. To prevent race conditions:
 *
 * 1. **AbortController**: New request calls `abortController.abort()` to cancel
 *    the previous request's API calls (via AbortSignal).
 * 2. **Request ID**: Each request increments `currentRequestId`. Before updating UI,
 *    we check `thisRequestId === currentRequestId`. Stale responses are discarded.
 *
 * ## Caching Strategy
 *
 * Report results are cached in sessionStorage (browser session-scoped) by date range key.
 * When generating a report with the same date range, the user is prompted:
 * - "Use cached results?" → yes: reuse cached entries
 * - "Use cached results?" → no: fetch fresh from API
 * - Auto-caching: Results are automatically cached after successful fetch (not after user accepts)
 *
 * Cache is cleared on "Refresh" button click or explicit clear action.
 *
 * ## Date Validation & Safeguards
 *
 * - **Required**: Both start and end dates must be provided
 * - **Order**: Start date must be ≤ end date
 * - **Range limit**: Dates > 365 days apart trigger a confirmation warning
 *   (large ranges increase API calls and calculation time)
 *
 * ## Optional Fetch Graceful Degradation
 *
 * Profiles, holidays, and time-off fetches are optional. If they fail:
 * - Failure is logged but doesn't stop report generation
 * - Failures are tracked in `store.apiStatus` for UI warning banner
 * - Report still calculates with fallback defaults
 *
 * ## Error Handling
 *
 * - **Validation errors** (invalid dates): Show error banner, don't fetch
 * - **Network errors**: Caught, reported to Sentry, user shown generic error message
 * - **Abort errors** (request cancelled): Silently discarded (expected behavior)
 *
 * ## Called By
 *
 * - `loadInitialData()` - Indirectly via event binding
 * - User date changes or "Generate" button click
 * - "Refresh" button click
 *
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from Clockify API
 */
/* eslint-disable complexity, max-lines-per-function -- Report generation orchestrates many API calls, UI updates, and error handling */
export async function handleGenerateReport(forceRefresh = false): Promise<void> {
    // ===== Concurrency Control =====
    // Race Condition Prevention:
    // 1. Network Level: AbortController cancels in-flight fetch requests from previous runs.
    // 2. Logical Level: currentRequestId ensures that even if a cancelled fetch completes
    //    (e.g., in the microtask queue), its results are ignored if a newer request exists.
    if (abortController) {
        abortController.abort();
    }

    // Create a new AbortController for this request
    // The signal will be passed to all API calls; if abort() is called, they all cancel
    abortController = new AbortController();
    const { signal } = abortController;

    // Increment request ID to detect stale responses
    // Before updating UI, we check if thisRequestId === currentRequestId
    // Stale responses (from a cancelled request that somehow completed) are ignored
    currentRequestId++;
    const thisRequestId = currentRequestId;

    // Reset pagination flags for new report generation
    store.ui.paginationTruncated = false;
    store.ui.paginationAbortedDueToTokenExpiration = false;

    // ===== Extract and Validate Dates =====
    const startDateEl = document.getElementById('startDate') as HTMLInputElement | null;
    const endDateEl = document.getElementById('endDate') as HTMLInputElement | null;
    const startDate = startDateEl?.value || '';
    const endDate = endDateEl?.value || '';

    // Validate that both dates are selected
    // Both dates are required; empty dates mean the user hasn't made a selection
    if (!startDate || !endDate) {
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent = 'Please select start and end dates to generate the report.';
            emptyState.classList.remove('hidden');
        }
        // Auto-hide the message after 3 seconds (temporary notification)
        setTimeout(() => {
            if (emptyState) emptyState.classList.add('hidden');
        }, 3000);
        return;
    }

    // Validate that start date is not after end date (ISO string comparison works for this)
    if (startDate > endDate) {
        UI.renderLoading(false);
        UI.showError({
            title: 'Invalid Date Range',
            message: 'Start date must be before or equal to end date.',
            action: 'none',
            type: 'VALIDATION_ERROR',
            timestamp: new Date().toISOString(),
        });
        return;
    }

    // ===== Large Date Range Safeguard =====
    // Date ranges > 365 days trigger a warning because:
    // - More API calls needed (paginated through ~1000+ entries)
    // - More calculation time (per-day breakdown for 365+ days)
    // - Higher likelihood of hitting rate limits
    // See docs/spec.md "Performance requirements" for performance targets
    const rangeDays = getDateRangeDays(startDate, endDate);
    if (rangeDays > 365) {
        const confirmed = await UI.showLargeDateRangeWarning(rangeDays);
        if (!confirmed) {
            return; // User cancelled large range
        }
    }

    // ===== Create Request-Scoped Date Range =====
    // Store the date range for this request; will be passed to runCalculation()
    const requestDateRange: DateRange = { start: startDate, end: endDate };

    // ===== Cache Checking =====
    // Session storage cache avoids re-fetching entries if the same date range is requested
    // This improves UX for rapid regenerations (e.g., config changes)
    const cacheKey = store.getReportCacheKey(startDate, endDate);
    let useCachedData = false;
    let cachedEntries: typeof store.rawEntries = null;

    if (cacheKey && !forceRefresh) {
        // Check if we have a cached report for this date range
        cachedEntries = store.getCachedReport(cacheKey);
        if (cachedEntries) {
            // Found cached data; ask user if they want to use it
            const cacheData = sessionStorage.getItem('otplus_report_cache');
            if (cacheData) {
                try {
                    const parsed = JSON.parse(cacheData) as { timestamp: number };
                    const cacheAgeSeconds = Math.round((Date.now() - parsed.timestamp) / 1000);
                    // Show cache prompt with age information
                    const action = await UI.showCachePrompt(cacheAgeSeconds);
                    useCachedData = action === 'use';
                } catch {
                    // Malformed cache metadata; don't use cache
                    useCachedData = false;
                }
            }
        }
    }

    // ===== Prepare for Data Fetch =====
    // Show loading spinner and reset status counters before starting fetch
    UI.renderLoading(true);
    store.resetApiStatus();     // Clear API failure counts from previous requests
    store.resetThrottleStatus(); // Reset rate limit tracking
    store.clearFetchCache();    // Clear per-fetch caches (used for user profile lookups)

    try {
        // Verify that we have a workspace ID (should never fail after init())
        if (!store.claims?.workspaceId) {
            throw new Error('No workspace ID');
        }

        const bypassPersistentCache = forceRefresh;

        // ===== Optional Data Fetches (kick off in parallel) =====
        // STRATEGY: Fail-Open / Graceful Degradation
        // These fetches (Profiles, Holidays, TimeOff) are supplementary. If they fail,
        // the core report (Time Entries) can still be generated using global defaults.
        // We use Promise.allSettled to ensure a single failure doesn't reject the whole group.
        //
        // If any fail, report the failure to `store.apiStatus` for UI display,
        // but continue with report generation using available data (graceful degradation).
        //
        // Why optional? Per docs/spec.md "Graceful degradation": missing data must not crash
        // the report. Default capacity/holidays/timeOff are applied if unavailable.

        const optionalPromises: { name: string; promise: Promise<void> }[] = [];

        // ===== 2. Fetch User Profiles (Capacity & Working Days) - OPTIONAL =====
        // Profiles provide per-user working capacity (e.g., 8h default vs 6h for part-timers)
        // and working day schedules (which days user works, e.g., Mon-Fri)
        // Only fetch if enabled in config and not already cached
        if (store.config.useProfileCapacity || store.config.useProfileWorkingDays) {
            // Filter to only fetch profiles we haven't cached yet (unless forcing refresh)
            const missingUsers = bypassPersistentCache
                ? store.users
                : store.users.filter((u) => !store.profiles.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'profiles',
                    promise: Api.fetchAllProfiles(store.claims.workspaceId, missingUsers, {
                        signal,
                    }).then((profiles) => {
                        // Guard: Discard stale responses from cancelled requests
                        // This prevents race conditions where a slow response from an aborted
                        // request could overwrite data from the current request
                        if (thisRequestId !== currentRequestId) {
                            return;
                        }
                        // Store fetched profiles in memory cache
                        profiles.forEach((profile, userId) => {
                            store.profiles.set(userId, {
                                // Convert ISO duration (e.g., "PT8H") to decimal hours
                                workCapacityHours: parseIsoDuration(profile.workCapacity || ''),
                                // Working day schedule (e.g., [1,2,3,4,5] for Mon-Fri)
                                workingDays: profile.workingDays,
                            });
                        });
                        store.saveProfilesCache();
                    }),
                });
            }
        }

        // ===== 3. Fetch Holidays - OPTIONAL =====
        // Holidays reduce effective capacity to zero (all work is OT that day)
        // Only fetch if enabled in config
        // See docs/prd.md "Effective capacity adjustments" for how holidays are applied
        if (store.config.applyHolidays) {
            if (!bypassPersistentCache) {
                store.loadHolidayCache(startDate, endDate);
            } else {
                store.holidays.clear();
            }
            const missingUsers = bypassPersistentCache
                ? store.users
                : store.users.filter((u) => !store.holidays.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'holidays',
                    promise: Api.fetchAllHolidays(
                        store.claims.workspaceId,
                        missingUsers,
                        startDate,
                        endDate,
                        { signal }
                    ).then((holidays) => {
                        // Guard: Discard stale responses from cancelled requests
                        // This prevents race conditions where a slow response from an aborted
                        // request could overwrite data from the current request
                        if (thisRequestId !== currentRequestId) {
                            return;
                        }
                        // Convert holiday list to Map<userId, Map<dateKey, holiday>>
                        // This allows O(1) lookup of "is this date a holiday for this user?"
                        holidays.forEach((hList, userId) => {
                            const hMap = new Map();
                            (hList || []).forEach((h) => {
                                const startKey = IsoUtils.extractDateKey(h.datePeriod?.startDate);
                                const endKey = IsoUtils.extractDateKey(h.datePeriod?.endDate);

                                if (startKey) {
                                    if (!endKey || endKey === startKey) {
                                        // Single-day holiday
                                        hMap.set(startKey, h);
                                    } else {
                                        // Multi-day holiday (e.g., company-wide closure Dec 20-Jan 2)
                                        // Expand to individual days for efficient lookup
                                        const range = IsoUtils.generateDateRange(startKey, endKey);
                                        range.forEach((date) => hMap.set(date, h));
                                    }
                                }
                            });
                            store.holidays.set(userId, hMap);
                        });
                        store.saveHolidayCache(startDate, endDate);
                    }),
                });
            }
        }

        // ===== 4. Fetch Time Off - OPTIONAL =====
        // Time off (PTO) reduces effective capacity by the hours taken off
        // Only fetch if enabled in config
        // See docs/prd.md "Effective capacity adjustments" for how time-off is applied
        if (store.config.applyTimeOff) {
            if (!bypassPersistentCache) {
                store.loadTimeOffCache(startDate, endDate);
            } else {
                store.timeOff.clear();
            }
            const missingUsers = bypassPersistentCache
                ? store.users
                : store.users.filter((u) => !store.timeOff.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'timeOff',
                    promise: Api.fetchAllTimeOff(
                        store.claims.workspaceId,
                        missingUsers,
                        startDate,
                        endDate,
                        { signal }
                    ).then((timeOff) => {
                        // Guard: Discard stale responses from cancelled requests
                        // This prevents race conditions where a slow response from an aborted
                        // request could overwrite data from the current request
                        if (thisRequestId !== currentRequestId) {
                            return;
                        }
                        // Store time-off data in app state
                        // Structure: Map<userId, Map<dateKey, hoursTaken>>
                        timeOff.forEach((value, userId) => {
                            store.timeOff.set(userId, value);
                        });
                        store.saveTimeOffCache(startDate, endDate);
                    }),
                });
            }
        }

        // ===== Fetch Entries (in parallel with optional calls) =====
        const entriesPromise =
            useCachedData && cachedEntries
                ? Promise.resolve(cachedEntries)
                : Api.fetchDetailedReport(
                      store.claims.workspaceId,
                      `${startDate}T00:00:00Z`,
                      `${endDate}T23:59:59Z`,
                      {
                          signal,
                          onProgress: (page, phase) => {
                              UI.updateLoadingProgress(page, phase);
                          },
                      }
                  );

        if (useCachedData && cachedEntries) {
            UI.updateLoadingProgress(0, 'cached data');
        }

        const optionalResultsPromise = optionalPromises.length > 0
            ? Promise.allSettled(optionalPromises.map((p) => p.promise))
            : Promise.resolve([]);

        const entries = await entriesPromise;

        // Cache the fetched entries for potential reuse
        if (!useCachedData && cacheKey && entries && entries.length > 0) {
            store.setCachedReport(cacheKey, entries);
        }

        // Store raw entries in application state for subsequent calculations and exports
        store.rawEntries = entries;

        // ===== Wait for Optional Fetches with Graceful Failure =====
        // Use Promise.allSettled() so failures don't reject the entire chain
        // Track failures for UI warning banner, but continue with report
        const optionalResults = await optionalResultsPromise;
        optionalResults.forEach((result, index) => {
            if (result.status === 'rejected') {
                const reason = result.reason as Error;
                if (reason?.name !== 'AbortError') {
                    const name = optionalPromises[index].name;
                    console.warn(`Optional fetch '${name}' failed:`, reason);
                    if (name === 'profiles') {
                        store.apiStatus.profilesFailed = store.users.length;
                    }
                    if (name === 'holidays') {
                        store.apiStatus.holidaysFailed = store.users.length;
                    }
                    if (name === 'timeOff') {
                        store.apiStatus.timeOffFailed = store.users.length;
                    }
                }
            }
        });

        // ===== Stale Request Detection =====
        // Before updating UI, check if this request is still the most recent one
        // If a newer request started while we were fetching, discard this response
        if (thisRequestId !== currentRequestId) {
            return;
        }

        // ===== Trigger Calculation & Rendering =====
        // Pass the validated date range to calculation engine
        runCalculation(requestDateRange);

        // Show the tab navigation (Summary/Detailed) now that we have results
        const tabNavCard = document.getElementById('tabNavCard');
        if (tabNavCard) tabNavCard.style.display = 'block';

        // Enable Export button (disabled until we have analysis results)
        const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
        if (exportBtn) exportBtn.disabled = false;

        // Display API status banner (warnings for failed optional fetches)
        UI.renderApiStatus();

        // Display pagination warning if results were truncated
        UI.renderPaginationWarning();

        // Display rate limit status if we hit throttling during fetch
        UI.renderThrottleStatus(store.throttleStatus.retryCount);
    } catch (error) {
        // ===== Error Handling =====
        const err = error as Error;

        // Abort errors are expected when a new request cancels an old one
        // Silently ignore them (user sees continuous progress as UI refreshes)
        if (err.name === 'AbortError') {
            store.rawEntries = null;
            return;
        }

        // Non-abort errors indicate real problems; log and show user error dialog
        console.error('Report generation failed:', error);
        reportError(err, {
            module: 'main',
            operation: 'handleGenerateReport',
            level: 'error',
            metadata: {
                dateRange: { start: startDate, end: endDate },
            },
        });
        UI.showError({
            title: 'Report Generation Failed',
            message: 'An error occurred while fetching time entries. Please try again.',
            action: 'retry',
            type: 'API_ERROR',
            timestamp: new Date().toISOString(),
        });
    } finally {
        // ===== Cleanup =====
        // Always run, even if error occurred
        UI.clearLoadingProgress();
        UI.renderLoading(false);
        abortController = null;
    }
}

// ============================================================================
// WORKER POOL FOR LARGE CALCULATIONS
// ============================================================================
// Uses a Web Worker to offload heavy calculations from the main thread,
// keeping the UI responsive for datasets larger than WORKER_THRESHOLD entries.
// ============================================================================

/**
 * Threshold for using worker-based calculation.
 * Datasets with more entries than this will use a background worker.
 */
const WORKER_THRESHOLD = 500;

/**
 * Worker pool instance for background calculations.
 * Lazily initialized when first large calculation is triggered.
 */
type WorkerPayload = {
    type: 'calculate';
    payload: {
        entries: TimeEntry[];
        dateRange: DateRange;
        store: {
            users: typeof store.users;
            profiles: [string, unknown][];
            holidays: [string, [string, unknown][]][];
            timeOff: [string, [string, unknown][]][];
            overrides: typeof store.overrides;
            config: typeof store.config;
            calcParams: typeof store.calcParams;
        };
    };
};
type WorkerResult = { type: 'result' | 'error'; payload?: unknown; error?: string };
let calculationWorkerPool: WorkerPool<WorkerPayload, WorkerResult> | null = null;

/**
 * Checks if Web Workers are supported in the current environment.
 */
function isWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
}

/**
 * Initializes the worker pool for background calculations.
 * Called lazily on first large calculation.
 */
async function initCalculationWorker(): Promise<boolean> {
    if (calculationWorkerPool) return true;
    if (!isWorkerSupported()) return false;

    try {
        calculationWorkerPool = await createWorkerPool<WorkerPayload, WorkerResult>(
            'js/calc.worker.js',
            { poolSize: 1, maxQueueSize: 10, taskTimeout: 60000, autoRestart: true }
        );
        store.diagnostics = {
            ...store.diagnostics,
            workerPoolInitFailed: false,
            workerPoolTerminated: false,
        };
        return true;
    } catch (error) {
        store.diagnostics = {
            ...store.diagnostics,
            workerPoolInitFailed: true,
        };
        console.warn('Failed to initialize calculation worker', error);
        return false;
    }
}

/**
 * Serializes store data for worker transfer.
 * Maps are converted to arrays for structured cloning.
 */
function serializeStoreForWorker() {
    return {
        users: store.users,
        profiles: Array.from(store.profiles.entries()),
        holidays: Array.from(store.holidays.entries()).map(([userId, map]) => [
            userId,
            Array.from(map.entries()),
        ] as [string, [string, unknown][]]),
        timeOff: Array.from(store.timeOff.entries()).map(([userId, map]) => [
            userId,
            Array.from(map.entries()),
        ] as [string, [string, unknown][]]),
        overrides: store.overrides,
        config: store.config,
        calcParams: store.calcParams,
    };
}

/**
 * Deserializes worker results back into UserAnalysis format.
 * Converts day arrays back to Maps.
 */
function deserializeWorkerResults(results: unknown[]): UserAnalysis[] {
    return (results as Array<{ days: [string, unknown][] }>).map((user) => ({
        ...user,
        days: new Map(user.days),
    })) as UserAnalysis[];
}

/**
 * Runs calculation in a background worker.
 * Falls back to main-thread calculation if worker fails.
 */
async function runCalculationInWorker(
    entries: TimeEntry[],
    dateRange: DateRange
): Promise<UserAnalysis[]> {
    if (!calculationWorkerPool) {
        throw new Error('Worker pool not initialized');
    }

    const result = await calculationWorkerPool.execute({
        payload: {
            type: 'calculate',
            payload: {
                entries,
                dateRange,
                store: serializeStoreForWorker(),
            },
        },
    });

    if (result.type === 'error') {
        throw new Error(result.error || 'Worker calculation failed');
    }

    return deserializeWorkerResults(result.payload as unknown[]);
}

/**
 * Triggers the calculation engine and updates all UI views with analysis results.
 *
 * This function is the bridge between data fetching and UI rendering. It delegates
 * the heavy computation to `calculateAnalysis()` (calc.ts) and then renders all output
 * tables with the results.
 *
 * ## Responsibilities
 *
 * 1. Determine which date range to use (provided or stored from previous calculation)
 * 2. Synchronize amount display mode based on data availability
 * 3. Call calculation engine with current state
 * 4. Store results in application state
 * 5. Trigger UI rendering for all output tables
 *
 * ## Called By
 *
 * - `handleGenerateReport()` - After fetching all data successfully
 * - Config change handlers - When user adjusts settings (e.g., daily threshold, multiplier)
 * - Filter/grouping changes - When user regroups summary or filters detailed table
 *
 * ## Data Flow
 *
 * ```
 * runCalculation(dateRange)
 *  ├─ Determine effective date range
 *  ├─ syncAmountDisplayAvailability(entries) - Check if cost data available
 *  ├─ calculateAnalysis(entries, store, dateRange) - Run calculation engine
 *  │  └─ Returns: UserAnalysis[] with daily OT breakdowns
 *  ├─ store.analysisResults = analysis
 *  ├─ UI.renderSummaryStrip(analysis)
 *  ├─ UI.renderSummaryTable(analysis)
 *  └─ UI.renderDetailedTable(analysis)
 * ```
 *
 * ## Key Assumptions
 *
 * - `store.rawEntries` has been populated (from handleGenerateReport)
 * - `store.profiles`, `store.holidays`, `store.timeOff` are populated (or empty with defaults)
 * - `store.config` and `store.calcParams` reflect current user settings
 * - All DOM elements (tables, containers) exist and are ready
 *
 * @param dateRange - Optional date range for calculation. If not provided, uses previously
 *                   stored date range (for config-change recalculations where date range is unchanged)
 *
 * @see calculateAnalysis() in calc.ts - The core calculation engine
 * @see UI rendering functions - Render the computed analysis results
 */
export function runCalculation(dateRange?: DateRange): void {
    // ===== Determine Effective Date Range =====
    // Use provided dateRange if available (from handleGenerateReport)
    // Otherwise use stored dateRange (e.g., when user changes config without changing dates)
    // Fallback to empty range (will be ignored by calculation engine)
    const effectiveDateRange = dateRange || store.currentDateRange || { start: '', end: '' };

    // ===== Persist Date Range =====
    // Store the date range for subsequent recalculations
    // (If user changes daily threshold, we'll recalculate with the same date range)
    if (dateRange) {
        store.currentDateRange = dateRange;
    }

    // ===== Sync Amount Display Availability =====
    // Check if the loaded entries have cost/profit data
    // If not, disable cost/profit display options in dropdown
    syncAmountDisplayAvailability(store.rawEntries);

    // ===== Run Calculation Engine =====
    // Pass all necessary state to the pure calculation function
    // calc.ts handles all overtime/billable computation logic
    // See docs/prd.md "Calculation rules" for algorithm details

    // Ensure entries exist (should always be true at this point)
    const entries = store.rawEntries ?? [];

    // Check if we should use worker for large datasets
    const shouldUseWorker = isWorkerSupported() && entries.length > WORKER_THRESHOLD;

    if (shouldUseWorker) {
        // Large dataset: use worker to keep UI responsive
        runCalculationAsync(entries, effectiveDateRange);
    } else {
        // Small dataset: run synchronously on main thread
        const calcTimer = startTimer(MetricNames.CALC_DURATION);
        const analysis = calculateAnalysis(entries, store, effectiveDateRange);
        calcTimer.end();
        incrementCounter(MetricNames.CALC_ENTRY_COUNT, entries.length);
        incrementCounter(MetricNames.CALC_USER_COUNT, analysis.length);

        // ===== Store Results =====
        // Save analysis in application state so UI modules can reference it
        store.analysisResults = analysis;

        // ===== Render All Output Tables =====
        // Update the UI to display calculation results
        // Each render function is responsible for its own DOM manipulation
        UI.renderSummaryStrip(analysis);      // KPI strip (total hours, OT, cost, etc.)
        UI.renderSummaryTable(analysis);      // Grouped summary (by user, project, week, etc.)
        UI.renderDetailedTable(analysis);     // Per-entry breakdown (paginated if large)
    }
}

/**
 * Runs calculation asynchronously using a background worker.
 * Used for large datasets to keep UI responsive.
 */
async function runCalculationAsync(entries: TimeEntry[], dateRange: DateRange): Promise<void> {
    const calcTimer = startTimer(MetricNames.CALC_DURATION);

    try {
        // Initialize worker pool if not already done
        const workerReady = await initCalculationWorker();

        let analysis: UserAnalysis[];

        if (workerReady && calculationWorkerPool) {
            // Run in worker
            analysis = await runCalculationInWorker(entries, dateRange);
        } else {
            // Worker failed, fall back to main thread
            analysis = calculateAnalysis(entries, store, dateRange);
        }

        calcTimer.end();
        incrementCounter(MetricNames.CALC_ENTRY_COUNT, entries.length);
        incrementCounter(MetricNames.CALC_USER_COUNT, analysis.length);

        // Store results
        store.analysisResults = analysis;

        // Render UI
        UI.renderSummaryStrip(analysis);
        UI.renderSummaryTable(analysis);
        UI.renderDetailedTable(analysis);
    } catch (error) {
        console.error('Async calculation failed, falling back to sync', error);
        calcTimer.end();

        // Fallback to sync calculation
        const analysis = calculateAnalysis(entries, store, dateRange);
        incrementCounter(MetricNames.CALC_ENTRY_COUNT, entries.length);
        incrementCounter(MetricNames.CALC_USER_COUNT, analysis.length);

        store.analysisResults = analysis;
        UI.renderSummaryStrip(analysis);
        UI.renderSummaryTable(analysis);
        UI.renderDetailedTable(analysis);
    }
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
