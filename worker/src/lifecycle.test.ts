import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InstalledPayload } from './types';

const { verifyLifecycleSignatureMock, verifyInstallTokenMock, verifyAuthTokenSignatureMock } = vi.hoisted(() => ({
  verifyLifecycleSignatureMock: vi.fn(),
  verifyInstallTokenMock: vi.fn(),
  verifyAuthTokenSignatureMock: vi.fn(),
}));

vi.mock('./auth', () => ({
  verifyLifecycleSignature: verifyLifecycleSignatureMock,
  verifyInstallToken: verifyInstallTokenMock,
  verifyAuthTokenSignature: verifyAuthTokenSignatureMock,
  jsonResponse: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  errorResponse: (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

import { handleInstalled } from './lifecycle';

function makeInstalledRequest(payload: Partial<InstalledPayload>): Request {
  return new Request('https://worker.example.com/lifecycle/installed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function makeEnv(existingConfig: string | null = null) {
  return {
    SETTINGS_KV: {
      get: vi.fn().mockResolvedValue(existingConfig),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    GITHUB_PAGES_ORIGIN: 'https://example.github.io',
  };
}

describe('handleInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all verifications fail (tests override as needed)
    verifyLifecycleSignatureMock.mockResolvedValue({ valid: false });
    verifyAuthTokenSignatureMock.mockResolvedValue(false);
    verifyInstallTokenMock.mockResolvedValue(false);
  });

  it('allows install when authToken JWT signature is valid (primary path)', async () => {
    verifyAuthTokenSignatureMock.mockResolvedValue(true);
    const env = makeEnv(null);

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      asUser: 'admin-u1',
      apiUrl: 'https://developer.clockify.me',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(200);
    expect(env.SETTINGS_KV.put).toHaveBeenCalledWith('ws:ws123:token', 'install-token');
    // API call should NOT be made when JWT verification succeeds
    expect(verifyInstallTokenMock).not.toHaveBeenCalled();
  });

  it('allows install when Clockify-Signature header is valid', async () => {
    verifyLifecycleSignatureMock.mockResolvedValue({ valid: true, workspaceId: 'ws123' });
    const env = makeEnv(null);

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      asUser: 'admin-u1',
      apiUrl: 'https://developer.clockify.me',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(200);
    expect(env.SETTINGS_KV.put).toHaveBeenCalledWith('ws:ws123:token', 'install-token');
    // Neither JWT nor API call needed when signature header is valid
    expect(verifyInstallTokenMock).not.toHaveBeenCalled();
  });

  it('allows install via API-call fallback when signature and JWT both fail', async () => {
    verifyInstallTokenMock.mockResolvedValue(true);
    const env = makeEnv(null);

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      asUser: 'admin-u1',
      apiUrl: 'https://developer.clockify.me',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(200);
    expect(verifyInstallTokenMock).toHaveBeenCalledWith(
      'https://developer.clockify.me',
      'ws123',
      'install-token'
    );
  });

  it('rejects install when all three verification methods fail', async () => {
    const env = makeEnv(null);

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      apiUrl: 'https://developer.clockify.me',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(401);
    expect(env.SETTINGS_KV.put).not.toHaveBeenCalled();
  });

  it('allows install when signature is invalid, apiUrl is missing, and token verifies via default bases', async () => {
    verifyInstallTokenMock.mockResolvedValue(true);
    const env = makeEnv(null);

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      asUser: 'admin-u1',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(200);
    expect(verifyInstallTokenMock).toHaveBeenCalledWith(
      undefined,
      'ws123',
      'install-token'
    );
  });

  it('rejects install when signature workspaceId mismatches payload', async () => {
    verifyLifecycleSignatureMock.mockResolvedValue({ valid: true, workspaceId: 'ws-other' });
    const env = makeEnv(null);

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      apiUrl: 'https://developer.clockify.me',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(401);
    expect(env.SETTINGS_KV.put).not.toHaveBeenCalled();
  });

  it('does not overwrite existing config on reinstall', async () => {
    verifyAuthTokenSignatureMock.mockResolvedValue(true);
    const env = makeEnv('{"existing": true}');

    const req = makeInstalledRequest({
      workspaceId: 'ws123',
      authToken: 'install-token',
      asUser: 'admin-u1',
    });

    const res = await handleInstalled(req, env as never);
    expect(res.status).toBe(200);
    // Token is always updated
    expect(env.SETTINGS_KV.put).toHaveBeenCalledWith('ws:ws123:token', 'install-token');
    // Config should NOT be overwritten (only 1 put call for token, not 2)
    expect(env.SETTINGS_KV.put).toHaveBeenCalledTimes(1);
  });
});
