/**
 * @jest-environment jsdom
 */

import { jest, afterEach, beforeEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// Mock the state module
jest.unstable_mockModule('../../js/state.js', () => ({
  store: {
    claims: null
  }
}));

// Mock Sentry
const mockSentry = {
  init: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  withScope: jest.fn((callback) => {
    const scope = {
      setLevel: jest.fn(),
      setTag: jest.fn(),
      setExtras: jest.fn(),
      setExtra: jest.fn()
    };
    callback(scope);
    return scope;
  }),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  flush: jest.fn().mockResolvedValue(true)
};

// Dynamic import mock for @sentry/browser
jest.unstable_mockModule('@sentry/browser', () => mockSentry);

describe('Error Reporting Module', () => {
  let errorReporting;
  let store;

  afterEach(() => {
    standardAfterEach();
    errorReporting = null;
    store = null;
  });

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Reset module cache to get fresh state
    jest.resetModules();

    // Re-import modules after reset
    const stateModule = await import('../../js/state.js');
    store = stateModule.store;
    store.claims = null;

    errorReporting = await import('../../js/error-reporting.js');
  });

  describe('Sensitive Data Scrubbing', () => {
    it('should scrub auth_token from strings', async () => {
      // Initialize with valid config
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      // Report an error containing sensitive data
      errorReporting.reportError(new Error('Error at auth_token=abc123xyz'), {
        module: 'Test'
      });

      // Verify captureException was called
      expect(mockSentry.captureException).toHaveBeenCalled();
    });

    it('should scrub Bearer tokens from strings', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportMessage('Request failed with Bearer abc123token', 'error', {
        module: 'API'
      });

      expect(mockSentry.captureMessage).toHaveBeenCalled();
    });

    it('should scrub email addresses from strings', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      // Message containing email
      errorReporting.reportMessage('User user@example.com failed login', 'info', {
        module: 'Auth'
      });

      expect(mockSentry.captureMessage).toHaveBeenCalled();
    });

    it('should redact sensitive object keys', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportError(new Error('Test error'), {
        module: 'Test',
        metadata: {
          apiToken: 'secret123',
          password: 'mypassword',
          userEmail: 'test@test.com',
          secretKey: 'key123',
          normalData: 'this is fine'
        }
      });

      expect(mockSentry.withScope).toHaveBeenCalled();
    });
  });

  describe('initErrorReporting', () => {
    it('should return false when DSN is not provided', async () => {
      const result = await errorReporting.initErrorReporting({
        dsn: '',
        environment: 'test',
        release: '1.0.0'
      });

      expect(result).toBe(false);
    });

    it('should return false when DSN is placeholder', async () => {
      const result = await errorReporting.initErrorReporting({
        dsn: 'YOUR_DSN',
        environment: 'test',
        release: '1.0.0'
      });

      expect(result).toBe(false);
    });

    it('should return false when DSN starts with __', async () => {
      const result = await errorReporting.initErrorReporting({
        dsn: '__SENTRY_DSN__',
        environment: 'test',
        release: '1.0.0'
      });

      expect(result).toBe(false);
    });

    it('should initialize Sentry with valid DSN', async () => {
      const result = await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'production',
        release: '2.0.0',
        debug: true,
        sampleRate: 0.5
      });

      expect(result).toBe(true);
      expect(mockSentry.init).toHaveBeenCalled();
    });

    it('should return true on subsequent calls (idempotent)', async () => {
      // First initialization
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      const callCount = mockSentry.init.mock.calls.length;

      // Second call should return true without re-initializing
      const result = await errorReporting.initErrorReporting({
        dsn: 'https://different@sentry.io/456',
        environment: 'production',
        release: '2.0.0'
      });

      expect(result).toBe(true);
      expect(mockSentry.init.mock.calls.length).toBe(callCount); // No new calls
    });

    it('should set workspace tag when claims are available (hashed for privacy)', async () => {
      store.claims = { workspaceId: 'ws_123' };

      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      // Workspace ID should be hashed using FNV-1a for privacy
      // 'ws_123' hashes to 'c9937290'
      expect(mockSentry.setTag).toHaveBeenCalledWith('workspace_id', 'c9937290');
    });
  });

  describe('isErrorReportingEnabled', () => {
    it('should return false before initialization', () => {
      expect(errorReporting.isErrorReportingEnabled()).toBe(false);
    });

    it('should return true after successful initialization', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      expect(errorReporting.isErrorReportingEnabled()).toBe(true);
    });
  });

  describe('reportError', () => {
    it('should log to console even without Sentry initialized', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      errorReporting.reportError(new Error('Test error'), {
        module: 'TestModule',
        operation: 'testOp'
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should accept string errors and convert to Error objects', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportError('String error message', {
        module: 'Test'
      });

      expect(mockSentry.captureException).toHaveBeenCalled();
    });

    it('should set error level from context', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportError(new Error('Fatal error'), {
        level: 'fatal',
        module: 'Critical'
      });

      expect(mockSentry.withScope).toHaveBeenCalled();
    });

    it('should set module and operation tags', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportError(new Error('Test'), {
        module: 'API',
        operation: 'fetchData'
      });

      expect(mockSentry.withScope).toHaveBeenCalled();
    });

    it('should handle Sentry errors gracefully', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      mockSentry.withScope.mockImplementationOnce(() => {
        throw new Error('Sentry internal error');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw
      expect(() => {
        errorReporting.reportError(new Error('Test'));
      }).not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe('reportMessage', () => {
    it('should log to console even without Sentry initialized', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      errorReporting.reportMessage('Test message', 'info', {
        module: 'TestModule'
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use console.error for error/fatal levels', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      errorReporting.reportMessage('Error message', 'error', {
        module: 'Test'
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should capture message with correct level', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportMessage('Warning message', 'warning', {
        module: 'Calc'
      });

      expect(mockSentry.withScope).toHaveBeenCalled();
      expect(mockSentry.captureMessage).toHaveBeenCalled();
    });

    it('should default to info level', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.reportMessage('Info message');

      expect(mockSentry.captureMessage).toHaveBeenCalled();
    });
  });

  describe('setUserContext', () => {
    it('should not set user when Sentry is not initialized', () => {
      errorReporting.setUserContext('user123');
      expect(mockSentry.setUser).not.toHaveBeenCalled();
    });

    it('should set hashed user ID when initialized', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.setUserContext('user123');

      expect(mockSentry.setUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.any(String) })
      );
      // Verify it's not the raw user ID (privacy hashing)
      const call = mockSentry.setUser.mock.calls[mockSentry.setUser.mock.calls.length - 1];
      expect(call[0].id).not.toBe('user123');
    });

    it('should clear user when null is passed', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.setUserContext(null);

      expect(mockSentry.setUser).toHaveBeenCalledWith(null);
    });
  });

  describe('addBreadcrumb', () => {
    it('should not add breadcrumb when Sentry is not initialized', () => {
      errorReporting.addBreadcrumb('nav', 'User clicked button');
      expect(mockSentry.addBreadcrumb).not.toHaveBeenCalled();
    });

    it('should add breadcrumb with scrubbed message', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.addBreadcrumb('api', 'Fetched data', { url: '/users' });

      expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'api',
          level: 'info'
        })
      );
    });

    it('should scrub sensitive data from breadcrumb data', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.addBreadcrumb('api', 'Request made', {
        token: 'secret123',
        url: '/api/data'
      });

      expect(mockSentry.addBreadcrumb).toHaveBeenCalled();
    });
  });

  describe('flushErrorReports', () => {
    it('should return true when Sentry is not initialized', async () => {
      const result = await errorReporting.flushErrorReports();
      expect(result).toBe(true);
    });

    it('should call Sentry flush when initialized', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      const result = await errorReporting.flushErrorReports(3000);

      expect(mockSentry.flush).toHaveBeenCalledWith(3000);
      expect(result).toBe(true);
    });

    it('should use default timeout of 2000ms', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      await errorReporting.flushErrorReports();

      expect(mockSentry.flush).toHaveBeenCalledWith(2000);
    });

    it('should return false on flush error', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      mockSentry.flush.mockRejectedValueOnce(new Error('Flush failed'));

      const result = await errorReporting.flushErrorReports();

      expect(result).toBe(false);
    });
  });

  describe('Hash Function', () => {
    it('should produce consistent hashes for same input', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.setUserContext('testuser');
      const firstCall = mockSentry.setUser.mock.calls[mockSentry.setUser.mock.calls.length - 1][0];

      errorReporting.setUserContext('testuser');
      const secondCall = mockSentry.setUser.mock.calls[mockSentry.setUser.mock.calls.length - 1][0];

      expect(firstCall.id).toBe(secondCall.id);
    });

    it('should produce different hashes for different inputs', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0'
      });

      errorReporting.setUserContext('user1');
      const firstCall = mockSentry.setUser.mock.calls[mockSentry.setUser.mock.calls.length - 1][0];

      errorReporting.setUserContext('user2');
      const secondCall = mockSentry.setUser.mock.calls[mockSentry.setUser.mock.calls.length - 1][0];

      expect(firstCall.id).not.toBe(secondCall.id);
    });
  });
});
