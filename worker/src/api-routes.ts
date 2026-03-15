/**
 * @fileoverview CRUD endpoints for workspace configuration and user overrides.
 *
 * All endpoints require RSA256-verified JWT for authentication.  Write
 * operations (`PUT`) additionally require workspace-admin role, verified via
 * an outbound Clockify API call.
 *
 * Data is stored in Cloudflare KV with workspace-scoped keys:
 * - `ws:{workspaceId}:config`    — {@link WorkspaceConfig}
 * - `ws:{workspaceId}:overrides` — {@link WorkspaceOverrides}
 */

import type { Env, WorkspaceConfig, WorkspaceOverrides } from './types';
import { extractAndVerifyJwt, isAdminRole, isWorkspaceAdmin, jsonResponse, errorResponse } from './auth';

// --- Runtime validation type guards ---

/** Valid values for the `OvertimeConfig.amountDisplay` enum field. */
const VALID_AMOUNT_DISPLAYS = ['earned', 'cost', 'profit'] as const;

/** Valid values for the `OvertimeConfig.overtimeBasis` enum field. */
const VALID_OVERTIME_BASES = ['daily', 'weekly', 'both'] as const;

/**
 * Type guard that checks whether a value is a plain object (non-null,
 * non-array).
 *
 * Used as the first check in all validation functions to ensure the
 * value is structurally an object before accessing properties.
 *
 * @param v - The value to check.
 * @returns `true` if `v` is a non-null, non-array object.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates that a value conforms to the {@link OvertimeConfig} shape.
 *
 * Checks all 9 required fields:
 * - 7 boolean feature flags.
 * - `amountDisplay` enum (`earned` | `cost` | `profit`).
 * - `overtimeBasis` enum (`daily` | `weekly` | `both`).
 *
 * @param v - The value to validate (typically from a parsed JSON body).
 * @returns `true` if the value has valid OvertimeConfig structure.
 */
function isValidOvertimeConfig(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const boolFields = [
    'useProfileCapacity', 'useProfileWorkingDays', 'applyHolidays',
    'applyTimeOff', 'showBillableBreakdown', 'showDecimalTime', 'enableTieredOT',
  ];
  for (const f of boolFields) {
    if (typeof v[f] !== 'boolean') return false;
  }
  if (!(VALID_AMOUNT_DISPLAYS as readonly string[]).includes(v.amountDisplay as string)) return false;
  if (!(VALID_OVERTIME_BASES as readonly string[]).includes(v.overtimeBasis as string)) return false;
  return true;
}

/**
 * Validates that a value conforms to the {@link CalculationParams} shape.
 *
 * Checks all 5 required numeric fields against their allowed ranges:
 * - `dailyThreshold`: 0–24 hours
 * - `weeklyThreshold`: 0–168 hours
 * - `overtimeMultiplier`: 0–100
 * - `tier2ThresholdHours`: 0–168 hours
 * - `tier2Multiplier`: 0–100
 *
 * Rejects `NaN`, `Infinity`, and out-of-range values.
 *
 * @param v - The value to validate.
 * @returns `true` if the value has valid CalculationParams structure.
 */
function isValidCalcParams(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const ranges: Record<string, [number, number]> = {
    dailyThreshold: [0, 24],
    weeklyThreshold: [0, 168],
    overtimeMultiplier: [0, 100],
    tier2ThresholdHours: [0, 168],
    tier2Multiplier: [0, 100],
  };
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (typeof v[field] !== 'number' || !isFinite(v[field] as number)) return false;
    if ((v[field] as number) < min || (v[field] as number) > max) return false;
  }
  return true;
}

/**
 * Validates that data retrieved from KV matches the {@link WorkspaceConfig}
 * shape.
 *
 * Performs nested validation: the outer record must contain `config`
 * (validated by `isValidOvertimeConfig`) and `calcParams` (validated by
 * `isValidCalcParams`).
 *
 * @param data - Parsed JSON from KV.
 * @returns `true` if `data` is a valid WorkspaceConfig.
 */
function isValidWorkspaceConfig(data: unknown): data is WorkspaceConfig {
  if (!isRecord(data)) return false;
  if (!isRecord(data.config) || !isRecord(data.calcParams)) return false;
  if (!isValidOvertimeConfig(data.config)) return false;
  if (!isValidCalcParams(data.calcParams)) return false;
  return true;
}

