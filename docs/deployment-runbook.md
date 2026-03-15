# Deployment Runbook — OTPLUS Worker + GitHub Pages

## Prerequisites

- Node.js 18+
- `wrangler` CLI (`npm install -g wrangler`)
- Cloudflare account with Workers and KV enabled
- GitHub repository with Pages enabled

## Secrets and Environment Variables

### CI (GitHub Actions)

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers + KV permissions |
| `SENTRY_DSN` | (Optional) Sentry DSN for error reporting |

| Variable | Description |
|----------|-------------|
| `ENABLE_PAGES` | Set to `'true'` to enable the `release` job (ZIP artifact creation). Without this variable, release artifacts are silently skipped. Set in GitHub repo Settings > Secrets and variables > Actions > Variables. |

### Worker Variables

| Variable | Set In | Description |
|----------|--------|-------------|
| `GITHUB_PAGES_ORIGIN` | `wrangler.toml` | Origin URL for GitHub Pages (e.g., `https://user.github.io/repo`) |
| `SETTINGS_KV` | `wrangler.toml` | KV namespace binding for workspace settings |

## KV Namespace Setup

```bash
# Create production KV namespace
wrangler kv namespace create SETTINGS_KV

# Create staging KV namespace (optional)
wrangler kv namespace create SETTINGS_KV --env staging
```

Update the `id` in `worker/wrangler.toml` with the returned namespace ID.

## CI Pipeline

Push to `main` triggers the following job dependency chain:

```
security ─┐
quality ──┼→ build → e2e ──┬→ deploy (GitHub Pages)
test ─────┘                ├→ deploy-worker (Cloudflare)
                           └→ release (ZIP artifact, requires ENABLE_PAGES)
```

- **security**: `npm audit --audit-level=high --omit=dev`
- **quality**: lint + format check + typecheck
- **test**: Jest coverage + Worker tests
- **build**: production esbuild (needs quality + test)
- **e2e**: Playwright E2E — **Chromium only** in CI (Firefox/WebKit run locally)
- **deploy**: GitHub Pages deployment (main push only)
- **deploy-worker**: Cloudflare Worker via `wrangler deploy` (main push only)
- **release**: ZIP artifact (main push only, requires `vars.ENABLE_PAGES == 'true'`)
- **mutation-test**: Stryker (PRs, nightly schedule, or manual dispatch)

### Browser matrix limitation

CI runs E2E tests on Chromium only to keep CI time reasonable. Firefox and WebKit are configured in `playwright.config.ts` and should be tested locally before marketplace submission. Run `npm run test:e2e` locally to cover all three browsers.

## Deployment

### Production (via CI)

Push to `main` triggers the `deploy-worker` GitHub Actions job:

1. Builds frontend → deploys to GitHub Pages
2. Deploys Worker via `wrangler deploy`

### Manual Production Deploy

```bash
cd worker
wrangler deploy
```

### Staging Deploy

1. Uncomment and fill in the `[env.staging]` section in `worker/wrangler.toml`
2. Deploy:

```bash
cd worker
wrangler deploy --env staging
```

## Rollback

### Worker Rollback

```bash
# List recent deployments
wrangler deployments list

# Rollback to previous version
wrangler rollback
```

### GitHub Pages Rollback

```bash
# Revert the commit and push
git revert HEAD
git push origin main
```

This triggers a new Pages deployment with the reverted code.

## Post-Deploy Smoke Test

0. Verify both manifest routes respond:
   - `<worker>/manifest`
   - `<worker>/manifest.json`
1. Open the Clockify sidebar → verify addon loads (not blank)
2. Check health endpoint: open browser console → `window.__OTPLUS_HEALTH_CHECK__()`
3. Generate a report → verify data appears
4. (Admin) Change a config setting → verify it persists after page reload
5. Export CSV → verify file downloads correctly
6. Check Worker logs: `wrangler tail` for any errors

## Custom Domain

To use a custom domain instead of `*.workers.dev`:

1. Add a custom domain in Cloudflare Dashboard → Workers → your worker → Settings → Triggers
2. Update `manifest.json` `baseUrl` to the custom domain
3. HSTS: Enable via Cloudflare Dashboard → SSL/TLS → Edge Certificates → Always Use HTTPS + HSTS

HSTS is managed at the Cloudflare dashboard level, not in Worker code.

## Manifest

The addon manifest source file (`manifest.json`) must have `baseUrl` pointing to the Worker URL.
Lifecycle paths (`/lifecycle/installed`, `/lifecycle/deleted`) must match the Worker routes.
The Worker should serve both `/manifest` and `/manifest.json`; use `/manifest` as the primary install URL for Clockify and keep `/manifest.json` as a compatibility alias.

## KV Data Schema

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `ws:{workspaceId}:token` | string | Installation auth token |
| `ws:{workspaceId}:config` | JSON (WorkspaceConfig) | Workspace config + calc params |
| `ws:{workspaceId}:overrides` | JSON (WorkspaceOverrides) | Per-user overrides |

All JSON values include `schemaVersion: 1` as of v2.1.0. Records without `schemaVersion` are pre-v1.
