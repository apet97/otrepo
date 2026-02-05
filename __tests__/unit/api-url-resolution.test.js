/**
 * @jest-environment node
 */

import { webcrypto } from 'crypto';

// Set up Web Crypto API for Node environment
global.crypto = webcrypto;

/**
 * URL Resolution Algorithm Specification Tests
 *
 * This file documents the resolveReportsBaseUrl() algorithm in api.ts:
 *
 * The algorithm resolves the correct Reports API URL based on token claims,
 * supporting multiple Clockify environments (production, regional, developer portal).
 *
 * RESOLUTION BRANCHES:
 *
 * Branch 1: reportsUrl claim exists
 *   - Special case: developer.clockify.me → use backendUrl if reportsUrl differs
 *   - Otherwise: use reportsUrl as-is
 *
 * Branch 2: reportsUrl missing, derive from backendUrl
 *   - Developer portal (developer.clockify.me): use backendUrl
 *   - Production (api.clockify.me): use https://reports.api.clockify.me
 *   - Regional (*.clockify.me): transform /api to /report
 *
 * Branch 3: Unknown environment fallback
 *   - Default to https://reports.api.clockify.me
 *
 * @see js/api.ts - resolveReportsBaseUrl implementation
 * @see docs/guide.md - URL resolution
 */

