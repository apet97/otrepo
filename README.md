# OTPLUS

**Overtime analysis add-on for Clockify** — calculates daily/weekly overtime, capacity utilization, tiered premiums, billable breakdowns, and amounts per user for any date range. Exports to CSV. Runs as a sidebar widget inside Clockify.

![OTPLUS demo](documents/demoOTPLUS.gif)

## What is OTPLUS?

OTPLUS is a TypeScript sidebar add-on for [Clockify](https://clockify.me) that provides overtime reporting and analysis that Clockify doesn't offer natively. It runs inside Clockify's sidebar iframe, reads time entries via the Reports API, and calculates overtime against configurable thresholds.

The add-on supports per-user profile capacity, holiday/time-off deductions, tiered overtime premiums (e.g. time-and-a-half plus double-time), and three-track amount calculation (earned, cost, profit). All configuration is shared across workspace admins via a Cloudflare Worker backend with KV persistence.

OTPLUS handles workspaces with up to 1 million time entries, uses Web Workers for non-blocking calculations, encrypts sensitive localStorage data with AES-GCM, and provides comprehensive CSV export with formula-injection defenses.

## Features

- **Overtime calculation** — daily, weekly, or both modes with configurable thresholds
- **Tiered premiums** — tier-1 (e.g. 1.5x) and tier-2 (e.g. 2x) overtime multipliers
- **Profile-based capacity** — reads each user's Clockify profile for daily hours and working days
- **Holiday integration** — deducts holidays from expected capacity with smart sampling for large workspaces
- **Time-off integration** — approved time-off reduces expected hours
- **Billable breakdown** — separate tracking of billable vs. non-billable regular and overtime hours
- **Amount triangulation** — earned, cost, and profit tracks calculated in parallel
- **Per-user overrides** — global, weekly, or per-day capacity/multiplier overrides per user
- **CSV export** — summary, detailed, and per-entry exports with formula-injection defense
- **Encrypted storage** — AES-GCM encryption for localStorage with per-workspace keys
- **Health monitoring** — `window.__OTPLUS_HEALTH_CHECK__` endpoint for diagnostics
- **Admin configuration** — shared settings persisted in Cloudflare KV, admin-only access control
- **Session management** — proactive token refresh, expiry warnings, graceful re-auth

## Architecture Overview

```
Clockify App
  └── Sidebar iframe
        └── OTPLUS Frontend (GitHub Pages)
              ├── Clockify APIs (users, reports, holidays, time-off)
              └── Cloudflare Worker
                    ├── /lifecycle/* → KV (install/delete)
                    ├── /api/*      → KV (config/overrides CRUD)
                    └── /*          → GitHub Pages (static proxy)
```

See [docs/architecture.md](docs/architecture.md) for detailed diagrams and data flows.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict) |
| Bundler | esbuild |
| Backend | Cloudflare Worker + KV |
| Static hosting | GitHub Pages |
| Unit/integration tests | Jest (ESM mode) |
| E2E tests | Playwright |
| Accessibility tests | axe-core + Playwright |
| Lint | ESLint 9 + Prettier |
| Mutation testing | Stryker Mutator |
| Error reporting | Sentry |
| CI/CD | GitHub Actions |

## Quick Start

```bash
# Install dependencies
npm ci

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Worker Development

```bash
cd worker
npm install
npm test                  # Run worker tests
wrangler dev              # Local dev server
wrangler deploy           # Deploy to Cloudflare
```

## Installation in Clockify

1. In Clockify, go to **Settings → Add-ons → Custom Add-ons**
2. Enter the manifest URL:
   ```
   https://otplus-worker.petkovic-aleksandar037.workers.dev/manifest
   ```
   Alternate: `https://otplus-worker.petkovic-aleksandar037.workers.dev/manifest.json`
3. Click **Install**

**Requirements**: Clockify Standard plan or higher, workspace admin role.

## Self-Hosting Guide

### 1. Fork and Configure GitHub Pages

1. Fork this repository
2. Go to **Settings → Pages**
3. Set source to **GitHub Actions**
4. The CI workflow deploys to Pages automatically

### 2. Deploy the Cloudflare Worker

1. Install Wrangler: `npm install -g wrangler`
2. Create a KV namespace:
   ```bash
   wrangler kv namespace create SETTINGS_KV
   ```
3. Update `worker/wrangler.toml`:
   - Set `account_id` to your Cloudflare account ID
   - Set `GITHUB_PAGES_ORIGIN` to your GitHub Pages URL (e.g. `https://yourusername.github.io/otrepo`)
   - Set the KV namespace `id` from step 2
4. Deploy:
   ```bash
   cd worker && wrangler deploy
   ```

### 3. Configure the Manifest

Update `manifest.json`:
- Set `baseUrl` to your Worker URL (e.g. `https://otplus-worker.youraccount.workers.dev`)

