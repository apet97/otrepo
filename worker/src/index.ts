import type { Env } from './types';
import { handleInstalled, handleDeleted } from './lifecycle';
import { handleConfigGet, handleConfigPut, handleOverridesGet, handleOverridesPut } from './api-routes';
import { corsHeaders, errorResponse } from './auth';

/** Security headers applied to all responses. */
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

/** Applies security headers to a Response (creates a new response with merged headers). */
function withSecurityHeaders(response: Response, isApi: boolean): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders(isApi))) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(request, env.ENVIRONMENT), ...securityHeaders(true) } });
    }

    // Route: Lifecycle events (POST only)
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

    // Route: API endpoints
    if (url.pathname.startsWith('/api/')) {
      const response = await handleApi(request, env, url.pathname);
      return withSecurityHeaders(response, true);
    }

    // Route: Static proxy (everything else)
    const response = await proxyToGitHubPages(request, env, url);
    return withSecurityHeaders(response, false);
  },
} satisfies ExportedHandler<Env>;

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/config' && request.method === 'GET') return handleConfigGet(request, env);
  if (path === '/api/config' && request.method === 'PUT') return handleConfigPut(request, env);
  if (path === '/api/overrides' && request.method === 'GET') return handleOverridesGet(request, env);
  if (path === '/api/overrides' && request.method === 'PUT') return handleOverridesPut(request, env);
  return errorResponse('Not found', 404, request, env.ENVIRONMENT);
}

async function proxyToGitHubPages(_request: Request, env: Env, url: URL): Promise<Response> {
  const proxiedPath = url.pathname === '/manifest' ? '/manifest.json' : url.pathname;
  const target = `${env.GITHUB_PAGES_ORIGIN}${proxiedPath}${url.search}`;
  const response = await fetch(target, { cf: { cacheTtl: 0 } });
  const headers = new Headers(response.headers);
  const isHtml = url.pathname === '/' || url.pathname.endsWith('.html');
  const isManifest = proxiedPath === '/manifest.json';
  headers.set(
    'Cache-Control',
    (isHtml || isManifest) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300',
  );
  if (isManifest && response.ok) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  return new Response(response.body, { status: response.status, headers });
}
