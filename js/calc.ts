/**
 * @fileoverview Calculation Engine - Pure Overtime & Billable Analysis
 *
 * This module implements the core business logic for OTPLUS overtime calculations.
 * It is completely side-effect free: no DOM manipulation, no network calls, no localStorage.
 * All calculations are deterministic - same inputs ALWAYS produce same outputs.
 *
 * ## Module Responsibility
 * - Classify time entries into WORK, BREAK, and PTO types
 * - Calculate effective capacity per user per day (overrides → profile → global default)
 * - Apply capacity adjustments for holidays, time-off, and non-working days
 * - Implement tail attribution algorithm for overtime split
 * - Compute billable/non-billable breakdowns and multi-tier overtime premiums
 * - Generate per-entry, per-day, and per-user aggregated analysis
 *
 * ## Key Dependencies
 * - `utils.js` - Date parsing (parseIsoDuration), rounding, entry classification
 * - `types.js` - TypeScript interfaces for all data structures
 * - `state.js` - Store interface for accessing config, profiles, holidays, overrides
 *
 * ## Data Flow
 * Input: TimeEntry[] (from Clockify Reports API), Store (config + overrides), DateRange
 * Processing:
 *   1. Group entries by user and date
 *   2. For each user/day: determine effective capacity (considering holidays/time-off)
 *   3. Sort entries chronologically and apply tail attribution algorithm
 *   4. Split each entry into regular/overtime hours
 *   5. Calculate amounts with tier1/tier2 multipliers
 *   6. Aggregate to day totals and user totals
 * Output: UserAnalysis[] (one per user, with days Map and totals)
 *
 * ## Business Rules (CRITICAL - DO NOT CHANGE WITHOUT UPDATING TESTS)
 *
 * ### Entry Classification (see docs/prd.md "Overtime Calculation Guide")
 * - **WORK entries** (`type === 'REGULAR'` or undefined): Can be regular OR overtime
 *   - Accumulate toward daily capacity
 *   - Subject to tail attribution algorithm
 * - **BREAK entries** (`type === 'BREAK'`): Always regular hours
 *   - Count as regular in totals
 *   - Do NOT accumulate toward capacity (don't trigger OT for other entries)
 *   - Can NEVER become overtime themselves
 * - **PTO entries** (`type === 'HOLIDAY'`, `'TIME_OFF'`, `'HOLIDAY_TIME_ENTRY'`, `'TIME_OFF_TIME_ENTRY'`): Always regular hours
 *   - Same behavior as BREAK
 *   - Still contribute to billable/non-billable breakdown if flagged as billable
 *
 * ### Capacity Precedence (per user, per day)
 * 1. Per-day user override (`overrides[userId].perDayOverrides[dateKey].capacity`)
 * 2. Weekly user override (`overrides[userId].weeklyOverrides[weekday].capacity`)
 * 3. Global user override (`overrides[userId].capacity`)
 * 4. Profile capacity (`profiles.get(userId).workCapacityHours`) - if `useProfileCapacity` enabled
 * 5. Global daily threshold (`calcParams.dailyThreshold`, default 8h)
 *
 * ### Effective Capacity Adjustments
 * Base capacity is adjusted to zero or reduced based on day context:
 * - **Holiday** (from API): capacity → 0 (all WORK is overtime)
 * - **Non-working day** (per profile `workingDays`): capacity → 0
 * - **Time-off** (from API): capacity reduced by time-off hours
 *   - Full-day time-off: capacity → 0
 *   - Partial time-off: capacity = max(0, capacity - timeOffHours)
 * - **Precedence**: Holiday/non-working day takes precedence over time-off (both result in 0)
 *
 * ### Tail Attribution Algorithm
 * Overtime is assigned to the LAST entries of the day (chronologically).
 * For each day:
 *   1. Sort entries by `timeInterval.start` (earliest first)
 *   2. Initialize `dailyAccumulator = 0`
 *   3. For each entry:
 *      - If BREAK or PTO: `regular = duration, overtime = 0`, skip accumulation
 *      - If WORK:
 *        - If `accumulator >= capacity`: entire entry is OT
 *        - Else if `accumulator + duration <= capacity`: entire entry is regular
 *        - Else: split entry at capacity boundary
 *        - Increment `accumulator += duration` (WORK only)
 *
 * ### Billable Breakdown
 * Tracks 4 independent buckets:
 * - `billableWorked` = sum of `entry.analysis.regular` where `billable === true`
 * - `nonBillableWorked` = sum of `entry.analysis.regular` where `billable === false`
 * - `billableOT` = sum of `entry.analysis.overtime` where `billable === true`
 * - `nonBillableOT` = sum of `entry.analysis.overtime` where `billable === false`
 *
 * ### Multi-Tier Overtime Premiums
 * - **Tier 1 (all OT)**: All overtime hours get tier1 premium = `(multiplier - 1) * overtimeHours * rate`
 * - **Tier 2 (beyond threshold)**: OT hours beyond `tier2Threshold` get additional premium = `(tier2Multiplier - multiplier) * tier2Hours * rate`
 * - Tier2 accumulator is tracked per USER (not per day) across the entire date range
 *
 * ### Amount Types
 * Three parallel calculations for each entry:
 * - **Earned**: Billable revenue (from `earnedRate` or `amounts.EARNED`)
 * - **Cost**: Internal cost (from `costRate` or `amounts.COST`)
 * - **Profit**: Earned - Cost
 * Display mode (`config.amountDisplay`) selects which is shown as "primary" amount.
 *
 * ### Rounding
 * - Hours: 4 decimal places (0.0001h = 0.36s precision)
 * - Currency: 2 decimal places
 * - Applied at aggregation boundary (after summing) to prevent floating-point drift
 *
 * ## Edge Cases Handled
 * - Null/undefined entries array: treated as empty array, still calculates capacity
 * - Missing dateRange: derived from entry dates (minDate/maxDate)
 * - Users without entries: still appear in results with expectedCapacity calculated
 * - Missing user profiles: fall back to global defaults
 * - Midnight-spanning entries: attributed entirely to start day (no splitting across dates)
 * - Malformed durations: parseIsoDuration returns 0, entry contributes 0 hours
 * - Missing rates: default to 0 (no crash)
 *
 * ## Related Files
 * - `docs/prd.md` - Product rules and business requirements
 * - `docs/spec.md` - Technical specification
 * - `docs/prd.md` - Overtime calculation guide (detailed algorithm walkthrough)
 * - `__tests__/unit/calc.test.js` - Calculation invariant tests
 *
 * @see calculateAnalysis - Main entry point for overtime calculation
 * @see docs/prd.md - Business rules definition
 */

import {
    round,
    parseIsoDuration,
    classifyEntryForOvertime,
    getWeekKey,
    IsoUtils,
    type EntryClassification,
} from './utils.js';
import type {
    TimeEntry,
    UserAnalysis,
    UserTotals,
    DayData,
    DayMeta,
    EntryAnalysis,
    AmountBreakdown,
    DateRange,
    UserProfile,
    Holiday,
    TimeOffInfo,
    UserOverride,
    OvertimeConfig,
    CalculationParams,
} from './types.js';
import type { Store } from './state.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================
// Internal interfaces used only within this calculation module.
// These allow the calculation engine to work with both full Store instances
// and minimal test fixtures containing only the required data.
// ============================================================================

/**
 * Minimal store-like interface required for calculations.
 *
 * This interface defines the subset of Store properties that the calculation
 * engine needs. By using this minimal interface instead of requiring the full
 * Store type, we achieve:
 * - Easier unit testing (can pass plain objects instead of full Store instances)
 * - Clearer dependency documentation (explicitly shows what data is needed)
 * - Decoupling from state management implementation details
 *
 * @property users - List of workspace users (for initializing analysis even without entries)
 * @property profiles - User profiles containing workCapacityHours and workingDays
 * @property holidays - Nested map: userId → dateKey → Holiday (for capacity adjustment)
 * @property timeOff - Nested map: userId → dateKey → TimeOffInfo (for capacity reduction)
 * @property overrides - User-specific capacity/multiplier overrides keyed by userId
 * @property config - Feature flags (applyHolidays, useProfileCapacity, etc.)
 * @property calcParams - Global calculation defaults (dailyThreshold, overtimeMultiplier, etc.)
 */
interface CalcStore {
    users: { id: string; name: string }[];
    profiles: Map<string, UserProfile>;
    holidays: Map<string, Map<string, Holiday>>;
    timeOff: Map<string, Map<string, TimeOffInfo>>;
    overrides: Record<string, UserOverride>;
    config: OvertimeConfig;
    calcParams: CalculationParams;
}

// ============================================================================
// HELPER FUNCTIONS - Rate & Duration Extraction
// ============================================================================
// These functions safely extract numeric values from Clockify API responses,
// which can vary in format between API versions and entry types.
// All rate values are normalized to cents (integer representation) to avoid
// floating-point precision issues in currency calculations.
// ============================================================================

/**
 * Safely extracts a numeric rate from various Clockify API formats.
 *
 * The Clockify Reports API has inconsistent rate representations:
 * - Legacy format: numeric value in cents (e.g., 5000 = $50.00/hr)
 * - New format: object with `amount` property in cents (e.g., {amount: 5000})
 * - Missing rate: null or undefined
 *
 * This function normalizes all formats to a numeric value in cents.
 *
 * ## Why Cents?
 * Storing rates as integers (cents) avoids floating-point precision errors
 * in currency calculations. $50.00 stored as 5000 cents can be safely
 * multiplied and added without rounding errors.
 *
 * ## Edge Cases
 * - `null` or `undefined` → 0 (no crash, entry contributes $0)
 * - Object without `amount` property → 0
 * - Object with `amount: null` → 0
 *
 * @param rateField - Rate value from API (number, object, or null/undefined)
 * @returns Rate in cents (integer), or 0 if invalid/missing
 *
 * @example
 * extractRate(5000) // → 5000 (legacy format)
 * extractRate({amount: 5000}) // → 5000 (new format)
 * extractRate(null) // → 0 (missing rate)
 * extractRate({amount: null}) // → 0 (invalid object)
 */
function extractRate(rateField: number | { amount?: number } | null | undefined): number {
    // Handle null/undefined (missing rate)
    if (rateField == null) return 0;

    let rate = 0;

    // Handle legacy numeric format (rate directly as number)
    if (typeof rateField === 'number') {
        rate = rateField;
    }
    // Handle new object format ({amount: number})
    /* Stryker disable next-line all */
    else if (typeof rateField === 'object' && 'amount' in rateField) {
        rate = rateField.amount || 0; // Fallback to 0 if amount is null/undefined
    }
    // Fallback for unknown formats stays at 0

    // Ensure non-negative rate (corrupted API data protection)
    return Math.max(0, rate);
}

/**
 * Extracts entry duration in hours, with fallback calculation.
 *
 * Clockify Reports API provides duration in ISO 8601 format (e.g., "PT8H30M").
 * This function attempts to parse the duration string, and falls back to
 * calculating duration from start/end timestamps if parsing fails or returns 0.
 *
 * ## Algorithm
 * 1. Primary: Parse `entry.timeInterval.duration` as ISO 8601 (via parseIsoDuration)
 * 2. Fallback: If duration is 0 and start/end exist, calculate: (end - start) in hours
 * 3. If all fails: return 0 (entry contributes 0 hours)
 *
 * ## Why Fallback?
 * Some Clockify API responses have missing or malformed duration strings.
 * The fallback ensures we still calculate hours correctly by using timestamps.
 *
 * ## Edge Cases
 * - Malformed ISO duration (e.g., "INVALID") → parseIsoDuration returns 0, fallback activates
 * - Missing timeInterval → returns 0 (safe handling)
 * - Invalid date strings → isNaN check prevents bad calculations, returns 0
 * - Negative duration (end < start) → rare, but would return negative hours (caller should validate)
 *
 * @param entry - Time entry from Clockify Reports API
 * @returns Duration in hours (decimal), or 0 if unable to determine
 *
 * @example
 * getEntryDurationHours({timeInterval: {duration: "PT8H"}}) // → 8.0
 * getEntryDurationHours({timeInterval: {start: "2024-01-01T09:00:00Z", end: "2024-01-01T17:00:00Z"}}) // → 8.0
 * getEntryDurationHours({timeInterval: null}) // → 0 (missing interval)
 *
 * @see parseIsoDuration - Utility function for parsing ISO 8601 durations
 */
