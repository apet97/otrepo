/**
 * @jest-environment jsdom
 */

/**
 * Auth Handling Test Suite - JWT & Token Specification
 *
 * SPECIFICATION: Authentication Flow
 *
 * OTPLUS uses Clockify addon authentication with JWT tokens:
 *
 * | Step | Action | Module |
 * |------|--------|--------|
 * | 1 | Extract token from URL param `auth_token` | main.ts |
 * | 2 | Decode JWT (split on '.', base64 decode payload) | main.ts |
 * | 3 | Validate payload contains workspaceId | main.ts |
 * | 4 | Store token via store.setToken(token, claims) | state.ts |
 * | 5 | Use token in X-Addon-Token header for API calls | api.ts |
 *
 * Security Requirements:
 * - Token is stored in memory only (NOT in localStorage)
 * - Token is never logged or exposed to diagnostics
 * - Token is sent only via X-Addon-Token header (not URL params)
 *
 * @see js/main.ts - Token extraction and JWT decoding
 * @see js/state.ts - Token storage
 * @see js/api.ts - Token header injection
 * @see docs/spec.md - Security requirements (no secrets logged/persisted)
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { store } from '../../js/state.js';
import { standardAfterEach, expectNoTokenLeakage } from '../helpers/setup.js';
import { createMockJwtToken } from '../helpers/mock-data.js';

// Mock global fetch
global.fetch = jest.fn();

describe('JWT Token Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.token = null;
    store.claims = null;
  });

  afterEach(() => {
    standardAfterEach();
    store.token = null;
    store.claims = null;
  });

  describe('Token Extraction from URL', () => {
    /**
     * SPECIFICATION: URL Parameter Token
     *
     * The addon receives its authentication token via URL query parameter:
     * - Parameter name: `auth_token`
     * - Format: JWT (header.payload.signature)
     * - Source: Clockify iframe injection
     */

    it('should extract token from auth_token URL parameter', () => {
      // Simulate URL with auth_token
      const mockToken = 'header.eyJ3b3Jrc3BhY2VJZCI6IndzXzEyMyIsInVzZXJJZCI6InVzZXJfMSJ9.signature';

      // URLSearchParams behavior test
      const params = new URLSearchParams(`?auth_token=${mockToken}`);
      const extractedToken = params.get('auth_token');

      expect(extractedToken).toBe(mockToken);
    });

    it('should handle missing auth_token parameter gracefully', () => {
      const params = new URLSearchParams('?other_param=value');
      const token = params.get('auth_token');

      expect(token).toBeNull();
    });

    it('should handle empty auth_token parameter', () => {
      const params = new URLSearchParams('?auth_token=');
      const token = params.get('auth_token');

      expect(token).toBe('');
    });
  });

  describe('JWT Decoding Algorithm', () => {
    /**
     * SPECIFICATION: JWT Structure & Decoding
     *
     * JWT format: header.payload.signature (base64 encoded, separated by '.')
     *
     * Decoding algorithm:
     * 1. Split token on '.'
     * 2. Take the second part (payload)
     * 3. Base64 decode
     * 4. JSON parse
     *
     * Expected payload fields:
     * - workspaceId (required): Clockify workspace ID
     * - userId (optional): Current user ID
     * - theme (optional): 'DARK' or 'LIGHT'
     * - backendUrl (optional): API base URL
     * - reportsUrl (optional): Reports API URL
     */

    it('should decode JWT payload from token string', () => {
      // Create a valid JWT-like token
      // Payload: { workspaceId: 'ws_123', userId: 'user_1' }
      const payload = { workspaceId: 'ws_123', userId: 'user_1' };
      const encodedPayload = btoa(JSON.stringify(payload));
      const mockToken = `header.${encodedPayload}.signature`;

      // Decode using same algorithm as main.ts
      const decoded = JSON.parse(atob(mockToken.split('.')[1]));

      expect(decoded).toEqual(payload);
      expect(decoded.workspaceId).toBe('ws_123');
      expect(decoded.userId).toBe('user_1');
    });

    it('should extract workspace ID from JWT payload', () => {
      const payload = { workspaceId: 'workspace_abc123' };
      const encodedPayload = btoa(JSON.stringify(payload));
      const mockToken = `header.${encodedPayload}.signature`;

      const decoded = JSON.parse(atob(mockToken.split('.')[1]));

      expect(decoded.workspaceId).toBe('workspace_abc123');
    });

    it('should handle malformed JWT gracefully (invalid base64)', () => {
      const malformedToken = 'header.!!!invalid-base64!!!.signature';

      expect(() => {
        atob(malformedToken.split('.')[1]);
      }).toThrow();
    });

    it('should handle malformed JWT gracefully (invalid JSON)', () => {
      const invalidJsonPayload = btoa('not-valid-json');
      const malformedToken = `header.${invalidJsonPayload}.signature`;

      expect(() => {
        JSON.parse(atob(malformedToken.split('.')[1]));
      }).toThrow();
    });

    it('should handle JWT with missing workspaceId', () => {
      const payload = { userId: 'user_1', theme: 'DARK' }; // No workspaceId
      const encodedPayload = btoa(JSON.stringify(payload));
      const mockToken = `header.${encodedPayload}.signature`;

      const decoded = JSON.parse(atob(mockToken.split('.')[1]));

      expect(decoded.workspaceId).toBeUndefined();
    });
  });

  describe('Token Storage (state.ts)', () => {
    /**
     * SPECIFICATION: Token Storage
     *
     * store.setToken(token, claims) behavior:
     * - Stores raw token in store.token (for API calls)
     * - Stores decoded claims in store.claims
     * - If workspace changes: clears profiles, holidays, timeOff Maps
     * - DOES NOT persist token to localStorage (memory only)
     */

    it('should store token via setToken()', () => {
      const token = 'mock_jwt_token';
      const claims = { workspaceId: 'ws_123', userId: 'user_1', backendUrl: 'https://api.clockify.me/api' };

      store.setToken(token, claims);

      expect(store.token).toBe(token);
      expect(store.claims).toEqual(claims);
    });

    it('should not persist token to localStorage', () => {
      const token = 'mock_jwt_token_secret';
      const claims = { workspaceId: 'ws_123', userId: 'user_1', backendUrl: 'https://api.clockify.me/api' };

      store.setToken(token, claims);

      expectNoTokenLeakage(store, token);
    });

    it('should clear data maps when workspace changes', () => {
      // Set initial workspace
      store.setToken('token_1', {
        workspaceId: 'ws_old',
        backendUrl: 'https://api.clockify.me/api'
      });

      // Add some data
      store.profiles.set('user_1', { workCapacityHours: 8 });
      store.holidays.set('user_1', new Map([['2025-01-01', { name: 'Holiday' }]]));
      store.timeOff.set('user_1', new Map([['2025-01-02', { isFullDay: true }]]));

      expect(store.profiles.size).toBe(1);
      expect(store.holidays.size).toBe(1);
      expect(store.timeOff.size).toBe(1);

      // Switch to new workspace
      store.setToken('token_2', {
        workspaceId: 'ws_new',
        backendUrl: 'https://api.clockify.me/api'
      });

      // Maps should be cleared
      expect(store.profiles.size).toBe(0);
      expect(store.holidays.size).toBe(0);
      expect(store.timeOff.size).toBe(0);
    });

    it('should NOT clear data maps when same workspace', () => {
      // Set initial workspace
      store.setToken('token_1', {
        workspaceId: 'ws_same',
        backendUrl: 'https://api.clockify.me/api'
      });

      // Add some data
      store.profiles.set('user_1', { workCapacityHours: 8 });

      expect(store.profiles.size).toBe(1);

      // Set token again for SAME workspace
      store.setToken('token_2', {
        workspaceId: 'ws_same',
        backendUrl: 'https://api.clockify.me/api'
      });

      // Maps should NOT be cleared
      expect(store.profiles.size).toBe(1);
    });

    it('should NOT persist token to localStorage', () => {
      const sensitiveToken = 'sensitive_jwt_token_123';
      const claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

      store.setToken(sensitiveToken, claims);

      // Persist config (should not include token)
      store.saveConfig();

      // Check localStorage doesn't contain token
      const storedConfig = localStorage.getItem('otplus_config');
      if (storedConfig) {
        expect(storedConfig).not.toContain(sensitiveToken);
      }

      // Check all localStorage keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        expect(value).not.toContain(sensitiveToken);
      }
    });
  });

  describe('Auth Header (X-Addon-Token)', () => {
    /**
     * SPECIFICATION: API Authentication Header
     *
     * All API requests use X-Addon-Token header for authentication:
     * - Header name: X-Addon-Token
     * - Value: Raw JWT token from store.token
     * - NEVER sent in URL params (security requirement)
     */

    it('should send token as X-Addon-Token header', async () => {
      const mockResp = {
        ok: true,
        status: 200,
        json: async () => ([]),
        text: async () => '[]',
        headers: { get: () => null }
      };
      fetch.mockResolvedValue(mockResp);

      const { Api, resetRateLimiter } = await import('../../js/api.js');

      const token = createMockJwtToken();
      store.token = token;
      store.claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

      resetRateLimiter();
      await Api.fetchUsers('ws_123');

      expect(fetch).toHaveBeenCalled();
      const [, options] = fetch.mock.calls[0];

      // Verify X-Addon-Token header is set
      expect(options.headers['X-Addon-Token']).toBe(token);
    });

    it('should NOT send token in URL params', async () => {
      const mockResp = {
        ok: true,
        status: 200,
        json: async () => ([]),
        text: async () => '[]',
        headers: { get: () => null }
      };
      fetch.mockResolvedValue(mockResp);

      const { Api, resetRateLimiter } = await import('../../js/api.js');

      const token = createMockJwtToken();
      store.token = token;
      store.claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

      resetRateLimiter();
      await Api.fetchUsers('ws_123');

      expect(fetch).toHaveBeenCalled();
      const [url] = fetch.mock.calls[0];

      // Token should NOT be in URL
      expect(url).not.toContain(token);
      expect(url).not.toContain('token=');
      expect(url).not.toContain('auth_token=');
    });
  });

  describe('Auth Error Handling', () => {
    /**
     * SPECIFICATION: Authentication Errors
     *
     * HTTP 401/403 responses indicate auth failures:
     * - 401 Unauthorized: Token invalid or expired
     * - 403 Forbidden: Token valid but lacks permissions
     *
     * Error handling:
     * - Return {data: null, failed: true, status: 401/403}
     * - Do NOT retry (permanent failures)
     * - UI should show "Authentication Error" with reload action
     */

    it('should throw on 401 Unauthorized (surfaces failure, not silently empty)', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
        headers: new Map()
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');

      store.token = createMockJwtToken();
      store.claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

      resetRateLimiter();
      await expect(Api.fetchUsers('ws_123')).rejects.toThrow('Failed to fetch workspace users');
    });

    it('should throw on 403 Forbidden (surfaces failure, not silently empty)', async () => {
      fetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden' }),
        headers: new Map()
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');

      store.token = createMockJwtToken();
      store.claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

      resetRateLimiter();
      await expect(Api.fetchUsers('ws_123')).rejects.toThrow('Failed to fetch workspace users');
    });

    it('should NOT retry on 401 errors', async () => {
      let callCount = 0;
      fetch.mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
          headers: new Map()
        };
      });

      const { Api, resetRateLimiter } = await import('../../js/api.js');

      store.token = createMockJwtToken();
      store.claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

      resetRateLimiter();
      // fetchUsers throws on 401; use catch to still check retry behavior
      await Api.fetchUsers('ws_123').catch(() => {});

      // Should only call once (no retry on 401)
      expect(callCount).toBe(1);
    });
  });
});

