# OTPLUS Optimization — Ralph Loop Prompt

You are working on OTPLUS at `/Users/15x/Documents/addons-me/otrepo`.

## Project Context

OTPLUS is a TypeScript Clockify sidebar addon that calculates overtime. It currently can't handle workspaces with more than ~50 users due to missing pagination and performance bottlenecks. The goal is to scale it to support **1500-user workspaces**.

Key files:
- `OPTIMIZATION_PLAN.md` — The master plan with 19 items across 5 phases. READ THIS FIRST.
- `CLAUDE.md` — Project instructions, architecture, testing notes
- `AGENTS.md` — Verification matrix and working rules

## Current State

- All audit remediation (T1-T88) is complete
- Phase 1.1 (`fetchUsers` pagination) and Phase 1.3 (`fetchTimeOffRequests` pagination) are ALREADY DONE
- Phase 1.2 and everything in Phases 2-5 are NOT started
- Baseline: 93 suites / 3233 Jest tests, 236/237 E2E tests, coverage >80% all metrics

## What You Must Do

Check `.claude/ralph-progress.md` at start of each iteration for what previous iterations completed.

### Task 1: Raise Entry Pagination Limits (Phase 1.2)
- **File:** `js/constants.ts` lines 182 and 188
- Change `DEFAULT_MAX_PAGES` from `50` to `2500`
- Change `HARD_MAX_PAGES_LIMIT` from `500` to `5000`
- Add `MAX_ENTRIES_LIMIT = 1_000_000` constant
- **File:** `js/api.ts` — In `fetchDetailedReport`, add entry count safety valve after `allEntries.push(...)`:
  ```typescript
  if (allEntries.length >= MAX_ENTRIES_LIMIT) {
      apiLogger.warn('Entry count safety limit reached', { limit: MAX_ENTRIES_LIMIT, entriesFetched: allEntries.length });
      store.ui.paginationTruncated = true;
      hasMore = false;
  }
  ```
- Write tests verifying new constant values and entry limit behavior
- **Verify:** `npm test && npm run typecheck`

### Task 2: Increase BATCH_SIZE (Phase 2.1)
- **File:** `js/api.ts` line 359 — Change `BATCH_SIZE = 5` to `BATCH_SIZE = 20`
- Write test verifying the new value
- **Verify:** `npm test && npm run typecheck`

### Task 3: Holiday Deduplication (Phase 2.2)
- **File:** `js/api.ts`, `fetchAllHolidays` method
- Implement sample-and-propagate strategy: fetch holidays for first 5 users, if all identical, clone to remaining users; otherwise fall back to full per-user fetch
- See `OPTIMIZATION_PLAN.md` Phase 2.2 for exact implementation
- Write tests: identical samples → propagation; different samples → fallback; sample failure → fallback
- **Verify:** `npm test && npm run typecheck`

### Task 4: Batch Profile Retries (Phase 2.3)
- **File:** `js/api.ts`, profile retry block (lines ~1949-1959)
- Replace unbatched `Promise.all` retry with BATCH_SIZE-limited retry loop
- Write tests verifying batched retries
- **Verify:** `npm test && npm run typecheck`

### Task 5: Progress Callbacks (Phase 2.4)
- Add `onProgress` to `FetchOptions` type
- Add progress callbacks to `fetchAllProfiles` and `fetchAllHolidays` batch loops
- Update call sites in `js/main.ts` to pass progress handler
- Write tests verifying progress callback is called with correct counts
- **Verify:** `npm test && npm run typecheck`

### Task 6: Cache Detailed Entries (Phase 3.1)
- **File:** `js/ui/detailed.ts`
- Add module-level cache for flattened+sorted entries with reference identity invalidation
- Export `invalidateDetailedCache()` function
- Replace the flatMap+sort block with cached version
- Write tests for cache hit, cache miss, invalidation
- **Verify:** `npm test && npm run typecheck`

### Task 7: Pre-compute Filter Subsets (Phase 3.2)
- **File:** `js/ui/detailed.ts`
- Build `Map<filterName, DetailedEntry[]>` when cache is built
- Replace filter block with map lookup
- Update `invalidateDetailedCache()` to clear filter subsets
- Write tests for each filter type returning correct subset
- **Verify:** `npm test && npm run typecheck`

### Task 8: Paginate Summary Table (Phase 3.3)
- **Files:** `js/ui/summary.ts`, `js/state.ts`
- Add `summaryPage` and `summaryPageSize` (default 100) to UIState
- Paginate `renderSummaryTable` to only render current page
- Add pagination controls with First/Prev/Next/Last buttons
- Write tests: verify only pageSize rows rendered, pagination controls appear, navigation works
- **Verify:** `npm test && npm run typecheck && npm run test:e2e`

### Task 9: Paginate + Search Overrides (Phase 3.4)
- **Files:** `js/ui/overrides.ts`, `js/state.ts`
- Add `overridesPage`, `overridesPageSize` (default 50), `overridesSearch` to UIState
- Add search bar with debounced filtering
- Paginate override cards
- Write tests: verify only pageSize cards rendered, search filters correctly, pagination resets on search
- **Verify:** `npm test && npm run typecheck && npm run test:e2e`

