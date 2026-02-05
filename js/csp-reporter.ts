/**
 * @fileoverview Content Security Policy (CSP) Violation Reporter
 *
 * Handles CSP violation events and reports them for security monitoring.
 * This module provides visibility into potential XSS attacks, unauthorized
 * script execution, or misconfigured security policies.
 *
 * ## How It Works
 *
 * 1. Listens for `securitypolicyviolation` events from the browser
 * 2. Normalizes and filters violation reports
 * 3. Reports violations via configured channels (console, Sentry, custom endpoint)
 *
 * ## Usage
 *
 * ```typescript
 * import { initCSPReporter } from './csp-reporter.js';
 *
 * // Initialize with default console reporting
 * initCSPReporter();
 *
 * // Or with custom configuration
 * initCSPReporter({
 *     reportToConsole: true,
 *     reportToSentry: true,
 *     customEndpoint: '/api/csp-report',
 * });
 * ```
 *
 * ## Security Considerations
 *
 * - Violation reports may contain sensitive information (URLs, inline script hashes)
 * - Endpoint reports are sent with minimal data to prevent information leakage
 * - Rate limiting is applied to prevent report flooding from attacks
 */

import { createLogger } from './logger.js';
import { reportError } from './error-reporting.js';

const logger = createLogger('CSP');

/**
 * CSP violation report format.
 */
export interface CSPViolationReport {
    /** The directive that was violated (e.g., 'script-src') */
    directive: string;
    /** The URI of the resource that violated the policy */
    blockedURI: string;
    /** The document URI where the violation occurred */
    documentURI: string;
    /** The original policy that was violated */
    originalPolicy: string;
    /** The violated directive */
    violatedDirective: string;
    /** The source file where the violation occurred (if available) */
    sourceFile?: string;
    /** The line number in the source file (if available) */
    lineNumber?: number;
    /** The column number in the source file (if available) */
    columnNumber?: number;
    /** Sample of the blocked content (limited for privacy) */
    sample?: string;
    /** Timestamp of the violation */
    timestamp: string;
}

/**
 * Configuration for CSP reporter.
 */
export interface CSPReporterConfig {
    /** Whether to log violations to console (default: true in dev) */
    reportToConsole: boolean;
    /** Whether to report violations to Sentry (default: true) */
    reportToSentry: boolean;
    /** Custom endpoint to POST violation reports (optional) */
    customEndpoint?: string;
    /** Maximum reports per minute to prevent flooding (default: 10) */
    maxReportsPerMinute: number;
    /** Whether to include sample content in reports (default: false for privacy) */
    includeSample: boolean;
}

/**
 * Default configuration.
 *
 * ## Production Settings
 *
 * In production environments:
 * - `reportToConsole`: Disabled (false) to avoid noise in production logs
 * - `reportToSentry`: Enabled (true) for security monitoring and alerting
 * - `maxReportsPerMinute`: Rate limited to 10 to prevent report flooding
 * - `includeSample`: Disabled (false) to prevent sensitive data leakage
 *
 * These defaults ensure CSP violations are captured for enterprise security
 * monitoring while respecting privacy and performance constraints.
 */
const defaultConfig: CSPReporterConfig = {
    reportToConsole: typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production',
    reportToSentry: true, // Enterprise: always report to Sentry for security monitoring
    maxReportsPerMinute: 10,
    includeSample: false,
};

/**
 * Current configuration.
 */
let config: CSPReporterConfig = { ...defaultConfig };

/**
 * Rate limiting state.
 */
let reportCount = 0;
let lastResetTime = Date.now();

const CLOCKIFY_HOSTNAME = 'clockify.me';

