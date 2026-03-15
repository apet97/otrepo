# Security Documentation

Complete security documentation for OTPLUS — covering authentication, encryption, input validation, and known trade-offs.

## Table of Contents

- [JWT Authentication Flow](#jwt-authentication-flow)
- [RSA256 Signature Verification](#rsa256-signature-verification)
- [Token Handling Rules](#token-handling-rules)
- [Worker Authentication](#worker-authentication)
- [CORS Policy](#cors-policy)
- [Content Security Policy](#content-security-policy)
- [URL Validation / SSRF Prevention](#url-validation--ssrf-prevention)
- [localStorage Encryption](#localstorage-encryption)
- [CSV Injection Defense](#csv-injection-defense)
- [HTML Escaping (XSS Prevention)](#html-escaping-xss-prevention)
- [Known Trade-offs](#known-trade-offs)

---

## JWT Authentication Flow

End-to-end flow from Clockify iframe to authenticated API call:

```
1. Clockify embeds addon in iframe with ?auth_token=<jwt> query param
2. main.ts extracts token from URL
3. Token is immediately scrubbed from address bar via history.replaceState()
4. JWT is split into header.payload.signature
5. RSA256 signature verified via Web Crypto API (verifyJwtSignature)
6. Payload decoded and alias claims normalized (normalizeTokenClaims):
   - activeWs → workspaceId
   - apiUrl/baseURL/baseUrl → backendUrl (with /api path normalization)
7. Required claims validated: workspaceId must exist
8. backendUrl validated against trusted host list (isAllowedClockifyUrl)
9. reportsUrl validated if present
10. Token stored in store.token (in-memory only)
11. Session timeout initialized based on exp claim
12. Proactive token refresh scheduled 2 minutes before expiry
```

Source: `js/main.ts` — `init()`, `parseAndValidateToken()`, `normalizeTokenClaims()`

---

## RSA256 Signature Verification

Both the frontend and Worker embed Clockify's X.509 RSA256 public key and verify JWT signatures independently.

### Frontend (`js/main.ts`)

- Uses Web Crypto API (`crypto.subtle.verify` with RSASSA-PKCS1-v1_5 / SHA-256).
- **Fail-closed design**: Missing `crypto.subtle`, crypto errors, and failed verification all reject the token (return `false`).
- Skipped only in `NODE_ENV=test` environments.
- E2E test bypass available via:
  - `window.__OTPLUS_SKIP_SIGNATURE_VERIFY = true` (Playwright `addInitScript`)
  - `document.documentElement.dataset.skipSignatureVerify = 'true'` (DOM attribute)
  - Both bypasses are wrapped in `process.env.NODE_ENV !== 'production'` and stripped from production builds via esbuild dead-code elimination.

### Worker (`worker/src/auth.ts`)

- Uses the same Clockify public key and Web Crypto API.
- `verifyRsa256()` returns `false` on any error — never throws.
- `extractAndVerifyJwt()` requires valid signature before trusting any claims.
- Called for all `/api/*` endpoint access-control decisions.

### Key Source

```
https://dev-docs.marketplace.cake.com/clockify/build/authentication-and-authorization
```

---

## Token Handling Rules

| Rule | Implementation |
|------|---------------|
| Use `X-Addon-Token` header (never `X-Api-Key`) | `js/settings-api.ts`, `worker/src/auth.ts` |
| Token stored in-memory only (`store.token`) | `js/state.ts` — never persisted to localStorage/cookies |
| Token scrubbed from URL immediately | `js/main.ts` — `extractAndScrubToken()` |
| Token never logged | `js/logger.ts` — structured logger with token redaction |
| Token never in error messages | Error handlers use generic messages |
| `postMessage('*')` for token refresh | `js/main.ts` — standard Clockify iframe pattern; inbound messages validated via `isAllowedOrigin()` |
| Proactive refresh 2 min before expiry | `js/main.ts` — `requestTokenRefresh()` via Clockify postMessage API |
| Refresh fallback: page reload after 5s | If Clockify doesn't respond to refresh request |

---

## Worker Authentication

### Lifecycle Endpoints — Three-Tier Auth

`POST /lifecycle/installed` uses a cascade authentication approach. Any one tier passing is sufficient:

| Tier | Method | Speed | Network I/O |
|------|--------|-------|-------------|
| 1 | `Clockify-Signature` header RSA256 | Fastest | None |
| 2 | `authToken` JWT RSA256 signature | Fast | None |
| 3 | Outbound API call (`GET /v1/workspaces/{id}`) | Slowest | Yes |

**Tier 1** — `verifyLifecycleSignature()` in `worker/src/auth.ts`:
- Verifies RSA256 signature of the `Clockify-Signature` header JWT.
- Validates claims: `iss=clockify`, `type=addon`, `sub=overtime-summary`, `exp` not passed.
- Cross-checks `workspaceId` from signature against request body.

**Tier 2** — `verifyAuthTokenSignature()` in `worker/src/auth.ts`:
- Verifies RSA256 signature of the `authToken` from the request body.
- Checks `iss=clockify` and expiration.
- More reliable than Tier 3 (no network dependency).

**Tier 3** — `verifyInstallToken()` in `worker/src/auth.ts`:
- Outbound `GET {apiUrl}/v1/workspaces/{workspaceId}` using the provided `authToken`.
- Tries multiple API URL candidates (normalized from `apiUrl` or defaults).
- Rejects HTML 200 responses (wrong developer-portal paths can return HTML).

`POST /lifecycle/deleted` requires Tier 1 only (valid `Clockify-Signature`).

### API Endpoints

All `/api/*` endpoints use `extractAndVerifyJwt()`:

1. Extract JWT from `Authorization: Bearer` or `X-Addon-Token` header.
2. Verify RSA256 signature.
3. Decode and normalize alias claims.
4. Trust `workspaceId` and `userId` from verified payload.

Write operations (`PUT`) additionally call `isWorkspaceAdmin()`:

1. Validate `backendUrl` from JWT against Clockify domain allowlist (SSRF prevention).
2. Fetch installation token from KV (`ws:{workspaceId}:token`).
3. Call `GET {backendUrl}/v1/workspaces/{workspaceId}/users/{userId}` using installation token.
4. Check for `WORKSPACE_ADMIN` or `OWNER` role.

---

## CORS Policy

### Production Allowlist

| Pattern | Rationale |
|---------|-----------|
| `https://app.clockify.me` | Main Clockify app |
| `https://clockify.me` | Clockify domain |
| `https://{cc}.app.clockify.me` | Regional Clockify subdomains |
| `https://{cc}.clockify.me` | Regional Clockify domains |
| `https://*.github.io` | GitHub Pages addon distribution |
| `https://*.*.workers.dev` | Cloudflare Workers addon distribution |

### Localhost Gating

Localhost origins (`http://localhost:{port}`) are only permitted when `ENVIRONMENT !== "production"`. Controlled by the `ENVIRONMENT` binding in `worker/wrangler.toml`.

Source: `worker/src/auth.ts` — `isAllowedCorsOrigin()`, `CORS_ALLOWED_PATTERNS`, `DEV_ONLY_PATTERNS`

---

## Content Security Policy

Defined in `index.html` via `<meta http-equiv="Content-Security-Policy">`.

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Block all sources not explicitly allowed. |
| `script-src` | `'self'` | Only same-origin scripts (no inline, no eval). |
| `style-src` | `'self' 'unsafe-inline' https://resources.developer.clockify.me https://fonts.googleapis.com` | Self + inline styles (required for Clockify UI kit dynamic styles) + Clockify UI kit CSS + Google Fonts CSS. |
| `font-src` | `'self' https://fonts.gstatic.com` | Self + Google Fonts served from gstatic.com. |
| `img-src` | `'self' data:` | Self + data URIs (for inline SVG/icons). |
| `connect-src` | `'self' https://*.clockify.me https://reports.api.clockify.me https://*.sentry.io https://*.ingest.sentry.io` | API calls to Clockify backends + Sentry error reporting. |
| `worker-src` | `'self'` | Web Workers from same origin only. |

---

## URL Validation / SSRF Prevention

### Frontend — `isAllowedClockifyUrl()` (`js/utils.ts`)

Used during token validation and API request construction:

```typescript
function isAllowedClockifyUrl(value: string): boolean {
    // Protocol must be https:
    // Hostname must be clockify.me or *.clockify.me
    // Malformed URLs return false
}
```

### Worker — `isAllowedClockifyUrl()` (`worker/src/auth.ts`)

Same logic, applied to:
- `backendUrl` from JWT claims before outbound API calls (`isWorkspaceAdmin`).
- `apiUrl` from lifecycle payload before install token verification.

Allowed hostnames: `api.clockify.me`, `global.api.clockify.me`, and any `*.clockify.me`.

### Why Both Frontend and Worker?

Defense in depth. The frontend validates URLs to prevent sending requests to untrusted hosts. The Worker validates URLs to prevent SSRF where a forged JWT could redirect server-side API calls to an attacker-controlled server.

---

## localStorage Encryption

Source: `js/crypto.ts`

### Current Scheme (AES-GCM)

| Property | Value |
|----------|-------|
| Algorithm | AES-GCM |
| Key length | 256-bit |
| IV length | 96-bit (12 bytes), unique per encryption |
| Auth tag | 128-bit |
| Key generation | `crypto.subtle.generateKey()` (random) |
| Key storage | IndexedDB (`otplus-encryption-keys` db), non-extractable |
| Fallback key storage | In-memory (`globalThis`) when IndexedDB unavailable |
| Per-workspace keys | Each workspace gets its own encryption key |
| Key caching | In-memory `Map` for performance |

### Encrypted Data Format

```json
{
  "ct": "<base64-encoded ciphertext>",
  "iv": "<base64-encoded initialization vector>",
  "v": 1
}
```

### Legacy Scheme (PBKDF2) — Read-Only

Pre-2026 data was encrypted with workspace-ID-derived keys via PBKDF2 (100K iterations). This is **not cryptographically secure** because workspace IDs are not secret. The legacy path is retained read-only for backward compatibility. New encryptions always use random AES-GCM keys.

### Limitations

- Clearing site data removes IndexedDB keys, making encrypted data unreadable.
- In-memory fallback keys are lost on page reload.
- A `globalThis` key store is accessible to any same-origin script (logged as a security warning).

---

## CSV Injection Defense

Source: `js/export.ts` — `sanitizeFormulaInjection()`

### Attack Vector

CSV fields starting with `=`, `+`, `-`, `@`, tab, or carriage return can be interpreted as formulas by spreadsheet applications, enabling DDE injection or data exfiltration.

### Mitigation

1. Strip all control characters (`\p{Cc}`) and Unicode bidirectional markers.
2. If the value starts with a trigger character (`=`, `+`, `-`, `@`, `\t`, `\r`, `\n`, `|`), prepend a single quote (`'`).
3. Additionally, `escapeCsv()` in `js/utils.ts` wraps values in double quotes when they contain special characters.

This is the OWASP-recommended mitigation. The single quote is hidden by Excel/Sheets when displaying the cell.

---

## HTML Escaping (XSS Prevention)

Source: `js/utils.ts` — `escapeHtml()`

All untrusted strings are escaped before HTML insertion:

| Character | Replacement |
|-----------|-------------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` |
| `'` | `&#039;` |

Used throughout `js/ui/*.ts` modules when rendering user names, project names, descriptions, and other API-sourced data into the DOM.

---

## Known Trade-offs

### Broad CORS Patterns

`*.workers.dev` and `*.github.io` are allowed CORS origins (`worker/src/auth.ts`). This is intentionally broad for addon distribution flexibility. To tighten:
- Pin to specific GitHub Pages subdomain (e.g. `https://youruser.github.io`).
- Pin to specific Workers subdomain (e.g. `https://otplus-worker.youraccount.workers.dev`).

### postMessage('*') Target Origin

Token refresh via `postMessage` uses `'*'` as the target origin (`js/main.ts`). This is the standard Clockify iframe communication pattern. Security is maintained because:
- Inbound messages are validated via `isAllowedOrigin()` before processing.
- Only messages with valid JWT structure are accepted.
- The token is re-validated (RSA256 + claims) before being applied.

### Worker Dev-Dependency Vulnerabilities

The Worker's dev dependency `undici` (via miniflare/wrangler) has known vulnerabilities. This is tooling-only and not included in the production Worker runtime. Mitigate with periodic `npm --prefix worker audit fix`.

### Worker RSA256 Test Coverage

Worker RSA256 tests mock `crypto.subtle` exclusively. There is no integration test with real cryptographic operations. The Worker runtime's Web Crypto API is trusted, but a real-key integration test would increase confidence.
