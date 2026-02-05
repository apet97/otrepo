# OTPLUS Operational Guide

This guide explains what OTPLUS consumes (modules, storage, toggles) and lists every Clockify API call the addon makes so you can onboard quickly or reason about failures.

## What the addon uses

- **Detailed Report Entrypoint**: `api.fetchDetailedReport` hits `/reports/detailed`, requests 200-entry pages, and normalizes the response to look like legacy time entries with `timeInterval`, `projectId`, `taskId`, `earnedRate`, `costRate`, `tags`, and `hourlyRate` metadata.
- **Profiles, Holidays, Time Off**: Optional fetches (`fetchAllProfiles`, `fetchAllHolidays`, `fetchAllTimeOff`) populate maps that the calculation engine consults for capacity, working-day exceptions, holidays, and approved time off. Each request is batched (BATCH_SIZE = 5) and retried per the token bucket. Profile/holiday/time-off responses are persisted in localStorage with a 6-hour TTL and versioned schema; time-off hours capture `halfDayHours` or derive from period start/end when provided.
- **`state.js` store**: Single source of truth for users, overrides, config toggles, API diagnostics, and UI state. Configuration toggles (e.g., `showBillableBreakdown`, `showDecimalTime`, `useProfileCapacity`, `overtimeBasis`) plus numeric params (`dailyThreshold`, `weeklyThreshold`, `overtimeMultiplier`, tier 2 thresholds/multipliers) are saved under `otplus_config`. Overrides live under `overtime_overrides_{workspaceId}`, and UI settings (grouping, expansion state) under `otplus_ui_state`.
- **`calc.js` engine**: Implements tail attribution, supports daily/weekly/both overtime bases, takes per-user overrides (global/weekly/per-day), respects holidays/time-off from API data, and tracks tier 2 premiums without altering the OT hours. PTO entry types are informational only and do not change capacity. Each entry receives `analysis` metadata for regular/OT hours plus daily/weekly/combined OT and money breakdowns for earned/cost/profit.
- **`ui.js` renderers**: Summary strip (two rows when billable breakdown is enabled), table grouping (user/project/client/task/date/week), detailed paginated table (Status column with badges, billable breakdown toggles), and override editors (global, weekly, per-day with copy actions).
- **`export.js`**: Builds sanitized CSVs with headers (Date, User, capacity, breakdowns, holiday flags, total/decimal hours) plus daily/weekly/combined OT columns, and protects against formula injection by prefixing `'` when cells begin with `=`, `+`, `-`, `@`, tab, or CR.

## Storage & Overrides at a glance

| Key | Contents | Notes |
|-----|----------|-------|
| `otplus_config` | `{ config: {...toggles}, calcParams: {...thresholds} }` | Loaded on startup, saved whenever toggles/inputs change. |
| `overtime_overrides_{workspaceId}` | Per-user overrides (`capacity`, `multiplier`, `tier2`), optional `.mode`, `weeklyOverrides`, `perDayOverrides`. | Copy-to-weekly/per-day helpers use the stored global values to seed editors. |
| `otplus_ui_state` | UI layout prefs (`summaryExpanded`, `summaryGroupBy`, `overridesCollapsed`). | Used to keep the last view across reloads. |
| `otplus_profiles_{workspaceId}` | Cached profile map with `{ version, timestamp, entries }`. | 6-hour TTL, versioned schema. |
| `otplus_holidays_{workspaceId}_{start}_{end}` | Cached holiday map with `{ version, timestamp, range, entries }`. | Range-scoped cache with TTL. |
| `otplus_timeoff_{workspaceId}_{start}_{end}` | Cached time-off map with `{ version, timestamp, range, entries }`. | Stores per-day hours + full-day flags. |

**Override modes**: `global`, `weekly`, `perDay`. Weekly and per-day editors expose inputs for capacity, multiplier, and tier2 controls; values are validated (no negative thresholds, multiplier >= 1) before saving.

