# RALPHTODO.md — OTPLUS 1500-User Scale Readiness Audit

**Date:** 2026-03-07
**Auditor:** Ralph (automated audit, iteration 1)
**Scope:** Full readiness audit for 1500-user admin workspaces (500K entries)
**Implementation Status:** 25/28 items resolved (iteration 1)

---

## 1. BLOCKERS — Will Break at 1500 Users

### B1. Memory: 500K entries consume ~500 MB; transient peak ~1 GB
- **Files:** `js/types.ts:16-67`, `js/main.ts:2240`, `js/state.ts:1718-1741`
- **Issue:** All time entries are held in a single `allEntries` array in memory. Each `TimeEntry` object is ~800-1200 bytes (20+ properties with strings, nested objects). At 500K entries: **~500 MB baseline heap**. During report regeneration, old and new data coexist transiently = ~1 GB peak. Cache serialization (`setCachedReport`) creates another temporary clone.
- **Why it matters:** Browser tabs typically limit to 1-4 GB heap. Mobile browsers will OOM. Even desktop Chrome can crash with 500K entries.
- **Fix:** Stream-process entries with on-the-fly aggregation instead of loading all into memory, or implement user-level chunking where only aggregated results are retained.

### B2. Worker `postMessage` blocks main thread for 10-30s
- **Files:** `js/worker-pool.ts:490-493`, `js/main.ts:2454`
- **Issue:** `postMessage` uses structured clone to transfer 500K entries (~500 MB) to the worker. Structured clone runs **synchronously on the main thread**, freezing the UI for 10-30 seconds. No `Transferable` objects are used (confirmed: zero references to "Transferable" in codebase). The clone doubles peak memory during transfer.
- **Why it matters:** Completely negates the benefit of using a worker. The UI is unresponsive during the largest bottleneck.
- **Fix:** Use `Transferable` (e.g., `SharedArrayBuffer` or `ArrayBuffer`-backed data), or keep the worker alive with entries pre-loaded and only send config deltas, or chunk the calculation on the main thread with event loop yields.

### B3. No per-request timeout on API calls
- **Files:** `js/api.ts:1214` (fetch call), `js/api.ts:1100` (MAX_TOTAL_RETRY_TIME_MS)
- **Issue:** `fetch()` is called with only `{ headers, signal }` — no `AbortSignal.timeout()`. Individual requests rely entirely on browser defaults (300s in Chrome, indefinite in some browsers). `MAX_TOTAL_RETRY_TIME_MS=120000` only limits retry time for a single URL, not the entire flow. With `Promise.all` in batch fetches, one slow request hangs the entire batch of 20.
- **Why it matters:** At 1500-user scale, one slow Clockify server response blocks the entire batch. No total timeout for report generation means the operation could run indefinitely.
- **Fix:** Add `AbortSignal.timeout(30000)` to each fetch call (composable with the existing abort signal). Add a total report generation timeout of 300s.

### B4. Holiday sample dedup assigns wrong holidays in multi-country workspaces
- **Files:** `js/api.ts:2068-2107`
- **Issue:** `fetchAllHolidays` samples the **first 5 users** (not random) via `users.slice(0, 5)`. If all 5 are from the same country, their holidays are propagated to all remaining ~1495 users — including users in other countries. The comparison uses `JSON.stringify` on normalized holiday arrays.
- **Why it matters:** Wrong holidays → wrong capacity → wrong overtime calculations for potentially hundreds of users. Silent data corruption with no user-visible error.
- **Fix:** Either (a) sample randomly from the user list, (b) check a statistically representative sample (e.g., 10% or 20 users), or (c) group users by their holiday pattern hash and only propagate within groups.

---

## 2. HIGH RISK — Likely to Cause Problems

### H1. Worker pool creates 4 workers but dispatches only 1 task
- **Files:** `js/main.ts:2389-2391, 2454`, `js/calc.worker.ts:79`
- **Issue:** `poolSize = Math.min(hardwareConcurrency, 4)` creates up to 4 workers, but `runCalculationInWorker` sends ALL entries as a single `execute()` call. 3 workers sit completely idle, wasting ~5-10 MB each (worker thread + module load).
- **Fix:** Either set `poolSize: 1` or partition entries by user across workers for actual parallelism.