/**
 * Validates that data retrieved from KV matches the
 * {@link WorkspaceOverrides} shape.
 *
 * Only checks the top-level structure (must have an `overrides` object).
 * Individual user overrides are validated separately on write via
 * `isValidUserOverride()`.
 *
 * @param data - Parsed JSON from KV.
 * @returns `true` if `data` is a valid WorkspaceOverrides.
 */
function isValidWorkspaceOverrides(data: unknown): data is WorkspaceOverrides {
  if (!isRecord(data)) return false;
  if (!isRecord(data.overrides)) return false;
  return true;
}

/** Valid override scheduling modes. */
const VALID_OVERRIDE_MODES = new Set(['global', 'weekly', 'perDay']);

/** Numeric fields that can appear in per-user override objects. */
const NUMERIC_OVERRIDE_FIELDS = ['capacity', 'multiplier', 'tier2Threshold', 'tier2Multiplier'] as const;

/**
 * Allowed numeric ranges for per-user override fields.
 *
 * These bounds are enforced server-side to prevent nonsensical values:
 * - `capacity`: 0–24 hours (daily capacity cannot exceed a full day).
 * - `multiplier`: 1–5 (overtime multiplier between 1x and 5x).
 * - `tier2Threshold`: 0–24 hours (tier-2 OT threshold per day).
 * - `tier2Multiplier`: 1–5 (tier-2 OT multiplier between 1x and 5x).
 *
 * The ranges are intentionally tighter than `CalculationParams` ranges
 * because overrides are per-user adjustments, not workspace-wide defaults.
 */
const OVERRIDE_BOUNDS: Record<string, [number, number]> = {
  capacity: [0, 24],
  multiplier: [1, 5],
  tier2Threshold: [0, 24],
  tier2Multiplier: [1, 5],
};

/**
 * Validates a single numeric override object against `OVERRIDE_BOUNDS`.
 *
 * Each numeric field is optional, but if present it must be a finite number
 * within its allowed range.
 *
 * @param obj - The override object to validate (e.g. a top-level user
 *              override or a single day entry within weeklyOverrides).
 * @returns `true` if all present numeric fields are within bounds.
 */
function isValidNumericOverrideObject(obj: unknown): boolean {
  if (!isRecord(obj)) return false;
  for (const field of NUMERIC_OVERRIDE_FIELDS) {
    if (obj[field] !== undefined) {
      if (typeof obj[field] !== 'number' || !isFinite(obj[field] as number)) return false;
      const bounds = OVERRIDE_BOUNDS[field];
      if (bounds && ((obj[field] as number) < bounds[0] || (obj[field] as number) > bounds[1])) return false;
    }
  }
  return true;
}

/**
 * Validates a complete per-user override entry.
 *
 * A user override may include:
 * - `mode`: one of `"global"`, `"weekly"`, or `"perDay"`.
 * - Top-level numeric fields (capacity, multiplier, etc.).
 * - `weeklyOverrides`: an object keyed by day name, each value validated
 *   against `OVERRIDE_BOUNDS`.
 * - `perDayOverrides`: an object keyed by ISO date, each value validated
 *   against `OVERRIDE_BOUNDS`.
 *
 * @param override - The per-user override to validate.
 * @returns `true` if the override structure and all numeric values are valid.
 */
function isValidUserOverride(override: unknown): boolean {
  if (!isRecord(override)) return false;
  if (override.mode !== undefined && !VALID_OVERRIDE_MODES.has(override.mode as string)) return false;
  if (!isValidNumericOverrideObject(override)) return false;
  if (override.weeklyOverrides !== undefined) {
    if (!isRecord(override.weeklyOverrides)) return false;
    for (const day of Object.values(override.weeklyOverrides)) {
      if (!isValidNumericOverrideObject(day)) return false;
    }
  }
  if (override.perDayOverrides !== undefined) {
    if (!isRecord(override.perDayOverrides)) return false;
    for (const day of Object.values(override.perDayOverrides)) {
      if (!isValidNumericOverrideObject(day)) return false;
    }
  }
  return true;
}

// --- Route handlers ---

