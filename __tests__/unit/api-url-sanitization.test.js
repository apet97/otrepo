/**
 * @jest-environment jsdom
 */

/**
 * URL Sanitization Tests for Error Log Privacy
 *
 * Tests the sanitizeUrlForLogging() function that removes sensitive
 * identifiers from URLs before they are logged to console or error tracking.
 *
 * This prevents information disclosure of:
 * - Workspace IDs
 * - User IDs
 * - Member profile IDs
 * - Any UUID-format identifiers
 * - Clockify MongoDB ObjectIds (24-character hex strings)
 *
 * @see js/api.ts - sanitizeUrlForLogging implementation
 * @see docs/TROUBLESHOOTING.md - Privacy-safe logging guidelines
 */

import { describe, it, expect } from '@jest/globals';
import { sanitizeUrlForLogging } from '../../js/api.js';

describe('URL Sanitization for Logging', () => {
  describe('Workspace ID Sanitization', () => {
    it('should sanitize workspace IDs in path', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/abc123def456/users';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/users');
      expect(sanitized).not.toContain('abc123def456');
    });

    it('should sanitize UUID-format workspace IDs', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/550e8400-e29b-41d4-a716-446655440000/users';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/users');
      expect(sanitized).not.toContain('550e8400');
    });

    it('should sanitize 24-character hex workspace IDs (MongoDB ObjectId)', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/5e7b8c9d0f1a2b3c4d5e6f7a/users';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/users');
      expect(sanitized).not.toContain('5e7b8c9d0f1a2b3c4d5e6f7a');
    });
  });

  describe('User ID Sanitization', () => {
    it('should sanitize user IDs in /user/{id} paths', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/user/user456/time-entries';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/user/[REDACTED]/time-entries');
      expect(sanitized).not.toContain('user456');
    });

    it('should sanitize user IDs in /users/{id} paths', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/users/user456';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/users/[REDACTED]');
      expect(sanitized).not.toContain('user456');
    });

    it('should not sanitize /users endpoint without ID', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/users';
      const sanitized = sanitizeUrlForLogging(url);

      // /users without an ID should stay as /users
      expect(sanitized).toContain('/users');
      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/users');
    });
  });

  describe('Member Profile ID Sanitization', () => {
    it('should sanitize member-profile IDs', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/member-profile/profile789';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/member-profile/[REDACTED]');
      expect(sanitized).not.toContain('profile789');
    });
  });

  describe('Query Parameter Sanitization', () => {
    it('should sanitize assigned-to query parameter', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/holidays?assigned-to=user456&start=2025-01-01';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('assigned-to=[REDACTED]');
      expect(sanitized).not.toContain('user456');
      // Should preserve other query params
      expect(sanitized).toContain('start=2025-01-01');
    });

    it('should sanitize userId query parameter', () => {
      const url = 'https://api.clockify.me/api/reports?userId=abc123&page=1';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('userId=[REDACTED]');
      expect(sanitized).not.toContain('abc123');
      expect(sanitized).toContain('page=1');
    });

    it('should sanitize workspaceId query parameter', () => {
      const url = 'https://api.clockify.me/api/reports?workspaceId=ws789';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('workspaceId=[REDACTED]');
      expect(sanitized).not.toContain('ws789');
    });

    it('should sanitize user query parameter', () => {
      const url = 'https://api.clockify.me/api/reports?user=john_doe_123';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('user=[REDACTED]');
      expect(sanitized).not.toContain('john_doe_123');
    });

    it('should handle multiple sensitive query parameters', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/holidays?assigned-to=user456&userId=user789';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('assigned-to=[REDACTED]');
      expect(sanitized).toContain('userId=[REDACTED]');
      expect(sanitized).not.toContain('user456');
      expect(sanitized).not.toContain('user789');
    });
  });

  describe('UUID Pattern Matching', () => {
    it('should sanitize standard UUIDs in paths', () => {
      const url = 'https://api.clockify.me/api/v1/resource/550e8400-e29b-41d4-a716-446655440000';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('550e8400-e29b-41d4-a716-446655440000');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should sanitize multiple UUIDs in one URL', () => {
      const url = 'https://api.example.com/a/550e8400-e29b-41d4-a716-446655440000/b/660f9500-f39c-52e5-b827-557766551111';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('550e8400');
      expect(sanitized).not.toContain('660f9500');
    });

    it('should be case-insensitive for UUIDs', () => {
      const url = 'https://api.clockify.me/api/v1/resource/550E8400-E29B-41D4-A716-446655440000';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('550E8400');
    });
  });

  describe('MongoDB ObjectId Pattern Matching', () => {
    it('should sanitize 24-character hex IDs in path segments', () => {
      const url = 'https://api.clockify.me/api/v1/items/5e7b8c9d0f1a2b3c4d5e6f7a/details';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('5e7b8c9d0f1a2b3c4d5e6f7a');
    });

    it('should sanitize hex IDs at end of path', () => {
      const url = 'https://api.clockify.me/api/v1/items/5e7b8c9d0f1a2b3c4d5e6f7a';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('5e7b8c9d0f1a2b3c4d5e6f7a');
    });

    it('should sanitize hex IDs before query string', () => {
      const url = 'https://api.clockify.me/api/v1/items/5e7b8c9d0f1a2b3c4d5e6f7a?page=1';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('5e7b8c9d0f1a2b3c4d5e6f7a');
      expect(sanitized).toContain('page=1');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const sanitized = sanitizeUrlForLogging('');
      expect(sanitized).toBe('');
    });

    it('should handle null/undefined gracefully', () => {
      expect(sanitizeUrlForLogging(null)).toBe(null);
      expect(sanitizeUrlForLogging(undefined)).toBe(undefined);
    });

    it('should handle URL with no sensitive data', () => {
      const url = 'https://api.clockify.me/api/v1/health';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/health');
    });

    it('should preserve protocol and host', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/users';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('https://api.clockify.me');
    });

    it('should handle regional URLs', () => {
      const url = 'https://eu.api.clockify.me/api/v1/workspaces/ws_eu_123/users/user_eu_456';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('https://eu.api.clockify.me');
      expect(sanitized).not.toContain('ws_eu_123');
      expect(sanitized).not.toContain('user_eu_456');
    });

    it('should handle developer portal URLs', () => {
      const url = 'https://developer.clockify.me/api/v1/workspaces/dev_ws_123/reports';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toContain('https://developer.clockify.me');
      expect(sanitized).not.toContain('dev_ws_123');
    });

    it('should handle reports API URLs', () => {
      const url = 'https://reports.api.clockify.me/v1/workspaces/ws123/reports/detailed';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://reports.api.clockify.me/v1/workspaces/[REDACTED]/reports/detailed');
    });
  });

  describe('Real-world URL Patterns', () => {
    it('should sanitize time entries fetch URL', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/5e7b8c9d0f1a2b3c4d5e6f7a/user/6f8c9d0e1a2b3c4d5e6f7a8b/time-entries?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z&hydrated=true&page=1&page-size=500';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('5e7b8c9d0f1a2b3c4d5e6f7a');
      expect(sanitized).not.toContain('6f8c9d0e1a2b3c4d5e6f7a8b');
      expect(sanitized).toContain('start=2025-01-01');
      expect(sanitized).toContain('page=1');
      expect(sanitized).toContain('page-size=500');
    });

    it('should sanitize holidays fetch URL', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/holidays/in-period?assigned-to=user456&start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).not.toContain('ws123');
      expect(sanitized).not.toContain('user456');
      expect(sanitized).toContain('holidays/in-period');
      expect(sanitized).toContain('assigned-to=[REDACTED]');
    });

    it('should sanitize member profile fetch URL', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/550e8400-e29b-41d4-a716-446655440000/member-profile/660f9500-f39c-52e5-b827-557766551111';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://api.clockify.me/api/v1/workspaces/[REDACTED]/member-profile/[REDACTED]');
    });

    it('should sanitize detailed report URL', () => {
      const url = 'https://reports.api.clockify.me/v1/workspaces/abc123xyz789/reports/detailed';
      const sanitized = sanitizeUrlForLogging(url);

      expect(sanitized).toBe('https://reports.api.clockify.me/v1/workspaces/[REDACTED]/reports/detailed');
    });
  });

  describe('Security Verification', () => {
    it('should not leak any 24+ character alphanumeric IDs', () => {
      const sensitiveIds = [
        'abc123def456ghi789jkl012',
        '5e7b8c9d0f1a2b3c4d5e6f7a',
        '550e8400e29b41d4a716446655440000',
      ];

      sensitiveIds.forEach(id => {
        const url = `https://api.clockify.me/api/v1/workspaces/${id}/users`;
        const sanitized = sanitizeUrlForLogging(url);
        expect(sanitized).not.toContain(id);
      });
    });

    it('should preserve readability for debugging', () => {
      const url = 'https://api.clockify.me/api/v1/workspaces/ws123/users/user456/time-entries';
      const sanitized = sanitizeUrlForLogging(url);

      // Should still show the URL structure clearly
      expect(sanitized).toContain('/workspaces/');
      expect(sanitized).toContain('/users/');
      expect(sanitized).toContain('/time-entries');
    });
  });
});
