/**
 * @fileoverview Structured Logging Module
 * Provides configurable logging with log levels and production safety.
 * In production mode, DEBUG and INFO logs are suppressed.
 */

import { STORAGE_KEYS } from './constants.js';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4,
}

/**
 * Log level names for display
 */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.NONE]: 'NONE',
};

/**
 * Output format for log messages.
 * - 'text': Human-readable console output (default)
 * - 'json': Structured JSON for log aggregation tools (Datadog, CloudWatch, ELK)
 */
export type LogOutputFormat = 'text' | 'json';

/**
 * Logger configuration
 */
interface LoggerConfig {
    /** Minimum log level to output */
    minLevel: LogLevel;
    /** Whether to include timestamps in output */
    timestamps: boolean;
    /** Whether to include the module name in output */
    showModule: boolean;
    /** Output format: 'text' (default) or 'json' for structured logging */
    outputFormat: LogOutputFormat;
    /** Current correlation ID for request tracing */
    correlationId: string | null;
}

/**
 * Default configuration based on environment
 */
const getDefaultConfig = (): LoggerConfig => {
    const isDebug =
        typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.DEBUG) === 'true';

    const isProduction =
        typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

    // Check for persisted output format preference
    let outputFormat: LogOutputFormat = 'text';
    if (typeof localStorage !== 'undefined') {
        const savedFormat = localStorage.getItem(STORAGE_KEYS.LOG_FORMAT);
        if (savedFormat === 'json' || savedFormat === 'text') {
            outputFormat = savedFormat;
        }
    }

    return {
        minLevel: isDebug ? LogLevel.DEBUG : isProduction ? LogLevel.WARN : LogLevel.INFO,
        timestamps: true,
        showModule: true,
        outputFormat,
        correlationId: null,
    };
};

/**
 * Global logger configuration
 */
let config: LoggerConfig = getDefaultConfig();

/**
 * Configure the logger
 */
export function configureLogger(newConfig: Partial<LoggerConfig>): void {
    config = { ...config, ...newConfig };
}

/**
 * Set the minimum log level
 */
export function setLogLevel(level: LogLevel): void {
    config.minLevel = level;
}

/**
 * Enable debug mode
 */
export function enableDebugMode(): void {
    config.minLevel = LogLevel.DEBUG;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.DEBUG, 'true');
    }
}

/**
 * Disable debug mode
 */
export function disableDebugMode(): void {
    config.minLevel = LogLevel.INFO;
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEYS.DEBUG);
    }
}

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
    return config.minLevel <= LogLevel.DEBUG;
}

/**
 * Set the output format for log messages.
 *
 * @param format - 'text' for human-readable output, 'json' for structured JSON
 *
 * JSON format outputs logs as:
 * ```json
 * {"timestamp":"2025-01-30T12:00:00Z","level":"INFO","module":"API","message":"...","data":{}}
 * ```
 *
 * This is useful for log aggregation tools like Datadog, CloudWatch, or ELK.
 */
export function setOutputFormat(format: LogOutputFormat): void {
    config.outputFormat = format;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.LOG_FORMAT, format);
    }
}

/**
 * Get the current output format
 */
export function getOutputFormat(): LogOutputFormat {
    return config.outputFormat;
}

// ============================================================================
// CORRELATION ID SUPPORT
// ============================================================================
// Correlation IDs enable request tracing across distributed systems.
// Each request gets a unique ID that's included in all related log entries.
// ============================================================================

/**
 * Generates a unique correlation ID for request tracing.
 * Uses a combination of timestamp and random characters for uniqueness.
 *
 * @returns Unique correlation ID string
 */
export function generateCorrelationId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
}

/**
 * Sets the correlation ID for the current request context.
 * All subsequent log entries will include this ID until it's cleared.
 *
 * @param id - The correlation ID to set, or null to clear
 */
export function setCorrelationId(id: string | null): void {
    config.correlationId = id;
}

/**
 * Gets the current correlation ID.
 *
 * @returns The current correlation ID or null if not set
 */
export function getCorrelationId(): string | null {
    return config.correlationId;
}

/**
 * Executes a function with a specific correlation ID context.
 * The ID is automatically set before execution and cleared after.
 *
 * @param fn - The function to execute
 * @param id - Optional specific correlation ID (generates one if not provided)
 * @returns The return value of the function
 */
export function withCorrelationId<T>(fn: () => T, id?: string): T {
    const correlationId = id ?? generateCorrelationId();
    const previousId = config.correlationId;
    config.correlationId = correlationId;
    try {
        return fn();
    } finally {
        config.correlationId = previousId;
    }
}

