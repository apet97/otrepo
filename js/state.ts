/**
 * @fileoverview Centralized State Management System
 *
 * This module implements the Store, a single source of truth for all application state.
 * It manages:
 * - **API data**: Users, raw entries, analysis results
 * - **Configuration**: Feature flags (useProfileCapacity, applyHolidays, etc.) and numeric params
 * - **User overrides**: Global, weekly, and per-day capacity/multiplier overrides
 * - **Cache data**: Profiles, holidays, time-off (fetched from API)
 * - **UI state**: Selected tab, summary grouping, pagination, collapse states
 * - **Diagnostics**: API failure tracking, rate limit tracking
 *
 * ## Persistence Strategy
 *
 * The Store is initialized in memory but persists the following to localStorage:
 * - **Config & CalcParams** → `otplus_config` (toggles, thresholds, multipliers)
 * - **User Overrides** → `otplus_overrides_${workspaceId}` (per-workspace bucket)
 * - **UI State** → `otplus_ui_state` (summary expansion, grouping, pagination)
 *
 * Report data is cached in sessionStorage (temporary, expires on browser close):
 * - **Report Cache** → `otplus_report_cache` (TTL: 5 minutes)
 *
 * ## Lifecycle
 *
 * 1. **Initialization** (constructor)
 *    - Load persisted config from localStorage
 *    - Load persisted UI state
 *    - Initialize empty maps for profiles, holidays, time-off
 *
 * 2. **Authentication** (setToken)
 *    - Store JWT token and decoded claims (workspaceId, theme)
 *    - Clear caches if workspace changed (prevent data leak)
 *    - Load workspace-scoped overrides
 *
 * 3. **Report Generation** (populate rawEntries, profiles, holidays, timeOff)
 *    - API layers fetch data and call store setters
 *    - Store accumulates all data for calculation
 *
 * 4. **Calculation** (populate analysisResults)
 *    - calc.ts reads all maps and generates UserAnalysis[]
 *    - Results stored in analysisResults
 *
 * 5. **UI Rendering** (update ui state)
 *    - UI modules read from analysisResults
 *    - User interactions update ui.* properties
 *    - saveUIState() persists changes
 *
 * ## Data Ownership
 *
 * **Read-only from calc.ts**: profiles, holidays, timeOff, rawEntries, config, calcParams, overrides
 * **Read-only from UI**: analysisResults, users, config, ui.*
 * **Written by main.ts**: token, claims, users, rawEntries, analysisResults, currentDateRange
 * **Written by api.ts**: profiles, holidays, timeOff (appended)
 * **Written by User**: config, calcParams, overrides, ui.* (via event handlers)
 *
 * ## Validation
 *
 * All numeric user inputs are validated:
 * - Capacity: non-negative
 * - Multiplier: >= 1 (premium multipliers only)
 * - Tier2 threshold: non-negative
 * - Tier2 multiplier: >= 1
 * - Invalid values are rejected and logged
 *
 * All persisted data is parsed with `safeJSONParse()` to prevent crashes from corrupted storage.
 *
 * ## Reactivity (Optional Publisher/Subscriber)
 *
 * The Store provides a `subscribe()/notify()` pattern for components that need to react
 * to state changes. However, current implementation uses direct property access and manual
 * render triggers. The subscriber system is available but not actively used.
 *
 * ## Related Files
 *
 * - `main.ts` - Orchestrates data loading and calls store setters
 * - `api.ts` - Fetches data from Clockify and updates store caches
 * - `calc.ts` - Reads from store (immutably) to compute analysis
 * - `ui/*.ts` - Read analysisResults and config, trigger saveUIState()
 * - `constants.ts` - STORAGE_KEYS, DEFAULT_MAX_PAGES, REPORT_CACHE_TTL
 * - `types.ts` - Type definitions for all state properties
 */

import { safeJSONParse, validateInputBounds, hashString } from './utils.js';
import {
    STORAGE_KEYS,
    DEFAULT_MAX_PAGES,
    REPORT_CACHE_TTL,
    DATA_CACHE_TTL,
    DATA_CACHE_VERSION,
    CACHE_CLEANUP_THRESHOLD,
} from './constants.js';
import { createLogger } from './logger.js';
import {
    storeEncrypted,
    retrieveEncrypted,
    isEncryptionSupported,
    deriveEncryptionKey,
    deriveLegacyEncryptionKey,
    type EncryptedData,
} from './crypto.js';
import {
    safeGetItem,
    safeSetItem,
    safeRemoveItem,
    safeGetKeys,
    isUsingFallbackStorage,
    tryRecoverFromFallback,
    resetFallbackStorage,
} from './storage.js';
import type {
    User,
    UserProfile,
    Holiday,
    TimeOffInfo,
    TimeEntry,
    UserAnalysis,
    OvertimeConfig,
    CalculationParams,
    UserOverride,
    ApiStatus,
    UIState,
    DateRange,
    TokenClaims,
    DiagnosticInfo,
} from './types.js';

/** Logger for state module */
const stateLogger = createLogger('State');

// ========================================================================
// SESSION STORAGE FALLBACK (REPORT CACHE)
// ========================================================================

const sessionStorageFallback = new Map<string, string>();
let usingSessionFallback = false;

function tryRecoverSessionFallback(): boolean {
    if (!usingSessionFallback) {
        return true;
    }

    try {
        const testKey = '__otplus_session_test__';
        sessionStorage.setItem(testKey, 'test');
        sessionStorage.removeItem(testKey);

        for (const [key, value] of sessionStorageFallback) {
            try {
                sessionStorage.setItem(key, value);
            } catch {
                return false;
            }
        }

        usingSessionFallback = false;
        sessionStorageFallback.clear();
        return true;
    } catch {
        return false;
    }
}

function safeSessionGetItem(key: string): string | null {
    if (usingSessionFallback && !tryRecoverSessionFallback()) {
        return sessionStorageFallback.get(key) ?? null;
    }

    try {
        return sessionStorage.getItem(key);
    } catch {
        usingSessionFallback = true;
        return sessionStorageFallback.get(key) ?? null;
    }
}

function safeSessionSetItem(key: string, value: string): boolean {
    if (usingSessionFallback && !tryRecoverSessionFallback()) {
        sessionStorageFallback.set(key, value);
        return false;
    }

    try {
        sessionStorage.setItem(key, value);
        return true;
    } catch {
        usingSessionFallback = true;
        sessionStorageFallback.set(key, value);
        return false;
    }
}

function safeSessionRemoveItem(key: string): void {
    sessionStorageFallback.delete(key);

    if (usingSessionFallback && !tryRecoverSessionFallback()) {
        return;
    }

    try {
        sessionStorage.removeItem(key);
    } catch {
        usingSessionFallback = true;
    }
}

export { isUsingFallbackStorage, tryRecoverFromFallback, resetFallbackStorage };

/**
 * Cache entry for report data stored in sessionStorage.
 *
 * Used to store fetched time entries temporarily so repeated report generations
 * with the same date range don't require re-fetching from the API.
 *
 * @interface ReportCache
 * @property key - Cache key: `${workspaceId}-${start}-${end}` (uniquely identifies the cached data)
 * @property timestamp - When the cache was created (used to check TTL expiration)
 * @property entries - The cached time entry array from Clockify API
 */
interface ReportCache {
    /** Cache key: `${workspaceId}-${start}-${end}` */
    key: string;
    /** Timestamp when cache was created (ms since epoch) */
    timestamp: number;
    /** Cached time entries from Detailed Report API */
    entries: TimeEntry[];
}

interface MapCache<T> {
    version: number;
    timestamp: number;
    entries: [string, T][];
}

interface RangeMapCache<T> {
    version: number;
    timestamp: number;
    range: { start: string; end: string };
    entries: [string, [string, T][]][];
}

/**
 * Listener function type for Publisher/Subscriber pattern.
 *
 * Called whenever `store.notify()` is invoked. Receives the store instance and
 * optional event metadata describing what changed.
 *
 * @param store - The Store instance
 * @param event - Optional metadata about the change (not actively used, available for future use)
 */
type StoreListener = (store: Store, event?: Record<string, unknown>) => void;

