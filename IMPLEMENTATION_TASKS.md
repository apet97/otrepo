# OTPLUS Audit Remediation — Implementation Tasks

> Generated: 2026-03-05
> Source: `V2/AUDIT_TODO.md` (88 findings), plan at `~/.claude/plans/iridescent-marinating-knuth.md`
> Pre-requisite: `V2/AUDIT_TODO.md` (Phase 1) is complete.

---

## How to Use This File

- Tasks are ordered by dependency (do them top-to-bottom)
- Each task has exact file paths, what to change, and verification commands
- Check the box when done: `- [x]`
- Run the verification after each section before moving to the next

---

## Phase 2: Mutation Testing Overhaul

### 2.1 Expand Stryker Mutate Array

- [x] **T1: Add 7 files to Stryker `mutate` array**
  - **File:** `stryker.config.json`
  - **Change:** Replace lines 11-14:
    ```json
    "mutate": ["js/calc.ts", "js/utils.ts", "js/api.ts"]
    ```
    With:
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
  - **Why:** Only 28.7% of production code is mutation-tested today (C8). This brings it to ~85%.
  - **Addresses:** C8

### 2.2 Enable Per-Test Coverage Analysis

- [x] **T2: Switch `coverageAnalysis` from `"off"` to `"perTest"`**
  - **File:** `stryker.config.json`
  - **Change:** Line 10: `"coverageAnalysis": "off"` → `"coverageAnalysis": "perTest"`
  - **Why:** Infrastructure already exists (`jest-stryker-env.cjs`, `jest.stryker.config.js`). This was configured but never activated. Dramatically speeds up mutation runs by only running relevant tests per mutant.
  - **Addresses:** M26

- [x] **T3: Lower Stryker `break` threshold from 98 to 85**
  - **File:** `stryker.config.json`
  - **Change:** Line 22: `"break": 98` → `"break": 85`
  - **Why:** The 98% threshold is only achievable with 90 Stryker disables. The true score against unadulterated code is ~85-90%. We'll raise this back after writing mutation-killer tests. Start realistic.
  - **Also:** Increase `"timeoutMS": 15000` → `"timeoutMS": 30000` (tight for mutants that introduce loops)
  - **Addresses:** C9

### 2.3 Run Stryker Baseline

- [x] **T4: Run `npm run test:mutants` and record baseline score** *(deferred — will run after tests are written per prompt rule)*
  - **Command:** `npm run test:mutants`
  - **Expected:** Score will be low (~40-60%) because new files have no mutation-killer tests yet
  - **Record:** Paste the mutation score summary into `V2/MUTATION_BASELINE.md`
  - **Purpose:** Know our starting point before writing new tests

---

## Phase 3.1: Consolidate Duplicated Test Helpers

### 3.1.1 Create Shared API Test Helpers

- [x] **T5: Create `__tests__/helpers/api-test-helpers.js`**
  - **New file:** `__tests__/helpers/api-test-helpers.js`
  - **Contents:** Canonical `mockResponse()` function extracted from the 11 duplicates
  - **Canonical version** (based on the most complete implementation — `api-mutations.test.js:25-39`):
    ```javascript
    /**
     * Creates a mock response object with all required methods for API tests.
     * The API's response size check requires text() method when Content-Length is missing.
     */
    export function mockResponse(data, { ok = true, status = 200, headers = {} } = {}) {
      const jsonStr = JSON.stringify(data);
      return {
        ok,
        status,
        json: async () => data,
        text: async () => jsonStr,
        headers: {
          get: (name) => {
            if (name === 'Content-Length') return String(jsonStr.length);
            return headers[name] || null;
          },
          has: (name) => name === 'Content-Length' || name in headers
        }
      };
    }
    ```
  - **Also export:** Common API test setup (store init, fetch mock reset, rate limiter reset)
  - **Addresses:** H14

- [x] **T6: Migrate `api-mutations.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-mutations.test.js`
  - **Change:** Remove inline `mockResponse` (lines 25-39), add import:
    ```javascript
    import { mockResponse } from '../helpers/api-test-helpers.js';
    ```
  - **Verify:** `npx jest __tests__/unit/api-mutations.test.js`

