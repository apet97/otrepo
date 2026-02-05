/**
 * @fileoverview TypeScript Type Definitions
 * Centralized type definitions shared across the OTPLUS application.
 */

// ==================== TIME ENTRY TYPES ====================

/**
 * Represents a single time entry fetched from Clockify.
 *
 * DATA FLATTENING:
 * The Reports API returns nested objects for project, client, and task.
 * We flatten these into top-level ID/Name fields during transformation (in api.ts)
 * to simplify downstream access in sorting, grouping, and rendering logic.
 */
export interface TimeEntry {
    /** Unique identifier for the entry */
    id: string;
    /** User ID */
    userId: string;
    /** User display name */
    userName: string;
    /** User email address */
    userEmail?: string;
    /** Entry description */
    description?: string;
    /** Whether entry is billable */
    billable?: boolean;
    /** Entry type (e.g., 'REGULAR', 'BREAK', 'HOLIDAY', 'TIME_OFF') */
    type?: string;
    /** Time period */
    timeInterval: TimeInterval;
    /** Project information */
    project?: {
        id?: string;
        name?: string;
    };
    /** Project ID (flattened from Reports API) */
    projectId?: string;
    /** Project name (flattened from Reports API) */
    projectName?: string;
    /** Client ID */
    clientId?: string | null;
    /** Client name */
    clientName?: string | null;
    /** Task ID */
    taskId?: string;
    /** Task name */
    taskName?: string;
    /** Rate information */
    hourlyRate?: {
        amount: number;
        currency?: string;
    };
    /** Earned/billable rate in cents */
    earnedRate?: number | { amount: number };
    /** Cost rate in cents */
    costRate?: number | { amount: number };
    /** Amounts array from Reports API */
    amounts?: Amount[];
    /** Tags array */
    tags?: Tag[];
    /** Calculated analysis data attached during processing */
    analysis?: EntryAnalysis;
    /** Contextual data about the day */
    dayMeta?: DayMeta;
}

/**
 * Time interval for an entry
 */
export interface TimeInterval {
    /** ISO 8601 start timestamp */
    start: string;
    /** ISO 8601 end timestamp */
    end: string;
    /** ISO 8601 duration (e.g., PT8H30M) */
    duration?: string | null;
}

/**
 * Amount from Reports API
 */
export interface Amount {
    type?: string;
    amountType?: string;
    value?: number;
    amount?: number;
}

/**
 * Tag attached to an entry
 */
export interface Tag {
    id?: string;
    name?: string;
}

// ==================== USER TYPES ====================

/**
 * Represents a Clockify User.
 */
export interface User {
    /** User ID */
    id: string;
    /** User display name */
    name: string;
    /** User email */
    email?: string;
    /** User status (e.g., 'ACTIVE') */
    status?: string;
}

/**
 * Represents a user's workspace profile settings.
 */
export interface UserProfile {
    /** User ID */
    userId?: string;
    /** Daily capacity in hours (e.g., 7.5) */
    workCapacityHours: number;
    /** Array of weekday keys ['MONDAY', 'TUESDAY', ...] */
    workingDays?: string[];
    /** ISO 8601 duration string (e.g., 'PT8H') */
    workCapacity?: string;
}

// ==================== HOLIDAY & TIME OFF TYPES ====================

/**
 * Represents a holiday.
 */
export interface Holiday {
    /** Holiday name */
    name: string;
    /** Date range */
    datePeriod: {
        startDate: string;
        endDate?: string;
    };
    /** Associated project ID */
    projectId?: string;
}

/**
 * Represents a time off request.
 */
export interface TimeOffRequest {
    /** User ID */
    userId?: string;
    /** Requester user ID */
    requesterUserId?: string;
    /** Time off period */
    timeOffPeriod: {
        start?: string;
        end?: string;
        startDate?: string;
        endDate?: string;
        halfDay?: boolean;
        halfDayHours?: number;
        period?: {
            start?: string;
            end?: string;
        };
    };
    /** Request status */
    status: string | { statusType: string };
    /** Time unit ('DAYS' or 'HOURS') */
    timeUnit?: string;
}

/**
 * Processed time off info for a specific day
 */
