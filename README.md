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

## Stabilization Highlights (2026-02-22)

The latest E2E hardening pass focused on deterministic UI outcomes and browser-safe interaction timing:

- API retry-recovery flow now asserts a terminal UI state (results or API banner) after explicit report generation.
- Overrides tests now expand collapsed user cards before interacting with capacity/mode controls.
- Report tab switching now validates `aria-selected` transitions and falls back to keyboard activation when needed.
- Security CSV-export tests now use a shared download helper with a one-retry path and teardown-safe dialog handling.

## Current Baseline (2026-02-22, post-CI)

- `npm test`: 84 suites / 2979 tests passing
- `npm run test:e2e`: 237 tests passing
- `npm run typecheck`: passing (0 errors)
- `npm run lint`: passing (warnings only)
- `npm run test:coverage`: passing (global 80% threshold gate)