/**
 * Central state store for the entire OTPLUS application.
 *
 * This is the single source of truth. All modules read from and write to this store.
 * The Store manages:
 * - Authentication (token, workspace ID)
 * - Workspace data (users, entries)
 * - Computation inputs (profiles, holidays, time-off)
 * - Results (analysis)
 * - Configuration (feature flags, numeric parameters)
 * - User overrides (capacity, multiplier adjustments)
 * - UI state (selected tab, grouping, pagination)
 * - Diagnostics (API errors, rate limiting)
 *
 * ## Properties Overview
 *
 * **Authentication**: token, claims (workspace ID and user identity)
 * **Data**: users, rawEntries, analysisResults, currentDateRange
 * **Caches**: profiles, holidays, timeOff (Maps for fast lookup)
 * **Config**: config (toggles), calcParams (numeric thresholds)
 * **Overrides**: overrides (per-user adjustments)
 * **Status**: apiStatus (error tracking), throttleStatus (rate limiting)
 * **UI**: ui (tab selection, grouping, pagination states)
 * **Reactivity**: listeners (subscriber pattern, optional)
 *
 * ## Synchronous Operations
 *
 * All Store operations are synchronous (no async methods). Data fetching is done by api.ts,
 * which then calls store methods to update state.
 *
 * ## Key Design Decisions
 *
 * 1. **Immutable reads**: Calculation engine (calc.ts) reads from store but never modifies it
 * 2. **Validation on write**: All user-provided numeric values are validated before storage
 * 3. **Workspace isolation**: Overrides are per-workspace to prevent data leakage
 * 4. **Graceful degradation**: Missing data (profiles, holidays) doesn't crash calculations
 * 5. **Session-scoped cache**: Report results cached in sessionStorage, not localStorage
 *
 * @class Store
 */
class Store {
    /** Authentication token. */
    token: string | null = null;
    /** Decoded token claims (workspaceId, etc.). */
    claims: TokenClaims | null = null;
    /** List of users in the workspace. */
    users: User[] = [];
    /** Raw time entries from API. */
    rawEntries: TimeEntry[] | null = null;
    /** Processed analysis results. */
    analysisResults: UserAnalysis[] | null = null;
    /** Current date range for calculations. */
    currentDateRange: DateRange | null = null;

    /**
     * Feature flags and calculation behavior configuration.
     */
    config: OvertimeConfig = {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        showDecimalTime: false,
        enableTieredOT: false,
        amountDisplay: 'earned',
        overtimeBasis: 'daily',
        maxPages: DEFAULT_MAX_PAGES,
        encryptStorage: true, // Enterprise default: encrypt localStorage data
        auditConsent: true, // Enterprise default: enable audit logging for compliance
    };

    /**
     * Numeric parameters for calculation logic.
     */
    calcParams: CalculationParams = {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 0,
        tier2Multiplier: 2.0,
    };

    /** Cache of user profiles (Key: userId). */
    profiles: Map<string, UserProfile> = new Map();
    /** Cache of user holidays (Key: userId, Value: Map of dateKey -> Holiday). */
    holidays: Map<string, Map<string, Holiday>> = new Map();
    /** Cache of user time-off (Key: userId, Value: Map of dateKey -> TimeOffInfo). */
    timeOff: Map<string, Map<string, TimeOffInfo>> = new Map();

    /** User specific overrides (capacity/multiplier). */
    overrides: Record<string, UserOverride> = {};

    /**
     * API error tracking for partial failure reporting.
     */
    apiStatus: ApiStatus = {
        profilesFailed: 0,
        holidaysFailed: 0,
        timeOffFailed: 0,
    };

    /**
     * Throttle status tracking for rate limit retries.
     */
    throttleStatus: {
        retryCount: number;
        lastRetryTime: number | null;
    } = {
        retryCount: 0,
        lastRetryTime: null,
    };

    /**
     * Diagnostics flags for health checks and troubleshooting.
     */
    diagnostics: {
        sentryInitFailed: boolean;
        workerPoolInitFailed: boolean;
        workerPoolTerminated: boolean;
        workerTaskFailures: number;
        encryptionWriteFailed?: boolean;
        encryptionReadFailed?: boolean;
    } = {
        sentryInitFailed: false,
        workerPoolInitFailed: false,
        workerPoolTerminated: false,
        workerTaskFailures: 0,
    };

    /**
     * Ephemeral UI state.
     */
    ui: UIState = {
        isLoading: false,
        summaryExpanded: false,
        summaryGroupBy: 'user',
        overridesCollapsed: true,
        activeTab: 'summary',
        detailedPage: 1,
        detailedPageSize: 50,
        activeDetailedFilter: 'all',
        hasCostRates: true,
        hasAmountRates: true,
        paginationTruncated: false,
        paginationAbortedDueToTokenExpiration: false,
    };

    /** Set of subscriber functions. */
    listeners: Set<StoreListener> = new Set();

    /** Encryption key for localStorage encryption (derived from workspace ID). */
    private encryptionKey: CryptoKey | null = null;
    /** Optional passphrase retained for legacy key derivation during migration. */
    private encryptionPassphrase?: string;

    /** Tracks pending encryption operations to ensure completion before critical operations. */
    private _pendingEncryption: Promise<boolean> | null = null;

    /**
     * Initializes the store with default configuration and empty data structures.
     *
     * Called once when the module loads. This constructor:
     * 1. Sets default values for all state properties
     * 2. Loads persisted configuration from localStorage
     * 3. Loads persisted UI state from localStorage
     * 4. Initializes empty Maps for profiles, holidays, time-off caches
     *
     * Note: Overrides and profiles are loaded later in `setToken()` after we know
     * the workspace ID (to load workspace-scoped data).
     *
     * ## Defaults
     *
     * - useProfileCapacity: true (use per-user capacity from profile)
     * - applyHolidays: true (adjust capacity for holidays)
     * - applyTimeOff: true (reduce capacity for time-off)
     * - dailyThreshold: 8 hours
     * - overtimeMultiplier: 1.5 (time-and-a-half)
     *
     * ## Side Effects
     *
     * Reads from localStorage (non-blocking; synchronous)
     */
    constructor() {
        Object.defineProperty(this, 'token', {
            value: this.token,
            writable: true,
            enumerable: false,
        });
        // Load previously persisted configuration (user settings from prior sessions)
        this._loadConfig();
        // Load previously persisted UI state (tab selection, pagination, etc.)
        this._loadUIState();
    }

