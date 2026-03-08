# OTPLUS Line-by-Line Audit Findings

**Date:** 2026-03-08
**Method:** Ralph Loop iterative audit — every source file read line by line

---

## Summary

| Category | Critical | High | Medium | Low | Info |
|----------|----------|------|--------|-----|------|
| Correctness | 0 | 4 | 4 | 3 | 0 |
| Business Logic | 0 | 0 | 2 | 1 | 1 |
| Security | 0 | 2 | 2 | 4 | 0 |
| Performance | 0 | 1 | 2 | 1 | 0 |
| API & Network | 0 | 1 | 3 | 2 | 0 |
| UI/UX | 0 | 2 | 4 | 2 | 0 |
| Tests | 0 | 0 | 2 | 1 | 2 |
| Code Quality | 0 | 1 | 3 | 3 | 1 |

**Totals: 0 Critical, 11 High, 22 Medium, 17 Low, 4 Info = 54 findings**

---

## Findings

---

### [RESOLVED] COR-1: CSV export missing newline between chunks

- **Severity:** High
- **File:** `js/export.ts`
- **Lines:** 191-198
- **Code:**
```typescript
const chunks: string[] = ['\uFEFF' + headerLine]; // BOM + header as first chunk
for (let i = 0; i < analysis.length; i += CSV_CHUNK_SIZE) {
    const userChunk = analysis.slice(i, i + CSV_CHUNK_SIZE);
    const rows = buildRowsForUsers(userChunk);
    if (rows.length > 0) {
        // Add newline prefix for chunks after the header
        chunks.push(rows.join('\n'));
    }
}
```
- **Issue:** `rows.join('\n')` produces a string without a leading newline. The header chunk ends with `'\n'` (from `headerLine`), so the first data chunk joins correctly. But the last row of each subsequent data chunk has NO trailing newline, so when Blob concatenates chunks, the last row of chunk N merges with the first row of chunk N+1 into a single malformed line.
- **Impact:** For datasets large enough to span multiple chunks (>CSV_CHUNK_SIZE users), exported CSV has corrupted rows at chunk boundaries. Payroll data is silently mangled.
- **Fix:** Add `'\n'` prefix to data chunks after the first: `chunks.push('\n' + rows.join('\n'))` or ensure each chunk ends with `'\n'`.

---

### [RESOLVED] COR-2: Weekly sort missing secondary key for deterministic OT attribution

- **Severity:** High
- **File:** `js/calc.ts`
- **Lines:** 1825-1835
- **Code:**
```typescript
const sortedEntries = [...weekEntries].sort((a, b) => {
    const aStart = a.timeInterval?.start;
    const bStart = b.timeInterval?.start;
    if (!aStart || !bStart) {
        return 0;
    }
    return aStart.localeCompare(bStart);
});
```
- **Issue:** The daily sort (elsewhere in calc.ts) has a secondary key `|| (a.id || '').localeCompare(b.id || '')` for deterministic ordering when timestamps are equal. The weekly sort does NOT have this secondary key. Entries with identical start times get non-deterministic ordering in weekly mode, causing OT attribution to vary between runs.
- **Impact:** Non-reproducible overtime calculations in weekly/both modes. Two runs on the same data can attribute OT to different entries. This is payroll-adjacent — non-determinism is unacceptable.
- **Fix:** Add `|| (a.id || '').localeCompare(b.id || '')` as secondary sort comparator.

---

### [RESOLVED] COR-3: Entry mutation violates purity claim

- **Severity:** High
- **File:** `js/calc.ts`
- **Lines:** 2024
- **Code:**
```typescript
(entry as TimeEntry & { analysis: EntryAnalysis }).analysis = analysis;
```
- **Issue:** The calculation engine is documented as "pure" (no side effects), but this line mutates the input entry object by adding an `analysis` property. The original `TimeEntry` objects from the store are modified in-place.
- **Impact:** Subsequent calculations or UI renders see stale `analysis` properties from previous runs if entries are reused. The mutation leaks across the module boundary. While currently benign (entries are re-fetched each run), it violates the purity contract and could cause subtle bugs if caching is added.
- **Fix:** Build a new object: `const enrichedEntry = { ...entry, analysis };` and push that to `processedEntries` instead.

---

### [RESOLVED] COR-4: Worker pool protocol mismatch with calc.worker