### 4. Set CI Secrets

In your fork's GitHub Settings → Secrets:
- `CLOUDFLARE_API_TOKEN` (required) — Cloudflare API token with Worker deploy permissions
- `SENTRY_DSN` (optional) — Sentry DSN for error reporting

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Build frontend (dev mode) |
| `npm run build:prod` | Build frontend (production, minified) |
| `npm run build:watch` | Build with file watcher |
| `npm test` | Run all Jest tests |
| `npm run test:watch` | Jest watch mode |
| `npm run test:coverage` | Jest with coverage thresholds |
| `npm run test:perf` | Performance benchmarks only |
| `npm run test:e2e` | Playwright E2E tests (all browsers) |
| `npm run test:e2e:ui` | Playwright with interactive UI |
| `npm run test:e2e:headed` | Playwright with visible browser |
| `npm run test:a11y` | Accessibility tests only |
| `npm run test:mutants` | Stryker mutation testing |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint auto-fix |
| `npm run format` | Prettier format |
| `npm run format:check` | Prettier check |
| `npm --prefix worker test` | Worker tests (Vitest) |
| `npm run sbom` | Generate SBOM (JSON) |
| `npm run deps:check` | Dependency cruiser check |
| `npm run deps:graph` | Generate dependency graph SVG |

## Project Structure

```
otrepo/
├── js/                     # Frontend TypeScript source
│   ├── main.ts             # Entry point
│   ├── state.ts            # Central store
│   ├── api.ts              # Clockify API client
│   ├── calc.ts             # Calculation engine
│   ├── calc.worker.ts      # Web Worker
│   ├── export.ts           # CSV export
│   ├── crypto.ts           # AES-GCM encryption
│   ├── settings-api.ts     # Worker API client
│   ├── config-manager.ts   # Config event binding
│   ├── report-orchestrator.ts  # Report generation
│   ├── worker-manager.ts   # Worker pool
│   ├── utils.ts            # Validation/formatting
│   ├── constants.ts        # Configuration defaults
│   ├── types.ts            # Type definitions
│   ├── logger.ts           # Structured logging
│   └── ui/                 # UI rendering modules
│       ├── index.ts
│       ├── summary.ts
│       ├── detailed.ts
│       ├── overrides.ts
│       ├── dialogs.ts
│       └── shared.ts
├── worker/                 # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts        # Router + static proxy
│   │   ├── auth.ts         # JWT, CORS, admin check
│   │   ├── api-routes.ts   # Config/overrides CRUD
│   │   ├── lifecycle.ts    # Install/delete handlers
│   │   └── types.ts        # Worker types
│   ├── wrangler.toml       # Worker configuration
│   └── package.json
├── __tests__/              # Test suites
│   ├── unit/               # 108 Jest suites
│   ├── integration/        # Integration tests
│   ├── performance/        # Benchmarks
│   ├── e2e/                # 8 Playwright specs
│   ├── a11y/               # Accessibility specs
│   ├── fixtures/           # Test data
│   └── helpers/            # Test utilities
├── css/                    # Stylesheets
├── docs/                   # Documentation
├── index.html              # Main HTML template
├── manifest.json           # Clockify addon manifest
├── build.js                # esbuild configuration
├── jest.config.js          # Jest configuration
├── playwright.config.ts    # Playwright configuration
└── package.json
```

## Test Baseline

Current as of v2.1.0:

| Suite | Count | Status |
|-------|-------|--------|
| Jest unit/integration | 108 suites / 3,986 tests | Passing |
| Jest coverage | 80% threshold (branches, functions, lines, statements) | Green |
| Playwright E2E | 246 tests (all browsers) | Passing |
| Worker tests | 4 suites / 98 tests | Passing |
| TypeScript | `tsc --noEmit` | Clean |
| ESLint | `eslint js/` | Clean |
| Prettier | `prettier --check` | Clean |
| Production bundle | ~388KB | — |

## Documentation

| Document | Description |
|----------|-------------|
| [docs/configuration-reference.md](docs/configuration-reference.md) | Complete reference for every configurable value |
| [docs/api-reference.md](docs/api-reference.md) | HTTP API reference for the Cloudflare Worker |
| [docs/security.md](docs/security.md) | Security model, encryption, auth flows, known trade-offs |
| [docs/architecture.md](docs/architecture.md) | System architecture with diagrams |
| [docs/testing-guide.md](docs/testing-guide.md) | How to write and run tests |
| [docs/developer-guide.md](docs/developer-guide.md) | Developer tutorial and patterns |
| [docs/deployment-runbook.md](docs/deployment-runbook.md) | Deployment procedures |
| [docs/support-runbook.md](docs/support-runbook.md) | Support and troubleshooting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting changes.

## License

MIT
