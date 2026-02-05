/**
 * @jest-environment jsdom
 */

/**
 * @fileoverview Unit tests for CSP violation reporter
 *
 * Tests the Content Security Policy violation reporting module.
 *
 * @see js/csp-reporter.ts - CSP reporter implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch before any imports
global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

// Mock console methods
const consoleMocks = {
    log: jest.spyOn(console, 'log').mockImplementation(() => {}),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    error: jest.spyOn(console, 'error').mockImplementation(() => {}),
};

// Import after mocking
import {
    initCSPReporter,
    stopCSPReporter,
    getCSPReporterConfig,
    getCSPReportStats,
    resetCSPReportStats,
} from '../../js/csp-reporter.js';

/**
 * Dispatches a CSP violation event with the given properties
 */
function dispatchViolation(props = {}) {
    const eventData = {
        effectiveDirective: props.effectiveDirective || 'script-src',
        violatedDirective: props.violatedDirective || 'script-src',
        blockedURI: props.blockedURI || 'https://evil.com/script.js',
        documentURI: props.documentURI || 'https://app.clockify.me/reports',
        originalPolicy: props.originalPolicy || "script-src 'self'",
        sourceFile: props.sourceFile || '',
        lineNumber: props.lineNumber || 0,
        columnNumber: props.columnNumber || 0,
        sample: props.sample || '',
    };

    // Create event and define properties
    const event = new Event('securitypolicyviolation', { bubbles: true });
    Object.defineProperties(event, {
        effectiveDirective: { value: eventData.effectiveDirective, enumerable: true },
        violatedDirective: { value: eventData.violatedDirective, enumerable: true },
        blockedURI: { value: eventData.blockedURI, enumerable: true },
        documentURI: { value: eventData.documentURI, enumerable: true },
        originalPolicy: { value: eventData.originalPolicy, enumerable: true },
        sourceFile: { value: eventData.sourceFile, enumerable: true },
        lineNumber: { value: eventData.lineNumber, enumerable: true },
        columnNumber: { value: eventData.columnNumber, enumerable: true },
        sample: { value: eventData.sample, enumerable: true },
    });

    document.dispatchEvent(event);
    return eventData;
}

