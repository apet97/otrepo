/**
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { showSessionExpiredDialog } from '../../js/ui/dialogs.js';
import { initializeElements } from '../../js/ui/shared.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Session expired modal focus trap', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="loadingState"></div>
      <button id="outsideButton">Outside</button>
    `;
    initializeElements(true);
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
  });

  it('keeps focus inside the modal on Tab and Shift+Tab', () => {
    showSessionExpiredDialog();

    const modal = document.getElementById('sessionExpiredModal');
    const reloadBtn = modal?.querySelector('.session-reload-btn');
    const outsideBtn = document.getElementById('outsideButton');

    expect(modal).not.toBeNull();
    expect(reloadBtn).not.toBeNull();

    reloadBtn.focus();
    expect(document.activeElement).toBe(reloadBtn);

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    modal.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(reloadBtn);
    expect(document.activeElement).not.toBe(outsideBtn);

    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
    modal.dispatchEvent(shiftTabEvent);
    expect(document.activeElement).toBe(reloadBtn);
  });
});
