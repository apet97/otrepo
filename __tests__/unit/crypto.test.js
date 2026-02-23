/**
 * @jest-environment node
 */

/**
 * @fileoverview Unit tests for encryption utilities
 *
 * Tests the AES-GCM encryption module for secure localStorage.
 *
 * @see js/crypto.ts - encryption implementation
 */

import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';

// Set up globals for the crypto module
global.crypto = webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock btoa/atob for Node environment
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Mock localStorage
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value; },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();
global.localStorage = localStorageMock;

// Dynamic import after globals are set
let deriveEncryptionKey;
let encryptData;
let decryptData;
let storeEncrypted;
let retrieveEncrypted;
let isEncryptionSupported;
let deriveLegacyEncryptionKey;
let resetFallbackStorage;

beforeAll(async () => {
    const crypto = await import('../../js/crypto.js');
    deriveEncryptionKey = crypto.deriveEncryptionKey;
    deriveLegacyEncryptionKey = crypto.deriveLegacyEncryptionKey;
    encryptData = crypto.encryptData;
    decryptData = crypto.decryptData;
    storeEncrypted = crypto.storeEncrypted;
    retrieveEncrypted = crypto.retrieveEncrypted;
    isEncryptionSupported = crypto.isEncryptionSupported;
    const storage = await import('../../js/storage.js');
    resetFallbackStorage = storage.resetFallbackStorage;
});

beforeEach(() => {
    localStorageMock.clear();
    if (resetFallbackStorage) {
        resetFallbackStorage();
    }
});