### Task 10: Streaming CSV Export (Phase 4.1)
- **File:** `js/export.ts`
- Make `downloadCsv` async, build CSV in chunks of 50 users
- Use `Blob([chunks])` instead of single concatenated string
- Yield to event loop between chunks with `setTimeout(resolve, 0)`
- Update export button handler in `js/main.ts` to use `await`
- Write tests: verify CSV output matches, async signature works
- **Verify:** `npm test && npm run typecheck && npm run test:e2e`

### Task 11: IndexedDB Report Cache (Phase 4.2)
- **File:** `js/state.ts`
- Add `openCacheDb()` helper for IndexedDB
- Make `getCachedReport` and `setCachedReport` async with IndexedDB
- Add graceful fallback to null when IndexedDB is unavailable
- Update callers in `js/main.ts` to use `await`
- Write tests: IDB roundtrip, cache key mismatch, expired cache, fallback
- **Verify:** `npm test && npm run typecheck`

### Task 12: Eliminate Redundant Sorts (Phase 4.3)
- **File:** `js/calc.ts`
- Pre-sort entries once in day context initialization (~line 1725)
- Add `sortedEntries` to the day context type
- Replace 3 sort sites (lines ~1759, ~1824, ~1891) with `context.sortedEntries`
- Write tests: verify calculation results identical, sortedEntries correctly sorted
- **Verify:** `npm test && npm run typecheck`

### Task 13: Memoize Hot Pure Functions (Phase 4.5)
- **File:** `js/utils.ts`
- Add Map caches for `parseIsoDuration` and `classifyEntryForOvertime`
- Export `clearMemoizationCaches()` function
- **File:** `js/calc.ts` — Call `clearMemoizationCaches()` at start of `calculateAnalysis`
- Write tests: cache hits return same values, `clearMemoizationCaches` resets state
- **Verify:** `npm test && npm run typecheck`

### Task 14: Increase Worker Pool (Phase 4.4)
- **File:** `js/main.ts` line ~2383
- Change `poolSize: 1` to `Math.min(navigator.hardwareConcurrency || 4, 4)`
- Increase `taskTimeout` from 60000 to 120000
- Do NOT implement sharding yet (high risk) — just increase pool size
- Write test verifying pool size calculation
- **Verify:** `npm test && npm run typecheck`

### Task 15: Integrate streaming.ts (Phase 4.6)
- Replace manual batch loops in `js/api.ts` with `splitIntoBatches` from `js/streaming.ts`
- This is a structural improvement — no behavioral change
- Write test verifying `splitIntoBatches` produces correct batches
- **Verify:** `npm test && npm run typecheck`

### Task 16: Full Regression Suite
- Run: `npm test` — all suites must pass (perf timing flakes excluded)
- Run: `npm run typecheck` — must be clean
- Run: `npm run test:coverage` — all thresholds must exceed 80%
- Run: `npm run test:e2e` — must pass (run in isolation, not concurrently with Jest)
- Run: `npm run lint` — must have 0 errors
- Record results in `.claude/ralph-progress.md`

### Task 17: Update Documentation
- Update `CLAUDE.md` with new test baseline counts and architecture notes
- Update `AGENTS.md` baseline section
- Update `CONTRIBUTING.md` baseline section
- Update `OPTIMIZATION_PLAN.md` — mark each completed phase item as done
- Record final summary in `.claude/ralph-progress.md`

## Rules

- **Read before writing.** Always read existing code before modifying. Understand patterns before changing them.
- **Check `.claude/ralph-progress.md`** at the start of each iteration for what previous iterations completed.
- **Update CLAUDE.md** after structural changes.
- **Do NOT skip tests.** Every task must include tests for the new behavior.
- **Do NOT add unnecessary dependencies.** Use existing utilities (`js/streaming.ts`, etc.).
- **Do NOT implement worker sharding (Phase 4.4 sharding).** Only increase pool size. Sharding is high-risk and deferred.
- **Run verification after each task** before moving to the next. At minimum: `npm test && npm run typecheck`.
- **Run E2E tests in isolation** — never concurrently with Jest. E2E resource contention causes false failures.
- **Commit after each completed phase** (not after every task, but after Phase 1, Phase 2, Phase 3, Phase 4).
- **Playwright E2E route patterns** must use `**` suffix for any URL that might have query params (e.g., `**/users**` not `**/users`).
- **Performance timing tests** (`calc-performance.test.js`, `api-performance.test.js`) are known flakes — don't treat timing threshold failures as regressions.
- **Do NOT change security rules** (auth headers, token handling, CSV sanitization).
- **Keep functions sync unless async is required.** Don't make things async unnecessarily.

When all tasks are complete, output: <promise>ALL_OPTIMIZATIONS_COMPLETE</promise>
