/**
 * @jest-environment jsdom
 */

/**
 * Coverage-focused tests for js/error-reporting.ts
 *
 * Targets uncovered lines: 110, 118, 141, 181-245, 259-260, 302, 310, 349, 354, 357, 363
 * These cover:
 * - scrubObject edge cases (null/undefined, arrays, non-object primitives)
 * - beforeSend callback internals (exception values, stacktrace frames, breadcrumbs, request, extra)
 * - beforeBreadcrumb callback (filtering debug console breadcrumbs)
 * - initErrorReporting catch block (import failure)
 * - reportError with workspace tag and metadata/userMessage extras
 * - reportMessage with operation tag, workspace tag, metadata extras, catch block
 */

import { jest, afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';

// We need to capture the beforeSend and beforeBreadcrumb callbacks that are
// passed to Sentry.init. We do this by inspecting mockSentry.init calls.

const mockSentry = {
  init: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  withScope: jest.fn((callback) => {
    const scope = {
      setLevel: jest.fn(),
      setTag: jest.fn(),
      setExtras: jest.fn(),
      setExtra: jest.fn(),
    };
    callback(scope);
    return scope;
  }),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
};

// Mock the state module
jest.unstable_mockModule('../../js/state.js', () => ({
  store: {
    claims: null,
  },
}));

// Mock @sentry/browser — default to the working mock
jest.unstable_mockModule('@sentry/browser', () => mockSentry);

describe('Error Reporting Coverage Tests', () => {
  let errorReporting;
  let store;

  afterEach(() => {
    standardAfterEach();
    errorReporting = null;
    store = null;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Re-mock @sentry/browser with working mock (may have been overridden)
    jest.unstable_mockModule('@sentry/browser', () => mockSentry);

    const stateModule = await import('../../js/state.js');
    store = stateModule.store;
    store.claims = null;

    errorReporting = await import('../../js/error-reporting.js');
  });

  // Helper: initialize sentry and return the beforeSend/beforeBreadcrumb callbacks
  async function initAndGetCallbacks() {
    await errorReporting.initErrorReporting({
      dsn: 'https://test@sentry.io/123',
      environment: 'test',
      release: '1.0.0',
    });

    const initCall = mockSentry.init.mock.calls[0][0];
    return {
      beforeSend: initCall.beforeSend,
      beforeBreadcrumb: initCall.beforeBreadcrumb,
    };
  }

  // =================================================================
  // scrubObject edge cases (lines 110, 118, 141)
  // These are exercised indirectly through beforeSend and addBreadcrumb
  // =================================================================

  describe('scrubObject edge cases via beforeSend', () => {
    it('should handle null/undefined in extra context (line 110)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      // extra with null values should pass through scrubObject
      const event = {
        extra: {
          nullVal: null,
          undefVal: undefined,
          normalVal: 'hello',
        },
      };

      const result = beforeSend(event);
      expect(result.extra.nullVal).toBeNull();
      expect(result.extra.undefVal).toBeUndefined();
      expect(result.extra.normalVal).toBe('hello');
    });

    it('should handle arrays in extra context (line 118)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        extra: {
          items: ['normal', 'Bearer secret123', 'another'],
        },
      };

      const result = beforeSend(event);
      expect(result.extra.items).toBeInstanceOf(Array);
      expect(result.extra.items).toHaveLength(3);
      expect(result.extra.items[0]).toBe('normal');
      expect(result.extra.items[1]).toContain('[REDACTED]');
      expect(result.extra.items[2]).toBe('another');
    });

    it('should return non-object primitives as-is (line 141)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      // Extra context with numeric and boolean values
      const event = {
        extra: {
          count: 42,
          enabled: true,
          ratio: 3.14,
        },
      };

      const result = beforeSend(event);
      expect(result.extra.count).toBe(42);
      expect(result.extra.enabled).toBe(true);
      expect(result.extra.ratio).toBe(3.14);
    });
  });

  // =================================================================
  // beforeSend callback internals (lines 181-224)
  // =================================================================

  describe('beforeSend callback', () => {
    it('should scrub exception values (lines 181-184)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        exception: {
          values: [
            { value: 'Failed with auth_token=secret123' },
            { value: 'Request to Bearer abc456 failed' },
          ],
        },
      };

      const result = beforeSend(event);
      expect(result.exception.values[0].value).toContain('[REDACTED]');
      expect(result.exception.values[0].value).not.toContain('secret123');
      expect(result.exception.values[1].value).toContain('[REDACTED]');
      expect(result.exception.values[1].value).not.toContain('abc456');
    });

    it('should scrub stacktrace frame filenames (lines 186-192)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        exception: {
          values: [
            {
              value: 'Error occurred',
              stacktrace: {
                frames: [
                  { filename: 'https://example.com/api?auth_token=supersecret' },
                  { filename: 'https://example.com/app.js' },
                  { filename: null }, // no filename
                ],
              },
            },
          ],
        },
      };

      const result = beforeSend(event);
      const frames = result.exception.values[0].stacktrace.frames;
      expect(frames[0].filename).toContain('[REDACTED]');
      expect(frames[0].filename).not.toContain('supersecret');
      expect(frames[1].filename).toBe('https://example.com/app.js');
      expect(frames[2].filename).toBeNull();
    });

    it('should handle exception without stacktrace (line 186 false branch)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        exception: {
          values: [
            { value: 'Simple error' },
          ],
        },
      };

      const result = beforeSend(event);
      expect(result.exception.values[0].value).toBe('Simple error');
    });

    it('should handle exception value being falsy (line 183 false branch)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        exception: {
          values: [
            { value: null, stacktrace: { frames: [] } },
            { type: 'TypeError' }, // no value property
          ],
        },
      };

      const result = beforeSend(event);
      expect(result.exception.values[0].value).toBeNull();
      expect(result.exception.values[1].value).toBeUndefined();
    });

    it('should scrub breadcrumbs in event (lines 197-208)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        breadcrumbs: [
          {
            message: 'Fetching Bearer mytoken123',
            data: {
              url: 'https://api.clockify.me?auth_token=secret',
              userEmail: 'test@test.com',
            },
          },
          {
            message: null,
            data: null,
          },
          {
            category: 'navigation',
            // no message, no data
          },
        ],
      };

      const result = beforeSend(event);
      // First breadcrumb: message scrubbed, data scrubbed
      expect(result.breadcrumbs[0].message).toContain('[REDACTED]');
      expect(result.breadcrumbs[0].message).not.toContain('mytoken123');
      // data.userEmail should be redacted (sensitive key)
      expect(result.breadcrumbs[0].data.userEmail).toBe('[REDACTED]');
      // data.url should have auth_token scrubbed
      expect(result.breadcrumbs[0].data.url).toContain('[REDACTED]');

      // Second breadcrumb: null message and null data should not throw
      expect(result.breadcrumbs[1].message).toBeNull();
      expect(result.breadcrumbs[1].data).toBeNull();

      // Third breadcrumb: no message/data properties
      expect(result.breadcrumbs[2].category).toBe('navigation');
    });

    it('should scrub request URL and query_string (lines 212-217)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        request: {
          url: 'https://api.clockify.me/v1/users?auth_token=mytoken',
          query_string: 'auth_token=mytoken&page=1',
        },
      };

      const result = beforeSend(event);
      expect(result.request.url).toContain('[REDACTED]');
      expect(result.request.url).not.toContain('mytoken');
      expect(result.request.query_string).toContain('[REDACTED]');
      expect(result.request.query_string).not.toContain('mytoken');
    });

    it('should handle request with url but no query_string (line 215 false branch)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        request: {
          url: 'https://api.clockify.me/v1/users?auth_token=secret',
        },
      };

      const result = beforeSend(event);
      expect(result.request.url).toContain('[REDACTED]');
      expect(result.request.query_string).toBeUndefined();
    });

    it('should handle event without request (line 212 false branch)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {};
      const result = beforeSend(event);
      expect(result).toEqual({});
    });

    it('should scrub extra context (lines 220-222)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        extra: {
          apiToken: 'secret123',
          details: 'user@example.com did something',
          count: 5,
          nested: {
            password: 'pass123',
            safe: 'ok',
          },
        },
      };

      const result = beforeSend(event);
      // apiToken is a sensitive key — redacted entirely
      expect(result.extra.apiToken).toBe('[REDACTED]');
      // details string has email scrubbed
      expect(result.extra.details).toContain('[REDACTED]');
      expect(result.extra.details).not.toContain('user@example.com');
      // count is a number — passes through
      expect(result.extra.count).toBe(5);
      // nested.password is sensitive key
      expect(result.extra.nested.password).toBe('[REDACTED]');
      expect(result.extra.nested.safe).toBe('ok');
    });

    it('should handle event without extra (line 220 false branch)', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = { exception: { values: [] } };
      const result = beforeSend(event);
      expect(result.extra).toBeUndefined();
    });

    it('should return the event after processing', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        exception: { values: [{ value: 'Test' }] },
        breadcrumbs: [{ message: 'nav' }],
        request: { url: 'https://example.com' },
        extra: { info: 'test' },
      };

      const result = beforeSend(event);
      expect(result).toBe(event); // returns the same event object (mutated)
    });
  });

  // =================================================================
  // beforeBreadcrumb callback (lines 240-246)
  // =================================================================

  describe('beforeBreadcrumb callback', () => {
    it('should filter out debug console breadcrumbs (lines 242-243)', async () => {
      const { beforeBreadcrumb } = await initAndGetCallbacks();

      const debugBreadcrumb = {
        category: 'console',
        level: 'debug',
        message: 'Some debug log',
      };

      const result = beforeBreadcrumb(debugBreadcrumb);
      expect(result).toBeNull();
    });

    it('should keep non-debug console breadcrumbs (line 245)', async () => {
      const { beforeBreadcrumb } = await initAndGetCallbacks();

      const infoBreadcrumb = {
        category: 'console',
        level: 'info',
        message: 'Some info log',
      };

      const result = beforeBreadcrumb(infoBreadcrumb);
      expect(result).toBe(infoBreadcrumb);
    });

    it('should keep non-console breadcrumbs (line 245)', async () => {
      const { beforeBreadcrumb } = await initAndGetCallbacks();

      const navBreadcrumb = {
        category: 'navigation',
        level: 'info',
        message: 'Page changed',
      };

      const result = beforeBreadcrumb(navBreadcrumb);
      expect(result).toBe(navBreadcrumb);
    });

    it('should keep debug breadcrumbs from non-console category (line 242 partial)', async () => {
      const { beforeBreadcrumb } = await initAndGetCallbacks();

      const breadcrumb = {
        category: 'http',
        level: 'debug',
        message: 'HTTP request',
      };

      const result = beforeBreadcrumb(breadcrumb);
      expect(result).toBe(breadcrumb);
    });
  });

  // =================================================================
  // initErrorReporting catch block (lines 259-260)
  // =================================================================

  describe('initErrorReporting import failure', () => {
    it('should return false when @sentry/browser import fails (lines 259-260)', async () => {
      // Reset modules to get a fresh error-reporting module
      jest.resetModules();

      // Mock @sentry/browser to throw on import
      jest.unstable_mockModule('@sentry/browser', () => {
        throw new Error('Module not found: @sentry/browser');
      });

      // Re-mock state
      jest.unstable_mockModule('../../js/state.js', () => ({
        store: { claims: null },
      }));

      const freshErrorReporting = await import('../../js/error-reporting.js');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await freshErrorReporting.initErrorReporting({
        dsn: 'https://valid@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize Sentry'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  // =================================================================
  // reportError with workspace tag and metadata/userMessage (lines 302, 310)
  // =================================================================

  describe('reportError with full context', () => {
    it('should set workspace_id tag when claims have workspaceId (line 302)', async () => {
      store.claims = { workspaceId: 'ws_test_123' };

      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      // Capture the scope to verify tag calls
      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportError(new Error('Test error'), {
        module: 'TestModule',
        operation: 'testOp',
        level: 'error',
        metadata: { action: 'click' },
        userMessage: 'Something went wrong',
      });

      // workspace_id tag should be set
      const tagCalls = capturedScope.setTag.mock.calls;
      const wsTagCall = tagCalls.find((c) => c[0] === 'workspace_id');
      expect(wsTagCall).toBeDefined();
      expect(wsTagCall[1]).not.toBe('ws_test_123'); // should be hashed

      // metadata extras should be set
      expect(capturedScope.setExtras).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'click' })
      );

      // userMessage should be set as extra (line 310)
      expect(capturedScope.setExtra).toHaveBeenCalledWith(
        'user_message',
        'Something went wrong'
      );
    });

    it('should not set workspace_id when claims have no workspaceId (line 301 false branch)', async () => {
      store.claims = {}; // no workspaceId

      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportError(new Error('Test error'), {
        module: 'TestModule',
      });

      const tagCalls = capturedScope.setTag.mock.calls;
      const wsTagCall = tagCalls.find((c) => c[0] === 'workspace_id');
      expect(wsTagCall).toBeUndefined();
    });

    it('should handle metadata with sensitive keys being scrubbed in extras', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportError(new Error('Test'), {
        metadata: {
          apiToken: 'secretvalue',
          normalField: 'safe data',
        },
      });

      const extrasCall = capturedScope.setExtras.mock.calls[0][0];
      expect(extrasCall.apiToken).toBe('[REDACTED]');
      expect(extrasCall.normalField).toBe('safe data');
    });
  });

  // =================================================================
  // reportMessage with operation, workspace tag, metadata, catch (lines 349, 354, 357, 363)
  // =================================================================

  describe('reportMessage with full context', () => {
    it('should set operation tag (line 349)', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportMessage('Test message', 'warning', {
        module: 'TestModule',
        operation: 'doSomething',
      });

      const tagCalls = capturedScope.setTag.mock.calls;
      expect(tagCalls.find((c) => c[0] === 'module')).toBeDefined();
      expect(tagCalls.find((c) => c[0] === 'operation' && c[1] === 'doSomething')).toBeDefined();
    });

    it('should set workspace_id tag when claims have workspaceId (line 354)', async () => {
      store.claims = { workspaceId: 'ws_456' };

      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportMessage('Test', 'info', {
        module: 'Test',
      });

      const tagCalls = capturedScope.setTag.mock.calls;
      const wsTagCall = tagCalls.find((c) => c[0] === 'workspace_id');
      expect(wsTagCall).toBeDefined();
      expect(wsTagCall[1]).not.toBe('ws_456'); // should be hashed
    });

    it('should set metadata extras (line 357)', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportMessage('Test', 'info', {
        metadata: { action: 'click', count: 3 },
      });

      expect(capturedScope.setExtras).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'click', count: 3 })
      );
    });

    it('should not set workspace_id when no claims (line 353 false branch)', async () => {
      store.claims = null;

      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      let capturedScope;
      mockSentry.withScope.mockImplementation((callback) => {
        capturedScope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(capturedScope);
      });

      errorReporting.reportMessage('Test', 'info');

      const tagCalls = capturedScope.setTag.mock.calls;
      const wsTagCall = tagCalls.find((c) => c[0] === 'workspace_id');
      expect(wsTagCall).toBeUndefined();
    });

    it('should handle Sentry errors gracefully in reportMessage (line 363)', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      mockSentry.withScope.mockImplementationOnce(() => {
        throw new Error('Sentry withScope failed');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw
      expect(() => {
        errorReporting.reportMessage('Test', 'error', { module: 'Test' });
      }).not.toThrow();

      // Should log warning about the failure
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to report message to Sentry'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should scrub sensitive data from the message itself', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      // Reset withScope to capture the actual call
      mockSentry.withScope.mockImplementation((callback) => {
        const scope = {
          setLevel: jest.fn(),
          setTag: jest.fn(),
          setExtras: jest.fn(),
          setExtra: jest.fn(),
        };
        callback(scope);
      });

      errorReporting.reportMessage('User auth_token=secret123 expired', 'warning');

      // The message passed to captureMessage should be scrubbed
      expect(mockSentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('[REDACTED]')
      );
      expect(mockSentry.captureMessage).not.toHaveBeenCalledWith(
        expect.stringContaining('secret123')
      );
    });
  });

  // =================================================================
  // scrubObject with arrays via breadcrumb data (line 118 deeper coverage)
  // =================================================================

  describe('scrubObject array path via addBreadcrumb', () => {
    it('should scrub arrays in breadcrumb data (line 118)', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      errorReporting.addBreadcrumb('api', 'Request made', {
        urls: ['https://api.clockify.me/v1/users', 'https://api.clockify.me/v1/entries'],
        headers: ['X-Addon-Token: secret123', 'Content-Type: application/json'],
      });

      expect(mockSentry.addBreadcrumb).toHaveBeenCalled();
      const breadcrumbCall = mockSentry.addBreadcrumb.mock.calls[0][0];
      // headers array should have sensitive values scrubbed
      expect(breadcrumbCall.data.headers[0]).toContain('[REDACTED]');
      expect(breadcrumbCall.data.headers[1]).toBe('Content-Type: application/json');
    });
  });

  // =================================================================
  // addBreadcrumb without data (line 406 false branch of ternary)
  // =================================================================

  describe('addBreadcrumb without data parameter', () => {
    it('should pass undefined for data when not provided (line 406 ternary false)', async () => {
      await errorReporting.initErrorReporting({
        dsn: 'https://test@sentry.io/123',
        environment: 'test',
        release: '1.0.0',
      });

      errorReporting.addBreadcrumb('nav', 'User navigated');

      expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'nav',
          message: 'User navigated',
          data: undefined,
          level: 'info',
        })
      );
    });
  });

  // =================================================================
  // scrubObject with nested arrays containing objects
  // =================================================================

  describe('scrubObject nested structures via beforeSend extra', () => {
    it('should handle deeply nested arrays and objects', async () => {
      const { beforeSend } = await initAndGetCallbacks();

      const event = {
        extra: {
          items: [
            { name: 'safe', apiKey: 'secret' },
            'Bearer token123',
            42,
            null,
            [true, 'password=test'],
          ],
        },
      };

      const result = beforeSend(event);
      // Array of objects with sensitive keys
      expect(result.extra.items[0].apiKey).toBe('[REDACTED]');
      expect(result.extra.items[0].name).toBe('safe');
      // String in array
      expect(result.extra.items[1]).toContain('[REDACTED]');
      // Number in array
      expect(result.extra.items[2]).toBe(42);
      // Null in array
      expect(result.extra.items[3]).toBeNull();
      // Nested array
      expect(result.extra.items[4][0]).toBe(true);
      expect(result.extra.items[4][1]).toContain('[REDACTED]');
    });
  });
});