/**
 * Handles `GET /api/config` — retrieves the workspace overtime
 * configuration from KV.
 *
 * Authenticates the caller via RSA256-verified JWT (read access is allowed
 * for any authenticated workspace member, not just admins).  Returns the
 * full {@link WorkspaceConfig} if one exists, or `{ config: null }` if
 * the workspace has no saved configuration yet.
 *
 * @param request - The incoming HTTP request (must contain a valid JWT).
 * @param env     - Worker environment bindings.
 * @returns JSON response with the workspace config or a 401/500 error.
 */
export async function handleConfigGet(request: Request, env: Env): Promise<Response> {
  let jwt;
  try {
    jwt = await extractAndVerifyJwt(request);
  } catch (e) {
    return errorResponse(`Unauthorized: ${(e as Error).message}`, 401, request, env.ENVIRONMENT);
  }

  const data = await env.SETTINGS_KV.get(`ws:${jwt.workspaceId}:config`);
  if (!data) {
    return jsonResponse({ config: null, message: 'No config set for this workspace' }, 200, request, env.ENVIRONMENT);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    console.error(`[KV] Corrupted config JSON for workspace ${jwt.workspaceId}`);
    return errorResponse('Corrupted config data', 500, request, env.ENVIRONMENT);
  }

  if (!isValidWorkspaceConfig(parsed)) {
    console.error(`[KV] Invalid config schema for workspace ${jwt.workspaceId}`);
    return errorResponse('Corrupted config data', 500, request, env.ENVIRONMENT);
  }

  if (!parsed.schemaVersion) {
    console.warn(`[KV] Config for workspace ${jwt.workspaceId} missing schemaVersion — pre-v1 data`);
  }

  return jsonResponse(parsed, 200, request, env.ENVIRONMENT);
}

/**
 * Handles `PUT /api/config` — saves (creates or updates) the workspace
 * overtime configuration in KV.
 *
 * Requires:
 * 1. RSA256-verified JWT (authentication).
 * 2. `backendUrl` claim in the JWT (needed for admin check).
 * 3. WORKSPACE_ADMIN or OWNER role (authorization, checked via outbound
 *    Clockify API call).
 *
 * The request body must include both `config` (validated by
 * `isValidOvertimeConfig`) and `calcParams` (validated by
 * `isValidCalcParams`).  The saved record includes `schemaVersion: 1`
 * and an audit trail (`updatedAt`, `updatedBy`).
 *
 * @param request - The incoming HTTP request with JSON body.
 * @param env     - Worker environment bindings.
 * @returns JSON response `{ status: "saved" }` on success, or an error.
 */
export async function handleConfigPut(request: Request, env: Env): Promise<Response> {
  let jwt;
  try {
    jwt = await extractAndVerifyJwt(request);
  } catch (e) {
    return errorResponse(`Unauthorized: ${(e as Error).message}`, 401, request, env.ENVIRONMENT);
  }

  const userId = jwt.user ?? jwt.sub ?? 'unknown';
  if (!jwt.backendUrl) {
    return errorResponse('Bad Request: token missing backendUrl', 400, request, env.ENVIRONMENT);
  }
  const isAdmin = isAdminRole(jwt.workspaceRole)
    || await isWorkspaceAdmin(env, jwt.workspaceId, userId, jwt.backendUrl);
  if (!isAdmin) {
    return errorResponse('Forbidden: admin access required', 403, request, env.ENVIRONMENT);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400, request, env.ENVIRONMENT);
  }

  if (!isRecord(body) || !isRecord(body.config) || !isRecord(body.calcParams)) {
    return errorResponse('Missing config or calcParams', 400, request, env.ENVIRONMENT);
  }

  if (!isValidOvertimeConfig(body.config)) {
    return errorResponse('Invalid config: check field types and enum values', 400, request, env.ENVIRONMENT);
  }

  if (!isValidCalcParams(body.calcParams)) {
    return errorResponse('Invalid calcParams: numeric fields out of range', 400, request, env.ENVIRONMENT);
  }

  const payload: WorkspaceConfig = {
    config: body.config as unknown as WorkspaceConfig['config'],
    calcParams: body.calcParams as unknown as WorkspaceConfig['calcParams'],
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };

  console.log(`[AUDIT] Config saved: workspace=${jwt.workspaceId} user=${userId}`);
  await env.SETTINGS_KV.put(`ws:${jwt.workspaceId}:config`, JSON.stringify(payload));
  return jsonResponse({ status: 'saved' }, 200, request, env.ENVIRONMENT);
}

