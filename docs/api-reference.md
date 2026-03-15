# API Reference

Complete HTTP API reference for the OTPLUS Cloudflare Worker.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [CORS Policy](#cors-policy)
- [Config Endpoints](#config-endpoints)
- [Override Endpoints](#override-endpoints)
- [Lifecycle Endpoints](#lifecycle-endpoints)
- [Static Proxy](#static-proxy)
- [Security Headers](#security-headers)
- [Error Response Format](#error-response-format)

---

## Overview

The Worker serves as a unified entry point for OTPLUS, handling three categories of requests:

1. **Lifecycle webhooks** (`/lifecycle/*`) — Clockify install/uninstall events.
2. **API endpoints** (`/api/*`) — CRUD for workspace config and user overrides.
3. **Static proxy** (everything else) — Reverse proxy to GitHub Pages.

**Base URL pattern**: `https://<worker-name>.<account>.workers.dev`

**Routing order** (from `worker/src/index.ts`):

```
OPTIONS    → 204 with CORS headers
POST /lifecycle/* → lifecycle handlers
/api/*     → API CRUD handlers
*          → proxy to GitHub Pages
```

---

## Authentication

The Worker accepts JWT tokens in two header formats:

| Header | Format | Example |
|--------|--------|---------|
| `Authorization` | `Bearer <jwt>` | `Authorization: Bearer eyJ...` |
| `X-Addon-Token` | `<jwt>` | `X-Addon-Token: eyJ...` |

### JWT Verification

**API endpoints** (`/api/*`) use `extractAndVerifyJwt()` which:

1. Extracts the JWT from either header.
2. Verifies RSA256 signature using Clockify's embedded public key.
3. Decodes and normalizes alias claims (`activeWs` → `workspaceId`, `apiUrl`/`baseURL`/`baseUrl` → `backendUrl`).
4. Requires `workspaceId` to be present.

**Lifecycle endpoints** (`/lifecycle/*`) use separate authentication — see [Lifecycle Endpoints](#lifecycle-endpoints).

### Admin Role Check

Write operations (`PUT`) additionally verify that the user holds `WORKSPACE_ADMIN` or `OWNER` role via an outbound Clockify API call:

```
GET {backendUrl}/v1/workspaces/{workspaceId}/users/{userId}
```

This call uses the installation token stored in KV (not the user's JWT) and validates the `backendUrl` against the Clockify domain allowlist to prevent SSRF.

---

## CORS Policy

Defined in `worker/src/auth.ts`.

### Allowed Origins

| Pattern | Description |
|---------|-------------|
| `https://app.clockify.me` | Main Clockify app |
| `https://clockify.me` | Clockify domain |
| `https://{cc}.app.clockify.me` | Regional subdomains (2-letter country code) |
| `https://{cc}.clockify.me` | Regional Clockify domains |
| `https://*.github.io` | Any GitHub Pages deployment |
| `https://*.*.workers.dev` | Any Cloudflare Workers subdomain |

### Localhost (Environment-Gated)

Localhost origins (`http://localhost`, `http://localhost:{port}`) are only allowed when the `ENVIRONMENT` binding is **not** `"production"`. In production, localhost is blocked to prevent malicious local pages from making credentialed cross-origin requests.

### CORS Headers

Returned on all responses when origin matches:

```
Access-Control-Allow-Origin: <matched-origin>
Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Addon-Token
Vary: Origin
```

---

## Config Endpoints

### GET /api/config

Retrieves the workspace overtime configuration.

| Property | Value |
|----------|-------|
| **Auth** | RSA256-verified JWT (any authenticated workspace member) |
| **Admin required** | No |

**Success Response (200)**:

```json
{
  "config": { ... },
  "calcParams": { ... },
  "schemaVersion": 1,
  "updatedAt": "2026-01-15T10:30:00.000Z",
  "updatedBy": "user-id"
}
```

**No config set (200)**:

```json
{
  "config": null,
  "message": "No config set for this workspace"
}
```

**Error Responses**:

| Status | Condition |
|--------|-----------|
| 401 | Invalid or missing JWT |
| 500 | Corrupted config data in KV |

---

### PUT /api/config

Creates or updates the workspace overtime configuration.

| Property | Value |
|----------|-------|
| **Auth** | RSA256-verified JWT |
| **Admin required** | Yes (WORKSPACE_ADMIN or OWNER) |

**Request Body**:

```json
{
  "config": {
    "useProfileCapacity": true,
    "useProfileWorkingDays": true,
    "applyHolidays": true,
    "applyTimeOff": true,
    "showBillableBreakdown": true,
    "showDecimalTime": false,
    "enableTieredOT": false,
    "amountDisplay": "earned",
    "overtimeBasis": "daily"
  },
  "calcParams": {
    "dailyThreshold": 8,
    "weeklyThreshold": 40,
    "overtimeMultiplier": 1.5,
    "tier2ThresholdHours": 0,
    "tier2Multiplier": 2.0
  }
}
```

**Validation**:

- `config`: All 9 fields required. 7 booleans + `amountDisplay` enum (`earned`/`cost`/`profit`) + `overtimeBasis` enum (`daily`/`weekly`/`both`).
- `calcParams`: All 5 numeric fields required with ranges: `dailyThreshold` (0–24), `weeklyThreshold` (0–168), `overtimeMultiplier` (0–100), `tier2ThresholdHours` (0–168), `tier2Multiplier` (0–100).

**Success Response (200)**:

```json
{ "status": "saved" }
```

**Error Responses**:

| Status | Condition |
|--------|-----------|
| 400 | Missing `backendUrl` in token, invalid JSON, missing fields, failed validation |
| 401 | Invalid or missing JWT |
| 403 | User is not workspace admin |

---

## Override Endpoints

### GET /api/overrides

Retrieves per-user calculation overrides.

| Property | Value |
|----------|-------|
| **Auth** | RSA256-verified JWT (any authenticated member) |
| **Admin required** | No |

**Success Response (200)**:

```json
{
  "overrides": {
    "user-id-1": { "mode": "global", "capacity": 7.5 },
    "user-id-2": { "mode": "weekly", "weeklyOverrides": { ... } }
  },
  "schemaVersion": 1,
  "updatedAt": "2026-01-15T10:30:00.000Z",
  "updatedBy": "user-id"
}
```

**No overrides set (200)**:

```json
{ "overrides": {} }
```

**Error Responses**:

| Status | Condition |
|--------|-----------|
| 401 | Invalid or missing JWT |
| 500 | Corrupted overrides data in KV |

---

### PUT /api/overrides

Creates or updates per-user calculation overrides.

| Property | Value |
|----------|-------|
| **Auth** | RSA256-verified JWT |
| **Admin required** | Yes (WORKSPACE_ADMIN or OWNER) |

**Request Body**:

```json
{
  "overrides": {
    "user-id-1": {
      "mode": "global",
      "capacity": 7.5,
      "multiplier": 2.0
    },
    "user-id-2": {
      "mode": "weekly",
      "weeklyOverrides": {
        "MONDAY": { "capacity": 8 },
        "FRIDAY": { "capacity": 6 }
      }
    }
  }
}
```

**Validation per user override**:

- `mode` (optional): must be `"global"`, `"weekly"`, or `"perDay"`.
- Numeric fields: validated against `OVERRIDE_BOUNDS` (capacity: 0–24, multiplier: 1–5, tier2Threshold: 0–24, tier2Multiplier: 1–5).
- `weeklyOverrides` (optional): object keyed by weekday, each value validated against bounds.
- `perDayOverrides` (optional): object keyed by ISO date, each value validated against bounds.

**Success Response (200)**:

```json
{ "status": "saved" }
```

**Error Responses**:

| Status | Condition |
|--------|-----------|
| 400 | Invalid JSON, missing `overrides` key, invalid override structure/values |
| 401 | Invalid or missing JWT |
| 403 | User is not workspace admin |

---

## Lifecycle Endpoints

### POST /lifecycle/installed

Called by Clockify when a workspace installs the addon.

**Authentication**: Three-tier approach (any one passing is sufficient):

1. **`Clockify-Signature` header** — RSA256-verified JWT. Checks claims: `iss=clockify`, `type=addon`, `sub=overtime-summary`, `exp` not passed. Cross-checks `workspaceId` against payload body.

2. **`authToken` JWT signature** — The installation token in the request body is verified via RSA256. Checks `iss=clockify` and expiration.

3. **Outbound API call** (last resort) — `GET {apiUrl}/v1/workspaces/{workspaceId}` using the provided `authToken`. Tries multiple URL candidates. Depends on Worker-to-Clockify connectivity.

**Request Body** (`InstalledPayload`):

```json
{
  "addonId": "addon-id",
  "authToken": "jwt-string",
  "workspaceId": "workspace-id",
  "asUser": "user-id",
  "apiUrl": "https://api.clockify.me/api",
  "addonUserId": "addon-user-id"
}
```

**On success**:

1. Stores `authToken` in KV at `ws:{workspaceId}:token`.
2. Creates default `WorkspaceConfig` at `ws:{workspaceId}:config` (only if no existing config — preserves admin customizations on re-install).

**Success Response (200)**:

```json
{ "status": "installed" }
```

**Error Responses**:

| Status | Condition |
|--------|-----------|
| 400 | Invalid JSON, missing `workspaceId` or `authToken` |
| 401 | All three auth tiers failed, or `workspaceId` mismatch |

---

### POST /lifecycle/deleted

Called by Clockify when a workspace uninstalls the addon.

**Authentication**: Requires valid `Clockify-Signature` header (RSA256-verified).

**Request Body**:

```json
{
  "workspaceId": "workspace-id"
}
```

Uses `workspaceId` from the signature if available (more trustworthy than unsigned body). Cross-checks if both are present.

**On success**, deletes all three workspace KV keys:

- `ws:{workspaceId}:token`
- `ws:{workspaceId}:config`
- `ws:{workspaceId}:overrides`

**Success Response (200)**:

```json
{ "status": "deleted" }
```

**Error Responses**:

| Status | Condition |
|--------|-----------|
| 400 | Invalid JSON, missing `workspaceId` |
| 401 | Invalid or missing lifecycle signature, `workspaceId` mismatch |

---

## Static Proxy

All requests not matching `/lifecycle/*` or `/api/*` are reverse-proxied to GitHub Pages.

### Cache-Control Strategy

| Resource | Cache-Control |
|----------|--------------|
| HTML pages (`/`, `*.html`) | `no-cache, no-store, must-revalidate` |
| Manifest (`/manifest.json`) | `no-cache, no-store, must-revalidate` |
| JS, CSS, images, other | `public, max-age=300` (5 minutes) |

### Path Rewriting

- `/manifest` → `/manifest.json` (for Clockify marketplace compatibility)

---

## Security Headers

Applied to all responses via `withSecurityHeaders()` in `worker/src/index.ts`.

| Header | Value | Scope |
|--------|-------|-------|
| `X-Content-Type-Options` | `nosniff` | All responses |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | All responses |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | All responses |
| `X-Frame-Options` | `DENY` | API and lifecycle responses only |

HTML proxy responses omit `X-Frame-Options` so the addon can load inside Clockify's iframe.

---

## Error Response Format

All API errors return JSON with the following structure:

```json
{
  "error": "Human-readable error description"
}
```

Standard HTTP status codes are used:

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad request (validation failure, missing fields, invalid JSON) |
| 401 | Unauthorized (invalid/missing JWT, failed signature) |
| 403 | Forbidden (admin access required) |
| 404 | Not found (unknown API route or lifecycle event) |
| 500 | Internal server error (corrupted KV data) |
