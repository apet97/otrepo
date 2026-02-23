/**
 * @fileoverview Error Reporting Module
 * Provides centralized error tracking and reporting using Sentry.
 * Handles initialization, error capture, and sensitive data scrubbing.
 */

import { store } from './state.js';
import { hashString } from './utils.js';

// ==================== TYPES ====================

/**
 * Sentry configuration options
 */
export interface SentryConfig {
    /** Sentry DSN (Data Source Name) */
    dsn: string;
    /** Environment name (e.g., 'production', 'development') */
    environment: string;
    /** Application version */
    release: string;
    /** Whether to enable debug mode */
    debug?: boolean;
    /** Sample rate for error events (0.0 to 1.0) */
    sampleRate?: number;
}

/**
 * Error context for reporting
 */
export interface ErrorContext {
    /** Module where error occurred */
    module?: string;
    /** Function or operation name */
    operation?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
    /** User-facing error message */
    userMessage?: string;
    /** Error severity level */
    level?: 'fatal' | 'error' | 'warning' | 'info';
}

/**
 * Sentry-like interface for type safety without direct import
 */
interface SentryLike {
    init: (options: unknown) => void;
    setTag: (key: string, value: string) => void;
    setUser: (user: { id: string } | null) => void;
    withScope: (callback: (scope: ScopeLike) => void) => void;
    captureException: (error: Error) => void;
    captureMessage: (message: string) => void;
    addBreadcrumb: (breadcrumb: unknown) => void;
    flush: (timeout: number) => Promise<boolean>;
}

interface ScopeLike {
    setLevel: (level: string) => void;
    setTag: (key: string, value: string) => void;
    setExtras: (extras: Record<string, unknown>) => void;
    setExtra: (key: string, value: unknown) => void;
}

// ==================== STATE ====================

let sentryInitialized = false;
let sentryInstance: SentryLike | null = null;

// ==================== SENSITIVE DATA PATTERNS ====================

/**
 * Patterns to redact from error reports.
 *
 * DATA REDACTION POLICY:
 * - Authentication: Bearer tokens, API keys, X-Addon-Tokens.
 * - Secrets: Passwords, client secrets.
 * - PII: Email addresses.
 *
 * We aggressively scrub these from exception values, stack traces (filenames),
 * breadcrumbs, network request URLs/bodies, and metadata.
 */
