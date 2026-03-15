import type { Env, InstalledPayload, OvertimeConfig, CalculationParams, WorkspaceConfig } from './types';
import { jsonResponse, errorResponse, verifyLifecycleSignature, verifyInstallToken, verifyAuthTokenSignature } from './auth';

const DEFAULT_CONFIG: OvertimeConfig = {
  useProfileCapacity: true,
  useProfileWorkingDays: true,
  applyHolidays: true,
  applyTimeOff: true,
  showBillableBreakdown: true,
  showDecimalTime: false,
  enableTieredOT: false,
  amountDisplay: 'earned',
  overtimeBasis: 'daily',
};

const DEFAULT_CALC_PARAMS: CalculationParams = {
  dailyThreshold: 8,
  weeklyThreshold: 40,
  overtimeMultiplier: 1.5,
  tier2ThresholdHours: 0,
  tier2Multiplier: 2.0,
};

export async function handleInstalled(request: Request, env: Env): Promise<Response> {
  let payload: InstalledPayload;
  try {
    payload = (await request.json()) as InstalledPayload;
  } catch {
    return errorResponse('Invalid JSON payload', 400, request, env.ENVIRONMENT);
  }

  const { workspaceId, authToken, asUser, apiUrl } = payload;
  if (!workspaceId || !authToken) {
    return errorResponse('Missing workspaceId or authToken', 400, request, env.ENVIRONMENT);
  }

  // Verify the Clockify-Signature header when present.
  const sigResult = await verifyLifecycleSignature(request);

  // Verify the authToken JWT's RSA256 signature directly.
  // This is the primary check — more reliable than outbound API calls (verifyInstallToken)
  // which depend on Worker→Clockify network connectivity and can fail on cold starts.
  const authTokenSigValid = await verifyAuthTokenSignature(authToken);

  // Determine auth method: signature header > authToken JWT > API call fallback
  let authMethod: string;
  if (sigResult.valid) {
    // Cross-check workspaceId from signature against payload
    if (sigResult.workspaceId && sigResult.workspaceId !== workspaceId) {
      return errorResponse('Unauthorized: workspaceId mismatch', 401, request, env.ENVIRONMENT);
    }
    authMethod = 'signature';
  } else if (authTokenSigValid) {
    authMethod = 'authToken-jwt';
  } else {
    // Last resort: outbound API call to verify the token (legacy fallback)
    const tokenValid = await verifyInstallToken(apiUrl, workspaceId, authToken);
    if (!tokenValid) {
      return errorResponse('Unauthorized: invalid lifecycle signature and could not verify installation token', 401, request, env.ENVIRONMENT);
    }
    authMethod = 'api-fallback';
    console.warn(`[AUDIT] Installed API-fallback auth path used: workspace=${workspaceId} apiUrlPresent=${Boolean(apiUrl)}`);
  }

  console.log(`[AUDIT] Addon installed: workspace=${workspaceId} user=${asUser || 'unknown'} authMethod=${authMethod}`);

  await env.SETTINGS_KV.put(`ws:${workspaceId}:token`, authToken);

  const existingConfig = await env.SETTINGS_KV.get(`ws:${workspaceId}:config`);
  if (!existingConfig) {
    const defaultConfig: WorkspaceConfig = {
      config: DEFAULT_CONFIG,
      calcParams: DEFAULT_CALC_PARAMS,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: asUser || 'system',
    };
    await env.SETTINGS_KV.put(`ws:${workspaceId}:config`, JSON.stringify(defaultConfig));
  }

  return jsonResponse({ status: 'installed' }, 200, request, env.ENVIRONMENT);
}

export async function handleDeleted(request: Request, env: Env): Promise<Response> {
  // Verify the Clockify-Signature header to confirm this request is from Clockify
  const sigResult = await verifyLifecycleSignature(request);
  if (!sigResult.valid) {
    return errorResponse('Unauthorized: invalid or missing lifecycle signature', 401, request, env.ENVIRONMENT);
  }

  let payload: { workspaceId?: string };
  try {
    payload = (await request.json()) as { workspaceId?: string };
  } catch {
    return errorResponse('Invalid JSON payload', 400, request, env.ENVIRONMENT);
  }

  // Use workspaceId from the signature if available (more trustworthy than unsigned body)
  const workspaceId = sigResult.workspaceId ?? payload.workspaceId;
  if (!workspaceId) {
    return errorResponse('Missing workspaceId', 400, request, env.ENVIRONMENT);
  }

  // Cross-check payload workspaceId against signature if both are present
  if (sigResult.workspaceId && payload.workspaceId && sigResult.workspaceId !== payload.workspaceId) {
    return errorResponse('Unauthorized: workspaceId mismatch', 401, request, env.ENVIRONMENT);
  }

  console.log(`[AUDIT] Addon deleted: workspace=${workspaceId}`);

  await env.SETTINGS_KV.delete(`ws:${workspaceId}:token`);
  await env.SETTINGS_KV.delete(`ws:${workspaceId}:config`);
  await env.SETTINGS_KV.delete(`ws:${workspaceId}:overrides`);

  return jsonResponse({ status: 'deleted' }, 200, request, env.ENVIRONMENT);
}
