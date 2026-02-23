/**
 * @jest-environment jsdom
 */

import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';

// Provide Web Crypto API for encryption in jsdom
global.crypto = webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Provide base64 helpers for JWT decode
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Mock fetch globally
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({})
  })
);

// Mock UI module
jest.unstable_mockModule('../../js/ui/index.js', () => ({
  initializeElements: jest.fn(() => ({})),
  renderLoading: jest.fn(),
  renderOverridesPage: jest.fn(),
  bindEvents: jest.fn(),
  showError: jest.fn(),
  renderSummaryStrip: jest.fn(),
  renderSummaryTable: jest.fn(),
  renderDetailedTable: jest.fn(),
  renderApiStatus: jest.fn()
}));

// Mock API module
const mockApi = {
  fetchUsers: jest.fn(() => Promise.resolve([{ id: 'user1', name: 'User 1' }])),
  fetchEntries: jest.fn(() => Promise.resolve([])),
  fetchAllProfiles: jest.fn(() => Promise.resolve(new Map())),
  fetchAllHolidays: jest.fn(() => Promise.resolve(new Map())),
  fetchAllTimeOff: jest.fn(() => Promise.resolve(new Map()))
};

jest.unstable_mockModule('../../js/api.js', () => ({
  Api: mockApi,
  resetRateLimiter: jest.fn(),
  getCircuitBreakerState: jest.fn(() => ({ status: 'closed' }))
}));

jest.unstable_mockModule('../../js/export.js', () => ({
  downloadCsv: jest.fn()
}));

let store;
let init;

describe('main.js - Encryption initialization', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    try {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    } catch {
      global.crypto = global.crypto || webcrypto;
    }
    if (global.crypto && !global.crypto.subtle) {
      global.crypto.subtle = webcrypto.subtle;
    }
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
    localStorage.clear();
    document.body.innerHTML = '<div id="emptyState" class="hidden"></div>';

    const stateModule = await import('../../js/state.js');
    store = stateModule.store;
    const mainModule = await import('../../js/main.js');
    init = mainModule.init;

    store.token = null;
    store.claims = null;
    store.overrides = {};
    store.encryptionKey = null;
    store.config.encryptStorage = true;
  });

  it('awaits encryption initialization before allowing encrypted writes', async () => {
    expect(global.crypto && global.crypto.subtle).toBeDefined();

    const base64url = (value) =>
      Buffer.from(JSON.stringify(value))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const payload = { workspaceId: 'ws_123', userId: 'user_1', backendUrl: 'https://api.clockify.me/api' };
    const token = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.sig`;
    window.history.replaceState({}, '', `?auth_token=${token}`);

    await init();

    store.overrides = { user_1: { capacity: 6, mode: 'global' } };
    store.saveOverrides();
    if (store._pendingEncryption) {
      await store._pendingEncryption;
    }

    const stored = localStorage.getItem(`overtime_overrides_${payload.workspaceId}`);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored);
    expect(parsed).toHaveProperty('ct');
    expect(parsed).toHaveProperty('iv');
    expect(parsed.v).toBe(1);
  });
});
