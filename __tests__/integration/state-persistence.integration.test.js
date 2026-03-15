/**
 * @jest-environment jsdom
 */

import { describe, it, beforeEach, expect, jest } from '@jest/globals';

describe('integration: state persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.resetModules();
  });

  it('persists config and calcParams across module reloads', async () => {
    const stateModule = await import('../../js/state.js');
    const { store } = stateModule;

    store.config.showDecimalTime = true;
    store.calcParams.dailyThreshold = 7;
    store.saveConfig();

    jest.resetModules();
    const reloaded = await import('../../js/state.js');

    expect(reloaded.store.config.showDecimalTime).toBe(true);
    expect(reloaded.store.calcParams.dailyThreshold).toBe(7);
  });
});
