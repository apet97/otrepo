/**
 * @jest-environment node
 */

import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { store } from '../../js/state.js';
import { checkTokenExpiration } from '../../js/api.js';

// Provide atob for base64url decoding in Node
if (typeof global.atob !== 'function') {
  global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

const encodeBase64Url = (obj) => {
  const json = JSON.stringify(obj);
  const base64 = Buffer.from(json).toString('base64');
  return {
    base64,
    base64url: base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  };
};

const buildPaddedPayload = (payload) => {
  let pad = '';
  while (true) {
    const candidate = { ...payload, pad };
    const encoded = encodeBase64Url(candidate);
    if (encoded.base64.includes('=')) {
      return encoded.base64url;
    }
    pad += 'x';
  }
};

describe('checkTokenExpiration base64url decoding', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    store.token = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('parses expiration for payloads that require padding', () => {
    const nowMs = 1_700_000_000_000;
    jest.setSystemTime(nowMs);
    const exp = Math.floor(nowMs / 1000) - 10; // expired

    const header = encodeBase64Url({ alg: 'HS256', typ: 'JWT' }).base64url;
    const payload = buildPaddedPayload({ exp });
    const token = `${header}.${payload}.signature`;

    store.token = token;
    const result = checkTokenExpiration();

    expect(result.isExpired).toBe(true);
    expect(result.expiresIn).toBeLessThanOrEqual(0);
  });

  it('flags non-JWT tokens as expired', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    store.token = 'not-a-jwt';

    const result = checkTokenExpiration();

    expect(result.isExpired).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
