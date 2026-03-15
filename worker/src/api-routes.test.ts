import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleConfigGet, handleConfigPut, handleOverridesGet, handleOverridesPut } from './api-routes';

/**
 * Build a minimal JWT with the given payload. The signature is always 'AAAA' (invalid RSA256).
 * Use mockCryptoSubtle(true) to bypass verification, or mockCryptoSubtle(false) to reject it.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.AAAA`;
}

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
  body?: string
): Request {
  return new Request('https://worker.example.com/api/config', {
    method,
    headers,
    body: body ?? undefined,
  });
}

function makeMockEnv(kv: Record<string, string | null> = {}) {
  return {
    SETTINGS_KV: {
      get: async (key: string) => kv[key] ?? null,
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    },
    GITHUB_PAGES_ORIGIN: 'https://example.github.io',
  };
}

function mockCryptoSubtle(signatureValid = true): void {
  vi.stubGlobal('crypto', {
    subtle: {
      importKey: vi.fn().mockResolvedValue('mock-key' as unknown as CryptoKey),
      verify: vi.fn().mockResolvedValue(signatureValid),
    },
  });
}

/** Full normalized OvertimeConfig — all 9 fields required by strict validation. */
const FULL_CONFIG = {
  useProfileCapacity: false,
  useProfileWorkingDays: false,
  applyHolidays: false,
  applyTimeOff: false,
  showBillableBreakdown: false,
  showDecimalTime: false,
  enableTieredOT: false,
  amountDisplay: 'earned',
  overtimeBasis: 'daily',
};

/** Full normalized CalculationParams — all 5 fields required by strict validation. */
const FULL_CALC_PARAMS = {
  dailyThreshold: 8,
  weeklyThreshold: 40,
  overtimeMultiplier: 1.5,
  tier2ThresholdHours: 12,
  tier2Multiplier: 2,
};

describe('API route auth: forged token rejection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/config rejects a forged token (bad RSA256 signature)', async () => {
    mockCryptoSubtle(false);
    const env = makeMockEnv({ 'ws:victim-ws:config': JSON.stringify({ config: null }) });
    const forged = makeJwt({ workspaceId: 'victim-ws', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': forged });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid token signature/);
  });

  it('GET /api/overrides rejects a forged token (bad RSA256 signature)', async () => {
    mockCryptoSubtle(false);
    const env = makeMockEnv({ 'ws:victim-ws:overrides': JSON.stringify({ overrides: {} }) });
    const forged = makeJwt({ workspaceId: 'victim-ws', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': forged });

    const res = await handleOverridesGet(req, env as never);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid token signature/);
  });

  it('PUT /api/config rejects a forged admin claim (bad RSA256 signature)', async () => {
    mockCryptoSubtle(false);
    const env = makeMockEnv({ 'ws:victim-ws:token': 'install-token' });
    // Attacker claims to be an admin of 'victim-ws'
    const forged = makeJwt({ workspaceId: 'victim-ws', backendUrl: 'https://api.clockify.me', user: 'real-admin-id' });
    const req = makeRequest('PUT', { 'X-Addon-Token': forged }, JSON.stringify({ config: {}, calcParams: {} }));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid token signature/);
  });

  it('PUT /api/overrides rejects a forged admin claim (bad RSA256 signature)', async () => {
    mockCryptoSubtle(false);
    const env = makeMockEnv({ 'ws:victim-ws:token': 'install-token' });
    const forged = makeJwt({ workspaceId: 'victim-ws', backendUrl: 'https://api.clockify.me', user: 'real-admin-id' });
    const req = makeRequest('PUT', { 'X-Addon-Token': forged }, JSON.stringify({ overrides: {} }));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid token signature/);
  });

  it('GET /api/config without token returns 401', async () => {
    mockCryptoSubtle(true);
    const env = makeMockEnv({});
    const req = makeRequest('GET', {});

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(401);
  });
});

describe('API route auth: legitimate requests succeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCryptoSubtle(true); // valid signature for all tests in this block
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/config returns stored config for a verified workspace', async () => {
    const stored = { config: FULL_CONFIG, calcParams: FULL_CALC_PARAMS, updatedAt: '', updatedBy: '' };
    const env = makeMockEnv({ 'ws:ws123:config': JSON.stringify(stored) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(200);
  });

  it('GET /api/config returns null message when no config stored', async () => {
    const env = makeMockEnv({});
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { config: null; message: string };
    expect(body.config).toBeNull();
  });

  it('GET /api/overrides returns stored overrides for a verified workspace', async () => {
    const stored = { overrides: { 'u1': { capacity: 6 } }, updatedAt: '', updatedBy: '' };
    const env = makeMockEnv({ 'ws:ws123:overrides': JSON.stringify(stored) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleOverridesGet(req, env as never);
    expect(res.status).toBe(200);
  });

  it('PUT /api/config saves config when caller is a workspace admin', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    // Mock Clockify admin check to return true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin-u1' });
    const configBody = { config: FULL_CONFIG, calcParams: FULL_CALC_PARAMS };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(configBody));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('saved');
  });

  it('PUT /api/config returns 403 when caller is not an admin', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'MEMBER' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'member-u1' });
    const configBody = { config: FULL_CONFIG, calcParams: FULL_CALC_PARAMS };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(configBody));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(403);
  });
});

