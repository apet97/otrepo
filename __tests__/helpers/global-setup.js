/**
 * Global test setup — registered via jest.config.js setupFilesAfterEnv.
 * Automatically runs standardAfterEach after every test for cleanup.
 */

import { afterEach } from '@jest/globals';
import { standardAfterEach } from './setup.js';

afterEach(standardAfterEach);
