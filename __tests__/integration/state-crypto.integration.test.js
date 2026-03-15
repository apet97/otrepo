/**
 * @jest-environment node
 *
 * Integration test: state ↔ crypto encrypted overrides roundtrip.
 * Verifies: write overrides → encrypt → persist → load → decrypt → values match.
 * Addresses: C11
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { StoragePolyfill } from '../helpers/storage-polyfill.js';

// Setup global crypto + encoding APIs for Node environment
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'btoa', {
  value: (str) => Buffer.from(str, 'binary').toString('base64'),
  configurable: true,
});
Object.defineProperty(globalThis, 'atob', {
  value: (str) => Buffer.from(str, 'base64').toString('binary'),
  configurable: true,
});

// Provide localStorage + sessionStorage + window.dispatchEvent for state.ts
const storage = new StoragePolyfill();
global.localStorage = storage;
global.sessionStorage = new StoragePolyfill();
if (typeof globalThis.window === 'undefined') {
  globalThis.window = /** @type {any} */ ({
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

describe('integration: state ↔ crypto encrypted overrides roundtrip', () => {
  /** @type {import('../../js/state.js').Store} */
  let store;

  const WORKSPACE_ID = 'ws_integration_test_001';
  const OVERRIDE_KEY = `overtime_overrides_${WORKSPACE_ID}`;
  const CLAIMS = {
    workspaceId: WORKSPACE_ID,
    userId: 'user_test',
    backendUrl: 'https://api.clockify.me',
  };

  beforeEach(async () => {
    storage.clear();
    global.sessionStorage.clear();
    // Dynamic import to get store (singleton)
    const stateModule = await import('../../js/state.js');
    store = stateModule.store;
    // Reset store state
    store.token = null;
    store.claims = null;
    store.overrides = {};
    store.diagnostics = {
      sentryInitFailed: false,
      workerPoolInitFailed: false,
      workerPoolTerminated: false,
      workerTaskFailures: 0,
    };
    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: false,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'none',
      overtimeBasis: 'daily',
      maxPages: 10,
      encryptStorage: true,
      auditConsent: true,
    };
  });

  afterEach(() => {
    storage.clear();
    global.sessionStorage.clear();
  });

  it('should roundtrip simple overrides through encryption', async () => {
    // 1. Set token/claims so workspace key works
    store.claims = CLAIMS;

    // 2. Initialize encryption (derives AES-GCM key)
    await store.initEncryption();
    const status = store.getEncryptionStatus();
    expect(status.enabled).toBe(true);
    expect(status.keyReady).toBe(true);

    // 3. Write overrides
    store.overrides = {
      user1: { mode: 'global', capacity: 7, multiplier: 1.5 },
      user2: { mode: 'global', capacity: 8, multiplier: 2.0 },
    };

    // 4. Save (triggers async encryption)
    store.saveOverrides();
    await store.ensureEncryptionComplete();

    // 5. Verify localStorage contains encrypted payload (not plaintext)
    const raw = storage.getItem(OVERRIDE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('ct');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('v', 1);
    // Encrypted data should NOT contain plaintext override keys
    expect(raw).not.toContain('"user1"');
    expect(raw).not.toContain('"capacity"');

    // 6. Clear in-memory overrides and reload from encrypted storage
    store.overrides = {};
    await store.loadOverridesEncrypted();

    // 7. Verify values match original
    expect(store.overrides.user1).toEqual(
      expect.objectContaining({ mode: 'global', capacity: 7, multiplier: 1.5 })
    );
    expect(store.overrides.user2).toEqual(
      expect.objectContaining({ mode: 'global', capacity: 8, multiplier: 2.0 })
    );
  });

  it('should roundtrip complex overrides (perDay, weekly modes)', async () => {
    store.claims = CLAIMS;
    await store.initEncryption();

    // Write complex override structure
    store.overrides = {
      userA: {
        mode: 'perDay',
        capacity: 8,
        multiplier: 1.5,
        perDayOverrides: {
          '2025-01-15': { capacity: 6 },
          '2025-01-16': { capacity: 10, multiplier: 2.0 },
        },
      },
      userB: {
        mode: 'weekly',
        capacity: 8,
        multiplier: 1.5,
        weeklyOverrides: {
          MONDAY: { capacity: 6 },
          FRIDAY: { capacity: 4 },
        },
      },
    };

    store.saveOverrides();
    await store.ensureEncryptionComplete();

    // Reload
    store.overrides = {};
    await store.loadOverridesEncrypted();

    expect(store.overrides.userA.mode).toBe('perDay');
    expect(store.overrides.userA.perDayOverrides['2025-01-15'].capacity).toBe(6);
    expect(store.overrides.userA.perDayOverrides['2025-01-16'].multiplier).toBe(2.0);
    expect(store.overrides.userB.mode).toBe('weekly');
    expect(store.overrides.userB.weeklyOverrides.MONDAY.capacity).toBe(6);
    expect(store.overrides.userB.weeklyOverrides.FRIDAY.capacity).toBe(4);
  });

  it('should handle empty overrides roundtrip', async () => {
    store.claims = CLAIMS;
    await store.initEncryption();

    store.overrides = {};
    store.saveOverrides();
    await store.ensureEncryptionComplete();

    store.overrides = { stale: { mode: 'global', capacity: 99 } };
    await store.loadOverridesEncrypted();

    expect(store.overrides).toEqual({});
  });

  it('should migrate mode field on load if missing', async () => {
    store.claims = CLAIMS;
    await store.initEncryption();

    // Write overrides without mode field (legacy format)
    store.overrides = {
      legacyUser: { capacity: 6, multiplier: 1.25 },
    };
    store.saveOverrides();
    await store.ensureEncryptionComplete();

    store.overrides = {};
    await store.loadOverridesEncrypted();

    // _migrateOverrideFormat should add mode: 'global'
    expect(store.overrides.legacyUser.mode).toBe('global');
    expect(store.overrides.legacyUser.capacity).toBe(6);
    expect(store.overrides.legacyUser.multiplier).toBe(1.25);
  });

  it('should fall back to plaintext when encryption is disabled', async () => {
    store.claims = CLAIMS;
    store.config.encryptStorage = false;

    // Save plaintext
    store.overrides = {
      user1: { mode: 'global', capacity: 7 },
    };
    store.saveOverrides();

    // Verify plaintext in localStorage
    const raw = storage.getItem(OVERRIDE_KEY);
    const parsed = JSON.parse(raw);
    expect(parsed.user1.capacity).toBe(7);
    expect(parsed).not.toHaveProperty('ct');

    // Reload
    store.overrides = {};
    await store.loadOverridesEncrypted();
    expect(store.overrides.user1.capacity).toBe(7);
  });

  it('should save plaintext when encryption is disabled', async () => {
    store.claims = CLAIMS;
    store.config.encryptStorage = false;

    store.overrides = { user1: { mode: 'global', capacity: 5 } };
    store.saveOverrides();

    // Should be stored as plaintext JSON (not encrypted)
    const raw = storage.getItem(OVERRIDE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed).not.toHaveProperty('ct');
    expect(parsed.user1.capacity).toBe(5);
  });

  it('should produce different ciphertexts for identical data (unique IVs)', async () => {
    store.claims = CLAIMS;
    await store.initEncryption();

    store.overrides = { user1: { mode: 'global', capacity: 8 } };
    store.saveOverrides();
    await store.ensureEncryptionComplete();
    const raw1 = storage.getItem(OVERRIDE_KEY);

    // Save again (same data)
    store.saveOverrides();
    await store.ensureEncryptionComplete();
    const raw2 = storage.getItem(OVERRIDE_KEY);

    const enc1 = JSON.parse(raw1);
    const enc2 = JSON.parse(raw2);

    // IVs and ciphertexts should differ (random IV each time)
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ct).not.toBe(enc2.ct);
  });

  it('should isolate overrides between workspaces', async () => {
    const WORKSPACE_2 = 'ws_integration_test_002';
    const KEY_2 = `overtime_overrides_${WORKSPACE_2}`;

    // Workspace 1
    store.claims = CLAIMS;
    await store.initEncryption();
    store.overrides = { user1: { mode: 'global', capacity: 7 } };
    store.saveOverrides();
    await store.ensureEncryptionComplete();

    // Switch to workspace 2
    store.claims = { ...CLAIMS, workspaceId: WORKSPACE_2 };
    await store.initEncryption();
    store.overrides = { user1: { mode: 'global', capacity: 10 } };
    store.saveOverrides();
    await store.ensureEncryptionComplete();

    // Verify separate keys in localStorage
    expect(storage.getItem(OVERRIDE_KEY)).not.toBeNull();
    expect(storage.getItem(KEY_2)).not.toBeNull();
    expect(storage.getItem(OVERRIDE_KEY)).not.toBe(storage.getItem(KEY_2));

    // Reload workspace 1 and verify isolation
    store.claims = CLAIMS;
    await store.initEncryption();
    store.overrides = {};
    await store.loadOverridesEncrypted();
    expect(store.overrides.user1.capacity).toBe(7);

    // Reload workspace 2 and verify isolation
    store.claims = { ...CLAIMS, workspaceId: WORKSPACE_2 };
    await store.initEncryption();
    store.overrides = {};
    await store.loadOverridesEncrypted();
    expect(store.overrides.user1.capacity).toBe(10);
  });

  it('should report encryption status after init', async () => {
    store.claims = CLAIMS;
    await store.initEncryption();

    const status = store.getEncryptionStatus();
    expect(status.enabled).toBe(true);
    expect(status.keyReady).toBe(true);
    expect(status.supported).toBe(true);
    expect(status.pending).toBe(false);
  });

  it('should report encryption disabled when config says so', async () => {
    store.claims = CLAIMS;
    store.config.encryptStorage = false;

    const status = store.getEncryptionStatus();
    expect(status.enabled).toBe(false);
  });
});
