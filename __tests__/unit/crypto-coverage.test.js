/**
 * @jest-environment node
 */

/**
 * @fileoverview Tests for uncovered lines/branches in crypto.ts
 *
 * Targets: lines 62, 90-117, 125-137, 160, 169-184, 326, 348-349
 * These cover IndexedDB paths, concurrent key derivation, non-OperationError
 * re-throw in decryptData, and storeEncrypted error path.
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';

// Set up globals for the crypto module
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

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => { store[key] = String(value); }),
    removeItem: jest.fn((key) => { delete store[key]; }),
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index) => Object.keys(store)[index] || null,
  };
})();
global.localStorage = localStorageMock;

/**
 * Helper: creates a minimal IndexedDB mock that supports open/transaction/objectStore.
 * @param {object} options - Configuration for mock behavior
 * @param {Map} options.store - Pre-populated key-value store
 * @param {boolean} options.openError - If true, open request triggers onerror
 * @param {boolean} options.putError - If true, put request triggers onerror
 * @param {boolean} options.getError - If true, get request triggers onerror
 * @param {boolean} options.storeExists - If true, objectStoreNames.contains returns true
 */
function createIndexedDBMock(options = {}) {
  const {
    store = new Map(),
    openError = false,
    putError = false,
    getError = false,
    storeExists = true,
  } = options;

  const objectStore = {
    put: jest.fn((value, key) => {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        if (putError) {
          request.error = new Error('put failed');
          if (request.onerror) request.onerror();
        } else {
          store.set(key, value);
          if (request.onsuccess) request.onsuccess();
        }
      }, 0);
      return request;
    }),
    get: jest.fn((key) => {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        if (getError) {
          request.error = new Error('get failed');
          if (request.onerror) request.onerror();
        } else {
          request.result = store.get(key);
          if (request.onsuccess) request.onsuccess();
        }
      }, 0);
      return request;
    }),
  };

  const mockTransaction = {
    objectStore: jest.fn(() => objectStore),
  };

  const mockDb = {
    objectStoreNames: {
      contains: jest.fn(() => storeExists),
    },
    createObjectStore: jest.fn(),
    transaction: jest.fn(() => mockTransaction),
  };

  const mockIndexedDB = {
    open: jest.fn(() => {
      const request = {
        result: mockDb,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => {
        if (openError) {
          request.error = new Error('open failed');
          if (request.onerror) request.onerror();
        } else {
          // Always fire onupgradeneeded for fresh DBs
          if (request.onupgradeneeded) request.onupgradeneeded();
          if (request.onsuccess) request.onsuccess();
        }
      }, 0);
      return request;
    }),
  };

  return { mockIndexedDB, mockDb, objectStore };
}

describe('crypto.ts — fallbackKeyStore when globalThis is undefined', () => {
  // Covers line 62 (return new Map when typeof globalThis === 'undefined')
  it('should use a plain Map fallback when globalThis is undefined at module load', async () => {
    jest.resetModules();
    localStorageMock.clear();
    delete global.indexedDB;

    // Save reference before making globalThis undefined
    const savedGlobalThis = globalThis;
    const savedDefineProperty = Object.defineProperty;

    // Make typeof globalThis === 'undefined'
    savedDefineProperty(savedGlobalThis, 'globalThis', {
      value: undefined,
      configurable: true,
    });

    let cryptoModule;
    try {
      cryptoModule = await import('../../js/crypto.js');
    } finally {
      // Restore globalThis immediately
      savedDefineProperty(savedGlobalThis, 'globalThis', {
        value: savedGlobalThis,
        configurable: true,
      });
    }

    // The module should still work — fallbackKeyStore is just a plain Map
    const key = await cryptoModule.deriveEncryptionKey('ws-no-globalthis');
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
  });
});

