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
