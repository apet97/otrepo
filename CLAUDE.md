# CLAUDE.md - Project Instructions for Claude Code

## Session Priority

- `AGENTS.md` is canonical for workflow and review behavior.
- Read `AGENTS.md` before making edits.

## Project Overview

OTPLUS is a TypeScript Clockify sidebar add-on that calculates overtime and renders summary/detailed reporting with secure CSV export.

## Tech Stack

- Language: TypeScript (strict)
- Bundler: esbuild (`node build.js`)
- Unit/Integration tests: Jest (ESM mode)
- E2E/A11y: Playwright
- Lint: ESLint 9 + Prettier
- CI: GitHub Actions + GitHub Pages deployment

## Key Commands

```bash
npm run build
npm test
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
```

## Architecture

```text
js/main.ts              # Entry point: JWT parsing, theme, session timeout, init
js/api.ts               # API client (retry, circuit breaker, pagination, DI via initApi)
js/calc.ts              # Pure calculation engine
js/state.ts             # Central store
js/export.ts            # CSV export + formula-injection defenses
js/utils.ts             # Validation/sanitization helpers
js/logger.ts            # Structured logging + redaction
js/crypto.ts            # localStorage encryption (AES-GCM + legacy PBKDF2)
js/config-manager.ts    # Config control event binding and state sync
js/report-orchestrator.ts # Report generation, caching, data fetching
js/worker-manager.ts    # Web Worker pool and calculation dispatch
js/health-check.ts      # Application health monitoring endpoint
js/date-presets.ts      # Date range preset calculations
js/error-reporting.ts
js/metrics.ts
js/ui/*.ts              # UI rendering and interactions
```

## Security Rules

- Use `X-Addon-Token` auth header (never `X-Api-Key`).
- Validate API base URLs against allowed Clockify domains.
- Escape untrusted strings before HTML insertion (`escapeHtml`).
- Sanitize CSV fields (`sanitizeFormulaInjection`) before export.
- Keep storage keys workspace-scoped.
- Never log or persist raw tokens.

## Testing Notes

- Jest runs in ESM mode via `node --experimental-vm-modules`.
- Node-env tests should guard `localStorage` access with type checks.
- If UI/orchestration changed, run `npm run test:e2e` in addition to Jest checks.
- If Playwright flakes, do one targeted repro and one full-suite rerun.
- Treat Playwright runner-level errors (including non-test errors) as failures that require triage.
- If only micro-benchmark tests fail in `__tests__/performance/*.test.js`, run one targeted repro and one full `npm test` rerun before treating as regression.

## Current Baseline (2026-03-11, post-codebase-review-final)

- `npm test`: 93 suites / 3271 tests passing
- `npm run test:e2e`: 236/237 passing (1 transient Firefox flake, passes on repro)
- `npm run typecheck`: clean
- `npm run lint`: 0 errors, 0 warnings
- Production bundle: 378KB (down from 559KB after Sentry tree-shaking)
- Coverage: 83.28% stmts / 78.27% branches / 81.87% funcs / 83.85% lines (all >78%)

## Known Test Flakes

- 2 performance timing suites (`calc-performance.test.js`, `api-performance.test.js`) fail intermittently due to environment-dependent timing thresholds. Not regressions — treat as documented in flake triage.
- 1 WebKit E2E flake: `buttons can be activated with Enter and Space` (a11y keyboard nav).
- `npm run format:check` reports 26 files with pre-existing formatting differences.

## Completed Work

### Audit Remediation (2026-03-06) — T1-T88

88 findings from full codebase audit addressed. See `AUDIT_TODO.md` for resolution status and `IMPLEMENTATION_TASKS.md` for task details. Key changes:
- Stryker mutation testing config overhauled (T1-T4)
- Test helpers consolidated, shared fixtures created (T5-T23)
- Mutation-killer tests for state, crypto, export, UI modules (T24-T56)
- Pagination added to `fetchUsers` and `fetchTimeOffRequests` (T62-T63)
- E2E route patterns fixed for pagination query params (T87)

### Optimization (2026-03-07) — 17 tasks across 5 phases

Scaled OTPLUS to 1500-user workspaces. Key changes:
- Entry pagination limit raised to 2500 pages (500K entries max)
- API batch size increased from 5 to 20 concurrent requests
- Holiday deduplication via sample-based approach
- Profile retry on failure, progress callbacks for all batch fetches
- Report caching (IndexedDB first, sessionStorage fallback)
- Summary table and overrides panel paginated with search
- Streaming CSV export (chunked with event loop yielding)
- Redundant sorts eliminated (pre-sorted once in day context)
- Memoization for parseIsoDuration and classifyEntryForOvertime
- Worker pool size: Math.min(hardwareConcurrency, 4), timeout 120s
- streaming.ts splitIntoBatches integrated into api.ts batch loops

### Scale Readiness Audit (2026-03-07) — 25/28 items from RALPHTODO.md

