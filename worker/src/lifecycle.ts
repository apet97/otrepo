/**
 * @fileoverview Clockify addon lifecycle handlers.
 *
 * Processes INSTALLED and DELETED webhook events sent by Clockify when a
 * workspace installs or removes the addon.
 *
 * - **INSTALLED** verifies the `Clockify-Signature` header, creates default
 *   workspace configuration in KV, and stores the installation token.
 * - **DELETED** verifies the signature and cleans up all workspace KV data.
 */

import type { Env, InstalledPayload, OvertimeConfig, CalculationParams, WorkspaceConfig } from './types';
import { jsonResponse, errorResponse, verifyLifecycleSignature, verifyInstallToken, verifyAuthTokenSignature } from './auth';

/**
 * Default overtime feature-flag configuration applied when a workspace
 * installs the addon and has no existing config in KV.
 *
 * These defaults enable the most common calculation options:
 * - Profile-based capacity and working days (personalized per user).
 * - Holiday and time-off deductions active.
 * - Billable breakdown visible.
 * - Decimal time and tiered OT disabled (opt-in features).
 * - Amount display shows earned wages; overtime computed daily.
 */
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

/**
 * Default numeric calculation parameters applied when a workspace installs
 * the addon and has no existing config in KV.
 *
 * Standard values:
 * - 8-hour daily threshold, 40-hour weekly threshold.
 * - 1.5x overtime multiplier (time-and-a-half).
 * - Tier-2 disabled by default (threshold 0, multiplier 2.0x — only used
 *   when `enableTieredOT` is true in the config).
 */
const DEFAULT_CALC_PARAMS: CalculationParams = {
  dailyThreshold: 8,
  weeklyThreshold: 40,
  overtimeMultiplier: 1.5,
  tier2ThresholdHours: 0,
  tier2Multiplier: 2.0,
};

/**
 * Handles the `POST /lifecycle/installed` webhook from Clockify.
 *
 * Uses a **three-tier authentication** approach (any one passing is
 * sufficient):
 *
 * 1. **`Clockify-Signature` header** — RSA256-verified JWT attached by
 *    Clockify to lifecycle webhooks.  Fastest check (no network I/O).
 *    If present and valid, also cross-checks `workspaceId` against the
 *    request body.
 *
 * 2. **`authToken` JWT signature** — the installation token in the request
 *    body is itself a Clockify-signed JWT.  Verifying its RSA256 signature
 *    directly (`verifyAuthTokenSignature`) confirms authenticity without
 *    any outbound network call.
 *
 * 3. **Outbound API call** (`verifyInstallToken`) — last-resort fallback
 *    that calls `GET /v1/workspaces/{id}` on the Clockify API using the
 *    provided `authToken`.  Slowest path; depends on Worker-to-Clockify
 *    connectivity.
 *
 * On successful authentication, the handler:
 * - Stores the installation `authToken` in KV at `ws:{workspaceId}:token`
 *   for later server-to-server API calls.
 * - Creates a default {@link WorkspaceConfig} at `ws:{workspaceId}:config`
 *   if no config exists yet (preserves existing config on re-installs).
 *
 * @param request - The incoming POST request from Clockify containing an
 *                  {@link InstalledPayload} JSON body.
 * @param env     - Worker environment bindings (provides KV access).
 * @returns JSON response `{ status: "installed" }` on success, or an error
 *          (400 for bad payload, 401 for failed authentication).
 */
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

  // --- Tier 1: Verify the Clockify-Signature header (RSA256, no network I/O) ---
  const sigResult = await verifyLifecycleSignature(request);

  // --- Tier 2: Verify the authToken JWT's RSA256 signature directly ---
  // More reliable than outbound API calls (verifyInstallToken) which depend
  // on Worker-to-Clockify network connectivity and can fail on cold starts.
  const authTokenSigValid = await verifyAuthTokenSignature(authToken);

  // --- Determine which auth tier succeeded: signature header > authToken JWT > API call fallback ---
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
    // --- Tier 3: Last resort — outbound API call to verify the token (legacy fallback) ---
    const tokenValid = await verifyInstallToken(apiUrl, workspaceId, authToken);
    if (!tokenValid) {
      return errorResponse('Unauthorized: invalid lifecycle signature and could not verify installation token', 401, request, env.ENVIRONMENT);
    }
    authMethod = 'api-fallback';
    console.warn(`[AUDIT] Installed API-fallback auth path used: workspace=${workspaceId} apiUrlPresent=${Boolean(apiUrl)}`);
  }

  console.log(`[AUDIT] Addon installed: workspace=${workspaceId} user=${asUser || 'unknown'} authMethod=${authMethod}`);

  // Persist the installation token for later server-to-server API calls
  // (e.g. admin-role checks in api-routes.ts).
  await env.SETTINGS_KV.put(`ws:${workspaceId}:token`, authToken);

  // Create default workspace config if this is a first install (preserve
  // existing config on re-installs so admin customizations are not lost).
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

/**
 * Handles the `POST /lifecycle/deleted` webhook from Clockify.
 *
 * Requires a valid `Clockify-Signature` header (RSA256-verified).  If the
 * signature includes a `workspaceId` claim, it is preferred over the
 * unsigned request body for trustworthiness.  A mismatch between the two
 * is rejected.
 *
 * On successful authentication, the handler deletes all three workspace-
 * scoped KV keys:
 * - `ws:{workspaceId}:token`     — the installation auth token.
 * - `ws:{workspaceId}:config`    — the workspace overtime configuration.
 * - `ws:{workspaceId}:overrides` — the per-user calculation overrides.
 *
 * @param request - The incoming POST request from Clockify containing a
 *                  JSON body with `workspaceId`.
 * @param env     - Worker environment bindings (provides KV access).
 * @returns JSON response `{ status: "deleted" }` on success, or an error
 *          (400 for bad payload, 401 for failed signature verification).
 */
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

  // Clean up all workspace-scoped KV data
  await env.SETTINGS_KV.delete(`ws:${workspaceId}:token`);
  await env.SETTINGS_KV.delete(`ws:${workspaceId}:config`);
  await env.SETTINGS_KV.delete(`ws:${workspaceId}:overrides`);

  return jsonResponse({ status: 'deleted' }, 200, request, env.ENVIRONMENT);
}
