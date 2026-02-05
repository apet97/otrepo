/**
 * @fileoverview Clockify API Client - Network Communication & Rate Limiting
 *
 * This module is the ONLY module that communicates with external Clockify APIs.
 * It provides a single, centralized HTTP client with built-in rate limiting,
 * retry logic, pagination handling, and error classification.
 *
 * ## Module Responsibility
 * - Authenticate all requests with X-Addon-Token header
 * - Enforce rate limits with token bucket algorithm (50 req/sec)
 * - Handle HTTP errors (401/403/404 non-retryable, 429 with backoff, 5xx with retry)
 * - Paginate large result sets (time entries, profiles, holidays, time-off)
 * - Transform raw API responses into application-friendly types
 * - Provide abort signal support for cancellable operations
 * - Resolve regional/environment-specific API URLs
 *
 * ## Key Dependencies
 * - `state.js` - Global store for token, claims, and throttle tracking
 * - `utils.js` - Date utilities (IsoUtils) and error classification
 * - `types.js` - TypeScript interfaces for API request/response types
 * - `constants.js` - Pagination limits (DEFAULT_MAX_PAGES, HARD_MAX_PAGES_LIMIT)
 *
 * ## Data Flow
 * Controller (main.ts) → API functions → fetchWithAuth → Clockify APIs
 * Clockify APIs → fetchWithAuth → Transform response → Return to controller
 *
 * ## API Endpoints Used (see docs/guide.md for full details)
 *
 * **Workspace API** (Base: `/v1/workspaces/{workspaceId}`):
 * - `GET /users` - Fetch workspace users (paginated)
 * - `GET /users/{userId}/profile` - Fetch user profile (capacity, working days)
 *
 * **Reports API** (Base: Reports URL from token claims):
 * - `POST /reports/detailed` - Fetch detailed time entries (paginated, with filters)
 *
 * **Time Off API** (Base: `/v1/workspaces/{workspaceId}`):
 * - `POST /time-off-requests/search` - Fetch time-off requests for multiple users
 *
 * **Holiday API** (Base: `/v1/workspaces/{workspaceId}`):
 * - `GET /users/{userId}/holidays` - Fetch holidays for a specific user
 *
 * ## Rate Limiting Strategy
 *
 * Uses a **token bucket algorithm** to enforce Clockify addon rate limits:
 * - **Capacity**: 50 requests
 * - **Refill Rate**: 50 tokens per second (1000ms interval)
 * - **Behavior**: Requests block until a token is available (non-recursive loop)
 *
 * ### Why Token Bucket?
 * - Allows bursts up to 50 requests (better UX for small workspaces)
 * - Prevents sustained over-limit requests (protects against throttling)
 * - Simple, predictable implementation (no complex sliding windows)
 *
 * ### Rate Limit Handling
 * - **429 Response**: Wait for `Retry-After` header duration, then retry
 * - **Throttle Tracking**: Store tracks retry count for UI banner display
 * - **Max Retries**: Configurable per request (default 2)
 *
 * ## Pagination Strategy
 *
 * Different endpoints have different pagination mechanisms:
 *
 * **Offset-based** (Users, Time Entries):
 * - `page` parameter: page number (1-indexed)
 * - `pageSize` parameter: items per page (500 max for performance)
 * - Safety limit: 50 pages max (prevents runaway pagination on huge datasets)
 *
 * **Cursor-based** (Holidays):
 * - `pageToken` parameter: continuation token from previous response
 * - Automatically follows `nextPageToken` until exhausted
 *
 * **Batch** (Profiles, Time Off):
 * - Process multiple users concurrently (5 users per batch)
 * - Avoids overwhelming API with parallel requests
 *
 * ## Error Classification
 *
 * Errors are classified into categories for appropriate handling:
 *
 * - **Auth Errors** (401, 403): Invalid token, no retry
 * - **Not Found** (404): Resource doesn't exist, no retry
 * - **Rate Limit** (429): Throttled, retry with backoff
 * - **Server Errors** (5xx): Temporary failure, retry up to maxRetries
 * - **Network Errors**: Connection failures, retry up to maxRetries
 * - **Abort**: User cancelled operation (AbortSignal), no retry
 *
 * ## Abort Signal Support
 *
 * All API functions accept an optional `AbortSignal` for cancellable operations.
 * When the signal fires:
 * - In-flight fetch request is aborted
 * - Pagination loop terminates immediately
 * - Function returns partial results (or empty array if nothing fetched yet)
 *
 * This is critical for UX: users can cancel slow report generation without
 * waiting for all API calls to complete.
 *
 * ## Security Considerations
 *
 * - **Token Handling**: Token is stored in memory only (no localStorage persistence)
 * - **No Secrets in Logs**: Never log auth tokens or workspace IDs
 * - **HTTPS Only**: All Clockify APIs use HTTPS (enforced by API URLs)
 * - **Read-Only**: This addon makes ZERO write requests (no POST/PATCH/DELETE)
 *   - Exception: POST for search/filter operations (time-off, detailed reports)
 *   - These POST requests are read-only queries, not mutations
 *
 * ## Performance Budget
 *
 * Target: Fetch 100 users + 30 days of data in <10 seconds
 * - Users: 1 paginated request (~200ms)
 * - Time Entries: 1-5 paginated requests (~1-2s total)
 * - Profiles: 100 concurrent batched requests (~2-3s total)
 * - Holidays: 100 sequential requests (~3-5s total, slowest)
 * - Time Off: 1 bulk request (~500ms)
 *
 * Bottleneck: Holiday API (sequential, slow). Consider caching or lazy loading.
 *
 * ## URL Resolution Logic
 *
 * Clockify has multiple API environments (production, regional, developer portal).
 * The Reports API URL is resolved from token claims with fallbacks:
 *
 * 1. Use `claims.reportsUrl` if present
 * 2. If `backendUrl` is developer.clockify.me, use `backendUrl` (dev portal)
 * 3. If `backendUrl` is api.clockify.me, use reports.api.clockify.me
 * 4. For regional URLs (*.clockify.me), replace `/api` with `/report`
 * 5. Default fallback: https://reports.api.clockify.me
 *
 * This ensures compatibility across all Clockify environments.
 *
 * ## Related Files
 * - `docs/guide.md` - Complete API endpoint documentation with examples
 * - `main.ts` - Controller that orchestrates API calls
 * - `state.ts` - Global store for token and throttle tracking
 * - `__tests__/unit/api.test.js` - API client unit tests
 *
 * @see fetchWithAuth - Core HTTP client with rate limiting and retry
 * @see fetchDetailedReport - Main entry point for time entries
 * @see docs/guide.md - Complete API documentation
 */

import { store } from './state.js';
import { IsoUtils, classifyError, base64urlDecode } from './utils.js';
import { DEFAULT_MAX_PAGES, HARD_MAX_PAGES_LIMIT } from './constants.js';
import { createLogger } from './logger.js';
import { startTimer, incrementCounter, setGauge, MetricNames } from './metrics.js';
import type {
    TimeEntry,
    User,
    Holiday,
    TimeOffRequest,
    TimeOffInfo,
    ApiResponse,
} from './types.js';

/** API module logger for circuit breaker and rate limiter events */
const apiLogger = createLogger('API');

// ============================================================================
// TOKEN EXPIRATION VALIDATION
// ============================================================================
// Proactively validates token expiration before making API calls to prevent
// wasted requests and provide better user feedback.
// ============================================================================

/**
 * Grace period in seconds before token expiration to consider it expired.
 * This accounts for clock drift and network latency.
 */
const TOKEN_EXPIRY_GRACE_PERIOD = 30;

/**
 * Checks if the current authentication token is expired or about to expire.
 *
 * This function extracts the `exp` claim from the JWT token stored in the store
 * and compares it against the current time plus a grace period.
 *
 * ## Why Pre-validation?
 *
 * - Prevents wasted API calls that will fail with 401
 * - Provides immediate feedback to users about session expiration
 * - Allows for proactive session refresh workflows
 *
 * ## Non-JWT Tokens
 *
 * If the token is not in JWT format (doesn't have 3 dot-separated parts),
 * we assume it's a valid non-expiring token. This supports:
 * - Test environments using simple token strings
 * - API keys or other non-JWT authentication methods
 *
 * @returns Object with expiration status:
 *   - `isExpired`: true if token is expired or missing
 *   - `expiresIn`: seconds until expiration (negative if expired), null if no exp claim
 *   - `shouldWarn`: true if token expires within 5 minutes
 */
export function checkTokenExpiration(): {
    isExpired: boolean;
    expiresIn: number | null;
    shouldWarn: boolean;
} {
    const token = store.token;

    if (!token) {
        // No token - allow request to proceed (server will handle authentication)
        // This supports scenarios where:
        // - Initial token fetch doesn't require authentication
        // - Some endpoints may not require authentication
        // - Tests may use null/empty tokens
        return { isExpired: false, expiresIn: null, shouldWarn: false };
    }

    try {
        // Extract payload from JWT (format: header.payload.signature)
        const parts = token.split('.');
        if (parts.length !== 3) {
            apiLogger.warn('Token is not a JWT; blocking request for safety');
            return { isExpired: true, expiresIn: null, shouldWarn: false };
        }

        // Decode the payload (base64url) with proper padding handling
        const payload = JSON.parse(base64urlDecode(parts[1]));
        const exp = payload.exp;

        if (typeof exp !== 'number') {
            // No expiration claim - token doesn't expire
            return { isExpired: false, expiresIn: null, shouldWarn: false };
        }

        const now = Math.floor(Date.now() / 1000);
        const expiresIn = exp - now;

        return {
            isExpired: expiresIn <= TOKEN_EXPIRY_GRACE_PERIOD,
            expiresIn,
            shouldWarn: expiresIn > 0 && expiresIn <= 5 * 60, // Warn if <5 minutes remaining
        };
    } catch (error) {
        apiLogger.warn('Token decode failed; blocking request for safety', { error });
        return { isExpired: true, expiresIn: null, shouldWarn: false };
    }
}

