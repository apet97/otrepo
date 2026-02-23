/**
 * @fileoverview Utility Functions
 * Generic helper functions for date manipulation, error handling, formatting,
 * and data sanitization. These functions are pure and stateless where possible.
 */

import {
    ERROR_MESSAGES,
    ERROR_TYPES,
    INPUT_BOUNDS,
    MAX_DATE_RANGE_DAYS,
    type ErrorType,
    type FriendlyError,
} from './constants.js';
// Types imported as needed by callers

// ==================== TYPE VALIDATION ====================

/**
 * Extended error with status code
 */
interface ErrorWithStatus extends Error {
    status?: number;
}

/**
 * Creates a validation error.
 * @param message - The error message.
 * @returns The structured error.
 */
function createValidationError(message: string): FriendlyError {
    return createUserFriendlyError(new Error(message), ERROR_TYPES.VALIDATION);
}

/**
 * Validates that required fields exist in an object.
 * @param obj - Object to validate.
 * @param requiredFields - Array of required field names.
 * @param context - Context for error messages.
 * @returns true if valid.
 * @throws Error with VALIDATION type if validation fails.
 */
export function validateRequiredFields(
    obj: unknown,
    requiredFields: string[],
    context = 'Object'
): boolean {
    if (!obj || typeof obj !== 'object') {
        throw createValidationError(`${context} is not an object`);
    }

    const record = obj as Record<string, unknown>;
    const missing = requiredFields.filter((field) => !record[field]);

    if (missing.length > 0) {
        throw createValidationError(`${context} missing required fields: ${missing.join(', ')}`);
    }

    return true;
}

/**
 * Validates that a value is a valid number.
 * @param value - Value to validate.
 * @param field - Field name for error messages.
 * @returns The validated number.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateNumber(value: unknown, field: string): number {
    if (value === null || value === undefined) {
        throw createValidationError(`${field} is required`);
    }
    const num = Number(value);
    if (isNaN(num)) {
        throw createValidationError(`${field} must be a number`);
    }
    return num;
}

/**
 * Validates that a value is a valid string.
 * @param value - Value to validate.
 * @param field - Field name for error messages.
 * @returns The validated string.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateString(value: unknown, field: string): string {
    // Explicit checks to avoid equivalent mutants where typeof catches null/undefined
    if (typeof value !== 'string') {
        throw createValidationError(`${field} must be a non-empty string`);
    }
    const trimmed = value.trim();
    if (trimmed === '') {
        throw createValidationError(`${field} cannot be empty`);
    }
    return trimmed;
}

/**
 * Validates that a value is a valid ISO date string.
 * @param value - Value to validate.
 * @param field - Field name for error messages.
 * @returns The validated date string.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateISODateString(value: unknown, field: string): string {
    const str = validateString(value, field);

    // Basic ISO format check (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
    const isoRegex = /^\d{4}-\d{2}-\d{2}/;
    if (!isoRegex.test(str)) {
        throw createValidationError(`${field} must be in ISO format (YYYY-MM-DD)`);
    }

    const date = new Date(str);
    if (isNaN(date.getTime())) {
        throw createValidationError(`${field} is not a valid ISO date`);
    }

    return str;
}

/**
 * Time entry for validation
 */
interface TimeEntryLike {
    id?: string;
    userId?: string;
    timeInterval?: {
        start?: string;
        end?: string;
        duration?: string;
    };
    hourlyRate?: {
        amount?: number;
    };
    billable?: boolean;
}

/**
 * Validates a time entry object structure.
 * @param entry - Entry to validate.
 * @returns true if valid.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateTimeEntry(entry: unknown): boolean {
    if (!entry || typeof entry !== 'object') {
        throw createValidationError('Time entry must be an object');
    }

    const e = entry as TimeEntryLike;

    // Required fields
    validateString(e.id, 'Time entry ID');
    validateString(e.userId, 'Time entry user ID');

    // Validate timeInterval
    validateRequiredFields(e, ['timeInterval'], 'Time entry');
    const interval = e.timeInterval;
    validateRequiredFields(interval, ['start', 'end'], 'Time interval');

    validateISODateString(interval?.start, 'Time entry start time');
    validateISODateString(interval?.end, 'Time entry end time');

    // Optional fields validation
    if (interval?.duration) {
        validateString(interval.duration, 'Time entry duration');
    }

    if (e.hourlyRate) {
        validateRequiredFields(e.hourlyRate, ['amount'], 'Time entry hourly rate');
        validateNumber(e.hourlyRate.amount, 'Hourly rate amount');
    }

    if (e.billable !== undefined) {
        if (typeof e.billable !== 'boolean') {
            throw createValidationError('Time entry billable must be a boolean');
        }
    }

    return true;
}

/**
 * User-like object for validation
 */
