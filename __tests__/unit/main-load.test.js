/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

const uiMock = {
  initializeElements: jest.fn(),
  renderLoading: jest.fn(),
  renderOverridesPage: jest.fn(),
  showError: jest.fn()
};

const apiMock = {
  fetchUsers: jest.fn()
};

const errorReportingMock = {
  reportError: jest.fn(),
  initErrorReporting: jest.fn()
};

jest.unstable_mockModule('../../js/ui/index.js', () => uiMock);
jest.unstable_mockModule('../../js/api.js', () => ({
  Api: apiMock,
  resetRateLimiter: jest.fn(),
  resetCircuitBreaker: jest.fn(),
  getCircuitBreakerState: jest.fn(() => ({ isOpen: false, failures: 0 }))
}));
jest.unstable_mockModule('../../js/error-reporting.js', () => errorReportingMock);

describe('Main loadInitialData', () => {
  let loadInitialData;
  let store;
  let originalClaims;
  let originalUsers;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    const stateModule = await import('../../js/state.js');
    store = stateModule.store;

    originalClaims = store.claims;
    originalUsers = store.users;

    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me'
    };
    store.users = [];

    const mainModule = await import('../../js/main.js');
    loadInitialData = mainModule.loadInitialData;
  });

  afterEach(() => {
    standardAfterEach();
    store.claims = originalClaims;
    store.users = originalUsers;
  });

  it('shows a validation error when no users are returned', async () => {
    apiMock.fetchUsers.mockResolvedValue([]);

    await loadInitialData();

    expect(uiMock.renderLoading).toHaveBeenCalledWith(true);
    expect(uiMock.showError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'No Users Found',
        action: 'reload',
        type: 'VALIDATION_ERROR'
      })
    );
    expect(uiMock.renderOverridesPage).not.toHaveBeenCalled();
  });

  it('shows an API error when fetchUsers fails', async () => {
    apiMock.fetchUsers.mockRejectedValue(new Error('network failed'));

    await loadInitialData();

    expect(errorReportingMock.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        module: 'main',
        operation: 'loadInitialData',
        level: 'error'
      })
    );
    expect(uiMock.showError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Failed to Load Users',
        action: 'reload',
        type: 'API_ERROR'
      })
    );
  });
});
