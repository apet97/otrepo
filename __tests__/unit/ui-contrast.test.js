/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from '@jest/globals';

describe('UI contrast adjustments', () => {
  it('uses stronger muted text color for small text elements', () => {
    const cssPath = path.join(process.cwd(), 'css/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/--text-muted-strong:/);
    const darkIndex = css.indexOf('.cl-theme-dark {');
    expect(darkIndex).toBeGreaterThan(-1);
    expect(css.indexOf('--text-muted-strong', darkIndex)).toBeGreaterThan(darkIndex);
    const assertColorNear = (selector, value) => {
      const start = css.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      const window = css.slice(start, start + 300);
      expect(window).toContain(`color: ${value}`);
    };

    assertColorNear('.badge-offday', 'var(--text-muted-strong)');
    assertColorNear('.amount-tag', 'var(--text-muted-strong)');
    assertColorNear('.amount-header-sub', 'var(--text-muted-strong)');
    assertColorNear('.override-profile-hint', 'var(--text-muted-strong)');
    assertColorNear('.override-field label', 'var(--text-muted-strong)');
  });
});