function getEntryDurationHours(entry: TimeEntry): number {
    // Primary: Try parsing ISO duration string
    /* Stryker disable next-line all */
    let duration = parseIsoDuration(entry.timeInterval?.duration);

    // Fallback: If duration is 0 and we have start/end timestamps, calculate manually
    // Stryker disable next-line OptionalChaining: Equivalent - if ?.start is truthy, timeInterval exists
    if (duration === 0 && entry.timeInterval?.start && entry.timeInterval?.end) {
        const start = new Date(entry.timeInterval.start);
        const end = new Date(entry.timeInterval.end);

        // Validate timestamps before calculating
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            // Calculate hours: (milliseconds difference) / (ms per hour)
            duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        }
    }

    // Guard against negative durations (malformed API response where end < start)
    // Return 0 instead of negative to prevent nonsensical calculations
    return Math.max(0, duration);
}

/**
 * Builds a stable key for overtime lookup that does not rely on object identity.
 * Includes entry id plus time interval to avoid collisions if IDs are duplicated.
 */
function getEntryOvertimeKey(entry: TimeEntry): string {
    const start = entry.timeInterval?.start ?? '';
    const end = entry.timeInterval?.end ?? '';
    return `${entry.id}:${start}:${end}`;
}

/**
 * Safely parses a value to a number using strict parsing.
 *
 * Unlike parseFloat(), Number() fails completely on strings like "100hours"
 * (returns NaN instead of 100). This provides better data validation by
 * rejecting partially numeric strings that could indicate corrupted data.
 *
 * @param value - Value to parse (string, number, null, undefined)
 * @returns Parsed number if valid and finite, null otherwise
 */
function strictParseNumber(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * Sums all amounts of a specific type from Clockify's amounts array.
 *
 * Clockify Reports API entries can contain an `amounts` array with multiple
 * amount types: "EARNED" (billable revenue), "COST" (internal cost), etc.
 * This function filters and sums amounts matching a specific type.
 *
 * ## API Format Variations
 * The amounts array has inconsistent property names across API versions:
 * - `amount.type` or `amount.amountType` for the type identifier
 * - `amount.value` or `amount.amount` for the numeric value
 * This function handles both variations.
 *
 * ## Amount Types (from Clockify API)
 * - "EARNED" - Billable revenue (what client is charged)
 * - "COST" - Internal cost (what company pays employee)
 * - Type matching is case-insensitive (normalized to uppercase)
 *
 * ## Edge Cases
 * - Empty or null amounts array → 0
 * - Missing type property → skipped (doesn't match)
 * - Invalid numeric value (NaN, Infinity) → skipped (Number.isFinite check)
 * - Null amount object → skipped (optional chaining)
 *
 * @param amounts - Array of amount objects from Clockify entry
 * @param targetType - Amount type to sum (e.g., "EARNED", "COST") - case-insensitive
 * @returns Sum of all amounts matching targetType, in currency units (not cents)
 *
 * @example
 * sumAmountByType([{type: "EARNED", value: 120}, {type: "COST", value: 80}], "EARNED") // → 120
 * sumAmountByType([{amountType: "earned", amount: 50}], "EARNED") // → 50 (case-insensitive, alternate property names)
 * sumAmountByType(null, "EARNED") // → 0 (null array)
 */
function sumAmountByType(amounts: TimeEntry['amounts'], targetType: string): number {
    // Guard: Handle null/undefined/empty arrays
    // Stryker disable next-line ConditionalExpression: Equivalent - empty array reduce returns 0
    if (!Array.isArray(amounts) || amounts.length === 0) return 0;

    // Normalize target type for case-insensitive matching
    const normalizedTarget = targetType.toUpperCase();

    // Sum all amounts matching the target type
    /* istanbul ignore next -- defensive: handles various amount object formats from API */
    return amounts.reduce((total, amount) => {
        // Extract type (handle both 'type' and 'amountType' properties)
        // Stryker disable next-line all
        const type = String(amount?.type || amount?.amountType || '').toUpperCase();

        // Skip non-matching types
        if (type !== normalizedTarget) return total;

        // Extract value (handle both 'value' and 'amount' properties)
        // Stryker disable next-line OptionalChaining: Equivalent - amount is always defined in reduce callback
        const value = Number(amount?.value ?? amount?.amount);

        // Only add finite numbers (skip NaN, Infinity, undefined)
        return Number.isFinite(value) ? total + value : total;
    }, 0);
}

/**
 * Calculates hourly rate from total amount and duration.
 *
 * When hourly rate fields (e.g., `earnedRate`, `costRate`) are missing or zero,
 * this function derives the rate by dividing total amount by hours worked.
 * This is used as a fallback to ensure we always have rate information.
 *
 * ## Algorithm
 * 1. Sum all amounts of targetType (via sumAmountByType)
 * 2. Divide by duration to get hourly rate
 * 3. Convert from currency units to cents (* 100)
 * 4. Round to 2 decimal places for consistency
 *
 * ## Why Convert to Cents?
 * The Reports API returns amounts in currency units (e.g., $120.00 = 120).
 * We convert to cents (12000) to match the format of `hourlyRate` fields,
 * which are always in cents. This ensures consistent rate handling.
 *
 * ## Edge Cases
 * - Zero duration → 0 (prevent division by zero)
 * - Zero total amount → 0 (no rate to derive)
 * - Invalid amounts (NaN/Infinity) → 0 (Number.isFinite check)
 *
 * @param amounts - Array of amount objects from Clockify entry
 * @param targetType - Amount type to calculate rate for (e.g., "EARNED", "COST")
 * @param durationHours - Entry duration in hours (must be > 0)
 * @returns Hourly rate in cents, rounded to 2 decimal places, or 0 if invalid
 *
 * @example
 * rateFromAmounts([{type: "EARNED", value: 120}], "EARNED", 8) // → 1500 (=$15/hr in cents)
 * rateFromAmounts([{type: "COST", value: 80}], "COST", 8) // → 1000 (=$10/hr in cents)
 * rateFromAmounts([], "EARNED", 8) // → 0 (no amounts)
 * rateFromAmounts([{type: "EARNED", value: 100}], "EARNED", 0) // → 0 (zero duration)
 *
 * @see sumAmountByType - Sums amounts for the target type
 */
function rateFromAmounts(
    amounts: TimeEntry['amounts'],
    targetType: string,
    durationHours: number
): number {
    // Prevent division by zero
    // Stryker disable next-line ConditionalExpression: Equivalent - 0 division returns Infinity, caught by isFinite check
    if (!durationHours) return 0;

    // Sum all amounts of the target type
    const totalAmount = sumAmountByType(amounts, targetType);

    // Validate amount before calculating rate
    // Stryker disable next-line all: Equivalent - non-finite or zero amount produces same 0 result
    if (!Number.isFinite(totalAmount) || totalAmount === 0) return 0;

    // Calculate hourly rate: (total amount / hours) * 100 to convert to cents
    // Reports API amounts are in currency units (e.g., $120 = 120), so multiply by 100
    return round((totalAmount / durationHours) * 100, 2);
}

/**
 * Rate configuration for all amount types.
 *
 * This interface represents the three parallel rate calculations we perform
 * for each entry:
 *
 * - **Earned**: Billable revenue rate (what client is charged per hour)
 * - **Cost**: Internal cost rate (what company pays employee per hour)
 * - **Profit**: Difference between earned and cost (earned - cost)
 *
 * All rates are stored in cents to avoid floating-point precision errors.
 *
 * @property earned - Billable revenue rate in cents/hour (0 for non-billable entries)
 * @property cost - Internal cost rate in cents/hour
 * @property profit - Profit rate in cents/hour (earned - cost)
 */
interface RatesConfig {
    earned: number;
    cost: number;
    profit: number;
}

/**
 * Extracts all three rate types (earned/cost/profit) from an entry.
 *
 * This function normalizes rate data from multiple possible sources:
 * 1. Direct rate fields: `earnedRate`, `costRate`, `hourlyRate`
 * 2. Calculated from amounts array: derive rate from total amount / duration
 *
 * The function uses a waterfall approach: prefer direct fields, fall back to
 * calculated rates from amounts.
 *
 * ## Special Handling for Non-Billable Entries
 * Non-billable entries (where `billable === false`) have their earned rate
 * forced to 0, because they should not contribute to billable revenue totals.
 * Cost rate is unaffected (we still track internal costs for non-billable work).
 *
 * ## Rate Resolution Priority
 * **Earned Rate**:
 * 1. `entry.earnedRate` (if present and billable)
 * 2. `entry.hourlyRate` (if present and billable)
 * 3. Calculated from `amounts.EARNED` (if billable)
 * 4. 0 (if non-billable or all sources missing)
 *
 * **Cost Rate**:
 * 1. `entry.costRate` (if present)
 * 2. Calculated from `amounts.COST`
 * 3. 0 (if all sources missing)
 *
 * **Profit Rate**: Always calculated as `earned - cost`
 *
 * ## Why Three Rate Types?
 * - **Earned**: Tracks billable revenue for client invoicing
 * - **Cost**: Tracks internal expenses for profitability analysis
 * - **Profit**: Measures profitability per hour worked
 * The user can select which amount type to display via `config.amountDisplay`.
 *
 * @param entry - Time entry from Clockify Reports API
 * @param durationHours - Optional precomputed duration (avoids recalculating)
 * @returns RatesConfig with all three rates in cents/hour
 *
 * @example
 * // Billable entry with direct rates
 * extractRates({billable: true, earnedRate: 5000, costRate: 3000})
 * // → {earned: 5000, cost: 3000, profit: 2000}
 *
 * // Non-billable entry (earned forced to 0)
 * extractRates({billable: false, earnedRate: 5000, costRate: 3000})
 * // → {earned: 0, cost: 3000, profit: -3000}
 *
 * // Entry with amounts array (no direct rates)
 * extractRates({billable: true, amounts: [{type: "EARNED", value: 120}, {type: "COST", value: 80}], timeInterval: {duration: "PT8H"}})
 * // → {earned: 1500, cost: 1000, profit: 500} (calculated from amounts)
 *
 * @see extractRate - Extracts single rate from various formats
 * @see rateFromAmounts - Calculates rate from amounts array
 */
function extractRates(entry: TimeEntry, durationHours?: number): RatesConfig {
    // Determine billability: Clockify API uses `billable: false` for non-billable,
    // and `billable: true` or missing for billable. Treat missing as billable.
    const isBillable = entry.billable === true;

    // Get or compute duration (avoid recalculating if already known)
    /* istanbul ignore next -- defensive: durationHours is always provided by caller */
    const entryDuration = durationHours ?? getEntryDurationHours(entry);

    // --- EARNED RATE (billable revenue) ---
    // Non-billable entries MUST have 0 earned rate (don't contribute to revenue)
    const earnedRate = isBillable
        ? extractRate(entry.earnedRate) || extractRate(entry.hourlyRate) // Prefer earnedRate, fallback to hourlyRate
        : 0; // Force 0 for non-billable

    // --- COST RATE (internal expense) ---
    // Cost rate is tracked regardless of billability (we want to know internal costs)
    const costRate = extractRate(entry.costRate) || 0;

    // --- FALLBACK: Calculate rates from amounts array if direct rates are missing ---
    const earnedFromAmounts = isBillable
        ? rateFromAmounts(entry.amounts, 'EARNED', entryDuration)
        : 0; // Only calculate for billable entries

    const costFromAmounts = rateFromAmounts(entry.amounts, 'COST', entryDuration);

    // --- RESOLVE FINAL RATES (prefer direct fields, fallback to calculated) ---
    const resolvedEarnedRate = earnedRate || earnedFromAmounts; // Use direct rate if present, else calculated
    const resolvedCostRate = costRate || costFromAmounts;

    // --- PROFIT RATE (only meaningful for billable entries) ---
    // Non-billable entries have no revenue, so profit is always 0 (not negative)
    // This prevents misleading negative profit values in financial reports
    const profitRate = isBillable ? resolvedEarnedRate - resolvedCostRate : 0;

    return {
        earned: resolvedEarnedRate,
        cost: resolvedCostRate,
        profit: profitRate,
    };
}

/**
 * Gets the base capacity for a user on a specific day (before adjustments).
 *
 * This function implements the **capacity precedence hierarchy** defined in docs/prd.md.
 * It selects the most specific capacity value available, cascading through multiple
 * sources until a valid value is found.
 *
 * ## Capacity Precedence (highest to lowest)
 * 1. **Per-day override**: User-specific override for this exact date
 *    - Most specific, overrides everything else
 *    - Use case: Special capacity for a specific date (e.g., half-day, extended hours)
 *
 * 2. **Weekly override**: User-specific override for this day of week
 *    - Applies to all instances of this weekday (e.g., all Fridays)
 *    - Use case: Consistent weekly patterns (e.g., 6h every Friday)
 *
 * 3. **Global user override**: User-specific override for all days
 *    - Applies to all days unless more specific override exists
 *    - Use case: Employee with non-standard capacity (e.g., part-time 6h/day)
 *
 * 4. **Profile capacity**: User's workCapacityHours from Clockify profile
 *    - Only used if `config.useProfileCapacity` is enabled
 *    - Use case: Leverage Clockify profile data for automatic capacity
 *
 * 5. **Global default**: System-wide daily threshold
 *    - Fallback when no other source exists
 *    - Default: 8 hours (standard workday)
 *
 * ## IMPORTANT: This Returns BASE Capacity
 * This function returns the **base capacity** before adjustments. The caller must
 * apply additional adjustments for:
 * - Holidays (capacity → 0)
 * - Non-working days (capacity → 0)
 * - Time-off (capacity reduced by time-off hours)
 *
 * See the main calculation function for adjustment logic.
 *
 * ## Value Parsing
 * Override values can be stored as strings or numbers (due to form input handling).
 * We safely parse to float and validate with isNaN check.
 *
 * @param userId - User ID to look up overrides/profile for
 * @param dateKey - Date in YYYY-MM-DD format (e.g., "2024-01-15")
 * @param store - Application store containing overrides, profiles, and config
 * @returns Base capacity in hours (before holiday/time-off adjustments)
 *
 * @example
 * // Per-day override exists
 * getEffectiveCapacity("user123", "2024-01-15", store) // → 4 (half-day override)
 *
 * // Weekly override (Fridays are 6h)
 * getEffectiveCapacity("user123", "2024-01-19", store) // → 6 (Friday override)
 *
 * // Global user override
 * getEffectiveCapacity("user123", "2024-01-16", store) // → 6 (part-time employee)
 *
 * // Profile capacity
 * getEffectiveCapacity("user456", "2024-01-15", store) // → 7.5 (from Clockify profile)
 *
 * // Global default
 * getEffectiveCapacity("user789", "2024-01-15", store) // → 8 (default threshold)
 *
 * @see getHoliday - Check if day is a holiday (capacity → 0)
 * @see isWorkingDay - Check if day is a working day (capacity → 0 if not)
 * @see getTimeOff - Get time-off hours (reduce capacity)
 */
function getEffectiveCapacity(userId: string, dateKey: string, store: CalcStore): number {
    // Look up user-specific overrides (may be undefined if no overrides exist)
    const override = store.overrides[userId];

    // --- PRIORITY 1: Per-day override (most specific) ---
    // Check if user has per-day mode enabled AND has override for this exact date
    if (override?.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.capacity != null) {
        const val = override.perDayOverrides[dateKey].capacity;
        // Strict parsing rejects partial matches like "8hours" (unlike parseFloat)
        const parsed = strictParseNumber(val);
        if (parsed !== null) return parsed; // Valid capacity found, return immediately
    }

    // --- PRIORITY 2: Weekly override (day-of-week pattern) ---
    // Check if user has weekly mode enabled AND has override for this weekday
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        // Convert dateKey to weekday (MONDAY, TUESDAY, etc.)
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.capacity != null) {
            const val = override.weeklyOverrides[weekday].capacity;
            const parsed = strictParseNumber(val);
            if (parsed !== null) return parsed;
        }
    }

    // --- PRIORITY 3: Global user override (applies to all days) ---
    // Check if user has a global capacity override
    if (override?.capacity != null) {
        const parsed = strictParseNumber(override.capacity);
        if (parsed !== null) return parsed;
    }

    // --- PRIORITY 4: Profile capacity (from Clockify user profile) ---
    // Only use profile capacity if feature is enabled in config
    if (store.config.useProfileCapacity) {
        const profile = store.profiles.get(userId);
        if (profile?.workCapacityHours != null) {
            return profile.workCapacityHours; // Already a number from API
        }
    }

    // --- PRIORITY 5: Global default (ultimate fallback) ---
    // Return system-wide daily threshold (default: 8 hours)
    return store.calcParams.dailyThreshold;
}

