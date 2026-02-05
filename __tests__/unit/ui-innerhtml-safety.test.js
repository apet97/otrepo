/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from '@jest/globals';

describe('UI innerHTML safety markers', () => {
  it('marks summary strip innerHTML assignment as safety-reviewed', () => {
    const summaryPath = path.join(process.cwd(), 'js/ui/summary.ts');
    const source = fs.readFileSync(summaryPath, 'utf8');

    const marker = 'SAFE-INNERHTML(summary-strip): values';
    const markerIndex = source.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(-1);
    expect(source.indexOf('strip.innerHTML', markerIndex)).toBeGreaterThan(markerIndex);
  });

  it('marks detailed table innerHTML assignment as safety-reviewed', () => {
    const detailedPath = path.join(process.cwd(), 'js/ui/detailed.ts');
    const source = fs.readFileSync(detailedPath, 'utf8');

    const marker = 'SAFE-INNERHTML(detailed-table): html is built from escaped strings/formatters only.';
    const markerIndex = source.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(-1);
    expect(source.indexOf('container.innerHTML', markerIndex)).toBeGreaterThan(markerIndex);
  });
});