describe('Encryption Utilities', () => {
    describe('isEncryptionSupported', () => {
        it('returns true when crypto.subtle is available', () => {
            expect(isEncryptionSupported()).toBe(true);
        });
    });

    describe('deriveEncryptionKey', () => {
        it('derives a key from workspace ID', async () => {
            const key = await deriveEncryptionKey('workspace-123');
            expect(key).toBeDefined();
            expect(key.type).toBe('secret');
            expect(key.algorithm.name).toBe('AES-GCM');
        });

        it('derives different keys for different workspace IDs', async () => {
            const key1 = await deriveEncryptionKey('workspace-123');
            const key2 = await deriveEncryptionKey('workspace-456');

            // Can't directly compare CryptoKeys, so encrypt same data and compare
            const testData = 'test data';
            const encrypted1 = await encryptData(testData, key1);
            const encrypted2 = await encryptData(testData, key2);

            // Ciphertext should be different (different keys + different IVs)
            expect(encrypted1.ct).not.toBe(encrypted2.ct);
        });

        it('derives same key for same workspace ID', async () => {
            const key1 = await deriveEncryptionKey('same-workspace');
            const key2 = await deriveEncryptionKey('same-workspace');

            // Encrypt with key1, decrypt with key2 should work
            const testData = 'test data';
            const encrypted = await encryptData(testData, key1);
            const decrypted = await decryptData(encrypted, key2);

            expect(decrypted).toBe(testData);
        });

        it('persists key across module reloads', async () => {
            const plaintext = 'persisted key data';
            const key1 = await deriveEncryptionKey('workspace-persist');
            const encrypted = await encryptData(plaintext, key1);

            jest.resetModules();
            const reloaded = await import('../../js/crypto.js');
            const key2 = await reloaded.deriveEncryptionKey('workspace-persist');
            const decrypted = await reloaded.decryptData(encrypted, key2);

            expect(decrypted).toBe(plaintext);
        });
    });

    describe('encryptData / decryptData', () => {
        let key;

        beforeAll(async () => {
            key = await deriveEncryptionKey('test-workspace');
        });

        it('encrypts and decrypts data correctly', async () => {
            const plaintext = 'Hello, World!';
            const encrypted = await encryptData(plaintext, key);
            const decrypted = await decryptData(encrypted, key);

            expect(decrypted).toBe(plaintext);
        });

        it('returns encrypted data with correct structure', async () => {
            const encrypted = await encryptData('test', key);

            expect(encrypted).toHaveProperty('ct');
            expect(encrypted).toHaveProperty('iv');
            expect(encrypted).toHaveProperty('v');
            expect(encrypted.v).toBe(1);
            expect(typeof encrypted.ct).toBe('string');
            expect(typeof encrypted.iv).toBe('string');
        });

        it('uses unique IV for each encryption', async () => {
            const plaintext = 'same data';
            const encrypted1 = await encryptData(plaintext, key);
            const encrypted2 = await encryptData(plaintext, key);

            expect(encrypted1.iv).not.toBe(encrypted2.iv);
            expect(encrypted1.ct).not.toBe(encrypted2.ct); // Different IV = different ciphertext
        });

        it('handles empty string', async () => {
            const plaintext = '';
            const encrypted = await encryptData(plaintext, key);
            const decrypted = await decryptData(encrypted, key);

            expect(decrypted).toBe('');
        });

        it('handles unicode characters', async () => {
            const plaintext = 'Hello, 世界! 🌍 émojis';
            const encrypted = await encryptData(plaintext, key);
            const decrypted = await decryptData(encrypted, key);

            expect(decrypted).toBe(plaintext);
        });

        it('handles large data', async () => {
            const plaintext = 'x'.repeat(100000); // 100KB
            const encrypted = await encryptData(plaintext, key);
            const decrypted = await decryptData(encrypted, key);

            expect(decrypted).toBe(plaintext);
        });

        it('handles JSON data', async () => {
            const data = {
                overrides: {
                    '2024-01-15': { capacity: 6, multiplier: 2.0 },
                    '2024-01-16': { capacity: 4, multiplier: 1.5 },
                },
                config: { sensitiveFlag: true },
            };
            const plaintext = JSON.stringify(data);
            const encrypted = await encryptData(plaintext, key);
            const decrypted = await decryptData(encrypted, key);

            expect(JSON.parse(decrypted)).toEqual(data);
        });

        it('fails to decrypt with wrong key', async () => {
            const key1 = await deriveEncryptionKey('workspace-1');
            const key2 = await deriveEncryptionKey('workspace-2');

            const encrypted = await encryptData('secret', key1);

            await expect(decryptData(encrypted, key2)).rejects.toThrow();
        });

        it('fails to decrypt tampered ciphertext', async () => {
            const encrypted = await encryptData('secret', key);

            // Tamper with ciphertext
            const tampered = { ...encrypted, ct: 'invalid' + encrypted.ct.slice(7) };

            await expect(decryptData(tampered, key)).rejects.toThrow();
        });

        it('fails to decrypt tampered IV', async () => {
            const encrypted = await encryptData('secret', key);

            // Tamper with IV
            const tampered = { ...encrypted, iv: 'AAAAAAAAAAAAAAAA' };

            await expect(decryptData(tampered, key)).rejects.toThrow();
        });
    });

    describe('storeEncrypted / retrieveEncrypted', () => {
        let key;

        beforeAll(async () => {
            key = await deriveEncryptionKey('test-workspace');
        });

        it('stores and retrieves encrypted data', async () => {
            const data = 'sensitive information';
            const success = await storeEncrypted('test-key', data, key);
            expect(success).toBe(true);

            const retrieved = await retrieveEncrypted('test-key', key);
            expect(retrieved).toBe(data);
        });

        it('returns null for non-existent key', async () => {
            const retrieved = await retrieveEncrypted('non-existent', key);
            expect(retrieved).toBeNull();
        });

        it('returns null for invalid stored data', async () => {
            localStorage.setItem('invalid-data', 'not-json');
            const retrieved = await retrieveEncrypted('invalid-data', key);
            expect(retrieved).toBeNull();
        });

        it('returns null for wrong version', async () => {
            localStorage.setItem('wrong-version', JSON.stringify({
                ct: 'ciphertext',
                iv: 'iv',
                v: 999, // Unsupported version
            }));
            const retrieved = await retrieveEncrypted('wrong-version', key);
            expect(retrieved).toBeNull();
        });

        it('stores data that is encrypted in localStorage', async () => {
            const sensitiveData = 'my-secret-password-123';
            await storeEncrypted('sensitive', sensitiveData, key);

            const stored = localStorage.getItem('sensitive');
            expect(stored).not.toContain('my-secret');
            expect(stored).not.toContain('password');

            // Verify it's valid JSON with encrypted structure
            const parsed = JSON.parse(stored);
            expect(parsed).toHaveProperty('ct');
            expect(parsed).toHaveProperty('iv');
            expect(parsed).toHaveProperty('v');
        });

        it('stores and retrieves data using fallback storage when localStorage fails', async () => {
            const originalSetItem = localStorage.setItem;
            const originalGetItem = localStorage.getItem;
            localStorage.setItem = () => { throw new Error('quota'); };
            localStorage.getItem = () => { throw new Error('quota'); };

            const data = 'fallback storage data';
            const success = await storeEncrypted('fallback-key', data, key);
            expect(success).toBe(true);

            const retrieved = await retrieveEncrypted('fallback-key', key);
            expect(retrieved).toBe(data);

            localStorage.setItem = originalSetItem;
            localStorage.getItem = originalGetItem;
        });
    });
});
