/**
 * @jest-environment node
 */

import { describe, it, expect } from '@jest/globals';
import { createMockFetch } from '../helpers/setup.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('Mock fetch headers', () => {
  it('supports case-insensitive header access in createMockFetch', async () => {
    const mockFetch = createMockFetch({ ok: true }, { headers: { 'Content-Type': 'application/json' } });
    const response = await mockFetch();

    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.has('CONTENT-TYPE')).toBe(true);
  });

  it('supports case-insensitive header access in createFetchResponse', async () => {
    const response = TestFixtures.createFetchResponse({ ok: true }, { headers: { 'X-Test': 'value' } });

    expect(response.headers.get('x-test')).toBe('value');
    expect(response.headers.get('X-Test')).toBe('value');
    expect(response.headers.has('X-TEST')).toBe(true);
  });
});