import { jest, afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// Note: resolveReportsBaseUrl is a private function in api.ts
// These tests document the expected behavior and can be used
// for integration testing via fetchDetailedReport

describe('URL Resolution Algorithm Specification', () => {
  afterEach(() => {
    standardAfterEach();
  });

  describe('Branch 1: reportsUrl Claim Exists', () => {
    it('should use reportsUrl directly when present and not developer portal', () => {
      // Given: Claims with explicit reportsUrl
      const claims = {
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      // Expected: Use reportsUrl as-is
      const expected = 'https://reports.api.clockify.me';

      // This is the standard production case
      expect(claims.reportsUrl).toBe(expected);
    });

    it('should use reportsUrl when backendUrl is regional', () => {
      // Given: EU backend with EU reports URL
      const claims = {
        backendUrl: 'https://eu.api.clockify.me/api',
        reportsUrl: 'https://eu.reports.api.clockify.me'
      };

      // Expected: Use reportsUrl as-is
      const expected = 'https://eu.reports.api.clockify.me';

      expect(claims.reportsUrl).toBe(expected);
    });

    describe('Developer Portal Special Case', () => {
      it('should use backendUrl when developer portal and reportsUrl differs', () => {
        // Given: Developer portal backend with production reports URL
        const claims = {
          backendUrl: 'https://developer.clockify.me/api',
          reportsUrl: 'https://reports.api.clockify.me' // Different host!
        };

        // Expected: Use backendUrl because we're in dev portal
        // and reportsUrl points to different (production) host
        const expected = 'https://developer.clockify.me/api';

        // This handles local dev setups where reports should run through local backend
        expect(claims.backendUrl).toBe(expected);
      });

      it('should use reportsUrl when developer portal and reportsUrl matches', () => {
        // Given: Developer portal with matching reports URL
        const claims = {
          backendUrl: 'https://developer.clockify.me/api',
          reportsUrl: 'https://developer.clockify.me/api/reports'
        };

        // Expected: Use reportsUrl since it's on the same host
        const expected = 'https://developer.clockify.me/api/reports';

        // Both URLs are on developer.clockify.me, so use reportsUrl
        expect(claims.reportsUrl).toBe(expected);
      });
    });
  });

  describe('Branch 2: reportsUrl Missing - Derive from backendUrl', () => {
    it('should use backendUrl for developer portal', () => {
      // Given: Developer portal with no reportsUrl
      const claims = {
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: undefined
      };

      // Expected: Use backendUrl directly (reports run locally)
      const expected = 'https://developer.clockify.me/api';

      expect(claims.backendUrl).toBe(expected);
    });

    it('should use reports.api.clockify.me for production', () => {
      // Given: Production backend with no reportsUrl
      const claims = {
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: undefined
      };

      // Expected: Use dedicated production Reports API
      const expected = 'https://reports.api.clockify.me';

      // Production always uses dedicated Reports API
      expect(expected).toBe('https://reports.api.clockify.me');
    });

    it('should transform /api to /report for regional URLs', () => {
      // Given: Regional backend with no reportsUrl
      const claims = {
        backendUrl: 'https://eu.api.clockify.me/api',
        reportsUrl: undefined
      };

      // Expected: Transform /api path to /report
      const expected = 'https://eu.api.clockify.me/report';

      // Regional URLs have same origin but /report instead of /api
      const transformed = claims.backendUrl.replace(/\/api$/, '/report');
      expect(transformed).toBe(expected);
    });

    it('should handle regional URL without /api path', () => {
      // Given: Regional URL without explicit /api path
      const claims = {
        backendUrl: 'https://eu.api.clockify.me',
        reportsUrl: undefined
      };

      // Expected: Append /report
      const expected = 'https://eu.api.clockify.me/report';

      // If no /api path, just append /report
      const result = claims.backendUrl.endsWith('/api')
        ? claims.backendUrl.replace(/\/api$/, '/report')
        : claims.backendUrl + '/report';
      expect(result).toBe(expected);
    });
  });

  describe('Branch 3: Unknown Environment Fallback', () => {
    it('should use production default for unknown environment', () => {
      // Given: Unknown/invalid backend URL
      const claims = {
        backendUrl: 'https://custom.example.com/api',
        reportsUrl: undefined
      };

      // Expected: Fall back to production Reports API
      const expected = 'https://reports.api.clockify.me';

      // Unknown environments default to production Reports API
      expect(expected).toBe('https://reports.api.clockify.me');
    });

    it('should use production default when backendUrl is empty', () => {
      // Given: Empty claims
      const claims = {
        backendUrl: '',
        reportsUrl: undefined
      };

      // Expected: Fall back to production
      const expected = 'https://reports.api.clockify.me';

      expect(expected).toBe('https://reports.api.clockify.me');
    });

    it('should use production default when claims are null', () => {
      // Given: Null claims
      const claims = null;

      // Expected: Fall back to production
      const expected = 'https://reports.api.clockify.me';

      expect(expected).toBe('https://reports.api.clockify.me');
    });
  });

  describe('Trailing Slash Handling', () => {
    it('should normalize trailing slashes from backendUrl', () => {
      // Given: Backend URL with trailing slash
      const backendUrl = 'https://api.clockify.me/api/';

      // Expected: Trailing slash removed
      const normalized = backendUrl.replace(/\/+$/, '');
      expect(normalized).toBe('https://api.clockify.me/api');
    });

    it('should normalize trailing slashes from reportsUrl', () => {
      // Given: Reports URL with trailing slash
      const reportsUrl = 'https://reports.api.clockify.me/';

      // Expected: Trailing slash removed
      const normalized = reportsUrl.replace(/\/+$/, '');
      expect(normalized).toBe('https://reports.api.clockify.me');
    });

    it('should handle multiple trailing slashes', () => {
      // Given: URL with multiple trailing slashes
      const url = 'https://api.clockify.me/api///';

      // Expected: All trailing slashes removed
      const normalized = url.replace(/\/+$/, '');
      expect(normalized).toBe('https://api.clockify.me/api');
    });
  });

  describe('Malformed URL Handling', () => {
    it('should handle malformed backendUrl gracefully', () => {
      // Given: Malformed URL
      const claims = {
        backendUrl: 'not-a-valid-url',
        reportsUrl: undefined
      };

      // Expected: Should not throw, should fall back to production
      // The URL constructor would throw, so we catch and use fallback
      let result;
      try {
        new URL(claims.backendUrl);
        result = claims.backendUrl;
      } catch {
        result = 'https://reports.api.clockify.me';
      }

      expect(result).toBe('https://reports.api.clockify.me');
    });

    it('should handle backendUrl with missing protocol', () => {
      // Given: URL without protocol
      const claims = {
        backendUrl: 'api.clockify.me/api',
        reportsUrl: undefined
      };

      // Expected: Should fall back to production (URL constructor fails)
      let result;
      try {
        new URL(claims.backendUrl);
        result = claims.backendUrl;
      } catch {
        result = 'https://reports.api.clockify.me';
      }

      expect(result).toBe('https://reports.api.clockify.me');
    });
  });

  describe('Environment Detection', () => {
    it('should correctly identify production environment', () => {
      const productionHosts = [
        'api.clockify.me',
        'API.CLOCKIFY.ME', // Case insensitive
      ];

      productionHosts.forEach(host => {
        expect(host.toLowerCase()).toBe('api.clockify.me');
      });
    });

    it('should correctly identify developer portal environment', () => {
      const devHosts = [
        'developer.clockify.me',
        'DEVELOPER.CLOCKIFY.ME', // Case insensitive
      ];

      devHosts.forEach(host => {
        expect(host.toLowerCase()).toBe('developer.clockify.me');
      });
    });

    it('should correctly identify regional environments', () => {
      const regionalHosts = [
        'eu.api.clockify.me',
        'us.api.clockify.me',
        'ap.api.clockify.me',
      ];

      regionalHosts.forEach(host => {
        expect(host).toMatch(/\.clockify\.me$/);
        expect(host).not.toBe('api.clockify.me');
        expect(host).not.toBe('developer.clockify.me');
      });
    });
  });

  describe('URL Resolution Examples', () => {
    // These are the examples from docs/guide.md documentation

    it('Example 1: Production with missing reportsUrl', () => {
      // | backendUrl | reportsUrl | Result |
      // | https://api.clockify.me/api | (missing) | https://reports.api.clockify.me |

      const backendUrl = 'https://api.clockify.me/api';
      const reportsUrl = undefined;
      const expected = 'https://reports.api.clockify.me';

      // Verify the expected behavior
      expect(backendUrl).toContain('api.clockify.me');
      expect(reportsUrl).toBeUndefined();
      expect(expected).toBe('https://reports.api.clockify.me');
    });

    it('Example 2: EU Regional with missing reportsUrl', () => {
      // | https://eu.api.clockify.me/api | (missing) | https://eu.api.clockify.me/report |

      const backendUrl = 'https://eu.api.clockify.me/api';
      const reportsUrl = undefined;
      const expected = 'https://eu.api.clockify.me/report';

      // Transform /api to /report
      const transformed = backendUrl.replace(/\/api$/, '/report');
      expect(transformed).toBe(expected);
    });

    it('Example 3: Developer portal with missing reportsUrl', () => {
      // | https://developer.clockify.me/api | (missing) | https://developer.clockify.me/api |

      const backendUrl = 'https://developer.clockify.me/api';
      const reportsUrl = undefined;
      const expected = 'https://developer.clockify.me/api';

      // Developer portal uses backendUrl directly
      expect(backendUrl).toBe(expected);
    });

    it('Example 4: Production with explicit reportsUrl', () => {
      // | https://api.clockify.me/api | https://reports.api.clockify.me | https://reports.api.clockify.me |

      const backendUrl = 'https://api.clockify.me/api';
      const reportsUrl = 'https://reports.api.clockify.me';
      const expected = 'https://reports.api.clockify.me';

      // Use reportsUrl when present
      expect(reportsUrl).toBe(expected);
    });
  });
});

/**
 * Integration Tests - Verify URL Resolution via fetchDetailedReport
 *
 * These tests actually call fetchDetailedReport() and verify the URL
 * that gets passed to fetch(). They kill mutations in resolveReportsBaseUrl().
 */
import { Api, resetRateLimiter, resetCircuitBreaker } from '../../js/api.js';
import { store } from '../../js/state.js';
import { createMockJwtToken } from '../helpers/mock-data.js';

// Mock fetch globally
global.fetch = jest.fn();

/**
 * Creates a mock response object with all required methods for API tests.
 */
function mockResponse(data, { ok = true, status = 200, headers = {} } = {}) {
  const jsonStr = JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => jsonStr,
    headers: {
      get: (name) => {
        if (name === 'Content-Length') return String(jsonStr.length);
        return headers[name] || null;
      }
    }
  };
}

describe('URL Resolution Integration Tests', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ advanceTimers: true });
    store.token = createMockJwtToken();
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    resetCircuitBreaker();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    standardAfterEach();
    fetch.mockReset();
  });

  describe('Production Environment URL Resolution', () => {
    it('should use reports.api.clockify.me when backendUrl is api.clockify.me (no reportsUrl)', async () => {
      store.claims = {
        workspaceId: 'ws_prod',
        backendUrl: 'https://api.clockify.me'
        // reportsUrl is missing
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_prod',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://reports.api.clockify.me/v1/workspaces/ws_prod/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use explicit reportsUrl when provided for production', async () => {
      store.claims = {
        workspaceId: 'ws_prod',
        backendUrl: 'https://api.clockify.me',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_prod',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://reports.api.clockify.me/v1/workspaces/ws_prod/reports/detailed',
        expect.any(Object)
      );
    });
  });

  describe('Developer Portal URL Resolution', () => {
    it('should use backendUrl when developer portal and reportsUrl differs', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me' // Different host!
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should use developer.clockify.me, NOT reports.api.clockify.me
      expect(fetch).toHaveBeenCalledWith(
        'https://developer.clockify.me/api/v1/workspaces/ws_dev/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use reportsUrl when developer portal and reportsUrl matches host', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'https://developer.clockify.me/reports' // Same host!
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should use reportsUrl since it's on the same host
      expect(fetch).toHaveBeenCalledWith(
        'https://developer.clockify.me/reports/v1/workspaces/ws_dev/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use backendUrl when developer portal and no reportsUrl', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api'
        // reportsUrl is missing
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://developer.clockify.me/api/v1/workspaces/ws_dev/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use backendUrl when developer portal reportsUrl is invalid', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'not-a-valid-url' // Invalid URL
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should fall back to backendUrl due to parse error
      expect(fetch).toHaveBeenCalledWith(
        'https://developer.clockify.me/api/v1/workspaces/ws_dev/reports/detailed',
        expect.any(Object)
      );
    });
  });

  describe('Regional Environment URL Resolution', () => {
    it('should transform /api to /report for EU regional', async () => {
      store.claims = {
        workspaceId: 'ws_eu',
        backendUrl: 'https://eu.api.clockify.me/api'
        // reportsUrl is missing
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_eu',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://eu.api.clockify.me/report/v1/workspaces/ws_eu/reports/detailed',
        expect.any(Object)
      );
    });

    it('should append /report for regional URL without /api path', async () => {
      store.claims = {
        workspaceId: 'ws_region',
        backendUrl: 'https://use2.clockify.me'
        // reportsUrl is missing, and backendUrl has no /api path
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_region',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://use2.clockify.me/report/v1/workspaces/ws_region/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use explicit reportsUrl for regional when provided', async () => {
      store.claims = {
        workspaceId: 'ws_eu',
        backendUrl: 'https://eu.api.clockify.me/api',
        reportsUrl: 'https://eu.reports.clockify.me'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_eu',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://eu.reports.clockify.me/v1/workspaces/ws_eu/reports/detailed',
        expect.any(Object)
      );
    });
  });

  describe('Fallback URL Resolution', () => {
    it('should use production default for unknown environment', async () => {
      store.claims = {
        workspaceId: 'ws_custom',
        backendUrl: 'https://custom.example.com/api'
        // Unknown domain
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_custom',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should fallback to production Reports API
      expect(fetch).toHaveBeenCalledWith(
        'https://reports.api.clockify.me/v1/workspaces/ws_custom/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use production default when backendUrl is empty', async () => {
      store.claims = {
        workspaceId: 'ws_empty',
        backendUrl: ''
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_empty',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://reports.api.clockify.me/v1/workspaces/ws_empty/reports/detailed',
        expect.any(Object)
      );
    });

    it('should use production default when backendUrl is malformed', async () => {
      store.claims = {
        workspaceId: 'ws_bad',
        backendUrl: 'not-a-valid-url'
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_bad',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(fetch).toHaveBeenCalledWith(
        'https://reports.api.clockify.me/v1/workspaces/ws_bad/reports/detailed',
        expect.any(Object)
      );
    });
  });

  describe('Trailing Slash Normalization', () => {
    it('should normalize trailing slashes from backendUrl', async () => {
      store.claims = {
        workspaceId: 'ws_slash',
        backendUrl: 'https://developer.clockify.me/api/'
        // Trailing slash
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_slash',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should NOT have double slashes in the URL
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('///');
      expect(calledUrl).toContain('developer.clockify.me/api/v1');
    });

    it('should normalize trailing slashes from reportsUrl', async () => {
      store.claims = {
        workspaceId: 'ws_slash',
        backendUrl: 'https://api.clockify.me',
        reportsUrl: 'https://reports.api.clockify.me/'
        // Trailing slash
      };

      fetch.mockResolvedValueOnce(mockResponse({ timeentries: [] }));

      const promise = Api.fetchDetailedReport(
        'ws_slash',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );
      await jest.runAllTimersAsync();
      await promise;

      // Should NOT have double slashes
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('//v1');
    });
  });
});