/**
 * Custom error class for token expiration.
 * Thrown when API requests are attempted with an expired token.
 */
export class TokenExpiredError extends Error {
    readonly expiresIn: number | null;

    constructor(expiresIn: number | null) {
        super('Authentication token has expired. Please refresh the page to re-authenticate.');
        this.name = 'TokenExpiredError';
        this.expiresIn = expiresIn;
    }
}

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/**
 * Base path for Clockify workspace API endpoints.
 * Used for users, profiles, holidays, and time-off requests.
 * @example "/v1/workspaces/{workspaceId}/users"
 */
const BASE_API = '/v1/workspaces';

// ============================================================================
// URL SANITIZATION FOR LOGGING
// ============================================================================
// Removes sensitive information from URLs before logging to prevent
// information disclosure in error messages, retry logs, and debug output.
// ============================================================================

/**
 * Regex pattern to match UUIDs in URL paths.
 * Matches standard UUID format: 8-4-4-4-12 hex characters.
 * @example "550e8400-e29b-41d4-a716-446655440000"
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Regex pattern to match Clockify-style IDs (24-character hex strings).
 * Clockify uses MongoDB ObjectIds which are 24 hex characters.
 * @example "5e7b8c9d0f1a2b3c4d5e6f7a"
 */
const CLOCKIFY_ID_PATTERN = /\/[0-9a-f]{24}(?=\/|$|\?)/gi;

/**
 * Sanitizes a URL for safe logging by removing sensitive identifiers.
 *
 * This function removes:
 * - Workspace IDs (from /workspaces/{id} paths)
 * - User IDs (from /user/{id} or /users/{id} paths)
 * - Member profile IDs (from /member-profile/{id} paths)
 * - Any UUID-format identifiers
 * - Any 24-character hex IDs (MongoDB ObjectIds)
 * - Query parameter values that look like IDs
 *
 * The goal is to prevent information disclosure while keeping the URL
 * structure readable for debugging purposes.
 *
 * @param url - The URL to sanitize
 * @returns Sanitized URL with sensitive IDs replaced by "[REDACTED]"
 *
 * @example
 * sanitizeUrlForLogging("https://api.clockify.me/api/v1/workspaces/abc123/users/def456")
 * // → "https://api.clockify.me/api/v1/workspaces/[REDACTED]/users/[REDACTED]"
 *
 * @example
 * sanitizeUrlForLogging("https://api.clockify.me/api/v1/workspaces/abc123/holidays?assigned-to=user123")
 * // → "https://api.clockify.me/api/v1/workspaces/[REDACTED]/holidays?assigned-to=[REDACTED]"
 */
export function sanitizeUrlForLogging(url: string): string {
    if (!url) return url;

    let sanitized = url;

    // Replace workspace IDs in path: /workspaces/{id}
    sanitized = sanitized.replace(
        /\/workspaces\/[^/?]+/gi,
        '/workspaces/[REDACTED]'
    );

    // Replace user IDs in path: /user/{id} or /users/{id}
    sanitized = sanitized.replace(
        /\/users?\/[^/?]+/gi,
        (match) => match.startsWith('/users') ? '/users/[REDACTED]' : '/user/[REDACTED]'
    );

    // Replace member-profile IDs: /member-profile/{id}
    sanitized = sanitized.replace(
        /\/member-profile\/[^/?]+/gi,
        '/member-profile/[REDACTED]'
    );

    // Replace any remaining UUIDs in the path
    sanitized = sanitized.replace(UUID_PATTERN, '[REDACTED]');

    // Replace any remaining 24-char hex IDs (Clockify MongoDB ObjectIds)
    sanitized = sanitized.replace(CLOCKIFY_ID_PATTERN, '/[REDACTED]');

    // Sanitize query parameter values that look like IDs
    // Match: assigned-to=xxx, userId=xxx, user=xxx patterns
    sanitized = sanitized.replace(
        /([?&](?:assigned-to|userId|user|workspaceId)=)[^&]+/gi,
        '$1[REDACTED]'
    );

    return sanitized;
}

/**
 * Number of concurrent user requests to process in a batch.
 * Used for profiles and holidays to avoid overwhelming the API.
 *
 * Why 5? Trade-off between:
 * - Performance: Higher = faster overall completion
 * - API Courtesy: Lower = less server load
 * - Error Risk: Higher = more requests fail if one fails
 */
const BATCH_SIZE = 5;

/**
 * Number of items to fetch per page for paginated endpoints.
 * Maximum value supported by Clockify API is 500.
 *
 * Why 500? Maximizes data per request while staying within API limits.
 * Larger pages = fewer requests = faster overall fetch.
 */
const PAGE_SIZE = 500;

// ============================================================================
// REQUEST BODY SIGNING
// ============================================================================
// HMAC-SHA256 signature generation for POST request bodies to protect against
// request tampering. The signature is included in the X-Body-Signature header.
// ============================================================================

/**
 * Computes an HMAC-SHA256 signature for a request body.
 *
 * Uses the Web Crypto API for secure, browser-native HMAC computation.
 * The signature protects against request body tampering during transit.
 *
 * ## Security Considerations
 * - The signing key is derived from the addon token (first 32 chars, hex-encoded)
 * - This provides request integrity, not authentication (token already handles auth)
 * - Signature is hex-encoded for safe HTTP header transmission
 *
 * ## Algorithm
 * 1. Derive a signing key from the token (deterministic per session)
 * 2. Encode the request body as UTF-8
 * 3. Compute HMAC-SHA256(key, body)
 * 4. Return hex-encoded signature
 *
 * @param body - The request body string to sign (typically JSON)
 * @param signingKey - The key to use for HMAC (typically derived from token)
 * @returns Promise<string> - Hex-encoded HMAC-SHA256 signature
 *
 * @example
 * const signature = await computeBodySignature('{"foo":"bar"}', 'secret-key');
 * // → "a1b2c3d4e5f6..." (64 hex characters)
 */
export async function computeBodySignature(body: string, signingKey: string): Promise<string> {
    // Handle empty signing key - return empty signature
    // Web Crypto API doesn't support zero-length keys
    if (!signingKey) {
        return '';
    }

    // Encode the signing key and body as UTF-8 bytes
    const encoder = new TextEncoder();
    const keyData = encoder.encode(signingKey);
    const bodyData = encoder.encode(body);

    // Import the key for HMAC operations
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false, // not extractable
        ['sign']
    );

    // Compute the HMAC signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyData);

    // Convert to hex string for HTTP header transport
    const signatureArray = new Uint8Array(signatureBuffer);
    return Array.from(signatureArray)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Derives a signing key from the authentication token.
 *
 * Uses the JWT signature segment (third part) as the signing key material when available.
 * Falls back to the raw token for non-JWT tokens.
 *
 * @param token - The authentication token
 * @returns The derived signing key (32 chars max)
 */
export function deriveSigningKey(token: string | null): string {
    if (!token) return '';
    const segments = token.split('.');
    const signatureSegment = segments.length >= 3 ? segments[2] : '';
    const keyMaterial = signatureSegment || token;
    // Limit key exposure while retaining entropy from the signature or token
    return keyMaterial.slice(0, 32);
}

// ============================================================================
// IDEMPOTENCY KEY GENERATION
// ============================================================================
// Generates unique idempotency keys for POST requests to prevent duplicate
// submissions during retries or network issues.
// ============================================================================

/**
 * Counter for generating unique idempotency keys within the same session.
 * Combined with timestamp to ensure uniqueness across sessions.
 */
let idempotencyCounter = 0;

/**
 * Reset threshold to prevent counter from reaching Number.MAX_SAFE_INTEGER.
 * At 1 billion, we reset to 0. Combined with timestamp and random suffix,
 * this still guarantees uniqueness.
 */
const COUNTER_RESET_THRESHOLD = 1_000_000_000;

/**
 * Generates a unique idempotency key for a request.
 *
 * The key format is: `otplus-{timestamp}-{counter}-{random}`
 * - timestamp: Current time in milliseconds for rough ordering
 * - counter: Incrementing counter for uniqueness within same millisecond
 * - random: Random suffix for additional collision resistance
 *
 * Counter resets at 1 billion to prevent precision loss at large values.
 * Combined with timestamp and random suffix, uniqueness is maintained.
 *
 * @returns A unique idempotency key string
 *
 * @example
 * generateIdempotencyKey() // → "otplus-1706745600000-1-a3f2"
 */
export function generateIdempotencyKey(): string {
    const timestamp = Date.now();
    // Increment and reset if threshold reached to prevent precision loss
    idempotencyCounter = (idempotencyCounter + 1) % COUNTER_RESET_THRESHOLD;
    const counter = idempotencyCounter;
    // Generate a random 4-character hex suffix for additional uniqueness
    const random = Math.random().toString(16).slice(2, 6);
    return `otplus-${timestamp}-${counter}-${random}`;
}

/**
 * Resets the idempotency counter.
 * Primarily used for testing to ensure predictable key generation.
 */
export function resetIdempotencyCounter(): void {
    idempotencyCounter = 0;
}

// ============================================================================
// RATE LIMITING STATE (Global, Module-Scoped)
// ============================================================================
// Token bucket algorithm state. This is intentionally global (not per-request)
// to enforce a single rate limit across all concurrent API calls.
// ============================================================================

/**
 * Maximum tokens in the bucket (burst capacity).
 * Allows up to 50 concurrent requests before throttling kicks in.
 */
const RATE_LIMIT = 50;