    /**
     * Subscribes a listener function to state changes.
     *
     * The listener will be called with `notify()` whenever any state change occurs.
     * This implements a simple Publisher/Subscriber pattern for reactive updates.
     *
     * Note: This is available but not currently actively used in the application.
     * UI updates are triggered directly by event handlers (see main.ts).
     *
     * ## Example
     *
     * ```typescript
     * const unsubscribe = store.subscribe((store, event) => {
     *   console.log('State changed:', event);
     *   ui.render();
     * });
     * // Later:
     * unsubscribe();
     * ```
     *
     * @param listener - Function to call when notify() is triggered
     * @returns Unsubscribe function to remove the listener
     */
    subscribe(listener: StoreListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Notifies all subscribers of a state change.
     *
     * Calls all registered listener functions with this store instance and optional
     * event metadata. This is available for components that want reactive updates,
     * but the current implementation uses direct event handlers instead.
     *
     * @param event - Optional event metadata describing the change
     */
    notify(event: Record<string, unknown> = {}): void {
        this.listeners.forEach((listener) => listener(this, event));
    }

    /**
     * Loads persisted configuration from localStorage.
     *
     * This is called during Store construction to restore user settings from
     * previous sessions. It uses `safeJSONParse()` to handle corrupted or invalid
     * JSON gracefully (doesn't crash; just uses defaults).
     *
     * ## Loaded Data
     *
     * - **config**: Feature toggles (useProfileCapacity, applyHolidays, showBillableBreakdown, etc.)
     * - **calcParams**: Numeric parameters (dailyThreshold, overtimeMultiplier, etc.)
     *
     * ## Validation
     *
     * Each numeric parameter is validated:
     * - dailyThreshold: >= 0
     * - overtimeMultiplier: >= 1
     * - amountDisplay: 'earned' | 'cost' | 'profit' (defaults to 'earned' if invalid)
     * - maxPages: >= 0
     *
     * Invalid values are ignored; defaults are used instead.
     *
     * ## Side Effects
     *
     * Modifies: this.config, this.calcParams
     * Reads: localStorage (key: 'otplus_config')
     *
     * @private
     */
    /* istanbul ignore next -- runs at module import, tested via integration */
    private _loadConfig(): void {
        // Try to load the configuration blob from localStorage (with fallback support)
        const savedConfig = safeGetItem('otplus_config');
        if (savedConfig) {
            // Parse carefully - corrupted data shouldn't crash the app
            const parsed = safeJSONParse<{
                config?: Partial<OvertimeConfig>;
                calcParams?: Partial<CalculationParams>;
            } | null>(savedConfig, null);

            if (parsed && typeof parsed === 'object') {
                // Merge loaded config with defaults (only override valid values)
                if (parsed.config && typeof parsed.config === 'object') {
                    this.config = { ...this.config, ...parsed.config };
                }

                // Validate amountDisplay mode
                const amountDisplay = String(this.config.amountDisplay || '').toLowerCase();
                const validAmountDisplays = new Set(['earned', 'cost', 'profit']);
                // Coerce to valid mode; default to 'earned' if invalid
                this.config.amountDisplay = validAmountDisplays.has(amountDisplay)
                    ? (amountDisplay as 'earned' | 'cost' | 'profit')
                    : 'earned';

                // Validate overtimeBasis mode
                const overtimeBasis = String(this.config.overtimeBasis || '').toLowerCase();
                const validOvertimeBases = new Set(['daily', 'weekly', 'both']);
                this.config.overtimeBasis = validOvertimeBases.has(overtimeBasis)
                    ? (overtimeBasis as 'daily' | 'weekly' | 'both')
                    : 'daily';

                // Validate and set maxPages
                const configMaxPages = parsed.config?.maxPages;
                if (typeof configMaxPages === 'number' && configMaxPages >= 0) {
                    this.config.maxPages = configMaxPages;
                }

                // Merge calcParams with validation using centralized bounds
                if (parsed.calcParams && typeof parsed.calcParams === 'object') {
                    const cp = parsed.calcParams;
                    // Validate each numeric param with appropriate constraints and bounds
                    const dailyResult = validateInputBounds('dailyThreshold', cp.dailyThreshold);
                    if (dailyResult.valid) {
                        this.calcParams.dailyThreshold = dailyResult.value;
                    }

                    const weeklyResult = validateInputBounds('weeklyThreshold', cp.weeklyThreshold);
                    if (weeklyResult.valid) {
                        this.calcParams.weeklyThreshold = weeklyResult.value;
                    }

                    const otMultResult = validateInputBounds('overtimeMultiplier', cp.overtimeMultiplier);
                    if (otMultResult.valid) {
                        this.calcParams.overtimeMultiplier = otMultResult.value;
                    }

                    const tier2ThreshResult = validateInputBounds('tier2ThresholdHours', cp.tier2ThresholdHours);
                    if (tier2ThreshResult.valid) {
                        this.calcParams.tier2ThresholdHours = tier2ThreshResult.value;
                    }

                    const tier2MultResult = validateInputBounds('tier2Multiplier', cp.tier2Multiplier);
                    if (tier2MultResult.valid) {
                        this.calcParams.tier2Multiplier = tier2MultResult.value;
                    }
                }
            }
        }
    }

    /**
     * Persists current configuration to localStorage.
     *
     * Called whenever the user modifies a config toggle or numeric parameter.
     * Saves both the feature flag config and calculation parameters in a single
     * JSON blob for efficient retrieval on next load.
     *
     * ## Saved Data
     *
     * - **config**: All feature toggles and display settings
     * - **calcParams**: Threshold values, multipliers, tier 2 settings
     *
     * ## Side Effects
     *
     * Writes to localStorage (key: 'otplus_config'). Synchronous operation.
     * If localStorage quota exceeded, this may throw (should be caught by caller).
     *
     * ## Called By
     *
     * - Configuration change handlers in main.ts
     */
    saveConfig(): void {
        // Persist config and calcParams together for efficient load/save (with fallback support)
        const success = safeSetItem(
            'otplus_config',
            JSON.stringify({
                config: this.config,
                calcParams: this.calcParams,
            })
        );
        if (!success) {
            stateLogger.warn('Config saved to in-memory fallback. Changes may not persist across sessions.');
        }

        // Audit logging for configuration changes (privacy-safe, no PII)
        // Only log if audit consent is enabled (default: true for enterprise compliance)
        if (this.config.auditConsent !== false) {
            stateLogger.info('Configuration updated', {
                action: 'CONFIG_CHANGE',
                timestamp: new Date().toISOString(),
                hashedWorkspaceId: this.claims?.workspaceId
                    ? hashString(this.claims.workspaceId)
                    : null,
                config: {
                    useProfileCapacity: this.config.useProfileCapacity,
                    useProfileWorkingDays: this.config.useProfileWorkingDays,
                    applyHolidays: this.config.applyHolidays,
                    applyTimeOff: this.config.applyTimeOff,
                    overtimeBasis: this.config.overtimeBasis,
                    enableTieredOT: this.config.enableTieredOT,
                },
                calcParams: {
                    dailyThreshold: this.calcParams.dailyThreshold,
                    weeklyThreshold: this.calcParams.weeklyThreshold,
                    overtimeMultiplier: this.calcParams.overtimeMultiplier,
                },
            });
        }
    }

    /**
     * Sets the authentication token and initializes workspace-scoped state.
     *
     * This is called during application initialization (main.ts:init()) after
     * successfully decoding the JWT token. It establishes the workspace context
     * and loads any previously saved user overrides for this workspace.
     *
     * ## Responsibilities
     *
     * 1. Store the raw JWT token (used for subsequent API calls)
     * 2. Store decoded claims (workspaceId, userId, theme, etc.)
     * 3. Detect workspace switches (different user accessing addon)
     * 4. Clear caches if workspace changed (prevent data leak to new user)
     * 5. Load workspace-scoped overrides from localStorage
     *
     * ## Workspace Switching
     *
     * If `this.claims.workspaceId !== claims.workspaceId`:
     * - Clears profiles, holidays, timeOff maps
     * - Existing config/calcParams are NOT cleared (they're workspace-independent)
     * - New workspace's overrides are loaded (or empty if none saved)
     *
     * This prevents a user from seeing previous user's data if the addon
     * is accessed by a different user in a different workspace.
     *
     * ## Security
     *
     * - Token is stored in memory only (never persisted to localStorage)
     * - Token is never logged in error messages
     * - Claims are extracted but token itself is not validated again
     *   (validation happened in main.ts before calling this)
     *
     * ## Called By
     *
     * - main.ts:init() - After JWT validation
     *
     * @param token - The raw JWT token (format: header.payload.signature)
     * @param claims - Decoded payload {workspaceId, userId, theme, ...}
     *
     * @see _loadOverrides() - Loads workspace-scoped user overrides
     */
    setToken(token: string, claims: TokenClaims): void {
        // Detect workspace switch
        // If a different workspace is being accessed, clear cached data to prevent leakage
        if (this.claims && this.claims.workspaceId !== claims.workspaceId) {
            // Clear all cached API data
            this.profiles.clear();
            this.holidays.clear();
            this.timeOff.clear();
            // Clear stale report data to prevent data leakage between workspaces
            // This ensures no entries from the old workspace are visible or used in calculations
            this.rawEntries = null;
            this.analysisResults = null;
            this.currentDateRange = null;
            // Note: config/calcParams are preserved (not workspace-specific)
            // Note: Rate limiter reset is handled by main.ts to avoid circular dependency
        }

        // Store token and claims
        this.token = token;
        this.claims = claims;

        // Load cached profile data for this workspace (if present)
        this.loadProfilesCache();

        // Load overrides for the new workspace (or empty if none saved)
        this._loadOverrides();
    }

    /**
     * Clears authentication token and claims from memory.
     */
    clearToken(): void {
        this.token = null;
        this.claims = null;
    }

    /**
     * Initializes encryption for localStorage data.
     * Loads or generates a per-workspace secret key stored in IndexedDB.
     * Must be called after setToken() and before saving encrypted data.
     *
     * Passphrase is only used for legacy migration (PBKDF2-derived keys).
     *
     * @param passphrase - Optional user-provided passphrase for stronger key derivation
     * @returns Promise that resolves when encryption is ready
     */
    async initEncryption(passphrase?: string): Promise<void> {
        if (!this.claims?.workspaceId) {
            stateLogger.warn('Cannot initialize encryption without workspace ID');
            return;
        }

        if (!isEncryptionSupported()) {
            stateLogger.warn('Web Crypto API not available, encryption disabled');
            return;
        }

        try {
            this.encryptionPassphrase = passphrase;
            this.encryptionKey = await deriveEncryptionKey(this.claims.workspaceId);
            stateLogger.debug('Encryption initialized for workspace', {
                hasPassphrase: !!passphrase,
            });
        } catch (error) {
            stateLogger.error('Failed to initialize encryption', { error });
            this.encryptionKey = null;
        }
    }

    /**
     * Returns the current encryption status for health checks.
     */
    getEncryptionStatus(): {
        enabled: boolean;
        supported: boolean;
        keyReady: boolean;
        pending: boolean;
    } {
        return {
            enabled: this.config.encryptStorage === true,
            supported: isEncryptionSupported(),
            keyReady: this.encryptionKey !== null,
            pending: this._pendingEncryption !== null,
        };
    }

    /**
     * Generates storage key for overrides based on workspace ID.
     * @returns Storage key or null if no workspace.
     * @private
     */
    private _getOverrideKey(): string | null {
        // Each workspace has a unique override bucket to avoid collisions between tenants
        return this.claims?.workspaceId
            ? `${STORAGE_KEYS.OVERRIDES_PREFIX}${this.claims.workspaceId}`
            : null;
    }

    private _getProfilesCacheKey(): string | null {
        return this.claims?.workspaceId
            ? `${STORAGE_KEYS.PROFILES_PREFIX}${this.claims.workspaceId}`
            : null;
    }

    private _getRangeCacheKey(prefix: string, start: string, end: string): string | null {
        return this.claims?.workspaceId
            ? `${prefix}${this.claims.workspaceId}_${start}_${end}`
            : null;
    }

    private _isCacheFresh(cache: { version?: number; timestamp?: number } | null): boolean {
        if (!cache) return false;
        if (cache.version !== DATA_CACHE_VERSION) return false;
        if (typeof cache.timestamp !== 'number') return false;
        return Date.now() - cache.timestamp <= DATA_CACHE_TTL;
    }

    loadProfilesCache(): void {
        const cacheKey = this._getProfilesCacheKey();
        if (!cacheKey) return;
        const saved = safeGetItem(cacheKey);
        if (!saved) return;
        const cache = safeJSONParse<MapCache<UserProfile> | null>(saved, null);
        if (!cache || !this._isCacheFresh(cache)) return;
        const map = new Map<string, UserProfile>(cache.entries || []);
        if (map.size > 0) {
            this.profiles = map;
        }
    }

    saveProfilesCache(): void {
        const cacheKey = this._getProfilesCacheKey();
        if (!cacheKey) return;
        const cache: MapCache<UserProfile> = {
            version: DATA_CACHE_VERSION,
            timestamp: Date.now(),
            entries: Array.from(this.profiles.entries()),
        };
        safeSetItem(cacheKey, JSON.stringify(cache));
    }

    loadHolidayCache(start: string, end: string): void {
        const cacheKey = this._getRangeCacheKey(STORAGE_KEYS.HOLIDAYS_PREFIX, start, end);
        if (!cacheKey) return;
        const saved = safeGetItem(cacheKey);
        if (!saved) return;
        const cache = safeJSONParse<RangeMapCache<Holiday> | null>(saved, null);
        if (!cache || !this._isCacheFresh(cache)) return;
        if (cache.range?.start !== start || cache.range?.end !== end) return;
        const reconstructed = new Map<string, Map<string, Holiday>>();
        (cache.entries || []).forEach(([userId, entries]) => {
            reconstructed.set(userId, new Map(entries));
        });
        if (reconstructed.size > 0) {
            this.holidays = reconstructed;
        }
    }

    saveHolidayCache(start: string, end: string): void {
        const cacheKey = this._getRangeCacheKey(STORAGE_KEYS.HOLIDAYS_PREFIX, start, end);
        if (!cacheKey) return;
        const cache: RangeMapCache<Holiday> = {
            version: DATA_CACHE_VERSION,
            timestamp: Date.now(),
            range: { start, end },
            entries: Array.from(this.holidays.entries()).map(([userId, map]) => [
                userId,
                Array.from(map.entries()),
            ]),
        };
        safeSetItem(cacheKey, JSON.stringify(cache));
    }

    loadTimeOffCache(start: string, end: string): void {
        const cacheKey = this._getRangeCacheKey(STORAGE_KEYS.TIMEOFF_PREFIX, start, end);
        if (!cacheKey) return;
        const saved = safeGetItem(cacheKey);
        if (!saved) return;
        const cache = safeJSONParse<RangeMapCache<TimeOffInfo> | null>(saved, null);
        if (!cache || !this._isCacheFresh(cache)) return;
        if (cache.range?.start !== start || cache.range?.end !== end) return;
        const reconstructed = new Map<string, Map<string, TimeOffInfo>>();
        (cache.entries || []).forEach(([userId, entries]) => {
            reconstructed.set(userId, new Map(entries));
        });
        if (reconstructed.size > 0) {
            this.timeOff = reconstructed;
        }
    }

    saveTimeOffCache(start: string, end: string): void {
        const cacheKey = this._getRangeCacheKey(STORAGE_KEYS.TIMEOFF_PREFIX, start, end);
        if (!cacheKey) return;
        const cache: RangeMapCache<TimeOffInfo> = {
            version: DATA_CACHE_VERSION,
            timestamp: Date.now(),
            range: { start, end },
            entries: Array.from(this.timeOff.entries()).map(([userId, map]) => [
                userId,
                Array.from(map.entries()),
            ]),
        };
        safeSetItem(cacheKey, JSON.stringify(cache));
    }

    /**
     * Loads user overrides from LocalStorage (sync version, plaintext only).
     * @private
     */
    private _loadOverrides(): void {
        // Read per-workspace override data so we can rehydrate editor state (with fallback support)
        const key = this._getOverrideKey();
        /* istanbul ignore else -- key is always truthy when claims.workspaceId exists */
        if (key) {
            const saved = safeGetItem(key);
            this.overrides = safeJSONParse<Record<string, UserOverride>>(saved, {});

            // Migrate old format: add mode if missing
            Object.keys(this.overrides).forEach((userId) => {
                if (!this.overrides[userId].mode) {
                    // Backfill legacy overrides that lacked a mode flag
                    this.overrides[userId].mode = 'global';
                }
            });
        }
    }

    /**
     * Loads user overrides from LocalStorage with encryption support.
     * Tries encrypted storage first if encryption is enabled, falls back to plaintext.
     * Call this after initEncryption() for encrypted data support.
     */
    async loadOverridesEncrypted(): Promise<void> {
        const key = this._getOverrideKey();
        if (!key) return;

        const storedRaw = safeGetItem(key);
        const parsedEncrypted = storedRaw
            ? safeJSONParse<EncryptedData | null>(storedRaw, null)
            : null;
        const hasEncryptedPayload = !!(
            parsedEncrypted &&
            typeof parsedEncrypted.ct === 'string' &&
            typeof parsedEncrypted.iv === 'string' &&
            typeof parsedEncrypted.v === 'number'
        );

        // Try encrypted storage first if encryption is enabled
        if (this.config.encryptStorage && this.encryptionKey) {
            try {
                const decrypted = await retrieveEncrypted(key, this.encryptionKey);
                if (decrypted) {
                    this.overrides = safeJSONParse<Record<string, UserOverride>>(decrypted, {});
                    this._migrateOverrideFormat();
                    return;
                }

                // Attempt legacy PBKDF2 decryption for migration if encrypted payload exists
                if (hasEncryptedPayload && this.claims?.workspaceId) {
                    const legacyKey = await deriveLegacyEncryptionKey(
                        this.claims.workspaceId,
                        this.encryptionPassphrase
                    );
                    const legacyDecrypted = await retrieveEncrypted(key, legacyKey);
                    if (legacyDecrypted) {
                        this.overrides = safeJSONParse<Record<string, UserOverride>>(
                            legacyDecrypted,
                            {}
                        );
                        this._migrateOverrideFormat();

                        const migrated = await storeEncrypted(
                            key,
                            JSON.stringify(this.overrides),
                            this.encryptionKey
                        );
                        if (!migrated) {
                            safeSetItem(key, JSON.stringify(this.overrides));
                        }
                        return;
                    }
                }
            } catch (error) {
                stateLogger.warn('Failed to load encrypted overrides, falling back to plaintext', { error });
                this.diagnostics = {
                    ...this.diagnostics,
                    encryptionReadFailed: true,
                };
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('otplus:encryption-error', {
                            detail: { action: 'load' },
                        })
                    );
                }
            }
        }

