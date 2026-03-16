/**
 * @fileoverview Authentication, authorization, and CORS utilities for the
 * Cloudflare Worker.
 *
 * Handles JWT decoding with alias normalization, RSA256 signature
 * verification using Clockify's public key, lifecycle webhook signature
 * checking, and CORS origin allowlisting.
 */

import type { Env, JwtPayload } from './types';

/** Addon manifest key — must match the `key` field in manifest.json */
const ADDON_MANIFEST_KEY = 'overtime-summary';

/**
 * Clockify's X.509 RSA256 public key for JWT signature verification.
 *
 * This key is used by `verifyRsa256()` to validate that a JWT was genuinely
 * signed by Clockify.  Imported into Web Crypto as an SPKI key.
 *
 * @see https://dev-docs.marketplace.cake.com/clockify/build/authentication-and-authorization
 */
const CLOCKIFY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAubktufFNO/op+E5WBWL6
/Y9QRZGSGGCsV00FmPRl5A0mSfQu3yq2Yaq47IlN0zgFy9IUG8/JJfwiehsmbrKa
49t/xSkpG1u9w1GUyY0g4eKDUwofHKAt3IPw0St4qsWLK9mO+koUo56CGQOEpTui
5bMfmefVBBfShXTaZOtXPB349FdzSuYlU/5o3L12zVWMutNhiJCKyGfsuu2uXa9+
6uQnZBw1wO3/QEci7i4TbC+ZXqW1rCcbogSMORqHAP6qSAcTFRmrjFAEsOWiUUhZ
rLDg2QJ8VTDghFnUhYklNTJlGgfo80qEWe1NLIwvZj0h3bWRfrqZHsD/Yjh0duk6
yQIDAQAB
-----END PUBLIC KEY-----`;

/**
 * Allowed Clockify API hostnames.
 * Used by `isAllowedClockifyUrl()` to prevent SSRF by rejecting requests
 * to attacker-controlled URLs.
 */
const ALLOWED_CLOCKIFY_HOSTS = ['api.clockify.me', 'global.api.clockify.me'] as const;

/**
 * Default Clockify API base URLs tried when the lifecycle payload omits
 * `apiUrl`.  Each candidate is expanded via `getClockifyApiBaseCandidates()`
 * before being used for install-token verification.
 */
const DEFAULT_INSTALL_TOKEN_API_BASES = [
  'https://developer.clockify.me/api',
  'https://api.clockify.me/api',
  'https://global.api.clockify.me/api',
] as const;

/**
 * Returns true if the URL points to an allowed Clockify API host over HTTPS.
 *
 * Accepts any `*.clockify.me` hostname as a convenience, but the explicit
 * `ALLOWED_CLOCKIFY_HOSTS` list is checked first for an exact match.
 *
 * @param url - The URL string to validate.
 * @returns `true` if the URL is HTTPS and targets a Clockify domain.
 */
export function isAllowedClockifyUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return (ALLOWED_CLOCKIFY_HOSTS as readonly string[]).includes(hostname) ||
      hostname.endsWith('.clockify.me');
  } catch {
    return false;
  }
}

/**
 * Normalizes a Clockify API base URL into one or more candidate base URLs.
 *
 * Clockify surfaces slightly different URL shapes across environments:
 * - `https://api.clockify.me/api`
 * - `https://api.clockify.me`
 * - `https://developer.clockify.me/api`
 * - `https://developer.clockify.me`
 *
 * The Worker should verify installation tokens against the API endpoint shape
 * used by the app itself: `{base}/v1/workspaces/{workspaceId}`.  This
 * function returns all plausible base URLs so the caller can try each.
 *
 * @param apiUrl - A raw Clockify API URL from a token or lifecycle payload.
 * @returns An array of normalized base URL candidates, or an empty array if
 *          the input is not an allowed Clockify URL.
 */
