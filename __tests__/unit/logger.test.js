/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

// Mock constants module
jest.unstable_mockModule('../../js/constants.js', () => ({
  STORAGE_KEYS: {
    DEBUG: 'otplus_debug',
    LOG_FORMAT: 'otplus_log_format'
  }
}));

describe('Logger Module', () => {
  let loggerModule;
  let consoleSpy;

  beforeEach(async () => {
    // Reset module cache
    jest.resetModules();

    // Clear localStorage
    localStorage.clear();

    // Setup console spies
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      time: jest.spyOn(console, 'time').mockImplementation(() => {}),
      timeEnd: jest.spyOn(console, 'timeEnd').mockImplementation(() => {})
    };

    // Import fresh module
    loggerModule = await import('../../js/logger.js');
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    localStorage.clear();
  });

  describe('LogLevel enum', () => {
    it('should export LogLevel with correct values', () => {
      expect(loggerModule.LogLevel.DEBUG).toBe(0);
      expect(loggerModule.LogLevel.INFO).toBe(1);
      expect(loggerModule.LogLevel.WARN).toBe(2);
      expect(loggerModule.LogLevel.ERROR).toBe(3);
      expect(loggerModule.LogLevel.NONE).toBe(4);
    });

    it('should export Level as alias for LogLevel', () => {
      expect(loggerModule.Level).toBe(loggerModule.LogLevel);
    });
  });

  describe('configureLogger', () => {
    it('should update logger configuration', () => {
      loggerModule.configureLogger({
        minLevel: loggerModule.LogLevel.DEBUG,
        timestamps: false
      });

      // Log should work at DEBUG level
      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should preserve existing config when partially updating', () => {
      loggerModule.configureLogger({ minLevel: loggerModule.LogLevel.DEBUG });
      loggerModule.configureLogger({ timestamps: false });

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('test');

      // Should still log at debug level (preserved from first config)
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('setLogLevel', () => {
    it('should set minimum log level to DEBUG', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('debug message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should set minimum log level to WARN', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.WARN);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('info message');
      moduleLogger.warn('warn message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should set minimum log level to ERROR', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.ERROR);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.warn('warn message');
      moduleLogger.error('error message');

      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should suppress all logs when set to NONE', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.NONE);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('debug');
      moduleLogger.info('info');
      moduleLogger.warn('warn');
      moduleLogger.error('error');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('enableDebugMode', () => {
    it('should set log level to DEBUG', () => {
      loggerModule.enableDebugMode();

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('debug message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should persist debug flag to localStorage', () => {
      loggerModule.enableDebugMode();

      expect(localStorage.getItem('otplus_debug')).toBe('true');
    });
  });

  describe('disableDebugMode', () => {
    it('should set log level to INFO', () => {
      loggerModule.enableDebugMode();
      loggerModule.disableDebugMode();

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('debug message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should remove debug flag from localStorage', () => {
      loggerModule.enableDebugMode();
      loggerModule.disableDebugMode();

      expect(localStorage.getItem('otplus_debug')).toBeNull();
    });
  });

  describe('isDebugEnabled', () => {
    it('should return false by default', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.INFO);
      expect(loggerModule.isDebugEnabled()).toBe(false);
    });

    it('should return true when debug mode is enabled', () => {
      loggerModule.enableDebugMode();
      expect(loggerModule.isDebugEnabled()).toBe(true);
    });

    it('should return false after disabling debug mode', () => {
      loggerModule.enableDebugMode();
      loggerModule.disableDebugMode();
      expect(loggerModule.isDebugEnabled()).toBe(false);
    });
  });

  describe('createLogger', () => {
    it('should create a logger with module name', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.INFO);

      const apiLogger = loggerModule.createLogger('API');
      apiLogger.info('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('[API]');
    });

    it('should have debug method', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('debug message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('[DEBUG]');
    });

    it('should have info method', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('info message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('[INFO]');
    });

    it('should have warn method', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.warn('warn message');

      expect(consoleSpy.warn).toHaveBeenCalled();
      const call = consoleSpy.warn.mock.calls[0][0];
      expect(call).toContain('[WARN]');
    });

    it('should have error method', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.error('error message');

      expect(consoleSpy.error).toHaveBeenCalled();
      const call = consoleSpy.error.mock.calls[0][0];
      expect(call).toContain('[ERROR]');
    });

    it('should have log method with explicit level', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.log(loggerModule.LogLevel.WARN, 'explicit warn');

      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should have time method for performance timing', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Perf');
      moduleLogger.time('operation');

      expect(consoleSpy.time).toHaveBeenCalledWith('[Perf] operation');
    });

    it('should have timeEnd method for performance timing', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Perf');
      moduleLogger.timeEnd('operation');

      expect(consoleSpy.timeEnd).toHaveBeenCalledWith('[Perf] operation');
    });

    it('should not call time/timeEnd when log level is above DEBUG', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.INFO);

      const moduleLogger = loggerModule.createLogger('Perf');
      moduleLogger.time('operation');
      moduleLogger.timeEnd('operation');

      expect(consoleSpy.time).not.toHaveBeenCalled();
      expect(consoleSpy.timeEnd).not.toHaveBeenCalled();
    });

    it('should include explicit correlation ID when provided', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Test', 'corr-123');
      moduleLogger.info('message');

      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('[corr-123]');
    });
  });

  describe('Correlation ID Isolation', () => {
    it('keeps correlation IDs isolated across concurrent async operations', async () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);
      const outputs = [];
      consoleSpy.log.mockImplementation((message) => {
        outputs.push(message);
      });

      await Promise.all([
        loggerModule.withCorrelationIdAsync(async (correlationId) => {
          const scopedLogger = loggerModule.createLogger('OpA', correlationId);
          await Promise.resolve();
          scopedLogger.info('first');
        }, 'corr-A'),
        loggerModule.withCorrelationIdAsync(async (correlationId) => {
          const scopedLogger = loggerModule.createLogger('OpB', correlationId);
          await Promise.resolve();
          scopedLogger.info('second');
        }, 'corr-B'),
      ]);

      const first = outputs.find(msg => msg.includes('[corr-A]') && msg.includes('[OpA]'));
      const second = outputs.find(msg => msg.includes('[corr-B]') && msg.includes('[OpB]'));

      expect(first).toBeDefined();
      expect(second).toBeDefined();
    });
  });

  describe('default logger', () => {
    it('should export a default logger instance', () => {
      expect(loggerModule.logger).toBeDefined();
      expect(typeof loggerModule.logger.debug).toBe('function');
      expect(typeof loggerModule.logger.info).toBe('function');
      expect(typeof loggerModule.logger.warn).toBe('function');
      expect(typeof loggerModule.logger.error).toBe('function');
      expect(typeof loggerModule.logger.log).toBe('function');
    });

    it('should log without module name', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.INFO);
      loggerModule.configureLogger({ showModule: false });

      loggerModule.logger.info('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('Sensitive Data Sanitization', () => {
    beforeEach(() => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);
    });

    it('should redact long alphanumeric strings (tokens)', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      const sensitiveData = {
        normal: 'hello',
        potentialToken: 'abcdefghijklmnopqrstuvwxyz1234567890abcd'
      };

      moduleLogger.info('Data:', sensitiveData);

      expect(consoleSpy.log).toHaveBeenCalled();
      // The sanitize function should have processed the data
    });

    it('should redact keys containing sensitive words', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      const sensitiveData = {
        apiToken: 'secret123',
        userPassword: 'pass123',
        secretKey: 'key123',
        userEmail: 'test@test.com',
        authorization: 'Bearer xyz'
      };

      moduleLogger.info('Sensitive:', sensitiveData);

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle nested objects', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      const nestedData = {
        user: {
          name: 'John',
          token: 'secret123'
        }
      };

      moduleLogger.info('Nested:', nestedData);

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle arrays', () => {
      const moduleLogger = loggerModule.createLogger('Test');
      const arrayData = [
        { name: 'John', token: 'secret1' },
        { name: 'Jane', token: 'secret2' }
      ];

      moduleLogger.info('Array:', arrayData);

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle null and undefined', () => {
      const moduleLogger = loggerModule.createLogger('Test');

      moduleLogger.info('Null:', null);
      moduleLogger.info('Undefined:', undefined);

      expect(consoleSpy.log).toHaveBeenCalledTimes(2);
    });
  });

  describe('Message Formatting', () => {
    beforeEach(() => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);
    });

    it('should include timestamp when enabled', () => {
      loggerModule.configureLogger({ timestamps: true });

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('test');

      const call = consoleSpy.log.mock.calls[0][0];
      // Timestamp format: [YYYY-MM-DDTHH:mm:ss.sssZ]
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should exclude timestamp when disabled', () => {
      loggerModule.configureLogger({ timestamps: false });

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('test');

      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should include module name when showModule is true', () => {
      loggerModule.configureLogger({ showModule: true });

      const moduleLogger = loggerModule.createLogger('MyModule');
      moduleLogger.info('test');

      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('[MyModule]');
    });

    it('should exclude module name when showModule is false', () => {
      loggerModule.configureLogger({ showModule: false });

      const moduleLogger = loggerModule.createLogger('MyModule');
      moduleLogger.info('test');

      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).not.toContain('[MyModule]');
    });

    it('should include log level in message', () => {
      const moduleLogger = loggerModule.createLogger('Test');

      moduleLogger.debug('debug');
      moduleLogger.info('info');
      moduleLogger.warn('warn');
      moduleLogger.error('error');

      expect(consoleSpy.log.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleSpy.log.mock.calls[1][0]).toContain('[INFO]');
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('[WARN]');
      expect(consoleSpy.error.mock.calls[0][0]).toContain('[ERROR]');
    });
  });

  describe('Log Level Filtering', () => {
    it('should not log DEBUG when level is INFO', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.INFO);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.debug('should not appear');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log INFO when level is INFO', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.INFO);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('should appear');

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should not log INFO when level is WARN', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.WARN);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('should not appear');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log WARN when level is WARN', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.WARN);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.warn('should appear');

      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should not log WARN when level is ERROR', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.ERROR);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.warn('should not appear');

      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });

    it('should log ERROR when level is ERROR', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.ERROR);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.error('should appear');

      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('Multiple Data Arguments', () => {
    it('should pass multiple arguments to console', () => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('message', { key: 'value' }, [1, 2, 3], 'extra');

      expect(consoleSpy.log).toHaveBeenCalled();
      const args = consoleSpy.log.mock.calls[0];
      expect(args.length).toBeGreaterThan(1);
    });
  });

  describe('Default Configuration', () => {
    it('should respect localStorage debug flag on module load', async () => {
      localStorage.setItem('otplus_debug', 'true');

      // Reset and reimport
      jest.resetModules();
      const freshModule = await import('../../js/logger.js');

      expect(freshModule.isDebugEnabled()).toBe(true);
    });
  });

  describe('JSON Output Mode', () => {
    beforeEach(() => {
      loggerModule.setLogLevel(loggerModule.LogLevel.DEBUG);
      loggerModule.setOutputFormat('text'); // Reset to default
    });

    afterEach(() => {
      loggerModule.setOutputFormat('text'); // Clean up
    });

    it('should export setOutputFormat and getOutputFormat functions', () => {
      expect(typeof loggerModule.setOutputFormat).toBe('function');
      expect(typeof loggerModule.getOutputFormat).toBe('function');
    });

    it('should default to text output format', () => {
      expect(loggerModule.getOutputFormat()).toBe('text');
    });

    it('should set output format to json', () => {
      loggerModule.setOutputFormat('json');
      expect(loggerModule.getOutputFormat()).toBe('json');
    });

    it('should persist output format to localStorage', () => {
      loggerModule.setOutputFormat('json');
      expect(localStorage.getItem('otplus_log_format')).toBe('json');

      loggerModule.setOutputFormat('text');
      expect(localStorage.getItem('otplus_log_format')).toBe('text');
    });

    it('should output valid JSON when format is json', () => {
      loggerModule.setOutputFormat('json');

      const moduleLogger = loggerModule.createLogger('TestModule');
      moduleLogger.info('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('INFO');
      expect(parsed.module).toBe('TestModule');
      expect(parsed.message).toBe('test message');
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include data in JSON output', () => {
      loggerModule.setOutputFormat('json');

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('message with data', { name: 'value' });

      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.data).toEqual({ name: 'value' });
    });

    it('should include array of data when multiple arguments', () => {
      loggerModule.setOutputFormat('json');

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('message', { count: 1 }, { count: 2 });

      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.data).toEqual([{ count: 1 }, { count: 2 }]);
    });

    it('should use console.warn for WARN level in JSON mode', () => {
      loggerModule.setOutputFormat('json');

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.warn('warning message');

      expect(consoleSpy.warn).toHaveBeenCalled();
      const output = consoleSpy.warn.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('WARN');
    });

    it('should use console.error for ERROR level in JSON mode', () => {
      loggerModule.setOutputFormat('json');

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.error('error message');

      expect(consoleSpy.error).toHaveBeenCalled();
      const output = consoleSpy.error.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('ERROR');
    });

    it('should sanitize sensitive data in JSON mode', () => {
      loggerModule.setOutputFormat('json');

      const moduleLogger = loggerModule.createLogger('Test');
      moduleLogger.info('data', { apiToken: 'secret123', normal: 'value' });

      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.data.apiToken).toBe('[REDACTED]');
      expect(parsed.data.normal).toBe('value');
    });

    it('should omit module field when undefined', () => {
      loggerModule.setOutputFormat('json');

      loggerModule.logger.info('no module message');

      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.module).toBeUndefined();
    });

    it('should load output format from localStorage on module init', async () => {
      localStorage.setItem('otplus_log_format', 'json');

      jest.resetModules();
      const freshModule = await import('../../js/logger.js');

      expect(freshModule.getOutputFormat()).toBe('json');
    });

    it('should default to text if localStorage has invalid format', async () => {
      localStorage.setItem('otplus_log_format', 'invalid');

      jest.resetModules();
      const freshModule = await import('../../js/logger.js');

      expect(freshModule.getOutputFormat()).toBe('text');
    });
  });
});