export interface TimeOffInfo {
    /** Whether it's a full day */
    isFullDay: boolean;
    /** Hours of time off */
    hours: number;
}

// ==================== ANALYSIS TYPES ====================

/**
 * Analysis data calculated for a specific time entry.
 */
export interface EntryAnalysis {
    /** Regular hours */
    regular: number;
    /** Overtime hours */
    overtime: number;
    /** Daily overtime hours (daily basis) */
    dailyOvertime?: number;
    /** Weekly overtime hours (weekly basis) */
    weeklyOvertime?: number;
    /** Overlap between daily and weekly overtime (both mode) */
    overlapOvertime?: number;
    /** Combined overtime (union of daily + weekly, both mode) */
    combinedOvertime?: number;
    /** Whether entry is billable */
    isBillable: boolean;
    /** Whether entry is a break */
    isBreak?: boolean;
    /** Displayed total amount in currency */
    cost: number;
    /** Total profit in currency */
    profit: number;
    /** Array of tags like ['HOLIDAY', 'OFF-DAY'] */
    tags: string[];
    /** Hourly rate used */
    hourlyRate?: number;
    /** Regular rate */
    regularRate?: number;
    /** Overtime rate */
    overtimeRate?: number;
    /** Regular amount */
    regularAmount?: number;
    /** Overtime base amount (before premium) */
    overtimeAmountBase?: number;
    /** Tier 1 premium */
    tier1Premium?: number;
    /** Tier 2 premium */
    tier2Premium?: number;
    /** Total amount including OT premium */
    totalAmountWithOT?: number;
    /** Total amount without OT premium */
    totalAmountNoOT?: number;
    /**
     * Amounts breakdown by type.
     *
     * AMOUNT TRIANGULATION:
     * We calculate three parallel currency tracks for every entry:
     * 1. Earned: Billable revenue (Client Charge)
     * 2. Cost: Internal expense (Employee Pay)
     * 3. Profit: Earned - Cost
     *
     * This allows the UI to instantly switch views without recalculating.
     */
    amounts?: {
        earned: AmountBreakdown;
        cost: AmountBreakdown;
        profit: AmountBreakdown;
    };
}

/**
 * Amount breakdown for cost calculations
 */
export interface AmountBreakdown {
    rate: number;
    regularAmount: number;
    overtimeAmountBase: number;
    baseAmount: number;
    tier1Premium: number;
    tier2Premium: number;
    totalAmountWithOT: number;
    totalAmountNoOT: number;
    overtimeRate: number;
}

/**
 * Metadata about a day's context
 */
export interface DayMeta {
    /** Effective capacity for the day */
    capacity?: number;
    /** Whether it's a holiday */
    isHoliday: boolean;
    /** Holiday name if applicable */
    holidayName?: string;
    /** Whether it's a non-working day */
    isNonWorking: boolean;
    /** Whether user has time off */
    isTimeOff: boolean;
    /** Associated holiday project ID */
    holidayProjectId?: string | null;
}

/**
 * Aggregated data for a single day for a user.
 */
export interface DayData {
    /** Array of time entries for the day */
    entries: TimeEntry[];
    /** Metadata about the day's capacity context */
    meta?: DayMeta;
}

/**
 * Aggregated totals for a user across the entire report period.
 */
