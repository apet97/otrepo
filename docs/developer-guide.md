# Developer Guide

Deep-dive tutorial for a new developer working on OTPLUS.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Module Map](#module-map)
- [Key Design Patterns](#key-design-patterns)
- [How to Add a Feature Toggle](#how-to-add-a-feature-toggle)
- [How to Add a Worker API Endpoint](#how-to-add-a-worker-api-endpoint)
- [How to Add a Calculation Parameter](#how-to-add-a-calculation-parameter)
- [How to Add a UI Tab](#how-to-add-a-ui-tab)
- [Code Conventions](#code-conventions)
- [Common Pitfalls](#common-pitfalls)

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- Wrangler CLI (for Worker development): `npm install -g wrangler`

### Setup

```bash
git clone <repo-url>
cd otrepo
npm ci

# Build
npm run build

# Run all checks
npm test              # 108 suites / ~3986 tests
npm run typecheck     # Must be clean
npm run lint          # Must be clean
npm --prefix worker test  # 4 suites / 98 tests
```

### E2E Tests

```bash
npx playwright install    # First time only
npm run test:e2e          # Builds app, starts server, runs 246 specs
```

### Worker Development

```bash
cd worker
npm install
npm test
wrangler dev              # Local dev server
```

---

## Architecture Overview

OTPLUS is a Clockify sidebar add-on with two runtime components:

1. **Frontend SPA** — TypeScript, bundled by esbuild, hosted on GitHub Pages. Runs inside Clockify's sidebar iframe.
2. **Cloudflare Worker** — Proxies static assets, stores workspace config in KV, handles lifecycle webhooks.

See [architecture.md](./architecture.md) for detailed diagrams and data flows.

---

## Module Map

### Entry & Orchestration

| File | Description |
|------|-------------|
| `js/main.ts` | Entry point: JWT parsing, theme, session timeout, initialization |
| `js/config-manager.ts` | Config control event binding and state sync, exports `flushPendingConfigSave()` |
| `js/report-orchestrator.ts` | Report generation, caching, abort handling, data fetching |
| `js/worker-manager.ts` | Web Worker pool dispatch, `runCalculation()` |

### State & Data

| File | Description |
|------|-------------|
| `js/state.ts` | Central store singleton, `applyServerConfig()`, `applyServerOverrides()` |
| `js/data-selectors.ts` | Source of truth for `computeSummaryRows`, `getCachedDetailedEntries`, store selectors |
| `js/types.ts` | All TypeScript type definitions |
| `js/constants.ts` | Global constants, bounds, error types |

### API & Network

| File | Description |
|------|-------------|
| `js/api.ts` | HTTP client with token bucket rate limiting, circuit breaker, retry, pagination |
| `js/settings-api.ts` | Worker CRUD client for config/overrides |
| `js/streaming.ts` | `processInChunks`, `splitIntoBatches`, `ChunkedProcessor` |

### Calculation

| File | Description |
|------|-------------|
| `js/calc.ts` | Pure calculation engine — overtime analysis, tiered premiums, amount triangulation |
| `js/calc.worker.ts` | Web Worker wrapper for calc.ts |
| `js/date-presets.ts` | Date range preset calculations (This Week, Last Month, etc.) |

### UI

| File | Description |
|------|-------------|
| `js/ui/index.ts` | UI barrel: re-exports all UI modules |
| `js/ui/summary.ts` | Summary table rendering |
| `js/ui/detailed.ts` | Detailed table rendering with filters |
| `js/ui/overrides.ts` | Override management page |
| `js/ui/dialogs.ts` | Session/error dialogs |
| `js/ui/shared.ts` | Shared UI utilities |

### Utilities

| File | Description |
|------|-------------|
| `js/utils.ts` | Validation, formatting, escaping (`escapeHtml`, `isAllowedClockifyUrl`, `debounce`) |
| `js/crypto.ts` | AES-GCM encryption for localStorage data |
| `js/export.ts` | CSV export with formula-injection defense |
| `js/logger.ts` | Structured logging with token redaction |
| `js/error-reporting.ts` | Sentry error reporting |
| `js/csp-reporter.ts` | CSP violation reporting |
| `js/health-check.ts` | Application health monitoring (`window.__OTPLUS_HEALTH_CHECK__`) |
| `js/metrics.ts` | Performance metrics collection |
| `js/storage.ts` | Safe localStorage wrappers |
| `js/memory-profiler.ts` | Memory usage profiling |
| `js/performance-dashboard.ts` | Performance monitoring dashboard |

### Worker

| File | Description |
|------|-------------|
| `worker/src/index.ts` | Worker entry point, request router, static proxy |
| `worker/src/auth.ts` | JWT decode/verify, CORS, admin role check |
| `worker/src/api-routes.ts` | Config/overrides CRUD with runtime validation |
| `worker/src/lifecycle.ts` | INSTALLED/DELETED webhook handlers |
| `worker/src/types.ts` | Worker-specific type definitions |

---

## Key Design Patterns

### Dependency Injection (ApiDependencies)

The API module (`js/api.ts`) is decoupled from the global store via the `ApiDependencies` interface:

```typescript
interface ApiDependencies {
    getToken(): string | null;
    getClaims(): TokenClaims | null;
    getConfig(): { circuitBreakerResetMs?, rateLimitCapacity?, ... };
    setApiStatus(field, value): void;
    setUiPaginationFlag(flag): void;
    incrementThrottleRetry(): void;
}
```

Initialized in `main.ts` via `initApi(deps)` with store-backed implementations. Tests can provide mock implementations.

### Reference-Equality Caching

`data-selectors.ts` uses reference equality to avoid recomputing when inputs haven't changed. Summary rows and detailed entries are cached and only recomputed when `analysisResults` reference changes.

### Workspace Isolation

All persistent data is keyed by workspace ID:
- localStorage keys: `otplus_profiles_{wsId}`
- KV keys: `ws:{wsId}:config`
- When workspace changes (detected by comparing `claims.workspaceId`), rate limiter resets and encryption keys differ.

### Abort Signal Propagation

All API and report generation functions accept `AbortSignal`:
- User clicking "Generate" while a report is running aborts the previous run.
- 300-second total timeout creates a top-level abort.
- Per-request 30-second timeout uses `AbortSignal.timeout()`.

### Debounced Server Save

Config and override changes are debounced before saving to the server:
- Config saves: via `flushPendingConfigSave()` in `config-manager.ts`
- Override saves: 500ms debounce in `main.ts`
- `beforeunload` flushes all pending saves.

### Token Bucket Rate Limiting

`js/api.ts` uses a token bucket algorithm:
- Capacity: 50 tokens (configurable via `rateLimitCapacity`)
- Refill: 50 tokens per second (configurable via `rateLimitRefillMs`)
- Requests wait until a token is available (non-recursive polling loop)

### Circuit Breaker

`js/api.ts` implements a circuit breaker:
- Opens after N consecutive failures (default 5, configurable)
- In open state, all requests fail immediately
- Resets after cooldown period (default 30s, configurable)

### Per-Calculation Memoization Clear

`parseIsoDuration()` and `classifyEntryForOvertime()` use Map-based caches. These are cleared at the start of each `calculateAnalysis()` call via `clearMemoizationCaches()` to prevent stale data.

### Amount Triangulation

The calculation engine computes three parallel currency tracks per entry:
1. **Earned**: Billable revenue (client charge)
2. **Cost**: Internal expense (employee pay)
3. **Profit**: Earned - Cost

This allows the UI to switch amount display modes instantly without recalculating.

---

## How to Add a Feature Toggle

Example: adding a `showBreakdown` boolean toggle.

### 1. Add the type (`js/types.ts`)

Add the field to `OvertimeConfig`:

```typescript
export interface OvertimeConfig {
    // ... existing fields ...
    showBreakdown: boolean;
}
```

### 2. Add the default (`worker/src/lifecycle.ts`)

Add to `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: OvertimeConfig = {
    // ... existing ...
    showBreakdown: false,
};
```

### 3. Add server validation (`worker/src/api-routes.ts`)

Add to the `boolFields` array in `isValidOvertimeConfig()`:

```typescript
const boolFields = [
    // ... existing ...
    'showBreakdown',
];
```

### 4. Add Worker type (`worker/src/types.ts`)

Add to the Worker's `OvertimeConfig`:

```typescript
export interface OvertimeConfig {
    // ... existing ...
    showBreakdown: boolean;
}
```

### 5. Add HTML control (`index.html`)

Inside `#configContent`:

```html
<label class="config-item">
    <input type="checkbox" id="showBreakdown"> Show Breakdown
</label>
```

### 6. Bind the event (`js/config-manager.ts`)

The config manager auto-binds checkbox toggles matching `OvertimeConfig` field names. If the element ID matches the config field name, it works automatically.

### 7. Use in calculation (`js/calc.ts`)

```typescript
if (config.showBreakdown) {
    // breakdown logic
}
```

### 8. Write tests

- Unit test: verify `calculateAnalysis()` respects the new toggle
- E2E test: verify the toggle appears, can be toggled, and affects output
- Worker test: verify validation accepts/rejects the new field

---

## How to Add a Worker API Endpoint

Example: adding `GET /api/stats`.

### 1. Create the handler (`worker/src/api-routes.ts`)

```typescript
export async function handleStatsGet(request: Request, env: Env): Promise<Response> {
    let jwt;
    try {
        jwt = await extractAndVerifyJwt(request);
    } catch (e) {
        return errorResponse(`Unauthorized: ${(e as Error).message}`, 401, request, env.ENVIRONMENT);
    }

    // Your logic here
    const stats = { workspaceId: jwt.workspaceId, /* ... */ };
    return jsonResponse(stats, 200, request, env.ENVIRONMENT);
}
```

### 2. Register the route (`worker/src/index.ts`)

In `handleApi()`:

```typescript
if (path === '/api/stats' && request.method === 'GET') return handleStatsGet(request, env);
```

### 3. Add the import

```typescript
import { handleStatsGet } from './api-routes';
```

### 4. Add frontend client function (`js/settings-api.ts`)

```typescript
export async function fetchStats(): Promise<StatsResponse | null> {
    return apiFetch<StatsResponse>('/api/stats');
}
```

### 5. Write tests

- Worker test: verify auth, response shape, error cases
- Frontend test: verify `fetchStats()` handles success/failure

---

## How to Add a Calculation Parameter

Example: adding a `breakThresholdMinutes` parameter.

### 1. Add to types (`js/types.ts`)

```typescript
export interface CalculationParams {
    // ... existing ...
    breakThresholdMinutes: number;
}
```

### 2. Add default (`worker/src/lifecycle.ts`)

```typescript
const DEFAULT_CALC_PARAMS: CalculationParams = {
    // ... existing ...
    breakThresholdMinutes: 30,
};
```

### 3. Add validation ranges (`worker/src/api-routes.ts`)

In `isValidCalcParams()`:

```typescript
const ranges: Record<string, [number, number]> = {
    // ... existing ...
    breakThresholdMinutes: [0, 480],
};
```

### 4. Add Worker type (`worker/src/types.ts`)

```typescript
export interface CalculationParams {
    // ... existing ...
    breakThresholdMinutes: number;
}
```

### 5. Add frontend input bounds (`js/constants.ts`)

```typescript
export const INPUT_BOUNDS = {
    // ... existing ...
    breakThresholdMinutes: { min: 0, max: 480, description: 'Break threshold must be 0-480 minutes' },
};
```

### 6. Add HTML input (`index.html`)

### 7. Use in calculation (`js/calc.ts`)

---

## How to Add a UI Tab

Follow the pattern of Summary/Detailed tabs:

1. Add a `<button>` with `role="tab"` in `#tabNavCard` (in `index.html`)
2. Add a corresponding panel `<div>` with `role="tabpanel"`
3. Handle tab switching in `js/ui/index.ts` (the click handler on `.tab-btn` elements)
4. Create a new `js/ui/my-tab.ts` rendering module
5. Export from `js/ui/index.ts`

---

## Code Conventions

| Convention | Details |
|-----------|---------|
| **TypeScript strict mode** | All source is TypeScript with strict checks |
| **ESM imports with .js extension** | `import { x } from './module.js'` (resolves to `.ts` via resolver) |
| **HTML escaping** | Always use `escapeHtml()` before inserting user/API data into DOM |
| **CSV sanitization** | Always use `sanitizeFormulaInjection()` before CSV export |
| **Structured logging** | Use `createLogger('ModuleName')` — never raw `console.log` in production |
| **Store mutations** | Mutate store properties directly (no reducer pattern) |
| **Pure calc functions** | `js/calc.ts` functions are pure — no side effects, no store access |
| **API header** | Always `X-Addon-Token` (never `X-Api-Key` or `Authorization: Bearer` in frontend) |

---

## Common Pitfalls

| Pitfall | Correct Approach |
|---------|-----------------|
| Using `X-Api-Key` header | Use `X-Addon-Token` for all Clockify API calls |
| Hardcoding API URLs | Extract base URL from JWT claims (`backendUrl`) |
| Inserting raw strings in HTML | Always `escapeHtml()` first |
| Skipping URL validation | Always validate with `isAllowedClockifyUrl()` before making requests |
| Forgetting Worker tests | If Worker code changes, always run `npm --prefix worker test` |
| Forgetting E2E tests | If UI/orchestration changes, run `npm run test:e2e` |
| Performance test failures | Check if it's a known flake — run targeted repro first (see [testing-guide.md](./testing-guide.md#performance-test-handling)) |
| Logging tokens | Use structured logger (`createLogger`) which redacts tokens |
| Using `localStorage` for tokens | Tokens are in-memory only (`store.token`) |
| Missing workspace isolation | All storage keys must include workspace ID |
| Forgetting to flush saves | `beforeunload` handler flushes debounced saves — don't bypass it |