/**
 * Handles `GET /api/overrides` — retrieves per-user overrides for the
 * workspace from KV.
 *
 * Authenticates the caller via RSA256-verified JWT (read access is allowed
 * for any authenticated workspace member).  Returns `{ overrides: {} }` if
 * no overrides have been saved yet.
 *
 * @param request - The incoming HTTP request (must contain a valid JWT).
 * @param env     - Worker environment bindings.
 * @returns JSON response with the workspace overrides or a 401/500 error.
 */
export async function handleOverridesGet(request: Request, env: Env): Promise<Response> {
  let jwt;
  try {
    jwt = await extractAndVerifyJwt(request);
  } catch (e) {
    return errorResponse(`Unauthorized: ${(e as Error).message}`, 401, request, env.ENVIRONMENT);
  }

  const data = await env.SETTINGS_KV.get(`ws:${jwt.workspaceId}:overrides`);
  if (!data) {
    return jsonResponse({ overrides: {} }, 200, request, env.ENVIRONMENT);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    console.error(`[KV] Corrupted overrides JSON for workspace ${jwt.workspaceId}`);
    return errorResponse('Corrupted overrides data', 500, request, env.ENVIRONMENT);
  }

  if (!isValidWorkspaceOverrides(parsed)) {
    console.error(`[KV] Invalid overrides schema for workspace ${jwt.workspaceId}`);
    return errorResponse('Corrupted overrides data', 500, request, env.ENVIRONMENT);
  }

  if (!(parsed as unknown as Record<string, unknown>).schemaVersion) {
    console.warn(`[KV] Overrides for workspace ${jwt.workspaceId} missing schemaVersion — pre-v1 data`);
  }

  return jsonResponse(parsed, 200, request, env.ENVIRONMENT);
}

/**
 * Handles `PUT /api/overrides` — saves (creates or updates) per-user
 * overrides for the workspace in KV.
 *
 * Requires:
 * 1. RSA256-verified JWT (authentication).
 * 2. `backendUrl` claim in the JWT (needed for admin check).
 * 3. WORKSPACE_ADMIN or OWNER role (authorization).
 *
 * The request body must have an `overrides` object keyed by user ID.
 * Each user override is validated by `isValidUserOverride()`, which
 * enforces `OVERRIDE_BOUNDS` on all numeric fields.  The saved record
 * includes `schemaVersion: 1` and an audit trail.
 *
 * @param request - The incoming HTTP request with JSON body.
 * @param env     - Worker environment bindings.
 * @returns JSON response `{ status: "saved" }` on success, or an error.
 */
export async function handleOverridesPut(request: Request, env: Env): Promise<Response> {
  let jwt;
  try {
    jwt = await extractAndVerifyJwt(request);
  } catch (e) {
    return errorResponse(`Unauthorized: ${(e as Error).message}`, 401, request, env.ENVIRONMENT);
  }

  const userId = jwt.user ?? jwt.sub ?? 'unknown';
  if (!jwt.backendUrl) {
    return errorResponse('Bad Request: token missing backendUrl', 400, request, env.ENVIRONMENT);
  }
  const isAdmin = isAdminRole(jwt.workspaceRole)
    || await isWorkspaceAdmin(env, jwt.workspaceId, userId, jwt.backendUrl);
  if (!isAdmin) {
    return errorResponse('Forbidden: admin access required', 403, request, env.ENVIRONMENT);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400, request, env.ENVIRONMENT);
  }

  if (!isRecord(body) || !isRecord(body.overrides)) {
    return errorResponse('Invalid overrides: must be an object with "overrides" key', 400, request, env.ENVIRONMENT);
  }

  for (const [, userOverride] of Object.entries(body.overrides)) {
    if (!isValidUserOverride(userOverride)) {
      return errorResponse('Invalid override: unexpected field types or structure', 400, request, env.ENVIRONMENT);
    }
  }

  const payload: WorkspaceOverrides = {
    overrides: body.overrides as Record<string, unknown>,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };

  console.log(`[AUDIT] Overrides saved: workspace=${jwt.workspaceId} user=${userId}`);
  await env.SETTINGS_KV.put(`ws:${jwt.workspaceId}:overrides`, JSON.stringify(payload));
  return jsonResponse({ status: 'saved' }, 200, request, env.ENVIRONMENT);
}
