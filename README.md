# OTPLUS — Overtime Summary Addon for Clockify

## Overview
OTPLUS is a Clockify addon that transforms detailed report data into an overtime-focused cockpit. It aggregates capacity-aware totals, billable/non-billable splits, and premium-aware dollars while keeping the UI responsive on large teams.

## What the addon uses
- **Clockify Detailed Report API** as the single source of truth for time entries, rates, and tags; it is normalized to the legacy time-entries shape before calculations run.
- **Profiles, Holidays, and Time-Off APIs** (see below) to decorate capacity, working days, and approved absence information.
- **`state.js`** for centralized reactive state, overrides persistence, and UI memory (`localStorage` keys: `otplus_config`, `overtime_overrides_{workspaceId}`).
- **`calc.js`** for deterministic tail-attribution logic, premium math, and anomaly tagging (BREAK/HOLIDAY/TIME_OFF).
- **`ui.js`** for rendering the summary strip, grouped table, and paginated detailed entries with accessibility-focused components.
- **`export.js`** for secure CSV download (escape, formula-injection protection, decimal-hours column).

## API integration summary
| API | Method | Purpose | Notes |
|-----|--------|---------|-------|
| `/v1/workspaces/{wid}/reports/detailed` | `POST` | Fetches every entry across users; supports pagination & amount modes (earned/cost/profit). | Calls include `dateRangeStart`, `dateRangeEnd`, `amountShown`, and `detailedFilter.page/pageSize`. |
| `/v1/workspaces/{wid}/member-profile/{uid}` | `GET` | Retrieves profile capacity and working days. | Batched in groups of 5 concurrent calls to honor the rate limiter. |
| `/v1/workspaces/{wid}/holidays/in-period` | `GET` | Lists assigned holidays for each user over the report range. | Requires full ISO timestamps; responses expand multi-day holidays. |
| `/v1/workspaces/{wid}/time-off/requests` | `POST` | Returns approved time-off requests filtered by user list and period. | Parsed into per-user date maps; fallback heuristics run when this API is disabled. |

## Enterprise Features
- **Circuit breaker** for Clockify API calls (opens after 5 failures, 30s auto-recovery)
- **AES-GCM encryption** for localStorage overrides (PBKDF2 key derivation)
- **Web Worker pooling** for background calculations on large datasets (500+ entries)
- **Structured JSON logging** with correlation IDs for request tracing
- **Performance metrics** with Prometheus/StatsD export
- **Health check endpoint** (`window.__OTPLUS_HEALTH_CHECK__`)
- **Session timeout warnings** (5 min before JWT expiration)
- **Content Security Policy** violation reporting
- **Request body signing** (HMAC-SHA256) and idempotency keys
- **SBOM generation** (CycloneDX) and license compliance checking

## Reference guide
- **Detailed Guide:** `docs/guide.md` explains what OTPLUS consumes (modules, data flow, persistence) and walks through every API call the addon makes.
- **Product Requirements:** `docs/prd.md`
- **Technical Specification:** `docs/spec.md`
- **Test Strategy:** `docs/test-strategy.md` defines test tiers, determinism rules, and quality targets.
- **Capacity & Scalability:** `docs/CAPACITY.md` documents supported limits and performance characteristics.
- **Operational Runbook:** `docs/RUNBOOK.md` for support engineers and on-call staff.
- **Troubleshooting:** `docs/TROUBLESHOOTING.md` for end users and support staff.
- **User Guide:** `docs/USER-GUIDE.md` for administrators and managers.
- **SLA/SLO Targets:** `docs/SLA.md` defines operational quality standards.
- **Deployment:** `docs/DEPLOYMENT.md` covers build, release, and deployment process.

## Testing
- **2908 unit tests** across 68 test files (100% pass rate)
- **95.77% line coverage**, 94.71% branch coverage
- **Mutation testing** with Stryker (100% score on core modules)

Common commands:
- Unit: `npm test`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- E2E: `npm run test:e2e`
- Mutation (scheduled/manual): `npm run test:mutants`
- Coverage: `npm run test:coverage`
- Architecture constraints: `npm run deps:check`