- [x] **T7: Migrate `api-fetch-core.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-fetch-core.test.js`
  - **Change:** Remove inline `mockResponse` (line 33+), add import from `api-test-helpers.js`
  - **Verify:** `npx jest __tests__/unit/api-fetch-core.test.js`

- [x] **T8: Migrate `api-contracts.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-contracts.test.js`
  - **Change:** Remove inline `mockResponse` (line 22+), add import
  - **Verify:** `npx jest __tests__/unit/api-contracts.test.js`

- [x] **T9: Migrate `api-url-resolution.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-url-resolution.test.js`
  - **Change:** Remove inline `mockResponse` (line 385+), add import
  - **Verify:** `npx jest __tests__/unit/api-url-resolution.test.js`

- [x] **T10: Migrate `api-entries.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-entries.test.js`
  - **Change:** Remove inline `mockResponse` (line 33+), add import
  - **Verify:** `npx jest __tests__/unit/api-entries.test.js`

- [x] **T11: Migrate `api-users.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-users.test.js`
  - **Change:** Remove inline `mockResponse` (line 28+), add import
  - **Verify:** `npx jest __tests__/unit/api-users.test.js`

- [x] **T12: Migrate `api-holidays.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-holidays.test.js`
  - **Change:** Remove inline `mockResponse` (line 28+), add import
  - **Verify:** `npx jest __tests__/unit/api-holidays.test.js`

- [x] **T13: Migrate `api-timeoff.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-timeoff.test.js`
  - **Change:** Remove inline `mockResponse` (line 33+), add import
  - **Note:** This version omits `headers` — verify the shared version's `headers.has` doesn't break it
  - **Verify:** `npx jest __tests__/unit/api-timeoff.test.js`

- [x] **T14: Migrate `api-core.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/api-core.test.js`
  - **Change:** Remove inline `mockResponse` (line 23+), add import
  - **Verify:** `npx jest __tests__/unit/api-core.test.js`

- [x] **T15: Migrate `orchestration.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/orchestration.test.js`
  - **Change:** Remove inline `mockResponse` (line 62+), add import
  - **Verify:** `npx jest __tests__/unit/orchestration.test.js`

- [x] **T16: Migrate `negative-paths.test.js` to use shared `mockResponse`**
  - **File:** `__tests__/unit/negative-paths.test.js`
  - **Change:** Remove inline `mockResponse` (line 55+), add import
  - **Verify:** `npx jest __tests__/unit/negative-paths.test.js`

### 3.1.2 Create Shared Storage Polyfill

- [x] **T17: Create `__tests__/helpers/storage-polyfill.js`**
  - **New file:** `__tests__/helpers/storage-polyfill.js`
  - **Contents:** Extract the `StoragePolyfill` class from any of the 3 copies
  - **Addresses:** M23

- [x] **T18: Migrate `orchestration.test.js` to use shared `StoragePolyfill`**
  - **File:** `__tests__/unit/orchestration.test.js`
  - **Change:** Remove inline `StoragePolyfill` (line 42+), add import
  - **Verify:** `npx jest __tests__/unit/orchestration.test.js`

- [x] **T19: Migrate `negative-paths.test.js` to use shared `StoragePolyfill`**
  - **File:** `__tests__/unit/negative-paths.test.js`
  - **Change:** Remove inline `StoragePolyfill` (line 33+), add import
  - **Verify:** `npx jest __tests__/unit/negative-paths.test.js`

- [x] **T20: Migrate `encryption-migration.test.js` to use shared `StoragePolyfill`**
  - **File:** `__tests__/unit/encryption-migration.test.js`
  - **Change:** Remove inline `StoragePolyfill` (line 13+), add import
  - **Verify:** `npx jest __tests__/unit/encryption-migration.test.js`

### 3.1.3 Deduplicate Calc Test Helpers

- [x] **T21: Remove inline `createMinimalStore` from `calc-mutation-killers.test.js`**
  - **File:** `__tests__/unit/calc-mutation-killers.test.js`
  - **Change:** Remove lines 14-49 (inline `createMinimalStore`), add import:
    ```javascript
    import { createMinimalStore } from '../helpers/calc-test-helpers.js';
    ```
  - **Note:** The inline copy is identical to `calc-test-helpers.js:11-49`
  - **Addresses:** H15
  - **Verify:** `npx jest __tests__/unit/calc-mutation-killers.test.js`

