/**
 * @fileoverview Cloudflare Worker entry point and request router.
 *
 * Handles CORS preflight, routes requests to lifecycle handlers
 * (`/lifecycle/*`), API CRUD endpoints (`/api/*`), or proxies static assets
 * from GitHub Pages.  Applies security headers to all responses.
 */

import type { Env } from './types';
import { handleInstalled, handleDeleted } from './lifecycle';
import { handleConfigGet, handleConfigPut, handleOverridesGet, handleOverridesPut } from './api-routes';
import { corsHeaders, errorResponse } from './auth';

/**
 * Returns a set of security headers to merge into every response.
 *
 * API and JSON responses include `X-Frame-Options: DENY` to prevent
 * click-jacking.  Proxied HTML responses omit it so the addon can load
 * inside Clockify's iframe.
 *
 * @param isApi - Whether the response is for an API/lifecycle endpoint
 *                (as opposed to a proxied static asset).
 * @returns Header name/value map.
 */
function securityHeaders(isApi: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  };
  // API/JSON responses should never be framed; proxied HTML must allow Clockify iframe
  if (isApi) {
    headers['X-Frame-Options'] = 'DENY';
  }
  return headers;
}

/**
 * Clones a Response with additional security headers merged in.
 *
 * @param response - The original Response to augment.
 * @param isApi    - Whether to include `X-Frame-Options: DENY`.
 * @returns A new Response with security headers applied.
 */
function withSecurityHeaders(response: Response, isApi: boolean): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders(isApi))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Cloudflare Worker fetch handler — the sole entry point for all HTTP
 * requests hitting this Worker.
 *
 * Routing order:
 * 1. **CORS preflight** (`OPTIONS`) — returns `204` with CORS + security headers.
 * 2. **Lifecycle webhooks** (`POST /lifecycle/*`) — delegates to install/delete handlers.
 * 3. **API endpoints** (`/api/*`) — delegates to CRUD route handlers.
 * 4. **Static proxy** (everything else) — reverse-proxies to GitHub Pages.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- CORS preflight ---
    // Respond immediately with 204 (no body) plus CORS and security headers.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(request, env.ENVIRONMENT), ...securityHeaders(true) } });
    }

    // --- Lifecycle webhook routes (POST only) ---
    // Clockify sends INSTALLED and DELETED events here when a workspace
    // installs or removes the addon.
    if (url.pathname.startsWith('/lifecycle/') && request.method === 'POST') {
      let response: Response;
      if (url.pathname === '/lifecycle/installed') {
        response = await handleInstalled(request, env);
      } else if (url.pathname === '/lifecycle/deleted') {
        response = await handleDeleted(request, env);
      } else {
        response = errorResponse('Unknown lifecycle event', 404, request, env.ENVIRONMENT);
      }
      return withSecurityHeaders(response, true);
    }

    // --- API CRUD routes ---
    // Frontend reads/writes workspace config and per-user overrides via
    // these endpoints.  JWT RSA256 verification + admin checks happen
    // inside each handler.
    if (url.pathname.startsWith('/api/')) {
      const response = await handleApi(request, env, url.pathname);
      return withSecurityHeaders(response, true);
    }

    // --- Static asset proxy (fallback) ---
    // All other paths are reverse-proxied to the GitHub Pages origin so that
    // the Worker URL can serve the full frontend without a separate domain.
    const response = await proxyToGitHubPages(request, env, url);
    return withSecurityHeaders(response, false);
  },
} satisfies ExportedHandler<Env>;

/**
 * Dispatches an API request to the correct CRUD handler based on path and
 * HTTP method.
 *
 * @param request - The incoming HTTP request.
 * @param env     - Worker environment bindings.
 * @param path    - The URL pathname (e.g. "/api/config").
 * @returns The handler's Response, or a 404 if no route matches.
 */
async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/config' && request.method === 'GET') return handleConfigGet(request, env);
  if (path === '/api/config' && request.method === 'PUT') return handleConfigPut(request, env);
  if (path === '/api/overrides' && request.method === 'GET') return handleOverridesGet(request, env);
  if (path === '/api/overrides' && request.method === 'PUT') return handleOverridesPut(request, env);
  return errorResponse('Not found', 404, request, env.ENVIRONMENT);
}

/**
 * Reverse-proxies a request to the GitHub Pages origin.
 *
 * Cache-control strategy:
 * - **HTML pages and the manifest** (`/`, `*.html`, `/manifest.json`):
 *   `no-cache, no-store, must-revalidate` — browsers always revalidate so
 *   addon updates propagate immediately.
 * - **All other assets** (JS, CSS, images): `public, max-age=300` (5 minutes)
 *   — short TTL balances performance with freshness.
 *
 * The `/manifest` path is rewritten to `/manifest.json` so that the
 * Clockify marketplace can fetch the manifest at the canonical path.
 *
 * @param _request - The original incoming request (unused; we build a fresh fetch).
 * @param env      - Worker environment bindings (provides GITHUB_PAGES_ORIGIN).
 * @param url      - Parsed URL of the incoming request.
 * @returns The proxied Response with adjusted cache-control headers.
 */
async function proxyToGitHubPages(_request: Request, env: Env, url: URL): Promise<Response> {
  // Rewrite "/manifest" to "/manifest.json" for Clockify marketplace compatibility
  const proxiedPath = url.pathname === '/manifest' ? '/manifest.json' : url.pathname;
  const target = `${env.GITHUB_PAGES_ORIGIN}${proxiedPath}${url.search}`;
  const response = await fetch(target, { cf: { cacheTtl: 0 } });
  const headers = new Headers(response.headers);
  const isHtml = url.pathname === '/' || url.pathname.endsWith('.html');
  const isManifest = proxiedPath === '/manifest.json';

  // HTML and manifest: never cache — ensures addon updates propagate immediately.
  // Everything else (JS/CSS/images): cache for 5 minutes to reduce origin load.
  headers.set(
    'Cache-Control',
    (isHtml || isManifest) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300',
  );
  if (isManifest && response.ok) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  return new Response(response.body, { status: response.status, headers });
}
