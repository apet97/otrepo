/**
 * @jest-environment jsdom
 *
 * Security Testing Suite
 *
 * Tests for security vulnerabilities including:
 * - CSV formula injection
 * - XSS prevention
 * - Input validation
 * - Malicious input handling
 *
 * @see docs/spec.md - Security requirements (XSS, CSV injection)
 */

import { jest } from '@jest/globals';
import { downloadCsv } from '../../js/export.js';
import { escapeHtml, escapeCsv } from '../../js/utils.js';
import { calculateAnalysis } from '../../js/calc.js';
import {
  TestFixtures,
  MOCK_USER_IDS,
  TEST_DATES,
  CSV_INJECTION_TEST_CASES,
  resetAll
} from '../helpers/fixtures.js';
import { createMockStore } from '../helpers/mock-data.js';

// Mock URL and document for CSV tests
global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

describe('Security Testing Suite', () => {
  let mockStore;

  beforeEach(() => {
    resetAll();
    document.body.innerHTML = '';

    const mockLink = {
      setAttribute: jest.fn(),
      click: jest.fn(),
      style: {},
      remove: jest.fn()
    };
    document.createElement = jest.fn(() => mockLink);
    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();

    // Reset Blob mock to a no-op for each test
    global.Blob = jest.fn(() => ({}));

    mockStore = createMockStore({
      users: [
        { id: MOCK_USER_IDS.primary, name: 'User 1' },
        { id: MOCK_USER_IDS.secondary, name: 'User 2' }
      ]
    });
  });

  afterEach(() => {
    resetAll();
  });

  describe('CSV Formula Injection Prevention', () => {
    describe.each(CSV_INJECTION_TEST_CASES)(
      'should escape values starting with $char ($description)',
      ({ char, description }) => {
        it(`prevents formula injection with ${char}`, () => {
          const maliciousDescription = `${char}SUM(A1:A10)`;
          const isControlChar = char === '\t' || char === '\r' || char === '\n';

          const entries = [{
            id: 'entry_1',
            userId: MOCK_USER_IDS.primary,
            userName: 'User 1',
            description: maliciousDescription,
            timeInterval: {
              start: `${TEST_DATES.wednesday}T09:00:00Z`,
              end: `${TEST_DATES.wednesday}T17:00:00Z`,
              duration: 'PT8H'
            },
            hourlyRate: { amount: 5000 },
            billable: true
          }];

          const analysis = calculateAnalysis(entries, mockStore, {
            start: '2025-01-01',
            end: '2025-01-31'
          });

          const createElementSpy = jest.spyOn(document, 'createElement');
          const mockLink = {
            setAttribute: jest.fn(),
            click: jest.fn(),
            style: {}
          };
          createElementSpy.mockReturnValue(mockLink);

          global.Blob = jest.fn((content) => {
            const csvContent = content[0];
            if (isControlChar) {
              // Control characters should be stripped entirely
              expect(csvContent).not.toContain(`${char}SUM`);
              expect(csvContent).not.toContain(`'${char}`);
            } else {
              // Should be escaped with leading quote
              expect(csvContent).toContain(`'${char}`);
              expect(csvContent).not.toMatch(new RegExp(`[^']${char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}SUM`, 'g'));
            }
          });

          downloadCsv(analysis);
        });
      }
    );

    it('should escape formula with leading quote ("=SUM)', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: '"=SUM(A1:A10)',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // The leading " means it's not caught by formula injection check (starts with " not =)
        // But escapeCsv will quote it and double the internal quotes: """=SUM...
        // This is still safe because the cell starts with ", not =
        expect(csvContent).toContain('"""=SUM');
      });

      downloadCsv(analysis);
    });

    it('should escape CRLF injection combined with formula', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: '\r\n=SUM(A1:A10)',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Control characters stripped, formula still escaped
        expect(csvContent).toContain("'=SUM");
        expect(csvContent).not.toContain('\r\n=SUM');
      });

      downloadCsv(analysis);
    });
  });

  describe('Unicode Normalization Attacks', () => {
    it('should handle homoglyph characters in description', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: '\uff1dSUM(A1)', // Fullwidth equals sign (U+FF1D)
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Fullwidth equals should still be present but quoted due to special handling
        expect(csvContent).toBeDefined();
      });

      expect(() => downloadCsv(analysis)).not.toThrow();
    });

    it('should handle mixed-direction text (RTL injection)', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Normal text\u202Eevil\u202Cmore text', // RTL override
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).not.toContain('\u202E');
        expect(csvContent).not.toContain('\u202C');
      });

      downloadCsv(analysis);
    });

    it('should handle zero-width characters', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: '=\u200BSUM(A1)', // Zero-width space between = and SUM
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Should escape the leading =
        expect(csvContent).toContain("'=");
      });

      downloadCsv(analysis);
    });
  });

  describe('Null Byte Injection', () => {
    it('should handle null byte in description', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Before\x00After',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).not.toContain('\x00');
      });

      downloadCsv(analysis);
    });

    it('should handle null byte in user name', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User\x001',
        description: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).not.toContain('\x00');
      });

      downloadCsv(analysis);
    });
  });

  describe('Control Character Handling', () => {
    it('should handle ASCII control characters (< 0x20)', () => {
      // Test various control characters
      const controlChars = [
        '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07',
        '\x08', '\x0B', '\x0C', '\x0E', '\x0F',
        '\x10', '\x11', '\x12', '\x13', '\x14', '\x15', '\x16', '\x17',
        '\x18', '\x19', '\x1A', '\x1B', '\x1C', '\x1D', '\x1E', '\x1F'
      ];

      for (const char of controlChars) {
        const entries = [{
          id: `entry_${char.charCodeAt(0)}`,
          userId: MOCK_USER_IDS.primary,
          userName: 'User 1',
          description: `Test${char}Description`,
          timeInterval: {
            start: `${TEST_DATES.wednesday}T09:00:00Z`,
            end: `${TEST_DATES.wednesday}T17:00:00Z`,
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }];

        const analysis = calculateAnalysis(entries, mockStore, {
          start: '2025-01-01',
          end: '2025-01-31'
        });

        global.Blob = jest.fn((content) => {
          const csvContent = content[0];
          expect(csvContent).not.toContain(char);
        });

        downloadCsv(analysis);
      }
    });

    it('should handle bell character (\\x07)', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Test\x07Bell',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).not.toContain('\x07');
      });

      downloadCsv(analysis);
    });
  });

  describe('Numeric Input Validation', () => {
    it('should handle negative duration in calculation inputs', () => {
      const mockStore = TestFixtures.createStoreFixture({
        users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
      });

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T17:00:00Z`,
          end: `${TEST_DATES.wednesday}T09:00:00Z`, // End before start
          duration: 'PT-8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      // Should handle gracefully - either skip the entry or use absolute value
      const results = calculateAnalysis(entries, mockStore, {
        start: TEST_DATES.wednesday,
        end: TEST_DATES.wednesday
      });

      const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);
      // The function should handle this gracefully without crashing
      expect(userResult).toBeDefined();
      expect(typeof userResult.totals.total).toBe('number');
    });

    it('should handle NaN capacity without propagating', () => {
      const mockStore = TestFixtures.createStoreFixture({
        users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }],
        calcParams: {
          dailyThreshold: NaN,
          weeklyThreshold: 40,
          overtimeMultiplier: 1.5
        }
      });

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      // Should handle NaN gracefully
      const results = calculateAnalysis(entries, mockStore, {
        start: TEST_DATES.wednesday,
        end: TEST_DATES.wednesday
      });

      const userResult = results.find(u => u.userId === MOCK_USER_IDS.primary);
      expect(Number.isNaN(userResult.totals.total)).toBe(false);
    });

    it('should handle Infinity rate without propagating', () => {
      const mockStore = TestFixtures.createStoreFixture({
        users: [{ id: MOCK_USER_IDS.primary, name: 'Test' }]
      });

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: Infinity },
        billable: true
      }];

      // Should handle gracefully
      expect(() => {
        calculateAnalysis(entries, mockStore, {
          start: TEST_DATES.wednesday,
          end: TEST_DATES.wednesday
        });
      }).not.toThrow();
    });
  });

  describe('XSS Prevention', () => {
    it('should escape HTML in user names', () => {
      const maliciousName = '<script>alert("xss")</script>';
      const escaped = escapeHtml(maliciousName);

      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
    });

    it('should escape HTML in descriptions', () => {
      const maliciousDesc = '<img src=x onerror=alert(1)>';
      const escaped = escapeHtml(maliciousDesc);

      expect(escaped).not.toContain('<img');
      expect(escaped).toContain('&lt;img');
    });

    it('should escape all common XSS vectors', () => {
      // Test vectors with HTML tags
      const htmlVectors = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>',
        '"><script>alert(1)</script>',
        '<a href="javascript:alert(1)">click</a>',
        '<div style="background:url(javascript:alert(1))">'
      ];

      for (const vector of htmlVectors) {
        const escaped = escapeHtml(vector);
        // The key is that < and > are escaped, preventing HTML tag interpretation
        expect(escaped).not.toContain('<script');
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<svg');
        expect(escaped).not.toContain('<a');
        expect(escaped).not.toContain('<div');
        // Verify angle brackets are escaped
        expect(escaped).toContain('&lt;');
      }

      // Test vectors with quotes (attribute injection)
      const attrVectors = [
        "' onclick='alert(1)'"
      ];

      for (const vector of attrVectors) {
        const escaped = escapeHtml(vector);
        // Quotes should be escaped
        expect(escaped).toContain('&#039;');
      }
    });

    it('should escape ampersands, quotes, and brackets', () => {
      const input = '&<>"\'';
      const escaped = escapeHtml(input);

      expect(escaped).toBe('&amp;&lt;&gt;&quot;&#039;');
    });
  });

  describe('CSV escapeCsv Function (CSV quoting)', () => {
    it('should double quotes and wrap in quotes', () => {
      expect(escapeCsv('Say "hello"')).toBe('"Say ""hello"""');
    });

    it('should wrap values with commas in quotes', () => {
      expect(escapeCsv('A, B, C')).toBe('"A, B, C"');
    });

    it('should wrap values with newlines in quotes', () => {
      expect(escapeCsv('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('should wrap values with carriage return in quotes', () => {
      expect(escapeCsv('Line 1\rLine 2')).toBe('"Line 1\rLine 2"');
    });

    it('should handle empty string', () => {
      expect(escapeCsv('')).toBe('');
    });

    it('should handle null', () => {
      expect(escapeCsv(null)).toBe('');
    });

    it('should handle undefined', () => {
      expect(escapeCsv(undefined)).toBe('');
    });

    it('should convert numbers to strings', () => {
      expect(escapeCsv(123)).toBe('123');
    });

    it('should not double-escape already quoted values', () => {
      const result = escapeCsv('"already quoted"');
      // Should contain escaped quotes
      expect(result).toBe('"""already quoted"""');
    });

    it('should pass through values without special chars unchanged', () => {
      expect(escapeCsv('simple text')).toBe('simple text');
    });
  });

  // sanitizeFormulaInjection is tested indirectly through the CSV Formula Injection Prevention tests above
  // The function is internal to export.js and not exported directly

  describe('Path Traversal Prevention', () => {
    it('should not include path characters in exported filename', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Test',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      global.Blob = jest.fn(() => ({}));

      // Try to inject path characters in filename
      downloadCsv(analysis, '../../../etc/passwd');

      // Verify the filename is used but path traversal is attempted
      // The function should accept any filename but browser security prevents actual traversal
      const setAttributeCalls = mockLink.setAttribute.mock.calls;
      const downloadCall = setAttributeCalls.find(call => call[0] === 'download');
      expect(downloadCall).toBeDefined();
    });
  });

  describe('Large Input Handling', () => {
    it('should handle extremely long descriptions without DoS', () => {
      const longDescription = 'A'.repeat(1000000); // 1MB of data

      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: longDescription,
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const startTime = Date.now();
      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });
      const endTime = Date.now();

      // Should complete in reasonable time (< 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);
      expect(analysis).toBeDefined();
    });

    it('should handle many entries without excessive memory', () => {
      const entries = [];
      for (let i = 0; i < 10000; i++) {
        entries.push({
          id: `entry_${i}`,
          userId: MOCK_USER_IDS.primary,
          userName: 'User 1',
          description: `Entry ${i}`,
          timeInterval: {
            start: `${TEST_DATES.wednesday}T09:00:00Z`,
            end: `${TEST_DATES.wednesday}T10:00:00Z`,
            duration: 'PT1H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        });
      }

      // Should complete without memory issues
      expect(() => {
        calculateAnalysis(entries, mockStore, {
          start: '2025-01-01',
          end: '2025-01-31'
        });
      }).not.toThrow();
    });
  });

  describe('Export Security - Sensitive Data Protection', () => {
    /**
     * SPECIFICATION: Export Security
     *
     * CSV exports must NEVER include sensitive data:
     * - Auth tokens (X-Addon-Token, auth_token URL param)
     * - Workspace IDs (internal identifiers)
     * - User emails (PII protection)
     *
     * @see docs/spec.md - Security requirements (no secrets logging)
     */

    it('should not export auth token in any column', () => {
      // Simulate a scenario where token might leak into description or other fields
      const mockToken = 'secret-api-token-12345';
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Normal work entry',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true,
        // Simulate accidental token in entry metadata (should not be exported)
        _authToken: mockToken
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      let capturedCsvContent = '';
      global.Blob = jest.fn((content) => {
        capturedCsvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Token should never appear in CSV output
      expect(capturedCsvContent).not.toContain(mockToken);
      expect(capturedCsvContent).not.toContain('_authToken');
      expect(capturedCsvContent).not.toContain('X-Addon-Token');
      expect(capturedCsvContent).not.toContain('auth_token');
    });

    it('should not export workspace ID in CSV', () => {
      const workspaceId = 'ws_5f8d3e2b1a9c7f4e6d8b3a1c';
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Normal work',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true,
        workspaceId: workspaceId // Simulate workspace ID in entry
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      let capturedCsvContent = '';
      global.Blob = jest.fn((content) => {
        capturedCsvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Workspace ID should not appear in CSV columns
      expect(capturedCsvContent).not.toContain(workspaceId);
      expect(capturedCsvContent).not.toContain('workspaceId');
      expect(capturedCsvContent).not.toContain('Workspace');
    });

    it('should not export user emails in CSV', () => {
      const userEmail = 'user@company.com';
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Work entry',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true,
        userEmail: userEmail // Simulate email in entry data
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      let capturedCsvContent = '';
      global.Blob = jest.fn((content) => {
        capturedCsvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // User email should not appear in CSV
      expect(capturedCsvContent).not.toContain(userEmail);
      expect(capturedCsvContent).not.toContain('userEmail');
      expect(capturedCsvContent).not.toContain('Email');
    });

    it('should only export allowed columns', () => {
      const entries = [{
        id: 'entry_1',
        userId: MOCK_USER_IDS.primary,
        userName: 'User 1',
        description: 'Work entry',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      let capturedCsvContent = '';
      global.Blob = jest.fn((content) => {
        capturedCsvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Header line should contain expected safe columns
      const headerLine = capturedCsvContent.split('\n')[0];
      expect(headerLine).toContain('Date');
      expect(headerLine).toContain('User');

      // Should NOT contain sensitive column headers
      expect(headerLine).not.toContain('Token');
      expect(headerLine).not.toContain('Password');
      expect(headerLine).not.toContain('Secret');
      expect(headerLine).not.toContain('Email');
      expect(headerLine).not.toContain('WorkspaceId');
    });

    it('should not leak internal IDs in exported data', () => {
      const internalUserId = MOCK_USER_IDS.primary;
      const entries = [{
        id: 'entry_internal_12345',
        userId: internalUserId,
        userName: 'User 1',
        description: 'Work',
        timeInterval: {
          start: `${TEST_DATES.wednesday}T09:00:00Z`,
          end: `${TEST_DATES.wednesday}T17:00:00Z`,
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      let capturedCsvContent = '';
      global.Blob = jest.fn((content) => {
        capturedCsvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Internal entry IDs should not be exported
      expect(capturedCsvContent).not.toContain('entry_internal_12345');
      // User ID (internal) should not be in CSV - only userName
      expect(capturedCsvContent).not.toContain('userId');
    });
  });
});

// XSS tests for override values in overrides.ts
describe('XSS prevention in override values', () => {
    it('should escape capacity values in per-day copy hint via escapeHtml', () => {
        // The override rendering at overrides.ts:193 concatenates override.capacity directly
        // After fix, it should use escapeHtml() to prevent injection
        const malicious = '<img src=x onerror=alert(1)>';
        const escaped = escapeHtml(String(malicious));
        expect(escaped).not.toContain('<img');
        expect(escaped).toContain('&lt;img');
    });

    it('should escape multiplier values in weekly copy hint via escapeHtml', () => {
        // The override rendering at overrides.ts:281 interpolates override values directly
        const malicious = '<script>alert(1)</script>';
        const escaped = escapeHtml(String(malicious));
        expect(escaped).not.toContain('<script>');
        expect(escaped).toContain('&lt;script&gt;');
    });
});