function isLocalhost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isAllowedCspEndpoint(endpoint: string): boolean {
    if (!endpoint) return false;

    try {
        const url = new URL(endpoint, window.location.href);
        if (url.origin === window.location.origin) {
            return true;
        }
        if (url.protocol !== 'https:' && !isLocalhost(url.hostname)) {
            return false;
        }
        if (url.hostname === CLOCKIFY_HOSTNAME || url.hostname.endsWith(`.${CLOCKIFY_HOSTNAME}`)) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Checks if we can send another report (rate limiting).
 */
function canReport(): boolean {
    const now = Date.now();
    const elapsed = now - lastResetTime;

    // Reset counter every minute
    if (elapsed >= 60000) {
        reportCount = 0;
        lastResetTime = now;
    }

    return reportCount < config.maxReportsPerMinute;
}

/**
 * Normalizes a CSP violation event into a report object.
 */
function normalizeViolation(event: SecurityPolicyViolationEvent): CSPViolationReport {
    const report: CSPViolationReport = {
        directive: event.effectiveDirective || event.violatedDirective || 'unknown',
        blockedURI: sanitizeURI(event.blockedURI || 'unknown'),
        documentURI: sanitizeURI(event.documentURI || 'unknown'),
        originalPolicy: event.originalPolicy || '',
        violatedDirective: event.violatedDirective || 'unknown',
        timestamp: new Date().toISOString(),
    };

    // Include source location if available
    if (event.sourceFile) {
        report.sourceFile = sanitizeURI(event.sourceFile);
        report.lineNumber = event.lineNumber || undefined;
        report.columnNumber = event.columnNumber || undefined;
    }

    // Optionally include sample (truncated for privacy)
    if (config.includeSample && event.sample) {
        report.sample = event.sample.substring(0, 100);
    }

    return report;
}

/**
 * Sanitizes URIs to remove sensitive information.
 */
function sanitizeURI(uri: string): string {
    if (!uri || uri === 'unknown') return uri;

    try {
        const url = new URL(uri);
        // Remove query params and hash which may contain sensitive data
        return `${url.origin}${url.pathname}`;
    } catch {
        // Not a valid URL, return as-is but truncated
        return uri.substring(0, 200);
    }
}

/**
 * Handles a CSP violation event.
 */
function handleViolation(event: SecurityPolicyViolationEvent): void {
    // Rate limiting check
    if (!canReport()) {
        return;
    }

    reportCount++;
    const report = normalizeViolation(event);

    // Console logging (for development)
    if (config.reportToConsole) {
        logger.warn('CSP Violation detected', {
            directive: report.directive,
            blockedURI: report.blockedURI,
            sourceFile: report.sourceFile,
            lineNumber: report.lineNumber,
        });
    }

    // Sentry reporting
    if (config.reportToSentry) {
        const error = new Error(`CSP Violation: ${report.directive}`);
        error.name = 'CSPViolation';
        reportError(error, {
            module: 'CSP',
            operation: 'violation',
            level: 'warning',
            metadata: {
                directive: report.directive,
                blockedURI: report.blockedURI,
                documentURI: report.documentURI,
                violatedDirective: report.violatedDirective,
                sourceFile: report.sourceFile,
                lineNumber: report.lineNumber,
            },
        });
    }

    // Custom endpoint reporting
    if (config.customEndpoint) {
        sendReportToEndpoint(report, config.customEndpoint);
    }
}

/**
 * Sends a violation report to a custom endpoint.
 */
async function sendReportToEndpoint(report: CSPViolationReport, endpoint: string): Promise<void> {
    try {
        if (!isAllowedCspEndpoint(endpoint)) {
            logger.debug('Blocked CSP report endpoint', { endpoint });
            return;
        }
        await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(report),
            // Use keepalive for reliability on page unload
            keepalive: true,
        });
    } catch (error) {
        // Silently fail - we don't want CSP reporting failures to impact the app
        logger.debug('Failed to send CSP report to endpoint', { endpoint, error });
    }
}

/**
 * Initializes the CSP violation reporter.
 *
 * @param customConfig - Optional configuration overrides
 */
export function initCSPReporter(customConfig?: Partial<CSPReporterConfig>): void {
    config = { ...defaultConfig, ...customConfig };

    // Only run in browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    // Register the event listener
    document.addEventListener('securitypolicyviolation', handleViolation);

    logger.debug('CSP reporter initialized', {
        reportToConsole: config.reportToConsole,
        reportToSentry: config.reportToSentry,
        hasCustomEndpoint: !!config.customEndpoint,
    });
}

/**
 * Stops the CSP violation reporter.
 * Useful for cleanup in tests or when reconfiguring.
 */
export function stopCSPReporter(): void {
    if (typeof document !== 'undefined') {
        document.removeEventListener('securitypolicyviolation', handleViolation);
    }
}

/**
 * Gets the current CSP reporter configuration.
 */
export function getCSPReporterConfig(): CSPReporterConfig {
    return { ...config };
}

/**
 * Gets the current rate limit status for monitoring.
 */
export function getCSPReportStats(): { reportCount: number; lastResetTime: number } {
    return { reportCount, lastResetTime };
}

/**
 * Resets the rate limiter state (for testing only).
 */
export function resetCSPReportStats(): void {
    reportCount = 0;
    lastResetTime = Date.now();
}

const isProductionEnv =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

// Expose CSP reporter on window for debugging (non-production only)
/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined' && !isProductionEnv) {
    (window as unknown as Record<string, unknown>).__OTPLUS_CSP__ = {
        getConfig: getCSPReporterConfig,
        getStats: getCSPReportStats,
        init: initCSPReporter,
    };
}