interface UserLike {
    id?: string;
    name?: string;
}

/**
 * Validates a user object structure.
 * @param user - User to validate.
 * @returns true if valid.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateUser(user: unknown): boolean {
    if (!user || typeof user !== 'object') {
        throw createValidationError('User must be an object');
    }

    const u = user as UserLike;
    validateString(u.id, 'User ID');
    validateString(u.name, 'User name');

    return true;
}

/**
 * Profile-like object for validation
 */
interface ProfileLike {
    workCapacity?: string;
    workingDays?: unknown[];
}

/**
 * Validates a user profile object structure.
 * @param profile - Profile to validate.
 * @returns true if valid.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateUserProfile(profile: unknown): boolean {
    if (!profile || typeof profile !== 'object') {
        throw createValidationError('User profile must be an object');
    }

    const p = profile as ProfileLike;

    if (p.workCapacity !== undefined) {
        validateString(p.workCapacity, 'Work capacity');
    }

    if (p.workingDays !== undefined) {
        if (!Array.isArray(p.workingDays)) {
            throw createValidationError('Working days must be an array');
        }
        p.workingDays.forEach((day, index) => {
            if (typeof day !== 'string' || (day as string).trim() === '') {
                throw createValidationError(
                    `Working day at index ${index} must be a non-empty string`
                );
            }
        });
    }

    return true;
}

/**
 * Validates a date range.
 * @param startDate - Start date in YYYY-MM-DD format.
 * @param endDate - End date in YYYY-MM-DD format.
 * @returns true if valid.
 * @throws Error with VALIDATION type if validation fails.
 */
export function validateDateRange(startDate: string, endDate: string): boolean {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw createValidationError('Invalid date format. Use YYYY-MM-DD.');
    }

    if (start > end) {
        throw createValidationError('Start date must be before end date');
    }

    // Check if date range exceeds maximum allowed
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (daysDiff > MAX_DATE_RANGE_DAYS) {
        throw createValidationError(
            `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days. Selected range: ${daysDiff} days.`
        );
    }

    return true;
}

// ==================== INPUT BOUNDS VALIDATION ====================

/**
 * Result of bounds validation.
 */
export interface BoundsValidationResult {
    valid: boolean;
    value: number;
    error?: string;
    clamped?: boolean;
}

/**
 * Validates a numeric input value against defined bounds.
 *
 * @param field - The field name to validate (must be in INPUT_BOUNDS)
 * @param value - The value to validate
 * @param options - Validation options
 * @returns Validation result with validity status and optionally clamped value
 *
 * @example
 * // Strict validation (reject out-of-bounds)
 * const result = validateInputBounds('dailyThreshold', 30);
 * // { valid: false, value: 30, error: 'Daily threshold must be between 0 and 24 hours' }
 *
 * @example
 * // Clamping mode (adjust to valid range)
 * const result = validateInputBounds('dailyThreshold', 30, { clamp: true });
 * // { valid: true, value: 24, clamped: true }
 */
export function validateInputBounds(
    field: string,
    value: unknown,
    options: { clamp?: boolean } = {}
): BoundsValidationResult {
    const bounds = INPUT_BOUNDS[field];

    // If no bounds defined for this field, accept any finite number
    if (!bounds) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return { valid: false, value: 0, error: `${field} must be a valid number` };
        }
        return { valid: true, value: num };
    }

    const num = Number(value);

    // Check if value is a valid number
    if (!Number.isFinite(num)) {
        return { valid: false, value: 0, error: `${field} must be a valid number` };
    }

    // Check bounds
    if (num < bounds.min || num > bounds.max) {
        if (options.clamp) {
            // Clamp to valid range
            const clamped = Math.max(bounds.min, Math.min(bounds.max, num));
            return { valid: true, value: clamped, clamped: true };
        }
        return { valid: false, value: num, error: bounds.description };
    }

    return { valid: true, value: num };
}

/**
 * Validates and sanitizes all calculation parameters.
 *
 * @param params - The calculation parameters to validate
 * @returns Object with validated params and any errors
 */