describe('CSP Reporter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
        stopCSPReporter(); // Ensure clean state
        resetCSPReportStats(); // Reset rate limiter
    });

    afterEach(() => {
        stopCSPReporter();
    });

    describe('initCSPReporter', () => {
        it('initializes with default configuration', () => {
            initCSPReporter();
            const config = getCSPReporterConfig();

            expect(config.reportToSentry).toBe(true);
            expect(config.maxReportsPerMinute).toBe(10);
            expect(config.includeSample).toBe(false);
        });

        it('accepts custom configuration', () => {
            initCSPReporter({
                reportToConsole: true,
                reportToSentry: false,
                maxReportsPerMinute: 5,
                customEndpoint: '/api/csp-report',
            });

            const config = getCSPReporterConfig();
            expect(config.reportToConsole).toBe(true);
            expect(config.reportToSentry).toBe(false);
            expect(config.maxReportsPerMinute).toBe(5);
            expect(config.customEndpoint).toBe('/api/csp-report');
        });

        it('registers event listener on document', () => {
            const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

            initCSPReporter();

            expect(addEventListenerSpy).toHaveBeenCalledWith(
                'securitypolicyviolation',
                expect.any(Function)
            );

            addEventListenerSpy.mockRestore();
        });
    });

    describe('stopCSPReporter', () => {
        it('removes event listener from document', () => {
            const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

            initCSPReporter();
            stopCSPReporter();

            expect(removeEventListenerSpy).toHaveBeenCalledWith(
                'securitypolicyviolation',
                expect.any(Function)
            );

            removeEventListenerSpy.mockRestore();
        });
    });

    describe('violation handling', () => {
        it('sends report to custom endpoint when configured', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            dispatchViolation({
                effectiveDirective: 'img-src',
                blockedURI: 'https://tracker.com/pixel.gif',
            });

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/csp-report',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    keepalive: true,
                })
            );

            // Verify the body contains expected data
            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);
            expect(body.directive).toBe('img-src');
            expect(body.blockedURI).toBe('https://tracker.com/pixel.gif');
        });

        it('blocks custom endpoints over http when not localhost', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: 'http://example.com/csp-report',
            });

            dispatchViolation();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('blocks custom endpoints for untrusted domains', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: 'https://evil.example.com/csp-report',
            });

            dispatchViolation();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('allows custom endpoints on clockify domains', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: 'https://app.clockify.me/csp-report',
            });

            dispatchViolation();

            expect(global.fetch).toHaveBeenCalled();
        });

        it('sanitizes URIs by removing query params and hash', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            dispatchViolation({
                blockedURI: 'https://evil.com/script.js?token=secret&user=admin#fragment',
                documentURI: 'https://app.clockify.me/reports?workspace=123#section',
            });

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            // Should strip query params and hash
            expect(body.blockedURI).toBe('https://evil.com/script.js');
            expect(body.documentURI).toBe('https://app.clockify.me/reports');
        });

        it('includes source location when available', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            dispatchViolation({
                sourceFile: 'https://app.clockify.me/bundle.js',
                lineNumber: 42,
                columnNumber: 15,
            });

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.sourceFile).toBe('https://app.clockify.me/bundle.js');
            expect(body.lineNumber).toBe(42);
            expect(body.columnNumber).toBe(15);
        });

        it('includes sample when configured', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
                includeSample: true,
            });

            dispatchViolation({
                sample: 'alert("xss")',
            });

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.sample).toBe('alert("xss")');
        });

        it('truncates long samples to 100 characters', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
                includeSample: true,
            });

            const longSample = 'x'.repeat(200);
            dispatchViolation({
                sample: longSample,
            });

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.sample).toBe('x'.repeat(100));
            expect(body.sample.length).toBe(100);
        });

        it('excludes sample when not configured', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
                includeSample: false,
            });

            dispatchViolation({
                sample: 'sensitive code here',
            });

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.sample).toBeUndefined();
        });
    });

    describe('rate limiting', () => {
        it('tracks report count', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            const initialStats = getCSPReportStats();
            expect(initialStats.reportCount).toBeGreaterThanOrEqual(0);

            dispatchViolation();

            const afterStats = getCSPReportStats();
            expect(afterStats.reportCount).toBeGreaterThan(initialStats.reportCount);
        });

        it('respects maxReportsPerMinute limit', () => {
            // Reset rate limiter before this test
            resetCSPReportStats();

            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
                maxReportsPerMinute: 3,
            });

            // Send 5 violations
            for (let i = 0; i < 5; i++) {
                dispatchViolation({ blockedURI: `https://evil${i}.com/script.js` });
            }

            // Only 3 should be sent (rate limited)
            expect(global.fetch).toHaveBeenCalledTimes(3);

            // Verify stats match
            const stats = getCSPReportStats();
            expect(stats.reportCount).toBe(3);
        });

        it('includes lastResetTime in stats', () => {
            initCSPReporter();

            const stats = getCSPReportStats();
            expect(stats.lastResetTime).toBeDefined();
            expect(typeof stats.lastResetTime).toBe('number');
        });
    });

    describe('error handling', () => {
        it('silently handles fetch failures', () => {
            global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            // Should not throw
            expect(() => {
                dispatchViolation();
            }).not.toThrow();
        });

        it('handles invalid URIs gracefully', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            dispatchViolation({
                blockedURI: 'not-a-valid-url',
                documentURI: 'also-invalid',
            });

            // Should still send report with truncated URIs
            expect(global.fetch).toHaveBeenCalled();
            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.blockedURI).toBe('not-a-valid-url');
        });

        it('handles missing event properties', () => {
            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            // Dispatch event with minimal properties
            const event = new Event('securitypolicyviolation');
            document.dispatchEvent(event);

            expect(global.fetch).toHaveBeenCalled();
            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.directive).toBe('unknown');
            expect(body.blockedURI).toBe('unknown');
        });
    });

    describe('report format', () => {
        it('includes all required fields', () => {
            // Reset to ensure rate limiter allows this report
            resetCSPReportStats();

            initCSPReporter({
                reportToSentry: false,
                reportToConsole: false,
                customEndpoint: '/api/csp-report',
            });

            dispatchViolation({
                effectiveDirective: 'style-src',
                violatedDirective: 'style-src',
                blockedURI: 'https://cdn.example.com/styles.css',
                documentURI: 'https://app.clockify.me/dashboard',
                originalPolicy: "style-src 'self'",
            });

            expect(global.fetch).toHaveBeenCalled();
            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body).toHaveProperty('directive', 'style-src');
            expect(body).toHaveProperty('blockedURI', 'https://cdn.example.com/styles.css');
            expect(body).toHaveProperty('documentURI', 'https://app.clockify.me/dashboard');
            expect(body).toHaveProperty('originalPolicy', "style-src 'self'");
            expect(body).toHaveProperty('violatedDirective', 'style-src');
            expect(body).toHaveProperty('timestamp');

            // Timestamp should be ISO format
            expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
        });
    });

    describe('window exposure', () => {
        it('exposes CSP reporter on window for debugging', () => {
            initCSPReporter();

            expect(window.__OTPLUS_CSP__).toBeDefined();
            expect(typeof window.__OTPLUS_CSP__.getConfig).toBe('function');
            expect(typeof window.__OTPLUS_CSP__.getStats).toBe('function');
            expect(typeof window.__OTPLUS_CSP__.init).toBe('function');
        });
    });

    describe('getCSPReporterConfig', () => {
        it('returns a copy of the config (immutable)', () => {
            initCSPReporter({ maxReportsPerMinute: 5 });

            const config1 = getCSPReporterConfig();
            const config2 = getCSPReporterConfig();

            expect(config1).not.toBe(config2);
            expect(config1).toEqual(config2);
        });
    });
});