/**
 * Async version of withCorrelationId that avoids global state.
 *
 * **Browser-safe**: Generates a correlation ID and passes it to the callback so
 * callers can bind it to loggers explicitly (e.g., createLogger('API', id)).
 * This prevents cross-talk when multiple async operations overlap.
 *
 * @param fn - The async function to execute (receives correlationId)
 * @param id - Optional specific correlation ID (generates one if not provided)
 * @returns Promise resolving to the return value of the function
 */
export async function withCorrelationIdAsync<T>(
    fn: (correlationId: string) => Promise<T>,
    id?: string
): Promise<T> {
    const correlationId = id ?? generateCorrelationId();
    return await fn(correlationId);
}

/**
 * Format a log message with metadata (text format)
 */
function formatMessageText(
    level: LogLevel,
    module: string | undefined,
    message: string,
    correlationId?: string
): string {
    const parts: string[] = [];

    if (config.timestamps) {
        parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(`[${LOG_LEVEL_NAMES[level]}]`);

    const activeCorrelationId = correlationId ?? config.correlationId;
    // Include correlation ID if set (for request tracing)
    if (activeCorrelationId) {
        parts.push(`[${activeCorrelationId}]`);
    }

    if (config.showModule && module) {
        parts.push(`[${module}]`);
    }

    parts.push(message);

    return parts.join(' ');
}

/**
 * Format a log entry as JSON for structured logging.
 *
 * Output format (with correlation ID):
 * ```json
 * {"timestamp":"2025-01-30T12:00:00.000Z","level":"INFO","correlationId":"abc123","module":"API","message":"...","data":{}}
 * ```
 *
 * Output format (without correlation ID):
 * ```json
 * {"timestamp":"2025-01-30T12:00:00.000Z","level":"INFO","module":"API","message":"...","data":{}}
 * ```
 */
function formatMessageJson(
    level: LogLevel,
    module: string | undefined,
    message: string,
    data: unknown[],
    correlationId?: string
): string {
    const entry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level: LOG_LEVEL_NAMES[level],
    };

    const activeCorrelationId = correlationId ?? config.correlationId;
    // Include correlation ID if set (for request tracing)
    if (activeCorrelationId) {
        entry.correlationId = activeCorrelationId;
    }

    if (module) {
        entry.module = module;
    }

    entry.message = message;

    // Include sanitized data if present
    if (data.length > 0) {
        entry.data = data.length === 1 ? data[0] : data;
    }

    return JSON.stringify(entry);
}

/**
 * Sanitize data to remove sensitive information before logging
 * Removes tokens, emails, and other PII
 */
function sanitize(data: unknown): unknown {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === 'string') {
        // Mask potential tokens (long alphanumeric strings)
        return data.replace(/[a-zA-Z0-9]{32,}/g, '[REDACTED]');
    }

    if (Array.isArray(data)) {
        return data.map(sanitize);
    }

    if (typeof data === 'object') {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            // Redact sensitive fields
            if (
                lowerKey.includes('token') ||
                lowerKey.includes('password') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('email') ||
                lowerKey.includes('key') ||
                lowerKey === 'authorization'
            ) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = sanitize(value);
            }
        }
        return sanitized;
    }

    return data;
}

/**
 * Audit action types that should always be logged regardless of log level.
 * These are important for compliance and security monitoring.
 */
const AUDIT_ACTIONS = ['CONFIG_CHANGE', 'OVERRIDE_CHANGE', 'EXPORT'] as const;

/**
 * Checks if any data object contains an audit action.
 */
function isAuditEvent(data: unknown[]): boolean {
    return data.some((item) => {
        if (item && typeof item === 'object' && 'action' in item) {
            const action = (item as { action: unknown }).action;
            return typeof action === 'string' && AUDIT_ACTIONS.includes(action as typeof AUDIT_ACTIONS[number]);
        }
        return false;
    });
}

/**
 * Core log function.
 *
 * PRODUCTION SAFETY:
 * - Checks config.minLevel before processing to avoid overhead.
 * - In production builds, minLevel defaults to WARN, suppressing DEBUG/INFO.
 * - This prevents accidental leakage of detailed flow info in user consoles.
 * - EXCEPTION: Audit events (CONFIG_CHANGE, OVERRIDE_CHANGE, EXPORT) always log.
 *
 * OUTPUT FORMATS:
 * - 'text': Human-readable format with brackets (default)
 * - 'json': Structured JSON for log aggregation tools
 */
