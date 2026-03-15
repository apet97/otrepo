/**
 * @jest-environment node
 *
 * Settings API Client Tests
 *
 * Tests for the Cloudflare Worker settings API client,
 * covering auth token handling, fetch success/failure paths,
 * and all public functions.
 *
 * @see js/settings-api.ts
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// Mock logger to avoid side effects and verify logging
const mockWarn = jest.fn();
jest.unstable_mockModule('../../js/logger.js', () => ({
    createLogger: jest.fn(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: mockWarn,
        error: jest.fn(),
    })),
}));

// Mock global fetch
global.fetch = jest.fn();

const { initSettingsApi, fetchServerConfig, fetchServerOverrides, saveServerConfig, saveServerOverrides } =
    await import('../../js/settings-api.js');

describe('Settings API Client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fetch.mockReset();
        // Initialize with a valid token by default
        initSettingsApi('test-jwt-token');
    });

    afterEach(standardAfterEach);

    describe('initSettingsApi', () => {
        it('sets the auth token for subsequent calls', async () => {
            initSettingsApi('my-token');
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ config: {}, calcParams: {}, updatedAt: '', updatedBy: '' }),
            });

            await fetchServerConfig();

            expect(fetch).toHaveBeenCalledWith(
                '/api/config',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-Addon-Token': 'my-token',
                    }),
                })
            );
        });
    });

    describe('apiFetch — no auth token', () => {
        it('returns null and warns when no auth token is set', async () => {
            // Clear the token
            initSettingsApi('');

            const result = await fetchServerConfig();

            expect(result).toBeNull();
            expect(fetch).not.toHaveBeenCalled();
            expect(mockWarn).toHaveBeenCalledWith(
                'No auth token set — skipping settings API call'
            );
        });
    });

    describe('apiFetch — non-ok response', () => {
        it('returns null and warns on HTTP error response', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                text: async () => 'Forbidden',
            });

            const result = await fetchServerConfig();

            expect(result).toBeNull();
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('failed: 403 Forbidden')
            );
        });

        it('handles response.text() rejection gracefully', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => { throw new Error('text read failed'); },
            });

            const result = await fetchServerConfig();

            expect(result).toBeNull();
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('failed: 500 ')
            );
        });

        it('logs the correct method for PUT requests on non-ok response', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 422,
                text: async () => 'Unprocessable',
            });

            const result = await saveServerConfig({}, {});

            expect(result).toBe(false);
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('Settings API PUT /api/config failed: 422 Unprocessable')
            );
        });
    });

    describe('apiFetch — timeout', () => {
        it('passes an AbortSignal to fetch for timeout enforcement', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ config: {}, calcParams: {}, updatedAt: '', updatedBy: '' }),
            });

            await fetchServerConfig();

            expect(fetch).toHaveBeenCalledWith(
                '/api/config',
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                })
            );
        });

        it('returns null when fetch is aborted by timeout', async () => {
            const abortError = new DOMException('The operation was aborted', 'AbortError');
            fetch.mockRejectedValueOnce(abortError);

            const result = await fetchServerConfig();

            expect(result).toBeNull();
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('/api/config error:')
            );
        });
    });

    describe('apiFetch — network error (catch branch)', () => {
        it('returns null and warns on fetch rejection', async () => {
            fetch.mockRejectedValueOnce(new Error('Network failure'));

            const result = await fetchServerConfig();

            expect(result).toBeNull();
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('/api/config error: Network failure')
            );
        });

        it('returns null on fetch TypeError', async () => {
            fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

            const result = await fetchServerOverrides();

            expect(result).toBeNull();
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('/api/overrides error: Failed to fetch')
            );
        });
    });

    describe('fetchServerConfig', () => {
        it('returns parsed config on success', async () => {
            const serverConfig = {
                config: {
                    useProfileCapacity: true,
                    useProfileWorkingDays: true,
                    applyHolidays: true,
                    applyTimeOff: true,
                    showBillableBreakdown: false,
                    showDecimalTime: false,
                    enableTieredOT: false,
                },
                calcParams: {
                    dailyThreshold: 8,
                    weeklyThreshold: 40,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 4,
                    tier2Multiplier: 2.0,
                },
                updatedAt: '2026-03-12T00:00:00Z',
                updatedBy: 'admin-user',
            };
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => serverConfig,
            });

            const result = await fetchServerConfig();

            expect(result).toEqual(serverConfig);
            expect(fetch).toHaveBeenCalledWith(
                '/api/config',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                    }),
                })
            );
        });

        it('returns null and warns when a successful config response contains malformed JSON', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => {
                    throw new Error('Invalid JSON');
                },
            });

            const result = await fetchServerConfig();

            expect(result).toBeNull();
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('/api/config error: Invalid JSON')
            );
        });
    });

    describe('fetchServerOverrides', () => {
        it('returns parsed overrides on success', async () => {
            const serverOverrides = {
                overrides: { user1: { dailyThreshold: 6 } },
                updatedAt: '2026-03-12T00:00:00Z',
                updatedBy: 'admin-user',
            };
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => serverOverrides,
            });

            const result = await fetchServerOverrides();

            expect(result).toEqual(serverOverrides);
            expect(fetch).toHaveBeenCalledWith(
                '/api/overrides',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-Addon-Token': 'test-jwt-token',
                    }),
                })
            );
        });
    });

    describe('saveServerConfig', () => {
        it('returns true when server responds with status "saved"', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'saved' }),
            });

            const result = await saveServerConfig(
                { dailyThreshold: 8 },
                { multiplier: 1.5 }
            );

            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledWith(
                '/api/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({
                        config: { dailyThreshold: 8 },
                        calcParams: { multiplier: 1.5 },
                    }),
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'X-Addon-Token': 'test-jwt-token',
                    }),
                })
            );
        });

        it('returns false when server responds with non-"saved" status', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'error' }),
            });

            const result = await saveServerConfig({}, {});

            expect(result).toBe(false);
        });

        it('returns false and warns when a successful save response contains malformed JSON', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => {
                    throw new Error('Invalid JSON');
                },
            });

            const result = await saveServerConfig({}, {});

            expect(result).toBe(false);
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('/api/config error: Invalid JSON')
            );
        });

        it('returns false when apiFetch returns null (no auth token)', async () => {
            initSettingsApi('');

            const result = await saveServerConfig({}, {});

            expect(result).toBe(false);
            expect(fetch).not.toHaveBeenCalled();
        });

        it('returns false when fetch fails with network error', async () => {
            fetch.mockRejectedValueOnce(new Error('connection refused'));

            const result = await saveServerConfig({}, {});

            expect(result).toBe(false);
        });
    });

    describe('saveServerOverrides', () => {
        it('returns true when server responds with status "saved"', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'saved' }),
            });

            const overrides = { user1: { dailyThreshold: 6 }, user2: { dailyThreshold: 10 } };
            const result = await saveServerOverrides(overrides);

            expect(result).toBe(true);
            expect(fetch).toHaveBeenCalledWith(
                '/api/overrides',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ overrides }),
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'X-Addon-Token': 'test-jwt-token',
                    }),
                })
            );
        });

        it('returns false when server responds with non-"saved" status', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'failed' }),
            });

            const result = await saveServerOverrides({});

            expect(result).toBe(false);
        });

        it('returns false when apiFetch returns null (no auth token)', async () => {
            initSettingsApi('');

            const result = await saveServerOverrides({});

            expect(result).toBe(false);
            expect(fetch).not.toHaveBeenCalled();
        });

        it('returns false when fetch rejects', async () => {
            fetch.mockRejectedValueOnce(new Error('timeout'));

            const result = await saveServerOverrides({ u1: {} });

            expect(result).toBe(false);
        });

        it('returns false on HTTP error response', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'Unauthorized',
            });

            const result = await saveServerOverrides({ u1: {} });

            expect(result).toBe(false);
            expect(mockWarn).toHaveBeenCalledWith(
                expect.stringContaining('PUT /api/overrides failed: 401 Unauthorized')
            );
        });
    });
});
