/**
 * @jest-environment jsdom
 */

import { jest, afterEach, beforeEach } from '@jest/globals';
import { classifyError, createUserFriendlyError, validateRequiredFields, validateDateRange } from '../../js/utils.js';
import { ERROR_TYPES, ERROR_MESSAGES } from '../../js/constants.js';
import { standardAfterEach, standardBeforeEach } from '../helpers/setup.js';

describe('Error Handling', () => {
  beforeEach(() => {
    standardBeforeEach();
  });

  afterEach(() => {
    standardAfterEach();
  });
  describe('classifyError', () => {
    it('should classify network errors', () => {
      const networkError = new TypeError('Failed to fetch');
      expect(classifyError(networkError)).toBe(ERROR_TYPES.NETWORK);
    });

    it('should classify abort errors', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      expect(classifyError(abortError)).toBe(ERROR_TYPES.NETWORK);
    });

    it('should classify authentication errors (401)', () => {
      const authError = new Error('Unauthorized');
      authError.status = 401;
      expect(classifyError(authError)).toBe(ERROR_TYPES.AUTH);
    });

    it('should classify authentication errors (403)', () => {
      const authError = new Error('Forbidden');
      authError.status = 403;
      expect(classifyError(authError)).toBe(ERROR_TYPES.AUTH);
    });

    it('should classify validation errors (400-499)', () => {
      const validationError = new Error('Bad Request');
      validationError.status = 400;
      expect(classifyError(validationError)).toBe(ERROR_TYPES.VALIDATION);
    });

    it('should classify API errors (500+)', () => {
      const apiError = new Error('Internal Server Error');
      apiError.status = 500;
      expect(classifyError(apiError)).toBe(ERROR_TYPES.API);
    });

    it('should classify unknown errors', () => {
      expect(classifyError(new Error('Unknown'))).toBe(ERROR_TYPES.UNKNOWN);
      expect(classifyError(null)).toBe(ERROR_TYPES.UNKNOWN);
      expect(classifyError(undefined)).toBe(ERROR_TYPES.UNKNOWN);
    });
  });

  describe('createUserFriendlyError', () => {
    it('should create error object with default type', () => {
      const error = new Error('Test error');
      const friendlyError = createUserFriendlyError(error);

      expect(friendlyError).toHaveProperty('type');
      expect(friendlyError).toHaveProperty('title');
      expect(friendlyError).toHaveProperty('message');
      expect(friendlyError).toHaveProperty('action');
      expect(friendlyError).toHaveProperty('originalError');
      expect(friendlyError).toHaveProperty('timestamp');
    });

    it('should use provided error type', () => {
      const error = new Error('Network error');
      const friendlyError = createUserFriendlyError(error, ERROR_TYPES.NETWORK);

      expect(friendlyError.type).toBe(ERROR_TYPES.NETWORK);
      expect(friendlyError.title).toBe(ERROR_MESSAGES[ERROR_TYPES.NETWORK].title);
      expect(friendlyError.message).toBe(ERROR_MESSAGES[ERROR_TYPES.NETWORK].message);
    });

    it('should handle string errors', () => {
      const friendlyError = createUserFriendlyError('String error');

      expect(friendlyError.type).toBe(ERROR_TYPES.UNKNOWN);
      expect(typeof friendlyError.message).toBe('string');
    });

    it('should include original error', () => {
      const originalError = new Error('Original');
      const friendlyError = createUserFriendlyError(originalError);

      expect(friendlyError.originalError).toBe(originalError);
    });

    it('should include timestamp', () => {
      const before = new Date().toISOString();
      const friendlyError = createUserFriendlyError(new Error('Test'));
      const after = new Date().toISOString();

      expect(friendlyError.timestamp).toBeTruthy();
      expect(friendlyError.timestamp >= before).toBe(true);
      expect(friendlyError.timestamp <= after).toBe(true);
    });
  });

  describe('validateRequiredFields', () => {
    it('should validate object with all required fields', () => {
      const obj = { id: '123', name: 'Test' };
      expect(() => validateRequiredFields(obj, ['id', 'name'])).not.toThrow();
    });

    it('should throw for missing required fields', () => {
      const obj = { id: '123' };
      expect(() => validateRequiredFields(obj, ['id', 'name'])).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should throw for null object', () => {
      expect(() => validateRequiredFields(null, ['id'])).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should throw for undefined object', () => {
      expect(() => validateRequiredFields(undefined, ['id'])).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should use custom context in error message', () => {
      const obj = { id: '123' };
      expect(() => validateRequiredFields(obj, ['name'], 'User')).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should throw VALIDATION error type', () => {
      try {
        validateRequiredFields({}, ['id'], 'Test');
        fail('Should have thrown');
      } catch (error) {
        expect(error.type).toBe(ERROR_TYPES.VALIDATION);
      }
    });
  });

  describe('validateDateRange', () => {
    it('should validate correct date range', () => {
      expect(() => validateDateRange('2025-01-01', '2025-01-31')).not.toThrow();
    });

    it('should throw for invalid start date', () => {
      expect(() => validateDateRange('invalid', '2025-01-31')).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should throw for invalid end date', () => {
      expect(() => validateDateRange('2025-01-01', 'invalid')).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should throw when start date is after end date', () => {
      expect(() => validateDateRange('2025-02-01', '2025-01-01')).toThrow(ERROR_MESSAGES[ERROR_TYPES.VALIDATION].message);
    });

    it('should throw VALIDATION error type', () => {
      try {
        validateDateRange('2025-01-01', '2024-01-01');
        fail('Should have thrown');
      } catch (error) {
        expect(error.type).toBe(ERROR_TYPES.VALIDATION);
      }
    });
  });
});
