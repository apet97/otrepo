You are working on OTPLUS, a TypeScript Clockify sidebar addon at `/Users/15x/Documents/addons-me/otrepo`.

## Project State

OTPLUS calculates overtime hours for workspace users. It's a client-side TypeScript app (esbuild, Jest, Playwright, ESLint 9, GitHub Actions CI). Current baseline: 84 test suites / 2979 tests, 237 E2E tests, 80% coverage thresholds.

Three planning documents define ALL the work:

1. **`IMPLEMENTATION_TASKS.md`** — 88 numbered tasks (T1-T88) in dependency order. This is your primary checklist. Work through tasks sequentially.
2. **`AUDIT_TODO.md`** — 88 audit findings (C1-C13, H1-H19, M1-M28, L1-L28) with file:line references and code snippets. Tasks in IMPLEMENTATION_TASKS.md reference these by ID.
3. **`OPTIMIZATION_PLAN.md`** — V2 scaling plan for 1500-user workspaces. Tasks T62-T63 overlap with this plan's Phase 1.

## Architecture (key files)

```
js/main.ts        — Entry point, orchestration, config binding
js/api.ts         — Clockify API client (retry, circuit breaker, pagination, rate limiting)
js/calc.ts        — Pure calculation engine (overtime, capacity, tiered OT)
js/state.ts       — Centralized store (persistence, overrides, encryption)
js/export.ts      — CSV export with formula injection protection
js/utils.ts       — Validation, sanitization, date helpers
js/crypto.ts      — AES-GCM localStorage encryption
js/ui/summary.ts  — Summary table rendering
js/ui/detailed.ts — Detailed table with pagination/filters
js/ui/overrides.ts — Override editor UI
js/ui/dialogs.ts  — Loading states, modals, banners
js/ui/index.ts    — UI initialization, popovers
stryker.config.json         — Mutation testing config
jest.config.js              — Jest config
jest.stryker.config.js      — Stryker-specific Jest config
__tests__/helpers/           — Shared test helpers
__tests__/unit/              — Unit tests (including mutation-killer tests)
__tests__/integration/       — Integration tests
.github/workflows/ci.yml    — CI pipeline
```

## What You Must Do

Work through `IMPLEMENTATION_TASKS.md` tasks T1-T88 in order. Each task has exact file paths, code changes, and verification commands. The tasks are grouped into phases — complete each phase before moving to the next.

### Phase Order

1. **T1-T3**: Stryker config changes (expand mutate array, enable perTest, lower threshold)
2. **T4**: Run Stryker baseline (record score)
3. **T5-T23**: Consolidate duplicated test helpers (create shared helpers, migrate 11 mockResponse files, 3 StoragePolyfill files, dedup createMinimalStore)
4. **T24-T34**: Rewrite/create mutation-killer tests (update existing 5 files, create 5 new test files)
5. **T35-T44**: Audit and remove unjustified Stryker/istanbul disables (categorize 90 disables, write replacement tests, remove ~55 disables)
6. **T45-T48**: Strengthen weak assertions (replace 116 toBeDefined, 30 toBeTruthy, 31 expect(true).toBe(false))
7. **T49-T56**: Add missing integration tests and edge cases
8. **T57-T61**: Fix test infrastructure (mockIdCounter reset, global afterEach, CI improvements)
9. **T62-T86**: Production bug fixes from audit findings (pagination, zero-fallthrough, XSS, race conditions, timezone mixing, ARIA)
10. **T87-T88**: Final regression + status update

### Per-Task Workflow

For each task:
1. Read the task description in `IMPLEMENTATION_TASKS.md`
2. Read the referenced source file(s) before making changes
3. Make the change
4. Run the verification command specified in the task
5. If tests fail, fix before moving on
6. Mark the checkbox in `IMPLEMENTATION_TASKS.md`: `- [ ]` → `- [x]`

### Batch Checkpoints

After completing each phase, run:
```bash
npm test && npm run typecheck
```
If either fails, fix all failures before proceeding to the next phase.

## Rules

- **Read before writing.** Always read a file before editing it. Understand the existing code.
- **Check `.claude/ralph-progress.md`** at the start of each iteration for what previous iterations completed.
- **Mark tasks done** in `IMPLEMENTATION_TASKS.md` as you complete them. This is how you track progress across iterations.
- **Run verification commands** after each task. Do not skip them.
- **Do not skip tasks.** If a task is blocked, note why in ralph-progress.md and move to the next non-blocked task.
- **Commit after each phase** (not just at end). Use descriptive messages like `fix: consolidate mockResponse into shared helper (T5-T16)`.
- **Do NOT modify test behavior** — only refactor structure (shared helpers) and strengthen assertions. Existing tests must still pass.
- **Do NOT change production behavior** unless the task explicitly says to fix a bug. Refactoring tests ≠ changing production code.
- **Security rules from CLAUDE.md apply:** `X-Addon-Token` header (never `X-Api-Key`), `escapeHtml()` for untrusted strings, `sanitizeFormulaInjection()` for CSV.
- **80% coverage thresholds must be maintained.** Never let coverage drop below thresholds.
- **Update CLAUDE.md** if you change test commands, add new test files, or modify CI config.
- **Do NOT run `npm run test:e2e`** unless explicitly working on E2E-related tasks. It requires a browser and is slow.
- **Do NOT delete or rename existing test files** unless the task explicitly says to.
- **If Stryker mutation run takes too long** (>30 minutes), skip T4 and note it in progress. Focus on writing tests first.
- **Use parallel tool calls** when reading/editing independent files to maximize throughput.
- **Do NOT add unnecessary dependencies.** Everything needed is already installed.

## Completion Promise

When ALL of the following are true:
1. All 88 tasks in `IMPLEMENTATION_TASKS.md` are checked off (`- [x]`)
2. `npm test` passes (all suites, all tests)
3. `npm run typecheck` passes (no type errors)
4. `npm run test:coverage` passes (80% thresholds met)
5. `npm run lint` passes

Output: <promise>ALL_TASKS_COMPLETE</promise>

If you reach the final iteration without completing everything, output a summary of what's done and what remains.
