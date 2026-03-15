/**
 * @fileoverview Server Settings API Client
 *
 * Communicates with the Cloudflare Worker to fetch and persist
 * admin-controlled workspace settings and overrides.
 */

import { createLogger } from './logger.js';
import type { OvertimeConfig, CalculationParams, UserOverride } from './types.js';

const logger = createLogger('SettingsAPI');

/** Timeout for settings API fetch requests (ms). Prevents init from hanging if Worker is unreachable. */
const SETTINGS_API_TIMEOUT_MS = 10_000;

/** Auth token for API calls. */
let _authToken = '';

export interface ServerConfig {
    config: OvertimeConfig;
    calcParams: CalculationParams;
    updatedAt: string;
    updatedBy: string;
}

export interface ServerOverrides {
    overrides: Record<string, UserOverride>;
    updatedAt: string;
    updatedBy: string;
}

/**
 * Initialize the settings API client.
 * @param authToken - JWT auth token for requests
 */
export function initSettingsApi(authToken: string): void {
    _authToken = authToken;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
    if (!_authToken) {
        logger.warn('No auth token set — skipping settings API call');
        return null;
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Addon-Token': _authToken,
        ...((options.headers as Record<string, string>) ?? {}),
    };

    try {
        // Build timeout signal — use AbortSignal.timeout when available, fallback to manual AbortController
        let timeoutSignal: AbortSignal;
        let fallbackTimerId: ReturnType<typeof setTimeout> | undefined;
        if (typeof AbortSignal.timeout === 'function') {
            timeoutSignal = AbortSignal.timeout(SETTINGS_API_TIMEOUT_MS);
        } else {
            const controller = new AbortController();
            fallbackTimerId = setTimeout(() => controller.abort(), SETTINGS_API_TIMEOUT_MS);
            timeoutSignal = controller.signal;
        }

        const response = await fetch(path, { ...options, headers, signal: timeoutSignal }).finally(
            () => {
                if (fallbackTimerId !== undefined) clearTimeout(fallbackTimerId);
            }
        );

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            logger.warn(
                `Settings API ${options.method ?? 'GET'} ${path} failed: ${response.status} ${text}`
            );
            return null;
        }

        return (await response.json()) as T;
    } catch (err) {
        logger.warn(`Settings API ${path} error: ${(err as Error).message}`);
        return null;
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidServerConfig(data: unknown): data is ServerConfig {
    if (!isRecord(data)) return false;
    if (!isRecord(data.config) || !isRecord(data.calcParams)) return false;
    // Check required boolean config fields
    const boolFields = [
        'useProfileCapacity',
        'useProfileWorkingDays',
        'applyHolidays',
        'applyTimeOff',
        'showBillableBreakdown',
        'showDecimalTime',
        'enableTieredOT',
    ];
    for (const f of boolFields) {
        if (typeof data.config[f] !== 'boolean') return false;
    }
    // Check required numeric calc fields
    const numFields = [
        'dailyThreshold',
        'weeklyThreshold',
        'overtimeMultiplier',
        'tier2ThresholdHours',
        'tier2Multiplier',
    ];
    for (const f of numFields) {
        if (typeof data.calcParams[f] !== 'number') return false;
    }
    return true;
}

function isValidServerOverrides(data: unknown): data is ServerOverrides {
    if (!isRecord(data)) return false;
    if (!isRecord(data.overrides)) return false;
    return true;
}

/** Fetch workspace config from server. Returns null if unavailable or malformed. */
export async function fetchServerConfig(): Promise<ServerConfig | null> {
    const result = await apiFetch<ServerConfig>('/api/config');
    if (result === null) return null;
    if (!isValidServerConfig(result)) {
        logger.warn('Server config response failed runtime validation — treating as unavailable');
        return null;
    }
    return result;
}

/** Save workspace config to server (admin only). Returns true on success. */
export async function saveServerConfig(
    config: OvertimeConfig,
    calcParams: CalculationParams
): Promise<boolean> {
    const result = await apiFetch<{ status: string }>('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ config, calcParams }),
    });
    return result?.status === 'saved';
}

/** Fetch workspace overrides from server. Returns null if unavailable or malformed. */
export async function fetchServerOverrides(): Promise<ServerOverrides | null> {
    const result = await apiFetch<ServerOverrides>('/api/overrides');
    if (result === null) return null;
    if (!isValidServerOverrides(result)) {
        logger.warn(
            'Server overrides response failed runtime validation — treating as unavailable'
        );
        return null;
    }
    return result;
}

/** Save workspace overrides to server (admin only). Returns true on success. */
export async function saveServerOverrides(
    overrides: Record<string, UserOverride>
): Promise<boolean> {
    const result = await apiFetch<{ status: string }>('/api/overrides', {
        method: 'PUT',
        body: JSON.stringify({ overrides }),
    });
    return result?.status === 'saved';
}