export interface UserTotals {
    /** Total regular hours */
    regular: number;
    /** Total overtime hours */
    overtime: number;
    /** Daily overtime hours (daily basis) */
    dailyOvertime: number;
    /** Weekly overtime hours (weekly basis) */
    weeklyOvertime: number;
    /** Overlap between daily and weekly overtime (both mode) */
    overlapOvertime: number;
    /** Combined overtime (union of daily + weekly, both mode) */
    combinedOvertime: number;
    /** Total hours (regular + overtime) */
    total: number;
    /** Total break hours */
    breaks: number;
    /** Total billable worked hours */
    billableWorked: number;
    /** Total non-billable worked hours */
    nonBillableWorked: number;
    /** Total billable overtime hours */
    billableOT: number;
    /** Total non-billable overtime hours */
    nonBillableOT: number;
    /** Total amount in currency (selected display mode) */
    amount: number;
    /** Base amount without OT premium */
    amountBase: number;
    /** Earned amount total */
    amountEarned: number;
    /** Cost amount total */
    amountCost: number;
    /** Profit amount total */
    amountProfit: number;
    /** Earned base amount */
    amountEarnedBase: number;
    /** Cost base amount */
    amountCostBase: number;
    /** Profit base amount */
    amountProfitBase: number;
    /** Total profit in currency */
    profit: number;
    /** Overtime premium amount */
    otPremium: number;
    /** Tier 2 overtime premium */
    otPremiumTier2: number;
    /** Earned OT premium */
    otPremiumEarned: number;
    /** Cost OT premium */
    otPremiumCost: number;
    /** Profit OT premium */
    otPremiumProfit: number;
    /** Earned Tier 2 premium */
    otPremiumTier2Earned: number;
    /** Cost Tier 2 premium */
    otPremiumTier2Cost: number;
    /** Profit Tier 2 premium */
    otPremiumTier2Profit: number;
    /** Expected capacity across date range */
    expectedCapacity: number;
    /** Number of holidays */
    holidayCount: number;
    /** Number of time off days */
    timeOffCount: number;
    /** Total holiday hours */
    holidayHours: number;
    /** Total time off hours */
    timeOffHours: number;
    /** Actual HOLIDAY/TIME_OFF entry durations */
    vacationEntryHours: number;
}

/**
 * Complete analysis result for a user.
 */
export interface UserAnalysis {
    /** User ID */
    userId: string;
    /** User display name */
    userName: string;
    /** Map of date keys to day data */
    days: Map<string, DayData>;
    /** Aggregated totals */
    totals: UserTotals;
}

// ==================== CONFIGURATION TYPES ====================

/**
 * Global configuration object for calculation settings.
 */
export interface OvertimeConfig {
    /** Use profile capacity if available */
    useProfileCapacity: boolean;
    /** Respect profile working days */
    useProfileWorkingDays: boolean;
    /** Apply holidays to capacity calculation */
    applyHolidays: boolean;
    /** Apply time off to capacity calculation */
    applyTimeOff: boolean;
    /** Show billable breakdown in UI */
    showBillableBreakdown: boolean;
    /** Show decimal time format */
    showDecimalTime: boolean;
    /** Enable tiered overtime (tier 2) - default false */
    enableTieredOT: boolean;
    /** Amount display mode */
    amountDisplay: 'earned' | 'cost' | 'profit';
    /** Overtime calculation basis */
    overtimeBasis: 'daily' | 'weekly' | 'both';
    /** Maximum pages to fetch from Reports API (0 = unlimited up to hard limit) */
    maxPages?: number;
    /** Enable encryption for localStorage data (default: true for enterprise security) */
    encryptStorage?: boolean;
    /**
     * Enable audit logging of configuration and override changes.
     * When enabled, the following events are logged (with hashed IDs, no PII):
     * - CONFIG_CHANGE: Feature toggle and calculation parameter changes
     * - OVERRIDE_CHANGE: User capacity/multiplier override modifications
     * - EXPORT: CSV export operations (date range, counts, filename)
     *
     * Default: true for enterprise compliance. Set to false to disable audit logging.
     */
    auditConsent?: boolean;
    /** Token bucket rate limit capacity (requests per refill). Default: 50 */
    rateLimitCapacity?: number;
    /** Token bucket refill interval in ms. Default: 1000 */
    rateLimitRefillMs?: number;
    /** Circuit breaker failure threshold before opening. Default: 5 */
    circuitBreakerFailureThreshold?: number;
    /** Circuit breaker reset timeout in ms. Default: 30000 */
    circuitBreakerResetMs?: number;
}

/**
 * Parameters for calculations.
 */
export interface CalculationParams {
    /** Default daily capacity in hours (e.g., 8) */
    dailyThreshold: number;
    /** Default weekly capacity in hours (e.g., 40) */
    weeklyThreshold: number;
    /** Overtime premium multiplier (e.g., 1.5) */
    overtimeMultiplier: number;
    /** Tier 2 threshold in OT hours */
    tier2ThresholdHours: number;
    /** Tier 2 multiplier */
    tier2Multiplier: number;
}

/**
 * Per-day override for a specific date.
 */
