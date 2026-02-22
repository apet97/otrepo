# OTPLUS Overtime Add-on

OTPLUS is a Clockify sidebar add-on that converts Detailed Report data into overtime-focused insights, including capacity-aware totals, tiered overtime premiums, and earned/cost/profit views.

Manifest URL:
- https://apet97.github.io/otrepo/manifest.json

## Quick Start

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run lint
npm run test:coverage
```

## Verification Commands

- Unit + integration + performance unit suite: `npm test`
- Type checks: `npm run typecheck`
- Lint: `npm run lint`
- Coverage: `npm run test:coverage`
- E2E browser matrix: `npm run test:e2e`
- Accessibility-focused E2E: `npm run test:a11y`
- Performance-focused subset: `npm run test:perf`

## Release Checklist

1. Update behavior tests for changed logic.
2. Run required verification commands.
3. Confirm coverage thresholds remain green.
4. Update user-facing documentation when behavior changes.

## Current Baseline (2026-02-22)

- `npm test`: 91 suites / 3041 tests passing
- `npm run test:e2e`: 255 tests passing