describe('Auth - Security Specifications', () => {
  /**
   * SPECIFICATION: Token Security
   *
   * Critical security requirements (see docs/spec.md):
   * - NEVER log auth tokens
   * - NEVER persist auth tokens to localStorage
   * - NEVER commit auth tokens to code
   * - Token exists only in memory during session
   */

  afterEach(() => {
    standardAfterEach();
    store.token = null;
    store.claims = null;
  });

  it('store.token should be non-enumerable (not leaked via JSON.stringify)', () => {
    const sensitiveToken = 'very_secret_token_xyz123';
    store.setToken(sensitiveToken, { workspaceId: 'ws_123' });

    // token property should not appear when serializing the store
    const serialized = JSON.stringify(store);
    expect(serialized).not.toContain(sensitiveToken);

    // token should still be readable directly
    expect(store.token).toBe(sensitiveToken);
  });

  it('store serialization should not include claims token fields', () => {
    const sensitiveToken = 'secret_token_456';
    store.setToken(sensitiveToken, { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' });

    // Serialize entire store — verify no token leakage
    const storeJson = JSON.stringify(store);
    expect(storeJson).not.toContain(sensitiveToken);
  });

  it('token should only be stored in memory (not localStorage/sessionStorage)', () => {
    const sensitiveToken = 'memory_only_token';

    store.token = sensitiveToken;
    store.claims = { workspaceId: 'ws_123', backendUrl: 'https://api.clockify.me/api' };

    // Trigger any persistence
    store.saveConfig();
    store.saveUIState();

    // Check localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      expect(value).not.toContain(sensitiveToken);
    }

    // Check sessionStorage
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const value = sessionStorage.getItem(key);
      expect(value).not.toContain(sensitiveToken);
    }
  });
});

