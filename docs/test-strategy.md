# OTPLUS Test Strategy

This document defines the testing tiers, quality targets, and workflows for OTPLUS. It complements `docs/spec.md` and keeps the test suite focused on behavioral confidence rather than line coverage alone.

## Goals

- Catch regressions in overtime calculations, API contracts, and UI rendering.
- Keep tests deterministic and stable across environments.
- Maintain high signal-to-noise with minimal duplication.

## Test Tiers

1) Unit tests (Jest) — 2908 tests across 68 files
- Scope: pure logic, small UI rendering, helpers.
- Focus areas:
  - `js/calc.ts` overtime math and edge cases.
  - `js/utils.ts` invariants and security helpers.
  - `js/api.ts` request/response normalization, error handling, rate limiting, circuit breaker.
  - `js/state.ts` store management, persistence, encryption, fallback storage.
  - `js/crypto.ts` AES-GCM encryption/decryption.
  - `js/metrics.ts` performance counters, Prometheus/StatsD export.
  - `js/worker-pool.ts` worker lifecycle, task queuing, timeout handling.
  - `js/streaming.ts` chunked processing, abort support.
  - `js/ui/dialogs.ts` session warnings, error banners, throttle status.

2) Integration tests (Jest + jsdom)
- Scope: orchestration paths with mocked API/UI.
- Focus areas:
  - `handleGenerateReport()` cache decisions and optional fetch failures.
  - `loadInitialData()` error and empty-user cases.
  - Partial failure recovery, concurrent fetch safety, retry logic.

3) E2E tests (Playwright)
- Scope: user-visible flows across Chromium/Firefox/WebKit.
- Cross-browser: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- Determinism: Fixed dates (2025-01-15), dialog handlers with error recovery
- Focus areas:
  - Authentication/claims handling.
  - Report generation and summary rendering.
  - Export correctness (headers + content).
  - Error handling is graceful (no crashes).

4) Performance tests (Jest) — dedicated suite
- Scope: benchmarks and regression detection.
- Focus areas:
  - Calculation engine throughput (100 to 10,000 entries).
  - API rate limiter and circuit breaker performance.

5) Mutation tests (Stryker)
- Scope: core logic (`js/calc.ts`, `js/utils.ts`, `js/api.ts`).
- Goal: maintain a high mutation score to validate test effectiveness.

## Determinism Rules

- Avoid `Date.now()` and `Math.random()` in tests and helpers.
- Use fixed dates (`2025-01-15`) in E2E mocks and inputs.
- Prefer seeded or deterministic data builders.
- Use Playwright `page.on('dialog')` to handle confirm prompts.

## Quality Targets

- Tests validate behavior and contracts (inputs → outputs), not just coverage.
- No "spec-only" tests that restate constants without asserting behavior.
- Error states are explicitly asserted (no silent failures).

## CI / Local Workflow

- Unit: `npm test`
- Lint: `npm run lint`
- Type check: `npm run typecheck`
- E2E: `npm run test:e2e`
- Mutation: `npm run test:mutants` (scheduled/optional)

## Artifact Hygiene

- E2E artifacts are generated in `playwright-report/` and `test-results/`.
- These are ignored in `.gitignore` and should not be committed.

## Maintenance Guidelines

- Prefer small, focused diffs.
- Update tests alongside behavior changes.
- Consolidate overlapping suites to keep runtime and maintenance cost low.

## Choosing the Right Test Type

- Unit: use for pure logic and small helpers (calc, utils, data transforms).
- Integration: use for module orchestration (main flow, cache decisions, error paths).
- E2E: use for critical user flows and computed outputs (report generation, export).

## What to Avoid

- Spec-only tests that restate constants without validating behavior.
- Randomized test data that isn’t seeded or deterministic.
- Assertions that only check “it rendered” without validating values.