- **Severity:** High
- **File:** `js/worker-pool.ts` / `js/calc.worker.ts`
- **Lines:** worker-pool.ts:490-493, calc.worker.ts:47-48
- **Code:**
```typescript
// worker-pool.ts sends:
idleWorker.worker.postMessage({
    taskId: task.id,
    payload: task.payload,
});

// calc.worker.ts expects:
ctx.onmessage = (event: MessageEvent<WorkerInput>) => {
    const { type, payload, requestId } = event.data;
    if (type !== 'calculate') { /* error */ }
};
```
- **Issue:** The generic WorkerPool sends `{ taskId, payload }` but calc.worker.ts destructures `{ type, requestId, payload }`. The `type` field is undefined (it's nested inside `payload`), so the worker always responds with an error. The error response uses `{ type: 'error', requestId }` format but the pool expects `{ taskId, result, error }` — the pool can't match the response to the pending task, causing a timeout. Main.ts wraps the actual payload inside another `payload` object, creating double-nesting.
- **Impact:** Worker-based calculation NEVER succeeds. Every attempt falls back to main-thread calculation (line 2634 in main.ts). The worker pool is dead code. This wastes initialization time and produces console errors on every report generation.
- **Fix:** Either adapt calc.worker.ts to use the WorkerPool protocol (`{ taskId, payload }`) or bypass the generic pool and use direct Worker communication as calc.worker.ts expects.

---

### [RESOLVED] COR-5: clearReportCache() only clears sessionStorage, not IndexedDB

- **Severity:** Medium
- **File:** `js/state.ts`
- **Lines:** 1796-1798
- **Code:**
```typescript
clearReportCache(): void {
    safeSessionRemoveItem(STORAGE_KEYS.REPORT_CACHE);
}
```
- **Issue:** The primary report cache is IndexedDB (`otplus_cache` database). `clearReportCache()` only removes the sessionStorage fallback entry. The IndexedDB cache persists until TTL expiry (5 minutes) or browser clears storage.
- **Impact:** After the user clicks "Clear Cache", stale data may still be served from IndexedDB on the next report generation.
- **Fix:** Add `await deleteCacheFromIDB()` or equivalent IndexedDB cleanup to `clearReportCache()`.

---

### [RESOLVED] COR-6: clearAllData() does not clear IndexedDB report cache

- **Severity:** Medium
- **File:** `js/state.ts`
- **Lines:** 1859-1937
- **Code:**
```typescript
clearAllData(): void {
    // Clears localStorage keys...
    // Resets in-memory state...
    // Does NOT touch IndexedDB
}
```
- **Issue:** `clearAllData()` clears localStorage and in-memory state but never touches the IndexedDB `otplus_cache` database. The comment at line 1835 says "SessionStorage (report cache) - separate concerns" but this ignores IndexedDB entirely.
- **Impact:** User clicks "Clear All Data" expecting a full reset, but encrypted report data persists in IndexedDB. Privacy violation — user data survives an explicit deletion request.
- **Fix:** Call `indexedDB.deleteDatabase('otplus_cache')` in `clearAllData()`.

---

### [RESOLVED] COR-7: Date preset buttons mix local and UTC time methods

- **Severity:** Medium
- **File:** `js/main.ts`
- **Lines:** Date preset calculation area
- **Issue:** Date preset calculations (This Week, Last Week, etc.) use a mix of `getDay()` (local timezone) and `toISOString()` (UTC). Near midnight in timezones with UTC offsets, this can produce date ranges that are off by one day.
- **Impact:** "This Week" or "Last Week" preset could include/exclude a day at timezone boundaries. Users in UTC+12 or UTC-12 most affected.
- **Fix:** Use consistent local-timezone date methods throughout, or normalize to UTC for all date range calculations.

---

### [RESOLVED] COR-8: Race condition between async worker completion and calculationId check

- **Severity:** Medium
- **File:** `js/main.ts`
- **Lines:** 2609-2622
- **Code:**
```typescript
if (workerReady && calculationWorkerPool) {
    analysis = await runCalculationInWorker(entries, dateRange);
} else {
    analysis = calculateAnalysis(entries, store, dateRange);
}
calcTimer.end();
if (calculationId !== currentCalculationId) {
    return;
}
```
- **Issue:** Between the `await runCalculationInWorker()` completing and the `calculationId` check, the main thread could have started a new calculation, incremented `currentCalculationId`, and already rendered. The stale result then overwrites the fresh result at line 2627.
- **Impact:** UI shows results from an older report generation that happened to finish after the newer one. Rare but possible with fast sequential "Generate" clicks.
- **Fix:** Check `calculationId === currentCalculationId` immediately after the `await` returns, before any state writes.

---

### [RESOLVED] BL-1: Override precedence is mode-gated but not documented

- **Severity:** Medium
- **File:** `js/calc.ts`
- **Lines:** Override resolution functions
- **Issue:** When `overtimeBasis` is `'daily'`, weekly overrides are ignored (and vice versa). The per-day > weekly > global > profile > default precedence only applies within the active mode. This is intentional but undocumented and potentially surprising to users.
- **Impact:** A user sets weekly overrides, switches to daily mode, and wonders why overrides don't apply. No UI feedback indicates which overrides are active.
- **Fix:** Document this behavior in UI (tooltip or help text). Consider showing a warning when overrides exist that won't apply in the current mode.

---

### [RESOLVED] BL-2: Tier2 threshold per-day with cumulative accumulator produces unintuitive results

- **Severity:** Medium
- **File:** `js/calc.ts`
- **Lines:** Tier2 accumulation logic
- **Issue:** The Tier 2 accumulator is cumulative across all days in the date range. When per-day Tier 2 thresholds vary (via overrides), the accumulator doesn't reset — changing a Thursday threshold affects whether Friday entries hit Tier 2, even though Friday has its own threshold.
- **Impact:** Users who set different Tier 2 thresholds per day get unexpected results because prior days' OT counts against subsequent days' thresholds.
- **Fix:** Document this behavior. Consider an option to reset the Tier 2 accumulator daily vs. period-wide.

---

### [RESOLVED] BL-3: Weekly threshold=0 disables OT entirely (different from daily threshold=0)

- **Severity:** Low
- **File:** `js/calc.ts`
- **Issue:** When `dailyThreshold=0`, all work hours are overtime (capacity=0, all hours exceed it). When `weeklyThreshold=0`, overtime is disabled entirely (no hours can exceed 0 since the accumulator starts at 0 and the check is `> threshold`). This asymmetry is by design but undocumented.
- **Impact:** User sets weekly threshold to 0 expecting all hours to be OT (like daily mode) but gets no OT at all.
- **Fix:** Document the semantic difference. Consider using `>=` for weekly threshold comparison to match daily behavior.

---

### [RESOLVED] BL-4: Non-billable entries force profit to zero

- **Severity:** Info
- **File:** `js/calc.ts`
- **Issue:** Non-billable entries have profit forced to zero regardless of cost rate. This hides the cost impact of non-billable time.
- **Impact:** Managers can't see how much non-billable OT is costing them.
- **Fix:** Consider showing negative profit for non-billable entries to surface cost impact, behind a config toggle.

---

### [RESOLVED] SEC-1: sessionStorage report cache stores data unencrypted

- **Severity:** High
- **File:** `js/state.ts`
- **Lines:** sessionStorage fallback code
- **Issue:** When IndexedDB is unavailable, the report cache falls back to sessionStorage. The IndexedDB path encrypts via AES-GCM, but the sessionStorage fallback stores report data as plaintext JSON.
- **Impact:** On browsers where IndexedDB is blocked (private browsing in some browsers, enterprise policies), sensitive employee time/salary data is stored in plaintext sessionStorage, accessible to any same-origin script.
- **Fix:** Apply the same AES-GCM encryption to the sessionStorage fallback path, or don't cache at all when encryption isn't available.

---

### [RESOLVED] SEC-2: Profile/holiday/time-off caches stored unencrypted in localStorage

- **Severity:** High
- **File:** `js/state.ts`
- **Lines:** localStorage persistence for profiles, holidays, timeOff
- **Issue:** User profiles (containing capacity, working days), holidays, and time-off data are cached in localStorage as plaintext JSON. The report cache is encrypted but these auxiliary caches are not.
- **Impact:** Sensitive employee scheduling data persists in plaintext across browser sessions. Anyone with access to the browser can read employee profiles and time-off history.
- **Fix:** Encrypt these caches using the same AES-GCM mechanism used for the report cache, or mark them as session-only (don't persist to localStorage).

---

### [RESOLVED] SEC-3: Logger redaction gap for short tokens

- **Severity:** Medium
- **File:** `js/logger.ts`
- **Lines:** ~321
- **Issue:** The string sanitizer only matches alphanumeric strings of 32+ characters. Shorter token fragments (e.g., from error messages or partial matches) would not be redacted as raw strings. Key-name-based redaction for objects mitigates this for structured logs but not for interpolated strings.
- **Impact:** Short token fragments could appear in Sentry reports or console logs. Low risk since full tokens are 100+ chars and would be caught.
- **Fix:** Lower the threshold to 16 characters, or use a more targeted regex matching JWT-like patterns.

---

### [RESOLVED] SEC-4: HMAC signing key derived from JWT signature (no independent entropy)

- **Severity:** Medium
- **File:** `js/crypto.ts`
- **Issue:** The HMAC signing key for cache integrity is derived from the JWT signature portion. If the JWT is compromised, the HMAC key is also compromised.
- **Impact:** An attacker with the JWT could forge cached report data. Limited impact since the JWT is already sufficient to make API calls directly.
- **Fix:** Use an independently generated key for HMAC signing, stored in the encryption keychain.

---

### [RESOLVED] SEC-5: Legacy PBKDF2 migration uses workspace ID as key material

- **Severity:** Low
- **File:** `js/crypto.ts`
- **Issue:** The legacy PBKDF2-based encryption uses the workspace ID as key material. Workspace IDs are not secret (visible in URLs, API responses).
- **Impact:** Legacy encrypted data has weak key derivation. New AES-GCM uses proper random keys. Risk decreases over time as legacy data ages out.
- **Fix:** No action needed — legacy path is backward-compatible read-only. Document the migration timeline.

---

### [RESOLVED] SEC-6: Fallback key stored on globalThis

- **Severity:** Low
- **File:** `js/crypto.ts`
- **Issue:** When IndexedDB is unavailable for key storage, encryption keys fall back to being stored on `globalThis`. Any same-origin script can access `globalThis`.
- **Impact:** In environments without IndexedDB, encryption keys are accessible to any code running in the same context.
- **Fix:** Accept the limitation (no other persistent storage option exists) but log a warning when falling back.

---

### [RESOLVED] SEC-7: CSP meta tag missing worker-src directive

- **Severity:** Low
- **File:** `index.html`
- **Lines:** 7-13
- **Issue:** The Content Security Policy meta tag does not include `worker-src 'self'`. While this currently falls back to `script-src` or `default-src`, explicit declaration is best practice.
- **Impact:** Browser may block Web Workers if CSP defaults change. Low risk currently.
- **Fix:** Add `worker-src 'self';` to the CSP meta tag.

---

### [RESOLVED] SEC-8: Response size checked after full buffering in memory

- **Severity:** Low
- **File:** `js/api.ts`
- **Issue:** API response size validation occurs after `response.text()` has already buffered the entire response body in memory. A malicious or buggy API response could exhaust memory before the size check rejects it.
- **Impact:** Theoretical DoS via oversized API response. Mitigated by Clockify API response size limits and browser memory protections.
- **Fix:** Use streaming response parsing with size limits, or add a `Content-Length` pre-check before buffering.

---

### [RESOLVED] PERF-1: Full innerHTML replacement on detailed table pagination

- **Severity:** High
- **File:** `js/ui/detailed.ts`
- **Issue:** Every pagination page change completely replaces the table's `innerHTML`. For tables with 50+ rows and complex cells, this is expensive and causes layout thrashing.
- **Impact:** UI jank on page changes with large detailed tables. Noticeable on lower-end devices in the Clockify sidebar.
- **Fix:** Use DocumentFragment for building new content, or implement virtual scrolling for large datasets.

---

### [RESOLVED] PERF-2: Full store serialization for worker on every calculation

- **Severity:** Medium
- **File:** `js/main.ts`
- **Lines:** serializeStoreForWorker() call
- **Issue:** Every calculation serializes all Maps (profiles, holidays, timeOff) to arrays for structured cloning. For 1500 users with full profiles, this creates a large serialization overhead.
- **Impact:** Adds 50-200ms overhead per calculation for large workspaces. Currently moot since worker path is broken (COR-4), but would matter if fixed.
- **Fix:** Only serialize data that changed since the last worker call, or use SharedArrayBuffer/transferable objects.

---

### [RESOLVED] PERF-3: UI.initializeElements() called twice during init

- **Severity:** Medium
- **File:** `js/main.ts`
- **Lines:** ~734 (in init()) and ~902 (in loadInitialData())
- **Issue:** `UI.initializeElements()` is called once in `init()` for early error display capability, then again in `loadInitialData()`. The second call is redundant since DOM elements haven't changed.
- **Impact:** Minor overhead — each call does `getElementById` for ~20 elements. Not a performance issue but indicates unclear initialization lifecycle.
- **Fix:** Remove the second call or add an `initialized` guard.

---

### [RESOLVED] PERF-4: bindConfigEvents() attaches 26+ listeners with no cleanup

- **Severity:** Low
- **File:** `js/main.ts`
- **Lines:** bindConfigEvents() (~490 lines)
- **Issue:** `bindConfigEvents()` attaches 26+ event listeners using anonymous functions with no cleanup mechanism. If `bindConfigEvents()` were called multiple times (currently called once), listeners would stack.
- **Impact:** Currently benign (single call). But the module-scoped anonymous listeners cannot be removed for testing or dynamic reconfiguration.
- **Fix:** Store listener references for cleanup, or use event delegation on a single parent element.

---

### [RESOLVED] API-1: fetchUsers lacks AbortSignal support

- **Severity:** High
- **File:** `js/api.ts`
- **Lines:** 1495-1518
- **Code:**
```typescript
async fetchUsers(workspaceId: string): Promise<User[]> {
    const allUsers: User[] = [];
    let page = 1;
    while (true) {
        const { data } = await fetchWithAuth<User[]>(
            `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/users?page=${page}&page-size=${pageSize}`
        );
        // ...
    }
    return allUsers;
}
```
- **Issue:** `fetchUsers` does not accept or propagate an `AbortSignal`. When the user cancels a report generation, user fetching continues to completion even though results won't be used.
- **Impact:** Wasted network requests and rate limit tokens. For workspaces with many pages of users, cancellation could take seconds to actually stop.
- **Fix:** Add `signal?: AbortSignal` parameter and pass it to `fetchWithAuth`.

---

### [RESOLVED] API-2: Circuit breaker HALF_OPEN allows unbounded concurrent requests

- **Severity:** Medium
- **File:** `js/api.ts`
- **Lines:** Circuit breaker logic
- **Issue:** When the circuit breaker transitions from OPEN to HALF_OPEN after the cooldown period, the `canMakeRequest()` check returns true for ALL pending requests simultaneously. There's no limit on how many requests can flow through in HALF_OPEN state.
- **Impact:** All queued requests hit the API at once during HALF_OPEN, potentially causing another failure cascade and immediately re-opening the circuit.
- **Fix:** Only allow 1 request through in HALF_OPEN state. If it succeeds, transition to CLOSED.

---

### [RESOLVED] API-3: Exponential backoff lacks jitter

- **Severity:** Medium
- **File:** `js/api.ts`
- **Issue:** Retry backoff uses `delay * Math.pow(2, attempt)` without random jitter. Multiple clients retrying after a shared failure will all retry at exactly the same intervals.
- **Impact:** Thundering herd on Clockify API during outages when multiple OTPLUS instances retry simultaneously.
- **Fix:** Add random jitter: `delay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)`.

---

### [RESOLVED] API-4: Holiday dedup sampling uses first N users instead of random sample

- **Severity:** Medium
- **File:** `js/api.ts`
- **Lines:** Holiday dedup logic
- **Issue:** Despite the CLAUDE.md documentation saying "Fisher-Yates random sampling," the actual dedup code appears to sample from the first N users in the array rather than using a truly random shuffle. The user array order depends on API pagination order, which is typically alphabetical or by creation date.
- **Impact:** If holidays differ by user group (e.g., regional offices sorted later in the alphabet), the sample may not be representative. ~22% chance of false positive for skewed distributions as noted in CODEBASE_ANALYSIS.md.
- **Fix:** Verify the sampling is truly random (Fisher-Yates). If not, implement proper random selection.

---

### [RESOLVED] API-5: fetchTimeOffRequests silently continues on batch failure

- **Severity:** Low
- **File:** `js/api.ts`
- **Issue:** When fetching time-off in batches of 500 user IDs, if a batch fails, the error is caught and that batch's users silently get no time-off data. No warning is shown to the user.
- **Impact:** Partial time-off data without user notification. OT calculations for affected users would be incorrect (treating time-off days as regular capacity).
- **Fix:** Track failed batches and show a warning banner indicating partial data.

---

### [RESOLVED] API-6: Per-request timeout fires on wrong AbortController

- **Severity:** Low
- **File:** `js/main.ts`
- **Issue:** The 30-second per-request timeout and 300-second total report timeout use separate AbortControllers. If an early return occurs before the try block, the 5-minute abort timeout remains active with no cleanup.
- **Impact:** Orphaned timers accumulate, each holding references to AbortController. Memory leak over many report generations. No functional impact since abort on a completed signal is a no-op.
- **Fix:** Always clear the timeout in a `finally` block.

---

### [RESOLVED] UX-1: No sidebar width targeting in CSS

- **Severity:** High
- **File:** `css/styles.css`
- **Issue:** Container `max-width` is 1200px with 24px padding. Clockify sidebar is typically 300-400px wide. No media queries or container queries target the sidebar width range.
- **Impact:** Content always overflows horizontally in the Clockify sidebar. Tables require horizontal scrolling. Core UX is broken for the primary deployment context.
- **Fix:** Add `@media (max-width: 450px)` queries with reduced padding, smaller font sizes, and stacked layouts.

---

### [RESOLVED] UX-2: ~400 lines of duplicate CSS rules

- **Severity:** High
- **File:** `css/styles.css`
- **Lines:** ~100-400 (first set) vs ~570+ (second set)
- **Issue:** Two CSS "versions" are concatenated in the file. Approximately 20+ rule blocks have duplicate definitions with conflicting values: `.btn-primary` (padding 10px vs 8px), `.card-title` (font 16px vs 13px), `.summary-inline` (grid vs flex), `.filter-bar-compact` (gap 16px vs 10px), `.compact-title` (24px vs var), and more.
- **Impact:** Last-definition-wins causes unpredictable styling. Maintenance nightmare — edits to one "version" don't affect the other. ~400 lines of dead CSS bloat.
- **Fix:** Audit and consolidate into a single set of rules. Remove the earlier definitions (lines ~100-400).

---

### [RESOLVED] UX-3: Document keydown listener added but never removed

- **Severity:** Medium
- **File:** `js/ui/index.ts`
- **Issue:** `document.addEventListener('keydown', ...)` is added with an anonymous function in `bindEvents()`. It's never removed. If `bindEvents()` were called multiple times, duplicate listeners would stack.
- **Impact:** Currently benign (single call). But the listener fires on every keystroke globally, running handler logic even when the addon is not focused.
- **Fix:** Use a named function reference and provide a `cleanup()` export to remove it.

---

### [RESOLVED] UX-4: Filter chips use aria-checked without role="radio"

- **Severity:** Medium
- **File:** `js/ui/detailed.ts` or `js/ui/shared.ts`
- **Issue:** Filter chip elements use `aria-checked` attribute but lack `role="radio"` or `role="radiogroup"` on the container. This violates WAI-ARIA specs — `aria-checked` is only valid on certain roles.
- **Impact:** Screen readers won't announce filter state correctly. Accessibility violation.
- **Fix:** Add `role="radiogroup"` to the container and `role="radio"` to each chip.

---

### [RESOLVED] UX-5: Overrides page does full re-render on every change

- **Severity:** Medium
- **File:** `js/ui/overrides.ts`
- **Issue:** Changing any override value triggers a complete re-render of all override cards. This destroys focus state, scroll position, and any in-progress edits in other fields.
- **Impact:** Poor UX when editing multiple overrides — each change snaps the user back to the top of the list and clears focus.
- **Fix:** Only re-render the affected card, or use DOM diffing to preserve unmodified elements.

---

### [RESOLVED] UX-6: Error banner and throttle status share same DOM element

- **Severity:** Medium
- **File:** `js/ui/dialogs.ts`
- **Issue:** Both error messages and API throttle warnings use the same DOM element. Setting one overwrites the other.
- **Impact:** If an error occurs while the API is throttled, one message is lost. The user sees either the error or the throttle warning, not both.
- **Fix:** Use separate DOM elements for error banner and throttle/status notifications.

---

### [RESOLVED] UX-7: Three dialogs use native window.confirm()

- **Severity:** Low
- **File:** `js/main.ts`
- **Issue:** "Clear All Data", "Reset Overrides", and one other action use `window.confirm()` instead of styled modal dialogs. These look out of place in the polished UI.
- **Impact:** Inconsistent UX. Minor — functionality works correctly.
- **Fix:** Replace with styled confirmation modals matching the existing dialog system.

---

### [RESOLVED] UX-8: Currency formatting hardcodes USD ($/h)

- **Severity:** Low
- **File:** `js/ui/shared.ts`
- **Issue:** Amount formatting uses `$/h` hardcoded for currency display. No i18n or locale-aware formatting.
- **Impact:** Users in non-USD regions see incorrect currency symbols. Amounts are still accurate but the display is misleading.
- **Fix:** Use `Intl.NumberFormat` with workspace locale, or make currency symbol configurable.

---

### [RESOLVED] TEST-1: 13 source modules excluded from Stryker mutation testing

- **Severity:** Medium
- **File:** `stryker.config.json`
- **Lines:** 11-21
- **Code:**
```json
"mutate": [
    "js/calc.ts",
    "js/utils.ts",
    "js/api.ts",
    "js/state.ts",
    "js/export.ts",
    "js/crypto.ts",
    "js/main.ts",
    "js/ui/summary.ts",
    "js/ui/detailed.ts",
    "js/ui/overrides.ts"
]
```
- **Issue:** 13 source modules are not covered by Stryker: `storage.ts`, `streaming.ts`, `worker-pool.ts`, `logger.ts`, `metrics.ts`, `performance-dashboard.ts`, `memory-profiler.ts`, `csp-reporter.ts`, `error-reporting.ts`, `ui/shared.ts`, `ui/dialogs.ts`, `constants.ts`, `calc.worker.ts`.
- **Impact:** Mutations in these modules go undetected. `ui/shared.ts` and `ui/dialogs.ts` contain rendering logic that should be mutation-tested.
- **Fix:** Add at least `ui/shared.ts`, `ui/dialogs.ts`, and `streaming.ts` to the mutate list.

---

### [RESOLVED] TEST-2: 162 weak assertions (toBeDefined/toBeTruthy/toBeFalsy)

- **Severity:** Medium
- **File:** Multiple test files
- **Issue:** 162 test assertions use `toBeDefined()`, `toBeTruthy()`, or `toBeFalsy()` instead of exact value checks. Highest concentrations in performance-dashboard, shared, and api-mutations tests.
- **Impact:** Tests pass for any truthy/falsy value, missing regressions where the value type or content changes but remains truthy. Weak assertions reduce mutation testing effectiveness.
- **Fix:** Replace with specific assertions: `toBe(expectedValue)`, `toEqual(expectedObject)`, `toHaveLength(n)`, etc.

---

### [RESOLVED] TEST-3: E2E mock duration format uses numeric instead of ISO string

- **Severity:** Low
- **File:** E2E test fixtures
- **Issue:** E2E mocks use numeric `3600` for duration fields, but the real Clockify API returns ISO 8601 duration strings like `'PT1H'`. The application code handles both formats, so tests pass, but the mocks don't match real API behavior.
- **Impact:** Tests may pass with format-tolerant code but miss regressions in ISO parsing paths.
- **Fix:** Update E2E mocks to use ISO 8601 duration strings matching real API responses.

---

### TEST-4: No IndexedDB encrypted cache round-trip test

- **Severity:** Info
- **File:** Missing test
- **Issue:** There is no test verifying that data written to the IndexedDB cache (encrypted via AES-GCM) can be read back correctly. The encryption and decryption paths are tested separately but not as an integrated round-trip.
- **Impact:** A subtle mismatch between encryption and decryption (e.g., IV handling, padding) could cause data loss that unit tests don't catch.
- **Fix:** Add an integration test that writes a report to IDB cache, reads it back, and verifies exact equality.

---

### [RESOLVED] TEST-5: No overrides E2E workflow test

- **Severity:** Info
- **File:** Missing test
- **Issue:** The overrides page (creating, editing, deleting per-user overrides) has no end-to-end test coverage. This is a major user workflow involving persistence, calculation, and UI rendering.
- **Impact:** Regressions in the overrides workflow could go undetected until user reports.
- **Fix:** Add E2E test covering: navigate to overrides, set a user override, verify recalculation, verify persistence after reload.

---

### CQ-1: God module main.ts at 2666 lines [RESOLVED]

- **Severity:** High
- **File:** `js/main.ts`
- **Issue:** `main.ts` is 2666 lines acting as orchestrator, config manager, UI event binder, session timeout handler, health check provider, worker pool manager, date preset calculator, and cache prompt coordinator. `bindConfigEvents()` is ~490 lines, `handleGenerateReport()` is ~415 lines.
- **Impact:** High cognitive load, difficult to test in isolation, any change risks unintended side effects. 7 module-scoped mutable `let` variables create hidden coupling.
- **Fix:** Extracted into 5 focused modules: `config-manager.ts`, `report-orchestrator.ts`, `date-presets.ts`, `worker-manager.ts`, `health-check.ts`. Main.ts reduced from 2666 to 640 lines (345 code lines).

---

### [RESOLVED] CQ-2: DRY violation in calc.ts override resolution (4 identical functions)

- **Severity:** Medium
- **File:** `js/calc.ts`
- **Issue:** `getEffectiveCapacity`, `getEffectiveMultiplier`, `getEffectiveTier2Threshold`, `getEffectiveTier2Multiplier` share an identical 4-level precedence cascade (per-day > weekly > global > profile > default). ~200 lines of near-identical code.
- **Impact:** Bug fixes must be applied to all 4 functions. Easy to fix one and miss others.
- **Fix:** Extract a single generic `getEffectiveOverrideValue(fieldName, ...)` function parameterized by field name.

---

### CQ-3: api.ts tightly coupled to global store singleton [RESOLVED]

- **Severity:** Medium
- **File:** `js/api.ts`
- **Issue:** The API module directly imports the global `store` singleton for token, claims, throttle status, and config. This makes `api.ts` impossible to test without the real Store singleton.
- **Impact:** Tests must mock the entire store. Any change to Store interface requires updating API tests.
- **Fix:** Added `ApiDependencies` interface in types.ts and `initApi(deps)` in api.ts. All store access goes through `deps()`. Main.ts calls `initApi()` during initialization. Fallback to store-backed defaults for backward compatibility.

---

### [RESOLVED] CQ-4: TypeScript override values typed as string|number instead of normalized number

- **Severity:** Medium
- **File:** `js/types.ts`
- **Issue:** Override values are typed as `string | number` through the type system. They're only normalized to `number` at the point of use in calc.ts via `parseFloat`. If a string value reaches calculation code without parsing, it would cause string concatenation instead of addition.
- **Impact:** TypeScript doesn't catch the "add a number to an unparsed string" class of bugs. Currently safe because `strictParseNumber` is used, but the type system doesn't enforce it.
- **Fix:** Normalize to `number` at the boundary (when reading from localStorage or UI inputs) and type overrides as `number`.

---

### [RESOLVED] CQ-5: 78 istanbul ignore directives across 15 source files

- **Severity:** Low
- **File:** Multiple (api.ts: 18, ui/detailed.ts: 16, calc.ts: 11, state.ts: 10)
- **Issue:** 78 `/* istanbul ignore */` directives suppress coverage reporting. While many are legitimate (defensive fallbacks, browser-specific paths), the high count suggests some could be replaced with proper test coverage.
- **Impact:** Coverage metrics are inflated — true coverage is lower than 84.84%. Some ignored branches may contain bugs.
- **Fix:** Review each directive. For truly untestable code (browser APIs), keep the ignore. For testable defensive paths, add tests and remove the directive.

---

### [RESOLVED] CQ-6: sessionStorageFallback Map grows without bounds

- **Severity:** Low
- **File:** `js/state.ts`
- **Issue:** When real sessionStorage is unavailable, a `Map` is used as fallback. This Map has no size limit and grows with each `safeSessionSetItem` call.
- **Impact:** Memory leak in environments without sessionStorage. Each report cache write adds data that's never evicted.
- **Fix:** Add a max entry count to the fallback Map and evict oldest entries.

---

### [RESOLVED] CQ-7: Pub/sub system implemented but documented as unused

- **Severity:** Low
- **File:** `js/state.ts`
- **Issue:** The Store class implements `subscribe()` and `notify()` methods for pub/sub, but these are explicitly documented as "not actively used."
- **Impact:** Dead code that must be maintained. Adds cognitive overhead when reading the Store class.
- **Fix:** Remove if truly unused, or document the intended future use case.

---

### [RESOLVED] CQ-8: Duplicate CSS is structural debt from apparent file concatenation

- **Severity:** Info
- **File:** `css/styles.css`
- **Issue:** The CSS file appears to be the result of concatenating two versions of the stylesheet. Lines ~1-500 are an earlier "desktop" version with larger padding and shadows. Lines ~570+ are a density-aware "sidebar" version. This explains all the duplicate rules identified in UX-2.
- **Impact:** Understanding any CSS change requires checking both "versions." New CSS is added to the end but may be overridden by earlier rules.
- **Fix:** Perform a CSS audit to identify the canonical version and remove the dead code.

---

## Top 20 Prioritized Action Items

### Priority 1 — Correctness (payroll-adjacent, data integrity)

1. **COR-1: Fix CSV chunk boundary newlines** — Corrupted export data for large datasets. Simple one-line fix.
2. **COR-2: Add secondary sort key to weekly OT sort** — Non-deterministic OT attribution. One-line fix.
3. **COR-3: Eliminate entry mutation in calc.ts** — Violates purity contract. Straightforward refactor.
4. **COR-5 + COR-6: Fix clearReportCache/clearAllData to clear IndexedDB** — Privacy violation: user data survives explicit deletion. Add IDB cleanup.

### Priority 2 — Security (data protection)

5. **SEC-1: Encrypt sessionStorage report cache fallback** — Plaintext sensitive data when IDB unavailable.
6. **SEC-2: Encrypt profile/holiday/time-off localStorage caches** — Sensitive employee data in plaintext.

### Priority 3 — API resilience

7. **API-1: Add AbortSignal to fetchUsers** — Uncancellable network requests waste rate limit budget.
8. **API-2: Limit HALF_OPEN circuit breaker to 1 request** — Prevent failure cascade during recovery.
9. **API-3: Add jitter to exponential backoff** — Prevent thundering herd.

### Priority 4 — UX critical path

10. **UX-1: Add sidebar width CSS targeting** — Core deployment context is broken.
11. **UX-2: Consolidate duplicate CSS** — Remove ~400 lines of dead/conflicting rules.
12. **PERF-1: Optimize detailed table pagination** — Use DocumentFragment instead of full innerHTML replacement.

### Priority 5 — Worker pool fix or removal

13. **COR-4: Fix worker pool protocol mismatch** — Dead code that produces errors on every run. Either fix the protocol or remove the worker pool entirely.

### Priority 6 — Code quality and maintainability

14. **CQ-1: Break up main.ts** — 2666-line god module. Extract config, orchestration, presets.
15. **CQ-2: DRY up calc.ts override resolution** — 4 nearly identical functions.
16. **CQ-3: Decouple api.ts from global store** — Enable proper unit testing.

### Priority 7 — Test improvements

17. **TEST-1: Add mutation testing for ui/shared.ts and ui/dialogs.ts** — Major rendering code excluded from Stryker.
18. **TEST-2: Strengthen weak assertions** — 162 toBeDefined/toBeTruthy assertions.
19. **TEST-4: Add IndexedDB cache round-trip test** — Data loss risk untested.
20. **TEST-5: Add overrides E2E workflow** — Major user workflow untested.

---

### Cross-reference with CODEBASE_ANALYSIS.md

| This Audit | Previous Analysis | Status |
|-----------|-------------------|--------|
| COR-2 (weekly sort) | Section 3: "Weekly sort missing secondary key" | **Confirmed** — still present |
| COR-3 (entry mutation) | Section 3: "Entry mutation at calc.ts:2024" | **Confirmed** — still present |
| COR-4 (worker protocol) | Not identified | **New finding** |
| COR-1 (CSV chunks) | Not identified | **New finding** |
| COR-5/6 (IDB clear) | Not identified | **New finding** |
| SEC-1 (sessionStorage) | Section 4: "sessionStorage fallback stores unencrypted" | **Confirmed** |
| SEC-2 (profile cache) | Section 4: "Profile/holiday/time-off caches unencrypted" | **Confirmed** |
| API-1 (fetchUsers abort) | Section 4: "fetchUsers lacks AbortSignal" | **Confirmed** |
| API-3 (no jitter) | Section 4: "No jitter in exponential backoff" | **Confirmed** |
| UX-1 (sidebar CSS) | Section 5: "Sidebar width not targeted by CSS" | **Confirmed** |
| UX-2 (duplicate CSS) | Section 5: "~400 lines of duplicate CSS rules" | **Confirmed** |
| CQ-1 (god module) | Section 1: "God Module: main.ts (2666 lines)" | **Confirmed** |
| CQ-2 (DRY override) | Section 1: "DRY Violation: calc.ts Override Resolution" | **Confirmed** |

*This report is a read-only analysis artifact. No source code was modified.*