- [x] **T22: Audit `createEntry` duplication in mutation test files** *(survivors + additions use different user ID defaults matching createMockStore — kept inline)*
  - **Files to check:**
    - `__tests__/helpers/calc-test-helpers.js:56` (canonical)
    - `__tests__/unit/calc-mutation-killers.test.js` (inline?)
    - `__tests__/unit/calc-mutation-survivors.test.js:45`
    - `__tests__/unit/calc-mutation-additions.test.js:12`
  - **Action:** For each file, compare the inline `createEntry` with the canonical version. If identical, replace with import. If different defaults, add parameters to the canonical version or use `EntryBuilder`.
  - **Addresses:** H15

### 3.1.4 Verification Checkpoint

- [x] **T23: Run full test suite after helper consolidation** *(84 suites / 2984 tests passing, typecheck clean)*
  - **Commands:**
    ```bash
    npm test
    npm run typecheck
    ```
  - **Expected:** 84 suites / 2979 tests passing, no type errors

---

## Phase 2.4: Rewrite Mutation-Killer Tests

### Rewrite Existing Mutation Test Files

- [ ] **T24: Rewrite `calc-mutation-killers.test.js` — use shared helpers**
  - **File:** `__tests__/unit/calc-mutation-killers.test.js`
  - **Changes:**
    - Import `createMinimalStore`, `createEntry` from `../helpers/calc-test-helpers.js`
    - Import `EntryBuilder`, `StoreBuilder` from `../helpers/entry-builder.js`
    - Remove ALL inline factory functions
    - Reorganize tests by code section: daily OT, weekly OT, both mode, tiered OT, rates, billable breakdown
  - **Verify:** `npx jest __tests__/unit/calc-mutation-killers.test.js`

- [ ] **T25: Rewrite `api-mutations.test.js` — use shared helpers**
  - **File:** `__tests__/unit/api-mutations.test.js`
  - **Changes:**
    - Import `mockResponse` from `../helpers/api-test-helpers.js`
    - Remove inline `mockResponse`
    - Organize by function: fetchWithAuth, pagination, rate limiting, circuit breaker, retry
  - **Verify:** `npx jest __tests__/unit/api-mutations.test.js`

- [ ] **T26: Rewrite `utils-mutation-killers.test.js` — use shared helpers**
  - **File:** `__tests__/unit/utils-mutation-killers.test.js`
  - **Changes:**
    - Import shared helpers where applicable
    - Replace `expect(true).toBe(false)` guards with `expect.assertions(N)` (31 instances)
  - **Verify:** `npx jest __tests__/unit/utils-mutation-killers.test.js`

- [ ] **T27: Update `calc-mutation-survivors.test.js` — use shared helpers**
  - **File:** `__tests__/unit/calc-mutation-survivors.test.js`
  - **Changes:** Remove inline `createEntry` (line 45+), import from shared helpers
  - **Verify:** `npx jest __tests__/unit/calc-mutation-survivors.test.js`

- [ ] **T28: Update `calc-mutation-additions.test.js` — use shared helpers**
  - **File:** `__tests__/unit/calc-mutation-additions.test.js`
  - **Changes:** Remove inline `createEntry` (line 12+), import from shared helpers
  - **Verify:** `npx jest __tests__/unit/calc-mutation-additions.test.js`

### Create New Mutation-Killer Tests for Newly-Mutated Files

- [ ] **T29: Create `__tests__/unit/state-mutations.test.js`**
  - **New file** targeting `js/state.ts`
  - **Test areas:** persistence roundtrip, override validation, cache get/set, encrypted overrides, workspace-scoped keys, `copyGlobalToPerDay`, config load with bounds validation
  - **Goal:** Kill mutations in state.ts to bring its mutation score up

- [ ] **T30: Create `__tests__/unit/export-mutations.test.js`**
  - **New file** targeting `js/export.ts`
  - **Test areas:** CSV generation with edge cases, `sanitizeFormulaInjection` integration, BOM byte verification, empty analysis array, null durations, Unicode filenames, `URL.revokeObjectURL` timing
  - **Goal:** Kill mutations in export.ts