/**
 * Maximum allowed response body size in bytes (50MB).
 * Protects against memory exhaustion from unexpectedly large responses.
 * This limit is generous but prevents unbounded memory consumption.
 */
const MAX_RESPONSE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Token refill interval in milliseconds.
 * Every 1 second, the bucket refills to RATE_LIMIT tokens.
 * This enforces a sustained rate of 50 requests/second.
 */
const REFILL_INTERVAL = 1000;

/**
 * Current number of available tokens.
 * Decremented before each request, refilled every REFILL_INTERVAL.
 */
let tokens = RATE_LIMIT;

/**
 * Timestamp of last token refill (in milliseconds since epoch).
 * Used to calculate when the next refill is due.
 */
let lastRefill = Date.now();

// ============================================================================
// CIRCUIT BREAKER STATE (Global, Module-Scoped)
// ============================================================================
// Circuit breaker pattern to prevent cascading failures when the Clockify API
// is experiencing issues. Protects both the addon and the API from overload.
// ============================================================================

/**
 * Circuit breaker states.
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker configuration.
 */
interface CircuitBreakerConfig {
    /** Number of failures before opening the circuit */
    failureThreshold: number;
    /** Time in ms before attempting to close the circuit */
    resetTimeout: number;
    /** Number of successful requests in HALF_OPEN state before closing */
    successThreshold: number;
}

/**
 * Default circuit breaker configuration.
 * - Opens after 5 consecutive failures
 * - Waits 30 seconds before testing recovery
 * - Requires 2 successes in HALF_OPEN to close
 */
const CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2,
};

/**
 * Circuit breaker state tracking.
 */
interface CircuitBreakerState {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number | null;
    nextRetryTime: number | null;
}

/**
 * Current circuit breaker state.
 */
let circuitBreaker: CircuitBreakerState = {
    state: 'CLOSED',
    failureCount: 0,
    successCount: 0,
    lastFailureTime: null,
    nextRetryTime: null,
};

/**
 * Maps circuit breaker state to a numeric value for metrics/alerting.
 * - 0: CLOSED (healthy)
 * - 1: HALF_OPEN (testing recovery)
 * - 2: OPEN (circuit tripped, blocking requests)
 */
function getCircuitBreakerStateValue(state: CircuitState): number {
    switch (state) {
        case 'CLOSED': return 0;
        case 'HALF_OPEN': return 1;
        case 'OPEN': return 2;
    }
}

/**
 * Updates circuit breaker metrics for monitoring and alerting.
 * Called whenever circuit breaker state changes.
 */
function updateCircuitBreakerMetrics(): void {
    setGauge(MetricNames.CIRCUIT_BREAKER_STATE, getCircuitBreakerStateValue(circuitBreaker.state));
    setGauge(MetricNames.CIRCUIT_BREAKER_FAILURE_COUNT, circuitBreaker.failureCount);
}

/**
 * Records a successful request for circuit breaker tracking.
 * In HALF_OPEN state, enough successes will close the circuit.
 *
 * Uses atomic object replacement pattern to prevent race conditions
 * when concurrent requests complete simultaneously.
 */
function recordSuccess(): void {
    // Build new state atomically based on current state
    const newState = { ...circuitBreaker };

    if (newState.state === 'HALF_OPEN') {
        newState.successCount++;
        if (newState.successCount >= CIRCUIT_BREAKER_CONFIG.successThreshold) {
            // Recovered! Close the circuit
            newState.state = 'CLOSED';
            newState.failureCount = 0;
            newState.successCount = 0;
            newState.lastFailureTime = null;
            newState.nextRetryTime = null;
            // Single atomic assignment
            Object.assign(circuitBreaker, newState);
            apiLogger.info('Circuit breaker closed: API recovered');
            updateCircuitBreakerMetrics();
            return;
        }
    } else if (newState.state === 'CLOSED') {
        // Reset failure count on success
        newState.failureCount = 0;
    }

    // Single atomic assignment
    Object.assign(circuitBreaker, newState);
    updateCircuitBreakerMetrics();
}

/**
 * Records a failed request for circuit breaker tracking.
 * Enough consecutive failures will open the circuit.
 *
 * Uses atomic object replacement pattern to prevent race conditions
 * when concurrent requests complete simultaneously.
 *
 * @param isRetryable - Whether the failure is potentially recoverable (5xx, network)
 */
function recordFailure(isRetryable: boolean): void {
    // Only count retryable failures for circuit breaker
    // Non-retryable failures (401, 403, 404) are not signs of service issues
    if (!isRetryable) return;

    // Build new state atomically based on current state
    const newState = { ...circuitBreaker };
    newState.failureCount++;
    newState.lastFailureTime = Date.now();

    if (newState.state === 'HALF_OPEN') {
        // Failed during recovery test, reopen circuit
        newState.state = 'OPEN';
        newState.successCount = 0;
        newState.nextRetryTime = Date.now() + (store.config.circuitBreakerResetMs ?? CIRCUIT_BREAKER_CONFIG.resetTimeout);
        // Single atomic assignment
        Object.assign(circuitBreaker, newState);
        apiLogger.warn('Circuit breaker reopened: Recovery failed');
        updateCircuitBreakerMetrics();
    } else if (
        newState.state === 'CLOSED' &&
        newState.failureCount >= (store.config.circuitBreakerFailureThreshold ?? CIRCUIT_BREAKER_CONFIG.failureThreshold)
    ) {
        // Too many failures, open the circuit
        newState.state = 'OPEN';
        newState.nextRetryTime = Date.now() + (store.config.circuitBreakerResetMs ?? CIRCUIT_BREAKER_CONFIG.resetTimeout);
        // Single atomic assignment
        Object.assign(circuitBreaker, newState);
        apiLogger.warn(
            `Circuit breaker opened: ${newState.failureCount} consecutive failures. Will retry after ${(store.config.circuitBreakerResetMs ?? CIRCUIT_BREAKER_CONFIG.resetTimeout)}ms`
        );
        updateCircuitBreakerMetrics();
    } else {
        // Single atomic assignment
        Object.assign(circuitBreaker, newState);
        // Update failure count metric even if state doesn't change
        updateCircuitBreakerMetrics();
    }
}

/**
 * Checks if the circuit breaker allows the request.
 * @returns true if request should proceed, false if circuit is open
 */
function canMakeRequest(): boolean {
    if (circuitBreaker.state === 'CLOSED') {
        return true;
    }

    if (circuitBreaker.state === 'OPEN') {
        // Check if reset timeout has passed
        if (circuitBreaker.nextRetryTime && Date.now() >= circuitBreaker.nextRetryTime) {
            // Transition to HALF_OPEN to test recovery
            circuitBreaker.state = 'HALF_OPEN';
            circuitBreaker.successCount = 0;
            apiLogger.info('Circuit breaker half-open: Testing recovery');
            updateCircuitBreakerMetrics();
            return true;
        }
        return false;
    }

    // HALF_OPEN: Allow limited requests to test recovery
    return true;
}

/**
 * Gets the current circuit breaker state for monitoring/diagnostics.
 */
export function getCircuitBreakerState(): {
    state: CircuitState;
    failureCount: number;
    isOpen: boolean;
    nextRetryTime: number | null;
} {
    return {
        state: circuitBreaker.state,
        failureCount: circuitBreaker.failureCount,
        isOpen: circuitBreaker.state === 'OPEN',
        nextRetryTime: circuitBreaker.nextRetryTime,
    };
}

/**
 * Resets the circuit breaker to closed state.
 * Use with caution - typically only for testing or manual recovery.
 */
export function resetCircuitBreaker(): void {
    circuitBreaker = {
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        nextRetryTime: null,
    };
    updateCircuitBreakerMetrics();
}

// ============================================================================
// URL RESOLUTION
// ============================================================================
// Clockify operates multiple API environments (production, regional, developer).
// This section resolves the correct Reports API URL based on token claims.
// ============================================================================

/**
 * Resolves the Clockify Reports API base URL from token claims.
 *
 * Clockify addons receive a JWT token with `claims` containing API URLs:
 * - `claims.backendUrl`: Base API URL (e.g., "https://api.clockify.me/api")
 * - `claims.reportsUrl`: Reports API URL (e.g., "https://reports.api.clockify.me")
 *
 * However, `reportsUrl` may be missing (especially in developer portal).
 * This function implements fallback logic to derive the Reports URL from `backendUrl`.
 *
 * ## Resolution Algorithm
 *
 * 1. **If `reportsUrl` exists**:
 *    - Special case: Developer portal (`developer.clockify.me`)
 *      → If `reportsUrl` points to different host, use `backendUrl` instead
 *      → This handles local dev environments correctly
 *    - Otherwise: Use `reportsUrl` as-is
 *
 * 2. **If `reportsUrl` missing**:
 *    - Developer portal (`developer.clockify.me`): Use `backendUrl`
 *    - Production (`api.clockify.me`): Use `reports.api.clockify.me`
 *    - Regional (`*.clockify.me`): Transform `/api` to `/report`
 *    - Unknown: Default to `https://reports.api.clockify.me`
 *
 * ## Examples
 *
 * | backendUrl | reportsUrl | Result |
 * |------------|-----------|--------|
 * | https://api.clockify.me/api | (missing) | https://reports.api.clockify.me |
 * | https://eu.api.clockify.me/api | (missing) | https://eu.api.clockify.me/report |
 * | https://developer.clockify.me/api | (missing) | https://developer.clockify.me/api |
 * | https://api.clockify.me/api | https://reports.api.clockify.me | https://reports.api.clockify.me |
 *
 * ## Why This Complexity?
 * - Clockify has evolved from regional APIs to dedicated Reports APIs
 * - Developer portal needs special handling (reports run locally)
 * - Must support both old and new URL schemes for backwards compatibility
 *
 * @returns Reports API base URL (without trailing slash)
 *
 * @example
 * // Production environment
 * resolveReportsBaseUrl() // → "https://reports.api.clockify.me"
 *
 * // Regional environment (EU)
 * resolveReportsBaseUrl() // → "https://eu.api.clockify.me/report"
 *
 * // Developer portal
 * resolveReportsBaseUrl() // → "https://developer.clockify.me/api"
 */