        // Fall back to plaintext only when the stored data is not encrypted.
        if (storedRaw && !hasEncryptedPayload) {
            this.overrides = safeJSONParse<Record<string, UserOverride>>(storedRaw, {});
            this._migrateOverrideFormat();
        }
    }

    /**
     * Migrates override format for backwards compatibility.
     * @private
     */
    private _migrateOverrideFormat(): void {
        Object.keys(this.overrides).forEach((userId) => {
            if (!this.overrides[userId].mode) {
                this.overrides[userId].mode = 'global';
            }
        });
    }

    /**
     * Saves user overrides to LocalStorage (with fallback support).
     * Uses encryption if encryptStorage is enabled and encryption key is available.
     */
    saveOverrides(): void {
        const key = this._getOverrideKey();
        if (key) {
            const data = JSON.stringify(this.overrides);

            // Use encryption if enabled and key is available
        if (this.config.encryptStorage) {
            if (!this.encryptionKey) {
                stateLogger.warn('Encryption enabled but key unavailable; overrides not saved');
                this.diagnostics = {
                    ...this.diagnostics,
                    encryptionWriteFailed: true,
                };
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                        new CustomEvent('otplus:encryption-error', {
                            detail: { action: 'save' },
                        })
                    );
                }
                return;
            }

            // Track pending encryption to ensure completion before critical operations
            // (e.g., tab close, workspace switch)
            this._pendingEncryption = storeEncrypted(key, data, this.encryptionKey)
                .then((success) => {
                    this._pendingEncryption = null;
                    return success;
                })
                .catch((error) => {
                    stateLogger.warn('Failed to save encrypted overrides', { error });
                    this.diagnostics = {
                        ...this.diagnostics,
                        encryptionWriteFailed: true,
                    };
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('otplus:encryption-error', {
                                detail: { action: 'save' },
                            })
                        );
                    }
                    this._pendingEncryption = null;
                    return false;
                });
        } else {
            // Save plaintext
            safeSetItem(key, data);
        }
        }

        // Audit logging for override changes (privacy-safe, no PII)
        // Only log if audit consent is enabled (default: true for enterprise compliance)
        const userCount = Object.keys(this.overrides).length;
        if (userCount > 0 && this.config.auditConsent !== false) {
            stateLogger.info('User overrides updated', {
                action: 'OVERRIDE_CHANGE',
                timestamp: new Date().toISOString(),
                hashedWorkspaceId: this.claims?.workspaceId
                    ? hashString(this.claims.workspaceId)
                    : null,
                userCount,
                // Hash user IDs to avoid PII
                hashedUserIds: Object.keys(this.overrides).map(hashString),
            });
        }
    }

    /**
     * Ensures any pending encryption operations complete before proceeding.
     * Call this before critical operations like tab close or workspace switch
     * to prevent data loss from incomplete async encryption.
     *
     * @returns Promise that resolves when no encryption is pending
     */
    async ensureEncryptionComplete(): Promise<void> {
        if (this._pendingEncryption) {
            await this._pendingEncryption;
        }
    }

    /**
     * Updates a global override field for a user.
     *
     * Global overrides apply to all days for a user (unless per-day or weekly overrides
     * are also set). This method is used in the "Global" override mode.
     *
     * ## Behavior
     *
     * - If value is null/empty, the field is deleted (reverts to default)
     * - If no fields remain after deletion, the user's override record is deleted
     * - Numeric values are parsed and validated before storage
     * - Invalid values are rejected and logged; method returns false
     *
     * ## Validation Rules
     *
     * - **capacity**: Must be non-negative (0 = full OT day)
     * - **multiplier**: Must be >= 1 (premium OT rates)
     * - **tier2Threshold**: Must be non-negative
     * - **tier2Multiplier**: Must be >= 1
     *
     * ## Persistence
     *
     * After a successful update, `saveOverrides()` is called to persist to localStorage.
     *
     * ## Called By
     *
     * - main.ts event handlers - When user edits global override fields
     * - UI override controls
     *
     * @param userId - Clockify user ID
     * @param field - Field to update: 'capacity' | 'multiplier' | 'tier2Threshold' | 'tier2Multiplier'
     * @param value - New value (parsed as number) or null to delete
     * @returns true if update succeeded, false if validation failed
     *
     * @see setOverrideMode() - To switch between override modes
     * @see updatePerDayOverride() - For per-day overrides
     * @see setWeeklyOverride() - For weekly overrides
     */
    updateOverride(userId: string, field: string, value: string | number | null): boolean {
        // Initialize user override record if not exists
        if (!this.overrides[userId]) this.overrides[userId] = {};

        if (value === null || value === '') {
            // Delete the field (revert to default for that field)
            delete (this.overrides[userId] as Record<string, unknown>)[field];
            // Clean up empty user record
            if (Object.keys(this.overrides[userId]).length === 0) {
                delete this.overrides[userId];
            }
        } else {
            // Map override field names to bounds keys
            const boundsKey = field === 'tier2Threshold' ? 'tier2ThresholdHours' : field;

            // Validate using centralized bounds validation
            const validation = validateInputBounds(boundsKey, value);
            if (!validation.valid) {
                stateLogger.warn(`Invalid override value for ${field}: ${value}. ${validation.error}`);
                return false;
            }

            // Store the validated numeric value (not the original string)
            // This ensures downstream calculations always receive numbers
            (this.overrides[userId] as Record<string, unknown>)[field] = validation.value;
        }

        // Persist to localStorage
        this.saveOverrides();
        return true;
    }

    /**
     * Sets the override mode for a user: 'global', 'weekly', or 'perDay'.
     *
     * The override mode determines how the user's capacity and multiplier overrides
     * are applied during calculation:
     * - **'global'**: Single values apply to all days
     * - **'weekly'**: Different values for each day of the week (Mon-Sun)
     * - **'perDay'**: Unique values for each date in the report range
     *
     * ## Mode Definitions
     *
     * | Mode | Usage | Override Structure |
     * |------|-------|-------------------|
     * | 'global' | Flat rate for all days | `{ capacity, multiplier, ... }` |
     * | 'weekly' | Different rate per weekday | `{ MONDAY: {...}, TUESDAY: {...}, ... }` |
     * | 'perDay' | Unique rate per date | `{ '2025-01-20': {...}, '2025-01-21': {...}, ... }` |
     *
     * ## Behavior
     *
     * 1. Validates that mode is one of the three allowed values
     * 2. Creates user override record if not exists
     * 3. Sets the mode flag
     * 4. Initializes empty Map for per-day or weekly overrides if switching modes
     * 5. Persists to localStorage
     *
     * ## Side Effects
     *
     * - Initializes empty `perDayOverrides` Map if mode='perDay'
     * - Initializes empty `weeklyOverrides` Map if mode='weekly'
     * - Calls `saveOverrides()` to persist
     *
     * ## UI Updates
     *
     * After this call, the UI override editor should re-render to show the
     * appropriate input fields for the new mode (main.ts handles this).
     *
     * ## Called By
     *
     * - main.ts event handlers - When user selects a different override mode
     *
     * @param userId - Clockify user ID
     * @param mode - Override mode: 'global' | 'weekly' | 'perDay'
     * @returns true if mode was valid and set, false otherwise
     *
     * @see updateOverride() - For global overrides
     * @see setWeeklyOverride() - For weekly overrides
     * @see updatePerDayOverride() - For per-day overrides
     */
    setOverrideMode(userId: string, mode: string): boolean {
        // Validate mode
        if (!['global', 'weekly', 'perDay'].includes(mode)) {
            stateLogger.warn(`Invalid override mode: ${mode}`);
            return false;
        }

        // Create or update user override record
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: mode as 'global' | 'weekly' | 'perDay' };
        } else {
            const oldMode = this.overrides[userId].mode || 'global';
            const override = this.overrides[userId];

            // Migrate global values when switching modes (prevents data loss)
            // Only migrate if switching FROM global AND global values exist
            if (oldMode === 'global' && mode === 'weekly') {
                this._migrateGlobalToWeekly(userId, override);
            }
            // Note: For perDay mode, we don't auto-migrate since we don't know
            // which dates the user wants. Use copyGlobalToPerDay() instead.

            override.mode = mode as 'global' | 'weekly' | 'perDay';
        }

        // Initialize data structure for the new mode
        // Per-day mode needs a Map to store overrides by date
        if (mode === 'perDay' && !this.overrides[userId].perDayOverrides) {
            this.overrides[userId].perDayOverrides = {};
        }

        // Weekly mode needs a Map to store overrides by weekday
        if (mode === 'weekly' && !this.overrides[userId].weeklyOverrides) {
            this.overrides[userId].weeklyOverrides = {};
        }

        // Persist the mode change
        this.saveOverrides();
        return true;
    }

    /**
     * Updates a per-day override for a specific user and date.
     * @param userId - User ID.
     * @param dateKey - Date in YYYY-MM-DD format.
     * @param field - Field to update (capacity/multiplier).
     * @param value - New value.
     * @returns True if update was successful, false if validation failed.
     */
    updatePerDayOverride(
        userId: string,
        dateKey: string,
        field: string,
        value: string | number | null
    ): boolean {
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: 'perDay', perDayOverrides: {} };
        }

        if (!this.overrides[userId].perDayOverrides) {
            this.overrides[userId].perDayOverrides = {};
        }

        const perDayOverrides = this.overrides[userId].perDayOverrides;

        if (!perDayOverrides[dateKey]) {
            perDayOverrides[dateKey] = {};
        }

        // Use same validation logic as updateOverride() via centralized validateInputBounds
        if (value === null || value === '') {
            delete (perDayOverrides[dateKey] as Record<string, unknown>)[field];

            // Cleanup empty day entries
            if (Object.keys(perDayOverrides[dateKey]).length === 0) {
                delete perDayOverrides[dateKey];
            }
        } else {
            // Map override field names to bounds keys (same as updateOverride)
            const boundsKey = field === 'tier2Threshold' ? 'tier2ThresholdHours' : field;

            // Validate using centralized bounds validation (consistent with updateOverride)
            const validation = validateInputBounds(boundsKey, value);
            if (!validation.valid) {
                stateLogger.warn(`Invalid per-day override value for ${field}: ${value}. ${validation.error}`);
                return false;
            }

            // Store the validated numeric value (not the original string)
            (perDayOverrides[dateKey] as Record<string, unknown>)[field] = validation.value;
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Internal helper to migrate global overrides to weekly mode.
     * Copies global values to all weekdays when switching from global to weekly mode.
     * @param userId - User ID (for logging, hashed)
     * @param override - User's override record
     */
    private _migrateGlobalToWeekly(userId: string, override: UserOverride): void {
        const globalValues: Record<string, unknown> = {};

        // Collect global override values (capacity, multiplier, tier2Threshold, tier2Multiplier)
        if (override.capacity != null) globalValues.capacity = override.capacity;
        if (override.multiplier != null) globalValues.multiplier = override.multiplier;
        if (override.tier2Threshold != null) globalValues.tier2Threshold = override.tier2Threshold;
        if (override.tier2Multiplier != null) globalValues.tier2Multiplier = override.tier2Multiplier;

        // Skip migration if no values to migrate
        if (Object.keys(globalValues).length === 0) return;

        // Initialize weeklyOverrides with global values for all weekdays
        if (!override.weeklyOverrides) {
            override.weeklyOverrides = {};
        }
        const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        for (const day of weekdays) {
            if (!override.weeklyOverrides[day]) {
                override.weeklyOverrides[day] = { ...globalValues };
            }
        }
        stateLogger.info('Migrated global overrides to weekly mode', {
            userId: hashString(userId),
            fieldsCount: Object.keys(globalValues).length,
        });
    }

    /**
     * Copies global override values to all days in the provided date range for per-day mode.
     * @param userId - User ID.
     * @param dates - Array of date keys (YYYY-MM-DD format).
     * @returns True if successful, false if preconditions not met.
     */
    copyGlobalToPerDay(userId: string, dates: string[]): boolean {
        const override = this.overrides[userId];
        if (!override || override.mode !== 'perDay') {
            stateLogger.warn(`Cannot copy: user ${userId} not in perDay mode`);
            return false;
        }

        if (!dates || dates.length === 0) {
            stateLogger.warn('Cannot copy: no dates provided');
            return false;
        }

        // Copy the user's global override values into each day for easier per-day editing
        const globalCapacity = override.capacity;
        const globalMultiplier = override.multiplier;
        const globalTier2Threshold = override.tier2Threshold;
        const globalTier2Multiplier = override.tier2Multiplier;

        if (!override.perDayOverrides) {
            override.perDayOverrides = {};
        }
        const perDayOverrides = override.perDayOverrides;

        // Copy the global override values to each date bucket so the per-day editor can show them
        dates.forEach((dateKey) => {
            /* istanbul ignore else -- initializes empty object for new date keys */
            if (!perDayOverrides[dateKey]) {
                perDayOverrides[dateKey] = {};
            }

            if (globalCapacity !== undefined && globalCapacity !== '') {
                perDayOverrides[dateKey].capacity = globalCapacity;
            }
            if (globalMultiplier !== undefined && globalMultiplier !== '') {
                perDayOverrides[dateKey].multiplier = globalMultiplier;
            }
            if (globalTier2Threshold !== undefined && globalTier2Threshold !== '') {
                perDayOverrides[dateKey].tier2Threshold = globalTier2Threshold;
            }
            if (globalTier2Multiplier !== undefined && globalTier2Multiplier !== '') {
                perDayOverrides[dateKey].tier2Multiplier = globalTier2Multiplier;
            }
        });

        this.saveOverrides();
        return true;
    }

    /**
     * Sets weekly override for specific weekday.
     * @param userId - User ID.
     * @param weekday - 'MONDAY', 'TUESDAY', etc.
     * @param field - 'capacity' or 'multiplier'.
     * @param value - The value to set.
     * @returns True if successful, false if invalid.
     */
    setWeeklyOverride(
        userId: string,
        weekday: string,
        field: string,
        value: string | number | null
    ): boolean {
        // Initialize structure
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: 'weekly', weeklyOverrides: {} };
        }
        if (!this.overrides[userId].weeklyOverrides) {
            this.overrides[userId].weeklyOverrides = {};
        }
        const weeklyOverrides = this.overrides[userId].weeklyOverrides;
        if (!weeklyOverrides[weekday]) {
            weeklyOverrides[weekday] = {};
        }

        // Validation (same as updateOverride)
        if (value === null || value === '') {
            delete (weeklyOverrides[weekday] as Record<string, unknown>)[field];
            if (Object.keys(weeklyOverrides[weekday]).length === 0) {
                delete weeklyOverrides[weekday];
            }
        } else {
            const numValue = parseFloat(String(value));
            if (isNaN(numValue)) return false;
            if (field === 'capacity' && numValue < 0) return false;
            if (field === 'multiplier' && numValue < 1) return false;
            if (field === 'tier2Threshold' && numValue < 0) return false;
            if (field === 'tier2Multiplier' && numValue < 1) return false;
            (weeklyOverrides[weekday] as Record<string, unknown>)[field] = value;
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Copies global values to all weekdays for a user in weekly mode.
     * @param userId - User ID.
     * @returns True if successful, false if not in weekly mode.
     */
    copyGlobalToWeekly(userId: string): boolean {
        const override = this.overrides[userId];
        if (!override || override.mode !== 'weekly') return false;

        const weekdays = [
            'MONDAY',
            'TUESDAY',
            'WEDNESDAY',
            'THURSDAY',
            'FRIDAY',
            'SATURDAY',
            'SUNDAY',
        ];

        if (!override.weeklyOverrides) {
            override.weeklyOverrides = {};
        }
        const weeklyOverrides = override.weeklyOverrides;

        weekdays.forEach((weekday) => {
            /* istanbul ignore else -- initializes empty object for each weekday */
            if (!weeklyOverrides[weekday]) {
                weeklyOverrides[weekday] = {};
            }
            // Mirror global override values across every weekday entry for convenience
            if (override.capacity !== undefined && override.capacity !== '') {
                weeklyOverrides[weekday].capacity = override.capacity;
            }
            if (override.multiplier !== undefined && override.multiplier !== '') {
                weeklyOverrides[weekday].multiplier = override.multiplier;
            }
            if (override.tier2Threshold !== undefined && override.tier2Threshold !== '') {
                weeklyOverrides[weekday].tier2Threshold = override.tier2Threshold;
            }
            if (override.tier2Multiplier !== undefined && override.tier2Multiplier !== '') {
                weeklyOverrides[weekday].tier2Multiplier = override.tier2Multiplier;
            }
        });

        this.saveOverrides();
        return true;
    }

    /**
     * Retrieves overrides for a specific user.
     * @param userId - User ID.
     * @returns Override object (empty if none).
     */
    getUserOverride(userId: string): UserOverride {
        return this.overrides[userId] || {};
    }

    /**
     * Resets API failure counters.
     */
    resetApiStatus(): void {
        this.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    }

    /**
     * Resets throttle status counters.
     */
    resetThrottleStatus(): void {
        this.throttleStatus = { retryCount: 0, lastRetryTime: null };
    }

    /**
     * Increments throttle retry count.
     */
    incrementThrottleRetry(): void {
        this.throttleStatus.retryCount++;
        this.throttleStatus.lastRetryTime = Date.now();
    }

    /**
     * Clears cached data maps (holidays, timeOff) before fetching new data.
     * Profiles are kept as they rarely change within a session.
     */
    clearFetchCache(): void {
        this.holidays.clear();
        this.timeOff.clear();
    }

    /**
     * Loads UI state from LocalStorage.
     * @private
     */
    /* istanbul ignore next -- runs at module import, tested via integration */
    private _loadUIState(): void {
        const saved = safeGetItem(STORAGE_KEYS.UI_STATE);
        if (saved) {
            const parsed = safeJSONParse<Partial<UIState> | null>(saved, null);
            if (parsed && typeof parsed === 'object') {
                this.ui = { ...this.ui, ...parsed };
            }
        }
    }

    /**
     * Saves UI state to LocalStorage (with fallback support).
     */
    saveUIState(): void {
        safeSetItem(
            STORAGE_KEYS.UI_STATE,
            JSON.stringify({
                summaryExpanded: this.ui.summaryExpanded,
                summaryGroupBy: this.ui.summaryGroupBy,
                overridesCollapsed: this.ui.overridesCollapsed,
            })
        );
    }

    /**
     * Generates a cache key for report data based on workspace and date range.
     *
     * CACHE SCOPE:
     * - Workspace: Isolated per workspace (prevents data leak between tenants).
     * - Date Range: Isolated per query range (start/end dates).
     * - User: Shared across all users *within* the same workspace (users see same report).
     *
     * Format: `${workspaceId}-${start}-${end}` (e.g., `abc123-2025-01-01-2025-01-31`)
     *
     * @param start - Start date in YYYY-MM-DD format
     * @param end - End date in YYYY-MM-DD format
     * @returns Cache key string, or null if no workspace ID set
     */
    getReportCacheKey(start: string, end: string): string | null {
        // Can't cache without workspace ID
        if (!this.claims?.workspaceId) return null;
        // Build key from workspace and date range
        return `${this.claims.workspaceId}-${start}-${end}`;
    }

    /**
     * Retrieves cached report data if it exists and hasn't expired.
     *
     * Used by main.ts during report generation to check if we can reuse a
     * previously fetched report for the same date range. The user is prompted
     * whether to use the cached data or fetch fresh from the API.
     *
     * ## Expiration
     *
     * Cache expires after REPORT_CACHE_TTL (5 minutes). Older caches are treated
     * as stale and not returned.
     *
     * ## Error Handling
     *
     * If sessionStorage is corrupted or inaccessible, this returns null gracefully.
     * No exception is thrown; the app falls back to fetching fresh data.
     *
     * @param key - Cache key from `getReportCacheKey()`
     * @returns Array of time entries, or null if not found/expired/error
     *
     * @see setCachedReport() - Store data in cache
     * @see REPORT_CACHE_TTL in constants.ts - Cache expiration time
     */
    getCachedReport(key: string): TimeEntry[] | null {
        try {
            const cached = safeSessionGetItem(STORAGE_KEYS.REPORT_CACHE);
            if (!cached) return null;

            // Parse cached data; return null if corrupted
            const cache = safeJSONParse<ReportCache | null>(cached, null);
            if (!cache) return null;

            // Check if cache matches the requested key
            if (cache.key !== key) return null;

            // Check if cache has expired
            if (Date.now() - cache.timestamp > REPORT_CACHE_TTL) return null;

            // Cache is valid; return the cached entries
            return cache.entries;
        } catch {
            // Swallow any errors; treat as cache miss
            return null;
        }
    }

    /**
     * Stores report data in sessionStorage cache.
     *
     * Called after successfully fetching data from the API. The cached data can
     * be reused for subsequent report generations with the same date range.
     *
     * Caching is automatic; the user can opt in to using the cached data via
     * the "Use cached results?" prompt.
     *
     * ## Storage
     *
     * Uses sessionStorage (not localStorage) to keep cache temporary and session-scoped.
     * Cache is automatically cleared when the browser tab is closed.
     *
     * ## Error Handling
     *
     * If sessionStorage quota is exceeded or unavailable, the operation fails silently
     * (logs a warning but doesn't crash). The report proceeds without caching.
     *
     * @param key - Cache key from `getReportCacheKey()`
     * @param entries - Array of time entries to cache
     *
     * @see getCachedReport() - Retrieve cached data
     * @see REPORT_CACHE_TTL in constants.ts - Cache expiration time
     */
    setCachedReport(key: string, entries: TimeEntry[]): void {
        try {
            const cache: ReportCache = {
                key,
                timestamp: Date.now(),
                entries,
            };
            // Store cache in sessionStorage (temporary, session-scoped)
            const stored = safeSessionSetItem(
                STORAGE_KEYS.REPORT_CACHE,
                JSON.stringify(cache)
            );
            if (!stored) {
                stateLogger.warn('Failed to cache report data:', new Error('sessionStorage unavailable'));
            }
        } catch (e) {
            // Silently fail if quota exceeded; report still works, just without cache
            stateLogger.warn('Failed to cache report data:', e);
        }
    }

    /**
     * Clears the report cache from sessionStorage.
     *
     * Called when the user clicks the "Refresh" button to force a fresh fetch
     * from the API, or when clearing all data.
     *
     * ## Side Effects
     *
     * Removes the cached report data from sessionStorage. Subsequent report
     * generations will fetch fresh data from Clockify API.
     */
    clearReportCache(): void {
        safeSessionRemoveItem(STORAGE_KEYS.REPORT_CACHE);
    }

    /**
     * Clears all persisted and in-memory application data.
     *
     * This is a destructive operation that removes:
     * - All configuration and calculation parameters (resets to defaults)
     * - All user overrides (per-workspace)
     * - All cached API data (profiles, holidays, time-off)
     * - All persisted UI state
     * - All in-memory results and state
     *
     * After this call, the application is essentially reset to initial state
     * (but authentication token is NOT cleared; the user stays logged in).
     *
     * ## Use Cases
     *
     * - **Privacy/security**: User wants to delete all local data before leaving
     * - **Fresh start**: User wants to reset all customizations
     * - **Troubleshooting**: Force reload all data from API
     *
     * ## What's Cleared
     *
     * **From localStorage**:
     * - 'otplus_config' - Feature toggles and calculation parameters
     * - 'otplus_ui_state' - Selected tab, grouping, pagination
     * - 'otplus_overrides_${workspaceId}' - Per-workspace user overrides
     * - All keys matching prefix OVERRIDES_PREFIX
     *
     * **From memory**:
     * - All Maps: profiles, holidays, timeOff
     * - Data: rawEntries, analysisResults, currentDateRange
     * - State: config, calcParams, ui, overrides
     *
     * **NOT cleared**:
     * - Authentication: token, claims (user remains logged in)
     * - Users list (workspace members)
     * - SessionStorage (report cache) - separate concerns
     *
     * ## Side Effects
     *
     * 1. Removes multiple localStorage keys (synchronous)
     * 2. Resets all in-memory state to defaults
     * 3. Does NOT reload the page (caller should handle navigation)
     *
     * ## Called By
     *
     * - main.ts event handler - "Clear All Data" button with confirmation dialog
     * - Usually followed by `location.reload()` to reset the UI
     *
     * ## Security Notes
     *
     * This is a **destructive operation** and should only be called after explicit
     * user confirmation. Consider the impact on the user's workflow.
     *
     * Note: Token is NOT cleared, so the user can continue using the addon
     * after clearing data (application re-initializes).
     *
     * @see clearReportCache() - To clear just the temporary report cache
     * @see saveConfig() - To persist only config changes
     */
    clearAllData(): void {
        // ===== Clear localStorage (with fallback support) =====
        // Remove persisted configuration
        safeRemoveItem('otplus_config');

        // Remove persisted UI state
        safeRemoveItem(STORAGE_KEYS.UI_STATE);

        // Remove workspace-scoped overrides for current workspace
        const overrideKey = this._getOverrideKey();
        /* istanbul ignore else -- overrideKey is always truthy when claims.workspaceId exists */
        if (overrideKey) {
            safeRemoveItem(overrideKey);
        }

        // Remove all other workspace-scoped overrides and caches
        const allKeys = safeGetKeys();
        const keysToRemove = allKeys.filter(
            (key) =>
                key.startsWith(STORAGE_KEYS.OVERRIDES_PREFIX) ||
                key.startsWith(STORAGE_KEYS.PROFILES_PREFIX) ||
                key.startsWith(STORAGE_KEYS.HOLIDAYS_PREFIX) ||
                key.startsWith(STORAGE_KEYS.TIMEOFF_PREFIX)
        );
        keysToRemove.forEach((key) => safeRemoveItem(key));

        // ===== Reset In-Memory State =====
        // Clear cached data Maps
        this.overrides = {};
        this.profiles.clear();
        this.holidays.clear();
        this.timeOff.clear();

        // Clear current report data
        this.rawEntries = null;
        this.analysisResults = null;
        this.currentDateRange = null;

        // ===== Reset Configuration to Defaults =====
        // Feature flags
        this.config = {
            useProfileCapacity: true,
            useProfileWorkingDays: true,
            applyHolidays: true,
            applyTimeOff: true,
            showBillableBreakdown: true,
            showDecimalTime: false,
            enableTieredOT: false,
            amountDisplay: 'earned',
            overtimeBasis: 'daily',
            maxPages: DEFAULT_MAX_PAGES,
            encryptStorage: true, // Enterprise default: encrypt localStorage data
            auditConsent: true, // Enterprise default: enable audit logging for compliance
        };

        // Calculation parameters
        this.calcParams = {
            dailyThreshold: 8,
            weeklyThreshold: 40,
            overtimeMultiplier: 1.5,
            tier2ThresholdHours: 0,
            tier2Multiplier: 2.0,
        };

        // UI state
        this.ui = {
            isLoading: false,
            summaryExpanded: false,
            summaryGroupBy: 'user',
            overridesCollapsed: true,
            activeTab: 'summary',
            detailedPage: 1,
            detailedPageSize: 50,
            activeDetailedFilter: 'all',
            hasCostRates: true,
            hasAmountRates: true,
            paginationTruncated: false,
            paginationAbortedDueToTokenExpiration: false,
        };

        // Note: token and claims are NOT cleared, so user remains authenticated
    }

    /**
     * Removes expired localStorage caches to prevent storage bloat.
     *
     * Targets cache prefixes: profiles, holidays, time-off, overrides caches.
     * Entries older than CACHE_CLEANUP_THRESHOLD (7 days) are removed.
     *
     * ## Design Rationale
     *
     * - **Automatic**: Called during Store construction to ensure cleanup happens on each session start
     * - **Non-blocking**: Errors are logged but don't prevent app initialization
     * - **Selective**: Only removes entries matching known cache prefixes
     * - **Graceful**: Handles malformed JSON without crashing
     *
     * ## Cleanup Logic
     *
     * For each localStorage key matching cache prefixes:
     * 1. Parse the stored JSON
     * 2. Check if `timestamp` field exists and is older than threshold
     * 3. If stale (or malformed), remove the entry
     *
     * ## Called By
     *
     * - Store constructor (after config load)
     *
     * @returns Object with cleanup stats: { removed: number, checked: number, errors: number }
     */
    cleanupStaleCaches(): { removed: number; checked: number; errors: number } {
        const stats = { removed: 0, checked: 0, errors: 0 };
        const now = Date.now();

        // Prefixes for caches that have timestamps
        const cachePrefixes = [
            STORAGE_KEYS.PROFILES_PREFIX,
            STORAGE_KEYS.HOLIDAYS_PREFIX,
            STORAGE_KEYS.TIMEOFF_PREFIX,
        ];

        try {
            const keysToRemove: string[] = [];
            const allKeys = safeGetKeys();

            for (const key of allKeys) {
                // Check if key matches any cache prefix
                const isCache = cachePrefixes.some((prefix) => key.startsWith(prefix));
                if (!isCache) continue;

                stats.checked++;

                try {
                    const raw = safeGetItem(key);
                    /* istanbul ignore if -- edge case: key exists but value cleared */
                    if (!raw) {
                        keysToRemove.push(key);
                        continue;
                    }

                    const parsed = JSON.parse(raw);

                    // Check for timestamp field
                    if (typeof parsed?.timestamp === 'number') {
                        const age = now - parsed.timestamp;
                        if (age > CACHE_CLEANUP_THRESHOLD) {
                            keysToRemove.push(key);
                        }
                    } else {
                        // No timestamp means old format or malformed - remove it
                        keysToRemove.push(key);
                    }
                } catch {
                    // Malformed JSON - mark for removal
                    stats.errors++;
                    keysToRemove.push(key);
                }
            }

            // Remove stale entries
            keysToRemove.forEach((key) => {
                safeRemoveItem(key);
                stats.removed++;
            });

            if (stats.removed > 0) {
                stateLogger.debug(
                    `Cleaned up ${stats.removed} stale cache entries (checked ${stats.checked})`
                );
            }
        } catch (e) /* istanbul ignore next -- localStorage unavailable in JSDOM */ {
            // localStorage may be unavailable
            stateLogger.debug('Unable to cleanup caches (localStorage unavailable)', e);
        }

        return stats;
    }

    /**
     * Returns a privacy-safe diagnostic snapshot for troubleshooting.
     *
     * ## Purpose
     *
     * Provides a way to gather diagnostic information without relying on Sentry.
     * Useful for:
     * - User-reported bug investigation
     * - Support ticket context
     * - Developer debugging
     *
     * ## Privacy Guarantees
     *
     * - **No PII**: No user names, emails, or raw user data
     * - **Hashed workspace ID**: Workspace identity is obfuscated
     * - **Counts only**: Cache stats show counts, not contents
     * - **Config snapshot**: Feature flags and thresholds (no secrets)
     *
     * ## Usage
     *
     * ```javascript
     * // In browser console:
     * const diag = store.getDiagnostics();
     * console.log(JSON.stringify(diag, null, 2));
     *
     * // Or via global helper:
     * window.__OTPLUS_DIAGNOSTICS__()
     * ```
     *
     * @returns DiagnosticInfo object with privacy-safe diagnostic data
     */
    getDiagnostics(): DiagnosticInfo {
        // Check for report cache in sessionStorage
        const hasReportCache = safeSessionGetItem(STORAGE_KEYS.REPORT_CACHE) !== null;

        /* istanbul ignore next -- navigator always defined in browser */
        const browserAgent =
            typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

        return {
            version: process.env.VERSION ?? 'unknown',
            timestamp: new Date().toISOString(),
            browser: browserAgent,
            config: { ...this.config },
            calcParams: { ...this.calcParams },
            cacheStats: {
                profilesCount: this.profiles.size,
                holidaysCount: this.holidays.size,
                timeOffCount: this.timeOff.size,
                hasReportCache,
                usingFallbackStorage: isUsingFallbackStorage(),
            },
            apiStatus: { ...this.apiStatus },
            throttleStatus: { ...this.throttleStatus },
            hashedWorkspaceId: this.claims?.workspaceId
                ? hashString(this.claims.workspaceId)
                : null,
            isAuthenticated: this.token !== null,
            dateRange: this.currentDateRange ? { ...this.currentDateRange } : null,
        };
    }
}

// Create store instance
export const store = new Store();

// Run cache cleanup on module load
store.cleanupStaleCaches();

const isProductionEnv =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

// Expose diagnostics helper on window for console access (non-production only)
/* istanbul ignore next -- browser-only global */
if (typeof window !== 'undefined' && !isProductionEnv) {
    (window as unknown as Record<string, unknown>).__OTPLUS_DIAGNOSTICS__ = () =>
        store.getDiagnostics();
}
export type { Store };
