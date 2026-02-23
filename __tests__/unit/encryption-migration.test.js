/**
 * @jest-environment node
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { store, resetFallbackStorage } from '../../js/state.js';
import { STORAGE_KEYS } from '../../js/constants.js';
import { deriveEncryptionKey, deriveLegacyEncryptionKey, encryptData, retrieveEncrypted } from '../../js/crypto.js';
import { standardAfterEach } from '../helpers/setup.js';

class StoragePolyfill {
  constructor() { this._data = {}; }
  getItem(key) { return this._data[key] || null; }
  setItem(key, value) { this._data[key] = String(value); }
  removeItem(key) { delete this._data[key]; }
  clear() { this._data = {}; }
  get length() { return Object.keys(this._data).length; }
  key(index) { return Object.keys(this._data)[index] || null; }
}

describe('Encryption Migration', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true
    });
    Object.defineProperty(globalThis, 'TextEncoder', {
      value: TextEncoder,
      configurable: true
    });
    Object.defineProperty(globalThis, 'TextDecoder', {
      value: TextDecoder,
      configurable: true
    });
    Object.defineProperty(globalThis, 'btoa', {
      value: (str) => Buffer.from(str, 'binary').toString('base64'),
      configurable: true
    });
    Object.defineProperty(globalThis, 'atob', {
      value: (str) => Buffer.from(str, 'base64').toString('binary'),
      configurable: true
    });

    global.localStorage = new StoragePolyfill();
    global.sessionStorage = new StoragePolyfill();

    resetFallbackStorage();

    store.overrides = {};
    store.config.encryptStorage = true;
    store.claims = null;
    store.token = null;
  });

  afterEach(() => {
    standardAfterEach();
    store.token = null;
    store.claims = null;
  });

  it('migrates legacy PBKDF2-encrypted overrides to the new key', async () => {
    const workspaceId = 'ws_legacy_migrate';
    const overrideKey = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

    store.claims = { workspaceId };

    const legacyKey = await deriveLegacyEncryptionKey(workspaceId);
    const legacyOverrides = {
      user1: {
        mode: 'global',
        capacity: 6,
        multiplier: 1.5
      }
    };

    const legacyEncrypted = await encryptData(JSON.stringify(legacyOverrides), legacyKey);
    localStorage.setItem(overrideKey, JSON.stringify(legacyEncrypted));

    const legacyBefore = await retrieveEncrypted(overrideKey, legacyKey);
    expect(legacyBefore).toBe(JSON.stringify(legacyOverrides));

    await store.initEncryption();
    await store.loadOverridesEncrypted();

    expect(store.overrides).toEqual(legacyOverrides);

    const stored = localStorage.getItem(overrideKey);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored);
    expect(parsed).toHaveProperty('ct');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('v');

    const legacyAfter = await retrieveEncrypted(overrideKey, legacyKey);
    expect(legacyAfter).toBeNull();
  });

  it('falls back to defaults when encrypted overrides are tampered', async () => {
    const workspaceId = 'ws_tamper';
    const overrideKey = `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`;

    store.claims = { workspaceId };

    const key = await deriveEncryptionKey(workspaceId);
    const overrides = {
      user1: {
        mode: 'global',
        capacity: 6,
        multiplier: 1.5
      }
    };

    const encrypted = await encryptData(JSON.stringify(overrides), key);
    const tampered = { ...encrypted, ct: `x${encrypted.ct.slice(1)}` };
    localStorage.setItem(overrideKey, JSON.stringify(tampered));

    const retrieved = await retrieveEncrypted(overrideKey, key);
    expect(retrieved).toBeNull();

    await store.initEncryption();
    await store.loadOverridesEncrypted();

    expect(store.overrides).toEqual({});
  });
});
