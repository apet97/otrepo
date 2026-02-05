#!/usr/bin/env node
/**
 * @fileoverview Cross-platform clean script
 * Removes build artifacts (dist/, coverage/) in a platform-independent way.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const dirsToRemove = ['dist', 'coverage'];

for (const dir of dirsToRemove) {
    const fullPath = path.join(rootDir, dir);
    if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`Removed: ${dir}/`);
    }
}

console.log('Clean complete.');