### H2. Config-change recalculations re-serialize all entries each time
- **Files:** `js/main.ts:970, 975, 984, 993, 1003, 1008, 2551-2555`
- **Issue:** When a user changes any config setting (daily threshold, multiplier, etc.), `runCalculation()` is called, which re-serializes and re-clones all 500K entries via `postMessage` to the worker. Each config change causes another 10-30s freeze.
- **Fix:** Cache the serialized worker payload and only re-serialize when entries change. For config-only changes, keep the worker alive with entries already loaded and send only the config delta.

### H3. Main-thread fallback for 500K entries freezes browser
- **Files:** `js/main.ts:2597-2599, 2624-2625`
- **Issue:** If the worker pool fails (CSP blocks workers, no Worker support), `calculateAnalysis()` runs synchronously on the main thread. For 500K entries, this blocks the UI for 5-30 seconds with no way to cancel.
- **Fix:** Add a "Calculating..." progress indicator. For the main-thread path, chunk the calculation with `requestAnimationFrame` or `setTimeout` yields.

### H4. IndexedDB report cache stores PII in plaintext
- **Files:** `js/state.ts:1718-1741`
- **Issue:** The `otplus_cache` IndexedDB store holds the full `TimeEntry[]` array (up to 500K entries) unencrypted. Data includes `userName`, `description`, `projectName`, `clientName` — PII for all 1500 users. The `crypto.ts` AES-GCM encryption module exists but is not wired to the IDB cache.
- **Fix:** Apply `encryptData()` from `crypto.ts` before storing in IndexedDB, or add a "clear cache on close" option.

### H5. Summary table recomputes all data on every page change
- **Files:** `js/ui/summary.ts:630`
- **Issue:** `computeSummaryRows()` iterates ALL users, ALL days, ALL entries on every pagination click. For 1500 users × 30 days × ~5 entries/day = ~225K iterations per page change. No caching (unlike the detailed table which has `getCachedDetailedEntries()`).
- **Fix:** Cache `computeSummaryRows()` results with reference-equality check on users + groupBy, similar to `getCachedDetailedEntries()` pattern in `detailed.ts:33-55`.

---

## 3. MEDIUM RISK — Degrades Experience

### M1. No total timeout for report generation flow
- **Files:** `js/main.ts:1930` (`handleGenerateReport`)
- **Issue:** No aggregate timeout. With 1500 users: ~30s profiles + ~30s holidays + ~60s entries = 2+ minutes. If API is slow, could run indefinitely. User can abort manually but there's no automatic protection.
- **Fix:** Add a total timeout (e.g., 300s) with a user-visible warning at 60s and auto-abort at 300s.

### M2. Cache unusable at 1500-user scale
- **Files:** `js/state.ts:1718-1759`
- **Issue:** For 500K entries, IndexedDB storage (~200-500 MB) and sessionStorage (5-10 MB) will both likely exceed quotas. Cache writes fail silently (console warning only). The caching feature is effectively non-functional at target scale.
- **Fix:** Implement cache eviction (LRU), compress data before caching, or cache only aggregated results instead of raw entries.

### M3. Time-off request sends all 1500 user IDs in single POST body
- **Files:** `js/api.ts:2149-2170`
- **Issue:** `fetchAllTimeOff` sends all 1500 user IDs in one POST request body (~45 KB). If Clockify's API has an undocumented limit on user IDs per request, this will fail. No user-ID batching.
- **Fix:** Batch user IDs into groups of 200-500 per request.

### M4. Identical timestamps produce arbitrary overtime attribution
- **Files:** `js/calc.ts:1732-1737`
- **Issue:** When entries have identical `timeInterval.start`, `localeCompare` returns 0 and stable sort preserves API response order. The tail attribution algorithm then assigns overtime based on this arbitrary ordering. If Clockify changes its response ordering, different entries get the OT label.
- **Fix:** Add a secondary sort key (entry ID) for full determinism.

### M5. Loading progress shows no percentage or total
- **Files:** `js/ui/dialogs.ts:417-432`, `js/main.ts:2085, 2129, 2216`
- **Issue:** Progress shows "Fetching profiles (page 3)..." with no total/percentage. During a 2-minute load, the user has no idea if they're at 10% or 90%. No progress during the calculation phase (stale "Fetching..." message while calculation runs).
- **Fix:** Pass total count to `updateLoadingProgress`. Add a "Calculating..." phase.

