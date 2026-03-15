# Support Runbook — OTPLUS

## Common Failure Modes

### Blank addon (sidebar shows nothing)

1. Check browser console for errors
2. Verify `manifest.json` `baseUrl` resolves (should be the Worker URL)
3. Verify the Worker is deployed: visit `<baseUrl>/manifest` directly
4. Compatibility alias: `<baseUrl>/manifest.json` should also resolve
5. Check if the workspace has the addon installed (Settings > Add-ons)
6. Verify GitHub Pages is serving the frontend: visit `GITHUB_PAGES_ORIGIN` directly
7. The frontend bootstrap accepts both standard iframe claims (`workspaceId`, `backendUrl`) and developer-portal aliases (`activeWs`, `baseURL` / `apiUrl`); if install/load still fails, inspect the actual `auth_token` claim shape in the iframe URL

### Install fails with `ADDON_UNAVAILABLE`

1. Re-test with `<baseUrl>/manifest` first; `<baseUrl>/manifest.json` should return the same manifest payload
2. Tail Worker logs during install: `cd worker && npx wrangler tail --format pretty`
3. If `GET /manifest` and `POST /lifecycle/installed` both return `200`, the Worker manifest/lifecycle path is not the active blocker
4. Next inspect the iframe `auth_token` claim shape; OTPLUS accepts `workspaceId` / `backendUrl` and the known developer aliases `activeWs` / `baseURL` / `apiUrl`
5. If Clockify never requests the component path `/`, treat the problem as post-lifecycle add-on activation or Clockify-side responsiveness validation, not a lifecycle failure

### Report timeout / "Calculation timed out"

- Total report timeout is 300 seconds
- Per-API-request timeout is 30 seconds
- Large workspaces (500+ users) may hit these limits
- Check the progress indicator for which phase stalled
- Reducing the date range will speed up report generation

### Settings not saving

1. Verify the user is an admin (only admins can save config/overrides)
2. Check browser console for 403/401 errors on `/api/config` or `/api/overrides`
3. Verify the Worker KV namespace is bound correctly
4. Check Worker logs: `wrangler tail`

### Stale data / old report showing

1. Click the refresh button to force a fresh fetch
2. Or clear cache: browser console > `window.__OTPLUS_HEALTH_CHECK__()` to check cache status
3. Report cache TTL is 5 minutes; cache < 5 seconds old auto-reuses without prompting

### CSV export not working

1. Check browser console for errors
2. Verify a report has been generated (export needs analysis results)
3. Large exports use chunked streaming; check for browser memory issues with very large workspaces

## Health Diagnostics

Run in the browser console:

```js
window.__OTPLUS_HEALTH_CHECK__()
```

Returns a `HealthCheckResult` object:

```typescript
{
  status: 'healthy' | 'degraded' | 'unhealthy',
  timestamp: string,        // ISO 8601
  version: string,          // e.g. "2.1.0"
  components: {
    circuitBreaker: { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', failureCount: number, isHealthy: boolean },
    storage:        { type: 'localStorage' | 'memory', isHealthy: boolean },
    api:            { profilesFailed: number, holidaysFailed: number, timeOffFailed: number, isHealthy: boolean },
    auth:           { hasToken: boolean, isExpired: boolean, isHealthy: boolean },
    workers:        { supported: boolean, initialized: boolean, terminated: boolean, taskFailures: number, isHealthy: boolean },
    encryption:     { enabled: boolean, supported: boolean, keyReady: boolean, pending: boolean, isHealthy: boolean },
  },
  issues: string[]          // empty when healthy; human-readable descriptions when degraded/unhealthy
}
```

**Status logic:** `unhealthy` if auth fails or circuit breaker is OPEN; `degraded` if any issue is present; `healthy` otherwise.

## Data Storage Locations

| Storage | Data | Scope |
|---------|------|-------|
| **IndexedDB** (`otplus_cache`) | Report cache (encrypted AES-GCM) | Per-browser, session-like |
| **sessionStorage** | Report cache fallback | Per-tab |
| **localStorage** `otplus_config` | Config toggles + calc params | Per-browser |
| **localStorage** `otplus_overrides_{wsId}` | User overrides | Per-workspace |
| **localStorage** `otplus_ui_state` | UI state (pagination, collapse) | Per-browser |
| **Cloudflare KV** `ws:{wsId}:config` | Server config (admin-set) | Per-workspace |
| **Cloudflare KV** `ws:{wsId}:overrides` | Server overrides (admin-set) | Per-workspace |
| **Cloudflare KV** `ws:{wsId}:token` | Installation auth token | Per-workspace |

## Lifecycle Events

### INSTALLED

When a workspace installs the addon:
1. Clockify sends `POST /lifecycle/installed` with `Clockify-Signature` header
2. Worker verifies RSA256 signature and claims when present/valid
3. If signature validation fails in a given environment, Worker falls back to install-token verification against Clockify API (`verifyInstallToken`) before accepting install
4. Stores installation auth token in KV (`ws:{wsId}:token`)
5. Creates default config if none exists
6. Frontend component bootstrap separately validates the iframe `auth_token`; developer-portal aliases are normalized before host trust checks

### DELETED

When a workspace uninstalls the addon:
1. Clockify sends `POST /lifecycle/deleted` with `Clockify-Signature` header
2. Worker verifies RSA256 signature and claims
3. Deletes all workspace data from KV (token, config, overrides)

## CSP Policy

The addon HTML includes a Content Security Policy meta tag that:
- Restricts scripts to `self`
- Restricts styles to `self`, `unsafe-inline`, Clockify resources, and Google Fonts
- Restricts fonts to `self` and Google Fonts
- Restricts images to `self` and `data:` URIs
- Restricts connections to `self`, Clockify API domains, and Sentry
- Restricts workers to `self`
- `default-src 'self'` covers all other resource types not explicitly listed (frames, objects, form actions, etc.)

If adding new external resources, update the CSP in `index.html`.

## Uninstall Cleanup

When uninstalled:
- **Server-side**: Worker deletes all KV data for the workspace
- **Client-side**: localStorage and IndexedDB data remain in the browser (no cleanup mechanism from server)
- Users can manually clear browser data if needed