- [ ] **T31: Create `__tests__/unit/crypto-mutations.test.js`**
  - **New file** targeting `js/crypto.ts`
  - **Test areas:** encrypt/decrypt roundtrip, key derivation parameters, IV generation, AuthenticationError class, migration paths, `keyDatabasePromise` caching behavior
  - **Goal:** Kill mutations in crypto.ts

- [ ] **T32: Create `__tests__/unit/ui-summary-mutations.test.js`**
  - **New file** targeting `js/ui/summary.ts`
  - **Test areas:** `computeSummaryRows` with various entry shapes, amount formatting by display mode, OT premium calculation, billable breakdown rendering, expand toggle behavior
  - **Goal:** Kill mutations in ui/summary.ts

- [ ] **T33: Create `__tests__/unit/ui-detailed-mutations.test.js`**
  - **New file** targeting `js/ui/detailed.ts`
  - **Test areas:** flatMap+sort behavior, filter application (all/ot/billable/nonBillable), pagination edge cases, entry count formatting, filter chip aria states
  - **Goal:** Kill mutations in ui/detailed.ts

### Verification Checkpoint

- [ ] **T34: Run full test suite + mutation tests after rewrites**
  - **Commands:**
    ```bash
    npm test
    npm run typecheck
    npm run test:mutants
    ```
  - **Expected:** All existing tests still pass; mutation score significantly higher than baseline

---

## Phase 2.3 + 2.5: Remove Unjustified Stryker/Istanbul Disables

### Audit and Remove Stryker Disables

- [ ] **T35: Audit all 90 Stryker disables and categorize each**
  - **Files:** `js/api.ts` (56), `js/calc.ts` (30), `js/utils.ts` (3), `js/main.ts` (1)
  - **Create spreadsheet/table** with columns: File, Line, Comment text, Category (A/B/C/D), Action (keep/remove+test)
  - **Categories:**
    - **A (Keep ~35):** Truly equivalent mutants
    - **B (Remove ~25):** Log/string literal suppressions — write logger spy tests
    - **C (Remove ~20):** Defensive fallback — write malformed-data tests
    - **D (Remove ~10):** Complex logic — write unit tests for error/retry paths
  - **Addresses:** C9, H16, H17

- [ ] **T36: Write ~25 logger assertion tests to replace Category B disables**
  - **Add to:** `api-mutations.test.js` or new `api-logger-mutations.test.js`
  - **Pattern:**
    ```javascript
    const spy = jest.spyOn(apiLogger, 'error');
    // trigger the code path
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('expected message'));
    ```
  - **Then remove** the corresponding `// Stryker disable` comments from `api.ts`

- [ ] **T37: Write ~20 defensive fallback tests to replace Category C disables**
  - **Add to:** appropriate mutation test files
  - **Pattern:** Call functions with malformed/missing fields, verify the fallback value is returned
  - **Then remove** the corresponding `// Stryker disable` comments

- [ ] **T38: Write ~10 complex logic tests to replace Category D disables**
  - **Add to:** appropriate mutation test files
  - **Pattern:** Mock timers, verify retry behavior, test error handling paths
  - **Then remove** the corresponding `// Stryker disable` comments

### Audit and Remove Istanbul Ignores

- [ ] **T39: Audit all 79 `istanbul ignore` directives**
  - **Files:** `ui/detailed.ts` (17), `api.ts` (19), `calc.ts` (12), `state.ts` (10), `ui/summary.ts` (8), others
  - **For each:** Determine if code IS reachable. If yes → write test + remove ignore. If no (TypeScript narrowing) → keep + add comment explaining why.
  - **Target:** Reduce from 79 → ~30 justified ignores
  - **Addresses:** H18

- [ ] **T40: Write tests for reachable istanbul-ignored code paths in `api.ts`**
  - **File:** `js/api.ts` (19 ignores)
  - **Action:** Write tests that exercise the ignored branches, then remove the ignores

- [ ] **T41: Write tests for reachable istanbul-ignored code paths in `ui/detailed.ts`**
  - **File:** `js/ui/detailed.ts` (17 ignores)
  - **Action:** Write tests + remove ignores

- [ ] **T42: Write tests for reachable istanbul-ignored code paths in `calc.ts`**
  - **File:** `js/calc.ts` (12 ignores)
  - **Action:** Write tests + remove ignores