Addressed 25 of 28 findings from 1500-user scale audit. See `RALPHTODO.md` Section 6 for full resolution matrix. Key changes:
- Per-request timeout (30s) via AbortSignal.timeout with browser fallback + 300s total report timeout
- Holiday dedup rewritten: random sampling (Fisher-Yates), larger sample (min 20 or 10%), pattern-hash grouping
- Worker pool reduced to 1; config-only changes skip worker entirely
- IndexedDB report cache encrypted via AES-GCM with backward-compatible legacy read
- Summary table row computation cached with reference-equality invalidation
- First/Last pagination buttons added to detailed table
- Time-off user IDs batched (groups of 500)
- AbortError early return before retry logic
- Circuit breaker status surfaced to user
- Sort determinism via secondary key (entry ID)
- Progress shows percentage and "Calculating..." phase
- Date range warning uses user-days product
- Cache size guard (MAX_CACHEABLE_ENTRIES=100K)
- Deferred: B1 (streaming aggregation), M8 (localStorage encryption), L7 (partial failure detail)

### Full Code Audit Remediation (2026-03-08) — 54 findings from offtasks.md

54 findings from line-by-line code audit all resolved. See `offtasks.md` for full findings. Organized across 8 sequential tasks:
- Task 1: Small fixes — BL-2/3/4, SEC-8, PERF-2/4, UX-8
- Task 2: CSS overhaul — UX-1/2, CQ-8 (sidebar width targeting, ~400 lines duplicate CSS removed)
- Task 3: UI fixes — UX-3/4/5/6/7, PERF-1 (ARIA, focus management, DocumentFragment pagination)
- Task 4: Calc.ts refactors — CQ-2/4 (DRY override resolution, normalized types)
- Task 5: Main.ts decomposition — CQ-1 (2666→640 lines, 5 modules extracted)
- Task 6: API decoupling — CQ-3 (ApiDependencies interface, initApi DI pattern)
- Task 7: Test improvements — TEST-1/2/3/5, CQ-5 (stryker config, 58 weak assertions fixed, E2E overrides test, 28 istanbul ignores removed)
- Task 8: Final verification and documentation

### Codebase Review Remediation (2026-03-11) — 10 items from CODEBASE_REVIEW_TODO.md

All 10 items from codebase review addressed:
- Fix: Worker cache invalidation via overridesVersion/configVersion counters
- Fix: Debounce override recalculation (250ms) to prevent keystroke churn
- Fix: Test script CLI conflict (--maxWorkers=1 → --runInBand)
- Refactor: bindEvents() split into 4 focused sub-binders + shared toggleCardCollapse
- Refactor: init() decomposed into 5 focused helpers (showInitError, extractAndScrubToken, parseAndValidateToken, initSubsystems, applyTokenClaims)
- Refactor: buildRowsForUsers decomposed (DayContext, formatEntryRow, makePlaceholderEntry)
- Refactor: getHealthStatus() split into per-subsystem probe functions
- Refactor: Export pipeline uses for...of, precomputes per-user/per-day values
- Refactor: Shared buildPaginationControls() using DOM APIs (no innerHTML)
- Cleanup: All non-null assertions removed (crypto, worker-pool, ui/index)
- Cleanup: Unused eslint-disable directive removed
- Infra: esbuild metafile output for production bundle analysis
- Bundle: Sentry externals (@sentry-internal/replay,feedback,replay-canvas) → 559KB→378KB (32% reduction)
- Lint: 10 → 0 warnings

## Architecture Notes

- `js/main.ts` — 640 lines (345 code). JWT parsing, theme, session timeout, init. Delegates to extracted modules.
- `js/config-manager.ts` — Config control event binding, `bindConfigEvents(handleGenerateReport)`.
- `js/report-orchestrator.ts` — `handleGenerateReport()`, abort handling, report timeout.
- `js/worker-manager.ts` — `runCalculation()`, worker pool dispatch. Cache uses `overridesVersion`/`configVersion` counters (not reference equality).
- `js/health-check.ts` — `getHealthStatus()` aggregates per-subsystem probes, window global exposure.
- `js/date-presets.ts` — Pure date range preset calculation functions.
- `js/api.ts` — Decoupled from store via `ApiDependencies` interface + `initApi(deps)`. Fallback to store-backed defaults.
- `js/streaming.ts` — Contains `processInChunks`, `splitIntoBatches`, `ChunkedProcessor` etc. `splitIntoBatches` is used in api.ts batch loops.
- `js/calc.worker.ts` — Worker pool size: 1 (single worker). Config-only changes bypass worker entirely. taskTimeout: 120s.
- Report cache uses IndexedDB (`otplus_cache` db) with sessionStorage fallback. Encrypted via AES-GCM. Skipped when entries > 100K.
- `js/utils.ts` — `parseIsoDuration` and `classifyEntryForOvertime` are memoized with Map caches, cleared at start of each `calculateAnalysis` call.
- `js/calc.ts` — Day entries pre-sorted once in day context initialization with secondary key (entry ID), reused across daily OT and final processing passes.
- Per-request timeout: 30s via `AbortSignal.timeout()` (with fallback for older browsers). Total report generation timeout: 300s.
- Holiday dedup: Random sample of min(max(20, ceil(N*0.1)), N) users; propagate only when all sampled results share one pattern hash.

## Documentation Hygiene

When workflow or behavior changes, update:

- `AGENTS.md`
- `README.md`
- `CONTRIBUTING.md`
- any prompt/runbook files affected by changed commands or test counts