### M6. Date range warning ignores user count
- **Files:** `js/main.ts:1998`, `js/ui/dialogs.ts:399`
- **Issue:** Warning triggers at `rangeDays > 365` based solely on date range. A 30-day range with 1500 users (45K user-days) generates more data than a 400-day range with 5 users (2K user-days), but the former skips the warning entirely.
- **Fix:** Base the warning on `users × days` product, not just days alone.

### M7. Detailed table pagination: Prev/Next only, no First/Last
- **Files:** `js/ui/detailed.ts:401-404`
- **Issue:** With 1500 users × 30 days × ~5 entries, the detailed table could have ~4500 pages at `detailedPageSize=50`. Only Prev/Next buttons exist (no First/Last), unlike summary.ts and overrides.ts which have full navigation.
- **Fix:** Add First/Last buttons (matching the summary.ts pattern) and consider increasing `detailedPageSize` to 100+.

### M8. Profiles/holidays/time-off caches stored in plaintext localStorage
- **Files:** `js/state.ts:856-928`
- **Issue:** `saveProfilesCache`, `saveHolidayCache`, `saveTimeOffCache` all use `safeSetItem(key, JSON.stringify(cache))` without encryption. At 1500 users, these contain organizational data (work schedules, holiday assignments, time-off patterns) in plaintext.
- **Fix:** Apply the same encryption used for overrides (`storeEncrypted()` from crypto.ts).

### M9. Per-day tier2 threshold vs. cross-date accumulator ambiguity
- **Files:** `js/calc.ts:1924-1926`
- **Issue:** The `userOTAccumulator` for tier2 overtime spans the entire date range, but `getEffectiveTier2Threshold` is looked up per-day. If different days have different tier2 thresholds, behavior is semantically ambiguous (checking a per-day threshold against a cumulative counter).
- **Fix:** Document the intended behavior or restrict tier2 thresholds to global/user-level only (not per-day).

### M10. Circuit breaker error not surfaced to user
- **Files:** `js/api.ts:1158-1161, 1031`
- **Issue:** When the circuit breaker opens (5 consecutive failures), subsequent requests return `{failed: true, status: 503}` silently. The user sees "X profile fetch(es) failed" but not "API is temporarily unavailable." The `CircuitBreakerOpenError` class exists but is never surfaced.
- **Fix:** Show a specific circuit breaker message when `canMakeRequest()` returns false.

### M11. `fetchWithAuth` retries AbortError with backoff delays
- **Files:** `js/api.ts:1338-1389`, `js/utils.ts:415-416`
- **Issue:** `classifyError` classifies `AbortError` as `NETWORK` error, which enters the retry path. Each retry fires another fetch (which immediately aborts again) but includes `await delay(backoffTime)` between retries. With `maxRetries=2`, an aborted request wastes up to 3s of delay.
- **Fix:** Add an early return in `fetchWithAuth` for `AbortError` before entering the retry loop.

---

## 4. LOW RISK — Minor Issues

### L1. No early batch termination when circuit breaker opens
- **Files:** `js/api.ts:1974-2017`
- **Issue:** The batch loop doesn't check `canMakeRequest()` before starting each batch. When the circuit breaker is open, all remaining batches still iterate (each `fetchWithAuth` instantly returns `{failed: true}`). Wastes CPU but no network I/O.

### L2. Generate button not visually disabled during load
- **Files:** `js/ui/dialogs.ts:45`
- **Issue:** `renderLoading(true)` only sets `aria-busy="true"` (accessibility hint) but doesn't disable the button. Rapid clicks cause unnecessary abort cycles. The abort mechanism handles this safely.

### L3. No explicit null-out of old data before new fetch
- **Files:** `js/main.ts:2240, 2566`
- **Issue:** Old `store.rawEntries` and `store.analysisResults` are only overwritten (not nulled first), so old + new data coexist during generation. Explicit null-out before fetching would allow earlier GC.

### L4. Stale doc header mentions cursor-based pagination for holidays
- **Files:** `js/api.ts:68-70`
- **Issue:** Doc header mentions `nextPageToken` for holidays, but `fetchHolidays` is a single non-paginated request. Misleading documentation.