function getClockifyApiBaseCandidates(apiUrl: string): string[] {
  if (!isAllowedClockifyUrl(apiUrl)) return [];

  try {
    const parsed = new URL(apiUrl);
    const origin = parsed.origin;
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const candidates = new Set<string>();
    const addCandidate = (path: string) => {
      candidates.add(`${origin}${path}`);
    };

    // Canonical Clockify API base always ends with /api.
    if (!normalizedPath || normalizedPath === '/') {
      addCandidate('/api');
      addCandidate('');
    } else if (normalizedPath.endsWith('/api')) {
      addCandidate(normalizedPath);
    } else if (normalizedPath.endsWith('/api/v1')) {
      addCandidate(normalizedPath.replace(/\/v1$/, ''));
    } else {
      addCandidate(normalizedPath);
      addCandidate(`${normalizedPath}/api`);
    }

    return Array.from(candidates);
  } catch {
    return [];
  }
}

/**
 * Converts a PEM-encoded X.509 SPKI public key to an ArrayBuffer suitable
 * for `crypto.subtle.importKey()`.
 *
 * @param pem - PEM-encoded public key string (including header/footer lines).
 * @returns The raw DER-encoded key bytes.
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decodes a base64url-encoded string to a `Uint8Array`.
 *
 * JWT signatures use base64url encoding (RFC 7515), which replaces `+`
 * with `-` and `/` with `_` and omits padding.
 *
 * @param b64url - The base64url-encoded string.
 * @returns Decoded bytes.
 */
function base64UrlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verifies an RSA256 JWT signature using Clockify's X.509 public key.
 *
 * Uses the Web Crypto API (`crypto.subtle`) available in the Cloudflare
 * Workers runtime.  Returns `false` on any error (malformed token, crypto
 * failure, invalid signature) — never throws.
 *
 * @param token - The full compact-serialized JWT string (`header.payload.signature`).
 * @returns `true` if the signature is valid; `false` otherwise.
 */
async function verifyRsa256(token: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const keyBuffer = pemToArrayBuffer(CLOCKIFY_PUBLIC_KEY_PEM);
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]).buffer as ArrayBuffer;

    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      cryptoKey,
      signature,
      signingInput
    );
  } catch {
    return false;
  }
}

/**
 * Decodes a JWT token without verifying its cryptographic signature.
 *
 * Performs **alias normalization** so that tokens from different Clockify
 * environments (developer portal, production, regional) expose a consistent
 * claim shape:
 *
 * - `activeWs` is mapped to `workspaceId` (legacy developer-portal tokens
 *   use `activeWs` instead of `workspaceId`).
 * - `apiUrl`, `baseURL`, or `baseUrl` are mapped to `backendUrl` with the
 *   pathname normalized to always end with `/api` (e.g.
 *   `https://api.clockify.me` becomes `https://api.clockify.me/api`).
 *
 * This mirrors the frontend's `normalizeTokenClaims` logic in `main.ts`.
 *
 * @param token - The compact-serialized JWT string.
 * @returns Decoded and normalized JWT payload.
 * @throws {Error} If the token format is invalid or `workspaceId` is missing
 *         after normalization.
 */
export function decodeJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

  // --- Alias normalization (mirrors frontend normalizeTokenClaims in main.ts) ---

  // Map legacy "activeWs" claim to canonical "workspaceId"
  if (!payload.workspaceId && typeof payload.activeWs === 'string' && payload.activeWs.trim()) {
    payload.workspaceId = payload.activeWs;
  }

  // Map legacy backend URL aliases (apiUrl, baseURL, baseUrl) to canonical "backendUrl".
  // Normalize the pathname so it always ends with "/api" for consistent downstream usage.
  if (!payload.backendUrl) {
    const legacy =
      (typeof payload.apiUrl === 'string' && payload.apiUrl.trim()) ? payload.apiUrl :
      (typeof payload.baseURL === 'string' && payload.baseURL.trim()) ? payload.baseURL :
      (typeof payload.baseUrl === 'string' && payload.baseUrl.trim()) ? payload.baseUrl :
      undefined;
    if (legacy) {
      try {
        const parsed = new URL(legacy);
        let pathname = parsed.pathname.replace(/\/+$/, '');
        if (!pathname || pathname === '/') pathname = '/api';
        else if (pathname.endsWith('/api/v1')) pathname = pathname.replace(/\/v1$/, '');
        else if (!pathname.endsWith('/api')) pathname = `${pathname}/api`;
        payload.backendUrl = `${parsed.origin}${pathname}`;
      } catch {
        payload.backendUrl = legacy;
      }
    }
  }

  if (!payload.workspaceId) throw new Error('Missing workspaceId in JWT');

  return payload as JwtPayload;
}