const SENSITIVE_PATTERNS = [
    /auth_token=[^&\s]*/gi,
    /X-Addon-Token:\s*[^\s]*/gi,
    /Bearer\s+[^\s]*/gi,
    /token["\s:=]+[^"'\s,}]*/gi,
    /password["\s:=]+[^"'\s,}]*/gi,
    /secret["\s:=]+[^"'\s,}]*/gi,
    /api[_-]?key["\s:=]+[^"'\s,}]*/gi,
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email addresses
];

/**
 * Scrubs sensitive data from a string
 */
function scrubSensitiveData(text: string): string {
    let scrubbed = text;
    for (const pattern of SENSITIVE_PATTERNS) {
        scrubbed = scrubbed.replace(pattern, '[REDACTED]');
    }
    return scrubbed;
}

/**
 * Scrubs sensitive data from an object recursively
 */
function scrubObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'string') {
        return scrubSensitiveData(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(scrubObject);
    }

    if (typeof obj === 'object') {
        const scrubbed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            // Redact sensitive keys entirely
            const lowerKey = key.toLowerCase();
            if (
                lowerKey.includes('token') ||
                lowerKey.includes('password') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('key') ||
                lowerKey.includes('email')
            ) {
                scrubbed[key] = '[REDACTED]';
            } else {
                scrubbed[key] = scrubObject(value);
            }
        }
        return scrubbed;
    }

    return obj;
}

// ==================== INITIALIZATION ====================

/**
 * Initializes Sentry error reporting.
 * Safe to call multiple times - subsequent calls are no-ops.
 *
 * @param config - Sentry configuration options
 * @returns Promise that resolves when initialization is complete
 */
export async function initErrorReporting(config: SentryConfig): Promise<boolean> {
    if (sentryInitialized) {
        return true;
    }

    // Skip initialization if no DSN provided
    if (!config.dsn || config.dsn === 'YOUR_DSN' || config.dsn.startsWith('__')) {
        console.warn('[ErrorReporting] Sentry DSN not configured, error reporting disabled');
        return false;
    }

    try {
        // Dynamic import to avoid bundling Sentry when not needed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Sentry = await import('@sentry/browser') as any as SentryLike;
        sentryInstance = Sentry;

        Sentry.init({
            dsn: config.dsn,
            environment: config.environment,
            release: config.release,
            debug: config.debug ?? false,
            sampleRate: config.sampleRate ?? 1.0,

            // Scrub sensitive data before sending
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            beforeSend(event: any) {
                // Scrub exception values
                if (event.exception?.values) {
                    for (const exception of event.exception.values) {
                        if (exception.value) {
                            exception.value = scrubSensitiveData(exception.value);
                        }
                        if (exception.stacktrace?.frames) {
                            for (const frame of exception.stacktrace.frames) {
                                if (frame.filename) {
                                    frame.filename = scrubSensitiveData(frame.filename);
                                }
                            }
                        }
                    }
                }

                // Scrub breadcrumbs
                if (event.breadcrumbs) {
                    for (const breadcrumb of event.breadcrumbs) {
                        if (breadcrumb.message) {
                            breadcrumb.message = scrubSensitiveData(breadcrumb.message);
                        }
                        if (breadcrumb.data) {
                            breadcrumb.data = scrubObject(breadcrumb.data) as Record<string, unknown>;
                        }
                    }
                }

                // Scrub request data
                if (event.request?.url) {
                    event.request.url = scrubSensitiveData(event.request.url);
                }
                if (event.request?.query_string) {
                    event.request.query_string = scrubSensitiveData(event.request.query_string);
                }

                // Scrub extra context
                if (event.extra) {
                    event.extra = scrubObject(event.extra) as Record<string, unknown>;
                }

                return event;
            },

            // Configure which errors to ignore
            ignoreErrors: [
                // Ignore user-initiated aborts
                'AbortError',
                // Ignore network errors that are expected
                'Failed to fetch',
                'NetworkError',
                // Ignore ResizeObserver errors (browser noise)
                'ResizeObserver loop',
            ],

            // Configure breadcrumb filtering
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            beforeBreadcrumb(breadcrumb: any) {
                // Filter out noisy console breadcrumbs
                if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
                    return null;
                }
                return breadcrumb;
            },
        });

        // Set workspace context if available (hashed for privacy)
        const hashedWsId = getHashedWorkspaceId();
        if (hashedWsId) {
            Sentry.setTag('workspace_id', hashedWsId);
        }

        sentryInitialized = true;
        console.warn('[ErrorReporting] Sentry initialized successfully');
        return true;
    } catch (error) {
        console.warn('[ErrorReporting] Failed to initialize Sentry:', error);
        return false;
    }
}

// ==================== ERROR REPORTING ====================

/**
 * Reports an error to Sentry with optional context.
 * Safe to call even if Sentry is not initialized.
 *
 * @param error - The error to report
 * @param context - Additional context about the error
 */
export function reportError(error: Error | string, context?: ErrorContext): void {
    const errorObj = typeof error === 'string' ? new Error(error) : error;

    // Always log to console
    console.error(`[${context?.module || 'App'}] ${context?.operation || 'Error'}:`, errorObj);

    // Skip Sentry if not initialized
    if (!sentryInitialized || !sentryInstance) {
        return;
    }

    try {
        sentryInstance.withScope((scope: ScopeLike) => {
            // Set error level
            if (context?.level) {
                scope.setLevel(context.level);
            }

            // Set tags
            if (context?.module) {
                scope.setTag('module', context.module);
            }
            if (context?.operation) {
                scope.setTag('operation', context.operation);
            }

            // Set workspace context (hashed for privacy)
            const hashedWsId = getHashedWorkspaceId();
            if (hashedWsId) {
                scope.setTag('workspace_id', hashedWsId);
            }

            // Set extra context (scrubbed)
            if (context?.metadata) {
                scope.setExtras(scrubObject(context.metadata) as Record<string, unknown>);
            }
            if (context?.userMessage) {
                scope.setExtra('user_message', context.userMessage);
            }

            // Capture the error
            sentryInstance?.captureException(errorObj);
        });
    } catch (sentryError) {
        console.warn('[ErrorReporting] Failed to report error to Sentry:', sentryError);
    }
}

/**
 * Reports a message to Sentry (for non-error events).
 *
 * @param message - The message to report
 * @param level - Severity level
 * @param context - Additional context
 */
export function reportMessage(
    message: string,
    level: 'fatal' | 'error' | 'warning' | 'info' = 'info',
    context?: Omit<ErrorContext, 'level'>
): void {
    // Always log to console
    const logFn = level === 'error' || level === 'fatal' ? console.error : console.warn;
    logFn(`[${context?.module || 'App'}] ${message}`);

    if (!sentryInitialized || !sentryInstance) {
        return;
    }

    try {
        sentryInstance.withScope((scope: ScopeLike) => {
            scope.setLevel(level);

            if (context?.module) {
                scope.setTag('module', context.module);
            }
            if (context?.operation) {
                scope.setTag('operation', context.operation);
            }
            // Set workspace context (hashed for privacy)
            const hashedWsId = getHashedWorkspaceId();
            if (hashedWsId) {
                scope.setTag('workspace_id', hashedWsId);
            }
            if (context?.metadata) {
                scope.setExtras(scrubObject(context.metadata) as Record<string, unknown>);
            }

            sentryInstance?.captureMessage(scrubSensitiveData(message));
        });
    } catch (sentryError) {
        console.warn('[ErrorReporting] Failed to report message to Sentry:', sentryError);
    }
}

/**
 * Sets user context for error reports.
 * User ID is set without PII (no email, name, etc.).
 *
 * @param userId - The user ID (will be hashed for privacy)
 */
export function setUserContext(userId: string | null): void {
    if (!sentryInitialized || !sentryInstance) {
        return;
    }

    if (userId) {
        // Hash the user ID for privacy
        const hashedId = hashString(userId);
        sentryInstance.setUser({ id: hashedId });
    } else {
        sentryInstance.setUser(null);
    }
}

/**
 * Adds a breadcrumb to the error trail.
 *
 * @param category - Breadcrumb category
 * @param message - Breadcrumb message
 * @param data - Additional data
 */
export function addBreadcrumb(
    category: string,
    message: string,
    data?: Record<string, unknown>
): void {
    if (!sentryInitialized || !sentryInstance) {
        return;
    }

    sentryInstance.addBreadcrumb({
        category,
        message: scrubSensitiveData(message),
        data: data ? (scrubObject(data) as Record<string, unknown>) : undefined,
        level: 'info',
    });
}

// ==================== HELPERS ====================

/**
 * Gets the hashed workspace ID for privacy-safe Sentry tagging.
 * Returns null if no workspace ID is available.
 */
function getHashedWorkspaceId(): string | null {
    const workspaceId = store.claims?.workspaceId;
    if (!workspaceId) return null;
    return hashString(workspaceId);
}

/**
 * Gets Sentry initialization status
 */
export function isErrorReportingEnabled(): boolean {
    return sentryInitialized;
}

/**
 * Flushes pending error reports (useful before page unload)
 */
export async function flushErrorReports(timeout = 2000): Promise<boolean> {
    if (!sentryInitialized || !sentryInstance) {
        return true;
    }

    try {
        return await sentryInstance.flush(timeout);
    } catch {
        return false;
    }
}