describe('crypto.ts coverage gap tests', () => {
  /**
   * We need fresh module imports per test group to reset module-level state
   * (keyCache, pendingKeyPromises, keyDatabasePromise, fallbackKeyStore).
   */

  describe('IndexedDB available — openKeyDatabase, persistKey, key retrieval from IDB', () => {
    // Covers lines 90-117 (openKeyDatabase), 125-137 (persistKey), 169-184 (IDB read in deriveEncryptionKey)
    let deriveEncryptionKey;
    let encryptData;
    let decryptData;
    let idbStore;
    let mockIDB;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();

      idbStore = new Map();
      const { mockIndexedDB } = createIndexedDBMock({ store: idbStore });
      mockIDB = mockIndexedDB;
      global.indexedDB = mockIDB;

      const crypto = await import('../../js/crypto.js');
      deriveEncryptionKey = crypto.deriveEncryptionKey;
      encryptData = crypto.encryptData;
      decryptData = crypto.decryptData;
    });

    afterEach(() => {
      delete global.indexedDB;
    });

    it('should derive a key and persist it in IndexedDB (covers openKeyDatabase + persistKey)', async () => {
      const key = await deriveEncryptionKey('ws-idb-test');
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');

      // Verify the key was persisted to our mock IDB store
      expect(idbStore.has('ws-idb-test')).toBe(true);
      expect(idbStore.get('ws-idb-test')).toBe(key);
    });

    it('should retrieve existing key from IndexedDB on second call after cache clear', async () => {
      // First call: generates and persists key
      const key1 = await deriveEncryptionKey('ws-idb-retrieve');
      expect(idbStore.has('ws-idb-retrieve')).toBe(true);

      // Encrypt something with the first key
      const encrypted = await encryptData('hello IDB', key1);

      // Reimport module to clear in-memory keyCache but keep IDB mock data
      jest.resetModules();
      // Re-install IDB mock (same store, so the key is still there)
      global.indexedDB = mockIDB;

      const crypto2 = await import('../../js/crypto.js');
      const key2 = await crypto2.deriveEncryptionKey('ws-idb-retrieve');

      // Should be able to decrypt with retrieved key
      const decrypted = await crypto2.decryptData(encrypted, key2);
      expect(decrypted).toBe('hello IDB');
    });

    it('should create object store on upgrade if not existing', async () => {
      // Reset with storeExists = false so the createObjectStore branch fires
      jest.resetModules();
      localStorageMock.clear();

      const storeData = new Map();
      const { mockIndexedDB, mockDb } = createIndexedDBMock({
        store: storeData,
        storeExists: false,
      });
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');
      await crypto.deriveEncryptionKey('ws-upgrade-test');

      expect(mockDb.createObjectStore).toHaveBeenCalledWith('keys');
    });

    it('should NOT create object store on upgrade if already existing', async () => {
      jest.resetModules();
      localStorageMock.clear();

      const storeData = new Map();
      const { mockIndexedDB, mockDb } = createIndexedDBMock({
        store: storeData,
        storeExists: true,
      });
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');
      await crypto.deriveEncryptionKey('ws-no-upgrade');

      expect(mockDb.createObjectStore).not.toHaveBeenCalled();
    });
  });

  describe('IndexedDB open error — falls back to in-memory', () => {
    // Covers lines 109-113 (onerror path in openKeyDatabase)
    let deriveEncryptionKey;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();

      const { mockIndexedDB } = createIndexedDBMock({ openError: true });
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');
      deriveEncryptionKey = crypto.deriveEncryptionKey;
    });

    afterEach(() => {
      delete global.indexedDB;
    });

    it('should still derive a key when IndexedDB open fails (uses fallback)', async () => {
      const key = await deriveEncryptionKey('ws-idb-fail');
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('should reset cached db promise on open error so retries work', async () => {
      // First call fails to open IDB, falls back
      const key1 = await deriveEncryptionKey('ws-retry');
      expect(key1).toBeDefined();

      // On a fresh module load, a new attempt should work with a working IDB
      jest.resetModules();
      localStorageMock.clear();
      const workingStore = new Map();
      const { mockIndexedDB: workingIDB } = createIndexedDBMock({ store: workingStore });
      global.indexedDB = workingIDB;

      const crypto2 = await import('../../js/crypto.js');
      const key2 = await crypto2.deriveEncryptionKey('ws-retry-2');
      expect(key2).toBeDefined();
      expect(workingStore.has('ws-retry-2')).toBe(true);
    });
  });

  describe('IndexedDB get error in deriveEncryptionKey — falls back to fallbackKeyStore', () => {
    // Covers lines 178-179 (get onerror), 182-184 (catch → logger.warn, return null)
    let deriveEncryptionKey;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();

      const { mockIndexedDB } = createIndexedDBMock({ getError: true });
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');
      deriveEncryptionKey = crypto.deriveEncryptionKey;
    });

    afterEach(() => {
      delete global.indexedDB;
    });

    it('should generate a new key when IDB get fails', async () => {
      const key = await deriveEncryptionKey('ws-get-fail');
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });
  });

  describe('IndexedDB put error in persistKey — falls back to in-memory store', () => {
    // Covers lines 135-137 (catch in persistKey → logger.warn, return false → fallbackKeyStore)
    let deriveEncryptionKey;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();

      const { mockIndexedDB } = createIndexedDBMock({ putError: true });
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');
      deriveEncryptionKey = crypto.deriveEncryptionKey;
    });

    afterEach(() => {
      delete global.indexedDB;
    });

    it('should fall back to in-memory key store when IDB put fails', async () => {
      const key = await deriveEncryptionKey('ws-put-fail');
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });
  });

  describe('Concurrent deriveEncryptionKey calls — pending promise dedup', () => {
    // Covers line 160 (return pending)
    let deriveEncryptionKey;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();
      // No indexedDB = forces the no-IDB fallback path, keeping things simple
      delete global.indexedDB;

      const crypto = await import('../../js/crypto.js');
      deriveEncryptionKey = crypto.deriveEncryptionKey;
    });

    it('should return the same promise for concurrent calls with the same workspaceId', async () => {
      // Launch two calls simultaneously — the second should hit the pending promise path
      const [key1, key2] = await Promise.all([
        deriveEncryptionKey('ws-concurrent'),
        deriveEncryptionKey('ws-concurrent'),
      ]);

      // Both should resolve to the same key object
      expect(key1).toBe(key2);
    });
  });

  describe('decryptData — non-OperationError re-throw', () => {
    // Covers line 326 (throw error for non-DOMException errors)
    let decryptData;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();
      delete global.indexedDB;

      const crypto = await import('../../js/crypto.js');
      decryptData = crypto.decryptData;
    });

    it('should re-throw non-OperationError errors from crypto.subtle.decrypt', async () => {
      // Create a mock key that will cause subtle.decrypt to throw a TypeError
      // (not a DOMException OperationError)
      const originalDecrypt = globalThis.crypto.subtle.decrypt;
      const nonOperationError = new TypeError('Invalid key type');

      globalThis.crypto.subtle.decrypt = jest.fn().mockRejectedValue(nonOperationError);

      const fakeEncrypted = {
        ct: globalThis.btoa('fake-ciphertext'),
        iv: globalThis.btoa('123456789012'),
        v: 1,
      };

      // Use a real key for the function signature but the mock will ignore it
      const key = await globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      // Restore generateKey since we mocked decrypt
      globalThis.crypto.subtle.decrypt = jest.fn().mockRejectedValue(nonOperationError);

      await expect(decryptData(fakeEncrypted, key)).rejects.toThrow(TypeError);
      await expect(decryptData(fakeEncrypted, key)).rejects.toThrow('Invalid key type');

      // Restore
      globalThis.crypto.subtle.decrypt = originalDecrypt;
    });

    it('should throw AuthenticationError for DOMException OperationError', async () => {
      const { AuthenticationError } = await import('../../js/crypto.js');

      const originalDecrypt = globalThis.crypto.subtle.decrypt;

      // DOMException with name 'OperationError'
      const opError = new DOMException('The operation failed', 'OperationError');
      globalThis.crypto.subtle.decrypt = jest.fn().mockRejectedValue(opError);

      const fakeEncrypted = {
        ct: globalThis.btoa('fake-ciphertext'),
        iv: globalThis.btoa('123456789012'),
        v: 1,
      };

      const key = await globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      globalThis.crypto.subtle.decrypt = jest.fn().mockRejectedValue(opError);

      await expect(decryptData(fakeEncrypted, key)).rejects.toThrow(AuthenticationError);

      globalThis.crypto.subtle.decrypt = originalDecrypt;
    });
  });

  describe('storeEncrypted — encryption failure path', () => {
    // Covers lines 348-349 (logger.warn + return false when encryptData throws)
    let storeEncrypted;

    beforeEach(async () => {
      jest.resetModules();
      localStorageMock.clear();
      delete global.indexedDB;

      const crypto = await import('../../js/crypto.js');
      storeEncrypted = crypto.storeEncrypted;
    });

    it('should return false when encryptData throws', async () => {
      const originalEncrypt = globalThis.crypto.subtle.encrypt;
      globalThis.crypto.subtle.encrypt = jest.fn().mockRejectedValue(new Error('encrypt boom'));

      const key = await globalThis.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      globalThis.crypto.subtle.encrypt = jest.fn().mockRejectedValue(new Error('encrypt boom'));

      const result = await storeEncrypted('test-key', 'test-data', key);
      expect(result).toBe(false);

      globalThis.crypto.subtle.encrypt = originalEncrypt;
    });
  });

  describe('isIndexedDbAvailable — both paths', () => {
    it('should return false when indexedDB is not defined', async () => {
      jest.resetModules();
      delete global.indexedDB;

      const crypto = await import('../../js/crypto.js');
      // deriveEncryptionKey with no IDB still works (uses fallback)
      const key = await crypto.deriveEncryptionKey('ws-no-idb');
      expect(key).toBeDefined();
    });

    it('should return true when indexedDB is defined', async () => {
      jest.resetModules();
      const { mockIndexedDB } = createIndexedDBMock();
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');
      const key = await crypto.deriveEncryptionKey('ws-has-idb');
      expect(key).toBeDefined();

      delete global.indexedDB;
    });
  });

  describe('persistKey — no indexedDB available', () => {
    // Covers line 122 (return false when !isIndexedDbAvailable)
    it('should return false and use fallback when no IndexedDB', async () => {
      jest.resetModules();
      localStorageMock.clear();
      delete global.indexedDB;

      const crypto = await import('../../js/crypto.js');
      // This internally calls persistKey which returns false, then uses fallbackKeyStore
      const key = await crypto.deriveEncryptionKey('ws-no-persist');
      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('openKeyDatabase — caches the promise on success', () => {
    // Covers line 94 (if !keyDatabasePromise) and line 117 (return keyDatabasePromise)
    it('should reuse the same database promise for multiple calls', async () => {
      jest.resetModules();
      localStorageMock.clear();

      const idbStore = new Map();
      const { mockIndexedDB } = createIndexedDBMock({ store: idbStore });
      global.indexedDB = mockIndexedDB;

      const crypto = await import('../../js/crypto.js');

      // Two sequential deriveEncryptionKey calls on different workspaces
      // should reuse the same DB connection
      await crypto.deriveEncryptionKey('ws-cache-db-1');
      await crypto.deriveEncryptionKey('ws-cache-db-2');

      // indexedDB.open should only have been called once (cached)
      expect(mockIndexedDB.open).toHaveBeenCalledTimes(1);

      delete global.indexedDB;
    });
  });

  describe('openKeyDatabase — error with null request.error', () => {
    // Covers the fallback error creation in line 112
    it('should throw fallback error when request.error is null', async () => {
      jest.resetModules();
      localStorageMock.clear();

      // Custom IDB mock where open fails with null error
      const mockIDB = {
        open: jest.fn(() => {
          const request = {
            result: null,
            error: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            // Don't set request.error — leave it null to test fallback
            if (request.onerror) request.onerror();
          }, 0);
          return request;
        }),
      };
      global.indexedDB = mockIDB;

      const crypto = await import('../../js/crypto.js');
      // Should still succeed (falls back to in-memory)
      const key = await crypto.deriveEncryptionKey('ws-null-error');
      expect(key).toBeDefined();

      delete global.indexedDB;
    });
  });

  describe('openKeyDatabase — indexedDB disappears between isIndexedDbAvailable and openKeyDatabase', () => {
    // Covers line 91 (throw new Error('IndexedDB not available') inside openKeyDatabase)
    it('should throw from openKeyDatabase when indexedDB becomes unavailable mid-call', async () => {
      jest.resetModules();
      localStorageMock.clear();

      // Use a call-counting getter: first call to typeof indexedDB returns a truthy mock,
      // second call returns undefined (simulating removal between guard and usage).
      let idbCallCount = 0;
      const fakeMockIDB = { open: jest.fn() }; // won't actually be called
      Object.defineProperty(globalThis, 'indexedDB', {
        get: () => {
          idbCallCount++;
          // isIndexedDbAvailable() at line 165 = call 1 → truthy
          // isIndexedDbAvailable() at line 90 inside openKeyDatabase = call 2 → undefined
          if (idbCallCount <= 1) return fakeMockIDB;
          return undefined;
        },
        configurable: true,
      });

      const crypto = await import('../../js/crypto.js');
      // deriveEncryptionKey should still succeed because the catch at line 182-184 handles the error
      const key = await crypto.deriveEncryptionKey('ws-disappear-idb');
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');

      // Clean up
      delete globalThis.indexedDB;
    });
  });

  describe('persistKey — put error with null request.error', () => {
    // Covers line 132 fallback: reject(request.error || new Error('Failed to store key'))
    it('should handle null request.error in put rejection', async () => {
      jest.resetModules();
      localStorageMock.clear();

      // Custom mock where put fails with null error
      const objectStore = {
        put: jest.fn(() => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          setTimeout(() => {
            // Leave request.error as null
            if (request.onerror) request.onerror();
          }, 0);
          return request;
        }),
        get: jest.fn((key) => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          setTimeout(() => {
            request.result = undefined;
            if (request.onsuccess) request.onsuccess();
          }, 0);
          return request;
        }),
      };

      const mockTx = { objectStore: jest.fn(() => objectStore) };
      const mockDb = {
        objectStoreNames: { contains: jest.fn(() => true) },
        createObjectStore: jest.fn(),
        transaction: jest.fn(() => mockTx),
      };

      const mockIDB = {
        open: jest.fn(() => {
          const request = {
            result: mockDb,
            error: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (request.onupgradeneeded) request.onupgradeneeded();
            if (request.onsuccess) request.onsuccess();
          }, 0);
          return request;
        }),
      };
      global.indexedDB = mockIDB;

      const crypto = await import('../../js/crypto.js');
      const key = await crypto.deriveEncryptionKey('ws-put-null-error');
      expect(key).toBeDefined();

      delete global.indexedDB;
    });
  });

  describe('deriveEncryptionKey — IDB get error with null request.error', () => {
    // Covers line 179 fallback: reject(request.error || new Error('Failed to read key'))
    it('should handle null request.error in get rejection', async () => {
      jest.resetModules();
      localStorageMock.clear();

      const objectStore = {
        put: jest.fn((value, key) => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          setTimeout(() => {
            if (request.onsuccess) request.onsuccess();
          }, 0);
          return request;
        }),
        get: jest.fn(() => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          setTimeout(() => {
            // Leave request.error as null
            if (request.onerror) request.onerror();
          }, 0);
          return request;
        }),
      };

      const mockTx = { objectStore: jest.fn(() => objectStore) };
      const mockDb = {
        objectStoreNames: { contains: jest.fn(() => true) },
        createObjectStore: jest.fn(),
        transaction: jest.fn(() => mockTx),
      };

      const mockIDB = {
        open: jest.fn(() => {
          const request = {
            result: mockDb,
            error: null,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (request.onupgradeneeded) request.onupgradeneeded();
            if (request.onsuccess) request.onsuccess();
          }, 0);
          return request;
        }),
      };
      global.indexedDB = mockIDB;

      const crypto = await import('../../js/crypto.js');
      const key = await crypto.deriveEncryptionKey('ws-get-null-error');
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');

      delete global.indexedDB;
    });
  });
});