/**
 * Extracts and decodes a JWT from the `Authorization` or `X-Addon-Token`
 * request header.
 *
 * **Does NOT verify the signature** — use {@link extractAndVerifyJwt} for
 * any endpoint that makes access-control decisions based on token claims.
 *
 * @param request - The incoming HTTP request.
 * @returns The decoded JWT payload with alias normalization applied.
 * @throws {Error} If neither `Authorization: Bearer …` nor `X-Addon-Token`
 *         headers are present.
 */
export function extractJwt(request: Request): JwtPayload {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return decodeJwt(authHeader.slice(7));
  }

  const addonToken = request.headers.get('X-Addon-Token');
  if (addonToken) {
    return decodeJwt(addonToken);
  }

  throw new Error('No auth token provided');
}

/**
 * Extracts and **cryptographically verifies** a JWT from request headers
 * using Clockify's RSA256 public key.
 *
 * Unlike {@link extractJwt}, this function calls `verifyRsa256()` before
 * trusting any claims.  An attacker who sends a forged JWT (even with valid
 * structure and plausible claims) will be rejected because they cannot
 * produce a valid RSA256 signature.
 *
 * Use this for **all API endpoints** that make access-control decisions
 * based on `workspaceId` or `userId` from the token.
 *
 * @param request - The incoming HTTP request containing the JWT in an
 *                  `Authorization: Bearer …` or `X-Addon-Token` header.
 * @returns The decoded and verified JWT payload.
 * @throws {Error} If no token is present, if the signature is invalid, or
 *         if required claims are missing.
 */
export async function extractAndVerifyJwt(request: Request): Promise<JwtPayload> {
  let token: string;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const addonToken = request.headers.get('X-Addon-Token');
    if (addonToken) {
      token = addonToken;
    } else {
      throw new Error('No auth token provided');
    }
  }

  const signatureValid = await verifyRsa256(token);
  if (!signatureValid) {
    throw new Error('Invalid token signature');
  }

  return decodeJwt(token);
}

/**
 * Verifies an installation `authToken` JWT's RSA256 signature and basic
 * claims.
 *
 * The installation token from the INSTALLED lifecycle payload is a
 * Clockify-signed JWT.  Verifying its RSA256 signature directly is more
 * reliable than making an outbound API call ({@link verifyInstallToken}),
 * which depends on Worker-to-Clockify network connectivity.
 *
 * Only checks `iss=clockify`; installation tokens may have different
 * `type`/`sub` claims than user tokens, so those are not enforced here.
 *
 * @param token - The raw JWT string from `InstalledPayload.authToken`.
 * @returns `true` if the signature and basic claims are valid; `false` otherwise.
 */
