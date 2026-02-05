# Test & Mutation Review Plan

This plan documents the detailed review approach for **test quality** and **mutation testing**, so you can hand it off and continue in a fresh conversation without losing intent.

## Why This Is Good Thinking
Investing in deep test + mutation quality now reduces regression risk later, keeps refactors safe, and avoids “brittle test debt.” It’s a strong long-term reliability move.

---

## Plan A — Deep Review of All Tests

### 1) Inventory & Map
- Enumerate all test suites and group by module:
  - `js/api.ts`, `js/calc.ts`, `js/utils.ts`, `js/main.ts`, `js/ui/*`, `js/export.ts`
- Tag each test: **unit**, **integration**, **e2e**.
- Note shared fixtures/helpers and where they live.

### 2) Coverage-by-Behavior Matrix
- Build a matrix of **critical behaviors vs. test coverage**:
  - Auth/claims handling
  - API contracts (payloads, pagination, error handling)
  - Overtime computation (daily/weekly/both, tiered OT)
  - Capacity adjustments (holidays, time-off, non-working days)
  - UI rendering + export behavior
  - Resilience (empty data, invalid input, partial failures)
- Mark each behavior as **covered / partial / missing / redundant**.

### 3) Quality Audit (Per File)
For each test file:
- **Signal-to-noise:** Are assertions meaningful or superficial?
- **Determinism:** Time, randomness, locale/timezone dependencies, async races.
- **Isolation:** Over-mocking vs under-mocking; hidden shared state; order dependence.
- **Maintainability:** Duplicated fixtures, magic constants, unclear intent.

### 4) Failure Modes & Boundaries
- Explicitly validate edge cases:
  - null/undefined inputs
  - invalid formats
  - boundaries (page limits, thresholds, zero/negative values)
  - permission errors (401/403)
  - 4xx vs 5xx classification

### 5) Consolidation & Cleanup
- Identify redundant or low-value tests.
- Propose **minimal-churn** improvements:
  - reusing existing helpers
  - consolidating nearly-identical tests
  - tightening assertions to behavior, not constants

### 6) Deliverable
- A detailed, file‑path‑annotated report:
  - Strengths
  - Risks
  - Recommended changes
  - Priority order

---

## Plan B — Deep Review of Mutation Tests

### 1) Baseline From Latest Mutation Report
- Parse `reports/mutation/index.html` for the latest run.
- Extract **Survived** and **NoCoverage** mutants by file/line.

### 2) Classify Survivors
For each surviving mutant:
- **Logical gap:** Missing assertion or missing scenario.
- **Equivalent mutant:** Behaviorally identical; should be ignored or refactored.
- **Flaky risk:** Timing/locale/environment dependence.
- **Over‑mocked path:** Code under test bypassed by mocks.

### 3) Test‑to‑Mutant Mapping
- Map each survivor to current tests and show why it wasn’t killed.
- Confirm if the test exists but doesn’t hit the mutant path.

### 4) Fix Strategy (Minimal Churn)
For each survivor:
- **Add one targeted test** OR **strengthen a relevant existing test**.
- Avoid production code changes unless testability is blocked.
- Keep all new tests deterministic and isolated.

### 5) Gate Validation
- Re-run unit tests (no e2e unless behavior changes).
- Re-run mutation tests and confirm score exceeds break threshold.

### 6) Deliverable
- A remediation report listing each survivor:
  - file path
  - mutated line(s)
  - recommended test change
  - reason it failed previously

---

## Start Order Recommendation
1) Run **Plan B** first to stabilize mutation score and prevent regression.
2) Follow with **Plan A** to harden overall test quality.

