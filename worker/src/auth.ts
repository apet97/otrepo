import type { Env, JwtPayload } from './types';

/** Addon manifest key — must match the `key` field in manifest.json */
const ADDON_MANIFEST_KEY = 'overtime-summary';

/**
 * Clockify's X.509 RSA256 public key for JWT signature verification.
 * Source: https://dev-docs.marketplace.cake.com/clockify/build/authentication-and-authorization
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
 * Prevents SSRF by rejecting requests to attacker-controlled URLs.
 */
const ALLOWED_CLOCKIFY_HOSTS = ['api.clockify.me', 'global.api.clockify.me'] as const;
const DEFAULT_INSTALL_TOKEN_API_BASES = [
  'https://developer.clockify.me/api',
  'https://api.clockify.me/api',
  'https://global.api.clockify.me/api',
] as const;

/** Returns true if the URL points to an allowed Clockify API host over HTTPS. */
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
 * - https://api.clockify.me/api
 * - https://api.clockify.me
 * - https://developer.clockify.me/api
 * - https://developer.clockify.me
 *
 * The Worker should verify installation tokens against the API endpoint shape
 * used by the app itself: {base}/v1/workspaces/{workspaceId}
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

/** Convert PEM-encoded X.509 public key to ArrayBuffer for use with SubtleCrypto. */
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

/** Decode a base64url string to Uint8Array. */
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
 * Uses the Web Crypto API (SubtleCrypto) available in Cloudflare Workers.
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
 * Decode a JWT token (no signature verification — Clockify signs these,
 * and we trust the iframe auth_token for user identity).
 */
export function decodeJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

  // Normalize alias claims (mirrors frontend normalizeTokenClaims in main.ts)
  if (!payload.workspaceId && typeof payload.activeWs === 'string' && payload.activeWs.trim()) {
    payload.workspaceId = payload.activeWs;
  }

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
 * Extract and decode the JWT from Authorization header or X-Addon-Token header.
 * Does NOT verify the signature — use extractAndVerifyJwt() for authenticated routes.
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
 * Extract and cryptographically verify a JWT from request headers using Clockify's RSA256 key.
 *
 * Unlike extractJwt(), this function verifies the signature before trusting any claims.
 * An attacker who sends a forged JWT (even with valid structure and plausible claims) will
 * be rejected because they cannot produce a valid RSA256 signature.
 *
 * Use this for all API endpoints that make access-control decisions based on workspaceId
 * or userId from the token.
 *
 * @throws Error if no token is present, if the signature is invalid, or if claims are missing
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
 * Verifies an authToken JWT's RSA256 signature and basic claims.
 *
 * The installation token from the INSTALLED lifecycle payload is a Clockify-signed JWT.
 * Verifying its RSA256 signature directly is more reliable than making an outbound API
 * call (verifyInstallToken), which depends on Worker→Clockify network connectivity.
 *
 * Only checks iss=clockify; installation tokens may have different type/sub claims
 * than user tokens, so those are not enforced here.
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
 * Verifies the Clockify-Signature header JWT for lifecycle and webhook events.
 *
 * Performs full verification:
 * 1. RSA256 signature check using Clockify's public key (Web Crypto API)
 * 2. Claims validation: iss=clockify, type=addon, sub={addonKey}, exp not passed
 *
 * @param request - The incoming HTTP request
 * @param addonKey - The addon manifest key to validate against the `sub` claim
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
 * Verifies an installation token is authentic by calling the Clockify API.
 * Used during the INSTALLED lifecycle to prevent forged installation tokens.
 *
 * @param apiUrl - The Clockify API URL from the lifecycle payload (validated against allowlist)
 * @param workspaceId - The workspace ID to verify against
 * @param authToken - The installation token to verify
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
 * Check if a user is a workspace admin by calling the Clockify API.
 * Uses the installation token stored in KV to make the API call.
 *
 * Validates backendUrl against the allowlist to prevent SSRF attacks.
 */
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

/** Allowed CORS origin patterns (production). */
const CORS_ALLOWED_PATTERNS: readonly (string | RegExp)[] = [
  'https://app.clockify.me',
  'https://clockify.me',
  /^https:\/\/[a-z]{2}\.app\.clockify\.me$/,
  /^https:\/\/[a-z]{2}\.clockify\.me$/,
  /^https:\/\/[\w-]+\.github\.io$/,
  /^https:\/\/[\w-]+\.[\w-]+\.workers\.dev$/,
];

/** Additional patterns allowed only in non-production environments. */
const DEV_ONLY_PATTERNS: readonly RegExp[] = [
  /^http:\/\/localhost(:\d+)?$/,
];

/** Returns true if the origin is in the CORS allowlist. Localhost is only allowed in non-production. */
export function isAllowedCorsOrigin(origin: string, environment?: string): boolean {
  const allowDev = environment !== undefined && environment !== 'production';
  const patterns: readonly (string | RegExp)[] =
    allowDev ? [...CORS_ALLOWED_PATTERNS, ...DEV_ONLY_PATTERNS] : CORS_ALLOWED_PATTERNS;
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? origin === pattern : pattern.test(origin)
  );
}

/** Standard CORS headers for API responses. Returns origin-specific header if allowed. */
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

/** JSON response helper. */
export function jsonResponse(data: unknown, status = 200, request?: Request, environment?: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, environment) },
  });
}

/** Error response helper. */
export function errorResponse(message: string, status = 400, request?: Request, environment?: string): Response {
  return jsonResponse({ error: message }, status, request, environment);
}