export async function verifyAuthTokenSignature(token: string): Promise<boolean> {
  const signatureValid = await verifyRsa256(token);
  if (!signatureValid) return false;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;

    if (payload.iss !== 'clockify') return false;
    // Installation tokens do not expire, but check if present
    if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies the `Clockify-Signature` header JWT for lifecycle and webhook
 * events.
 *
 * Performs full verification:
 * 1. **RSA256 signature check** using Clockify's public key (Web Crypto API).
 * 2. **Claims validation**: `iss=clockify`, `type=addon`, `sub={addonKey}`,
 *    `exp` not passed.
 *
 * @param request  - The incoming HTTP request.
 * @param addonKey - The addon manifest key to validate against the `sub`
 *                   claim.  Defaults to `ADDON_MANIFEST_KEY`.
 * @returns An object with `valid: true` and optional `workspaceId` on
 *          success, or `{ valid: false }` on any failure.
 */
export async function verifyLifecycleSignature(
  request: Request,
  addonKey: string = ADDON_MANIFEST_KEY
): Promise<{ valid: boolean; workspaceId?: string }> {
  const signatureHeader = request.headers.get('Clockify-Signature');
  if (!signatureHeader) return { valid: false };

  try {
    const parts = signatureHeader.split('.');
    if (parts.length !== 3) return { valid: false };

    // Verify RSA256 signature before trusting any claims
    const signatureValid = await verifyRsa256(signatureHeader);
    if (!signatureValid) return { valid: false };

    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;

    // Verify required claims per Clockify docs
    if (payload.iss !== 'clockify') return { valid: false };
    if (payload.type !== 'addon') return { valid: false };
    if (payload.sub !== addonKey) return { valid: false };

    // Check expiration
    if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) {
      return { valid: false };
    }

    return {
      valid: true,
      workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Verifies an installation token is authentic by making an outbound API
 * call to the Clockify API.
 *
 * This is the **last-resort fallback** in the three-tier authentication
 * approach used during the INSTALLED lifecycle:
 * 1. `Clockify-Signature` header RSA256 verification (fastest, no network).
 * 2. `authToken` JWT RSA256 signature check (fast, no network).
 * 3. **This function** — outbound `GET /v1/workspaces/{id}` call (slowest,
 *    depends on Worker-to-Clockify connectivity).
 *
 * Tries all normalized API base URL candidates derived from `apiUrl`
 * (or the defaults) until one returns a JSON 200.  HTML 200 responses are
 * ignored because certain developer-portal paths can return HTML success
 * pages.
 *
 * @param apiUrl      - The Clockify API URL from the lifecycle payload
 *                      (validated against the allowlist).  May be undefined.
 * @param workspaceId - The workspace ID to verify against.
 * @param authToken   - The installation token to verify via API call.
 * @returns `true` if any candidate base URL returned a valid JSON 200.
 */
export async function verifyInstallToken(
  apiUrl: string | undefined,
  workspaceId: string,
  authToken: string
): Promise<boolean> {
  let candidateBases: string[];
  if (apiUrl && apiUrl.trim()) {
    candidateBases = getClockifyApiBaseCandidates(apiUrl);
  } else {
    candidateBases = Array.from(new Set(
      DEFAULT_INSTALL_TOKEN_API_BASES
        .flatMap((base) => getClockifyApiBaseCandidates(base))
    ));
  }

  if (candidateBases.length === 0) return false;

  for (const base of candidateBases) {
    try {
      const response = await fetch(`${base}/v1/workspaces/${workspaceId}`, {
        headers: { 'X-Addon-Token': authToken },
      });

      if (!response.ok) continue;

      // Wrong developer-portal paths can return HTML 200 pages; do not treat those as success.
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType && !contentType.includes('application/json')) {
        continue;
      }

      return true;
    } catch {
      // Try the next normalized candidate before giving up.
    }
  }

  return false;
}

/**
 * Checks whether a user holds the WORKSPACE_ADMIN or OWNER role in a
 * Clockify workspace.
 *
 * Makes an outbound API call using the installation token stored in KV.
 * The `backendUrl` is validated against the Clockify domain allowlist to
 * prevent SSRF attacks where a forged JWT could redirect the Worker to an
 * attacker-controlled server.
 *
 * @param env         - Worker environment bindings (provides KV access).
 * @param workspaceId - The workspace to check membership in.
 * @param userId      - The Clockify user ID to look up.
 * @param backendUrl  - The Clockify API base URL from the user's JWT
 *                      (validated against the allowlist).
 * @returns `true` if the user is a workspace admin or owner; `false` on
 *          any error, missing token, or insufficient role.
 */
/** Roles that grant workspace-admin privileges in a verified JWT. */
const ADMIN_ROLES = ['WORKSPACE_ADMIN', 'OWNER'] as const;

/** Check whether a JWT `workspaceRole` claim represents an admin role. */
export function isAdminRole(role: string | undefined): boolean {
  return role != null && (ADMIN_ROLES as readonly string[]).includes(role);
}

export async function isWorkspaceAdmin(
  env: Env,
  workspaceId: string,
  userId: string,
  backendUrl: string
): Promise<boolean> {
  // Reject untrusted or non-Clockify backendUrl to prevent SSRF
  if (!isAllowedClockifyUrl(backendUrl)) return false;

  const installToken = await env.SETTINGS_KV.get(`ws:${workspaceId}:token`);
  if (!installToken) return false;

  try {
    const response = await fetch(
      `${backendUrl}/v1/workspaces/${workspaceId}/users/${userId}`,
      { headers: { 'X-Addon-Token': installToken } }
    );

    if (!response.ok) return false;

    const user = (await response.json()) as { roles?: Array<{ role?: string }>; status?: string };
    const roles = user.roles ?? [];
    return roles.some(
      (r) => r.role === 'WORKSPACE_ADMIN' || r.role === 'OWNER'
    );
  } catch {
    return false;
  }
}

/**
 * Allowed CORS origin patterns for production deployments.
 *
 * Includes:
 * - `https://app.clockify.me` and `https://clockify.me` — main Clockify app.
 * - Regional subdomains like `https://de.app.clockify.me`.
 * - `*.github.io` — allows any GitHub Pages deployment (addon distribution).
 * - `*.workers.dev` — allows any Cloudflare Workers subdomain (addon distribution).
 *
 * These broad patterns are acceptable for addon distribution; pin to
 * specific subdomains if tighter control is needed.
 */
const CORS_ALLOWED_PATTERNS: readonly (string | RegExp)[] = [
  'https://app.clockify.me',
  'https://clockify.me',
  /^https:\/\/[a-z]{2}\.app\.clockify\.me$/,
  /^https:\/\/[a-z]{2}\.clockify\.me$/,
  /^https:\/\/[\w-]+\.github\.io$/,
  /^https:\/\/[\w-]+\.[\w-]+\.workers\.dev$/,
];

/**
 * Additional CORS origin patterns allowed only in non-production
 * environments.
 *
 * Localhost is environment-gated because it would widen the attack surface
 * in production — a malicious page running on localhost could make
 * credentialed cross-origin requests to the Worker.  In development and
 * staging, localhost access is convenient for local testing.
 */
const DEV_ONLY_PATTERNS: readonly RegExp[] = [
  /^http:\/\/localhost(:\d+)?$/,
];

/**
 * Returns `true` if the given origin matches the CORS allowlist.
 *
 * Localhost origins are only permitted when `environment` is not
 * `"production"` (or is undefined), preventing accidental localhost CORS
 * in production deployments.
 *
 * @param origin      - The `Origin` header value from the request.
 * @param environment - The `ENVIRONMENT` binding (e.g. "production").
 * @returns `true` if the origin is allowed.
 */
export function isAllowedCorsOrigin(origin: string, environment?: string): boolean {
  const allowDev = environment !== undefined && environment !== 'production';
  const patterns: readonly (string | RegExp)[] =
    allowDev ? [...CORS_ALLOWED_PATTERNS, ...DEV_ONLY_PATTERNS] : CORS_ALLOWED_PATTERNS;
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? origin === pattern : pattern.test(origin)
  );
}

/**
 * Builds standard CORS response headers.
 *
 * If the request's `Origin` header matches the allowlist, the response
 * includes `Access-Control-Allow-Origin` set to that specific origin
 * (not `*`), along with a `Vary: Origin` header so caches key on origin.
 *
 * @param request     - The incoming HTTP request (used to read the `Origin` header).
 * @param environment - The `ENVIRONMENT` binding for localhost gating.
 * @returns A header name/value map to spread into the response.
 */
export function corsHeaders(request?: Request, environment?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Addon-Token',
  };
  const origin = request?.headers.get('Origin');
  if (origin && isAllowedCorsOrigin(origin, environment)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

/**
 * Creates a JSON {@link Response} with the given data and status code.
 *
 * Automatically includes CORS headers derived from the request origin.
 *
 * @param data        - The response body (will be JSON-stringified).
 * @param status      - HTTP status code (default `200`).
 * @param request     - The original request (for CORS origin matching).
 * @param environment - The `ENVIRONMENT` binding.
 * @returns A `Response` with `Content-Type: application/json` and CORS headers.
 */
export function jsonResponse(data: unknown, status = 200, request?: Request, environment?: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, environment) },
  });
}

/**
 * Creates a JSON error {@link Response} with an `{ error: message }` body.
 *
 * Convenience wrapper around {@link jsonResponse} for error paths.
 *
 * @param message     - Human-readable error description.
 * @param status      - HTTP status code (default `400`).
 * @param request     - The original request (for CORS origin matching).
 * @param environment - The `ENVIRONMENT` binding.
 * @returns A JSON error Response.
 */
export function errorResponse(message: string, status = 400, request?: Request, environment?: string): Response {
  return jsonResponse({ error: message }, status, request, environment);
}