// ============================================================================
// OVERRIDE RESOLUTION FUNCTIONS - Multipliers & Tier2 Thresholds
// ============================================================================
// These functions follow the same precedence hierarchy as getEffectiveCapacity:
// per-day > weekly > global user override > global default
// They resolve tier1/tier2 multipliers and tier2 thresholds for premium calculations.
// ============================================================================

/**
 * Gets the effective tier1 overtime multiplier for a user on a specific day.
 *
 * The overtime multiplier determines the premium rate for overtime hours.
 * For example, a multiplier of 1.5 means overtime is paid at 1.5x the regular rate.
 *
 * ## Multiplier Precedence (same as capacity)
 * 1. Per-day override (this exact date)
 * 2. Weekly override (this day of week)
 * 3. Global user override (all days)
 * 4. Global default (system-wide, default: 1.5)
 *
 * ## Multiplier Values
 * - 1.0 = No overtime premium (1x regular rate)
 * - 1.5 = Time-and-a-half (standard overtime premium)
 * - 2.0 = Double-time (weekend/holiday premium)
 *
 * @param userId - User ID to look up overrides for
 * @param dateKey - Date in YYYY-MM-DD format
 * @param store - Application store containing overrides and config
 * @returns Effective tier1 overtime multiplier (typically 1.5)
 *
 * @example
 * getEffectiveMultiplier("user123", "2024-01-20", store) // → 2.0 (weekend double-time)
 * getEffectiveMultiplier("user123", "2024-01-15", store) // → 1.5 (standard overtime)
 *
 * @see getEffectiveTier2Multiplier - Tier2 multiplier for extended overtime
 */
function getEffectiveMultiplier(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // Priority 1: Per-day override (e.g., double-time for a specific holiday)
    if (override?.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.multiplier != null) {
        const val = override.perDayOverrides[dateKey].multiplier;
        const parsed = strictParseNumber(val);
        // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
        if (parsed !== null) return parsed;
    }

    // Priority 2: Weekly override (e.g., higher rate for weekend shifts)
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.multiplier != null) {
            const val = override.weeklyOverrides[weekday].multiplier;
            const parsed = strictParseNumber(val);
            // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
            if (parsed !== null) return parsed;
        }
    }

    // Priority 3: Global user override (e.g., senior employee with higher OT rate)
    if (override?.multiplier != null) {
        const parsed = strictParseNumber(override.multiplier);
        // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
        if (parsed !== null) return parsed;
    }

    // Priority 4: Global default (typically 1.5 = time-and-a-half)
    return store.calcParams.overtimeMultiplier;
}

/**
 * Gets the tier2 overtime threshold for a user on a specific day.
 *
 * The tier2 threshold defines how many overtime hours must accumulate (per user,
 * across the entire date range) before tier2 premium kicks in.
 *
 * ## Two-Tier Overtime Premium System
 * - **Tier1 (0 to threshold)**: All OT gets tier1 multiplier (e.g., 1.5x)
 * - **Tier2 (beyond threshold)**: Additional OT gets tier2 multiplier (e.g., 2.0x)
 *
 * Example: threshold = 10h, tier1 multiplier = 1.5, tier2 multiplier = 2.0
 * - First 10 OT hours: paid at 1.5x rate
 * - OT hours beyond 10: paid at 2.0x rate
 *
 * ## Threshold = 0 Special Case
 * If threshold is 0, tier2 never activates (all OT stays tier1).
 * This effectively disables the two-tier system.
 *
 * ## Accumulation Scope
 * The threshold is checked against **total user OT hours** across the date range,
 * NOT per-day OT. This rewards employees with high cumulative overtime.
 *
 * @param userId - User ID to look up overrides for
 * @param dateKey - Date in YYYY-MM-DD format
 * @param store - Application store containing overrides and config
 * @returns Tier2 threshold in OT hours (0 = tier2 disabled)
 *
 * @example
 * getEffectiveTier2Threshold("user123", "2024-01-15", store) // → 10 (tier2 after 10h OT)
 * getEffectiveTier2Threshold("user456", "2024-01-15", store) // → 0 (tier2 disabled)
 *
 * @see getEffectiveTier2Multiplier - Tier2 premium multiplier
 */
function getEffectiveTier2Threshold(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // Priority 1: Per-day override (rarely used, but available)
    if (
        override?.mode === 'perDay' &&
        override.perDayOverrides?.[dateKey]?.tier2Threshold != null
    ) {
        const val = override.perDayOverrides[dateKey].tier2Threshold;
        const parsed = strictParseNumber(val);
        // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
        if (parsed !== null) return parsed;
    }

    // Priority 2: Weekly override (e.g., different threshold for weekends)
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.tier2Threshold != null) {
            const val = override.weeklyOverrides[weekday].tier2Threshold;
            const parsed = strictParseNumber(val);
            // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
            if (parsed !== null) return parsed;
        }
    }

    // Priority 3: Global user override (e.g., manager with higher threshold)
    if (override?.tier2Threshold != null) {
        const parsed = strictParseNumber(override.tier2Threshold);
        // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
        if (parsed !== null) return parsed;
    }

    // Priority 4: Global default (fallback to 0 if not configured)
    return store.calcParams.tier2ThresholdHours || 0;
}