export interface PerDayOverride {
    /** Capacity for specific day in hours */
    capacity?: string | number;
    /** Multiplier for specific day */
    multiplier?: string | number;
    /** Tier 2 threshold for specific day */
    tier2Threshold?: string | number;
    /** Tier 2 multiplier for specific day */
    tier2Multiplier?: string | number;
}

/**
 * Weekly override for a specific weekday.
 */
export interface WeeklyOverride {
    /** Capacity for specific weekday in hours */
    capacity?: string | number;
    /** Multiplier for specific weekday */
    multiplier?: string | number;
    /** Tier 2 threshold for specific weekday */
    tier2Threshold?: string | number;
    /** Tier 2 multiplier for specific weekday */
    tier2Multiplier?: string | number;
}

/**
 * User-specific overrides for calculation parameters.
 */
export interface UserOverride {
    /** Override mode (global, weekly, or perDay) */
    mode?: 'global' | 'weekly' | 'perDay';
    /** Global capacity override in hours */
    capacity?: string | number;
    /** Global overtime multiplier */
    multiplier?: string | number;
    /** Global tier 2 threshold */
    tier2Threshold?: string | number;
    /** Global tier 2 multiplier */
    tier2Multiplier?: string | number;
    /** Per-day overrides keyed by dateKey (YYYY-MM-DD) */
    perDayOverrides?: Record<string, PerDayOverride>;
    /** Weekly overrides keyed by weekday (MONDAY, TUESDAY, etc.) */
    weeklyOverrides?: Record<string, WeeklyOverride>;
}

// ==================== API & ERROR TYPES ====================

/**
 * Tracking object for API failures.
 */
export interface ApiStatus {
    /** Count of failed profile fetches */
    profilesFailed: number;
    /** Count of failed holiday fetches */
    holidaysFailed: number;
    /** Count of failed time off fetches */
    timeOffFailed: number;
}

/**
 * User-friendly error object.
 */
export interface FriendlyError {
    /** Error type from ERROR_TYPES */
    type: string;
    /** User-friendly error title */
    title: string;
    /** User-friendly error message */
    message: string;
    /** Suggested action ('retry', 'reload', 'none') */
    action: 'retry' | 'reload' | 'none';
    /** Original error object */
    originalError?: Error | string;
    /** ISO timestamp of when error occurred */
    timestamp: string;
    /** Error stack trace for debugging */
    stack?: string;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
    /** Response data */
    data: T | null;
    /** Whether the request failed */
    failed: boolean;
    /** HTTP status code */
    status: number;
}

// ==================== UI TYPES ====================

/**
 * UI state object
 */
export interface UIState {
    /** Whether loading indicator is shown */
    isLoading: boolean;
    /** Whether summary is expanded */
    summaryExpanded: boolean;
    /** Summary grouping criterion */
    summaryGroupBy: 'user' | 'project' | 'client' | 'task' | 'date' | 'week';
    /** Whether overrides section is collapsed */
    overridesCollapsed: boolean;
    /** Active tab */
    activeTab: 'summary' | 'detailed';
    /** Current detailed table page */
    detailedPage: number;
    /** Detailed table page size */
    detailedPageSize: number;
    /** Active detailed filter */
    activeDetailedFilter: 'all' | 'holiday' | 'offday' | 'billable';
    /** Whether cost rates are available */
    hasCostRates: boolean;
    /** Whether any amounts/rates are available */
    hasAmountRates: boolean;
    /** Whether pagination was truncated (results may be incomplete) */
    paginationTruncated: boolean;
    /** Whether pagination was aborted due to token expiration */
    paginationAbortedDueToTokenExpiration: boolean;
}

/**
 * Date range for calculations
 */
export interface DateRange {
    /** Start date (YYYY-MM-DD) */
    start: string;
    /** End date (YYYY-MM-DD) */
    end: string;
}

/**
 * JWT token claims from Clockify
 */
export interface TokenClaims {
    /** Workspace ID */
    workspaceId: string;
    /** Backend URL for API calls */
    backendUrl: string;
    /** Reports API URL */
    reportsUrl?: string;
    /** Optional workspace timezone (if provided by Clockify) */
    workspaceTimeZone?: string;
    /** Optional alternate workspace timezone field */
    workspaceTimezone?: string;
    /** Optional user timezone */
    timeZone?: string;
    /** Theme preference */
    theme?: 'DARK' | 'LIGHT';
    /** Token issued-at timestamp (seconds since epoch) */
    iat?: number;
    /** Token expiration timestamp (seconds since epoch) */
    exp?: number;
    /** Additional claims */
    [key: string]: unknown;
}