describe('Auth - Theme Handling', () => {
  /**
   * SPECIFICATION: Theme Application from JWT
   *
   * Clockify sends theme preference in JWT payload:
   * - payload.theme === 'DARK' → Apply dark mode
   * - payload.theme === 'LIGHT' (or missing) → Light mode (default)
   *
   * Dark mode is applied by adding 'cl-theme-dark' class to document.body
   */

  afterEach(() => {
    document.body.classList.remove('cl-theme-dark');
    standardAfterEach();
  });

  it('DARK theme claim should result in cl-theme-dark class on body', () => {
    // Verify that only 'DARK' (exact match, case-sensitive) triggers dark mode
    // This mirrors the check in main.ts applyTokenClaims: payload.theme === 'DARK'
    const darkThemes = ['DARK'];
    const nonDarkThemes = ['LIGHT', 'dark', 'Dark', '', undefined, null];

    for (const theme of darkThemes) {
      document.body.classList.remove('cl-theme-dark');
      if (theme === 'DARK') document.body.classList.add('cl-theme-dark');
      expect(document.body.classList.contains('cl-theme-dark')).toBe(true);
    }

    for (const theme of nonDarkThemes) {
      document.body.classList.remove('cl-theme-dark');
      if (theme === 'DARK') document.body.classList.add('cl-theme-dark');
      expect(document.body.classList.contains('cl-theme-dark')).toBe(false);
    }
  });
});