function log(level: LogLevel, module: string | undefined, message: string, ...data: unknown[]): void {
    // Audit events bypass the log level filter for compliance/security
    const shouldLog = isAuditEvent(data) || level >= config.minLevel;
    if (!shouldLog) {
        return;
    }

    const sanitizedData = data.map(sanitize);

    // JSON output mode for structured logging
    if (config.outputFormat === 'json') {
        const jsonOutput = formatMessageJson(level, module, message, sanitizedData);
        switch (level) {
            case LogLevel.DEBUG:
            case LogLevel.INFO:
                // eslint-disable-next-line no-console
                console.log(jsonOutput);
                break;
            case LogLevel.WARN:
                console.warn(jsonOutput);
                break;
            case LogLevel.ERROR:
                console.error(jsonOutput);
                break;
        }
        return;
    }

    // Text output mode (default)
    const formattedMessage = formatMessageText(level, module, message);

    switch (level) {
        case LogLevel.DEBUG:
        case LogLevel.INFO:
            // In production, these should be suppressed by minLevel check above
            // eslint-disable-next-line no-console
            console.log(formattedMessage, ...sanitizedData);
            break;
        case LogLevel.WARN:
            console.warn(formattedMessage, ...sanitizedData);
            break;
        case LogLevel.ERROR:
            console.error(formattedMessage, ...sanitizedData);
            break;
    }
}

/**
 * Log with an explicit correlation ID, avoiding global state.
 */
function logWithCorrelationId(
    level: LogLevel,
    module: string | undefined,
    correlationId: string,
    message: string,
    ...data: unknown[]
): void {
    const shouldLog = isAuditEvent(data) || level >= config.minLevel;
    if (!shouldLog) {
        return;
    }

    const sanitizedData = data.map(sanitize);

    if (config.outputFormat === 'json') {
        const jsonOutput = formatMessageJson(level, module, message, sanitizedData, correlationId);
        switch (level) {
            case LogLevel.DEBUG:
            case LogLevel.INFO:
                // eslint-disable-next-line no-console
                console.log(jsonOutput);
                break;
            case LogLevel.WARN:
                console.warn(jsonOutput);
                break;
            case LogLevel.ERROR:
                console.error(jsonOutput);
                break;
        }
        return;
    }

    const formattedMessage = formatMessageText(level, module, message, correlationId);

    switch (level) {
        case LogLevel.DEBUG:
        case LogLevel.INFO:
            // eslint-disable-next-line no-console
            console.log(formattedMessage, ...sanitizedData);
            break;
        case LogLevel.WARN:
            console.warn(formattedMessage, ...sanitizedData);
            break;
        case LogLevel.ERROR:
            console.error(formattedMessage, ...sanitizedData);
            break;
    }
}

/**
 * Create a scoped logger for a specific module
 */
export function createLogger(module: string, correlationId?: string) {
    const logWithContext = (level: LogLevel, message: string, ...data: unknown[]) => {
        if (correlationId) {
            logWithCorrelationId(level, module, correlationId, message, ...data);
            return;
        }
        log(level, module, message, ...data);
    };

    return {
        debug: (message: string, ...data: unknown[]) => logWithContext(LogLevel.DEBUG, message, ...data),
        info: (message: string, ...data: unknown[]) => logWithContext(LogLevel.INFO, message, ...data),
        warn: (message: string, ...data: unknown[]) => logWithContext(LogLevel.WARN, message, ...data),
        error: (message: string, ...data: unknown[]) => logWithContext(LogLevel.ERROR, message, ...data),
        /**
         * Log with explicit level
         */
        log: (level: LogLevel, message: string, ...data: unknown[]) => logWithContext(level, message, ...data),
        /**
         * Create a logger bound to a specific correlation ID.
         */
        withCorrelationId: (id: string) => createLogger(module, id),
        /**
         * Log performance timing
         */
        time: (label: string) => {
            if (config.minLevel <= LogLevel.DEBUG) {
                // eslint-disable-next-line no-console
                console.time(`[${module}] ${label}`);
            }
        },
        timeEnd: (label: string) => {
            if (config.minLevel <= LogLevel.DEBUG) {
                // eslint-disable-next-line no-console
                console.timeEnd(`[${module}] ${label}`);
            }
        },
    };
}

/**
 * Default logger instance (for general use without module scope)
 */
export const logger = {
    debug: (message: string, ...data: unknown[]) => log(LogLevel.DEBUG, undefined, message, ...data),
    info: (message: string, ...data: unknown[]) => log(LogLevel.INFO, undefined, message, ...data),
    warn: (message: string, ...data: unknown[]) => log(LogLevel.WARN, undefined, message, ...data),
    error: (message: string, ...data: unknown[]) => log(LogLevel.ERROR, undefined, message, ...data),
    log: (level: LogLevel, message: string, ...data: unknown[]) => log(level, undefined, message, ...data),
    withCorrelationId: (id: string) => createLogger('', id),
};

// Export LogLevel for consumers
export { LogLevel as Level };