### Override precedence (capacity, multiplier, tier2 threshold/multiplier)

When determining the effective value for capacity or multiplier on a given day, the calculation engine uses this cascade:

1. **Per-day override** (highest priority): If the user's mode is `perDay` and `perDayOverrides[dateKey]` has a value, use it.
2. **Weekly override**: If the user's mode is `weekly` and `weeklyOverrides[weekday]` has a value, use it.
3. **Global user override**: If the user has a global override value (`overrides[userId].capacity` etc.), use it.
4. **Profile capacity** (only for capacity): If `useProfileCapacity` is enabled and the profile has `workCapacityHours`, use it.
5. **Global default** (lowest priority): Fall back to `calcParams.dailyThreshold` (default 8h) or the corresponding multiplier/tier2 default.

**Important**: The mode must match for weekly/per-day overrides to apply. Setting `weeklyOverrides` without `mode: 'weekly'` will NOT apply those overrides.

## API call catalog

All Clockify requests go through `api.fetchWithAuth`, which attaches `X-Addon-Token`, enforces the token bucket (50 requests per second), and logs/handles 401/403/404 without retries. 429 responses trigger exponential backoff until the retry limit.

| Endpoint | Method | Purpose | Payload/Query | Notes |
|----------|--------|---------|---------------|-------|
| `/v1/workspaces/{workspaceId}/reports/detailed` | POST | Primary data source for time entries | `{ dateRangeStart, dateRangeEnd, amountShown, amounts: ['EARNED','COST','PROFIT'], detailedFilter: { page, pageSize } }` | Response may use `timeentries` or `timeEntries`; `amounts` array feeds rate/cost/profit breakdowns. |
| `/v1/workspaces/{workspaceId}/users` | GET | Seeds user list for overrides and calculations | none | Used once at load to render overrides table and ensure every user is accounted for. |
| `/v1/workspaces/{workspaceId}/member-profile/{userId}` | GET | Retrieves profile capacity and working days | none | Batched via `fetchAllProfiles`; results parsed into `{ workCapacityHours, workingDays }`. |
| `/v1/workspaces/{workspaceId}/holidays/in-period` | GET | Loads assigned holidays per user | Query: `start`, `end` (full ISO datetimes), `assigned-to=userId` | Scheduler ensures `YYYY-MM-DDTHH:mm:ssZ`; results expanded for multi-day holidays. |
| `/v1/workspaces/{workspaceId}/time-off/requests` | POST | Fetches approved time off per user list | `{ page:1, pageSize:200, users, statuses:['APPROVED'], start, end }` | Response may contain `.requests` or be an array; maps per-date hours and full-day flags. |

### Rate limiting, circuit breaker & aborts
- **Token bucket rate limiter**: `waitForToken()` refills 50 tokens every 1000 ms and pauses requests when bucket empty.
- **Circuit breaker**: Opens after 5 consecutive failures, auto-recovers after 30s. When open, requests immediately return 503 without hitting the network.
- Each fetch accepts an `AbortSignal` (provided by `AbortController` in `main.handleGenerateReport`) so in-flight requests can be aborted when a new report starts.
- 401/403/404 errors are logged and returned without retries; 429 errors trigger delays based on `Retry-After` headers or a 5s default before retrying. 5xx errors retry with exponential backoff (1s, 2s, 4s), max 2 retries.
- AbortSignal aborts return empty results gracefully without throwing errors.
- **Idempotency**: All POST requests include an `X-Idempotency-Key` header to prevent duplicate submissions during retries.
- **Body signing**: POST requests with body include an `X-Body-Signature` HMAC-SHA256 header for tamper detection.