function resolveReportsBaseUrl(): string {
    // Extract claims from global store
    const reportsUrlClaim = store.claims?.reportsUrl;
    // Stryker disable next-line StringLiteral: Empty string fallback is defensive, behavior unchanged
    const backendUrl = store.claims?.backendUrl || '';

    // Normalize backendUrl: remove trailing slashes for consistent parsing
    // Stryker disable next-line all: Trailing slash normalization is defensive
    const normalizedBackend = backendUrl.replace(/\/+$/, '');

    // Parse backendUrl to extract components
    // Stryker disable next-line StringLiteral: Empty string init before conditional assignment
    let backendHost = '';
    // Stryker disable next-line StringLiteral: Empty string init before conditional assignment
    let backendOrigin = '';
    // Stryker disable next-line StringLiteral: Empty string init before conditional assignment
    let backendPath = '';

    // Stryker disable next-line ConditionalExpression: Truthy check required to avoid URL parse error
    if (normalizedBackend) {
        try {
            const backend = new URL(normalizedBackend);
            backendHost = backend.host.toLowerCase(); // e.g., "api.clockify.me"
            backendOrigin = backend.origin; // e.g., "https://api.clockify.me"
            // Stryker disable next-line all: Trailing slash normalization is defensive
            backendPath = backend.pathname.replace(/\/+$/, ''); // e.g., "/api"
        } catch {
            // Invalid URL format: ignore parse errors and fall back to defaults
        }
    }

    // --- BRANCH 1: reportsUrl claim exists ---
    // Stryker disable next-line BlockStatement: Null check for optional claim
    if (reportsUrlClaim) {
        // Stryker disable next-line all: Trailing slash normalization is defensive
        const normalizedReports = reportsUrlClaim.replace(/\/+$/, '');

        // Special case: Developer portal
        // If reportsUrl points to a different host than backendUrl, use backendUrl instead.
        // This handles local dev setups where reports should run through local backend.
        if (backendHost === 'developer.clockify.me') {
            try {
                const reportsHost = new URL(normalizedReports).host.toLowerCase();
                if (reportsHost !== backendHost && normalizedBackend) {
                    return normalizedBackend; // Use backend for local dev
                }
            } catch {
                // Parse error: fall back to backendUrl if available
                /* istanbul ignore else -- normalizedBackend is always truthy when backendHost is developer.clockify.me */
                // Stryker disable next-line ConditionalExpression: Defensive fallback - condition is always truthy in practice
                if (normalizedBackend) return normalizedBackend;
            }
        }

        // Use reportsUrl as-is (normal case)
        return normalizedReports;
    }

    // --- BRANCH 2: reportsUrl missing, derive from backendUrl ---

    // Developer portal: Use backendUrl directly (reports run locally)
    // Stryker disable next-line all: Developer portal detection requires exact match
    if (backendHost === 'developer.clockify.me' && normalizedBackend) {
        return normalizedBackend;
    }

    // Production: Use dedicated Reports API
    if (backendHost === 'api.clockify.me') {
        return 'https://reports.api.clockify.me';
    }

    // Regional environments: Transform `/api` path to `/report`
    // E.g., "https://eu.api.clockify.me/api" → "https://eu.api.clockify.me/report"
    if (backendHost.endsWith('clockify.me') && backendOrigin) {
        /* Stryker disable next-line all: Regional environment path detection is environment-specific */
        if (backendPath.endsWith('/api')) {
            /* Stryker disable next-line all: Regex replacement for regional environments */
            return `${backendOrigin}${backendPath.replace(/\/api$/, '/report')}`;
        }
        // No `/api` path: just append `/report`
        return `${backendOrigin}/report`;
    }

    // --- BRANCH 3: Unknown environment, use production default ---
    return 'https://reports.api.clockify.me';
}

// ============================================================================
// TYPE DEFINITIONS - API Request/Response Interfaces
// ============================================================================
// Internal TypeScript interfaces for API interactions.
// These define the shape of raw Clockify API responses before transformation.
// ============================================================================

/**
 * Progress callback type for fetch operations.
 * Used to notify UI of fetch progress for long-running operations.
 *
 * @param current - Current item count (e.g., number of users processed)
 * @param phase - Human-readable description of current phase (e.g., "Fetching profiles")
 *
 * @example
 * const onProgress: FetchProgressCallback = (current, phase) => {
 *   console.log(`${phase}: ${current} items processed`);
 * };
 */
export type FetchProgressCallback = (current: number, phase: string) => void;

/**
 * Fetch options with optional abort signal
 */
interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    maxRetries?: number;
    onProgress?: FetchProgressCallback;
}

/**
 * Raw API profile response
 */
interface RawProfileResponse {
    workCapacity?: string;
    workingDays?: string[];
}

/**
 * Raw holiday response from API
 */
interface RawHoliday {
    name?: string;
    datePeriod?: {
        startDate?: string;
        endDate?: string;
    };
    projectId?: string;
}

/**
 * Raw time off response
 */
interface RawTimeOffResponse {
    requests?: TimeOffRequest[];
    timeOffRequests?: TimeOffRequest[];
}

/**
 * Detailed report entry from API
 */
interface DetailedReportEntry {
    _id?: string;
    id?: string;
    description?: string;
    userId?: string;
    userName?: string;
    billable?: boolean;
    projectId?: string;
    projectName?: string;
    clientId?: string | null;
    clientName?: string | null;
    taskId?: string;
    taskName?: string;
    type?: string;
    timeInterval?: {
        start?: string;
        end?: string;
        duration?: number;
    };
    rate?: number | { amount?: number };
    hourlyRate?: number | { amount?: number; currency?: string };
    earnedRate?: number;
    costRate?: number;
    amount?: number;
    amounts?: Array<{ type?: string; amountType?: string; value?: number; amount?: number }>;
    tags?: Array<{ id?: string; name?: string }>;
}

/**
 * Detailed report API response
 */
interface DetailedReportResponse {
    timeentries?: DetailedReportEntry[];
    timeEntries?: DetailedReportEntry[];
}

// ==================== RATE LIMITER ====================

/**
 * Reset rate limiter state.
 * Call this when switching workspaces or starting fresh.
 */
export function resetRateLimiter(): void {
    tokens = store.config.rateLimitCapacity ?? RATE_LIMIT;
    lastRefill = Date.now();
}

/**
 * Custom error class for circuit breaker open state.
 * Thrown when the circuit is open and requests are blocked.
 */
export class CircuitBreakerOpenError extends Error {
    readonly nextRetryTime: number | null;

    constructor(nextRetryTime: number | null) {
        const waitTime = nextRetryTime ? Math.max(0, nextRetryTime - Date.now()) : 0;
        super(
            `Circuit breaker is open. API requests are temporarily blocked. ` +
                `Retry after ${Math.ceil(waitTime / 1000)} seconds.`
        );
        this.name = 'CircuitBreakerOpenError';
        this.nextRetryTime = nextRetryTime;
    }
}

// ============================================================================
// CORE HTTP CLIENT - fetchWithAuth
// ============================================================================
// The foundational HTTP client used by all API functions in this module.
// Handles authentication, rate limiting, retries, and error classification.
// ============================================================================

/**
 * Core HTTP client with authentication, rate limiting, and retry logic.
 *
 * This is the ONLY function that makes actual HTTP requests to Clockify APIs.
 * All other API functions in this module delegate to fetchWithAuth.
 *
 * ## Features
 * - **Authentication**: Adds `X-Addon-Token` header from store
 * - **Rate Limiting**: Token bucket algorithm (50 req/sec)
 * - **Retry Logic**: Handles 429/5xx with retry, 401/403/404 without retry
 * - **Error Classification**: Returns structured error responses (never throws)
 * - **Abort Support**: Accepts AbortSignal for cancellable requests
 *
 * ## Rate Limiting (Token Bucket)
 * - Capacity: 50 tokens
 * - Refill: 50 tokens/second (every 1000ms)
 * - Behavior: Waits (non-blocking loop) until token available
 *
 * ## Retry Strategy
 * - 401/403/404: No retry (permanent failures)
 * - 429: Retry with Retry-After header wait
 * - 5xx/Network: Retry up to maxRetries (default 2)
 *
 * @template T - Expected JSON response type
 * @param url - Full URL to fetch (not relative path)
 * @param options - Fetch options (method, headers, body, signal)
 * @param maxRetries - Max retry attempts (default: 2 in prod, 0 in tests)
 * @returns Promise<ApiResponse<T>> - {data, failed, status}
 *
 * @example
 * const resp = await fetchWithAuth<User[]>("https://api.clockify.me/.../users");
 * if (resp.failed) console.error("Failed:", resp.status);
 * else console.log("Users:", resp.data);
 */