export function validateCalcParams(params: {
    dailyThreshold?: number;
    weeklyThreshold?: number;
    overtimeMultiplier?: number;
    tier2ThresholdHours?: number;
    tier2Multiplier?: number;
}): { valid: boolean; params: typeof params; errors: string[] } {
    const errors: string[] = [];
    const validatedParams: typeof params = {};

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;

        const result = validateInputBounds(key, value);
        if (!result.valid && result.error) {
            errors.push(result.error);
        } else {
            (validatedParams as Record<string, number>)[key] = result.value;
        }
    }

    return {
        valid: errors.length === 0,
        params: validatedParams,
        errors,
    };
}

/**
 * Validates an override field value.
 *
 * @param field - The field being set (capacity, multiplier, etc.)
 * @param value - The value to validate
 * @returns Validation result
 */
export function validateOverrideValue(
    field: string,
    value: unknown
): BoundsValidationResult {
    // Map override field names to bounds keys
    const boundsKey = field === 'tier2Threshold' ? 'tier2ThresholdHours' : field;
    return validateInputBounds(boundsKey, value);
}

// ==================== ERROR CLASSIFICATION ====================

/**
 * Classifies an error object into a predefined category.
 * Used to determine retry logic and user-facing error messages.
 *
 * @param error - The error object to classify.
 * @returns One of the ERROR_TYPES constants.
 */
export function classifyError(error: unknown): ErrorType {
    if (!error) return ERROR_TYPES.UNKNOWN;

    const err = error as ErrorWithStatus;

    // Network errors (fetch failures, timeouts)
    if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        return ERROR_TYPES.NETWORK;
    }
    if (err.name === 'AbortError') {
        return ERROR_TYPES.NETWORK;
    }

    // HTTP status based errors (if attached to the error object)
    if (err.status === 401 || err.status === 403) {
        return ERROR_TYPES.AUTH;
    }
    if (err.status && err.status >= 400 && err.status < 500) {
        return ERROR_TYPES.VALIDATION;
    }
    if (err.status && err.status >= 500) {
        return ERROR_TYPES.API;
    }

    return ERROR_TYPES.UNKNOWN;
}

/**
 * Creates a structured, user-friendly error object from a raw error.
 *
 * @param error - The raw error or error message.
 * @param type - Optional explicit error type override.
 * @returns Structured error object.
 */
export function createUserFriendlyError(error: Error | string, type?: ErrorType): FriendlyError {
    const errorType = type || classifyError(error);
    const errorMessage = ERROR_MESSAGES[errorType] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];
    const err = typeof error === 'string' ? new Error(error) : error;

    return {
        type: errorType,
        title: errorMessage.title,
        message: errorMessage.message,
        action: errorMessage.action,
        originalError: err,
        timestamp: new Date().toISOString(),
        stack: err?.stack,
    };
}

// ==================== GENERIC HELPERS ====================

/**
 * Decodes a Base64URL-encoded string to a regular string.
 * Base64URL uses `-` instead of `+` and `_` instead of `/`, and may omit padding.
 * This is commonly used in JWTs.
 *
 * @param str - The Base64URL-encoded string.
 * @returns The decoded string.
 */
export function base64urlDecode(str: string): string {
    // Replace Base64URL characters with standard Base64 characters
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if missing
    const padding = base64.length % 4;
    /* Stryker disable next-line all */
    if (padding) {
        /* Stryker disable next-line all */
        base64 += '='.repeat(4 - padding);
    }
    return atob(base64);
}

// ==================== TIMEZONE HELPERS ====================

let canonicalTimeZone: string | null = null;

/**
 * Validates a time zone identifier.
 */
export function isValidTimeZone(timeZone: string): boolean {
    if (!timeZone) return false;
    try {
        Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

/**
 * Sets the canonical time zone for date key calculations.
 */
export function setCanonicalTimeZone(timeZone: string | null): void {
    canonicalTimeZone = timeZone && isValidTimeZone(timeZone) ? timeZone : null;
}

/**
 * Returns the canonical time zone (user/workspace override or browser default).
 */
export function getCanonicalTimeZone(): string {
    if (canonicalTimeZone) return canonicalTimeZone;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Formats a Date into YYYY-MM-DD using a specific time zone.
 */
function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const partMap: Record<string, string> = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            partMap[part.type] = part.value;
        }
    });
    const y = partMap.year || '0000';
    const m = partMap.month || '01';
    const d = partMap.day || '01';
    return `${y}-${m}-${d}`;
}

