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
import {
    initSettingsApi,
    fetchServerConfig,
    fetchServerOverrides,
    saveServerOverrides,
} from './settings-api.js';
import * as UI from './ui/index.js';
import {
    IsoUtils,
    base64urlDecode,
    setCanonicalTimeZone,
    isValidTimeZone,
    debounce,
    isAllowedClockifyUrl,
} from './utils.js';
import { initErrorReporting, reportError } from './error-reporting.js';
import { SENTRY_DSN } from './constants.js';
import { initCSPReporter } from './csp-reporter.js';
import { createLogger } from './logger.js';
import { runCalculation } from './worker-manager.js';
import { bindConfigEvents, flushPendingConfigSave } from './config-manager.js';
import { handleGenerateReport } from './report-orchestrator.js';
import type { TokenClaims, ApiStatus } from './types.js';
// Side-effect import: registers window.__OTPLUS_HEALTH_CHECK__
import './health-check.js';

// Re-export for backward compatibility with tests
export { handleGenerateReport } from './report-orchestrator.js';
export { getHealthStatus } from './health-check.js';
export type { HealthCheckResult } from './health-check.js';

const mainLogger = createLogger('Main');

// ============================================================================
// TOKEN REFRESH VIA CLOCKIFY POSTMESSAGE API
// ============================================================================
// Clockify supports refreshing addon tokens via `refreshAddonToken` postMessage.
// This avoids a full iframe reload which may not work reliably inside iframes.
// ============================================================================

/** Timeout (ms) to wait for Clockify to respond to refreshAddonToken before falling back to reload. */
const TOKEN_REFRESH_TIMEOUT_MS = 5_000;

/** Proactive refresh margin: request a new token this many seconds before expiry. */
const PROACTIVE_REFRESH_SECONDS = 120; // 2 minutes before expiration

let tokenRefreshTimerId: ReturnType<typeof setTimeout> | null = null;
let _refreshFallbackTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Handles incoming postMessage events from Clockify with refreshed tokens.
 * Clockify sends back a message containing the refreshed auth_token after
 * a `refreshAddonToken` request.
 */
function handleTokenMessage(event: MessageEvent): void {
    // Only accept messages from Clockify origins
    if (!event.origin || !isAllowedOrigin(event.origin)) return;

    let data: Record<string, unknown>;
    try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
        return;
    }

    const newToken =
        data?.auth_token ??
        data?.authToken ??
        (data?.title === 'refreshAddonToken' && typeof data?.body === 'string'
            ? data.body
            : undefined);
    if (typeof newToken !== 'string' || !newToken) return;

    parseAndValidateToken(newToken)
        .then((payload) => {
            // Cancel fallback reload ONLY after validation succeeds
            if (_refreshFallbackTimerId !== null) {
                clearTimeout(_refreshFallbackTimerId);
                _refreshFallbackTimerId = null;
            }
            return applyTokenClaims(newToken, payload, true);
        })
        .catch((err) => {
            mainLogger.warn('Failed to apply refreshed token', { error: (err as Error).message });
            // Fallback timer keeps ticking — will fire location.reload()
        });
}

/**
 * Requests a new addon token from Clockify via the `refreshAddonToken` postMessage API.
 * Falls back to `location.reload()` after a timeout if no response is received.
 */