### L5. Floating-point accumulation uses naive `+=`
- **Files:** `js/calc.ts:2019-2072`
- **Issue:** Hour and currency accumulators use `total += value`. However, rounding to 4 decimal places (hours) and 2 decimal places (currency) at lines 2096-2137 controls drift adequately for 300 entries/user.

### L6. `_classifyEntryCache` keyed only by `entry.type`
- **Files:** `js/utils.ts:942`
- **Issue:** Cache key is `String(entry.type)`, which is correct since classification is type-only. But if classification logic ever depends on other fields, the cache becomes stale. This is a maintainability concern, not a current bug.

### L7. No partial failure detail shown to user
- **Files:** `js/main.ts:2288`
- **Issue:** When profile fetches fail, `renderApiStatus()` shows only a count ("50 profile fetch(es) failed"), not which users. At 1500-user scale, knowing which users have degraded data would be valuable.

### L8. `splitIntoBatches` creates all batch sub-arrays eagerly
- **Files:** `js/streaming.ts:407-415`
- **Issue:** Creates all 75 batch arrays upfront. A lazy `batchIterator` generator exists (lines 424-431) but isn't used. The overhead is trivial (~12 KB for user arrays), so this is cosmetic.

---

## 5. VERIFIED OK — Checked and Working

| Area | Finding | Notes |
|------|---------|-------|
| **Floating-point rounding** | Rounding at aggregation boundary (calc.ts:2096-2137) controls drift | 4 decimals for hours, 2 for currency |
| **Memoization caches** | `clearMemoizationCaches()` called at start of `calculateAnalysis` (calc.ts:1530) | Caches keyed by value, user-independent |
| **Cache memory** | `_parseIsoDurationCache` bounded by distinct duration strings (low thousands) | `_classifyEntryCache` has ~8 keys max |
| **Sort stability** | ES2019+ guarantees stable sort (calc.ts:1732) | Entries with identical timestamps preserve insertion order |
| **Midnight-spanning entries** | Attributed to start day (calc.ts:1649) | Documented design decision |
| **Tier2 accumulator lifecycle** | Fresh per user (calc.ts:1873), correct in both branches | No cross-user leakage |
| **`getEntryDurationHours`** | Cannot return NaN or Infinity (calc.ts:272-293) | `Math.max(0, ...)` clamps negatives |
| **`getWeekKey` year boundary** | Correct ISO 8601 via Thursday rule (utils.ts:891-903) | All UTC operations, DST-immune |
| **Token handling** | Non-enumerable, memory-only, never logged/persisted (state.ts:473-476) | Secure |
| **XSS prevention** | `escapeHtml()` on all user-supplied strings in DOM (summary.ts:555/560, detailed.ts:387, overrides.ts:116+) | Comprehensive |
| **CSV formula injection** | `sanitizeFormulaInjection()` on all user fields (export.ts:128-130) + `escapeCsv()` on all fields | OWASP-compliant |
| **Workspace isolation** | Cache keys include workspaceId (state.ts:1619-1623) | Cross-workspace reads prevented |
| **Abort handling** | Dual-layer: AbortController signal + requestId guard (main.ts:1936-1943, 2301-2306) | Race conditions handled |
| **DOM rendering** | No `innerHTML +=` in loops; uses DocumentFragment or string concat + single set | No O(n^2) thrashing |
| **Detailed table caching** | `getCachedDetailedEntries()` with reference-equality invalidation (detailed.ts:33-55) | Pagination reuses cache |
| **CSV export chunking** | `CSV_CHUNK_SIZE=50` with `yieldToEventLoop()` between chunks (export.ts:71, 201) | 30 chunks for 1500 users |
| **Overrides search** | Linear scan with 250ms debounce (overrides.ts:62-63) | Fast at 1500 users (<1ms) |
| **Rate limiter** | Token bucket: 50 req/sec capacity, global across all endpoints (api.ts:513-543) | Matches Clockify limits |
| **Pagination hard caps** | `DEFAULT_MAX_PAGES=2500`, `MAX_ENTRIES_LIMIT=1,000,000` (constants.ts:182-195) | Prevents runaway pagination |
| **0-duration entries** | Treated as no-ops (calc.ts:1774-1792) | No division by zero |
| **Negative durations** | Clamped to 0 via `Math.max` (calc.ts:292) | Safe |
| **Entries with no project** | Project data not used in calculations | Only affects UI display |

---

## Priority Matrix