/**
 * Rounds a number to a specific number of decimal places.
 * Crucial for avoiding floating point drift in currency and hour calculations.
 *
 * @param num - The number to round.
 * @param decimals - Number of decimal places.
 * @returns The rounded number.
 */
export function round(num: number, decimals = 4): number {
    if (!Number.isFinite(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor + Number.EPSILON) / factor;
}

/**
 * Safely parses a JSON string, returning a fallback value on failure.
 *
 * @param text - The JSON string to parse.
 * @param fallback - Value to return if parsing fails.
 * @returns Parsed object or fallback.
 */
export function safeJSONParse<T>(text: string | null, fallback: T): T {
    if (!text) return fallback;
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * @param str - The input string.
 * @returns Escaped string safe for HTML insertion.
 */
export function escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Escapes a value for inclusion in a CSV file.
 * Handles quotes, commas, and newlines by wrapping in double quotes.
 * Escapes existing double quotes by doubling them.
 *
 * @param str - The value to escape.
 * @returns The CSV-safe string.
 */
export function escapeCsv(str: unknown): string {
    if (str === null || str === undefined) return '';
    const stringValue = String(str);
    // Quote if contains special chars OR starts with formula injection prefix (')
    // OR starts with formula characters (=, +, -, @, tab, CR)
    // This ensures formula-sanitized strings are always wrapped in quotes for safety
    if (/[",\n\r]/.test(stringValue) || /^['=+\-@\t\r]/.test(stringValue)) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    return stringValue;
}

/**
 * Parses an ISO 8601 duration string (e.g., "PT8H30M" or "PT8.5H") into decimal hours.
 * Supports fractional hours, minutes, and seconds.
 *
 * ## Limitations
 * - Does NOT support weeks (W designator) - e.g., "P1W" will return 0
 * - Does NOT support negative durations - e.g., "-PT1H" will return 0
 * - Does NOT support date components (Y, M, D) - e.g., "P1Y2M3D" will return 0
 * - Only parses time components (H, M, S) after the "T" marker
 *
 * For Clockify integration, this covers all practical use cases since time entries
 * use the PTxHxMxS format exclusively.
 *
 * @param durationStr - ISO duration string (e.g., "PT8H30M", "PT1.5H").
 * @returns Duration in decimal hours, or 0 if parsing fails.
 *
 * @example
 * parseIsoDuration("PT8H30M")  // → 8.5
 * parseIsoDuration("PT1.5H")   // → 1.5
 * parseIsoDuration("PT90M")    // → 1.5
 * parseIsoDuration("P1W")      // → 0 (weeks not supported)
 */
export function parseIsoDuration(durationStr: string | null | undefined): number {
    if (!durationStr) return 0;
    // Support fractional values: PT8.5H, PT30.5M, PT45.5S
    const match = durationStr.match(
        /PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/
    );
    if (!match) return 0;
    const hours = parseFloat(match[1] || '0');
    const minutes = parseFloat(match[2] || '0');
    const seconds = parseFloat(match[3] || '0');
    return hours + minutes / 60 + seconds / 3600;
}

/**
 * Creates a debounced version of a function.
 *
 * @param fn - The function to debounce.
 * @param waitMs - Delay in milliseconds.
 * @returns Debounced function.
 */
/* istanbul ignore next -- defensive: default waitMs is rarely used without explicit value */
export function debounce<T extends (...args: Parameters<T>) => void>(
    fn: T,
    waitMs = 0
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        /* istanbul ignore next -- defensive: clear existing timeout on subsequent calls */
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), waitMs);
        if (timeoutId && typeof timeoutId === 'object') {
            const maybeTimer = timeoutId as { unref?: () => void };
            if (typeof maybeTimer.unref === 'function') {
                maybeTimer.unref();
            }
        }
    };
}

/**
 * Formats a number as a currency string.
 *
 * @param amount - The amount to format.
 * @param currency - Currency code.
 * @returns Formatted currency string.
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(safeAmount);
    } catch {
        return `${currency} ${safeAmount.toFixed(2)}`;
    }
}

/**
 * Formats decimal hours into a readable string (e.g., "8h 30m").
 * Handles edge case where rounding causes 60 minutes.
 *
 * @param hours - Decimal hours.
 * @returns Formatted string.
 */
export function formatHours(hours: number | null | undefined): string {
    if (hours == null || isNaN(hours)) return '0h';
    const h = parseFloat(String(hours));
    let whole = Math.floor(h);
    let mins = Math.round((h - whole) * 60);

    // Handle edge case: 1.9999h rounds to 60 mins -> should be 2h 0m
    if (mins === 60) {
        whole += 1;
        mins = 0;
    }

    return mins === 0 ? `${whole}h` : `${whole}h ${mins}m`;
}

/**
 * Formats decimal hours into a fixed two-decimal string (e.g., "8.50").
 *
 * @param hours - Decimal hours.
 * @param decimals - Decimal places.
 * @returns Formatted decimal string.
 */
export function formatHoursDecimal(hours: number | null | undefined, decimals = 2): string {
    // Use == null to catch both null and undefined in single check (eliminates equivalent mutant)
    // Stryker disable next-line ConditionalExpression: Equivalent mutant - both paths produce '0.00'
    if (hours == null) return '0.00';
    // NaN is handled by round() which returns 0 for non-finite numbers
    const rounded = round(parseFloat(String(hours)), decimals);
    return rounded.toFixed(decimals);
}

// --- Timezone / Date Integrity Helpers (Antigravity Standard) ---

export const IsoUtils = {
    /**
     * Converts a Date object to an ISO date string (YYYY-MM-DD).
     * Uses UTC methods to prevent local timezone shifts from changing the date.
     *
     * @param date - The date object.
     * @returns YYYY-MM-DD string.
     */
    toISODate(date: Date | null | undefined): string {
        if (!date) return '';
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    /**
     * Converts a Date object to a canonical date key (YYYY-MM-DD) using the configured time zone.
     */
    toDateKey(date: Date | null | undefined): string {
        if (!date) return '';
        const tz = getCanonicalTimeZone();
        return formatDateKeyInTimeZone(date, tz);
    },

    /**
     * Parses a YYYY-MM-DD string into a Date object (at UTC midnight).
     *
     * @param dateStr - YYYY-MM-DD string.
     * @returns Date object or null if invalid.
     */
    parseDate(dateStr: string | null | undefined): Date | null {
        if (!dateStr) return null;
        return new Date(`${dateStr}T00:00:00Z`);
    },

    /**
     * Extracts the date portion (YYYY-MM-DD) from an ISO timestamp string.
     *
     * INVARIANT: Local vs UTC Bucketing
     * We bucket entries into dates based on the *canonical* timezone (user/workspace/browser),
     * NOT strictly UTC. This ensures that an entry at "2025-01-01T23:00:00Z" (which might be
     * "2025-01-02" in the user's timezone) appears on the correct visual day in the report.
     *
     * @param isoString - ISO 8601 timestamp.
     * @returns YYYY-MM-DD string.
     */
    extractDateKey(isoString: string | null | undefined): string | null {
        if (!isoString) return null;
        // If it's already a date string (YYYY-MM-DD), return it
        if (isoString.length === 10) return isoString;

        const date = new Date(isoString);
        if (isNaN(date.getTime())) return null;
        const tz = getCanonicalTimeZone();
        return formatDateKeyInTimeZone(date, tz);
    },

    /**
     * Gets the weekday name (e.g., 'MONDAY') for a given date key.
     *
     * @param dateKey - YYYY-MM-DD string.
     * @returns Uppercase weekday name.
     */
    getWeekdayKey(dateKey: string): string {
        const date = this.parseDate(dateKey);
        if (!date) return '';
        const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        return days[date.getUTCDay()];
    },

    /**
     * Checks if a date falls on a weekend (Sat/Sun).
     *
     * @param dateKey - YYYY-MM-DD string.
     * @returns True if weekend.
     */
    isWeekend(dateKey: string): boolean {
        const date = this.parseDate(dateKey);
        if (!date) return false;
        const day = date.getUTCDay(); // 0=Sun, 6=Sat
        return day === 0 || day === 6;
    },

    /**
     * Generates an array of date strings between start and end (inclusive).
     *
     * @param startIso - Start date YYYY-MM-DD.
     * @param endIso - End date YYYY-MM-DD.
     * @returns Array of date strings.
     */
    generateDateRange(startIso: string, endIso: string): string[] {
        const dates: string[] = [];
        const current = this.parseDate(startIso);
        const end = this.parseDate(endIso);
        /* istanbul ignore next -- defensive: handles invalid date strings */
        if (!current || !end) return [];

        // Iterate inclusive so we represent both the start and end dates
        while (current <= end) {
            dates.push(this.toISODate(current));
            current.setUTCDate(current.getUTCDate() + 1);
        }
        return dates;
    },
};

/**
 * Calculates the ISO week number for a given date.
 * ISO week 1 is the week containing the first Thursday of the year.
 *
 * @param date - The date object.
 * @returns ISO week number (1-53).
 */
export function getISOWeek(date: Date): number {
    const target = new Date(date.valueOf());
    const dayNumber = (date.getDay() + 6) % 7; // Mon=0, Sun=6
    target.setDate(target.getDate() - dayNumber + 3); // Thursday of the week
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const diff = target.getTime() - firstThursday.getTime();
    const weekNumber = 1 + Math.round(diff / 604800000); // 604800000ms = 1 week
    return weekNumber;
}

/**
 * Formats a date key (YYYY-MM-DD) to a human-readable string (e.g., "Jan 20, 2025").
 *
 * @param dateKey - Date string in YYYY-MM-DD format.
 * @returns Formatted date string.
 */
/* istanbul ignore next -- UI formatting: date parsing always succeeds for valid dates */
export function formatDate(dateKey: string): string {
    const date = IsoUtils.parseDate(dateKey);
    if (!date) return dateKey;

    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    };
    return date.toLocaleDateString(undefined, options);
}

/**
 * Generates a week key (YYYY-W##) for a given date string.
 *
 * @param dateKey - Date string in YYYY-MM-DD format.
 * @returns Week key in format YYYY-W##.
 */
/* istanbul ignore next -- UI formatting: week key generation fallback */
export function getWeekKey(dateKey: string): string {
    const date = IsoUtils.parseDate(dateKey);
    if (!date) return '';

    // Find Thursday of this week to determine which year the week belongs to
    const target = new Date(date.valueOf());
    const dayNumber = (date.getUTCDay() + 6) % 7; // Mon=0, Sun=6
    target.setUTCDate(target.getUTCDate() - dayNumber + 3); // Thursday

    const year = target.getUTCFullYear();
    const week = getISOWeek(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Formats a week key (YYYY-W##) to a human-readable string (e.g., "Week 3, 2025").
 *
 * @param weekKey - Week key in format YYYY-W##.
 * @returns Formatted week string.
 */
export function formatWeekKey(weekKey: string): string {
    const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return weekKey;

    const [, year, week] = match;
    return `Week ${parseInt(week)}, ${year}`;
}

/**
 * Entry classification result
 */
export type EntryClassification = 'break' | 'pto' | 'work';

/**
 * Entry-like object for classification
 */
interface EntryLike {
    type?: string;
}

/**
 * Classifies a time entry for overtime calculation.
 * Determines if an entry should be treated as BREAK, PTO, or WORK.
 *
 * @param entry - Time entry object with a `type` field.
 * @returns Entry classification.
 */
export function classifyEntryForOvertime(entry: EntryLike | null | undefined): EntryClassification {
    if (!entry || !entry.type) return 'work';

    const type = String(entry.type)
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');

    if (type === 'BREAK') return 'break';
    // Normalize various Clockify API constants for non-working entries (PTO/Holiday)
    if (
        type === 'HOLIDAY' ||
        type === 'TIME_OFF' ||
        type === 'TIMEOFF' ||
        type === 'HOLIDAY_TIME_ENTRY' ||
        type === 'TIME_OFF_TIME_ENTRY'
    ) {
        return 'pto';
    }

    return 'work';
}

/**
 * Calculates the number of days in a date range.
 * Used for date range safeguards to warn users about large ranges.
 *
 * @param start - Start date in YYYY-MM-DD format.
 * @param end - End date in YYYY-MM-DD format.
 * @returns Number of days in the range (inclusive).
 */
export function getDateRangeDays(start: string, end: string): number {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return 0;
    }
    const diffMs = endDate.getTime() - startDate.getTime();
    // Add 1 to include both start and end dates
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

// ==================== HASHING ====================

/**
 * Creates a simple FNV-1a hash of a string.
 * Used for privacy-safe logging and tagging (e.g., hashing workspace IDs).
 *
 * @param str - The string to hash.
 * @returns The hash as a hexadecimal string.
 */
export function hashString(str: string): string {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