- [ ] **T43: Write tests for reachable istanbul-ignored code paths in `state.ts`**
  - **File:** `js/state.ts` (10 ignores)
  - **Action:** Write tests + remove ignores

### Verification Checkpoint

- [ ] **T44: Run full suite + mutation tests after disable removal**
  - **Commands:**
    ```bash
    npm test
    npm run typecheck
    npm run test:mutants
    npm run test:coverage
    ```
  - **Expected:** Mutation score ≥ 90% with ~35 justified Stryker disables remaining. Coverage thresholds still met.

---

## Phase 3.2: Strengthen Weak Assertions

- [ ] **T45: Replace 116 `toBeDefined()` with structural assertions**
  - **Scope:** 31 test files (highest counts: `api-mutations.test.js` (20), `shared.test.js` (11), `performance-dashboard.test.js` (8))
  - **Pattern:**
    - `expect(result).toBeDefined()` → `expect(result).toEqual(expect.objectContaining({...}))`
    - `expect(fn).toBeDefined()` → `expect(typeof fn).toBe('function')`
  - **Addresses:** M22

- [ ] **T46: Replace 30 `toBeTruthy()` with specific assertions**
  - **Scope:** 7 test files
  - **Pattern:** `expect(result).toBeTruthy()` → `expect(result).toBe(expectedValue)` or `expect(result).toBeInstanceOf(X)`

- [ ] **T47: Replace 31 `expect(true).toBe(false)` guards with `expect.assertions(N)`**
  - **File:** Primarily `utils-mutation-killers.test.js`
  - **Pattern:** Replace `} catch { expect(true).toBe(false) }` with `expect.assertions(N)` at describe/test level

### Verification Checkpoint

- [ ] **T48: Run full test suite after assertion strengthening**
  - **Commands:** `npm test`
  - **Expected:** All 84+ suites passing with stronger assertions

---

## Phase 3.3-3.4: Add Missing Tests

### New Integration Tests

- [ ] **T49: Create `__tests__/integration/state-crypto.integration.test.js`**
  - **Test:** Encrypted overrides roundtrip — write overrides → encrypt → persist → load → decrypt → verify values match
  - **Addresses:** C11

- [ ] **T50: Create `__tests__/integration/report-to-csv.integration.test.js`**
  - **Test:** Full API → state → calc → export flow with mocked fetch
  - **Addresses:** C11

- [ ] **T51: Create `__tests__/integration/state-ui.integration.test.js`**
  - **Test:** Config changes trigger correct re-renders, store state matches UI state
  - **Addresses:** C11

- [ ] **T52: Create `__tests__/integration/api-retry-ratelimit.integration.test.js`**
  - **Test:** API retry + rate limiting end-to-end with fake timers
  - **Addresses:** C11

### Missing Edge Case Tests

- [ ] **T53: Add edge case tests for `export.ts`**
  - **Add to:** `export-mutations.test.js` or new `export-edge-cases.test.js`
  - **Cases:** empty analysis array, null durations, Unicode filenames, BOM byte verification

- [ ] **T54: Add edge case tests for `state.ts`**
  - **Add to:** `state-mutations.test.js` or existing state tests
  - **Cases:** workspace switching isolation, `copyGlobalToPerDay` with empty values, session storage quota exceeded

- [ ] **T55: Add edge case tests for `crypto.ts`**
  - **Add to:** `crypto-mutations.test.js` or existing crypto tests
  - **Cases:** AuthenticationError class, migration edge cases, `keyDatabasePromise` rejected promise caching (M28)

### Verification Checkpoint

- [ ] **T56: Run full test suite after new tests**
  - **Commands:**
    ```bash
    npm test
    npm run test:coverage
    ```
  - **Expected:** All suites passing, coverage thresholds maintained or improved

---

## Phase 3.5: Fix Test Infrastructure

- [ ] **T57: Reset `mockIdCounter` in afterEach**
  - **File:** `__tests__/helpers/mock-data.js`
  - **Change:** Export a `resetMockIdCounter()` function, call it in `standardAfterEach()` or document that tests should call it
  - **Addresses:** M25

