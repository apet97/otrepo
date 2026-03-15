# Configuration Reference

Complete reference for every configurable value in OTPLUS.

## Table of Contents

- [OvertimeConfig (Feature Flags)](#overtimeconfig-feature-flags)
- [CalculationParams](#calculationparams)
- [User Overrides](#user-overrides)
- [Input Bounds Validation](#input-bounds-validation)
- [Build-Time Constants](#build-time-constants)
- [CI Secrets & Variables](#ci-secrets--variables)
- [Worker Environment Bindings](#worker-environment-bindings)
- [KV Data Schema](#kv-data-schema)
- [Client-Side Storage Keys](#client-side-storage-keys)
- [Manifest Fields](#manifest-fields)
- [Timing Constants](#timing-constants)

---

## OvertimeConfig (Feature Flags)

Defined in `js/types.ts` (`OvertimeConfig`). All 9 fields are **required** when saving to the server. Default values are applied on first install by `worker/src/lifecycle.ts`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `useProfileCapacity` | `boolean` | `true` | Read each user's Clockify profile-level daily capacity instead of using `dailyThreshold`. |
| `useProfileWorkingDays` | `boolean` | `true` | Read each user's profile-level working days instead of assuming Mon-Fri. |
| `applyHolidays` | `boolean` | `true` | Public holidays reduce expected working hours for a day. |
| `applyTimeOff` | `boolean` | `true` | Approved time-off entries reduce expected working hours. |
| `showBillableBreakdown` | `boolean` | `true` | Split tracked time into billable and non-billable columns in the summary. |
| `showDecimalTime` | `boolean` | `false` | Display durations as decimal hours (e.g. 1.50) instead of HH:MM. |
| `enableTieredOT` | `boolean` | `false` | Enable tier-2 overtime multiplier above `tier2ThresholdHours`. |
| `amountDisplay` | `'earned' \| 'cost' \| 'profit'` | `'earned'` | Which monetary column to show: earned wages, employer cost, or profit margin. |
| `overtimeBasis` | `'daily' \| 'weekly' \| 'both'` | `'daily'` | Whether overtime is computed on a daily basis, weekly basis, or both. |

### Optional Config Extensions

These fields exist in the frontend `OvertimeConfig` type (`js/types.ts`) but are **not** part of the 9 required server-validated fields. They are stored client-side or as part of the broader config object.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxPages` | `number` | `2500` | Maximum API pages to fetch (0 = unlimited up to hard limit). |
| `encryptStorage` | `boolean` | `true` | Enable AES-GCM encryption for localStorage data. |
| `auditConsent` | `boolean` | `true` | Enable audit logging of config changes and CSV exports. |
| `rateLimitCapacity` | `number` | `50` | Token bucket rate limit capacity (requests per refill). |
| `rateLimitRefillMs` | `number` | `1000` | Token bucket refill interval in ms. |
| `circuitBreakerFailureThreshold` | `number` | `5` | Consecutive failures before circuit breaker opens. |
| `circuitBreakerResetMs` | `number` | `30000` | Circuit breaker reset timeout in ms. |

---

## CalculationParams

Defined in `js/types.ts` (`CalculationParams`). All 5 fields are **required** when saving. Default values from `worker/src/lifecycle.ts`.

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `dailyThreshold` | `number` | `8` | 0–24 | Hours per day before overtime begins. |
| `weeklyThreshold` | `number` | `40` | 0–168 | Hours per week before overtime begins. |
| `overtimeMultiplier` | `number` | `1.5` | 0–100 | Multiplier for tier-1 overtime (e.g. 1.5 = time-and-a-half). |
| `tier2ThresholdHours` | `number` | `0` | 0–168 | OT hours per day before tier-2 multiplier kicks in. Only meaningful when `enableTieredOT` is true. |
| `tier2Multiplier` | `number` | `2.0` | 0–100 | Multiplier for tier-2 overtime (e.g. 2.0 = double-time). Only meaningful when `enableTieredOT` is true. |

---

## User Overrides

Defined in `js/types.ts` (`UserOverride`, `WeeklyOverride`, `PerDayOverride`). Validated server-side in `worker/src/api-routes.ts` against `OVERRIDE_BOUNDS`.

### Override Modes

| Mode | Description |
|------|-------------|
| `global` | Single set of values applied uniformly to all days. |
| `weekly` | Per-weekday overrides (keyed by `MONDAY`, `TUESDAY`, etc.). |
| `perDay` | Per-date overrides (keyed by `YYYY-MM-DD`). |

### Override Fields

Available in all three modes (global top-level, `weeklyOverrides[day]`, `perDayOverrides[date]`):

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `capacity` | `number` | 0–24 | Daily capacity in hours. |
| `multiplier` | `number` | 1–5 | Overtime multiplier. |
| `tier2Threshold` | `number` | 0–24 | Tier-2 threshold in hours. |
| `tier2Multiplier` | `number` | 1–5 | Tier-2 multiplier. |

All fields are **optional** within each override object.

### OVERRIDE_BOUNDS (Server-Side)

Defined in `worker/src/api-routes.ts`:

```
capacity:       [0, 24]
multiplier:     [1, 5]
tier2Threshold: [0, 24]
tier2Multiplier:[1, 5]
```

Note: Override bounds are intentionally **tighter** than `CalculationParams` ranges because overrides are per-user adjustments, not workspace-wide defaults.

---

## Input Bounds Validation

Defined in `js/constants.ts` (`INPUT_BOUNDS`). Enforced client-side via `validateInputBounds()` in `js/utils.ts`.

| Field | Min | Max | Description |
|-------|-----|-----|-------------|
| `dailyThreshold` | 0 | 24 | Daily threshold in hours. |
| `weeklyThreshold` | 0 | 168 | Weekly threshold in hours. |
| `overtimeMultiplier` | 1 | 5 | Overtime multiplier. |
| `tier2Multiplier` | 1 | 5 | Tier-2 multiplier. |
| `tier2ThresholdHours` | 0 | 24 | Tier-2 threshold in OT hours. |
| `capacity` | 0 | 24 | Daily capacity override. |
| `multiplier` | 1 | 5 | Multiplier override. |

Additional constants:

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_DATE_RANGE_DAYS` | 365 | Maximum days in a single report date range. |

---

## Build-Time Constants

Injected by esbuild `define` in `build.js`. These are compile-time string replacements — dead code paths are eliminated in production.

| Expression | Source | Description |
|-----------|--------|-------------|
| `process.env.VERSION` | `package.json` version | App version string (e.g. `"2.1.0"`). |
| `process.env.NODE_ENV` | `--production` flag | `"production"` or `"development"`. Enables dead-code elimination of dev-only paths. |
| `process.env.SENTRY_DSN` | `SENTRY_DSN` env var | Sentry error-reporting DSN. Empty string disables Sentry. |

### Build-Time Environment Variables

| Variable | Usage | Description |
|----------|-------|-------------|
| `MANIFEST_BASE_URL` | `build.js` | If set, overrides `baseUrl` in the copied `manifest.json`. |
| `SOURCE_DATE_EPOCH` | `build.js` | Unix timestamp for reproducible builds. When set, the build banner uses this instead of wall-clock time. |

---

## CI Secrets & Variables

Configured in GitHub Actions (`.github/workflows/ci.yml`).

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | Secret | Yes (for Worker deploy) | Cloudflare API token with Worker deployment permissions. |
| `SENTRY_DSN` | Secret | No | Sentry DSN for error reporting in production builds. |
| `ENABLE_PAGES` | Variable | No | Set to any truthy value to enable GitHub Pages deployment. |

---

## Worker Environment Bindings

Defined in `worker/wrangler.toml` and `worker/src/types.ts` (`Env` interface).

| Binding | Type | Description |
|---------|------|-------------|
| `SETTINGS_KV` | `KVNamespace` | Cloudflare KV namespace for workspace settings, overrides, and install tokens. |
| `GITHUB_PAGES_ORIGIN` | `string` (var) | Origin URL of the GitHub Pages site hosting static frontend assets (e.g. `https://user.github.io/otplus`). |
| `ENVIRONMENT` | `string` (var) | Deployment environment identifier. When `"production"`, localhost CORS origins are rejected. Any other value (or omitted) enables localhost for development. |

---

## KV Data Schema

All KV keys are workspace-scoped with the prefix `ws:{workspaceId}:`.

### `ws:{workspaceId}:token`

Stores the Clockify installation auth token (raw JWT string). Written during `INSTALLED` lifecycle. Used by the Worker for outbound API calls (admin role checks).

### `ws:{workspaceId}:config`

```json
{
  "config": {
    "useProfileCapacity": true,
    "useProfileWorkingDays": true,
    "applyHolidays": true,
    "applyTimeOff": true,
    "showBillableBreakdown": true,
    "showDecimalTime": false,
    "enableTieredOT": false,
    "amountDisplay": "earned",
    "overtimeBasis": "daily"
  },
  "calcParams": {
    "dailyThreshold": 8,
    "weeklyThreshold": 40,
    "overtimeMultiplier": 1.5,
    "tier2ThresholdHours": 0,
    "tier2Multiplier": 2.0
  },
  "schemaVersion": 1,
  "updatedAt": "2026-01-15T10:30:00.000Z",
  "updatedBy": "user-id-string"
}
```

Validated on read by `isValidWorkspaceConfig()` and on write by `isValidOvertimeConfig()` + `isValidCalcParams()`.

### `ws:{workspaceId}:overrides`

```json
{
  "overrides": {
    "user-id-1": {
      "mode": "global",
      "capacity": 7.5,
      "multiplier": 2.0
    },
    "user-id-2": {
      "mode": "weekly",
      "weeklyOverrides": {
        "MONDAY": { "capacity": 8 },
        "FRIDAY": { "capacity": 6, "multiplier": 2.0 }
      }
    }
  },
  "schemaVersion": 1,
  "updatedAt": "2026-01-15T10:30:00.000Z",
  "updatedBy": "user-id-string"
}
```

Validated on read by `isValidWorkspaceOverrides()` and on write by `isValidUserOverride()` per user entry.

---

## Client-Side Storage Keys

Defined in `js/constants.ts` (`STORAGE_KEYS`). Keys with `_PREFIX` suffix are combined with workspace ID for isolation.

| Key / Prefix | Scope | Data Shape | Description |
|-------------|-------|------------|-------------|
| `overtime_density` | Global | `string` (`'compact'` \| `'spacious'`) | User layout preference. |
| `otplus_debug` | Global | `string` (`'true'`) | Debug mode flag. |
| `otplus_log_format` | Global | `string` (`'text'` \| `'json'`) | Log output format. |
| `overtime_overrides_{wsId}` | Workspace | `JSON (encrypted)` | User-specific capacity/multiplier overrides. |
| `overtime_overrides_ui_{wsId}` | Workspace | `JSON` | Override UI state (collapsed/expanded). |
| `otplus_profiles_{wsId}` | Workspace | `JSON` | Cached user profiles. |
| `otplus_holidays_{wsId}_{range}` | Workspace+Range | `JSON` | Cached holidays. |
| `otplus_timeoff_{wsId}_{range}` | Workspace+Range | `JSON` | Cached time-off data. |
| `otplus_ui_state` | Global | `JSON` | UI state (grouping, expand/collapse). |
| `otplus_report_cache` | Global | `JSON (encrypted)` | Report cache (IndexedDB primary, sessionStorage fallback). |

---

## Manifest Fields

The addon manifest (`manifest.json`) defines how Clockify discovers and configures the addon.

| Field | Value | Description |
|-------|-------|-------------|
| `schemaVersion` | `"1.3"` | Clockify addon manifest schema version. |
| `key` | `"overtime-summary"` | Unique addon identifier. Must match `ADDON_MANIFEST_KEY` in Worker auth. |
| `name` | `"Overtime Summary"` | Display name in Clockify marketplace. |
| `baseUrl` | Worker URL | Base URL for all component paths and lifecycle endpoints. Must point to the Cloudflare Worker, not GitHub Pages directly. |
| `description` | (string) | Marketplace description. |
| `minimalSubscriptionPlan` | `"STANDARD"` | Minimum Clockify plan required. |
| `scopes` | `["TIME_ENTRY_READ", "USER_READ", "TIME_OFF_READ", "WORKSPACE_READ", "REPORTS_READ"]` | API permissions requested. |
| `components` | `[{ type: "sidebar", accessLevel: "ADMINS", path: "/", label: "Overtime Summary" }]` | UI components (sidebar widget). |
| `iconPath` | `"/icon.svg"` | Path to addon icon. |
| `lifecycle` | `[{ path: "/lifecycle/installed", type: "INSTALLED" }, { path: "/lifecycle/deleted", type: "DELETED" }]` | Webhook endpoints for install/uninstall. |

---

## Timing Constants

All timeouts, TTLs, and limits used across the application.

### Caching

| Constant | Value | Source | Description |
|----------|-------|--------|-------------|
| `REPORT_CACHE_TTL` | 5 minutes (300,000 ms) | `js/constants.ts` | Report cache expiry. Cache < 5s old is auto-reused without prompting. |
| `DATA_CACHE_TTL` | 6 hours (21,600,000 ms) | `js/constants.ts` | Persistent cache TTL for profiles/holidays/time-off. |
| `DATA_CACHE_VERSION` | `1` | `js/constants.ts` | Schema version for cached maps. |
| `CACHE_CLEANUP_THRESHOLD` | 7 days | `js/constants.ts` | Stale caches older than this are removed on startup. |
| `REPORT_CACHE_SCHEMA_VERSION` | Set on write, checked on read | — | Schema mismatches treated as cache misses. |

### API & Network

| Constant | Value | Source | Description |
|----------|-------|--------|-------------|
| `PER_REQUEST_TIMEOUT_MS` | 30 seconds | `js/constants.ts` | Individual fetch call timeout via `AbortSignal.timeout()`. |
| `REPORT_GENERATION_TIMEOUT_MS` | 300 seconds (5 min) | `js/constants.ts` | Total report generation timeout. Auto-aborts entire flow. |
| `SETTINGS_API_TIMEOUT_MS` | 10 seconds | `js/settings-api.ts` | Settings API fetch timeout. |
| `TOKEN_REFRESH_TIMEOUT_MS` | 5 seconds | `js/main.ts` | Timeout waiting for Clockify token refresh response. |

### Rate Limiting & Retry

| Constant | Default | Description |
|----------|---------|-------------|
| `rateLimitCapacity` | 50 | Token bucket capacity (requests per refill). |
| `rateLimitRefillMs` | 1000 | Token bucket refill interval. |
| `circuitBreakerFailureThreshold` | 5 | Failures before circuit breaker opens. |
| `circuitBreakerResetMs` | 30,000 | Circuit breaker cooldown before retrying. |

### Pagination Limits

| Constant | Value | Source | Description |
|----------|-------|--------|-------------|
| `DEFAULT_MAX_PAGES` | 2,500 | `js/constants.ts` | Default max pages to fetch (2,500 × 200 = 500K entries). |
| `HARD_MAX_PAGES_LIMIT` | 5,000 | `js/constants.ts` | Absolute max regardless of config (5,000 × 200 = 1M entries). |
| `MAX_ENTRIES_LIMIT` | 1,000,000 | `js/constants.ts` | Absolute max entries (safety valve for memory). |

### Session & Worker

| Constant | Value | Source | Description |
|----------|-------|--------|-------------|
| `PROACTIVE_REFRESH_SECONDS` | 120 (2 min) | `js/main.ts` | Request token refresh this many seconds before JWT expiry. |
| `SESSION_WARNING_MINUTES` | 5 | `js/main.ts` | Show session expiring warning this many minutes before expiry. |
| Worker task timeout | 120 seconds | `js/worker-manager.ts` | Max time for a Web Worker calculation task. |

### Static Proxy Cache

| Resource | Cache-Control | Source |
|----------|--------------|--------|
| HTML pages, manifest | `no-cache, no-store, must-revalidate` | `worker/src/index.ts` |
| JS, CSS, images | `public, max-age=300` (5 min) | `worker/src/index.ts` |
