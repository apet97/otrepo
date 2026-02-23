# OTPLUS Overtime Add-on

OTPLUS is a Clockify sidebar add-on that converts Detailed Report data into overtime-focused insights, including capacity-aware totals, tiered overtime premiums, and earned/cost/profit views.

Manifest URL:
- https://apet97.github.io/otrepo/manifest.json

![OTREPO demo](docs/media/otrepo.gif)


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