- [ ] **T58: Add global `setupFilesAfterFramework` for `standardAfterEach`**
  - **File:** `jest.config.js`
  - **Change:** Add `setupFilesAfterFramework` pointing to a file that registers `afterEach(standardAfterEach)` globally
  - **Why:** Ensures all tests get cleanup without each file importing and wiring it manually

- [ ] **T59: Add `npm run format:check` to CI workflow**
  - **File:** `.github/workflows/ci.yml`
  - **Change:** Add step after lint: `npm run format:check`
  - **Addresses:** CI Finding #2

- [ ] **T60: Add mutation testing to PR checks**
  - **File:** `.github/workflows/ci.yml`
  - **Change:** Run `npm run test:mutants` on PRs (or at least for changed files using `--mutate` flag)
  - **Addresses:** H19, CI Finding #1

- [ ] **T61: Fix CI comment about mutation threshold**
  - **File:** `.github/workflows/ci.yml:173`
  - **Change:** Comment says "100% threshold" but config says `break: 85` (after T3). Update comment to match.
  - **Addresses:** CI Finding #5

---

## Phase 4: Production Bug Fixes (from Audit Findings)

These are actual bugs found during the audit. They should be addressed in separate PRs after the test infrastructure is solid.

### Critical Production Fixes

- [ ] **T62: Fix `fetchUsers` pagination (C1)**
  - **File:** `js/api.ts:1467-1472`
  - **Change:** Add pagination loop (similar to `fetchDetailedReport`)
  - **Also covered by:** `V2/OPTIMIZATION_PLAN.md` Phase 1.1

- [ ] **T63: Fix `fetchTimeOffRequests` pagination (C2)**
  - **File:** `js/api.ts:1874-1907`
  - **Change:** Add pagination loop
  - **Also covered by:** `V2/OPTIMIZATION_PLAN.md` Phase 1.2

- [ ] **T64: Fix circuit breaker race condition (C3)**
  - **File:** `js/api.ts:640-663`
  - **Change:** Use true atomic pattern (single object reference swap) or add a mutex

- [ ] **T65: Fix numeric config input bounds validation (C4)**
  - **File:** `js/main.ts:1446-1553`
  - **Change:** Call `validateInputBounds()` in all 5 config input handlers

- [ ] **T66: Fix `parseFloat(value) || default` zero bug (C5)**
  - **File:** `js/main.ts:1447,1462,1549`
  - **Change:** Replace `||` with `??` after checking for `NaN`:
    ```typescript
    const parsed = parseFloat(value);
    store.calcParams.dailyThreshold = Number.isNaN(parsed) ? 8 : parsed;
    ```

- [ ] **T67: Fix `validateRequiredFields` truthiness check (C6)**
  - **File:** `js/utils.ts:53`
  - **Change:** `!record[field]` → `record[field] === undefined || record[field] === null`

- [ ] **T68: Fix tab navigation visibility (C7)**
  - **File:** `css/styles.css:1398` or `js/main.ts`
  - **Change:** Verify and fix the `.tab-nav-card` display logic. Should be `display: flex` when results are visible.

- [ ] **T69: Fix perf dashboard keyboard listener leak (C12)**
  - **File:** `js/performance-dashboard.ts:520`
  - **Change:** Guard with `let keyboardListenerAdded = false` or use `AbortController`

- [ ] **T70: Fix perf dashboard innerHTML XSS (C13)**
  - **File:** `js/performance-dashboard.ts:441-442`
  - **Change:** Wrap `a.message` in `escapeHtml()`

### High Production Fixes

- [ ] **T71: Fix `extractRate` zero-rate fallthrough (H2)**
  - **File:** `js/calc.ts:231,547-548`
  - **Change:** `||` → `??`

- [ ] **T72: Fix response size check (char vs byte) (H3)**
  - **File:** `js/api.ts:1319-1320`
  - **Change:** Use `new Blob([text]).size` or `Buffer.byteLength` for byte count

- [ ] **T73: Fix `costRate` fallback type mismatch (H4)**
  - **File:** `js/api.ts:1744`
  - **Change:** `||` → `??`, and ensure `e.costRate` is extracted to a number

- [ ] **T74: Fix profile retry unbatched flooding (H5)**
  - **File:** `js/api.ts:1949-1958`
  - **Change:** Batch retries using same BATCH_SIZE as initial fetch

