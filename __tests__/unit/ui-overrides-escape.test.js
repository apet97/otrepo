/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderOverridesPage } from '../../js/ui/overrides.js';
import { initializeElements } from '../../js/ui/shared.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Overrides userId escaping', () => {
  let storeSnapshot;

  beforeEach(() => {
    storeSnapshot = {
      users: store.users,
      overrides: store.overrides,
      profiles: store.profiles
    };

    document.body.innerHTML = `
      <div id="overridesUserList"></div>
    `;
    initializeElements(true);
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
    store.users = storeSnapshot.users;
    store.overrides = storeSnapshot.overrides;
    store.profiles = storeSnapshot.profiles;
  });

  it('escapes user ids in data attributes', () => {
    const maliciousId = 'bad"onload="alert(1)';
    store.users = [{ id: maliciousId, name: 'Eve' }];
    store.overrides = {};
    store.profiles = new Map();

    renderOverridesPage();

    const container = document.getElementById('overridesUserList');
    const html = container?.innerHTML || '';

    expect(html).toContain('data-userid="bad&quot;onload=&quot;alert(1)"');
    expect(html).not.toContain(`data-userid="${maliciousId}"`);
  });
});
