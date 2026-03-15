import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decodeJwt,
  extractAndVerifyJwt,
  isAllowedClockifyUrl,
  isAllowedCorsOrigin,
  verifyLifecycleSignature,
  verifyInstallToken,
  isWorkspaceAdmin,
} from './auth';

function makeJwt(payload: Record<string, unknown>, signature = 'AAAA'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.${signature}`;
}

function makeRequest(
  headers: Record<string, string> = {},
  body?: string
): Request {
  return new Request('https://worker.example.com', {
    method: 'POST',
    headers,
    body,
  });
}

/**
 * Mock crypto.subtle so verifyLifecycleSignature tests focus on claims logic,
 * not RSA key material. Tests that need to verify RSA failure pass signatureValid=false.
 */
function mockCryptoSubtle(signatureValid = true): void {
  vi.stubGlobal('crypto', {
    subtle: {
      importKey: vi.fn().mockResolvedValue('mock-key' as unknown as CryptoKey),
      verify: vi.fn().mockResolvedValue(signatureValid),
    },
  });
}

describe('decodeJwt', () => {
  it('decodes a valid JWT with workspaceId', () => {
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const result = decodeJwt(token);
    expect(result.workspaceId).toBe('ws123');
    expect(result.backendUrl).toBe('https://api.clockify.me');
  });

  it('throws on missing workspaceId', () => {
    const token = makeJwt({ backendUrl: 'https://api.clockify.me' });
    expect(() => decodeJwt(token)).toThrow('Missing workspaceId');
  });

  it('throws on invalid JWT format', () => {
    expect(() => decodeJwt('not-a-jwt')).toThrow('Invalid JWT format');
  });

  it('resolves activeWs to workspaceId when workspaceId is absent', () => {
    const token = makeJwt({ activeWs: 'ws-alias', backendUrl: 'https://api.clockify.me' });
    const result = decodeJwt(token);
    expect(result.workspaceId).toBe('ws-alias');
  });

  it('prefers workspaceId over activeWs when both present', () => {
    const token = makeJwt({ workspaceId: 'ws-primary', activeWs: 'ws-alias', backendUrl: 'https://api.clockify.me' });
    const result = decodeJwt(token);
    expect(result.workspaceId).toBe('ws-primary');
  });

  it('resolves apiUrl to backendUrl with /api path normalization', () => {
    const token = makeJwt({ workspaceId: 'ws1', apiUrl: 'https://developer.clockify.me' });
    const result = decodeJwt(token);
    expect(result.backendUrl).toBe('https://developer.clockify.me/api');
  });

  it('resolves baseURL to backendUrl', () => {
    const token = makeJwt({ workspaceId: 'ws1', baseURL: 'https://api.clockify.me/api' });
    const result = decodeJwt(token);
    expect(result.backendUrl).toBe('https://api.clockify.me/api');
  });

  it('strips /v1 suffix when resolving alias backendUrl', () => {
    const token = makeJwt({ workspaceId: 'ws1', apiUrl: 'https://api.clockify.me/api/v1' });
    const result = decodeJwt(token);
    expect(result.backendUrl).toBe('https://api.clockify.me/api');
  });
});

describe('isAllowedClockifyUrl', () => {
  it('allows api.clockify.me', () => {
    expect(isAllowedClockifyUrl('https://api.clockify.me')).toBe(true);
  });

  it('allows global.api.clockify.me', () => {
    expect(isAllowedClockifyUrl('https://global.api.clockify.me')).toBe(true);
  });

  it('allows subdomains of clockify.me', () => {
    expect(isAllowedClockifyUrl('https://eu.api.clockify.me')).toBe(true);
  });

  it('rejects http (non-HTTPS)', () => {
    expect(isAllowedClockifyUrl('http://api.clockify.me')).toBe(false);
  });

  it('rejects attacker-controlled URLs', () => {
    expect(isAllowedClockifyUrl('https://evil.com')).toBe(false);
    expect(isAllowedClockifyUrl('https://api.clockify.me.evil.com')).toBe(false);
    expect(isAllowedClockifyUrl('https://evil.com/api.clockify.me')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedClockifyUrl('not-a-url')).toBe(false);
    expect(isAllowedClockifyUrl('')).toBe(false);
  });
});

describe('verifyLifecycleSignature', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCryptoSubtle(true); // signature passes by default; tests focus on claims
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns valid=true for a well-formed signature JWT with correct claims', async () => {
    const sigPayload = {
      iss: 'clockify',
      type: 'addon',
      sub: 'overtime-summary',
      exp: Math.floor(Date.now() / 1000) + 3600,
      workspaceId: 'ws123',
    };
    const sig = makeJwt(sigPayload);
    const req = makeRequest({ 'Clockify-Signature': sig });
    const result = await verifyLifecycleSignature(req);
    expect(result.valid).toBe(true);
    expect(result.workspaceId).toBe('ws123');
  });

  it('returns valid=false when Clockify-Signature header is missing', async () => {
    const req = makeRequest({});
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false when RSA256 signature verification fails', async () => {
    mockCryptoSubtle(false);
    const sigPayload = {
      iss: 'clockify',
      type: 'addon',
      sub: 'overtime-summary',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const sig = makeJwt(sigPayload);
    const req = makeRequest({ 'Clockify-Signature': sig });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false for wrong iss claim', async () => {
    const sig = makeJwt({
      iss: 'attacker',
      type: 'addon',
      sub: 'overtime-summary',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeRequest({ 'Clockify-Signature': sig });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false for missing type=addon claim', async () => {
    const sig = makeJwt({
      iss: 'clockify',
      sub: 'overtime-summary',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeRequest({ 'Clockify-Signature': sig });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false for wrong type claim', async () => {
    const sig = makeJwt({
      iss: 'clockify',
      type: 'other',
      sub: 'overtime-summary',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeRequest({ 'Clockify-Signature': sig });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false for wrong sub claim (wrong addon key)', async () => {
    const sig = makeJwt({
      iss: 'clockify',
      type: 'addon',
      sub: 'other-addon',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeRequest({ 'Clockify-Signature': sig });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false for expired token', async () => {
    const sig = makeJwt({
      iss: 'clockify',
      type: 'addon',
      sub: 'overtime-summary',
      exp: 1,
    });
    const req = makeRequest({ 'Clockify-Signature': sig });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('returns valid=false for malformed JWT', async () => {
    const req = makeRequest({ 'Clockify-Signature': 'not.a.valid.jwt.format' });
    expect((await verifyLifecycleSignature(req)).valid).toBe(false);
  });

  it('calls crypto.subtle.verify with the signing input', async () => {
    const sigPayload = {
      iss: 'clockify',
      type: 'addon',
      sub: 'overtime-summary',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const sig = makeJwt(sigPayload);
    const req = makeRequest({ 'Clockify-Signature': sig });
    await verifyLifecycleSignature(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subtle = (globalThis as any).crypto.subtle;
    expect(subtle.importKey).toHaveBeenCalledWith(
      'spki',
      expect.any(ArrayBuffer),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    expect(subtle.verify).toHaveBeenCalledWith(
      { name: 'RSASSA-PKCS1-v1_5' },
      'mock-key',
      expect.any(ArrayBuffer),
      expect.any(Uint8Array)
    );
  });
});

describe('verifyInstallToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for a non-Clockify apiUrl (SSRF protection)', async () => {
    const result = await verifyInstallToken('https://evil.com', 'ws123', 'token');
    expect(result).toBe(false);
  });

  it('returns false for http apiUrl', async () => {
    const result = await verifyInstallToken('http://api.clockify.me', 'ws123', 'token');
    expect(result).toBe(false);
  });

  it('uses known Clockify API bases when apiUrl is missing', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://developer.clockify.me/api/v1/workspaces/ws123') {
        return { ok: true, headers: { get: () => 'application/json' } };
      }
      return { ok: false, headers: { get: () => 'application/json' } };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyInstallToken(undefined, 'ws123', 'token');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://developer.clockify.me/api/v1/workspaces/ws123',
      { headers: { 'X-Addon-Token': 'token' } }
    );
  });

  it('returns true when Clockify API responds 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
    }));
    const result = await verifyInstallToken('https://api.clockify.me', 'ws123', 'real-token');
    expect(result).toBe(true);
  });

  it('returns false when Clockify API responds non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await verifyInstallToken('https://api.clockify.me', 'ws123', 'bad-token');
    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const result = await verifyInstallToken('https://api.clockify.me', 'ws123', 'token');
    expect(result).toBe(false);
  });

  it('normalizes bare developer portal URL to /api before verifying the install token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyInstallToken('https://developer.clockify.me', 'ws123', 'token');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://developer.clockify.me/api/v1/workspaces/ws123',
      { headers: { 'X-Addon-Token': 'token' } }
    );
  });

  it('normalizes bare api.clockify.me URL to /api before verifying the install token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyInstallToken('https://api.clockify.me', 'ws123', 'token');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.clockify.me/api/v1/workspaces/ws123',
      { headers: { 'X-Addon-Token': 'token' } }
    );
  });

  it('ignores HTML 200 responses from a wrong path and falls back to the normalized API base', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://developer.clockify.me/custom/v1/workspaces/ws123') {
        return {
          ok: true,
          headers: { get: () => 'text/html; charset=utf-8' },
        };
      }

      if (url === 'https://developer.clockify.me/custom/api/v1/workspaces/ws123') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyInstallToken('https://developer.clockify.me/custom', 'ws123', 'token');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://developer.clockify.me/custom/v1/workspaces/ws123',
      { headers: { 'X-Addon-Token': 'token' } }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://developer.clockify.me/custom/api/v1/workspaces/ws123',
      { headers: { 'X-Addon-Token': 'token' } }
    );
  });
});

describe('isWorkspaceAdmin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeMockEnv(data: Record<string, string | null>) {
    return {
      SETTINGS_KV: {
        get: async (key: string) => data[key] ?? null,
        put: vi.fn(),
        delete: vi.fn(),
      },
      GITHUB_PAGES_ORIGIN: 'https://example.github.io',
    };
  }

  it('returns false for a non-Clockify backendUrl (SSRF protection)', async () => {
    const env = makeMockEnv({ 'ws:ws1:token': 'install-token' });
    const result = await isWorkspaceAdmin(env as never, 'ws1', 'user1', 'https://evil.com');
    expect(result).toBe(false);
  });

  it('returns false when no installation token stored', async () => {
    const env = makeMockEnv({});
    const result = await isWorkspaceAdmin(env as never, 'ws1', 'user1', 'https://api.clockify.me');
    expect(result).toBe(false);
  });

  it('returns true when Clockify confirms WORKSPACE_ADMIN role', async () => {
    const env = makeMockEnv({ 'ws:ws1:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const result = await isWorkspaceAdmin(env as never, 'ws1', 'user1', 'https://api.clockify.me');
    expect(result).toBe(true);
  });

  it('returns true when Clockify confirms OWNER role', async () => {
    const env = makeMockEnv({ 'ws:ws1:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'OWNER' }] }),
    }));
    const result = await isWorkspaceAdmin(env as never, 'ws1', 'user1', 'https://api.clockify.me');
    expect(result).toBe(true);
  });

  it('returns false for non-admin roles (forged JWT workspaceRole cannot grant access)', async () => {
    const env = makeMockEnv({ 'ws:ws1:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'MEMBER' }] }),
    }));
    const result = await isWorkspaceAdmin(env as never, 'ws1', 'user1', 'https://api.clockify.me');
    expect(result).toBe(false);
  });

  it('returns false when Clockify API call fails', async () => {
    const env = makeMockEnv({ 'ws:ws1:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await isWorkspaceAdmin(env as never, 'ws1', 'user1', 'https://api.clockify.me');
    expect(result).toBe(false);
  });
});

describe('extractAndVerifyJwt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCryptoSubtle(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns payload when RSA256 signature is valid and workspaceId is present', async () => {
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'u1' });
    const req = makeRequest({ 'X-Addon-Token': token });
    const result = await extractAndVerifyJwt(req);
    expect(result.workspaceId).toBe('ws123');
    expect(result.user).toBe('u1');
  });

  it('works with Authorization Bearer header', async () => {
    const token = makeJwt({ workspaceId: 'ws456', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest({ 'Authorization': `Bearer ${token}` });
    const result = await extractAndVerifyJwt(req);
    expect(result.workspaceId).toBe('ws456');
  });

  it('throws when no auth token is provided', async () => {
    const req = makeRequest({});
    await expect(extractAndVerifyJwt(req)).rejects.toThrow('No auth token provided');
  });

  it('throws when RSA256 signature is invalid (forged token)', async () => {
    mockCryptoSubtle(false);
    const forgedToken = makeJwt({ workspaceId: 'victim-workspace', backendUrl: 'https://api.clockify.me', user: 'admin-user' });
    const req = makeRequest({ 'X-Addon-Token': forgedToken });
    await expect(extractAndVerifyJwt(req)).rejects.toThrow('Invalid token signature');
  });

  it('throws when token has valid structure but forged workspaceId (bad RSA signature)', async () => {
    mockCryptoSubtle(false);
    // Attacker builds a JWT with their chosen workspaceId — cannot produce valid RSA256 sig
    const forgedToken = makeJwt({
      workspaceId: 'other-workspace',
      backendUrl: 'https://api.clockify.me',
      user: 'attacker-user',
    });
    const req = makeRequest({ 'X-Addon-Token': forgedToken });
    await expect(extractAndVerifyJwt(req)).rejects.toThrow('Invalid token signature');
  });

  it('throws when workspaceId is missing even if signature passes', async () => {
    const token = makeJwt({ backendUrl: 'https://api.clockify.me' });
    const req = makeRequest({ 'X-Addon-Token': token });
    await expect(extractAndVerifyJwt(req)).rejects.toThrow('Missing workspaceId');
  });

  it('works with alias-claim tokens (activeWs + apiUrl)', async () => {
    const token = makeJwt({ activeWs: 'ws-alias', apiUrl: 'https://developer.clockify.me' });
    const req = makeRequest({ 'X-Addon-Token': token });
    const result = await extractAndVerifyJwt(req);
    expect(result.workspaceId).toBe('ws-alias');
    expect(result.backendUrl).toBe('https://developer.clockify.me/api');
  });
});

describe('isAllowedCorsOrigin', () => {
  it('allows https://app.clockify.me', () => {
    expect(isAllowedCorsOrigin('https://app.clockify.me')).toBe(true);
  });

  it('allows https://clockify.me', () => {
    expect(isAllowedCorsOrigin('https://clockify.me')).toBe(true);
  });

  it('allows regional Clockify origins', () => {
    expect(isAllowedCorsOrigin('https://de.app.clockify.me')).toBe(true);
    expect(isAllowedCorsOrigin('https://fr.clockify.me')).toBe(true);
  });

  it('allows GitHub Pages origins', () => {
    expect(isAllowedCorsOrigin('https://user123.github.io')).toBe(true);
    expect(isAllowedCorsOrigin('https://my-org.github.io')).toBe(true);
  });

  it('allows Cloudflare Workers origins', () => {
    expect(isAllowedCorsOrigin('https://my-worker.my-account.workers.dev')).toBe(true);
  });

  it('allows localhost only in non-production environment', () => {
    // Localhost blocked by default (no environment) and in production
    expect(isAllowedCorsOrigin('http://localhost')).toBe(false);
    expect(isAllowedCorsOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedCorsOrigin('http://localhost', 'production')).toBe(false);
    expect(isAllowedCorsOrigin('http://localhost:3000', 'production')).toBe(false);
    // Localhost allowed in development/staging
    expect(isAllowedCorsOrigin('http://localhost', 'development')).toBe(true);
    expect(isAllowedCorsOrigin('http://localhost:3000', 'development')).toBe(true);
    expect(isAllowedCorsOrigin('http://localhost', 'staging')).toBe(true);
  });

  it('rejects attacker-controlled origins', () => {
    expect(isAllowedCorsOrigin('https://evil.com')).toBe(false);
    expect(isAllowedCorsOrigin('https://clockify.me.evil.com')).toBe(false);
    expect(isAllowedCorsOrigin('https://evil-clockify.me')).toBe(false);
  });

  it('rejects empty or malformed origins', () => {
    expect(isAllowedCorsOrigin('')).toBe(false);
    expect(isAllowedCorsOrigin('not-a-url')).toBe(false);
  });

  it('rejects http for non-localhost origins', () => {
    expect(isAllowedCorsOrigin('http://app.clockify.me')).toBe(false);
    expect(isAllowedCorsOrigin('http://evil.com')).toBe(false);
  });
});
