# Contributing

## Quick start
- Install deps: `npm ci`
- Run tests: `npm test`
- Coverage gate: `npm run test:coverage`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- E2E (UI/orchestration changes): `npm run test:e2e`

## Definition of done
- Behavior changes have tests and docs updated.
- `npm run test:coverage` passes (100% thresholds).
- Lint/typecheck are clean.
- No new dependencies without approval.

## Style
- Prefer small, focused diffs.
- Keep `js/types.ts` in sync with runtime changes.
- Avoid full-file reformatting.