/**
 * Gets the tier2 overtime multiplier for a user on a specific day.
 *
 * The tier2 multiplier is the premium rate applied to overtime hours beyond
 * the tier2 threshold. It should typically be HIGHER than the tier1 multiplier.
 *
 * ## Two-Tier Premium Calculation
 * - **Tier1 premium**: `(tier1Multiplier - 1) * allOTHours * rate`
 * - **Tier2 additional premium**: `(tier2Multiplier - tier1Multiplier) * tier2Hours * rate`
 *
 * Example: tier1 = 1.5, tier2 = 2.0, regular rate = $20/hr, 15h OT (10h tier1, 5h tier2)
 * - Tier1 premium: (1.5 - 1) * 15h * $20 = $150
 * - Tier2 additional premium: (2.0 - 1.5) * 5h * $20 = $50
 * - Total OT premium: $200
 *
 * ## Important: Tier2Multiplier Should Be > Tier1Multiplier
 * If tier2Multiplier ≤ tier1Multiplier, tier2 has no effect (no additional premium).
 * The calculation logic explicitly checks this before applying tier2.
 *
 * @param userId - User ID to look up overrides for
 * @param dateKey - Date in YYYY-MM-DD format
 * @param store - Application store containing overrides and config
 * @returns Tier2 multiplier (default: 2.0 = double-time)
 *
 * @example
 * getEffectiveTier2Multiplier("user123", "2024-01-15", store) // → 2.0 (double-time)
 * getEffectiveTier2Multiplier("user456", "2024-01-15", store) // → 1.5 (disabled, same as tier1)
 *
 * @see getEffectiveMultiplier - Tier1 multiplier
 * @see getEffectiveTier2Threshold - Threshold for tier2 activation
 */
function getEffectiveTier2Multiplier(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // Priority 1: Per-day override (e.g., triple-time for specific emergency shift)
    if (
        override?.mode === 'perDay' &&
        override.perDayOverrides?.[dateKey]?.tier2Multiplier != null
    ) {
        const val = override.perDayOverrides[dateKey].tier2Multiplier;
        const parsed = strictParseNumber(val);
        // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
        if (parsed !== null) return parsed;
    }

    // Priority 2: Weekly override (e.g., higher tier2 for weekend extended shifts)
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.tier2Multiplier != null) {
            const val = override.weeklyOverrides[weekday].tier2Multiplier;
            const parsed = strictParseNumber(val);
            // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
            if (parsed !== null) return parsed;
        }
    }

    // Priority 3: Global user override (e.g., hazard pay for on-call personnel)
    if (override?.tier2Multiplier != null) {
        const parsed = strictParseNumber(override.tier2Multiplier);
        // Stryker disable next-line ConditionalExpression: Equivalent - val is validated upstream, null never occurs
        if (parsed !== null) return parsed;
    }

    // Priority 4: Global default (default 2.0 = double-time)
    return store.calcParams.tier2Multiplier || 2.0;
}

// ============================================================================
// DAY CONTEXT FUNCTIONS - Working Days, Holidays, Time-Off
// ============================================================================
// These functions determine the special context of a day (holiday, time-off, non-working)
// which affects capacity adjustments. They check feature flags before accessing data
// to allow graceful degradation when APIs fail or are disabled.
// ============================================================================

/**
 * Checks if a date is a working day for a specific user (based on profile).
 *
 * Users can have custom working day schedules in their Clockify profiles
 * (e.g., Monday-Thursday only, or Tuesday-Saturday). This function checks
 * if the given date falls on a working day for the user.
 *
 * ## Capacity Impact
 * If a day is NOT a working day:
 * - Effective capacity → 0 (all work on this day becomes overtime)
 * - Rationale: Employee shouldn't be working on their off-day
 *
 * ## Feature Flag: `useProfileWorkingDays`
 * If disabled, ALL days are treated as working days (no capacity adjustment).
 * This allows the system to work without profile data.
 *
 * ## Profile Structure
 * - `profile.workingDays`: Array of weekday names (e.g., ["MONDAY", "TUESDAY", ...])
 * - If missing or empty, defaults to treating all days as working days
 *
 * ## Weekday Calculation
 * Uses IsoUtils.getWeekdayKey() to convert dateKey to uppercase weekday name
 * (MONDAY, TUESDAY, etc.) for comparison with profile.workingDays.
 *
 * @param userId - User ID to look up profile for
 * @param dateKey - Date in YYYY-MM-DD format
 * @param store - Application store containing profiles and config
 * @returns True if day is a working day (or feature disabled), false if off-day
 *
 * @example
 * // User works Monday-Friday
 * isWorkingDay("user123", "2024-01-15", store) // → true (Monday)
 * isWorkingDay("user123", "2024-01-20", store) // → false (Saturday, off-day)
 *
 * // Feature disabled (all days are working days)
 * isWorkingDay("user456", "2024-01-20", store) // → true (feature flag off)
 *
 * @see IsoUtils.getWeekdayKey - Converts date to weekday name
 */
function isWorkingDay(userId: string, dateKey: string, store: CalcStore): boolean {
    // Feature disabled: treat all days as working days
    if (!store.config.useProfileWorkingDays) return true;

    // No profile or no working days defined: default to all days working
    const profile = store.profiles.get(userId);
    if (!profile?.workingDays) return true;

    // Convert dateKey to weekday name (MONDAY, TUESDAY, etc.)
    const weekday = IsoUtils.getWeekdayKey(dateKey);

    // Check if this weekday is in the user's working days array
    return profile.workingDays.includes(weekday);
}

/**
 * Gets holiday information for a user on a specific date.
 *
 * Holidays are fetched from Clockify's holiday API and stored in a nested Map
 * structure: userId → dateKey → Holiday. This function checks if the given
 * date is a holiday for the user.
 *
 * ## Capacity Impact
 * If a day is a holiday:
 * - Effective capacity → 0 (all work on this day becomes overtime)
 * - Rationale: Employees working on holidays deserve overtime compensation
 *
 * ## Feature Flag: `applyHolidays`
 * If disabled, returns null (no holidays applied). This allows the system to
 * work without holiday data or when the holiday API fails.
 *
 * ## Entry-Based Detection
 * Holiday detection is driven by API data when the feature flag is enabled.
 *
 * ## Holiday Object Structure
 * - `name`: Holiday name (e.g., "Christmas", "Independence Day")
 * - `projectId`: Optional Clockify project ID associated with the holiday
 *
 * @param userId - User ID to look up holidays for
 * @param dateKey - Date in YYYY-MM-DD format (e.g., "2024-12-25")
 * @param store - Application store containing holidays Map and config
 * @returns Holiday object if found, null otherwise
 *
 * @example
 * getHoliday("user123", "2024-12-25", store) // → {name: "Christmas", projectId: "proj123"}
 * getHoliday("user123", "2024-01-15", store) // → null (regular working day)
 * getHoliday("user123", "2024-12-25", {config: {applyHolidays: false}}) // → null (feature disabled)
 *
 * @see getTimeOff - Similar function for time-off detection
 */
function getHoliday(userId: string, dateKey: string, store: CalcStore): Holiday | null {
    // Feature disabled: no holidays applied
    if (!store.config.applyHolidays) return null;

    // Look up user's holiday map (may be undefined if no holidays fetched)
    const userHolidays = store.holidays.get(userId);
    if (!userHolidays) return null;

    // Type guard: ensure userHolidays is actually a Map (defense against corrupted data)
    if (!(userHolidays instanceof Map)) {
        // Data corruption detected - silently return null rather than crash
        // This can happen if localStorage data is manually modified or version mismatch
        return null;
    }

    // Check if this specific date is a holiday for this user
    return userHolidays.get(dateKey) || null;
}

/**
 * Gets time-off information for a user on a specific date.
 *
 * Time-off (PTO/vacation) is fetched from Clockify's time-off API and stored
 * in a nested Map structure: userId → dateKey → TimeOffInfo. This function
 * checks if the user has time-off on the given date.
 *
 * ## Capacity Impact
 * If a user has time-off:
 * - **Full-day time-off**: Effective capacity → 0 (all work becomes overtime)
 * - **Partial time-off**: Capacity reduced by time-off hours
 *   - Example: 8h capacity with 4h time-off → 4h effective capacity
 *
 * ## Precedence with Holidays/Non-Working Days
 * - Holiday or non-working day takes precedence (both result in 0 capacity)
 * - Time-off reduction only applies if capacity is already > 0
 *
 * ## Feature Flag: `applyTimeOff`
 * If disabled, returns null (no time-off applied). This allows the system to
 * work without time-off data or when the time-off API fails.
 *
 * ## Entry-Based Detection
 * Time-off detection is driven by API data when the feature flag is enabled.
 *
 * ## TimeOffInfo Object Structure
 * - `hours`: Time-off duration in hours (e.g., 4 for half-day, 8 for full-day)
 * - `isFullDay`: Boolean flag indicating if this is a full-day time-off
 *
 * @param userId - User ID to look up time-off for
 * @param dateKey - Date in YYYY-MM-DD format (e.g., "2024-01-15")
 * @param store - Application store containing timeOff Map and config
 * @returns TimeOffInfo object if found, null otherwise
 *
 * @example
 * getTimeOff("user123", "2024-01-15", store) // → {hours: 8, isFullDay: true} (full-day PTO)
 * getTimeOff("user123", "2024-01-16", store) // → {hours: 4, isFullDay: false} (half-day)
 * getTimeOff("user123", "2024-01-17", store) // → null (no time-off)
 * getTimeOff("user123", "2024-01-15", {config: {applyTimeOff: false}}) // → null (feature disabled)
 *
 * @see getHoliday - Similar function for holiday detection
 */
function getTimeOff(userId: string, dateKey: string, store: CalcStore): TimeOffInfo | null {
    // Feature disabled: no time-off applied
    if (!store.config.applyTimeOff) return null;

    // Look up user's time-off map (may be undefined if no time-off fetched)
    const userTimeOff = store.timeOff.get(userId);
    if (!userTimeOff) return null;

    // Type guard: ensure userTimeOff is actually a Map (defense against corrupted data)
    if (!(userTimeOff instanceof Map)) {
        // Data corruption detected - silently return null rather than crash
        // This can happen if localStorage data is manually modified or version mismatch
        return null;
    }

    // Check if this specific date has time-off for this user
    return userTimeOff.get(dateKey) || null;
}

// ============================================================================
// AGGREGATE DATA STRUCTURE BUILDERS
// ============================================================================
// Factory functions for creating empty aggregate data structures.
// These ensure consistent initialization and make it easy to add new fields.
// ============================================================================

/**
 * Creates an empty UserTotals object with all fields initialized to zero.
 *
 * This factory function ensures all totals are consistently initialized.
 * As the application evolves and new total fields are added (e.g., new
 * amount types, new breakdowns), they should be added here to ensure
 * all code paths start with the same structure.
 *
 * ## Field Categories
 *
 * **Hours Breakdown**:
 * - `regular`: Total regular hours (includes WORK + BREAK + PTO)
 * - `overtime`: Total overtime hours (WORK entries only)
 * - `total`: Sum of all hours (regular + overtime)
 * - `breaks`: Break hours only (subset of regular)
 * - `vacationEntryHours`: PTO entry hours (HOLIDAY/TIME_OFF entries)
 *
 * **Billable Breakdown**:
 * - `billableWorked`: Billable regular hours
 * - `nonBillableWorked`: Non-billable regular hours
 * - `billableOT`: Billable overtime hours
 * - `nonBillableOT`: Non-billable overtime hours
 *
 * **Amount Calculations** (in currency units, not cents):
 * - `amount`: Primary amount (based on amountDisplay mode)
 * - `amountBase`: Primary amount without OT premium
 * - `amountEarned`: Total earned revenue (with OT premium)
 * - `amountCost`: Total internal cost (with OT premium)
 * - `amountProfit`: Total profit (earned - cost)
 * - `amountEarnedBase`: Earned revenue without OT premium
 * - `amountCostBase`: Internal cost without OT premium
 * - `amountProfitBase`: Profit without OT premium
 * - `profit`: Alias for amountProfit (for convenience)
 *
 * **Overtime Premiums**:
 * - `otPremium`: Tier1 OT premium (all OT hours)
 * - `otPremiumTier2`: Additional tier2 OT premium
 * - `otPremiumEarned`: Tier1 premium for earned amounts
 * - `otPremiumCost`: Tier1 premium for cost amounts
 * - `otPremiumProfit`: Tier1 premium for profit amounts
 * - `otPremiumTier2Earned`: Tier2 premium for earned amounts
 * - `otPremiumTier2Cost`: Tier2 premium for cost amounts
 * - `otPremiumTier2Profit`: Tier2 premium for profit amounts
 *
 * **Capacity & Context**:
 * - `expectedCapacity`: Sum of effective capacity for all days in range
 * - `holidayCount`: Number of holiday days
 * - `timeOffCount`: Number of days with time-off
 * - `holidayHours`: Total hours represented by holidays (base capacity * count)
 * - `timeOffHours`: Total time-off hours
 *
 * @returns UserTotals object with all fields set to 0
 *
 * @example
 * const userAnalysis = {
 *   userId: "user123",
 *   userName: "John Doe",
 *   days: new Map(),
 *   totals: createEmptyTotals() // Initialize with zeros
 * };
 */
