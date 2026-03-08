# OTPLUS Audit Remediation — Ralph Loop Prompt

You are implementing fixes for all findings from the OTPLUS line-by-line audit at `/Users/15x/Documents/addons-me/otrepo`. This is a TypeScript Clockify sidebar addon that calculates overtime. It is payroll-adjacent — calculation errors have real-world impact.

## Project State

- **Language:** TypeScript strict, bundled with esbuild
- **Tests:** Jest (93 suites, 3287 tests), Playwright E2E (237 tests)
- **Coverage:** 84.84% stmts / 80.52% branches / 83.84% funcs / 85.23% lines (all >80%)
- **Single prod dep:** `@sentry/browser`
- **Key commands:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`

Read `CLAUDE.md` and `offtasks.md` for full architecture and finding details before starting.

## What You Must Do

Check `.claude/ralph-progress.md` at the start of each iteration to see what previous iterations completed. Pick up where the last iteration left off. Do NOT repeat work already done.

Track resolved findings in `offtasks.md` by prepending `[RESOLVED]` to the finding title after implementing and verifying each fix.

---

### Task 1: Quick correctness fixes (COR-1, COR-2, COR-3)

**COR-1** — `js/export.ts:191-198`: Fix CSV chunk boundary newlines. Add `'\n'` between chunks so the last row of chunk N doesn't merge with the first row of chunk N+1.
- Add/update test in `__tests__/unit/export*.test.js` that verifies multi-chunk CSV output has correct newlines at boundaries.

**COR-2** — `js/calc.ts:1825-1835`: Add secondary sort key to weekly sort. Add `|| (a.id || '').localeCompare(b.id || '')` after the `localeCompare(bStart)` return, matching the daily sort pattern.
- Add test verifying that two entries with identical start times produce deterministic weekly OT attribution.

**COR-3** — `js/calc.ts:2024`: Eliminate entry mutation. Replace `(entry as ...).analysis = analysis;` with `const enrichedEntry = { ...entry, analysis };` and push that to `processedEntries`.
- Update any tests that rely on the mutation side effect.
- Verify: entries passed in should NOT have `.analysis` after calculation.

**Verify:** `npm test` passes, `npm run typecheck` clean.

**Acceptance:** All 3 fixes implemented with tests. No test regressions.

---

### Task 2: State cleanup (COR-5, COR-6, CQ-6, CQ-7)

**COR-5** — `js/state.ts:1796-1798`: Make `clearReportCache()` also delete the IndexedDB `otplus_cache` database. Use `indexedDB.deleteDatabase('otplus_cache')` or clear the relevant object store.

**COR-6** — `js/state.ts:1859-1937`: Make `clearAllData()` also delete the IndexedDB cache. Call `clearReportCache()` from within `clearAllData()`, or add direct IDB cleanup.

**CQ-6** — `js/state.ts`: Add a max size (e.g., 50 entries) to the `sessionStorageFallback` Map. Evict oldest entries when full.

**CQ-7** — `js/state.ts`: Remove the unused `subscribe()`/`notify()` pub/sub methods and any related infrastructure.

**Verify:** `npm test` passes. Add tests for IDB clearing and fallback Map eviction.

**Acceptance:** State cleanup complete, IDB cleared on both clear operations, fallback Map bounded, dead pub/sub removed.

---

### Task 3: Worker pool protocol fix (COR-4)

**COR-4** — Fix the protocol mismatch between `js/worker-pool.ts` and `js/calc.worker.ts`.

Option A (preferred): Adapt `calc.worker.ts` to use the WorkerPool protocol:
- Receive `{ taskId, payload }` instead of `{ type, requestId, payload }`
- Respond with `{ taskId, result }` or `{ taskId, error }` instead of `{ type, requestId, payload }`
- Extract `type` and inner `payload` from the received `payload` field (since main.ts wraps it)

Option B: Adapt `worker-pool.ts` to use calc.worker.ts's protocol.

Also fix `main.ts` to not double-nest the payload.

**Verify:** `npm test` passes, `npm run typecheck` clean. Worker path should actually execute calculations without falling back.

**Acceptance:** Worker pool actually completes calculations (not always falling back to main thread).

---

### Task 4: Main.ts correctness fixes (COR-7, COR-8, PERF-3, API-6)

**COR-7** — Date preset buttons: Ensure all date preset calculations use consistent timezone methods (all local or all UTC). Review each preset (This Week, Last Week, Last 2 Weeks, This Month, Last Month, Custom).

**COR-8** — `js/main.ts:2609-2622`: Add `calculationId` check immediately after `await runCalculationInWorker()` and `calculateAnalysis()`, BEFORE `calcTimer.end()` and state writes.

**PERF-3** — Remove the redundant second `UI.initializeElements()` call (in `loadInitialData()`). Keep the first one in `init()`.

**API-6** — Ensure the 300-second total report timeout timer is always cleared in a `finally` block, even on early returns.

**Verify:** `npm test` passes.

**Acceptance:** All 4 main.ts fixes implemented. No orphaned timers, no race conditions, no timezone inconsistency.

---

### Task 5: Security hardening (SEC-1, SEC-2, SEC-3, SEC-4, SEC-7)

**SEC-1** — `js/state.ts`: Encrypt sessionStorage report cache fallback using the same AES-GCM mechanism used for IDB. If crypto is unavailable, skip caching entirely rather than storing plaintext.

**SEC-2** — `js/state.ts`: Encrypt profile/holiday/time-off localStorage caches using AES-GCM. Add encryption to the `_saveProfiles()`, `_saveHolidays()`, `_saveTimeOff()` paths and corresponding load paths.

**SEC-3** — `js/logger.ts:~321`: Lower the string sanitizer threshold from 32 to 16 characters, or add a JWT-pattern regex (`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+`).

**SEC-4** — `js/crypto.ts`: Generate an independent HMAC signing key instead of deriving from JWT signature. Store alongside the encryption key in the keychain.

**SEC-7** — `index.html`: Add `worker-src 'self';` to the CSP meta tag.

Skip SEC-5 (legacy PBKDF2 — document only), SEC-6 (globalThis — accepted limitation), SEC-8 (response buffering — theoretical).

**Verify:** `npm test` passes, `npm run typecheck` clean, `npm run build` succeeds.

**Acceptance:** sessionStorage fallback encrypted, localStorage caches encrypted, logger redaction improved, HMAC key independent, CSP updated.

---

### Task 6: API resilience (API-1, API-2, API-3, API-5)

**API-1** — `js/api.ts:1495-1518`: Add `signal?: AbortSignal` parameter to `fetchUsers()`. Pass it through to `fetchWithAuth()`. Update callers in `main.ts` to pass the report abort signal.

**API-2** — `js/api.ts`: In the circuit breaker, limit HALF_OPEN state to allow only 1 probe request. If it succeeds, transition to CLOSED. If it fails, transition back to OPEN.

**API-3** — `js/api.ts`: Add random jitter to exponential backoff: `delay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)`.

**API-5** — `js/api.ts`: When a time-off batch fails, track the failure and surface a warning to the user via a callback or return value. Don't silently swallow the error.

Skip API-4 (holiday dedup sampling — verify Fisher-Yates is actually random; fix only if broken) and API-6 (already handled in Task 4).

**Verify:** `npm test` passes. Add tests for abort signal, HALF_OPEN single-request, jitter, and batch failure tracking.

**Acceptance:** fetchUsers cancellable, circuit breaker HALF_OPEN bounded, backoff has jitter, time-off failures surfaced.

---

### Task 7: CSS overhaul (UX-1, UX-2, CQ-8)

**UX-2 + CQ-8** — `css/styles.css`: Identify and remove the ~400 lines of duplicate/dead CSS rules from the earlier "desktop" version (approximately lines 60-500). Keep the later density-aware definitions (lines ~570+). For each duplicate pair, keep the later definition.

**UX-1** — `css/styles.css`: Add responsive CSS for the Clockify sidebar (300-400px width):
```css
@media (max-width: 450px) {
  body { padding: 8px; }
  .container { max-width: 100%; padding: 0; }
  /* Reduce font sizes, stack layouts, hide non-essential columns */
}
```

**Verify:** `npm run build` succeeds. Visually review in browser at 350px width if possible. Run `npm run test:e2e` to ensure nothing breaks.

**Acceptance:** Duplicate CSS removed, sidebar-targeted responsive rules added.

---

### Task 8: UI fixes (UX-3, UX-4, UX-5, UX-6, PERF-1)

**UX-3** — `js/ui/index.ts`: Use a named function for the document keydown listener. Export a `cleanup()` function that removes it.

**UX-4** — `js/ui/detailed.ts` or `js/ui/shared.ts`: Add `role="radiogroup"` to filter chip containers and `role="radio"` to individual filter chips. Add `tabindex="0"` and arrow key navigation.

**UX-5** — `js/ui/overrides.ts`: Instead of full re-render on override change, update only the affected card. Preserve scroll position and focus state.

**UX-6** — `js/ui/dialogs.ts`: Separate the error banner and throttle status into different DOM elements. Both should be visible simultaneously.

**PERF-1** — `js/ui/detailed.ts`: Build new table content with `DocumentFragment` instead of replacing `innerHTML` directly. Batch DOM changes.

Skip UX-7 (native confirm — low priority cosmetic), UX-8 (currency — requires config changes, scope creep), PERF-4 (listener cleanup — benign currently), PERF-2 (worker serialization — moot until worker fixed).

**Verify:** `npm test` passes, `npm run test:e2e` passes.

**Acceptance:** Keydown listener cleanable, filter chips accessible, overrides partial re-render, separate status elements, DocumentFragment pagination.

---

### Task 9: Business logic documentation (BL-1, BL-2, BL-3)

**BL-1** — `js/calc.ts`: Add JSDoc comments to override resolution functions explaining that overrides are mode-gated (daily mode ignores weekly overrides and vice versa).

**BL-2** — `js/calc.ts`: Add JSDoc comment to Tier 2 accumulation explaining cumulative cross-day behavior.

**BL-3** — `js/calc.ts`: Add JSDoc comment to weekly threshold logic explaining that threshold=0 disables OT (different from daily).

Skip BL-4 (non-billable profit — design decision, not a bug).

**Verify:** `npm run typecheck` clean (JSDoc doesn't break types).

**Acceptance:** All 3 business logic behaviors documented in code.

---

### Task 10: Calc.ts refactors (CQ-2, CQ-4)

**CQ-2** — `js/calc.ts`: Extract a single generic `getEffectiveOverrideValue()` function that implements the 4-level precedence cascade. Replace `getEffectiveCapacity`, `getEffectiveMultiplier`, `getEffectiveTier2Threshold`, `getEffectiveTier2Multiplier` with calls to the generic function.

**CQ-4** — `js/types.ts`: Change override value types from `string | number` to `number`. Add normalization at the boundary (when reading from localStorage or UI inputs in `state.ts` and `main.ts`).

**Verify:** `npm test` passes, `npm run typecheck` clean. Override precedence tests must still pass.

**Acceptance:** DRY override resolution, normalized override types.

---

### Task 11: Main.ts decomposition (CQ-1)

Extract the following from `js/main.ts` into focused modules:

1. `js/config-manager.ts` — Extract `bindConfigEvents()` (~490 lines) and all config-related event handling.
2. `js/report-orchestrator.ts` — Extract `handleGenerateReport()` (~415 lines), `runCalculationAsync()`, `runCalculationInWorker()`, `serializeStoreForWorker()`, `deserializeWorkerResults()`.
3. `js/date-presets.ts` — Extract date preset button calculations and binding.
4. `js/worker-manager.ts` — Extract `initCalculationWorker()` and worker pool lifecycle.

Keep `main.ts` as a thin entry point that imports and wires these modules.

Move the 7 module-scoped `let` variables into the appropriate extracted modules.

**Critical:** This is a high-risk refactor. After extraction:
- `npm test` must pass (all 3287 tests)
- `npm run typecheck` must be clean
- `npm run test:e2e` must pass
- `npm run build` must succeed

If tests fail, fix them. Don't leave broken tests.

**Acceptance:** main.ts under 500 lines. All extracted modules have clear single responsibilities. All tests pass.

---

### Task 12: API.ts store decoupling (CQ-3)

Decouple `js/api.ts` from the global `store` singleton:

1. Identify all `store.*` reads in api.ts (token, claims, config, throttle tracking, diagnostics).
2. Create an interface `ApiDependencies` with the needed fields.
3. Accept `ApiDependencies` as a parameter (or via an `init()` function) instead of importing `store` directly.
4. Update `main.ts` to pass the store's relevant fields to the API module.
5. Update all API tests to use the new interface.

**Critical:** Same verification requirements as Task 11 — all tests must pass.

**Acceptance:** api.ts no longer imports `store` directly. Uses injected dependencies. All tests pass.

---

### Task 13: Test improvements (TEST-1, TEST-2, TEST-3, TEST-4, TEST-5)

**TEST-1** — `stryker.config.json`: Add `js/ui/shared.ts`, `js/ui/dialogs.ts`, and `js/streaming.ts` to the Stryker mutate list. Do NOT run Stryker — just update the config.

**TEST-2** — Strengthen the worst weak assertions. Focus on:
- `__tests__/unit/state.test.js` (highest count)
- `__tests__/unit/api-mutations.test.js`
Replace `toBeDefined()` with `toEqual()`, `toBe()`, `toHaveLength()`, etc. Aim to reduce weak assertions by at least 50%.

**TEST-3** — Update E2E mock duration format in `__tests__/e2e/helpers/mock-api.ts` to use ISO 8601 strings (`'PT3H'`, `'PT4H'`) instead of numeric seconds.

**TEST-4** — Add an integration test for IndexedDB encrypted cache round-trip: write report data, read it back, verify exact equality.

**TEST-5** — Add an E2E test for the overrides workflow: navigate to overrides tab, set a user override, verify the calculation updates, verify persistence.

**Verify:** `npm test` passes (test count should increase). `npm run test:e2e` passes.

**Acceptance:** Stryker config updated, weak assertions reduced by 50%+, E2E mocks use ISO durations, IDB round-trip test added, overrides E2E test added.

---

### Task 14: Istanbul ignore review (CQ-5)

Review all 78 `/* istanbul ignore */` directives across source files. For each:
- If the code path is testable, add a test and remove the ignore directive.
- If the code path is truly untestable (browser-only API, defensive dead code), keep the ignore with a more descriptive comment.

Focus on `api.ts` (18 ignores) and `ui/detailed.ts` (16 ignores) first.

Target: Remove at least 20 istanbul ignore directives by adding proper tests.

**Verify:** `npm test` passes. Coverage should increase.

**Acceptance:** At least 20 istanbul ignores removed with replacement tests. Remaining ignores have descriptive comments.

---

### Task 15: Final verification and documentation

1. Run full verification suite:
   - `npm run typecheck` — must be clean
   - `npm run lint` — 0 errors
   - `npm test` — all tests pass
   - `npm run build` — succeeds
   - `npm run test:e2e` — all tests pass

2. Update `CLAUDE.md`:
   - Update test baselines (suite count, test count, coverage)
   - Add new modules to Architecture section
   - Document audit remediation in Completed Work
   - Update Architecture Notes for any structural changes

3. Update `offtasks.md`:
   - Ensure all implemented findings are marked `[RESOLVED]`
   - Update the summary table with final counts

4. Commit all changes.

**Acceptance:** Full test suite green. Documentation updated. All High and Medium findings resolved.

---

## Rules

- **Read before writing.** Read every file completely before modifying it.
- **Test-first when possible.** Write the failing test, then implement the fix.
- **One task per iteration minimum.** Complete at least one full task per iteration.
- **Run tests after each task.** `npm test` must pass before moving to the next task.
- **Do NOT break existing tests.** If a test fails, fix it — don't delete it.
- **Do NOT change test expectations** to match broken code. Fix the code instead.
- **Check `.claude/ralph-progress.md`** at the start of every iteration.
- **Update `.claude/ralph-progress.md`** at the end of every iteration with what was completed.
- **Mark findings as `[RESOLVED]`** in `offtasks.md` after implementing each fix.
- **Commit after each task** with descriptive messages (e.g., `fix: COR-1 CSV chunk boundary newlines`).
- **Do NOT modify `offtasks.md` findings** beyond adding `[RESOLVED]` prefix.
- **Coverage must stay above 80%** on all metrics after changes.
- **Do NOT add new dependencies.** Use existing packages and browser APIs only.

When all 15 tasks are complete and verification passes:

<promise>ALL_FIXES_COMPLETE</promise>
