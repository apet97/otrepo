/**
 * @jest-environment node
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from '@jest/globals';

describe('Focus-visible styles', () => {
  const css = readFileSync(resolve(process.cwd(), 'css/styles.css'), 'utf8');

  const expectFocusVisible = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`${escaped}[^\{]*\{[^}]*outline:\\s*2px`, 'm');
    expect(css).toMatch(rule);
  };

  it('includes focus-visible outlines for key inputs and controls', () => {
    expectFocusVisible('.compact-date:focus-visible');
    expectFocusVisible('.status-info-btn:focus-visible');
    expectFocusVisible('.per-day-input:focus-visible');
    expectFocusVisible('.weekly-input:focus-visible');
    expectFocusVisible('.mode-select:focus-visible');
    expectFocusVisible('.override-field .override-input:focus-visible');
    expectFocusVisible('.override-field .override-select:focus-visible');
  });
});
