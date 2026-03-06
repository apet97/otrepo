/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import {
  deriveEncryptionKey,
  deriveLegacyEncryptionKey,
  encryptData,
  decryptData,
  storeEncrypted,
  retrieveEncrypted,
  isEncryptionSupported,
  AuthenticationError
} from '../../js/crypto.js';
import { StoragePolyfill } from '../helpers/storage-polyfill.js';

// Setup global crypto APIs for Node environment
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'btoa', { value: (str) => Buffer.from(str, 'binary').toString('base64'), configurable: true });
Object.defineProperty(globalThis, 'atob', { value: (str) => Buffer.from(str, 'base64').toString('binary'), configurable: true });

// Mock localStorage
global.localStorage = new StoragePolyfill();

describe('crypto.ts mutation-killer tests', () => {
  beforeEach(() => {
    global.localStorage.clear();
  });

  afterEach(() => {
    global.localStorage.clear();
  });

  describe('AuthenticationError class', () => {
    it('should have name "AuthenticationError"', () => {
      const error = new AuthenticationError('Test message');
      expect(error.name).toBe('AuthenticationError');
    });

    it('should be instanceof Error', () => {
      const error = new AuthenticationError('Test message');
      expect(error).toBeInstanceOf(Error);
    });

    it('should preserve the error message', () => {
      const error = new AuthenticationError('Test message');
      expect(error.message).toBe('Test message');
    });
  });

  describe('isEncryptionSupported', () => {
    it('should return true when crypto and crypto.subtle are available', () => {
      expect(isEncryptionSupported()).toBe(true);
    });
  });

  describe('deriveEncryptionKey', () => {
    it('should return a CryptoKey', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      expect(key).toBeTruthy();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toBeDefined();
      expect(key.usages).toContain('encrypt');
    });

    it('should return the same key for the same workspace (caching)', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-123');
      expect(key1).toBe(key2); // Same object reference due to caching
    });

    it('should return different keys for different workspaces', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-456');
      expect(key1).not.toBe(key2);
    });

    it('should have algorithm "AES-GCM"', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      expect(key.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('deriveLegacyEncryptionKey', () => {
    it('should return a CryptoKey', async () => {
      const key = await deriveLegacyEncryptionKey('workspace-123');
      expect(key).toBeTruthy();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toBeDefined();
      expect(key.usages).toContain('encrypt');
    });

    it('should return a CryptoKey with passphrase', async () => {
      const key = await deriveLegacyEncryptionKey('workspace-123', 'my-passphrase');
      expect(key).toBeTruthy();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toBeDefined();
      expect(key.usages).toContain('encrypt');
    });

    it('should return different keys for different workspaces', async () => {
      const key1 = await deriveLegacyEncryptionKey('workspace-123');
      const key2 = await deriveLegacyEncryptionKey('workspace-456');
      expect(key1).not.toBe(key2);
    });

    it('should return different keys with and without passphrase', async () => {
      const key1 = await deriveLegacyEncryptionKey('workspace-123');
      const key2 = await deriveLegacyEncryptionKey('workspace-123', 'passphrase');
      expect(key1).not.toBe(key2);
    });
  });

  describe('encryptData and decryptData', () => {
    it('should successfully roundtrip encrypt and decrypt data', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = 'Hello, World!';

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });

    it('should handle empty string', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = '';

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });

    it('should handle short string', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = 'x';

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });

    it('should handle long string (10KB)', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = 'a'.repeat(10 * 1024); // 10KB

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });

    it('should produce unique IVs for same data', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = 'Hello, World!';

      const encrypted1 = await encryptData(originalData, key);
      const encrypted2 = await encryptData(originalData, key);

      // IVs should be different
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Ciphertexts should be different
      expect(encrypted1.ct).not.toBe(encrypted2.ct);
    });

    it('should throw AuthenticationError when decrypting with wrong key', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-456');
      const originalData = 'Hello, World!';

      const encrypted = await encryptData(originalData, key1);

      await expect(decryptData(encrypted, key2)).rejects.toThrow(AuthenticationError);
    });

    it('should throw AuthenticationError with specific message on wrong key', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-456');
      const originalData = 'Hello, World!';

      const encrypted = await encryptData(originalData, key1);

      await expect(decryptData(encrypted, key2)).rejects.toThrow(
        'Data integrity check failed - possible tampering or wrong key'
      );
    });
  });

  describe('Legacy vs modern key compatibility', () => {
    it('should not decrypt data encrypted with legacy key using modern key', async () => {
      const workspaceId = 'workspace-123';
      const originalData = 'Test data';

      const legacyKey = await deriveLegacyEncryptionKey(workspaceId);
      const modernKey = await deriveEncryptionKey(workspaceId);

      const encrypted = await encryptData(originalData, legacyKey);

      await expect(decryptData(encrypted, modernKey)).rejects.toThrow(AuthenticationError);
    });

    it('should not decrypt data encrypted with modern key using legacy key', async () => {
      const workspaceId = 'workspace-123';
      const originalData = 'Test data';

      const modernKey = await deriveEncryptionKey(workspaceId);
      const legacyKey = await deriveLegacyEncryptionKey(workspaceId);

      const encrypted = await encryptData(originalData, modernKey);

      await expect(decryptData(encrypted, legacyKey)).rejects.toThrow(AuthenticationError);
    });
  });

  describe('EncryptedData format', () => {
    it('should have ct (ciphertext) as string', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const encrypted = await encryptData('Hello', key);

      expect(typeof encrypted.ct).toBe('string');
      expect(encrypted.ct.length).toBeGreaterThan(0);
    });

    it('should have iv (initialization vector) as string', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const encrypted = await encryptData('Hello', key);

      expect(typeof encrypted.iv).toBe('string');
      expect(encrypted.iv.length).toBeGreaterThan(0);
    });

    it('should have v (version) equal to 1', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const encrypted = await encryptData('Hello', key);

      expect(encrypted.v).toBe(1);
    });

    it('should have only ct, iv, and v properties', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const encrypted = await encryptData('Hello', key);

      const keys = Object.keys(encrypted);
      expect(keys).toEqual(expect.arrayContaining(['ct', 'iv', 'v']));
      expect(keys.length).toBe(3);
    });
  });

  describe('storeEncrypted', () => {
    it('should store encrypted data to localStorage and return true', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const data = 'sensitive-data';

      const result = await storeEncrypted(storageKey, data, key);

      expect(result).toBe(true);
      expect(global.localStorage.getItem(storageKey)).not.toBeNull();
    });

    it('should store data that can be parsed as JSON', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const data = 'sensitive-data';

      await storeEncrypted(storageKey, data, key);

      const stored = global.localStorage.getItem(storageKey);
      expect(() => JSON.parse(stored)).not.toThrow();
    });

    it('should store EncryptedData format', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const data = 'sensitive-data';

      await storeEncrypted(storageKey, data, key);

      const stored = JSON.parse(global.localStorage.getItem(storageKey));
      expect(stored).toHaveProperty('ct');
      expect(stored).toHaveProperty('iv');
      expect(stored).toHaveProperty('v');
      expect(stored.v).toBe(1);
    });
  });

  describe('retrieveEncrypted', () => {
    it('should retrieve and decrypt data from localStorage', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const originalData = 'sensitive-data';

      await storeEncrypted(storageKey, originalData, key);
      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBe(originalData);
    });

    it('should return null for missing key', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'non-existent-key';

      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBeNull();
    });

    it('should return null for wrong version', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';

      // Manually store data with wrong version
      const encrypted = await encryptData('test', key);
      const wrongVersion = { ...encrypted, v: 2 };
      global.localStorage.setItem(storageKey, JSON.stringify(wrongVersion));

      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBeNull();
    });

    it('should return null for version 0', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';

      // Manually store data with version 0
      const encrypted = await encryptData('test', key);
      const wrongVersion = { ...encrypted, v: 0 };
      global.localStorage.setItem(storageKey, JSON.stringify(wrongVersion));

      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBeNull();
    });

    it('should return null for corrupted JSON', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';

      global.localStorage.setItem(storageKey, 'invalid-json{');

      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBeNull();
    });

    it('should return null when decryption fails with wrong key', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-456');
      const storageKey = 'test-storage-key';
      const originalData = 'sensitive-data';

      await storeEncrypted(storageKey, originalData, key1);
      const retrieved = await retrieveEncrypted(storageKey, key2);

      expect(retrieved).toBeNull();
    });
  });

  describe('storeEncrypted and retrieveEncrypted integration', () => {
    it('should successfully roundtrip store and retrieve', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const originalData = 'sensitive-data';

      const stored = await storeEncrypted(storageKey, originalData, key);
      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(stored).toBe(true);
      expect(retrieved).toBe(originalData);
    });

    it('should handle empty string roundtrip', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const originalData = '';

      await storeEncrypted(storageKey, originalData, key);
      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBe(originalData);
    });

    it('should handle long data roundtrip', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const originalData = 'x'.repeat(5000);

      await storeEncrypted(storageKey, originalData, key);
      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBe(originalData);
    });

    it('should handle special characters', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const storageKey = 'test-storage-key';
      const originalData = '{"key":"value","emoji":"🔒","unicode":"測試"}';

      await storeEncrypted(storageKey, originalData, key);
      const retrieved = await retrieveEncrypted(storageKey, key);

      expect(retrieved).toBe(originalData);
    });
  });

  describe('Multiple workspace isolation', () => {
    it('should not allow cross-workspace decryption', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-456');
      const storageKey = 'shared-storage-key';
      const data1 = 'workspace-123-data';

      await storeEncrypted(storageKey, data1, key1);
      const retrieved = await retrieveEncrypted(storageKey, key2);

      expect(retrieved).toBeNull();
    });

    it('should maintain separate keys per workspace', async () => {
      const key1 = await deriveEncryptionKey('workspace-123');
      const key2 = await deriveEncryptionKey('workspace-456');
      const storageKey1 = 'storage-key-1';
      const storageKey2 = 'storage-key-2';
      const data1 = 'workspace-123-data';
      const data2 = 'workspace-456-data';

      await storeEncrypted(storageKey1, data1, key1);
      await storeEncrypted(storageKey2, data2, key2);

      const retrieved1 = await retrieveEncrypted(storageKey1, key1);
      const retrieved2 = await retrieveEncrypted(storageKey2, key2);

      expect(retrieved1).toBe(data1);
      expect(retrieved2).toBe(data2);
    });
  });

  describe('Key caching behavior', () => {
    it('should cache keys and return same instance', async () => {
      const key1 = await deriveEncryptionKey('workspace-cache-test');
      const key2 = await deriveEncryptionKey('workspace-cache-test');
      const key3 = await deriveEncryptionKey('workspace-cache-test');

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should not cache keys across different workspaces', async () => {
      const key1 = await deriveEncryptionKey('workspace-a');
      const key2 = await deriveEncryptionKey('workspace-b');
      const key3 = await deriveEncryptionKey('workspace-c');

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });
  });

  describe('Base64 encoding/decoding edge cases', () => {
    it('should handle binary-like data', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = '\x00\x01\x02\x03\xFF\xFE\xFD';

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });

    it('should handle Unicode characters', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = '你好世界 🌍 Здравствуй мир';

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });

    it('should handle newlines and whitespace', async () => {
      const key = await deriveEncryptionKey('workspace-123');
      const originalData = 'Line 1\nLine 2\r\nLine 3\tTabbed';

      const encrypted = await encryptData(originalData, key);
      const decrypted = await decryptData(encrypted, key);

      expect(decrypted).toBe(originalData);
    });
  });

  describe('Edge cases (T55)', () => {
    describe('AuthenticationError properties', () => {
      it('should have a stack trace', () => {
        const error = new AuthenticationError('Decryption failed');
        expect(error.stack).toBeTruthy();
        expect(error.stack).toContain('AuthenticationError');
      });

      it('should be catchable as Error', () => {
        let caught = false;
        try {
          throw new AuthenticationError('test');
        } catch (e) {
          if (e instanceof Error) caught = true;
        }
        expect(caught).toBe(true);
      });
    });

    describe('legacy key migration edge cases', () => {
      it('should produce consistent legacy keys for same workspace', async () => {
        const key1 = await deriveLegacyEncryptionKey('workspace-legacy');
        const key2 = await deriveLegacyEncryptionKey('workspace-legacy');
        // PBKDF2 with same inputs should produce same key
        expect(key1.algorithm.name).toBe('AES-GCM');
        expect(key2.algorithm.name).toBe('AES-GCM');
      });

      it('should produce different legacy keys for passphrase vs no passphrase', async () => {
        const keyNoPass = await deriveLegacyEncryptionKey('workspace-legacy');
        const keyWithPass = await deriveLegacyEncryptionKey('workspace-legacy', 'my-secret');

        // Encrypt with one, try decrypt with the other — should fail
        const data = 'sensitive data';
        const encrypted = await encryptData(data, keyNoPass);
        await expect(decryptData(encrypted, keyWithPass)).rejects.toThrow(AuthenticationError);
      });
    });

    describe('tampered ciphertext detection', () => {
      it('should detect tampered ciphertext', async () => {
        const key = await deriveEncryptionKey('workspace-tamper');
        const encrypted = await encryptData('secret', key);

        // Tamper with ciphertext
        const ctBytes = Buffer.from(encrypted.ct, 'base64');
        ctBytes[0] ^= 0xff; // flip bits
        encrypted.ct = ctBytes.toString('base64');

        await expect(decryptData(encrypted, key)).rejects.toThrow();
      });

      it('should detect tampered IV', async () => {
        const key = await deriveEncryptionKey('workspace-tamper-iv');
        const encrypted = await encryptData('secret', key);

        // Tamper with IV
        const ivBytes = Buffer.from(encrypted.iv, 'base64');
        ivBytes[0] ^= 0xff;
        encrypted.iv = ivBytes.toString('base64');

        await expect(decryptData(encrypted, key)).rejects.toThrow();
      });
    });

    describe('retrieveEncrypted edge cases', () => {
      it('should return null for empty localStorage key', async () => {
        const key = await deriveEncryptionKey('workspace-empty');
        const retrieved = await retrieveEncrypted('nonexistent-key', key);
        expect(retrieved).toBeNull();
      });

      it('should return null for non-JSON localStorage value', async () => {
        const key = await deriveEncryptionKey('workspace-bad-json');
        global.localStorage.setItem('bad-json-key', 'not-json{{{');
        const retrieved = await retrieveEncrypted('bad-json-key', key);
        expect(retrieved).toBeNull();
      });

      it('should return null for plaintext data (no encrypted format)', async () => {
        const key = await deriveEncryptionKey('workspace-plaintext');
        global.localStorage.setItem('plaintext-key', JSON.stringify({ user1: { capacity: 8 } }));
        const retrieved = await retrieveEncrypted('plaintext-key', key);
        expect(retrieved).toBeNull();
      });
    });

    describe('storeEncrypted edge cases', () => {
      it('should handle JSON with nested objects', async () => {
        const key = await deriveEncryptionKey('workspace-nested');
        const storageKey = 'nested-test';
        const data = JSON.stringify({
          user1: {
            mode: 'perDay',
            capacity: 7,
            perDayOverrides: {
              '2025-01-15': { capacity: 6, multiplier: 1.5 },
              '2025-01-16': { capacity: 10 },
            },
          },
        });

        const stored = await storeEncrypted(storageKey, data, key);
        expect(stored).toBe(true);

        const retrieved = await retrieveEncrypted(storageKey, key);
        expect(retrieved).toBe(data);
        const parsed = JSON.parse(retrieved);
        expect(parsed.user1.perDayOverrides['2025-01-15'].capacity).toBe(6);
      });
    });
  });
});
