# Contributing

## Setup

```bash
npm ci
npm run build
```

## Required Verification

For behavior/code changes:

```bash
npm test
npm run typecheck
npm run lint
npm run test:coverage
```

For UI/orchestration changes, also run:

```bash
npm run test:e2e
```

Optional focused checks:

- Accessibility-focused UI changes: `npm run test:a11y`
- Performance-sensitive changes: `npm run test:perf`

## Flake Triage

If a suite fails with timing-sensitive behavior:

1. Run one targeted repro for the failing spec/test file.
2. Re-run the relevant full suite once (`npm run test:e2e` or `npm test`).
3. Treat Playwright runner-level errors as failures even when no single test owns the error.

If `npm test` fails only on micro-benchmark thresholds in `__tests__/performance/*.test.js`, treat it as environment-sensitive until a targeted repro confirms a deterministic regression.

## Current Baseline (2026-02-22, post-CI)

- `npm test`: 84 suites / 2979 tests
- `npm run test:e2e`: 237 tests

## Definition of Done

- Behavior changes include tests and docs updates.
- Required verification passes for the change scope.
- No lint errors and no type errors.
- Coverage thresholds remain green.
- Diffs are focused and avoid unrelated refactors.

## Pull Request Notes

- Include a concise summary and risk assessment.
- List exact commands run and outcomes.
- Call out any residual risks or known limitations.