export function requestTokenRefresh(): void {
    try {
        // Primary: { action, payload } format (per original Clockify JS example via window.top)
        window.top?.postMessage(JSON.stringify({ action: 'refreshAddonToken' }), '*');
        // Fallback: { title } format (per Clockify skill/inbound event convention via window.parent)
        window.parent?.postMessage({ title: 'refreshAddonToken' }, '*');
    } catch {
        // Cross-origin access to window.top/parent may fail; fall back immediately
        location.reload();
        return;
    }

    // Cancel any prior fallback timer
    if (_refreshFallbackTimerId !== null) {
        clearTimeout(_refreshFallbackTimerId);
    }

    // Fall back to reload if Clockify doesn't respond within timeout.
    // handleTokenMessage cancels this timer AFTER successful validation.
    _refreshFallbackTimerId = setTimeout(() => {
        _refreshFallbackTimerId = null;
        location.reload();
    }, TOKEN_REFRESH_TIMEOUT_MS);
    unrefTimerIfSupported(_refreshFallbackTimerId);
}

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
    const warningSeconds = expiresInSeconds - SESSION_WARNING_MINUTES * 60;

    // Proactive refresh: request a new token ~2 minutes before expiry
    const proactiveRefreshSeconds = expiresInSeconds - PROACTIVE_REFRESH_SECONDS;
    if (proactiveRefreshSeconds > 0) {
        tokenRefreshTimerId = setTimeout(() => {
            requestTokenRefresh();
        }, proactiveRefreshSeconds * 1000);
        unrefTimerIfSupported(tokenRefreshTimerId);
    }

    // Set up warning timer if there's enough time
    if (warningSeconds > 0) {
        sessionWarningTimerId = setTimeout(() => {
            const minutesRemaining = Math.ceil((exp - Math.floor(Date.now() / 1000)) / 60);
            UI.showSessionExpiringWarning(
                minutesRemaining,
                () => {
                    // User chose to re-authenticate via token refresh
                    requestTokenRefresh();
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
            () => requestTokenRefresh(),
            () => {
                /* dismissed */
            }
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
    if (tokenRefreshTimerId !== null) {
        clearTimeout(tokenRefreshTimerId);
        tokenRefreshTimerId = null;
    }
    if (_refreshFallbackTimerId !== null) {
        clearTimeout(_refreshFallbackTimerId);
        _refreshFallbackTimerId = null;
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
// isAllowedClockifyUrl imported from ./utils.js — shared runtime contract for URL trust

export function isAllowedOrigin(currentOrigin: string): boolean {
    const allowedOrigins: (string | RegExp)[] = [
        'https://app.clockify.me',
        'https://clockify.me',
        'https://developer.clockify.me',
        // GitHub Pages deployments
        /^https:\/\/[\w-]+\.github\.io$/,
        // Cloudflare Worker deployments
        /^https:\/\/[\w-]+\.[\w-]+\.workers\.dev$/,
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

/** Shows an initialization error in the empty state element and marks app as ready. */
function showInitError(message: string): void {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
        emptyState.textContent = message;
        emptyState.classList.remove('hidden');
    }
    document.body.dataset.appReady = 'true';
    document.body.dataset.appError = 'true';
}

/** Extracts the auth token from URL params and scrubs it from the address bar. */
function extractAndScrubToken(): string | null {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');
    if (token && typeof history !== 'undefined' && typeof history.replaceState === 'function') {
        params.delete('auth_token');
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        history.replaceState({}, document.title, nextUrl);
    }
    return token;
}

/**
 * Normalizes legacy Clockify token claim shapes used by some developer flows.
 *
 * Clockify iframe tokens normally include `workspaceId` and `backendUrl`, but
 * developer-portal tokens can surface equivalent data as `activeWs` and
 * `baseURL`/`apiUrl`. We normalize those aliases first and then apply the same
 * trusted-host validation as standard tokens.
 */
function normalizeTokenClaims(payload: Record<string, unknown>): TokenClaims {
    const workspaceId =
        typeof payload.workspaceId === 'string' && payload.workspaceId.trim()
            ? payload.workspaceId
            : typeof payload.activeWs === 'string' && payload.activeWs.trim()
              ? payload.activeWs
              : undefined;

    let backendUrl =
        typeof payload.backendUrl === 'string' && payload.backendUrl.trim()
            ? payload.backendUrl
            : undefined;

    if (!backendUrl) {
        const legacyApiBase =
            typeof payload.apiUrl === 'string' && payload.apiUrl.trim()
                ? payload.apiUrl
                : typeof payload.baseURL === 'string' && payload.baseURL.trim()
                  ? payload.baseURL
                  : typeof payload.baseUrl === 'string' && payload.baseUrl.trim()
                    ? payload.baseUrl
                    : undefined;

        if (legacyApiBase) {
            try {
                const parsed = new URL(legacyApiBase);
                let pathname = parsed.pathname.replace(/\/+$/, '');
                if (!pathname || pathname === '/') {
                    pathname = '/api';
                } else if (pathname.endsWith('/api/v1')) {
                    pathname = pathname.replace(/\/v1$/, '');
                } else if (!pathname.endsWith('/api')) {
                    pathname = `${pathname}/api`;
                }
                backendUrl = `${parsed.origin}${pathname}`;
            } catch {
                backendUrl = legacyApiBase;
            }
        }
    }

    return {
        ...payload,
        workspaceId,
        backendUrl,
    } as TokenClaims;
}

/**
 * Clockify's X.509 RSA256 public key for JWT signature verification.
 * Same key used by the Worker (worker/src/auth.ts). Duplicated here because
 * the frontend and Worker run in different runtimes.
 * Source: https://dev-docs.marketplace.cake.com/clockify/build/authentication-and-authorization
 */
const CLOCKIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAubktufFNO/op+E5WBWL6
/Y9QRZGSGGCsV00FmPRl5A0mSfQu3yq2Yaq47IlN0zgFy9IUG8/JJfwiehsmbrKa
49t/xSkpG1u9w1GUyY0g4eKDUwofHKAt3IPw0St4qsWLK9mO+koUo56CGQOEpTui
5bMfmefVBBfShXTaZOtXPB349FdzSuYlU/5o3L12zVWMutNhiJCKyGfsuu2uXa9+
6uQnZBw1wO3/QEci7i4TbC+ZXqW1rCcbogSMORqHAP6qSAcTFRmrjFAEsOWiUUhZ
rLDg2QJ8VTDghFnUhYklNTJlGgfo80qEWe1NLIwvZj0h3bWRfrqZHsD/Yjh0duk6
yQIDAQAB
-----END PUBLIC KEY-----`;

/**
 * Verifies an RSA256 JWT signature using Clockify's public key via Web Crypto API.
 * Returns true if valid, false if invalid or if SubtleCrypto is unavailable.
 */
async function verifyJwtSignature(token: string): Promise<boolean> {
    try {
        // Skip in test environments (backend is the primary enforcer) or when SubtleCrypto is unavailable
        if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') return true;
        // E2E test bypass — stripped from production builds via esbuild dead-code elimination.
        // Settable via Playwright addInitScript or DOM attribute before page scripts load.
        if (process.env.NODE_ENV !== 'production') {
            if (
                (typeof window !== 'undefined' &&
                    (window as unknown as Record<string, unknown>)
                        .__OTPLUS_SKIP_SIGNATURE_VERIFY === true) ||
                (typeof document !== 'undefined' &&
                    document.documentElement.dataset.skipSignatureVerify === 'true')
            ) {
                return true;
            }
        }
        if (typeof crypto === 'undefined' || !crypto.subtle) return false;

        const parts = token.split('.');
        if (parts.length !== 3) return false;

        // PEM → ArrayBuffer
        const b64 = CLOCKIFY_PUBLIC_KEY_PEM.replace(/-----BEGIN PUBLIC KEY-----/g, '')
            .replace(/-----END PUBLIC KEY-----/g, '')
            .replace(/\s/g, '');
        const binary = atob(b64);
        const keyBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);

        const cryptoKey = await crypto.subtle.importKey(
            'spki',
            keyBytes.buffer,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

        // base64url → Uint8Array
        const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
        const sigBinary = atob(sigB64);
        const sigBytes = new Uint8Array(sigBinary.length);
        for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);

        return await crypto.subtle.verify(
            { name: 'RSASSA-PKCS1-v1_5' },
            cryptoKey,
            sigBytes.buffer,
            signingInput
        );
    } catch (err) {
        mainLogger.warn('JWT signature verification failed', err);
        return false;
    }
}

/**
 * Decodes JWT, optionally verifies RSA256 signature, validates required claims,
 * and returns the payload. Throws on invalid tokens.
 */
async function parseAndValidateToken(token: string): Promise<TokenClaims> {
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
    }

    // Verify RSA256 signature before trusting any claims
    const signatureValid = await verifyJwtSignature(token);
    if (!signatureValid) {
        throw new Error('Invalid token signature');
    }

    const rawPayload = JSON.parse(base64urlDecode(tokenParts[1])) as Record<string, unknown>;
    const payload = normalizeTokenClaims(rawPayload);
    if (!payload || !payload.workspaceId) {
        throw new Error('Invalid token payload: missing workspaceId');
    }
    if (!payload.backendUrl || !isAllowedClockifyUrl(payload.backendUrl)) {
        throw new Error('Invalid token payload: untrusted backendUrl');
    }
    if (payload.reportsUrl && !isAllowedClockifyUrl(payload.reportsUrl)) {
        throw new Error('Invalid token payload: untrusted reportsUrl');
    }
    return payload;
}

/** Initializes error/CSP reporting, API module, UI elements, and encryption listener. */
function initSubsystems(): void {
    initErrorReporting({
        dsn: SENTRY_DSN,
        environment:
            typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
                ? 'production'
                : 'development',
        release: `otplus@${typeof process !== 'undefined' && process.env.VERSION ? process.env.VERSION : '0.0.0'}`,
        sampleRate: 1.0,
    }).catch((error) => {
        store.diagnostics = { ...store.diagnostics, sentryInitFailed: true };
        mainLogger.warn('Error reporting initialization failed', {
            error: error?.message || error,
        });
    });

    initCSPReporter({
        reportToConsole: typeof process !== 'undefined' && process.env.NODE_ENV !== 'production',
        reportToSentry: true,
    });

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

    UI.initializeElements();

    // Register listener for Clockify token refresh postMessage responses
    if (typeof window !== 'undefined') {
        window.addEventListener('message', handleTokenMessage);
    }

    // Safety net: if an async error escapes all handlers, report it and ensure
    // the app doesn't hang in a perpetual "loading" state for the Clockify iframe.
    if (typeof window !== 'undefined') {
        window.addEventListener('unhandledrejection', (event) => {
            reportError(
                event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
                { module: 'main', operation: 'unhandledrejection', level: 'error' }
            );
        });
    }

    if (!encryptionErrorListenerBound && typeof window !== 'undefined') {
        encryptionErrorListenerBound = true;
        window.addEventListener('otplus:encryption-error', () => {
            UI.showError({
                title: 'Encryption Error',
                message:
                    'Override changes could not be encrypted and were not saved. Please reload the addon.',
                action: 'none',
                type: 'UNKNOWN',
                timestamp: new Date().toISOString(),
            });
        });
    }
}

/** Applies token claims: theme, rate limiter reset, state, encryption, session, timezone, dates. */
async function applyTokenClaims(
    token: string,
    payload: TokenClaims,
    isRefresh = false
): Promise<void> {
    if (payload.theme === 'DARK') {
        document.body.classList.add('cl-theme-dark');
    }

    if (store.claims && store.claims.workspaceId !== payload.workspaceId) {
        resetRateLimiter();
    }

    if (isRefresh) {
        store.updateToken(token, payload);
        // Recompute admin state — role may have changed since initial load
        const refreshedRole = (payload as Record<string, unknown>).workspaceRole as
            | string
            | undefined;
        const newIsAdmin = refreshedRole === 'OWNER' || refreshedRole === 'ADMIN';
        if (store.ui.isAdmin !== newIsAdmin) {
            store.ui.isAdmin = newIsAdmin;
            for (const id of ['configToggle', 'configContent', 'openOverridesBtn']) {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('admin-only-hidden', !newIsAdmin);
            }
        }
    } else {
        store.setToken(token, payload);
    }

    initSettingsApi(token);

    if (!isRefresh && store.config.encryptStorage) {
        try {
            await store.initEncryption();
            await store.loadOverridesEncrypted();
        } catch (error) {
            console.warn('Encryption initialization failed', error);
        }
    }

    initSessionTimeout(payload);
    setCanonicalTimeZone(resolveCanonicalTimeZone(payload));

    if (!isRefresh) {
        setDefaultDates();
    }
}

export async function init(): Promise<void> {
    // Validate origin
    if (!isAllowedOrigin(window.location.origin)) {
        console.error('CORS: Unauthorized origin', window.location.origin);
        const message =
            typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
                ? 'This addon can only be accessed through Clockify.'
                : `Unauthorized origin: ${window.location.origin}`;
        showInitError(message);
        return;
    }

    initSubsystems();

    const token = extractAndScrubToken();
    if (!token) {
        console.error('No auth token');
        reportError(new Error('No auth token provided'), {
            module: 'main',
            operation: 'init',
            level: 'warning',
        });
        UI.renderLoading(false);
        showInitError(
            'Error: No authentication token provided. Please access this addon through Clockify.'
        );
        return;
    }

    try {
        const payload = await parseAndValidateToken(token);
        await applyTokenClaims(token, payload);
        await loadInitialData();
    } catch (e) {
        console.error('Invalid token', e);
        reportError(e instanceof Error ? e : new Error('Invalid token'), {
            module: 'main',
            operation: 'init',
            level: 'error',
        });
        UI.renderLoading(false);
        showInitError('Error: Invalid authentication token. Please try accessing the addon again.');
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

        // --- Server Settings (shared admin config) ---
        // Token already initialized via applyTokenClaims() → initSettingsApi()

        const [serverConfig, serverOverrides] = await Promise.all([
            fetchServerConfig(),
            fetchServerOverrides(),
        ]);

        if (serverConfig?.config) {
            store.applyServerConfig(serverConfig.config, serverConfig.calcParams);
        } else {
            store.resetConfigToDefaults();
        }
        if (serverOverrides?.overrides) {
            store.applyServerOverrides(
                serverOverrides.overrides as Record<string, import('./types.js').UserOverride>
            );
        }

        // Detect admin status from JWT workspaceRole claim
        const workspaceRole = (store.claims as Record<string, unknown>)?.workspaceRole as
            | string
            | undefined;
        store.ui.isAdmin = workspaceRole === 'OWNER' || workspaceRole === 'ADMIN';

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
            document.body.dataset.appError = 'true';
            return;
        }

        // Populate the overrides page (user override controls) now that we know which users exist
        // This must happen before bindConfigEvents() so the user list is ready
        UI.renderOverridesPage();

        // Hide admin-only UI for non-admins
        if (!store.ui.isAdmin) {
            const adminElements = [
                document.getElementById('configToggle'),
                document.getElementById('configContent'),
                document.getElementById('openOverridesBtn'),
            ];
            for (const el of adminElements) {
                if (el) el.classList.add('admin-only-hidden');
            }
        }
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
        document.body.dataset.appError = 'true';
        return;
    }

    // Hide "Loading..." spinner now that initial data is loaded
    UI.renderLoading(false);

    // Bind event listeners to all configuration controls
    // This includes date pickers, config toggles, export button, etc.
    bindConfigEvents(handleGenerateReport);

    // Debounced recalculation for override edits — prevents recalculating on
    // every keystroke while the user is still typing in override fields.
    const debouncedOverrideRecalc = debounce(() => {
        if (store.rawEntries) runCalculation();
    }, 250);

    const debouncedServerOverrideSave = debounce(() => {
        if (!store.ui.isAdmin) return;
        saveServerOverrides(store.overrides).then((ok) => {
            if (!ok) {
                mainLogger.warn('Failed to save overrides to server');
                UI.showError({
                    title: 'Save Failed',
                    message:
                        'Override changes could not be saved to the server. Changes are applied locally but may be lost on reload.',
                    action: 'none',
                    type: 'API_ERROR',
                    timestamp: new Date().toISOString(),
                });
            }
        });
    }, 500);

    // Bind event listeners for report generation, overrides, filters, and other interactive elements
    // These handlers are triggered when the user interacts with the UI
    UI.bindEvents({
        onGenerate: (forceRefresh?: boolean) => {
            // Flush pending override recalculation so the report uses current state
            debouncedOverrideRecalc.flush();
            handleGenerateReport(forceRefresh);
        },
        onRecalculate: () => runCalculation(),
        onOverrideChange: (userId: string, field: string, value: string) => {
            store.updateOverride(userId, field, value);
            debouncedOverrideRecalc();
            debouncedServerOverrideSave();
        },
        onOverrideModeChange: (userId: string, mode: string) => {
            store.setOverrideMode(userId, mode);
            // Note: renderOverridesPage() is called by the UI event handler when mode changes
            if (store.rawEntries) runCalculation();
            debouncedServerOverrideSave();
        },
        onPerDayOverrideChange: (userId: string, dateKey: string, field: string, value: string) => {
            store.updatePerDayOverride(userId, dateKey, field, value);
            debouncedOverrideRecalc();
            debouncedServerOverrideSave();
        },
        onCopyFromGlobal: (userId: string) => {
            const startInput = document.getElementById('startDate') as HTMLInputElement | null;
            const endInput = document.getElementById('endDate') as HTMLInputElement | null;
            if (startInput?.value && endInput?.value) {
                const dates = IsoUtils.generateDateRange(startInput.value, endInput.value);
                store.copyGlobalToPerDay(userId, dates);
                // Note: renderOverridesPage() is called by the UI event handler
                if (store.rawEntries) runCalculation();
                debouncedServerOverrideSave();
            }
        },
        onWeeklyOverrideChange: (userId: string, weekday: string, field: string, value: string) => {
            store.setWeeklyOverride(userId, weekday, field, value);
            debouncedOverrideRecalc();
            debouncedServerOverrideSave();
        },
        onCopyGlobalToWeekly: (userId: string) => {
            store.copyGlobalToWeekly(userId);
            // Note: renderOverridesPage() is called by the UI event handler
            if (store.rawEntries) runCalculation();
            debouncedServerOverrideSave();
        },
    });

    // Flush pending debounced saves on page unload to prevent data loss
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
            debouncedServerOverrideSave.flush();
            flushPendingConfigSave();
        });
    }

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