- [ ] **T75: Fix non-JWT token handling contradiction (H6)**
  - **File:** `js/api.ts:215-217`
  - **Change:** Return `isExpired: false` for non-JWT tokens (match documentation)

- [ ] **T76: Fix `URL.revokeObjectURL` timing (H8)**
  - **File:** `js/export.ts:185-196`
  - **Change:** Use `setTimeout(() => URL.revokeObjectURL(url), 60000)` to delay cleanup

- [ ] **T77: Fix date function timezone mixing (H9)**
  - **File:** `js/main.ts:576-584` and `1626-1631`
  - **Change:** Use consistent timezone-aware dates in both locations

- [ ] **T78: Fix filter chip ARIA roles (H13)**
  - **File:** `index.html:199-204`
  - **Change:** Add `role="option"` or change to `role="tablist"`/`role="tab"` pattern

### Medium Production Fixes

- [ ] **T79: Fix `tier2Multiplier` zero fallback (M3)**
  - **File:** `js/calc.ts:876`
  - **Change:** `||` → `??`

- [ ] **T80: Fix `getISOWeek` local vs UTC inconsistency (M6)**
  - **File:** `js/utils.ts:830-838`
  - **Change:** Use UTC methods consistently

- [ ] **T81: Fix `validateISODateString` regex anchoring (M12)**
  - **File:** `js/utils.ts:110-121`
  - **Change:** `/^\d{4}-\d{2}-\d{2}/` → `/^\d{4}-\d{2}-\d{2}$/`

- [ ] **T82: Fix `keyDatabasePromise` cached rejection (M28)**
  - **File:** `js/crypto.ts:87-116`
  - **Change:** Reset `keyDatabasePromise = null` on rejection so retry is possible

- [ ] **T83: Fix `checkTokenExpiration` for missing tokens (M2)**
  - **File:** `js/api.ts:201-210`
  - **Change:** Return `isExpired: true` when no token exists

- [ ] **T84: Fix `formatHours` negative hours (M10)**
  - **File:** `js/utils.ts:683-696`
  - **Change:** Handle negative hours correctly using `Math.abs` + sign prefix

- [ ] **T85: Fix Escape key handler for popover (M18)**
  - **File:** `js/ui/index.ts:80-103`
  - **Change:** Add `keydown` listener for Escape key to close popover

- [ ] **T86: Fix undefined CSS variables (M14)**
  - **File:** `css/styles.css`
  - **Change:** Define `--bg-secondary`, `--bg-tertiary`, `--primary-color` in `:root` and `.cl-theme-dark`

---

## Final Verification

- [ ] **T87: Run complete regression suite**
  - **Commands:**
    ```bash
    npm test                 # All 84+ suites passing
    npm run typecheck        # No type errors
    npm run test:mutants     # Score ≥ 95% with fewer disables
    npm run test:e2e         # 237 tests passing
    npm run test:coverage    # 80% thresholds maintained
    npm run lint             # Clean
    npm run format:check     # Clean
    ```

- [ ] **T88: Update `V2/AUDIT_TODO.md` with completion status**
  - Mark all addressed findings as resolved
  - Note any deferred items with reasoning

---

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 2.1-2.2 | T1-T3 | Stryker config changes |
| 2.3 | T4 | Baseline mutation score |
| 3.1.1 | T5-T16 | Shared API test helpers + migration (12 tasks) |
| 3.1.2 | T17-T20 | Shared StoragePolyfill + migration (4 tasks) |
| 3.1.3 | T21-T23 | Calc helper deduplication + verification |
| 2.4 | T24-T34 | Rewrite/create mutation-killer tests (11 tasks) |
| 2.3+2.5 | T35-T44 | Stryker/istanbul disable audit + removal (10 tasks) |
| 3.2 | T45-T48 | Strengthen weak assertions (4 tasks) |
| 3.3-3.4 | T49-T56 | New integration + edge case tests (8 tasks) |
| 3.5 | T57-T61 | Test infrastructure fixes (5 tasks) |
| 4 | T62-T86 | Production bug fixes (25 tasks) |
| Final | T87-T88 | Regression + status update (2 tasks) |
| **Total** | **88** | |