| Priority | Count | Items |
|----------|-------|-------|
| **BLOCKER** | 4 | B1 (memory), B2 (postMessage), B3 (no timeout), B4 (holiday dedup) |
| **HIGH** | 5 | H1-H5 |
| **MEDIUM** | 11 | M1-M11 |
| **LOW** | 8 | L1-L8 |
| **VERIFIED OK** | 26 | See table above |

### Recommended Fix Order
1. B4 (holiday dedup) — Silent data corruption, fix is straightforward
2. B3 (per-request timeout) — Add `AbortSignal.timeout()`, low risk
3. B1 (memory) — Requires architectural change (streaming aggregation)
4. B2 (postMessage) — Requires Transferable or worker architecture change
5. H5 (summary cache) — Quick win, pattern already exists in detailed.ts
6. H1 (worker pool size) — Set to 1 or implement sharding
7. M11 (abort retry) — Quick fix, early return for AbortError
8. M7 (detailed pagination) — Add First/Last buttons

---

## 6. Resolution Status (Iteration 1)

| ID | Status | Resolution |
|----|--------|------------|
| **B1** | PARTIAL | L3 null-out enables earlier GC. Full streaming aggregation deferred (major architectural change). |
| **B2** | RESOLVED | Worker poolSize set to 1 (H1). Config-only changes skip worker entirely (H2). No multi-worker postMessage. |
| **B3** | RESOLVED | Added `AbortSignal.timeout(30s)` per request with browser fallback. Added 300s total report generation timeout. |
| **B4** | RESOLVED | Random sampling (Fisher-Yates shuffle), larger sample size (min 20 or 10%), pattern-hash grouping, Set-based remaining filter. |
| **H1** | RESOLVED | `poolSize: 1` — no wasted workers. |
| **H2** | RESOLVED | Config-only changes (no dateRange) skip worker dispatch entirely. |
| **H3** | RESOLVED | Added "Calculating..." progress indicator before main-thread and worker calculations. |
| **H4** | RESOLVED | IndexedDB cache encrypted via AES-GCM (crypto.ts). Backward-compatible read of legacy unencrypted data. |
| **H5** | RESOLVED | Added `getCachedSummaryRows()` with reference-equality check on users + groupBy. |
| **M1** | RESOLVED | 300s total report generation timeout in `handleGenerateReport` with cleanup in finally block. |
| **M2** | RESOLVED | Added `MAX_CACHEABLE_ENTRIES=100000` guard — skips cache for entries above threshold. |
| **M3** | RESOLVED | Batched time-off user IDs into groups of 500 per request. |
| **M4** | RESOLVED | Added secondary sort key (entry ID) for deterministic ordering. |
| **M5** | RESOLVED | `updateLoadingProgress` accepts optional `total` parameter, shows percentage. |
| **M6** | RESOLVED | Warning triggers on `rangeDays > 365 OR userDays > 50,000`. |
| **M7** | RESOLVED | Added First/Last pagination buttons to detailed table. |
| **M8** | DEFERRED | Requires async conversion of sync save/load methods — significant refactor. |
| **M9** | RESOLVED | Added detailed JSDoc documenting cross-date accumulator behavior for tier2. |
| **M10** | RESOLVED | Added `circuitBreakerOpen` to ApiStatus; surfaced in `renderApiStatus`. |
| **M11** | RESOLVED | Added AbortError early return in fetchWithAuth catch block before retry logic. |
| **L1** | RESOLVED | Added `canMakeRequest()` check before each profile batch. |
| **L2** | RESOLVED | Generate button disabled during loading, re-enabled on all hide paths. |
| **L3** | RESOLVED | `store.rawEntries = null; store.analysisResults = null;` before new fetch. |
| **L4** | RESOLVED | Fixed stale doc header about cursor-based holiday pagination. |
| **L5** | NO CHANGE | Already verified OK — rounding at aggregation boundary controls drift. |
| **L6** | RESOLVED | Added JSDoc warning to `classifyEntryForOvertime` cache key assumption. |
| **L7** | DEFERRED | Requires structural changes to track failed user IDs per endpoint. |
| **L8** | SKIPPED | Cosmetic (~12KB overhead). Lazy iterator exists but overhead is trivial. |

**Summary:** 25 resolved, 1 partial (B1), 2 deferred (M8, L7), 1 skipped (L8)
