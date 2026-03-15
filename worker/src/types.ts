/**
 * @fileoverview Shared TypeScript type definitions for the Cloudflare Worker.
 * Defines the environment bindings, configuration schemas, lifecycle payloads,
 * and JWT claim structure used across all worker modules (router, auth, API
 * routes, lifecycle).
 */

/**
 * Cloudflare Worker environment bindings.
 *
 * Populated automatically by the Workers runtime from `wrangler.toml` bindings
 * and environment variables.
 */
export interface Env {
  /** Cloudflare KV namespace used to persist workspace settings, overrides, and install tokens. */
  SETTINGS_KV: KVNamespace;

  /** Origin URL of the GitHub Pages site that hosts the static frontend assets (e.g. "https://user.github.io/otplus"). */
  GITHUB_PAGES_ORIGIN: string;

  /**
   * Deployment environment identifier (e.g. "production", "staging").
   *
   * When set to "production", localhost origins are rejected from the CORS
   * allowlist.  Omitting this value or using any other string enables
   * localhost for local development.
   */
  ENVIRONMENT?: string;
}

/**
 * Overtime feature-flag configuration persisted per workspace.
 *
 * Controls which data sources are consulted during overtime calculation and
 * how results are displayed in the sidebar UI.  All nine fields are required
 * when writing to KV (enforced by `isValidOvertimeConfig` in api-routes.ts).
 */
export interface OvertimeConfig {
  /** Whether to read each user's profile-level daily capacity instead of using the global dailyThreshold. */
  useProfileCapacity: boolean;

  /** Whether to read each user's profile-level working days instead of assuming Mon–Fri. */
  useProfileWorkingDays: boolean;

  /** Whether public holidays fetched from the Clockify API reduce the expected working hours for a day. */
  applyHolidays: boolean;

  /** Whether approved time-off entries reduce the expected working hours for a day. */
  applyTimeOff: boolean;

  /** Whether the summary view splits tracked time into billable and non-billable columns. */
  showBillableBreakdown: boolean;

  /** Whether durations are displayed as decimal hours (e.g. 1.50) rather than HH:MM format. */
  showDecimalTime: boolean;

  /** Whether tiered overtime (tier 2 multiplier above a second threshold) is active. */
  enableTieredOT: boolean;

  /** Controls which monetary column is shown: earned wages, employer cost, or profit margin. */
  amountDisplay: 'earned' | 'cost' | 'profit';

  /** Whether overtime is computed on a daily basis, weekly basis, or both. */
  overtimeBasis: 'daily' | 'weekly' | 'both';
}

/**
 * Numeric parameters that drive the overtime calculation engine.
 *
 * All five fields are required when writing to KV (enforced by
 * `isValidCalcParams` in api-routes.ts).  Ranges are validated server-side
 * before persistence.
 */
export interface CalculationParams {
  /** Hours per day before overtime kicks in (0–24). */
  dailyThreshold: number;

  /** Hours per week before overtime kicks in (0–168). */
  weeklyThreshold: number;

  /** Multiplier applied to tier-1 overtime hours (e.g. 1.5 = time-and-a-half). */
  overtimeMultiplier: number;

  /** Hours of overtime in a day before the tier-2 multiplier takes effect (0–168). Only meaningful when enableTieredOT is true. */
  tier2ThresholdHours: number;

  /** Multiplier applied to tier-2 overtime hours (e.g. 2.0 = double-time). Only meaningful when enableTieredOT is true. */
  tier2Multiplier: number;
}

/**
 * Full workspace configuration record stored in KV under
 * `ws:{workspaceId}:config`.
 *
 * Wraps the feature-flag config and numeric calc params with metadata
 * (schema version, audit trail).
 */
export interface WorkspaceConfig {
  /** Feature-flag overtime configuration. */
  config: OvertimeConfig;

  /** Numeric calculation parameters (thresholds and multipliers). */
  calcParams: CalculationParams;

  /**
   * Schema version tag for forward-compatible reads.
   *
   * Set to `1` on every write since the hardening pass.  Legacy records
   * written before versioning may be missing this field.
   */
  schemaVersion?: number;

  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;

  /** Clockify user ID of the admin who last saved the config. */
  updatedBy: string;
}

/**
 * Per-user override record stored in KV under
 * `ws:{workspaceId}:overrides`.
 *
 * The `overrides` map is keyed by Clockify user ID; each value contains
 * user-specific capacity, multiplier, and scheduling overrides validated
 * against `OVERRIDE_BOUNDS` in api-routes.ts.
 */
export interface WorkspaceOverrides {
  /** Map of userId to per-user override objects. */
  overrides: Record<string, unknown>;

  /**
   * Schema version tag for forward-compatible reads.
   *
   * Set to `1` on every write since the hardening pass.  Legacy records
   * written before versioning may be missing this field.
   */
  schemaVersion?: number;

  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;

  /** Clockify user ID of the admin who last saved the overrides. */
  updatedBy: string;
}

/**
 * JSON body sent by Clockify to the `/lifecycle/installed` endpoint when a
 * workspace installs the addon.
 *
 * The `authToken` is a Clockify-signed JWT that the Worker persists in KV
 * and later uses for outbound API calls on behalf of the workspace.
 */
export interface InstalledPayload {
  /** Unique identifier of the addon registration in Clockify. */
  addonId: string;

  /** Clockify-signed JWT installation token used for server-to-server API calls. */
  authToken: string;

  /** ID of the workspace that installed the addon. */
  workspaceId: string;

  /** Clockify user ID of the user who triggered the installation. */
  asUser: string;

  /** Optional Clockify API base URL provided in the lifecycle payload (may vary by region). */
  apiUrl?: string;

  /** Clockify-generated user ID for the addon's service account within the workspace. */
  addonUserId: string;
}

/**
 * Decoded JWT payload structure for tokens issued by Clockify.
 *
 * Both user-session tokens (from the sidebar iframe) and installation tokens
 * are Clockify-signed JWTs.  The `decodeJwt()` function in auth.ts
 * normalizes legacy alias claims (`activeWs`, `apiUrl`, `baseURL`, `baseUrl`)
 * into the canonical `workspaceId` and `backendUrl` fields before returning
 * this type.
 */
export interface JwtPayload {
  /** JWT subject claim — typically the addon key or user identifier. */
  sub?: string;

  /** Clockify user ID (present in user-session tokens). */
  user?: string;

  /** Workspace ID this token is scoped to.  Always present after alias normalization. */
  workspaceId: string;

  /** Workspace-level role of the user (e.g. "WORKSPACE_ADMIN", "TEAM_MANAGER"). */
  workspaceRole?: string;

  /** Clockify API base URL (e.g. "https://api.clockify.me/api").  Populated after alias normalization. */
  backendUrl?: string;

  /** Token expiration time as a Unix epoch (seconds). */
  exp?: number;

  /** Token issued-at time as a Unix epoch (seconds). */
  iat?: number;

  /** Index signature for any additional Clockify-specific or custom claims. */
  [key: string]: unknown;
}