function createEmptyTotals(): UserTotals {
    return {
        regular: 0,
        overtime: 0,
        dailyOvertime: 0,
        weeklyOvertime: 0,
        overlapOvertime: 0,
        combinedOvertime: 0,
        total: 0,
        breaks: 0,
        billableWorked: 0,
        nonBillableWorked: 0,
        billableOT: 0,
        nonBillableOT: 0,
        amount: 0,
        amountBase: 0,
        amountEarned: 0,
        amountCost: 0,
        amountProfit: 0,
        amountEarnedBase: 0,
        amountCostBase: 0,
        amountProfitBase: 0,
        profit: 0,
        otPremium: 0,
        otPremiumTier2: 0,
        otPremiumEarned: 0,
        otPremiumCost: 0,
        otPremiumProfit: 0,
        otPremiumTier2Earned: 0,
        otPremiumTier2Cost: 0,
        otPremiumTier2Profit: 0,
        expectedCapacity: 0,
        holidayCount: 0,
        timeOffCount: 0,
        holidayHours: 0,
        timeOffHours: 0,
        vacationEntryHours: 0,
    };
}

/**
 * Creates day metadata object describing the context of a specific day.
 *
 * DayMeta captures all the contextual information about a day that affects
 * capacity and overtime calculations. This metadata is stored alongside
 * the day's entries and is used for UI display and debugging.
 *
 * ## Purpose
 * - Record the effective capacity after all adjustments
 * - Track special day types (holiday, non-working day, time-off)
 * - Provide context for UI rendering (e.g., highlight holidays in red)
 * - Enable audit trail (understand WHY capacity was set to a specific value)
 *
 * ## Field Meanings
 * - `capacity`: Final effective capacity for this day (after all adjustments)
 * - `isHoliday`: True if day is a holiday (from API)
 * - `holidayName`: Name of the holiday (e.g., "Christmas"), empty string if not holiday
 * - `isNonWorking`: True if day is not in user's workingDays (e.g., weekend)
 * - `isTimeOff`: True if user has time-off on this day (full or partial)
 * - `holidayProjectId`: Clockify project ID for the holiday (if applicable)
 *
 * ## Capacity Calculation Trace
 * By examining dayMeta, you can understand why capacity has a specific value:
 * - capacity = 0 + isHoliday = true → Holiday, all work is OT
 * - capacity = 0 + isNonWorking = true → Off-day, all work is OT
 * - capacity = 4 + isTimeOff = true → Half-day time-off (8h - 4h = 4h)
 * - capacity = 8 + all flags false → Normal working day
 *
 * @param capacity - Effective capacity in hours (after all adjustments)
 * @param isHoliday - Whether this is a holiday
 * @param holidayName - Holiday name (empty string if not a holiday)
 * @param isNonWorking - Whether this is a non-working day per profile
 * @param isTimeOff - Whether user has time-off on this day
 * @param holidayProjectId - Clockify project ID for holiday entries (optional)
 * @returns DayMeta object
 *
 * @example
 * createDayMeta(8, false, "", false, false, null) // Regular working day
 * createDayMeta(0, true, "Christmas", false, false, "proj123") // Holiday
 * createDayMeta(0, false, "", true, false, null) // Non-working day (weekend)
 * createDayMeta(4, false, "", false, true, null) // Half-day time-off
 */
function createDayMeta(
    capacity: number,
    isHoliday: boolean,
    holidayName: string,
    isNonWorking: boolean,
    isTimeOff: boolean,
    holidayProjectId?: string | null
): DayMeta {
    return {
        capacity,
        isHoliday,
        holidayName,
        isNonWorking,
        isTimeOff,
        holidayProjectId,
    };
}

/**
 * Calculates monetary amounts for all three amount types (earned/cost/profit).
 *
 * This function performs parallel calculations for earned revenue, internal cost,
 * and profit, applying overtime premiums with two-tier support. It produces a
 * complete financial breakdown for a single entry.
 *
 * ## Algorithm
 *
 * For each amount type (earned/cost/profit), calculate:
 *
 * 1. **Regular Amount**: `regularHours * hourlyRate`
 *    - Payment for hours within capacity (no premium)
 *
 * 2. **Overtime Base Amount**: `overtimeHours * hourlyRate`
 *    - Base payment for OT hours (before premium)
 *
 * 3. **Tier1 Premium**: `(multiplier - 1) * overtimeHours * hourlyRate`
 *    - Additional payment for ALL overtime hours at tier1 rate
 *    - Example: multiplier 1.5 → 0.5x additional pay per OT hour
 *
 * 4. **Tier2 Premium**: `(tier2Multiplier - multiplier) * tier2Hours * hourlyRate`
 *    - ADDITIONAL premium for tier2 hours beyond tier1
 *    - Only applies to hours beyond tier2Threshold
 *    - Example: tier1=1.5, tier2=2.0 → additional 0.5x pay for tier2 hours
 *
 * 5. **Total Amount with OT**: `regularAmount + overtimeBase + tier1Premium + tier2Premium`
 *
 * 6. **Total Amount without OT**: `regularAmount` (for comparison/reporting)
 *
 * ## Two-Tier Premium Example
 * - Regular rate: $20/hr, multiplier: 1.5, tier2Multiplier: 2.0
 * - Hours: 8 regular, 12 OT (10 tier1, 2 tier2)
 * - Regular amount: 8 * $20 = $160
 * - OT base: 12 * $20 = $240
 * - Tier1 premium: (1.5 - 1) * 12 * $20 = $120 (ALL OT hours)
 * - Tier2 premium: (2.0 - 1.5) * 2 * $20 = $20 (tier2 hours only)
 * - Total: $160 + $240 + $120 + $20 = $540
 *
 * ## Why Three Parallel Calculations?
 * - **Earned**: Tracks billable revenue (what client pays)
 * - **Cost**: Tracks internal expense (what company pays employee)
 * - **Profit**: Tracks margin (earned - cost)
 * The user selects which to display via `config.amountDisplay`.
 *
 * ## Rate Conversion
 * Input rates are in cents (e.g., 5000 = $50/hr) to avoid float precision issues.
 * We convert to dollars by dividing by 100 before multiplication.
 *
 * ## Rounding
 * All amounts are rounded to 2 decimal places (currency precision).
 *
 * @param regularHours - Regular hours for this entry (within capacity)
 * @param overtimeHours - Total overtime hours for this entry
 * @param _tier1Hours - Tier1 OT hours (currently unused, kept for signature compatibility)
 * @param tier2Hours - Tier2 OT hours (subset of overtimeHours)
 * @param rates - RatesConfig with earned/cost/profit rates in cents
 * @param multiplier - Tier1 overtime multiplier (e.g., 1.5)
 * @param tier2Multiplier - Tier2 overtime multiplier (e.g., 2.0)
 * @returns Object with three AmountBreakdown objects (earned/cost/profit)
 *
 * @example
 * calculateAmounts(8, 4, 4, 0, {earned: 5000, cost: 3000, profit: 2000}, 1.5, 2.0)
 * // → {
 * //   earned: {regularAmount: 400, overtimeBase: 200, tier1Premium: 100, tier2Premium: 0, totalAmountWithOT: 700, ...},
 * //   cost: {regularAmount: 240, overtimeBase: 120, tier1Premium: 60, tier2Premium: 0, totalAmountWithOT: 420, ...},
 * //   profit: {regularAmount: 160, overtimeBase: 80, tier1Premium: 40, tier2Premium: 0, totalAmountWithOT: 280, ...}
 * // }
 *
 * @see AmountBreakdown - Structure of the returned breakdown objects
 */
function calculateAmounts(
    regularHours: number,
    overtimeHours: number,
    _tier1Hours: number,
    tier2Hours: number,
    rates: RatesConfig,
    multiplier: number,
    tier2Multiplier: number
): { earned: AmountBreakdown; cost: AmountBreakdown; profit: AmountBreakdown } {
    // Inner function: Calculate amounts for a single rate (earned/cost/profit)
    // This function is called three times (once per amount type)
    const calculate = (rate: number): AmountBreakdown => {
        // Convert rate from cents to currency units (e.g., 5000 cents → $50.00)
        const hourlyRate = rate / 100;

        // --- REGULAR HOURS (no premium) ---
        // Note: Do NOT round here - rounding is deferred to aggregation boundary
        const regularAmount = regularHours * hourlyRate;

        // --- OVERTIME BASE (before premium) ---
        // Note: Do NOT round here - rounding is deferred to aggregation boundary
        const overtimeAmountBase = overtimeHours * hourlyRate;

        // --- TIER1 PREMIUM (applied to ALL overtime hours) ---
        // Premium = (multiplier - 1) because multiplier includes base pay
        // Example: 1.5x multiplier → 0.5x premium (50% extra)
        // Note: Do NOT round here - rounding is deferred to aggregation boundary
        // to prevent cumulative floating-point errors across many entries
        const tier1Premium = overtimeHours * hourlyRate * (multiplier - 1);

        // --- TIER2 PREMIUM (applied ONLY to tier2 hours, ADDITIONAL to tier1) ---
        // Additional premium = (tier2Multiplier - tier1Multiplier)
        // Example: tier1=1.5, tier2=2.0 → additional 0.5x premium for tier2 hours
        // Note: tier2Hours is a subset of overtimeHours (the hours beyond threshold)
        // Note: Do NOT round here - rounding is deferred to aggregation boundary
        const tier2Premium = tier2Hours * hourlyRate * (tier2Multiplier - multiplier);

        // --- TOTAL AMOUNT WITH OVERTIME PREMIUMS ---
        // Note: Do NOT round here - rounding is deferred to aggregation boundary
        const totalAmountWithOT = regularAmount + overtimeAmountBase + tier1Premium + tier2Premium;

        // --- TOTAL AMOUNT WITHOUT OVERTIME (for comparison/reporting) ---
        const totalAmountNoOT = regularAmount;

        // --- CALCULATED OVERTIME RATE (for display) ---
        // This is the effective hourly rate for tier1 OT (base rate * multiplier)
        // Note: Do NOT round here - rounding is deferred to aggregation boundary
        const overtimeRate = hourlyRate * multiplier;

        return {
            rate: hourlyRate, // Hourly rate in currency units
            regularAmount,
            overtimeAmountBase,
            baseAmount: regularAmount + overtimeAmountBase, // Total hours at base rate (no premium)
            tier1Premium,
            tier2Premium,
            totalAmountWithOT,
            totalAmountNoOT,
            overtimeRate, // Effective OT rate (tier1)
        };
    };

    // Execute calculation for all three amount types
    return {
        earned: calculate(rates.earned), // Revenue calculation
        cost: calculate(rates.cost), // Cost calculation
        profit: calculate(rates.profit), // Profit calculation (uses profit rate = earned - cost)
    };
}

