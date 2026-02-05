/**
 * @jest-environment node
 */

/**
 * @fileoverview Unit tests for request body signing functionality
 *
 * Tests the HMAC-SHA256 signature generation for POST request bodies.
 * This feature protects against request tampering during transit.
 *
 * NOTE: This test uses Node environment (not jsdom) because it requires
 * crypto.subtle which is available in Node but not in jsdom.
 *
 * @see js/api.ts - computeBodySignature, deriveSigningKey implementation
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';

// Set up globals for the API module
global.crypto = webcrypto;
global.TextEncoder = TextEncoder;

// Dynamic import after globals are set
let computeBodySignature;
let deriveSigningKey;

beforeAll(async () => {
    const api = await import('../../js/api.js');
    computeBodySignature = api.computeBodySignature;
    deriveSigningKey = api.deriveSigningKey;
});

describe('Request Body Signing', () => {
    describe('deriveSigningKey', () => {
        it('returns empty string for null token', () => {
            expect(deriveSigningKey(null)).toBe('');
        });

        it('returns empty string for empty token', () => {
            expect(deriveSigningKey('')).toBe('');
        });

        it('returns first 32 characters for long non-JWT token', () => {
            const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP';
            const key = deriveSigningKey(token);
            expect(key).toBe('abcdefghijklmnopqrstuvwxyz012345');
            expect(key.length).toBe(32);
        });

        it('returns full token if shorter than 32 characters (non-JWT token)', () => {
            const token = 'shorttoken';
            const key = deriveSigningKey(token);
            expect(key).toBe('shorttoken');
            expect(key.length).toBe(10);
        });

        it('returns signature segment for JWT tokens', () => {
            const token = 'header.payload.signature-segment-abcdefghijklmnopqrstuvwxyz';
            const key = deriveSigningKey(token);
            expect(key).toBe('signature-segment-abcdefghijklmn');
            expect(key.length).toBe(32);
        });

        it('returns exactly 32 characters for 32-char non-JWT token', () => {
            const token = '12345678901234567890123456789012';
            const key = deriveSigningKey(token);
            expect(key).toBe(token);
            expect(key.length).toBe(32);
        });

        it('produces different keys when JWT signatures differ', () => {
            const tokenA = 'header.payload.signatureA';
            const tokenB = 'header.payload.signatureB';
            const keyA = deriveSigningKey(tokenA);
            const keyB = deriveSigningKey(tokenB);
            expect(keyA).not.toBe(keyB);
        });
    });

    describe('computeBodySignature', () => {
        it('generates a 64-character hex signature', async () => {
            const body = '{"test":"data"}';
            const key = 'test-signing-key-1234567890';

            const signature = await computeBodySignature(body, key);

            expect(signature).toMatch(/^[0-9a-f]{64}$/);
        });

        it('generates consistent signatures for same input', async () => {
            const body = '{"foo":"bar","baz":123}';
            const key = 'consistent-key';

            const sig1 = await computeBodySignature(body, key);
            const sig2 = await computeBodySignature(body, key);

            expect(sig1).toBe(sig2);
        });

        it('generates different signatures for different bodies', async () => {
            const key = 'same-key';

            const sig1 = await computeBodySignature('{"a":1}', key);
            const sig2 = await computeBodySignature('{"a":2}', key);

            expect(sig1).not.toBe(sig2);
        });

        it('generates different signatures for different keys', async () => {
            const body = '{"same":"body"}';

            const sig1 = await computeBodySignature(body, 'key-one');
            const sig2 = await computeBodySignature(body, 'key-two');

            expect(sig1).not.toBe(sig2);
        });

        it('handles empty body', async () => {
            const signature = await computeBodySignature('', 'some-key');

            expect(signature).toMatch(/^[0-9a-f]{64}$/);
        });

        it('returns empty string for empty key', async () => {
            const signature = await computeBodySignature('{"data":"test"}', '');

            // Empty key returns empty signature (no signing without a key)
            expect(signature).toBe('');
        });

        it('handles unicode characters in body', async () => {
            const body = '{"message":"Hello, 世界! 🌍"}';
            const key = 'unicode-test-key';

            const signature = await computeBodySignature(body, key);

            expect(signature).toMatch(/^[0-9a-f]{64}$/);
        });

        it('handles special JSON characters', async () => {
            const body = JSON.stringify({
                escaped: 'line1\nline2\ttab',
                quotes: '"quoted"',
                backslash: 'path\\to\\file',
            });
            const key = 'special-chars-key';

            const signature = await computeBodySignature(body, key);

            expect(signature).toMatch(/^[0-9a-f]{64}$/);
        });

        it('handles large bodies', async () => {
            // Create a large JSON body (100KB+)
            const largeData = { items: Array(10000).fill({ id: 123, value: 'test-data' }) };
            const body = JSON.stringify(largeData);
            const key = 'large-body-key';

            const signature = await computeBodySignature(body, key);

            expect(signature).toMatch(/^[0-9a-f]{64}$/);
        });

        // Known test vector to verify HMAC-SHA256 implementation
        it('produces correct HMAC-SHA256 for known test vector', async () => {
            // Use a simple known input to verify the algorithm
            const body = 'test';
            const key = 'key';

            const signature = await computeBodySignature(body, key);

            // HMAC-SHA256("test", "key") should produce this specific hash
            // Verified with: echo -n "test" | openssl dgst -sha256 -hmac "key"
            expect(signature).toBe('02afb56304902c656fcb737cdd03de6205bb6d401da2812efd9b2d36a08af159');
        });
    });

    describe('body signature integration', () => {
        it('signature changes when body is modified', async () => {
            const key = 'integration-test-key';
            const originalBody = '{"userId":"123","action":"create"}';
            const tamperedBody = '{"userId":"456","action":"create"}';

            const originalSig = await computeBodySignature(originalBody, key);
            const tamperedSig = await computeBodySignature(tamperedBody, key);

            expect(originalSig).not.toBe(tamperedSig);
        });

        it('works with typical API request body', async () => {
            const key = deriveSigningKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXAiOiJKV1QifQ.signature');
            const body = JSON.stringify({
                dateRangeStart: '2024-01-01T00:00:00.000Z',
                dateRangeEnd: '2024-01-31T23:59:59.999Z',
                amountShown: 'EARNED',
                amounts: ['EARNED', 'COST', 'PROFIT'],
                detailedFilter: {
                    page: 1,
                    pageSize: 200,
                },
            });

            const signature = await computeBodySignature(body, key);

            expect(signature).toMatch(/^[0-9a-f]{64}$/);
            expect(signature.length).toBe(64);
        });

        it('derived key is deterministic', () => {
            const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';

            const key1 = deriveSigningKey(token);
            const key2 = deriveSigningKey(token);

            expect(key1).toBe(key2);
            // Uses signature segment for JWT tokens
            expect(key1).toBe('signature');
        });
    });
});