## Data flow recap
1. `main.handleGenerateReport()` cancels previous reports via the controller-level `AbortController`, increments `currentRequestId`, and shows the loading state.
2. Users are loaded once; they seed overrides and profile lookups.
3. `fetchDetailedReport()` retrieves entries for every user in a single request; optional `fetchAllProfiles`, `fetchAllHolidays`, and `fetchAllTimeOff` run in parallel and are merged with cached data when available.
4. `calculateAnalysis()` groups by user/day, determines effective capacity (overrides → profile → defaults), splits work vs OT via tail attribution with daily/weekly/both modes, and calculates money columns including tier2 premiums.
5. UI renderers consume `store.analysisResults` to display the summary strip, grouped tables, and paginated detailed entries; export and status indicators rely on the same analysis object.

## Cache prompts & large-range warnings
- If sessionStorage contains a recent report for the same date range, the user is prompted to reuse or refresh cached data.
- If the date range exceeds 365 days, a confirmation prompt is shown before fetching to prevent accidental long-running reports.

## Troubleshooting API errors

| Error | HTTP Code | Cause | Resolution |
|-------|-----------|-------|------------|
| **AUTH_ERROR** | 401/403 | Invalid or expired token | Re-authenticate by reloading the addon from Clockify |
| **RATE_LIMIT** | 429 | Too many requests | Automatic retry with exponential backoff; reduce date range or wait |
| **NOT_FOUND** | 404 | Invalid workspace/user ID | Verify workspace access in Clockify |
| **NETWORK_ERROR** | - | Connection lost or blocked | Check network connectivity; verify no firewall blocking |
| **API_ERROR** | 5xx | Clockify server issue | Retry later; check Clockify status page |

### Common issues

1. **Report loading hangs**: Check if rate limiting banner appears. Large date ranges + many users can hit rate limits.
2. **Wrong capacity shown**: Verify profile capacity is enabled and user profiles have `workCapacityHours` set in Clockify.
3. **Dates shifted by a day**: Report uses viewer's Clockify profile timezone for date grouping. Verify timezone setting.
4. **Holidays/time-off not applied**: Ensure holidays/time-off APIs are enabled for the workspace and data is approved.
5. **Negative profit values**: Non-billable entries now show $0 profit instead of negative values (fixed in v2.0.0).

### Diagnostic info
- API status indicators show profile/holiday/time-off fetch failures at top of report.
- Rate limit retries are tracked and displayed when throttling occurs.
- Browser console logs detailed API request/response info for debugging.
- Health check available via `window.__OTPLUS_HEALTH_CHECK__` (returns status, component details, issues).
- Performance metrics via `window.__OTPLUS_METRICS__` (Prometheus/StatsD export).
- Memory profiler via `window.__OTPLUS_MEMORY_PROFILER__` for leak detection.
- Performance dashboard overlay via `Ctrl+Shift+P` or `window.__OTPLUS_PERF_DASHBOARD__`.

## Enterprise features

### Encryption
When `encryptStorage` is enabled in config, overrides stored in localStorage are encrypted with AES-GCM using keys derived from the workspace ID via PBKDF2 (100,000 iterations). See `js/crypto.ts`.

### Worker offload
Calculations with 500+ entries are automatically offloaded to a Web Worker pool (`js/worker-pool.ts`) to keep the UI responsive. The pool size defaults to `navigator.hardwareConcurrency`.

### Structured logging
The logger (`js/logger.ts`) supports JSON output format with correlation IDs for request tracing. Enable via `localStorage.setItem('otplus_log_format', 'json')`. Audit events (CONFIG_CHANGE, OVERRIDE_CHANGE, EXPORT) bypass log level filters.

### Session management
JWT token expiration is monitored. Users receive a warning 5 minutes before expiration and a dialog when the session expires, providing a graceful re-authentication path.

### Observability
- **Metrics** (`js/metrics.ts`): Tracks API call duration, calculation time, cache hit rates. Exports to Prometheus and StatsD formats.
- **CSP reporting** (`js/csp-reporter.ts`): Listens for Content Security Policy violations and reports to console, Sentry, and custom endpoints.
- **Health check** (`js/main.ts`): `window.__OTPLUS_HEALTH_CHECK__` returns component-level health status (circuit breaker, storage, API, auth).
