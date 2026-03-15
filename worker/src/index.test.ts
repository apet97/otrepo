import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from './index';

function makeEnv() {
  return {
    SETTINGS_KV: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    GITHUB_PAGES_ORIGIN: 'https://example.github.io/otrepo',
  };
}

describe('worker routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves /manifest via the manifest.json asset on GitHub Pages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ key: 'overtime-summary' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.example.com/manifest'),
      makeEnv() as never
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.github.io/otrepo/manifest.json',
      { cf: { cacheTtl: 0 } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('preserves upstream Content-Type on non-OK manifest responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      '<html>404</html>',
      {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.example.com/manifest'),
      makeEnv() as never
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('includes HSTS header on all responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.example.com/'),
      makeEnv() as never
    );

    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
  });

  it('includes HSTS header on API responses', async () => {
    // OPTIONS preflight to avoid needing auth
    const response = await worker.fetch(
      new Request('https://worker.example.com/api/config', { method: 'OPTIONS' }),
      makeEnv() as never
    );

    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
  });
});