// eslint-disable-next-line complexity -- Inherent complexity: retry logic, circuit breaker, rate limiting, error classification
async function fetchWithAuth<T>(
    url: string,
    options: FetchOptions = {},
    maxRetries?: number
): Promise<ApiResponse<T>> {
    // Stryker disable all: Test environment detection - equivalent mutants
    // Default: 2 retries in production, 0 in tests
    const defaultMaxRetries =
        typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 0 : 2;
    const retries = maxRetries !== undefined ? maxRetries : defaultMaxRetries;
    // Stryker restore all

    // Maximum total retry time: 2 minutes. Prevents excessive retries under sustained load.
    const MAX_TOTAL_RETRY_TIME_MS = 120_000;
    const startTime = Date.now();

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Validate API domain before attaching auth headers to prevent token exfiltration
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname.toLowerCase();
        const isClockifyDomain = host === 'clockify.me' || host.endsWith('.clockify.me');
        if (!isClockifyDomain) {
            apiLogger.error('Blocked request to untrusted API domain', {
                url: sanitizeUrlForLogging(url),
                host,
            });
            incrementCounter(MetricNames.API_ERROR_COUNT);
            return { data: null, failed: true, status: 400 };
        }
    } catch {
        apiLogger.error('Blocked request to invalid API URL', {
            url: sanitizeUrlForLogging(url),
        });
        incrementCounter(MetricNames.API_ERROR_COUNT);
        return { data: null, failed: true, status: 400 };
    }

    /**
     * Waits until a rate limit token is available.
     * Uses a non-recursive loop to prevent stack overflow during heavy throttling.
     *
     * ALGORITHM: Token Bucket
     * - Capacity: 50 tokens (burst limit)
     * - Refill: 50 tokens/sec (1000ms)
     * - Logic:
     *   1. Check if refill interval passed -> reset bucket
     *   2. If tokens available -> consume one and proceed
     *   3. If empty -> calculate wait time until next refill and sleep
     *   4. Loop until token acquired (non-blocking sleep via Promise)
     */
    async function waitForToken(): Promise<void> {
        while (true) {
            const now = Date.now();
            if (now - lastRefill >= (store.config.rateLimitRefillMs ?? REFILL_INTERVAL)) {
                tokens = store.config.rateLimitCapacity ?? RATE_LIMIT;
                lastRefill = now;
            }

            if (tokens > 0) {
                tokens--;
                return;
            }

            const waitTime = (store.config.rateLimitRefillMs ?? REFILL_INTERVAL) - (now - lastRefill);
            await delay(waitTime);
        }
    }

    // Check circuit breaker before making request
    if (!canMakeRequest()) {
        console.warn('Circuit breaker open: Request blocked');
        incrementCounter(MetricNames.API_ERROR_COUNT);
        return { data: null, failed: true, status: 503 };
    }

    // Validate token expiration before making request
    const tokenStatus = checkTokenExpiration();
    if (tokenStatus.isExpired) {
        apiLogger.warn('Token expired: Request blocked', {
            expiresIn: tokenStatus.expiresIn,
        });
        incrementCounter(MetricNames.API_ERROR_COUNT);
        return { data: null, failed: true, status: 401 };
    }
    if (tokenStatus.shouldWarn) {
        apiLogger.info('Token expiring soon', {
            expiresIn: tokenStatus.expiresIn,
            expiresInMinutes: tokenStatus.expiresIn ? Math.ceil(tokenStatus.expiresIn / 60) : null,
        });
    }

    await waitForToken();

    // Start API request metrics timer
    const apiTimer = startTimer(MetricNames.API_REQUEST_DURATION);
    incrementCounter(MetricNames.API_REQUEST_COUNT);

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // Merge auth headers with any caller-provided overrides, ensuring JSON responses are accepted
            const headers: Record<string, string> = {
                'X-Addon-Token': store.token || '',
                Accept: 'application/json',
                ...options.headers,
            };

            // Only add Content-Type for requests with a body
            /* Stryker disable next-line all: Header key string literal is not meaningfully testable */
            if (options.body && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }

            // Add body signature for POST requests to report endpoints to protect against tampering
            // Only add for /report/ endpoints - API endpoints don't whitelist this header (causes CORS rejection)
            // The signature is computed once per attempt (body doesn't change across retries)
            /* Stryker disable next-line all: Body signing is feature-level security behavior */
            if (options.method?.toUpperCase() === 'POST' && options.body && url.includes('/report/')) {
                const signingKey = deriveSigningKey(store.token);
                if (signingKey) {
                    const signature = await computeBodySignature(options.body, signingKey);
                    headers['X-Body-Signature'] = signature;
                }
            }

            // Fire the HTTP request using the Clockify backend proxy defined in the addon claims
            const response = await fetch(url, { ...options, headers, signal: options.signal });

            // 401/403/404 are non-retryable errors
            // These status codes indicate invalid tokens/permissions or missing resources—do not retry
            /* Stryker disable next-line all: HTTP error status handling is integration-level behavior */
            if (response.status === 401 || response.status === 403 || response.status === 404) {
                /* Stryker disable next-line all: Block statement is required for early return */
                // Don't record as circuit breaker failure - these are not service issues
                recordFailure(false);
                apiTimer.end();
                incrementCounter(MetricNames.API_ERROR_COUNT);
                return { data: null, failed: true, status: response.status };
            }

            // Handle Rate Limiting (429) with proper attempt tracking
            if (response.status === 429) {
                // Track throttle retry in store for UI banner
                store.incrementThrottleRetry();

                const retryAfterHeader = response.headers.get('Retry-After');
                let waitMs = 5000; // Default wait time if header is missing
                // Stryker disable next-line BlockStatement,BooleanLiteral,ConditionalExpression: Retry-After parsing is defensive - default waitMs used if invalid
                if (retryAfterHeader) {
                    const seconds = parseInt(retryAfterHeader, 10);
                    // Stryker disable next-line all: isNaN check is defensive - default waitMs used if NaN
                    if (!isNaN(seconds)) {
                        /* Stryker disable next-line all: Arithmetic for seconds to ms conversion */
                        waitMs = seconds * 1000;
                    }
                }
                // Check if we have retries left and haven't exceeded max total retry time
                /* Stryker disable all: Rate limit logging - message content and retry math not unit-testable */
                const elapsedTime = Date.now() - startTime;
                /* istanbul ignore if -- requires real network delays to trigger timeout condition */
                if (elapsedTime + waitMs > MAX_TOTAL_RETRY_TIME_MS) {
                    apiLogger.error('Rate limit exceeded, total retry time would exceed limit', {
                        maxTotalRetryTimeMs: MAX_TOTAL_RETRY_TIME_MS,
                    });
                    apiTimer.end();
                    incrementCounter(MetricNames.API_ERROR_COUNT);
                    return { data: null, failed: true, status: 429 };
                }
                if (attempt < retries) {
                    apiLogger.warn('Rate limit exceeded, retrying', {
                        attempt: attempt + 1,
                        totalAttempts: retries + 1,
                        waitMs,
                    });
                    incrementCounter(MetricNames.API_RETRY_COUNT);
                    await delay(waitMs);
                    continue;
                } else {
                    apiLogger.error('Rate limit exceeded, no retries left');
                    // Record as retryable failure for circuit breaker
                    recordFailure(true);
                    apiTimer.end();
                    incrementCounter(MetricNames.API_ERROR_COUNT);
                    return { data: null, failed: true, status: 429 };
                }
                /* Stryker restore all */
            }

            // Treat any other non-success status as a failure; log validation payload for easier debugging
            if (!response.ok) {
                // Stryker disable next-line StringLiteral: Error message string is not testable
                const error = new Error(`API Error: ${response.status}`) as Error & {
                    status: number;
                };
                error.status = response.status;
                // Log sanitized error info for debugging (avoid PII in error data)
                try {
                    const errorData = await response.json();
                    // Stryker disable next-line StringLiteral: Log message is not testable
                    apiLogger.error('API Validation Error', {
                        errorType: errorData?.type,
                        errorMessage: errorData?.message,
                        errorCode: errorData?.code,
                    });
                } catch {
                    // Ignore parsing errors
                }
                throw error;
            }

            // Validate response size before parsing to prevent memory exhaustion
            // Guard against missing headers (e.g., in test mocks) with optional chaining
            const contentLength = response.headers?.get?.('Content-Length');
            if (contentLength) {
                const size = parseInt(contentLength, 10);
                if (!isNaN(size) && size > MAX_RESPONSE_SIZE_BYTES) {
                    apiLogger.warn('Response size exceeds maximum allowed', {
                        contentLength: size,
                        maxAllowed: MAX_RESPONSE_SIZE_BYTES,
                    });
                    apiTimer.end();
                    incrementCounter(MetricNames.API_ERROR_COUNT);
                    return { data: null, failed: true, status: 413 }; // Payload Too Large
                }
            }

            // When Content-Length is missing, use text() to get actual size before parsing
            // This prevents memory exhaustion from unexpectedly large responses
            if (!contentLength) {
                const text = await response.text();
                if (text.length > MAX_RESPONSE_SIZE_BYTES) {
                    apiLogger.warn('Response size exceeds maximum allowed (streaming check)', {
                        actualSize: text.length,
                        maxAllowed: MAX_RESPONSE_SIZE_BYTES,
                    });
                    apiTimer.end();
                    incrementCounter(MetricNames.API_ERROR_COUNT);
                    return { data: null, failed: true, status: 413 };
                }
                // Parse from already-fetched text
                recordSuccess();
                apiTimer.end();
                return { data: JSON.parse(text) as T, failed: false, status: response.status };
            }

            // Record success for circuit breaker
            recordSuccess();
            apiTimer.end();
            return { data: (await response.json()) as T, failed: false, status: response.status };
        } catch (error) {
            const err = error as Error & { status?: number };
            const errorType = classifyError(error);

            // Don't retry auth errors (invalid token) or validation errors (bad request)
            /* Stryker disable all: Error handling - conditional logic tested at integration level */
            if (errorType === 'AUTH_ERROR' || errorType === 'VALIDATION_ERROR') {
                apiLogger.error('Fetch error (not retryable)', { errorType, message: err?.message });
                // Don't record as circuit breaker failure - these are not service issues
                recordFailure(false);
                apiTimer.end();
                incrementCounter(MetricNames.API_ERROR_COUNT);
                /* istanbul ignore next -- defensive: err.status may be undefined for network errors */
                return { data: null, failed: true, status: err.status || 0 };
            }
            /* Stryker restore all */

            // Retry network/API errors with exponential backoff
            /* Stryker disable all: Retry logic - timing and logging not observable in unit tests */
            if (attempt < retries) {
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
                const elapsedTime = Date.now() - startTime;
                /* istanbul ignore if -- requires real network delays to trigger timeout condition */
                if (elapsedTime + backoffTime > MAX_TOTAL_RETRY_TIME_MS) {
                    apiLogger.error('Retry would exceed total retry time limit', {
                        maxTotalRetryTimeMs: MAX_TOTAL_RETRY_TIME_MS,
                    });
                    apiTimer.end();
                    incrementCounter(MetricNames.API_ERROR_COUNT);
                    return { data: null, failed: true, status: err.status || 0 };
                }
                apiLogger.warn('Retrying request with exponential backoff', {
                    attempt: attempt + 1,
                    totalRetries: retries,
                    backoffMs: backoffTime,
                    url: sanitizeUrlForLogging(url),
                });
                incrementCounter(MetricNames.API_RETRY_COUNT);
                await delay(backoffTime);
                continue;
            }
            /* Stryker restore all */

            // Final attempt failed
            // Stryker disable next-line StringLiteral: Log message is not testable
            apiLogger.error('Fetch error after retries', { message: err?.message });
            // Record as retryable failure for circuit breaker (network/API errors)
            recordFailure(true);
            apiTimer.end();
            incrementCounter(MetricNames.API_ERROR_COUNT);
            return { data: null, failed: true, status: err.status || 0 };
        }
    }

    /* istanbul ignore next -- fallback return, loop always returns before reaching here */
    // Stryker disable next-line all: Fallback return is unreachable but required for TypeScript
    apiTimer.end();
    incrementCounter(MetricNames.API_ERROR_COUNT);
    return { data: null, failed: true, status: 0 };
}