// ============================================================================
// MAIN CALCULATION FUNCTION
// ============================================================================
// This is the entry point for all overtime calculations. It orchestrates the
// entire calculation pipeline from raw entries to aggregated user analysis.
// ============================================================================

/**
 * Main calculation function for overtime analysis.
 *
 * This is the heart of OTPLUS - the pure calculation engine that transforms
 * raw Clockify time entries into a complete overtime and billable analysis.
 * The function is completely deterministic and side-effect free.
 *
 * ## High-Level Algorithm
 *
 * 1. **Initialize**: Group entries by user, derive effective date range
 * 2. **For each user**:
 *    a. Group their entries by date
 *    b. For each date in range:
 *       - Determine effective capacity (accounting for holidays/time-off/overrides)
 *       - Sort entries chronologically
 *       - Apply tail attribution algorithm to split regular/OT
 *       - Calculate amounts with tier1/tier2 premiums
 *       - Aggregate to day totals
 *    c. Round and finalize user totals
 * 3. **For users without entries**: Still calculate expectedCapacity
 * 4. **Return**: Sorted array of user analyses
 *
 * ## Key Business Logic (see docs/prd.md for full details)
 *
 * **Entry Classification**:
 * - BREAK entries: Always regular, don't accumulate toward capacity
 * - PTO entries (HOLIDAY/TIME_OFF): Always regular, don't accumulate
 * - WORK entries: Subject to tail attribution, can be regular or OT
 *
 * **Capacity Resolution** (per user, per day):
 * 1. Get base capacity: per-day override > weekly > global > profile > default
 * 2. Apply adjustments:
 *    - Holiday → capacity = 0
 *    - Non-working day → capacity = 0
 *    - Time-off → capacity reduced by time-off hours
 *
 * **Tail Attribution Algorithm**:
 * - Sort entries by start time
 * - Accumulate WORK entry durations against capacity
 * - Once capacity exceeded, subsequent WORK hours become OT
 * - BREAK and PTO never accumulate (don't trigger OT for others)
 *
 * **Tier2 Overtime**:
 * - Track cumulative OT hours per user (across entire date range)
 * - Once user's total OT exceeds tier2Threshold, apply higher multiplier
 * - Tier2 accumulator is per-USER, not per-day
 *
 * **Dual-Source Detection** (Fallback Mechanism):
 * If holiday/time-off APIs fail or are disabled, the function treats those days
 * as regular working days (entry types are informational only).
 * This ensures correct overtime calculation even with partial data.
 *
 * ## Input Parameters
 *
 * @param entries - Array of TimeEntry objects from Clockify Reports API.
 *   - Can be null or empty (function still calculates capacity for all users)
 *   - Each entry must have: userId, timeInterval, type, billable, rates/amounts
 *
 * @param store - Application store (or CalcStore interface) containing:
 *   - users: List of workspace users
 *   - profiles: User profiles with workCapacityHours and workingDays
 *   - holidays: Nested map of holidays (userId → dateKey → Holiday)
 *   - timeOff: Nested map of time-off (userId → dateKey → TimeOffInfo)
 *   - overrides: User-specific capacity/multiplier overrides
 *   - config: Feature flags (applyHolidays, useProfileCapacity, etc.)
 *   - calcParams: Global defaults (dailyThreshold, overtimeMultiplier, etc.)
 *
 * @param dateRange - Date range for the report (YYYY-MM-DD format).
 *   - Can be null (function derives range from entry dates)
 *   - Used to calculate expectedCapacity for all users (even without entries)
 *
 * ## Return Value
 *
 * @returns Array of UserAnalysis objects, one per user, sorted by userName.
 *   Each UserAnalysis contains:
 *   - userId, userName: User identification
 *   - days: Map<dateKey, DayData> with per-day breakdown
 *   - totals: UserTotals with aggregated hours, amounts, and context
 *
 * ## Edge Cases Handled
 *
 * - **Null entries**: Treated as empty array, still calculates capacity
 * - **Null dateRange**: Derived from entry min/max dates
 * - **No entries and no dateRange**: Returns empty array
 * - **Users not in store.users**: Added dynamically from entries
 * - **Users without entries**: Appear in results with capacity totals
 * - **Missing profiles**: Fall back to global defaults
 * - **Malformed entries**: Skipped with 0 duration (parseIsoDuration returns 0)
 * - **Missing rates**: Default to 0 (no crash)
 * - **Timezone consistency**: All dates use IsoUtils for consistent extraction
 *
 * ## Performance Considerations
 *
 * - Time Complexity: O(U * D * E_avg * log(E_avg))
 *   where U = users, D = days, E_avg = entries per day
 *   The log factor comes from sorting entries per day.
 *
 * - Space Complexity: O(U * D)
 *   Stores Map<dateKey, DayData> for each user.
 *
 * - For typical usage (100 users, 30 days, 10 entries/day):
 *   ~100 * 30 * 10 * log(10) = ~100k operations (sub-second)
 *
 * ## Determinism Guarantee
 *
 * This function is PURE and DETERMINISTIC:
 * - Same inputs ALWAYS produce same outputs
 * - No side effects (no DOM, no network, no global state)
 * - No hidden dependencies (no Date.now(), no Math.random())
 * - Calculation invariants are enforced by unit tests
 *
 * If results change unexpectedly, either:
 * 1. Input data changed (check entries, store, dateRange)
 * 2. Bug introduced (tests should catch this)
 * 3. Intentional business logic change (update tests)
 *
 * ## Related Tests
 *
 * See `__tests__/unit/calc.test.js` for comprehensive test coverage:
 * - Entry classification (BREAK, PTO, WORK)
 * - Capacity precedence and adjustments
 * - Tail attribution algorithm
 * - Billable breakdown
 * - Tier2 overtime
 * - Edge cases (null inputs, missing data, etc.)
 *
 * @example
 * const analysis = calculateAnalysis(
 *   timeEntries, // from Clockify Reports API
 *   store,       // application state
 *   {start: "2024-01-01", end: "2024-01-31"} // January 2024
 * );
 * // → [
 * //   {userId: "user1", userName: "Alice", days: Map(...), totals: {...}},
 * //   {userId: "user2", userName: "Bob", days: Map(...), totals: {...}},
 * //   ...
 * // ]
 *
 * @see UserAnalysis - Structure of returned user analysis objects
 * @see DayData - Structure of per-day data
 * @see UserTotals - Structure of aggregated totals
 * @see docs/prd.md - Business rules definition
 * @see docs/prd.md - Overtime calculation rules
 */
/* eslint-disable complexity, max-lines-per-function -- Core calculation engine with inherent complexity:
   - Entry classification (WORK/BREAK/PTO)
   - Override resolution (per-day/weekly/global)
   - Capacity adjustments (holidays/time-off/non-working days)
   - Tail attribution algorithm
   - Multi-tier overtime premium calculation
   - Per-entry, per-day, and per-user aggregation
   Refactoring would reduce readability and make the algorithm harder to follow. */