describe('KV runtime validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCryptoSubtle(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/config returns 500 for corrupted JSON in KV', async () => {
    const env = makeMockEnv({ 'ws:ws123:config': 'not-valid-json{{{' });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Corrupted config data/);
  });

  it('GET /api/config returns 500 for KV data missing config object', async () => {
    const env = makeMockEnv({ 'ws:ws123:config': JSON.stringify({ calcParams: {} }) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(500);
  });

  it('GET /api/config returns 500 for KV data that is an array', async () => {
    const env = makeMockEnv({ 'ws:ws123:config': JSON.stringify([1, 2, 3]) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(500);
  });

  it('GET /api/overrides returns 500 for corrupted JSON in KV', async () => {
    const env = makeMockEnv({ 'ws:ws123:overrides': '{broken' });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleOverridesGet(req, env as never);
    expect(res.status).toBe(500);
  });

  it('GET /api/overrides returns 500 when overrides is null', async () => {
    const env = makeMockEnv({ 'ws:ws123:overrides': JSON.stringify({ overrides: null }) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleOverridesGet(req, env as never);
    expect(res.status).toBe(500);
  });

  it('GET /api/overrides returns 500 when overrides is an array', async () => {
    const env = makeMockEnv({ 'ws:ws123:overrides': JSON.stringify({ overrides: [1, 2] }) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleOverridesGet(req, env as never);
    expect(res.status).toBe(500);
  });

  it('PUT /api/config rejects out-of-range dailyThreshold', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { config: FULL_CONFIG, calcParams: { ...FULL_CALC_PARAMS, dailyThreshold: 999 } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/calcParams/);
  });

  it('PUT /api/config rejects invalid overtimeBasis enum', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { config: { ...FULL_CONFIG, overtimeBasis: 'invalid-value' }, calcParams: FULL_CALC_PARAMS };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/config/);
  });

  it('PUT /api/config rejects NaN in calcParams', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { config: FULL_CONFIG, calcParams: { ...FULL_CALC_PARAMS, dailyThreshold: 'not-a-number' } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/config rejects empty config and calcParams objects', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { config: {}, calcParams: {} };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/config/);
  });

  it('PUT /api/config rejects partial config (missing boolean fields)', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { config: { overtimeBasis: 'daily', amountDisplay: 'earned' }, calcParams: FULL_CALC_PARAMS };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/config rejects partial calcParams (missing numeric fields)', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { config: FULL_CONFIG, calcParams: { dailyThreshold: 8 } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleConfigPut(req, env as never);
    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/calcParams/);
  });

  it('GET /api/config returns 500 for KV data with empty config/calcParams', async () => {
    const stored = { config: {}, calcParams: {}, updatedAt: '', updatedBy: '' };
    const env = makeMockEnv({ 'ws:ws123:config': JSON.stringify(stored) });
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me' });
    const req = makeRequest('GET', { 'X-Addon-Token': token });

    const res = await handleConfigGet(req, env as never);
    expect(res.status).toBe(500);
  });

  it('PUT /api/overrides rejects overrides as an array', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: [1, 2, 3] };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects body without overrides key', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { data: 'something' };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects user override with non-numeric capacity', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { capacity: '6h' } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects user override with invalid mode value', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { mode: 'bad' } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects non-numeric nested weeklyOverrides field', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { mode: 'weekly', weeklyOverrides: { MONDAY: { capacity: 'heavy' } } } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects non-object nested perDayOverrides value', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { mode: 'perDay', perDayOverrides: { '2026-03-13': null } } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects out-of-range capacity in weeklyOverrides', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { mode: 'weekly', weeklyOverrides: { MONDAY: { capacity: 50 } } } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects zero multiplier in perDayOverrides', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { mode: 'perDay', perDayOverrides: { '2026-03-13': { multiplier: 0 } } } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });

  it('PUT /api/overrides rejects negative tier2Threshold in weeklyOverrides', async () => {
    const env = makeMockEnv({ 'ws:ws123:token': 'install-token' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ roles: [{ role: 'WORKSPACE_ADMIN' }] }),
    }));
    const token = makeJwt({ workspaceId: 'ws123', backendUrl: 'https://api.clockify.me', user: 'admin' });
    const body = { overrides: { user1: { mode: 'weekly', weeklyOverrides: { TUESDAY: { tier2Threshold: -1 } } } } };
    const req = makeRequest('PUT', { 'X-Addon-Token': token }, JSON.stringify(body));

    const res = await handleOverridesPut(req, env as never);
    expect(res.status).toBe(400);
  });
});