// ==================== CALLBACK TYPES ====================

/**
 * Callbacks for UI event binding
 */
export interface UICallbacks {
    /** Called when generate button is clicked */
    onGenerate: () => void | Promise<void>;
    /** Called when an override changes */
    onOverrideChange: (userId: string, field: string, value: string) => void;
    /** Called when override mode changes */
    onOverrideModeChange: (userId: string, mode: string) => void;
    /** Called when a per-day override changes */
    onPerDayOverrideChange: (userId: string, dateKey: string, field: string, value: string) => void;
    /** Called when copy from global is clicked */
    onCopyFromGlobal: (userId: string) => void;
    /** Called when a weekly override changes */
    onWeeklyOverrideChange: (userId: string, weekday: string, field: string, value: string) => void;
    /** Called when copy global to weekly is clicked */
    onCopyGlobalToWeekly: (userId: string) => void;
}

// ==================== STORE INTERFACE ====================

/**
 * Main store interface for state management
 */
export interface StoreInterface {
    /** Authentication token */
    token: string | null;
    /** Decoded token claims */
    claims: TokenClaims | null;
    /** List of workspace users */
    users: User[];
    /** Raw time entries from API */
    rawEntries: TimeEntry[] | null;
    /** Processed analysis results */
    analysisResults: UserAnalysis[] | null;
    /** Current date range */
    currentDateRange: DateRange | null;
    /** Feature flags and configuration */
    config: OvertimeConfig;
    /** Numeric calculation parameters */
    calcParams: CalculationParams;
    /** User profiles cache */
    profiles: Map<string, UserProfile>;
    /** User holidays cache */
    holidays: Map<string, Map<string, Holiday>>;
    /** User time-off cache */
    timeOff: Map<string, Map<string, TimeOffInfo>>;
    /** User-specific overrides */
    overrides: Record<string, UserOverride>;
    /** API error tracking */
    apiStatus: ApiStatus;
    /** UI state */
    ui: UIState;
    /** Subscriber functions */
    listeners: Set<(store: StoreInterface, event?: unknown) => void>;
}

// ==================== SUMMARY ROW TYPE ====================

/**
 * Summary row for grouped display
 */
export interface SummaryRow {
    groupKey: string;
    groupName: string;
    capacity: number | null;
    regular: number;
    overtime: number;
    dailyOvertime: number;
    weeklyOvertime: number;
    overlapOvertime: number;
    combinedOvertime: number;
    breaks: number;
    total: number;
    billableWorked: number;
    billableOT: number;
    nonBillableOT: number;
    vacationEntryHours: number;
    amount: number;
    amountEarned: number;
    amountCost: number;
    amountProfit: number;
    otPremium: number;
}

// ==================== DIAGNOSTIC TYPES ====================

/**
 * Privacy-safe diagnostic information for troubleshooting.
 * Contains no PII or sensitive data; workspace ID is hashed.
 */
export interface DiagnosticInfo {
    /** Application version */
    version: string;
    /** ISO timestamp when diagnostics were captured */
    timestamp: string;
    /** Browser user agent string */
    browser: string;
    /** Current configuration (feature flags) */
    config: OvertimeConfig;
    /** Current calculation parameters */
    calcParams: CalculationParams;
    /** Cache statistics (counts only, no data) */
    cacheStats: {
        profilesCount: number;
        holidaysCount: number;
        timeOffCount: number;
        hasReportCache: boolean;
        usingFallbackStorage: boolean;
    };
    /** API status summary */
    apiStatus: ApiStatus;
    /** Throttle status */
    throttleStatus: {
        retryCount: number;
        lastRetryTime: number | null;
    };
    /** Hashed workspace ID (for privacy) */
    hashedWorkspaceId: string | null;
    /** Whether user is authenticated */
    isAuthenticated: boolean;
    /** Current date range if set */
    dateRange: DateRange | null;
}