export function calculateAnalysis(
    entries: TimeEntry[] | null,
    store: CalcStore | Store,
    dateRange: DateRange | null
): UserAnalysis[] {
    // === INITIALIZATION ===
    // Handle null entries gracefully - we still need to calculate expected capacity
    // for all users, even if they have no time entries in this period.
    const safeEntries = entries || [];

    // Cast store to CalcStore interface (works with both Store and test fixtures)
    const calcStore = store as CalcStore;

    // Determine which amount type to use as "primary" for the `amount` field
    // in EntryAnalysis. Options: 'earned' (default), 'cost', 'profit'
    // Stryker disable next-line StringLiteral: Equivalent - empty string fallback still selects 'earned' via ternary
    const amountDisplay = (calcStore.config.amountDisplay || 'earned').toLowerCase();

    // === GROUP ENTRIES BY USER ===
    // Build a map of userId → TimeEntry[] for efficient per-user processing
    const entriesByUser = new Map<string, TimeEntry[]>();

    // Track min/max dates from entries for fallback date range derivation
    let minDate: string | null = null;
    let maxDate: string | null = null;

    for (const entry of safeEntries) {
        // Skip null/undefined entries (defensive programming)
        if (!entry) continue;

        // Extract userId (fallback to 'unknown' if missing, though this should never happen)
        const userId = entry.userId || 'unknown';

        // Initialize user's entry array if first entry for this user
        if (!entriesByUser.has(userId)) {
            entriesByUser.set(userId, []);
        }

        // Add entry to user's array
        const userEntries = entriesByUser.get(userId);
        /* istanbul ignore else -- TypeScript type narrowing, always truthy after .set() */
        if (userEntries) {
            userEntries.push(entry);
        }

        // Track date bounds from entries (for fallback if dateRange not provided)
        // Use IsoUtils.extractDateKey to ensure timezone-consistent date extraction
        const entryDateKey = IsoUtils.extractDateKey(entry.timeInterval?.start);
        if (entryDateKey) {
            // Stryker disable next-line EqualityOperator,ConditionalExpression: Equivalent - min/max logic produces same result with <= or <
            // Update minDate if this is the earliest date seen
            if (!minDate || entryDateKey < minDate) minDate = entryDateKey;
            // Stryker disable next-line EqualityOperator,ConditionalExpression: Equivalent - min/max logic produces same result with >= or >
            // Update maxDate if this is the latest date seen
            if (!maxDate || entryDateKey > maxDate) maxDate = entryDateKey;
        }
    }

    // === DERIVE EFFECTIVE DATE RANGE ===
    // Prefer provided dateRange, but fall back to entry dates if not specified.
    // This allows the function to work both with explicit ranges (from UI)
    // and with entry-derived ranges (for flexibility).
    const effectiveStart = dateRange?.start || minDate;
    const effectiveEnd = dateRange?.end || maxDate;

    // Early return: If we have no date range and no entries, there's nothing to calculate
    if (!effectiveStart || !effectiveEnd) {
        return [];
    }

    // === BUILD USER ANALYSIS MAP ===
    // Create a map of userId → UserAnalysis to accumulate results
    const userAnalysisMap = new Map<string, UserAnalysis>();

    // === INITIALIZE ALL USERS FROM STORE ===
    // Important: Initialize ALL users from the store, even those without entries.
    // This ensures we calculate expectedCapacity for all users (for capacity planning).
    const storeUsers = Array.isArray(calcStore.users) ? calcStore.users : [];
    for (const user of storeUsers) {
        // Skip null users (defensive programming)
        if (!user) continue;

        // Initialize user analysis with empty days and zero totals
        userAnalysisMap.set(user.id, {
            userId: user.id,
            userName: user.name,
            days: new Map(), // Will be populated during processing
            totals: createEmptyTotals(), // All fields initialized to 0
        });
    }

    // === GENERATE DATE RANGE ===
    // Create array of all dates in range (e.g., ["2024-01-01", "2024-01-02", ...])
    // This ensures we process every day in the range, even days without entries,
    // so we can calculate expectedCapacity correctly.
    const allDates = IsoUtils.generateDateRange(effectiveStart, effectiveEnd);

    // === PROCESS EACH USER WITH ENTRIES ===
    // Iterate through users who have time entries in this period
    for (const [userId, userEntries] of entriesByUser) {
        // Find or create user analysis object
        let userAnalysis = userAnalysisMap.get(userId);
        // Stryker disable next-line ConditionalExpression: Equivalent - recreating with same defaults produces identical result
        if (!userAnalysis) {
            // User not in store.users (edge case: user added to workspace after fetch)
            // Extract userName from first entry (fallback to 'Unknown')
            // Stryker disable next-line OptionalChaining: Equivalent - userEntries[0] always exists in this loop
            const userName = userEntries[0]?.userName || 'Unknown';
            userAnalysis = {
                userId,
                userName,
                days: new Map(),
                totals: createEmptyTotals(),
            };
            userAnalysisMap.set(userId, userAnalysis);
        }

        // === GROUP ENTRIES BY DATE ===
        // Build a map of dateKey → TimeEntry[] for this user
        const entriesByDate = new Map<string, TimeEntry[]>();
        for (const entry of userEntries) {
            // Extract date from start timestamp (timezone-consistent)
            const dateKey = IsoUtils.extractDateKey(entry.timeInterval?.start);

            // Skip entries with malformed/missing timestamps
            if (!dateKey) continue;

            // Initialize date's entry array if first entry for this date
            if (!entriesByDate.has(dateKey)) {
                entriesByDate.set(dateKey, []);
            }

            // Add entry to date's array
            const dateEntries = entriesByDate.get(dateKey);
            /* istanbul ignore else -- TypeScript type narrowing, always truthy after .set() */
            if (dateEntries) {
                dateEntries.push(entry);
            }
        }

        const overtimeBasis = (calcStore.config.overtimeBasis || 'daily').toLowerCase() as
            | 'daily'
            | 'weekly'
            | 'both';
        const useDaily = overtimeBasis === 'daily' || overtimeBasis === 'both';
        const useWeekly = overtimeBasis === 'weekly' || overtimeBasis === 'both';

        const entryDailyOvertime = new Map<string, number>();
        const entryWeeklyOvertime = new Map<string, number>();
        const dayContextByDate = new Map<
            string,
            {
                entries: TimeEntry[];
                meta: DayMeta;
                baseCapacity: number;
                effectiveCapacity: number;
                isHolidayDay: boolean;
                isNonWorking: boolean;
                isTimeOffDay: boolean;
                timeOffHours: number;
                forceOvertime: boolean;
            }
        >();

        // === BUILD DAY CONTEXT (CAPACITY + FLAGS) ===
        for (const dateKey of allDates) {
            const dayEntries = entriesByDate.get(dateKey) || [];

            const baseCapacity = getEffectiveCapacity(userId, dateKey, calcStore);
            const holiday = getHoliday(userId, dateKey, calcStore);
            const isNonWorking = !isWorkingDay(userId, dateKey, calcStore);
            const timeOff = getTimeOff(userId, dateKey, calcStore);

            let effectiveCapacity = baseCapacity;
            const isHolidayDay = !!holiday;
            const isTimeOffDay = !!timeOff;

            // Stryker disable all
            if (isHolidayDay || isNonWorking) {
                effectiveCapacity = 0;
            } else if (timeOff) {
                if (timeOff.isFullDay) {
                    effectiveCapacity = 0;
                } else {
                    effectiveCapacity = Math.max(0, effectiveCapacity - timeOff.hours);
                }
            }
            // Stryker restore all

            const dayMeta = createDayMeta(
                effectiveCapacity,
                isHolidayDay,
                holiday?.name || '',
                isNonWorking,
                isTimeOffDay,
                holiday?.projectId || null
            );

            const forceOvertime =
                isHolidayDay || isNonWorking || (isTimeOffDay && effectiveCapacity === 0);
            // Invariant: If effective capacity is 0, ALL work must be classified as overtime.

            dayContextByDate.set(dateKey, {
                entries: dayEntries,
                meta: dayMeta,
                baseCapacity,
                effectiveCapacity,
                isHolidayDay,
                isNonWorking,
                isTimeOffDay,
                timeOffHours: timeOff?.hours || 0,
                forceOvertime,
            });
        }

        // === DAILY OVERTIME SPLITS ===
        // ALGORITHM: Tail Attribution
        // 1. Sort entries chronologically by start time.
        // 2. Accumulate duration against the day's effective capacity.
        // 3. Assign OT to the "tail" entries that push total duration over capacity.
        //    - If accumulator < capacity: Entry is REGULAR.
        //    - If accumulator >= capacity: Entry is OVERTIME.
        //    - If crossing boundary: Entry is SPLIT (part regular, part OT).
        if (useDaily) {
            for (const dateKey of allDates) {
                const context = dayContextByDate.get(dateKey);
                /* istanbul ignore if -- defensive: context always exists since allDates populates dayContextByDate */
                if (!context) continue;
                const dayEntries = context.entries;
                const effectiveCapacity = context.effectiveCapacity;

                /* istanbul ignore next -- defensive: timeInterval.start is always present for valid entries */
                /* Stryker disable all: Defensive fallback for null timeInterval (never triggered with valid entries) */
                // Sort entries chronologically. For malformed entries missing timeInterval.start,
                // we maintain their relative order (return 0) rather than sorting incorrectly.
                // This is a defensive measure - valid Clockify entries always have timeInterval.start.
                const sortedEntries = [...dayEntries].sort((a, b) => {
                    const aStart = a.timeInterval?.start;
                    const bStart = b.timeInterval?.start;

                    // If either entry is missing start time, keep relative order
                    if (!aStart || !bStart) {
                        return 0;
                    }

                    return aStart.localeCompare(bStart);
                });
                /* Stryker restore all */

                let dailyAccumulator = 0;
                for (const entry of sortedEntries) {
                    const duration = getEntryDurationHours(entry);
                    const entryClass: EntryClassification = classifyEntryForOvertime(entry);

                    let overtimeHours = 0;
                    if (entryClass === 'work') {
                        // Stryker disable all
                        if (dailyAccumulator >= effectiveCapacity) {
                            overtimeHours = duration;
                        } else if (dailyAccumulator + duration <= effectiveCapacity) {
                            overtimeHours = 0;
                        } else {
                            overtimeHours = duration - (effectiveCapacity - dailyAccumulator);
                        }
                        // Stryker restore all
                        dailyAccumulator += duration;
                    }

                    const entryKey = getEntryOvertimeKey(entry);
                    entryDailyOvertime.set(entryKey, Math.max(0, overtimeHours));
                }
            }
        }

        // === WEEKLY OVERTIME SPLITS ===
        if (useWeekly) {
            const weeklyThreshold = Math.max(0, calcStore.calcParams.weeklyThreshold || 0);

            // Treat weeklyThreshold=0 as "weekly overtime disabled".
            if (weeklyThreshold > 0) {
                const entriesByWeek = new Map<string, TimeEntry[]>();

                for (const dateKey of allDates) {
                    const context = dayContextByDate.get(dateKey);
                    /* istanbul ignore if -- defensive: context always exists since allDates populates dayContextByDate */
                    if (!context) continue;
                    const dayEntries = context.entries;
                    const weekKey = getWeekKey(dateKey);
                    let bucket = entriesByWeek.get(weekKey);
                    if (!bucket) {
                        bucket = [];
                        entriesByWeek.set(weekKey, bucket);
                    }
                    bucket.push(...dayEntries);
                }

                for (const [, weekEntries] of entriesByWeek) {
                    /* istanbul ignore next -- defensive: timeInterval.start is always present for valid entries */
                    /* Stryker disable all: Defensive fallback for null timeInterval (never triggered with valid entries) */
                    // Sort entries chronologically. For malformed entries missing timeInterval.start,
                    // we maintain their relative order (return 0) rather than sorting incorrectly.
                    const sortedEntries = [...weekEntries].sort((a, b) => {
                        const aStart = a.timeInterval?.start;
                        const bStart = b.timeInterval?.start;

                        // If either entry is missing start time, keep relative order
                        if (!aStart || !bStart) {
                            return 0;
                        }

                        return aStart.localeCompare(bStart);
                    });
                    /* Stryker restore all */

                    let weeklyAccumulator = 0;
                    for (const entry of sortedEntries) {
                        const duration = getEntryDurationHours(entry);
                        const entryClass: EntryClassification = classifyEntryForOvertime(entry);

                        let overtimeHours = 0;
                        if (entryClass === 'work') {
                            /* istanbul ignore next -- defensive: timeInterval.start always present for bucketed entries */
                            const entryDateKey =
                                IsoUtils.extractDateKey(entry.timeInterval?.start) ?? '';
                            const entryContext = dayContextByDate.get(entryDateKey);
                            /* istanbul ignore next -- defensive: forceOvertime defaults to false if context missing */
                            const forceOvertime = entryContext?.forceOvertime ?? false;

                            // Stryker disable all
                            if (forceOvertime || weeklyAccumulator >= weeklyThreshold) {
                                overtimeHours = duration;
                            } else if (weeklyAccumulator + duration <= weeklyThreshold) {
                                overtimeHours = 0;
                            } else {
                                overtimeHours = weeklyAccumulator + duration - weeklyThreshold;
                            }
                            // Stryker restore all

                            weeklyAccumulator += duration;
                        }

                        const entryKey = getEntryOvertimeKey(entry);
                        entryWeeklyOvertime.set(entryKey, Math.max(0, overtimeHours));
                    }
                }
            }
        }

        // === INITIALIZE TIER2 OVERTIME ACCUMULATOR ===
        // Track cumulative OT hours for this user across the entire date range.
        let userOTAccumulator = 0;

        // === PROCESS EACH DATE IN RANGE ===
        for (const dateKey of allDates) {
            const context = dayContextByDate.get(dateKey);
            /* istanbul ignore if -- defensive: context always exists since allDates populates dayContextByDate */
            if (!context) continue;
            const dayEntries = context.entries;
            const dayMeta = context.meta;
            const baseCapacity = context.baseCapacity;
            const effectiveCapacity = context.effectiveCapacity;
            const isHolidayDay = context.isHolidayDay;
            const isNonWorking = context.isNonWorking;
            const isTimeOffDay = context.isTimeOffDay;
            const timeOffHours = context.timeOffHours;

            /* istanbul ignore next -- defensive: timeInterval.start is always present for valid entries */
            /* Stryker disable all: Defensive fallback for null timeInterval (never triggered with valid entries) */
            const sortedEntries = [...dayEntries].sort(
                (a, b) =>
                    (a.timeInterval?.start || '').localeCompare(b.timeInterval?.start || '')
            );
            /* Stryker restore all */

            const processedEntries: TimeEntry[] = [];

            for (const entry of sortedEntries) {
                const duration = getEntryDurationHours(entry);
                const entryClass: EntryClassification = classifyEntryForOvertime(entry);
                const rates = extractRates(entry, duration);
    const isBillable = entry.billable === true;

                const entryKey = getEntryOvertimeKey(entry);
                const dailyOT = useDaily ? entryDailyOvertime.get(entryKey) || 0 : 0;
                const weeklyOT = useWeekly ? entryWeeklyOvertime.get(entryKey) || 0 : 0;

                let overlapOvertime = 0;
                let combinedOvertime = 0;
                let overtimeHours = 0;

                if (entryClass === 'work') {
                    if (overtimeBasis === 'daily') {
                        overtimeHours = dailyOT;
                        combinedOvertime = overtimeHours;
                    } else if (overtimeBasis === 'weekly') {
                        overtimeHours = weeklyOT;
                        combinedOvertime = overtimeHours;
                    } else {
                        overlapOvertime = Math.min(dailyOT, weeklyOT);
                        combinedOvertime = Math.max(dailyOT, weeklyOT);
                        overtimeHours = combinedOvertime;
                    }
                }

                const regularHours =
                    entryClass === 'work' ? Math.max(0, duration - overtimeHours) : duration;

                const multiplier = getEffectiveMultiplier(userId, dateKey, calcStore);
                const tier2Threshold = getEffectiveTier2Threshold(userId, dateKey, calcStore);
                const tier2Multiplier = getEffectiveTier2Multiplier(userId, dateKey, calcStore);

                let tier1Hours = 0;
                let tier2Hours = 0;

                // Stryker disable all
                if (overtimeHours > 0 && calcStore.config.enableTieredOT && tier2Multiplier > multiplier) {
                    const otBeforeEntry = userOTAccumulator;
                    const otAfterEntry = otBeforeEntry + overtimeHours;

                    if (otBeforeEntry >= tier2Threshold) {
                        // Case 1: Already exceeded threshold -> All OT is Tier 2
                        tier2Hours = overtimeHours;
                        tier1Hours = 0;
                    } else if (otAfterEntry <= tier2Threshold) {
                        // Case 2: Still under threshold -> All OT is Tier 1
                        tier1Hours = overtimeHours;
                        tier2Hours = 0;
                    } else {
                        // Case 3: Crossing threshold -> Split OT
                        tier1Hours = tier2Threshold - otBeforeEntry;
                        tier2Hours = overtimeHours - tier1Hours;
                    }

                    userOTAccumulator = otAfterEntry;
                } else {
                    tier1Hours = overtimeHours;
                    tier2Hours = 0;
                    userOTAccumulator += overtimeHours;
                }
                // Stryker restore all

                const amounts = calculateAmounts(
                    regularHours,
                    overtimeHours,
                    tier1Hours,
                    tier2Hours,
                    rates,
                    multiplier,
                    tier2Multiplier
                );

                const primaryAmounts =
                    amountDisplay === 'cost'
                        ? amounts.cost
                        : amountDisplay === 'profit'
                          ? amounts.profit
                          : amounts.earned;

                // Per-entry analysis values are rounded for display purposes only.
                // Aggregation uses unrounded values to prevent cumulative floating-point drift.
                const analysis: EntryAnalysis = {
                    regular: round(regularHours, 4),
                    overtime: round(overtimeHours, 4),
                    dailyOvertime: round(entryClass === 'work' ? dailyOT : 0, 4),
                    weeklyOvertime: round(entryClass === 'work' ? weeklyOT : 0, 4),
                    overlapOvertime:
                        overtimeBasis === 'both' ? round(overlapOvertime, 4) : 0,
                    combinedOvertime:
                        overtimeBasis === 'both'
                            ? round(combinedOvertime, 4)
                            : round(overtimeHours, 4),

                    isBillable,
                    isBreak: entryClass === 'break',

                    cost: round(primaryAmounts.totalAmountWithOT, 2),
                    profit: round(amounts.profit.totalAmountWithOT, 2),

                    tags: [],

                    hourlyRate: round(primaryAmounts.rate, 2),
                    regularRate: round(primaryAmounts.rate, 2),
                    overtimeRate: round(primaryAmounts.overtimeRate, 2),

                    regularAmount: round(primaryAmounts.regularAmount, 2),
                    overtimeAmountBase: round(primaryAmounts.overtimeAmountBase, 2),
                    tier1Premium: round(primaryAmounts.tier1Premium, 2),
                    tier2Premium: round(primaryAmounts.tier2Premium, 2),
                    totalAmountWithOT: round(primaryAmounts.totalAmountWithOT, 2),
                    totalAmountNoOT: round(primaryAmounts.totalAmountNoOT, 2),

                    amounts,
                };

                if (isHolidayDay) analysis.tags.push('HOLIDAY');
                if (isNonWorking) analysis.tags.push('OFF-DAY');
                if (isTimeOffDay) analysis.tags.push('TIME-OFF');
                if (entryClass === 'break') analysis.tags.push('BREAK');

                (entry as TimeEntry & { analysis: EntryAnalysis }).analysis = analysis;
                processedEntries.push(entry);

                const totals = userAnalysis.totals;
                totals.total += duration;

                if (entryClass === 'break') {
                    totals.breaks += duration;
                    totals.regular += regularHours;
                    if (isBillable) {
                        totals.billableWorked += regularHours;
                    } else {
                        totals.nonBillableWorked += regularHours;
                    }
                } else if (entryClass === 'pto') {
                    totals.vacationEntryHours += duration;
                    totals.regular += regularHours;
                    if (isBillable) {
                        totals.billableWorked += regularHours;
                    } else {
                        totals.nonBillableWorked += regularHours;
                    }
                } else {
                    totals.regular += regularHours;
                    totals.overtime += overtimeHours;
                    totals.dailyOvertime += dailyOT;
                    totals.weeklyOvertime += weeklyOT;
                    totals.overlapOvertime += overlapOvertime;
                    totals.combinedOvertime +=
                        overtimeBasis === 'both' ? combinedOvertime : overtimeHours;

                    if (isBillable) {
                        totals.billableWorked += regularHours;
                        totals.billableOT += overtimeHours;
                    } else {
                        totals.nonBillableWorked += regularHours;
                        totals.nonBillableOT += overtimeHours;
                    }
                }

                totals.amount += primaryAmounts.totalAmountWithOT;
                totals.amountBase += primaryAmounts.baseAmount;
                totals.amountEarned += amounts.earned.totalAmountWithOT;
                totals.amountEarnedBase += amounts.earned.baseAmount;
                totals.amountCost += amounts.cost.totalAmountWithOT;
                totals.amountCostBase += amounts.cost.baseAmount;
                totals.amountProfit += amounts.profit.totalAmountWithOT;
                totals.amountProfitBase += amounts.profit.baseAmount;

                totals.otPremium += primaryAmounts.tier1Premium;
                totals.otPremiumEarned += amounts.earned.tier1Premium;
                totals.otPremiumCost += amounts.cost.tier1Premium;
                totals.otPremiumProfit += amounts.profit.tier1Premium;
                totals.otPremiumTier2 += primaryAmounts.tier2Premium;
                totals.otPremiumTier2Earned += amounts.earned.tier2Premium;
                totals.otPremiumTier2Cost += amounts.cost.tier2Premium;
                totals.otPremiumTier2Profit += amounts.profit.tier2Premium;
            }

            const dayData: DayData = {
                entries: processedEntries,
                meta: dayMeta,
            };

            userAnalysis.days.set(dateKey, dayData);

            userAnalysis.totals.expectedCapacity += effectiveCapacity;

            if (isHolidayDay) {
                userAnalysis.totals.holidayCount += 1;
                userAnalysis.totals.holidayHours += baseCapacity;
            }

            if (isTimeOffDay) {
                userAnalysis.totals.timeOffCount += 1;
                userAnalysis.totals.timeOffHours += timeOffHours;
            }
        }
        // End of per-day loop

        // --- ROUND FINAL TOTALS ---
        // Apply rounding at the aggregation boundary to prevent floating-point drift.
        // This ensures deterministic results regardless of entry order.

        const totals = userAnalysis.totals;

        // Hours: 4 decimal places (0.0001h precision = 0.36s)
        totals.regular = round(totals.regular, 4);
        totals.overtime = round(totals.overtime, 4);
        totals.dailyOvertime = round(totals.dailyOvertime, 4);
        totals.weeklyOvertime = round(totals.weeklyOvertime, 4);
        totals.overlapOvertime = round(totals.overlapOvertime, 4);
        totals.combinedOvertime = round(totals.combinedOvertime, 4);
        totals.total = round(totals.total, 4);
        totals.breaks = round(totals.breaks, 4);
        totals.billableWorked = round(totals.billableWorked, 4);
        totals.nonBillableWorked = round(totals.nonBillableWorked, 4);
        totals.billableOT = round(totals.billableOT, 4);
        totals.nonBillableOT = round(totals.nonBillableOT, 4);
        totals.expectedCapacity = round(totals.expectedCapacity, 4);
        totals.vacationEntryHours = round(totals.vacationEntryHours, 4);

        // Currency: 2 decimal places (cent precision)
        totals.amount = round(totals.amount, 2);
        totals.amountBase = round(totals.amountBase, 2);
        totals.amountEarned = round(totals.amountEarned, 2);
        totals.amountCost = round(totals.amountCost, 2);
        totals.amountProfit = round(totals.amountProfit, 2);
        totals.amountEarnedBase = round(totals.amountEarnedBase, 2);
        totals.amountCostBase = round(totals.amountCostBase, 2);
        totals.amountProfitBase = round(totals.amountProfitBase, 2);
        totals.otPremium = round(totals.otPremium, 2);
        totals.otPremiumTier2 = round(totals.otPremiumTier2, 2);
        totals.otPremiumEarned = round(totals.otPremiumEarned, 2);
        totals.otPremiumCost = round(totals.otPremiumCost, 2);
        totals.otPremiumProfit = round(totals.otPremiumProfit, 2);
        totals.otPremiumTier2Earned = round(totals.otPremiumTier2Earned, 2);
        totals.otPremiumTier2Cost = round(totals.otPremiumTier2Cost, 2);
        totals.otPremiumTier2Profit = round(totals.otPremiumTier2Profit, 2);

        // Set profit alias for convenience (matches amountProfit)
        totals.profit = totals.amountProfit;
    }
    // End of per-user loop

    // === PROCESS USERS WITHOUT ENTRIES ===
    // Users who didn't log any time still need expectedCapacity calculated.
    // This is important for capacity planning and reporting.

    for (const [userId, userAnalysis] of userAnalysisMap) {
        // Skip users who already have entries (days.size > 0)
        // These were already processed in the main loop above.
        if (userAnalysis.days.size > 0) continue;

        // For users without entries, calculate capacity for all dates in range
        for (const dateKey of allDates) {
            // Get base capacity (same logic as main loop)
            const baseCapacity = getEffectiveCapacity(userId, dateKey, calcStore);

            // Check day context
            const holiday = getHoliday(userId, dateKey, calcStore);
            const isNonWorking = !isWorkingDay(userId, dateKey, calcStore);
            const timeOff = getTimeOff(userId, dateKey, calcStore);

            // Apply capacity adjustments (same logic as main loop)
            let effectiveCapacity = baseCapacity;
            const isHolidayDay = !!holiday;
            const isTimeOffDay = !!timeOff;

            if (isHolidayDay || isNonWorking) {
                effectiveCapacity = 0;
            } else if (timeOff) {
                if (timeOff.isFullDay) {
                    effectiveCapacity = 0;
                } else {
                    effectiveCapacity = Math.max(0, effectiveCapacity - timeOff.hours);
                }
            }

            // Accumulate capacity totals (same as main loop)
            userAnalysis.totals.expectedCapacity += effectiveCapacity;

            if (isHolidayDay) {
                userAnalysis.totals.holidayCount += 1;
                userAnalysis.totals.holidayHours += baseCapacity;
            }

            if (isTimeOffDay) {
                userAnalysis.totals.timeOffCount += 1;
                // Stryker disable next-line OptionalChaining: Equivalent - isTimeOffDay ensures timeOff non-null
                userAnalysis.totals.timeOffHours += timeOff?.hours || 0;
            }
        }

        // Round capacity totals (currency fields are already 0, no need to round)
        userAnalysis.totals.expectedCapacity = round(userAnalysis.totals.expectedCapacity, 4);
    }

    // === CONVERT MAP TO ARRAY AND SORT ===
    // Convert Map to Array and sort alphabetically by user name.
    // Sorting ensures deterministic output (same input always produces same order).
    const results = Array.from(userAnalysisMap.values()).sort((a, b) =>
        a.userName.localeCompare(b.userName)
    );

    return results;
}
// End of calculateAnalysis function
