# Architecture

System architecture of OTPLUS with diagrams and data flow descriptions.

## Table of Contents

- [System Context](#system-context)
- [Module Dependency Graph](#module-dependency-graph)
- [Frontend Initialization Sequence](#frontend-initialization-sequence)
- [Report Generation Flow](#report-generation-flow)
- [Settings Sync Flow](#settings-sync-flow)
- [Worker Request Routing](#worker-request-routing)
- [State Management](#state-management)
- [Caching Strategy](#caching-strategy)
- [Web Worker Architecture](#web-worker-architecture)
- [Build Pipeline](#build-pipeline)

---

## System Context

```
┌──────────────────────────────────────────────────────────┐
│                    Clockify App                          │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Sidebar iframe (?auth_token=<jwt>)                │  │
│  │                                                    │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │         OTPLUS Frontend (SPA)                │  │  │
│  │  │  • HTML/CSS/JS from GitHub Pages             │  │  │
│  │  │  • JWT auth, theme, session timeout          │  │  │
│  │  │  • Report generation, CSV export             │  │  │
│  │  │  • Web Worker for calculations               │  │  │
│  │  └──────────┬───────────────┬───────────────────┘  │  │
│  │             │               │                      │  │
│  └─────────────┼───────────────┼──────────────────────┘  │
│                │               │                          │
└────────────────┼───────────────┼──────────────────────────┘
                 │               │
      ┌──────────▼──┐   ┌───────▼───────┐
      │  Clockify   │   │  Cloudflare   │
      │  APIs       │   │  Worker       │
      │  (clockify  │   │               │
      │   .me)      │   │ /lifecycle/*  │──▶ KV (settings)
      │             │   │ /api/*        │──▶ KV (config/overrides)
      │  • Users    │   │ /*            │──▶ GitHub Pages (proxy)
      │  • Reports  │   │               │
      │  • Holidays │   └───────────────┘
      │  • TimeOff  │
      │  • Profiles │
      └─────────────┘
```

---

## Module Dependency Graph

```
main.ts (entry point)
├── state.ts (central store)
├── api.ts (HTTP client, rate limiting, pagination)
│   └── streaming.ts (batch utilities)
├── settings-api.ts (Worker CRUD client)
├── config-manager.ts (config event binding)
├── report-orchestrator.ts (report generation, caching)
│   ├── api.ts
│   ├── worker-manager.ts → calc.worker.ts (Web Worker)
│   └── data-selectors.ts
├── worker-manager.ts (worker pool dispatch)
├── health-check.ts (health monitoring)
├── date-presets.ts (date range presets)
├── error-reporting.ts → @sentry/browser
├── csp-reporter.ts
├── crypto.ts (AES-GCM encryption)
├── logger.ts (structured logging)
├── utils.ts (validation, formatting, escaping)
├── constants.ts (configuration defaults, bounds)
├── export.ts (CSV generation)
│   └── data-selectors.ts
└── ui/index.ts (UI barrel)
    ├── ui/summary.ts
    ├── ui/detailed.ts
    ├── ui/overrides.ts
    ├── ui/dialogs.ts
    └── ui/shared.ts

worker/src/index.ts (Worker entry point)
├── worker/src/auth.ts (JWT, CORS, admin check)
├── worker/src/api-routes.ts (config/overrides CRUD)
├── worker/src/lifecycle.ts (install/delete handlers)
└── worker/src/types.ts (shared types)
```

---

## Frontend Initialization Sequence

Called at module load time when `NODE_ENV !== 'test'`. See `js/main.ts`.

```
1.  init()
2.  │── Validate window.location.origin against allowlist
3.  │── initSubsystems()
4.  │   ├── Init Sentry error reporting
5.  │   ├── Init CSP reporter
6.  │   ├── Init API module (inject store dependencies)
7.  │   ├── Init UI elements (query DOM)
8.  │   ├── Register postMessage listener for token refresh
9.  │   └── Register unhandledrejection + encryption error listeners
10. │── extractAndScrubToken() — get JWT from URL, scrub from address bar
11. │── parseAndValidateToken()
12. │   ├── Verify RSA256 signature (Web Crypto API)
13. │   ├── Decode payload, normalize alias claims
14. │   └── Validate workspaceId, backendUrl, reportsUrl
15. │── applyTokenClaims()
16. │   ├── Apply theme (DARK/LIGHT)
17. │   ├── Reset rate limiter if workspace changed
18. │   ├── Store token in state
19. │   ├── Init settings API client
20. │   ├── Init encryption + load encrypted overrides
21. │   ├── Start session timeout timers
22. │   ├── Set canonical timezone
23. │   └── Set default dates (today)
24. └── loadInitialData()
25.     ├── Fetch server config + overrides (parallel)
26.     ├── Apply server config or reset to defaults
27.     ├── Detect admin status from JWT claims
28.     ├── Fetch workspace users from Clockify API
29.     ├── Render overrides page
30.     ├── Hide admin-only UI for non-admins
31.     ├── Bind config events (handleGenerateReport callback)
32.     ├── Bind UI events (generate, overrides, filters)
33.     ├── Register beforeunload flush handler
34.     └── Set data-app-ready="true" on body
```

---

## Report Generation Flow

Triggered by clicking "Generate" or "Refresh". See `js/report-orchestrator.ts`.

```
1.  handleGenerateReport(forceRefresh?)
2.  │── Validate date range (start ≤ end, ≤ 365 days)
3.  │── Check report cache (IndexedDB → sessionStorage fallback)
4.  │   └── If cache hit < 5s old → reuse immediately
5.  │   └── If cache hit < 5min old → ask user to reuse or refresh
6.  │── Show loading state
7.  │── Create AbortController + 300s timeout signal
8.  │── Fetch data in parallel:
9.  │   ├── Time entries (paginated POST /reports/detailed)
10. │   ├── User profiles (batched GET per user, with cache)
11. │   ├── Holidays (sampled then verified, with cache)
12. │   └── Time off requests (batched POST per user, with cache)
13. │── If aborted → show abort message, return
14. │── Store rawEntries in state
15. │── runCalculation() via Web Worker
16. │   ├── Post entries + config + params + overrides to worker
17. │   ├── Worker runs calculateAnalysis() → pure computation
18. │   └── Return UserAnalysis[] results
19. │── Store analysisResults in state
20. │── Cache report to IndexedDB (encrypted, skip if > 100K entries)
21. │── Render results:
22. │   ├── Summary strip (KPI cards)
23. │   ├── Summary table
24. │   ├── Detailed table
25. │   └── Status banners (API errors, throttle, pagination)
26. └── Enable export button
```

---

## Settings Sync Flow

Admin configuration changes flow between frontend, Worker, and KV.

```
Frontend                     Worker                      KV
────────                     ──────                      ──

[Admin changes toggle]
        │
        ▼
  bindConfigEvents()
  debounced save (500ms)
        │
        ▼
  saveServerConfig()
  PUT /api/config ──────────▶ handleConfigPut()
  X-Addon-Token: <jwt>        │── extractAndVerifyJwt()
                              │── isWorkspaceAdmin()
                              │── validate config+params
                              └── KV.put() ─────────────▶ ws:{id}:config

[Non-admin user loads page]
        │
        ▼
  fetchServerConfig()
  GET /api/config ──────────▶ handleConfigGet()
  X-Addon-Token: <jwt>        │── extractAndVerifyJwt()
                              └── KV.get() ◀────────────── ws:{id}:config
        │
        ▼
  store.applyServerConfig()
  (or resetConfigToDefaults
   if server unavailable)
```

Override sync follows the same pattern with `/api/overrides`.

The `beforeunload` event flushes any pending debounced saves via `debouncedServerOverrideSave.flush()` and `flushPendingConfigSave()` to prevent data loss.

---

## Worker Request Routing

From `worker/src/index.ts`:

```
Incoming Request
       │
       ▼
  ┌─ OPTIONS? ──▶ 204 + CORS + security headers
  │
  ├─ POST /lifecycle/* ?
  │   ├─ /lifecycle/installed ──▶ handleInstalled()
  │   ├─ /lifecycle/deleted ───▶ handleDeleted()
  │   └─ (other) ─────────────▶ 404
  │   └── + security headers (X-Frame-Options: DENY)
  │
  ├─ /api/* ?
  │   ├─ GET  /api/config ─────▶ handleConfigGet()
  │   ├─ PUT  /api/config ─────▶ handleConfigPut()
  │   ├─ GET  /api/overrides ──▶ handleOverridesGet()
  │   ├─ PUT  /api/overrides ──▶ handleOverridesPut()
  │   └─ (other) ─────────────▶ 404
  │   └── + security headers (X-Frame-Options: DENY)
  │
  └─ (everything else)
      └── proxyToGitHubPages()
          ├─ /manifest → /manifest.json rewrite
          ├─ HTML/manifest: no-cache
          └─ Assets: 5min cache
          └── + security headers (no X-Frame-Options)
```

---

## State Management

Central store defined in `js/state.ts`. Single mutable object — no framework (no Redux/MobX).

### Store Structure

```typescript
{
  token: string | null,           // JWT (in-memory only)
  claims: TokenClaims | null,     // Decoded JWT payload
  users: User[],                  // Workspace user list
  rawEntries: TimeEntry[] | null, // Raw API response
  analysisResults: UserAnalysis[] | null, // Calculated results
  currentDateRange: DateRange | null,
  config: OvertimeConfig,         // Feature flags
  calcParams: CalculationParams,  // Numeric parameters
  profiles: Map<string, UserProfile>,
  holidays: Map<string, Map<string, Holiday>>,
  timeOff: Map<string, Map<string, TimeOffInfo>>,
  overrides: Record<string, UserOverride>,
  apiStatus: ApiStatus,
  ui: UIState,
}
```

### Persistence Strategy

| Data | Storage | Scope | Encrypted |
|------|---------|-------|-----------|
| Overrides | localStorage | Per-workspace | Yes (AES-GCM) |
| Profiles cache | localStorage | Per-workspace | No |
| Holidays cache | localStorage | Per-workspace + date range | No |
| Time-off cache | localStorage | Per-workspace + date range | No |
| Report cache | IndexedDB (primary) / sessionStorage (fallback) | Global | Yes (AES-GCM) |
| UI state | localStorage | Global | No |
| Token | In-memory only | — | N/A |

### Workspace Isolation

All workspace-scoped storage keys include the workspace ID:

```
otplus_profiles_{workspaceId}
otplus_holidays_{workspaceId}_{startDate}_{endDate}
overtime_overrides_{workspaceId}
```

When `fetchServerConfig()` returns null (server unavailable), `store.resetConfigToDefaults()` is called to prevent cross-workspace config leakage.

---

## Caching Strategy

Three tiers of caching with different TTLs and invalidation strategies:

### Tier 1: Report Cache

| Property | Value |
|----------|-------|
| Storage | IndexedDB (`otplus_cache` db) → sessionStorage fallback |
| TTL | 5 minutes |
| Encryption | AES-GCM |
| Auto-reuse | Cache < 5s old reused without prompting |
| Size limit | Skipped when entries > 100K |
| Schema version | `REPORT_CACHE_SCHEMA_VERSION` — mismatches treated as cache misses |
| IDB → session fallback | IDB misses fall through to sessionStorage |

### Tier 2: Data Cache

| Property | Value |
|----------|-------|
| Storage | localStorage |
| TTL | 6 hours |
| Scope | Per-workspace (profiles), per-workspace+range (holidays, time-off) |
| Cleanup | Caches older than 7 days auto-removed on startup |
| Schema version | `DATA_CACHE_VERSION = 1` |

### Tier 3: Computation Cache

| Property | Value |
|----------|-------|
| Storage | In-memory |
| Invalidation | `dataVersion` monotonic counter + `overridesVersion` / `configVersion` |
| Memoization | `parseIsoDuration` and `classifyEntryForOvertime` use Map caches, cleared at start of each `calculateAnalysis` call |
| Reference equality | Summary/detailed selectors use reference equality checks |

---

## Web Worker Architecture

Source: `js/worker-manager.ts`, `js/calc.worker.ts`

```
Main Thread                    Worker Thread
───────────                    ─────────────

runCalculation()
  │── Post message:
  │   { entries, config,
  │     calcParams, overrides,
  │     profiles, holidays,
  │     timeOff, dateRange }
  │                            ──▶ onmessage handler
  │                                │── calculateAnalysis()
  │                                │   (pure computation)
  │                                └── postMessage(results)
  │◀────────────────────────────────
  └── Resolve with UserAnalysis[]
```

| Property | Value |
|----------|-------|
| Pool size | 1 (single worker) |
| Format | IIFE (not ESM — broader browser support) |
| Task timeout | 120 seconds |
| Config-only changes | Bypass worker entirely (no recalculation needed) |
| Cache invalidation | `dataVersion` counter incremented on any profile/holiday/timeOff mutation |

---

## Build Pipeline

Source: `build.js`

```
1.  Clean dist/ directory
2.  Determine entry point (js/main.ts or js/main.js)
3.  esbuild bundle:
│   ├── Entry: js/main.ts → dist/js/app.bundle.js
│   ├── Format: ESM, target es2020
│   ├── Sentry treeshake plugin (stub unused sub-packages, saves ~181KB)
│   ├── Define compile-time constants (VERSION, NODE_ENV, SENTRY_DSN)
│   ├── Production: minify + external sourcemap + metafile analysis
│   └── Dev: linked sourcemap, no minification
4.  Build Web Worker:
│   ├── Entry: js/calc.worker.ts → dist/js/calc.worker.js
│   ├── Format: IIFE (classic script mode for Worker compatibility)
│   └── Same minification/sourcemap settings
5.  Copy static assets:
│   ├── Process index.html (update script src, inject version footer)
│   ├── Copy css/ directory
│   ├── Copy icon.svg
│   └── Copy manifest.json (with optional MANIFEST_BASE_URL override)
6.  Output: dist/ directory (~388KB production bundle)
```

### Watch Mode

`node build.js --watch` uses esbuild's `context.watch()` for incremental rebuilds.

### Reproducible Builds

When `SOURCE_DATE_EPOCH` is set (Unix timestamp), the build banner uses this instead of wall-clock time, producing byte-identical builds per the [reproducible-builds spec](https://reproducible-builds.org/specs/source-date-epoch/).
