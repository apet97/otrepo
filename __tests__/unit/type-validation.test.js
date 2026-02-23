/**
 * @jest-environment jsdom
 */

import { jest, beforeEach, afterEach } from '@jest/globals';
import {
  validateTimeEntry,
  validateUser,
  validateUserProfile,
  validateNumber,
  validateString,
  validateISODateString,
  validateRequiredFields
} from '../../js/utils.js';
import { standardAfterEach, standardBeforeEach } from '../helpers/setup.js';

describe('Type Validation', () => {
  beforeEach(() => {
    standardBeforeEach();
  });

  afterEach(() => {
    standardAfterEach();
  });
  describe('validateNumber', () => {
    it('should accept valid numbers', () => {
      expect(validateNumber(5, 'Hours')).toBe(5);
      expect(validateNumber(7.5, 'Rate')).toBe(7.5);
    });

    it('should reject null with descriptive error', () => {
      expect(() => validateNumber(null, 'Hours')).toThrow();
      // Error provides user-friendly validation message
      expect(() => validateNumber(null, 'Hours')).toThrow(/invalid|data|check/i);
    });

    it('should reject undefined with descriptive error', () => {
      expect(() => validateNumber(undefined, 'Hours')).toThrow();
    });

    it('should reject NaN with descriptive error', () => {
      expect(() => validateNumber(NaN, 'Hours')).toThrow();
      expect(() => validateNumber(NaN, 'Rate')).toThrow();
    });

    it('should reject non-numbers with descriptive error', () => {
      expect(() => validateNumber('abc', 'Hours')).toThrow();
      expect(() => validateNumber('abc', 'MyField')).toThrow();
    });
  });

  describe('validateString', () => {
    it('should accept valid strings', () => {
      expect(validateString('hello', 'Name')).toBe('hello');
    });

    it('should trim whitespace', () => {
      expect(validateString('  hello  ', 'Name')).toBe('hello');
    });

    it('should reject null with descriptive error', () => {
      expect(() => validateString(null, 'Name')).toThrow();
      expect(() => validateString(null, 'UserId')).toThrow();
    });

    it('should reject undefined with descriptive error', () => {
      expect(() => validateString(undefined, 'Name')).toThrow();
    });

    it('should reject whitespace-only strings with descriptive error', () => {
      expect(() => validateString('   ', 'Name')).toThrow();
      expect(() => validateString('   ', 'Description')).toThrow();
    });

    it('should reject non-string values with descriptive error', () => {
      expect(() => validateString(123, 'Name')).toThrow();
      expect(() => validateString({}, 'ProjectId')).toThrow();
    });
  });

  describe('validateISODateString', () => {
    it('should accept valid ISO dates', () => {
      expect(validateISODateString('2025-01-01', 'Date')).toBe('2025-01-01');
      expect(validateISODateString('2025-12-31T23:59:59Z', 'Date')).toBe('2025-12-31T23:59:59Z');
    });

    it('should reject invalid date strings with descriptive error', () => {
      expect(() => validateISODateString('invalid', 'Date')).toThrow();
      expect(() => validateISODateString('invalid', 'StartTime')).toThrow();
    });

    it('should reject non-ISO formatted dates with descriptive error', () => {
      expect(() => validateISODateString('01/01/2025', 'Date')).toThrow();
      expect(() => validateISODateString('01/01/2025', 'Date')).toThrow(/invalid|data|format/i);
    });

    it('should reject null with descriptive error', () => {
      expect(() => validateISODateString(null, 'Date')).toThrow();
      expect(() => validateISODateString(null, 'EndDate')).toThrow();
    });
  });

  describe('validateTimeEntry', () => {
    it('should reject null entry', () => {
      expect(() => validateTimeEntry(null)).toThrow();
    });

    it('should reject non-object entry', () => {
      expect(() => validateTimeEntry('not an object')).toThrow();
      expect(() => validateTimeEntry(123)).toThrow();
      expect(() => validateTimeEntry(undefined)).toThrow();
    });

    it('should accept valid time entries', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(validateTimeEntry(entry)).toBe(true);
    });

    it('should accept with all optional fields', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        userName: 'John Doe',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true,
        description: 'Worked on project'
      };
      expect(validateTimeEntry(entry)).toBe(true);
    });

    it('should reject missing ID', () => {
      const entry = {
        userId: 'user1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject missing userId', () => {
      const entry = {
        id: 'entry1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject missing timeInterval', () => {
      const entry = { id: 'entry1', userId: 'user1' };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject invalid start time', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        timeInterval: {
          start: 'invalid',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject billable as non-boolean', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        },
        billable: 'yes'
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });
  });

  describe('validateUser', () => {
    it('should accept valid users', () => {
      const user = {
        id: 'user1',
        name: 'John Doe'
      };
      expect(validateUser(user)).toBe(true);
    });

    it('should accept with email', () => {
      const user = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      };
      expect(validateUser(user)).toBe(true);
    });

    it('should reject missing ID', () => {
      const user = { name: 'John Doe' };
      expect(() => validateUser(user)).toThrow();
    });

    it('should reject missing name', () => {
      const user = { id: 'user1' };
      expect(() => validateUser(user)).toThrow();
    });
  });

  describe('validateUserProfile', () => {
    it('should accept minimal profile', () => {
      const profile = {};
      expect(validateUserProfile(profile)).toBe(true);
    });

    it('should accept profile with workCapacity', () => {
      const profile = { workCapacity: 'PT8H' };
      expect(validateUserProfile(profile)).toBe(true);
    });

    it('should accept profile with workingDays', () => {
      const profile = {
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY']
      };
      expect(validateUserProfile(profile)).toBe(true);
    });

    it('should reject workingDays as non-array', () => {
      const profile = { workingDays: 'MONDAY' };
      expect(() => validateUserProfile(profile)).toThrow();
    });

    it('should reject workingDays with non-string elements', () => {
      const profile = { workingDays: ['MONDAY', 123] };
      expect(() => validateUserProfile(profile)).toThrow();
    });
  });
});