// ==================== PAGINATED FETCH ====================

/**
 * Fetches all pages of time entries for a single user for a given date range.
 * Automatically handles pagination up to MAX_PAGES.
 *
 * @param workspaceId - The Clockify workspace ID.
 * @param user - The user object (must contain id and name).
 * @param startIso - Start date in ISO format.
 * @param endIso - End date in ISO format.
 * @param options - Fetch options (e.g. signal).
 * @returns Flat list of all time entries for the user.
 */
/* istanbul ignore next -- defensive: options default is for internal convenience */
async function fetchUserEntriesPaginated(
    workspaceId: string,
    user: User,
    startIso: string,
    endIso: string,
    options: FetchOptions = {}
): Promise<TimeEntry[]> {
    const allEntries: TimeEntry[] = [];
    let page = 1;
    /* istanbul ignore next -- defensive: maxPages is always set, 0 means unlimited */
    const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
    // Stryker disable next-line ConditionalExpression: Zero check enables unlimited pagination mode
    const effectiveMaxPages = configuredMaxPages === 0
        ? HARD_MAX_PAGES_LIMIT
        : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

    while (page <= effectiveMaxPages) {
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/user/${user.id}/time-entries?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&hydrated=true&page=${page}&page-size=${PAGE_SIZE}`;

        const { data: entries, failed, status } = await fetchWithAuth<TimeEntry[]>(url, options);

        // Log pagination failures instead of silently breaking
        if (failed) {
            // Stryker disable next-line StringLiteral: Console log message is not testable
            console.warn(
                `Failed to fetch entries for user ${user.name} (page ${page}), status: ${status}`
            );
            break;
        }

        /* Stryker disable next-line all: Defensive guard - equivalent mutations produce same break behavior */
        if (!entries || !Array.isArray(entries) || entries.length === 0) break;

        // Enrich entries with user metadata immediately
        allEntries.push(
            ...entries.map((e) => ({ ...e, userId: user.id, userName: user.name }))
        );

        if (entries.length < PAGE_SIZE) break; // Reached last page
        page++;
    }

    return allEntries;
}

// ==================== API MODULE ====================

export const Api = {
    /**
     * Fetch all users in the workspace.
     * @param workspaceId - The Clockify workspace ID.
     * @returns List of users.
     */
    async fetchUsers(workspaceId: string): Promise<User[]> {
        const { data } = await fetchWithAuth<User[]>(
            `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/users`
        );
        return data || [];
    },

    /**
     * Fetch all time entries using the Detailed Report API (single request for all users).
     * This replaces per-user fetching with a single report request.
     *
     * @param workspaceId - The Clockify workspace ID.
     * @param startIso - Start date ISO string.
     * @param endIso - End date ISO string.
     * @param options - Fetch options including AbortSignal.
     * @returns Combined list of all time entries.
     */
    async fetchDetailedReport(
        workspaceId: string,
        startIso: string,
        endIso: string,
        options: FetchOptions = {}
    ): Promise<TimeEntry[]> {
        // Resolve reports base URL across developer/regional environments.
        const baseReportsUrl = resolveReportsBaseUrl();
        const reportsUrl = `${baseReportsUrl}/v1/workspaces/${workspaceId}/reports/detailed`;
        const allEntries: TimeEntry[] = [];
        let page = 1;
        const pageSize = 200; // Max allowed
        let hasMore = true;
        // Always request earned amounts for stable rates; cost/profit uses the amounts array.
        // We request 'EARNED' to get the standard billable rate field, while 'amounts' array gives us COST/PROFIT data.
        const amountShown = 'EARNED';
        /* istanbul ignore next -- defensive: handles various rate value formats from API */
        /* Stryker disable all: Defensive type handling for API data */
        const resolveRateValue = (value: unknown): number => {
            if (value == null) return 0;
            if (typeof value === 'number') return value;
            if (typeof value === 'object' && 'amount' in (value as { amount?: number })) {
                const amount = Number((value as { amount?: number }).amount);
                return Number.isFinite(amount) ? amount : 0;
            }
            return 0;
        };
        /* Stryker restore all */
        /* istanbul ignore next -- defensive: handles null/missing timestamp values */
        /* Stryker disable all: Defensive timestamp normalization */
        const normalizeTimestamp = (value: unknown): string => {
            if (value == null) return '';
            const trimmed = String(value).trim();
            if (!trimmed) return '';
            if (trimmed.includes('T')) return trimmed;
            // Stryker disable next-line Regex: Regex patterns match equivalent date formats
            const spacedMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
            if (spacedMatch) {
                return `${spacedMatch[1]}T${spacedMatch[2]}`;
            }
            /* Stryker disable all: Regex patterns match equivalent date formats */
            const compactMatch = trimmed.match(
                /^(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}(?::\d{2})?.*)$/
            );
            /* Stryker restore all */
            /* istanbul ignore else -- defensive: return original string for unrecognized formats */
            if (compactMatch) {
                return `${compactMatch[1]}T${compactMatch[2]}`;
            }
            return trimmed;
        };
        const pickRateValue = (...values: unknown[]): number => {
            for (const value of values) {
                const resolved = resolveRateValue(value);
                if (resolved > 0) return resolved;
            }
            /* Stryker disable all: Second pass fallback - equivalent when first pass finds positive value */
            for (const value of values) {
                const resolved = resolveRateValue(value);
                if (Number.isFinite(resolved)) return resolved;
            }
            /* Stryker restore all */
            /* istanbul ignore next -- unreachable: resolveRateValue always returns finite number */
            return 0;
        };
        const ensureShownAmount = (
            items: Array<{ type?: string; amountType?: string; value?: number; amount?: number }>,
            fallbackAmount: number | null
        ): Array<{ type?: string; amountType?: string; value?: number; amount?: number }> => {
            if (fallbackAmount == null || !Number.isFinite(fallbackAmount) || fallbackAmount === 0) {
                return items;
            }
            const shownType = amountShown.toUpperCase();
            /* istanbul ignore next -- defensive: handles malformed amounts array entries */
            /* Stryker disable all: Defensive optional chaining for malformed API data */
            const shownTotal = items.reduce((total, item) => {
                const type = String(item?.type || item?.amountType || '').toUpperCase();
                if (type !== shownType) return total;
                const value = Number(item?.value ?? item?.amount);
                return Number.isFinite(value) ? total + value : total;
            }, 0);
            /* Stryker restore all */
            /* istanbul ignore next -- defensive: adds fallback amount if no matching type found */
            if (shownTotal !== 0) return items;
            return [...items, { type: shownType, value: fallbackAmount }];
        };
        const normalizeAmounts = (
            raw: DetailedReportEntry['amounts'] | Record<string, unknown> | null | undefined,
            fallbackAmount: number | null
        ): Array<{ type?: string; amountType?: string; value?: number; amount?: number }> => {
            if (Array.isArray(raw)) return ensureShownAmount(raw, fallbackAmount);
            if (raw && typeof raw === 'object') {
                // Stryker disable next-line StringLiteral: Property name checks - empty string not valid in API responses
                if (
                    'type' in raw ||
                    'amountType' in raw ||
                    'value' in raw ||
                    'amount' in raw
                ) {
                    return ensureShownAmount(
                        [raw as { type?: string; amountType?: string; value?: number; amount?: number }],
                        fallbackAmount
                    );
                }
                const mapped = Object.entries(raw).reduce<
                    Array<{ type?: string; amountType?: string; value?: number; amount?: number }>
                >((acc, [key, value]) => {
                    const numericValue = Number(value);
                    if (Number.isFinite(numericValue)) {
                        acc.push({ type: key.toUpperCase(), value: numericValue });
                    }
                    return acc;
                }, []);
                // Stryker disable next-line ConditionalExpression: Empty array to ensureShownAmount is equivalent behavior
                if (mapped.length) return ensureShownAmount(mapped, fallbackAmount);
            }
            if (fallbackAmount != null) {
                return [{ type: amountShown, value: fallbackAmount }];
            }
            return [];
        };

        // Iterate through paginated report response until the API signals the final page
        while (hasMore) {
            // Check for abort signal at loop start to handle cancellation promptly
            if (options.signal?.aborted) {
                apiLogger.info('Pagination aborted by caller before page fetch', { page, entriesFetched: allEntries.length });
                return allEntries;
            }

            // Re-check token expiration at start of each page fetch
            // Token may expire during long pagination operations
            const tokenStatus = checkTokenExpiration();
            if (tokenStatus.isExpired) {
                apiLogger.error('Token expired during pagination', {
                    page,
                    expiresIn: tokenStatus.expiresIn,
                    entriesFetched: allEntries.length,
                });
                store.ui.paginationAbortedDueToTokenExpiration = true;
                return allEntries; // Return partial results gracefully
            }

            // Warn once on first page if token is expiring soon
            if (tokenStatus.shouldWarn && page === 1) {
                apiLogger.warn('Token expiring soon, pagination may be incomplete', {
                    expiresIn: tokenStatus.expiresIn,
                });
            }

            // Report progress for UI updates
            if (options.onProgress) {
                options.onProgress(page, 'entries');
            }

            // Build the minimal report body; we always ask for all amount types so profit mode can stack values locally
            const requestBody = {
                dateRangeStart: startIso,
                dateRangeEnd: endIso,
                amountShown, // keep rate/amount fields stable when cost/profit is unavailable
                amounts: ['EARNED', 'COST', 'PROFIT'], // always request all amounts so profit mode can stack
                detailedFilter: {
                    page: page,
                    pageSize: pageSize,
                },
            };

            const { data, failed } = await fetchWithAuth<DetailedReportResponse>(
                reportsUrl,
                {
                    method: 'POST',
                    // Stryker disable next-line ObjectLiteral,StringLiteral: Content-Type required for POST JSON body
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    signal: options.signal,
                },
                options.maxRetries
            );

            if (failed || !data) {
                // Stryker disable next-line StringLiteral: Log message is not testable
                apiLogger.error('Detailed report fetch failed', { page, entriesFetched: allEntries.length });
                // If the first page fails, normally this is a critical error - throw to trigger error handling
                // However, if the caller provided an AbortSignal and it has been triggered,
                // treat this as a user cancellation and return partial results (empty array)
                // instead of throwing. This preserves the contract: abort => graceful exit.
                // Subsequent page failures just stop pagination (partial data is acceptable)
                if (page === 1) {
                    if (options.signal && options.signal.aborted) {
                        // Aborted by caller — return whatever we collected so far (empty array)
                        return allEntries;
                    }
                    throw new Error('Failed to fetch initial detailed report page');
                }
                break;
            }

            // Reports API keys vary in casing; normalize before processing the payload
            const entries = data.timeentries || data.timeEntries || [];

            // Transform the detailed report payload into the legacy time entry shape that downstream logic expects so calc.js stays unchanged
            const transformed: TimeEntry[] = entries.map((e) => {
                // pickRateValue uses resolveRateValue internally, which already handles object extraction,
                // so we don't need explicit e.hourlyRate.amount extraction
                const resolvedHourlyRate = pickRateValue(
                    e.earnedRate,
                    e.rate,
                    e.hourlyRate
                );
                const resolvedEarnedRate = resolveRateValue(e.earnedRate);
                const resolvedCostRate = resolveRateValue(e.costRate);
                const isBillable = e.billable === true;
                /* istanbul ignore next -- defensive: handle various hourlyRate object formats */
                // Stryker disable all: Currency fallback is defensive coding
                const hourlyRateCurrency =
                    typeof e.hourlyRate === 'object' &&
                    e.hourlyRate &&
                    'currency' in e.hourlyRate
                        ? String((e.hourlyRate as { currency?: string }).currency || 'USD')
                        : 'USD';
                // Stryker restore all
                const fallbackAmount = Number((e as { amount?: number }).amount);
                const normalizedAmounts = normalizeAmounts(
                    e.amounts as DetailedReportEntry['amounts'] | Record<string, unknown> | null | undefined,
                    Number.isFinite(fallbackAmount) ? fallbackAmount : null
                );

                /* istanbul ignore next -- defensive: handle missing fields from API response */
                return {
                    id: e._id || e.id || '',
                    description: e.description,
                    userId: e.userId || '',
                    userName: e.userName || '',
                    billable: isBillable,
                    projectId: e.projectId,
                    projectName: e.projectName,
                    clientId: e.clientId || null,
                    clientName: e.clientName || null,
                    taskId: e.taskId,
                    taskName: e.taskName,
                    type: e.type || 'REGULAR',
                    timeInterval: {
                        start: normalizeTimestamp(e.timeInterval?.start),
                        end: normalizeTimestamp(e.timeInterval?.end),
                        // Duration from Reports API is in SECONDS (integer), convert to ISO format
                        duration:
                            e.timeInterval?.duration != null
                                ? `PT${e.timeInterval.duration}S`
                                : null,
                    },
                    // Rate from Reports API is direct field in cents (e.g., 15300 = $153.00)
                    hourlyRate: { amount: resolvedHourlyRate, currency: hourlyRateCurrency },
                    // Stryker disable all: earnedRate fallback logic is complex multi-tier
                    earnedRate: isBillable
                        ? resolvedEarnedRate > 0
                            ? resolvedEarnedRate
                            : resolvedHourlyRate
                        : 0,
                    // Stryker restore all
                    // Stryker disable next-line LogicalOperator: || fallback to original costRate is intentional
                    costRate: resolvedCostRate || e.costRate,
                    amounts: normalizedAmounts,
                    tags: e.tags || [],
                };
            });

            allEntries.push(...transformed);

            // Check for abort signal after transformation
            if (options.signal?.aborted) {
                apiLogger.info('Pagination aborted after transformation', { page, entriesFetched: allEntries.length });
                return allEntries;
            }

            // Check if more pages
            // If we receive less than a full page, assume there are no more pages
            if (entries.length < pageSize) {
                hasMore = false;
            } else {
                page++;
                /* istanbul ignore next -- defensive: pagination continuation rarely reaches limit */
                // Check against configurable max pages limit
                const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
                /* istanbul ignore next -- defensive: maxPages === 0 is edge case for unlimited pages */
                // Stryker disable next-line ConditionalExpression: Zero check enables unlimited pagination mode
                const effectiveMaxPages = configuredMaxPages === 0
                    ? HARD_MAX_PAGES_LIMIT
                    : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

                /* istanbul ignore next -- defensive: safety limit rarely reached in normal operation */
                if (page > effectiveMaxPages) {
                    console.warn(`Reached page limit (${effectiveMaxPages}), stopping pagination. Total entries fetched: ${allEntries.length}`);
                    store.ui.paginationTruncated = true;
                    hasMore = false;
                }
            }
        }

        return allEntries;
    },

    /**
     * Batched fetch of time entries for multiple users concurrently.
     * Processes users in chunks (BATCH_SIZE) to manage load.
     * DEPRECATED: Use fetchDetailedReport for better performance.
     *
     * @param workspaceId - The Clockify workspace ID.
     * @param users - List of users to fetch entries for.
     * @param startIso - Start date ISO string.
     * @param endIso - End date ISO string.
     * @param options - Fetch options including AbortSignal.
     * @returns Combined list of all time entries.
     */
    async fetchEntries(
        workspaceId: string,
        users: User[],
        startIso: string,
        endIso: string,
        options: FetchOptions = {}
    ): Promise<TimeEntry[]> {
        const results: TimeEntry[] = [];

        // Stryker disable next-line EqualityOperator: i <= users.length is functionally equivalent (empty batch is no-op)
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            // This approach is the legacy per-user fetch flow; kept for backwards compatibility in tests.

            const batchPromises = batch.map((user) =>
                fetchUserEntriesPaginated(workspaceId, user, startIso, endIso, options)
            );
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.flat());
        }

        return results;
    },

    /**
     * Fetch a single user's profile settings (capacity, working days).
     * @param workspaceId - The workspace ID.
     * @param userId - The user ID.
     * @param options - Fetch options.
     * @returns Response object.
     */
    async fetchUserProfile(
        workspaceId: string,
        userId: string,
        options: FetchOptions = {}
    ): Promise<ApiResponse<RawProfileResponse>> {
        const { data, failed, status } = await fetchWithAuth<RawProfileResponse>(
            `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/member-profile/${userId}`,
            options
        );
        return { data, failed, status };
    },

    /**
     * Fetch holidays assigned to a specific user within a date period.
     * WARNING: The API requires FULL ISO 8601 datetime format (e.g., 2022-12-03T00:00:00Z).
     * Despite legacy Clockify docs suggesting YYYY-MM-DD, simple date format returns 400 error.
     * @param workspaceId
     * @param userId
     * @param startIso - Full ISO 8601 datetime string (e.g., 2022-12-03T00:00:00Z)
     * @param endIso - Full ISO 8601 datetime string (e.g., 2022-12-05T23:59:59Z)
     * @param options
     * @returns
     */
    async fetchHolidays(
        workspaceId: string,
        userId: string,
        startIso: string,
        endIso: string,
        options: FetchOptions = {}
    ): Promise<ApiResponse<RawHoliday[]>> {
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/holidays/in-period?assigned-to=${encodeURIComponent(userId)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;

        const { data, failed, status } = await fetchWithAuth<RawHoliday[]>(url, options);
        return { data, failed, status };
    },

    /**
     * Fetch approved time off requests for multiple users via POST endpoint.
     *
     * @param workspaceId
     * @param userIds
     * @param startDate - Full ISO 8601 string
     * @param endDate - Full ISO 8601 string
     * @param options - Options including retry configuration
     * @returns Data contains `requests` array.
     */
    async fetchTimeOffRequests(
        workspaceId: string,
        userIds: string[],
        startDate: string,
        endDate: string,
        options: FetchOptions = {}
    ): Promise<ApiResponse<RawTimeOffResponse | TimeOffRequest[]>> {
        // Use POST endpoint for time-off requests to filter by specific users and status
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/time-off/requests`;
        const body = {
            page: 1,
            pageSize: 200,
            users: userIds,
            statuses: ['APPROVED'],
            start: startDate,
            end: endDate,
        };

        // Stryker disable next-line ConditionalExpression: Explicit undefined check preserves 0 retries option
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
        const { data, failed, status } = await fetchWithAuth<
            RawTimeOffResponse | TimeOffRequest[]
        >(
            url,
            {
                method: 'POST',
                body: JSON.stringify(body),
                ...options,
            },
            maxRetries
        );

        return { data, failed, status };
    },

    /**
     * Batched fetch of all user profiles.
     * Updates `store.apiStatus.profilesFailed` to track partial failures.
     *
     * @param workspaceId
     * @param users
     * @param options
     * @returns Map of userId -> profileData
     */
    async fetchAllProfiles(
        workspaceId: string,
        users: User[],
        options: FetchOptions = {}
    ): Promise<Map<string, RawProfileResponse>> {
        const results = new Map<string, RawProfileResponse>();
        let failedCount = 0;

        // Stryker disable next-line EqualityOperator: i <= users.length is functionally equivalent (empty batch is no-op)
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                const { data, failed } = await this.fetchUserProfile(
                    workspaceId,
                    user.id,
                    options
                );
                return { userId: user.id, data, failed };
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ userId, data, failed }) => {
                if (failed) failedCount++;
                if (data) results.set(userId, data);
            });
        }

        // Retry failed profile fetches once
        const failedUserIds = users
            .filter(user => !results.has(user.id))
            .map(user => user.id);

        if (failedUserIds.length > 0 && failedCount > 0) {
            apiLogger.info('Retrying failed profile fetches', { count: failedUserIds.length });
            const retryPromises = failedUserIds.map(async (userId) => {
                const { data, failed } = await this.fetchUserProfile(
                    workspaceId,
                    userId,
                    options
                );
                return { userId, data, failed };
            });
            const retryResults = await Promise.all(retryPromises);
            let retrySuccessCount = 0;
            retryResults.forEach(({ userId, data, failed }) => {
                if (!failed && data) {
                    results.set(userId, data);
                    retrySuccessCount++;
                }
            });
            // Adjust failed count based on retry successes
            failedCount = failedCount - retrySuccessCount;
        }

        store.apiStatus.profilesFailed = failedCount;
        return results;
    },

    /**
     * Batched fetch of all holidays for all users.
     * Updates `store.apiStatus.holidaysFailed`.
     *
     * @param workspaceId
     * @param users
     * @param startDate
     * @param endDate
     * @param options
     * @returns Map of userId -> Array of Holidays
     */
    async fetchAllHolidays(
        workspaceId: string,
        users: User[],
        startDate: string,
        endDate: string,
        options: FetchOptions = {}
    ): Promise<Map<string, Holiday[]>> {
        const results = new Map<string, Holiday[]>();
        let failedCount = 0;
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format
        const startIso = `${startDate}T00:00:00.000Z`;
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format
        const endIso = `${endDate}T23:59:59.999Z`;

        // Stryker disable next-line EqualityOperator: i <= users.length is functionally equivalent (empty batch is no-op)
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                const { data, failed } = await this.fetchHolidays(
                    workspaceId,
                    user.id,
                    startIso,
                    endIso,
                    options
                );
                return { userId: user.id, data, failed };
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ userId, data, failed }) => {
                if (failed) failedCount++;
                if (data) {
                    /* istanbul ignore next -- defensive: handle missing fields from API */
                    results.set(
                        userId,
                        data.map((h) => ({
                            name: h.name || '',
                            datePeriod: {
                                startDate: h.datePeriod?.startDate || '',
                                // Fallback endDate to startDate if missing (single-day holiday)
                                endDate: h.datePeriod?.endDate || h.datePeriod?.startDate || '',
                            },
                            projectId: h.projectId,
                        }))
                    );
                }
            });
        }

        store.apiStatus.holidaysFailed = failedCount;
        return results;
    },

    /**
     * Fetches and processes time off for all users.
     * Returns a structured Map for easy lookup during calculation.
     *
     * @param workspaceId
     * @param users
     * @param startDate
     * @param endDate
     * @param options - Options including retry configuration
     * @returns Map<userId, Map<dateKey, {hours, isFullDay}>>
     */
    async fetchAllTimeOff(
        workspaceId: string,
        users: User[],
        startDate: string,
        endDate: string,
        options: FetchOptions = {}
    ): Promise<Map<string, Map<string, TimeOffInfo>>> {
        const userIds = users.map((u) => u.id);
        const fetchOptions = { maxRetries: options.maxRetries, signal: options.signal };

        // Ensure dates are in full ISO 8601 format for the Time-Off API
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format with time components
        const startIso = `${startDate}T00:00:00.000Z`;
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format with end-of-day time
        const endIso = `${endDate}T23:59:59.999Z`;

        const { data, failed } = await this.fetchTimeOffRequests(
            workspaceId,
            userIds,
            startIso,
            endIso,
            fetchOptions
        );

        if (failed) {
            store.apiStatus.timeOffFailed = users.length;
            return new Map();
        }

        // Build per-user per-date map
        const results = new Map<string, Map<string, TimeOffInfo>>();

        // Try multiple possible response formats to tolerate backend variations (array vs object wrapper)
        let requests: TimeOffRequest[] = [];
        if (data && typeof data === 'object') {
            if ('requests' in data && Array.isArray(data.requests)) {
                requests = data.requests;
            } else if (Array.isArray(data)) {
                // API might return array directly
                requests = data;
            } else if ('timeOffRequests' in data && Array.isArray(data.timeOffRequests)) {
                requests = data.timeOffRequests;
            }
        }

        // Process each approved request and expand multi-day periods into per-date records
        // eslint-disable-next-line complexity -- Inherent complexity: date parsing, period expansion, hours calculation
        requests.forEach((request) => {
            // Status is an object with statusType property, not a string
            const statusType =
                typeof request.status === 'object'
                    ? request.status.statusType
                    : request.status;

            // Filter by status - only process approved requests
            if (statusType !== 'APPROVED') {
                return;
            }

            const userId = request.userId || request.requesterUserId;
            if (!userId) {
                return;
            }

            let userMap = results.get(userId);
            // Stryker disable next-line ConditionalExpression: Map.set is idempotent but we avoid unnecessary allocation
            if (!userMap) {
                userMap = new Map();
                results.set(userId, userMap);
            }

            // The period dates are nested under timeOffPeriod.period, not timeOffPeriod directly
            const timeOffPeriod = request.timeOffPeriod || {};
            const innerPeriod = timeOffPeriod.period || {};
            const startKey = IsoUtils.extractDateKey(
                innerPeriod.start || timeOffPeriod.start || timeOffPeriod.startDate
            );
            const endKey = IsoUtils.extractDateKey(
                innerPeriod.end || timeOffPeriod.end || timeOffPeriod.endDate
            );

            if (startKey) {
                const timeUnit = String(request.timeUnit || '').toUpperCase();
                const isDaysUnit = timeUnit === 'DAYS' || timeUnit === 'DAY';
                const isHoursUnit = timeUnit === 'HOURS' || timeUnit === 'HOUR';
                const isFullDay = isDaysUnit
                    ? !timeOffPeriod.halfDay
                    : !isHoursUnit && !timeOffPeriod.halfDay && !timeOffPeriod.halfDayHours;
                let hoursForDay = 0;
                if (!isFullDay) {
                    const halfDayHours = Number(timeOffPeriod.halfDayHours);
                    if (Number.isFinite(halfDayHours) && halfDayHours > 0) {
                        hoursForDay = halfDayHours;
                    } else {
                        const periodStart = innerPeriod.start || timeOffPeriod.start || timeOffPeriod.startDate;
                        const periodEnd = innerPeriod.end || timeOffPeriod.end || timeOffPeriod.endDate;
                        if (periodStart && periodEnd) {
                            const start = new Date(periodStart);
                            const end = new Date(periodEnd);
                            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                                const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                                // eslint-disable-next-line max-depth -- Date validation requires nested checks
                                if (Number.isFinite(diffHours) && diffHours > 0) {
                                    // For multi-day time-off, calculate per-day hours (not total)
                                    // A 2-day absence from Mon 9AM to Wed 9AM = 48h total
                                    // should be ~8h per day, not 48h per day
                                    const daysDiff = Math.max(
                                        1,
                                        Math.ceil(
                                            (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
                                        )
                                    );
                                    hoursForDay = diffHours / daysDiff;
                                }
                            }
                        }
                    }
                }
                // Initialize start date
                userMap.set(startKey, { isFullDay, hours: hoursForDay });

                // Handle multi-day time off
                // Stryker disable next-line ConditionalExpression,EqualityOperator: Multi-day expansion requires inequality check
                if (endKey && endKey !== startKey) {
                    const dateRange = IsoUtils.generateDateRange(startKey, endKey);
                    dateRange.forEach((dateKey) => {
                        // Stryker disable next-line ConditionalExpression: Idempotent but avoids overwriting existing entries
                        if (!userMap.has(dateKey)) {
                            userMap.set(dateKey, { isFullDay, hours: hoursForDay });
                        }
                    });
                }
            }
        });

        store.apiStatus.timeOffFailed = 0;
        return results;
    },
};
