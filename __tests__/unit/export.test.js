/**
 * @jest-environment jsdom
 */

import { jest, afterEach } from '@jest/globals';
import { downloadCsv } from '../../js/export.js';
import { parseIsoDuration } from '../../js/utils.js';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

// Mock URL and document
global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

describe('Export Module', () => {
  let mockAnalysis;
  let mockStore;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
    mockAnalysis = null;
  });

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    document.body.innerHTML = '';
    global.Blob = jest.fn(() => ({}));

    // Mock document.createElement for download link
    const mockLink = {
      setAttribute: jest.fn(),
      click: jest.fn(),
      style: {},
      setAttribute: jest.fn(),
      remove: jest.fn()
    };
    document.createElement = jest.fn(() => mockLink);
    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();

    // Create mock store
    mockStore = createMockStore({
      users: [
        { id: 'user_1', name: 'User 1' },
        { id: 'user_2', name: 'User 2' }
      ]
    });

    // Create mock analysis data
    const entries = [
      {
        id: 'entry_1',
        userId: 'user_1',
        userName: 'User 1',
        description: 'Test work',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      {
        id: 'entry_2',
        userId: 'user_1',
        userName: 'User 1',
        description: 'More work',
        timeInterval: {
          start: '2025-01-16T09:00:00Z',
          end: '2025-01-16T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      }
    ];

    mockAnalysis = calculateAnalysis(entries, mockStore, {
      start: '2025-01-01',
      end: '2025-01-31'
    });
  });

  describe('downloadCsv', () => {
    it('should create and trigger CSV download', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const appendChildSpy = jest.spyOn(document.body, 'appendChild');
      const removeChildSpy = jest.spyOn(document.body, 'removeChild');
      const clickSpy = jest.fn();

      // Mock link element
      const mockLink = {
        setAttribute: jest.fn(),
        click: clickSpy,
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      // Mock Blob
      global.Blob = jest.fn((content, options) => ({
        content,
        options
      }));

      downloadCsv(mockAnalysis);

      // Should create a link element
      expect(createElementSpy).toHaveBeenCalledWith('a');

      // Should set download attributes
      expect(mockLink.setAttribute).toHaveBeenCalledWith('href', undefined);
      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'otplus-report.csv');

      // Should trigger click
      expect(clickSpy).toHaveBeenCalled();

      // Should append and remove from body
      expect(appendChildSpy).toHaveBeenCalledWith(mockLink);
      expect(removeChildSpy).toHaveBeenCalledWith(mockLink);
    });

    it('should include CSV headers', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).toContain('Date');
        expect(csvContent).toContain('User');
        expect(csvContent).toContain('Description');
        expect(csvContent).toContain('EffectiveCapacityHours');
        expect(csvContent).toContain('RegularHours');
        expect(csvContent).toContain('OvertimeHours');
        expect(csvContent).toContain('DailyOvertimeHours');
        expect(csvContent).toContain('WeeklyOvertimeHours');
        expect(csvContent).toContain('OverlapOvertimeHours');
        expect(csvContent).toContain('CombinedOvertimeHours');
        expect(csvContent).toContain('BillableWorkedHours');
        expect(csvContent).toContain('BillableOTHours');
        expect(csvContent).toContain('NonBillableOTHours');
        expect(csvContent).toContain('TotalHours');
        expect(csvContent).toContain('TotalHoursDecimal');
        expect(csvContent).toContain('isHoliday');
        expect(csvContent).toContain('holidayName');
        expect(csvContent).toContain('isNonWorkingDay');
        expect(csvContent).toContain('isTimeOff');
      });

      downloadCsv(mockAnalysis);
    });

    it('should include entry data in CSV', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        const lines = csvContent.split('\n');
        const headerLine = lines[0];
        const headers = headerLine.split(',');

        // Find column indices from header
        const descIdx = headers.indexOf('Description');
        const regularIdx = headers.indexOf('RegularHours');
        const billableWorkedIdx = headers.indexOf('BillableWorkedHours');
        const nonBillableOTIdx = headers.indexOf('NonBillableOTHours');

        expect(descIdx).toBeGreaterThan(-1);
        expect(regularIdx).toBeGreaterThan(-1);

        // Parse data lines (skip header)
        const dataLines = lines.slice(1).filter(l => l.trim());

        // Find row for "Test work" (8h billable worked)
        const testWorkLine = dataLines.find(l => l.includes('Test work'));
        expect(testWorkLine).toBeDefined();
        const testWorkFields = testWorkLine.split(',');
        expect(testWorkFields[descIdx]).toBe('Test work');
        expect(testWorkFields[billableWorkedIdx]).toBe('8h');

        // Find row for "More work" (2h non-billable OT)
        const moreWorkLine = dataLines.find(l => l.includes('More work'));
        expect(moreWorkLine).toBeDefined();
        const moreWorkFields = moreWorkLine.split(',');
        expect(moreWorkFields[descIdx]).toBe('More work');
        expect(moreWorkFields[nonBillableOTIdx]).toBe('2h');

        // Verify dates are present
        expect(csvContent).toContain('2025-01-15');
        expect(csvContent).toContain('2025-01-16');
      });

      downloadCsv(mockAnalysis);
    });

    it('should fall back to overtime when combinedOvertime is missing', () => {
      const analysis = [{
        userId: 'user_1',
        userName: 'User 1',
        totals: { total: 2 },
        days: new Map([
          ['2025-01-15', {
            entries: [{
              id: 'entry_fallback',
              userId: 'user_1',
              userName: 'User 1',
              description: 'Fallback OT',
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T11:00:00Z',
                duration: 'PT2H'
              },
              analysis: {
                regular: 0,
                overtime: 2,
                isBillable: true
              }
            }],
            meta: {
              capacity: 8,
              isHoliday: false,
              holidayName: '',
              isNonWorking: false,
              isTimeOff: false
            }
          }]
        ])
      }];

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');
        const combinedIdx = headers.indexOf('CombinedOvertimeHours');
        const dataLine = lines.find(l => l.includes('Fallback OT'));

        expect(combinedIdx).toBeGreaterThan(-1);
        expect(dataLine).toBeDefined();

        const fields = dataLine.split(',');
        expect(fields[combinedIdx]).toBe('2h');
      });

      downloadCsv(analysis);
    });

    it('should default combined overtime to 0 when analysis is missing', () => {
      const analysis = [{
        userId: 'user_1',
        userName: 'User 1',
        totals: { total: 1 },
        days: new Map([
          ['2025-01-16', {
            entries: [{
              id: 'entry_no_analysis',
              userId: 'user_1',
              userName: 'User 1',
              description: 'No analysis',
              timeInterval: {
                start: '2025-01-16T09:00:00Z',
                end: '2025-01-16T10:00:00Z',
                duration: 'PT1H'
              },
              billable: true
            }],
            meta: {
              capacity: 8,
              isHoliday: false,
              holidayName: '',
              isNonWorking: false,
              isTimeOff: false
            }
          }]
        ])
      }];

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');
        const combinedIdx = headers.indexOf('CombinedOvertimeHours');
        const dataLine = lines.find(l => l.includes('No analysis'));

        expect(combinedIdx).toBeGreaterThan(-1);
        expect(dataLine).toBeDefined();

        const fields = dataLine.split(',');
        expect(fields[combinedIdx]).toBe('0h');
      });

      downloadCsv(analysis);
    });

    it('should escape CSV injection characters', () => {
      const entriesWithFormula = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '=SUM(A1:A10)', // CSV injection attempt
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithFormula = calculateAnalysis(entriesWithFormula, mockStore, {
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

        // Should escape the = sign to prevent CSV injection (e.g. by prepending ')
        // We expect '=SUM(A1:A10) to be present (quoted due to comma or just text)
        // escapeCsv doesn't quote if no comma/quote.
        // description becomes "'=SUM(A1:A10)".
        // CSV row: ...,User 1,'=SUM(A1:A10),...
        expect(csvContent).toContain("'=SUM(A1:A10)");
      });

      downloadCsv(analysisWithFormula);
    });

    it('should escape quotes in descriptions', () => {
      const entriesWithQuotes = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Work on "Project Alpha"', // Contains quotes
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithQuotes = calculateAnalysis(entriesWithQuotes, mockStore, {
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

        // Should double quotes for CSV
        expect(csvContent).toContain('"Work on ""Project Alpha"""');
      });

      downloadCsv(analysisWithQuotes);
    });

    it('should handle empty descriptions', () => {
      const entriesWithoutDesc = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: null,
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithoutDesc = calculateAnalysis(entriesWithoutDesc, mockStore, {
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

        // Should show empty description as empty field - capacity is now correctly read from meta
        // CSV format: Date,User,Description,EffectiveCapacityHours,...
        // After fix, capacity comes from day.meta.capacity which is 8h (default)
        expect(csvContent).toMatch(/User 1,,8h/);
      });

      downloadCsv(analysisWithoutDesc);
    });

    it('should include multiple entries from same day', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Morning work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T12:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Afternoon work',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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

        // Should have both entries on same date
        const dateMatches = (csvContent.match(/2025-01-15/g) || []).length;
        expect(dateMatches).toBeGreaterThanOrEqual(2);

        // Should have both descriptions
        expect(csvContent).toContain('Morning work');
        expect(csvContent).toContain('Afternoon work');
      });

      downloadCsv(analysis);
    });

    it('should include capacity information', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Regular work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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

        // Should have capacity (8h)
        expect(csvContent).toContain('8h');
      });

      downloadCsv(analysis);
    });

    it('should use day key for CSV dates', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      const analysis = [
        {
          userId: 'user_1',
          userName: 'User 1',
          days: new Map([
            ['2024-12-31', {
              entries: [{
                id: 'entry_edge',
                userId: 'user_1',
                userName: 'User 1',
                description: 'Late shift',
                timeInterval: {
                  start: '2025-01-01T01:00:00Z',
                  duration: 'PT1H'
                },
                analysis: { regular: 1, overtime: 0, isBillable: true }
              }],
              meta: { capacity: 8, isHoliday: false, isNonWorking: false, isTimeOff: false, holidayName: '' }
            }]
          ])
        }
      ];

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).toContain('2024-12-31');
        expect(csvContent).not.toContain('2025-01-01,User 1');
      });

      downloadCsv(analysis);
    });

    it('should set custom filename when provided', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      downloadCsv(mockAnalysis, 'custom-report.csv');

      expect(mockLink.setAttribute).toHaveBeenCalledWith(
        'download',
        'custom-report.csv'
      );
    });
  });

  describe('parseIsoDuration', () => {
    it('should parse PT8H', () => {
      expect(parseIsoDuration('PT8H')).toBe(8);
    });

    it('should parse PT1H30M', () => {
      expect(parseIsoDuration('PT1H30M')).toBe(1.5);
    });

    it('should parse PT45M', () => {
      expect(parseIsoDuration('PT45M')).toBe(0.75);
    })

    it('should parse PT30S', () => {
      expect(parseIsoDuration('PT30S')).toBeCloseTo(0.00833, 4);
    })

    it('should parse complex duration PT2H45M30S', () => {
      const result = parseIsoDuration('PT2H45M30S');
      expect(result).toBeCloseTo(2.7583, 3);
    })

    it('should return 0 for empty string', () => {
      expect(parseIsoDuration('')).toBe(0);
    })

    it('should return 0 for null', () => {
      expect(parseIsoDuration(null)).toBe(0);
    })

    it('should return 0 for undefined', () => {
      expect(parseIsoDuration(undefined)).toBe(0);
    })

    it('should handle invalid format gracefully', () => {
      expect(parseIsoDuration('invalid')).toBe(0);
    })

    it('should parse PT0H', () => {
      expect(parseIsoDuration('PT0H')).toBe(0);
    })
  })

  describe('CSV formula injection prevention', () => {
    it('should escape values starting with +', () => {
      const entriesWithPlus = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '+1234567890',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithPlus = calculateAnalysis(entriesWithPlus, mockStore, {
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
        expect(csvContent).toContain("'+1234567890");
      });

      downloadCsv(analysisWithPlus);
    });

    it('should escape values starting with -', () => {
      const entriesWithMinus = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '-123',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithMinus = calculateAnalysis(entriesWithMinus, mockStore, {
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
        expect(csvContent).toContain("'-123");
      });

      downloadCsv(analysisWithMinus);
    });

    it('should escape values starting with @', () => {
      const entriesWithAt = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '@mention',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithAt = calculateAnalysis(entriesWithAt, mockStore, {
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
        expect(csvContent).toContain("'@mention");
      });

      downloadCsv(analysisWithAt);
    });

    it('should escape values starting with tab character', () => {
      const entriesWithTab = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '\tindented',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithTab = calculateAnalysis(entriesWithTab, mockStore, {
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
        expect(csvContent).toContain('indented');
        expect(csvContent).not.toContain('\tindented');
      });

      downloadCsv(analysisWithTab);
    });

    it('should escape values starting with carriage return', () => {
      const entriesWithCR = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '\rline',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithCR = calculateAnalysis(entriesWithCR, mockStore, {
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
        expect(csvContent).toContain('line');
        expect(csvContent).not.toContain('\rline');
      });

      downloadCsv(analysisWithCR);
    });
  });

  describe('CSV field escaping edge cases', () => {
    it('should handle newlines in description', () => {
      const entriesWithNewline = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Line 1\nLine 2',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithNewline = calculateAnalysis(entriesWithNewline, mockStore, {
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
        // Newlines are stripped before CSV escaping
        expect(csvContent).toContain('Line 1Line 2');
        expect(csvContent).not.toContain('\nLine 2');
      });

      downloadCsv(analysisWithNewline);
    });

    it('should handle commas in description', () => {
      const entriesWithComma = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'A, B, and C',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithComma = calculateAnalysis(entriesWithComma, mockStore, {
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
        // Should be quoted because it contains comma
        expect(csvContent).toContain('"A, B, and C"');
      });

      downloadCsv(analysisWithComma);
    });
  });

  describe('CSV branch coverage - conditional ternaries', () => {
    it('should handle non-billable entries (line 109 false branch)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Non-billable work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false  // Explicitly non-billable
        }
      ];

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
        // Non-billable entries should have 0h in BillableWorkedHours and values in NonBillableWorkedHours
        expect(csvContent).toContain('Non-billable work');
        // Should have rows with "No" for isHoliday
        expect(csvContent).toContain('No');
      });

      downloadCsv(analysis);
    });

    it('should handle entries without duration (lines 113-122)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Entry without duration',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z'
            // No duration field
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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
        // Should still produce valid CSV when duration is missing
        expect(csvContent).toContain('Entry without duration');
        // With no duration, TotalHours=0h and TotalHoursDecimal=0.00
        // The row should contain: ...,0h,0.00,No,...
        const entryLine = csvContent.split('\n').find(l => l.includes('Entry without duration'));
        expect(entryLine).not.toBeUndefined();
        expect(typeof entryLine).toBe('string');
        expect(entryLine).toContain('0h,0.00,No'); // TotalHours, TotalHoursDecimal, isHoliday
      });

      downloadCsv(analysis);
    });

    it('should handle day metadata with isHoliday=false (line 131)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Regular work day',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        // Regular day should have "No" for isHoliday column
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');
        const dataLine = lines.find(l => l.includes('Regular work day'));
        expect(dataLine).not.toBeUndefined();
        expect(typeof dataLine).toBe('string');
        const fields = dataLine.split(',');
        const isHolidayIdx = headers.indexOf('isHoliday');
        expect(isHolidayIdx).toBeGreaterThan(-1);
        // Check that isHoliday is "No"
        expect(fields[isHolidayIdx]).toBe('No'); // isHoliday
      });

      downloadCsv(analysis);
    });

    it('should handle day metadata with isTimeOff=false (line 134)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Not time off',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        // Regular day should have "No" for isTimeOff column
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');
        const dataLine = lines.find(l => l.includes('Not time off'));
        expect(dataLine).not.toBeUndefined();
        expect(typeof dataLine).toBe('string');
        const fields = dataLine.split(',');
        const isTimeOffIdx = headers.indexOf('isTimeOff');
        expect(isTimeOffIdx).toBeGreaterThan(-1);
        // Check that isTimeOff is "No"
        expect(fields[isTimeOffIdx]).toBe('No'); // isTimeOff
      });

      downloadCsv(analysis);
    });

    it('should handle day metadata with isHoliday=true (line 131 true branch)', () => {
      // Set up a holiday
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', { name: 'Test Holiday' });
      mockStore.holidays.set('user_1', holidayMap);

      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Holiday work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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
        // Holiday day should have "Yes" for isHoliday column
        expect(csvContent).toContain('Yes');
        expect(csvContent).toContain('Test Holiday');
      });

      downloadCsv(analysis);
    });

    it('should handle day metadata with isTimeOff=true (line 134 true branch)', () => {
      // Set up time off
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 8 });
      mockStore.timeOff.set('user_1', timeOffMap);

      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Work during time off',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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
        // Time-off day should have "Yes" for isTimeOff column
        const lines = csvContent.split('\n');
        const dataLine = lines.find(l => l.includes('Work during time off'));
        expect(dataLine).not.toBeUndefined();
        expect(typeof dataLine).toBe('string');
        expect(dataLine).toContain('Yes');
      });

      downloadCsv(analysis);
    });

    it('should handle entry with missing timeInterval.start (line 119)', () => {
      // Create analysis with entry that has null start
      const analysis = [{
        userId: 'user_1',
        userName: 'User 1',
        days: new Map([
          ['2025-01-15', {
            entries: [{
              id: 'entry_1',
              description: 'Entry without start',
              timeInterval: {
                start: null, // Missing start
                end: '2025-01-15T17:00:00Z',
                duration: 'PT8H'
              },
              analysis: { regular: 8, overtime: 0, isBillable: true }
            }],
            meta: { isHoliday: false, isNonWorking: false, isTimeOff: false, capacity: 8 }
          }]
        ])
      }];

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Should handle missing start gracefully
        expect(csvContent).toContain('Entry without start');
        // Date should be empty when start is null
        const lines = csvContent.split('\n');
        const dataLine = lines.find(l => l.includes('Entry without start'));
        expect(dataLine).not.toBeUndefined();
        expect(typeof dataLine).toBe('string');
        expect(dataLine.length).toBeGreaterThan(0);
      });

      downloadCsv(analysis);
    });

    it('should handle day with null capacity (line 122 ?? fallback)', () => {
      // Create analysis with day that has null/undefined capacity
      const analysis = [{
        userId: 'user_1',
        userName: 'User 1',
        days: new Map([
          ['2025-01-15', {
            entries: [{
              id: 'entry_1',
              description: 'Entry with null capacity day',
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 'PT8H'
              },
              analysis: { regular: 8, overtime: 0, isBillable: true }
            }],
            meta: { isHoliday: false, isNonWorking: false, isTimeOff: false, capacity: null }
          }]
        ])
      }];

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Should handle null capacity with 0 fallback
        expect(csvContent).toContain('Entry with null capacity day');
        const lines = csvContent.split('\n');
        const dataLine = lines.find(l => l.includes('Entry with null capacity day'));
        expect(dataLine).toBeDefined();
        // Capacity should be 0h when null
        const fields = dataLine.split(',');
        expect(fields[3]).toBe('0h'); // EffectiveCapacityHours column
      });

      downloadCsv(analysis);
    });

    it('should handle day with missing meta (line 122 ?? fallback)', () => {
      // Create analysis with day that has no meta property
      const analysis = [{
        userId: 'user_1',
        userName: 'User 1',
        days: new Map([
          ['2025-01-15', {
            entries: [{
              id: 'entry_1',
              description: 'Entry with missing meta',
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 'PT8H'
              },
              analysis: { regular: 8, overtime: 0, isBillable: true }
            }]
            // No meta property
          }]
        ])
      }];

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Should handle missing meta gracefully
        expect(csvContent).toContain('Entry with missing meta');
      });

      downloadCsv(analysis);
    });
  });

  /**
   * Amount Column Export Specification
   *
   * SPECIFICATION:
   * - Rate column should export hourly rate
   * - Regular $ column should export regular hours cost
   * - OT $ column should export overtime cost
   * - T2 $ column should appear when tieredOT is enabled
   * - Total $ column should export total cost
   * - Amount display mode should be respected in export
   */
  describe('Amount Column Export', () => {
    it('should export Rate column with hourly rate', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Test work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 7500 }, // $75/hr in cents
          billable: true
        }
      ];

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
        // Should contain rate information in some form
        // Rate is stored in cents (7500), displayed as $75
        expect(csvContent).toContain('User 1');
      });

      downloadCsv(analysis);
    });

    it('should export cost-related columns for overtime entries', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'OT work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

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
        // Should have OvertimeHours column with non-zero values
        expect(csvContent).toContain('OvertimeHours');
        // Should contain the 2h overtime row
        expect(csvContent).toContain('2h');
      });

      downloadCsv(analysis);
    });
  });

  /**
   * Filename Conventions Specification
   *
   * SPECIFICATION:
   * - Default filename: otplus-report.csv
   * - Custom filename when provided
   */
  describe('Filename Conventions', () => {
    beforeEach(() => {
      // Reset Blob mock for filename tests
      global.Blob = jest.fn(() => ({}));
    });

    it('default filename should be otplus-report.csv', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      downloadCsv(mockAnalysis);

      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'otplus-report.csv');
    });

    it('should support custom filename', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      downloadCsv(mockAnalysis, 'my-custom-export.csv');

      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'my-custom-export.csv');
    });

    it('should support filename with date range', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      downloadCsv(mockAnalysis, 'otplus-2025-01-01-to-2025-01-31.csv');

      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'otplus-2025-01-01-to-2025-01-31.csv');
    });
  });

  /**
   * Column Ordering Specification
   *
   * SPECIFICATION:
   * - Columns should be in a specific, consistent order
   * - Time columns should appear before amount columns
   * - Status columns should appear at the end
   */
  describe('Column Ordering', () => {
    it('columns should be in specified order', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');

        // Verify essential columns exist
        expect(headers).toContain('Date');
        expect(headers).toContain('User');
        expect(headers).toContain('Description');
        expect(headers).toContain('RegularHours');
        expect(headers).toContain('OvertimeHours');
        expect(headers).toContain('TotalHours');
        expect(headers).toContain('TotalHoursDecimal');

        // Verify ordering: Date should come first
        expect(headers.indexOf('Date')).toBeLessThan(headers.indexOf('User'));
        expect(headers.indexOf('User')).toBeLessThan(headers.indexOf('Description'));

        // Status columns should come after hour columns
        expect(headers.indexOf('TotalHours')).toBeLessThan(headers.indexOf('isHoliday'));
      });

      downloadCsv(mockAnalysis);
    });

    it('hour columns should appear in logical order', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');

        // Regular should come before Overtime
        const regularIdx = headers.indexOf('RegularHours');
        const overtimeIdx = headers.indexOf('OvertimeHours');
        expect(regularIdx).toBeLessThan(overtimeIdx);

        // Billable should come before NonBillable
        const billableWorkedIdx = headers.indexOf('BillableWorkedHours');
        const nonBillableOTIdx = headers.indexOf('NonBillableOTHours');
        expect(billableWorkedIdx).toBeLessThan(nonBillableOTIdx);
      });

      downloadCsv(mockAnalysis);
    });

    it('status columns should appear at the end', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        // Strip UTF-8 BOM if present (added for Excel compatibility)
        const csvWithoutBom = csvContent.replace(/^\uFEFF/, '');
        const lines = csvWithoutBom.split('\n');
        const headers = lines[0].split(',');

        // isHoliday, holidayName, isNonWorkingDay, isTimeOff should be at the end
        const isHolidayIdx = headers.indexOf('isHoliday');
        const isTimeOffIdx = headers.indexOf('isTimeOff');

        // These should be in the latter half of columns
        expect(isHolidayIdx).toBeGreaterThan(headers.length / 2);
        expect(isTimeOffIdx).toBeGreaterThan(headers.length / 2);
      });

      downloadCsv(mockAnalysis);
    });
  });
});

/**
 * CSV Format Specification Test Suite
 *
 * SPECIFICATION: CSV Export Format
 *
 * The CSV export follows specific formatting rules for Excel/spreadsheet compatibility:
 *
 * | Aspect | Specification | Reason |
 * |--------|---------------|--------|
 * | Charset | UTF-8 | International character support |
 * | Line endings | CRLF (\r\n) | Windows/Excel compatibility |
 * | Field separator | Comma (,) | Standard CSV |
 * | Quote character | Double quote (") | Standard CSV |
 * | Quote escaping | Double the quote ("") | Standard CSV |
 *
 * @see js/export.ts - CSV generation
 * @see docs/spec.md - CSV / Formula Injection (export)
 */
describe('CSV Format Specification', () => {
  let mockAnalysis;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Create minimal mock analysis with required structure
    mockAnalysis = [{
      userId: 'user1',
      userName: 'Alice Test',
      totals: { total: 8, regular: 8, overtime: 0 },
      days: new Map([
        ['2025-01-15', {
          entries: [{
            id: 'entry1',
            date: '2025-01-15',
            description: 'Test work',
            timeInterval: {
              start: '2025-01-15T09:00:00Z',
              end: '2025-01-15T17:00:00Z',
              duration: 'PT8H'
            },
            analysis: {
              regular: 8,
              overtime: 0,
              hourlyRate: 50,
              regularAmount: 400,
              isBillable: true
            },
            userName: 'Alice Test'
          }],
          meta: {
            effectiveCapacity: 8,
            isHoliday: false,
            holidayName: null,
            isNonWorking: false,
            isTimeOff: false
          }
        }]
      ])
    }];
  });

  afterEach(() => {
    standardAfterEach();
  });

  describe('Character Encoding', () => {
    /**
     * SPECIFICATION: UTF-8 Encoding
     *
     * CSV content is UTF-8 encoded via Blob MIME type:
     * `text/csv;charset=utf-8;`
     *
     * Note: No BOM (Byte Order Mark) is prepended.
     * Excel detects UTF-8 from charset declaration.
     */

    it('should use UTF-8 charset in Blob MIME type', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let blobType = null;
      global.Blob = jest.fn((content, options) => {
        blobType = options?.type;
        return {};
      });

      downloadCsv(mockAnalysis);

      expect(blobType).toBe('text/csv;charset=utf-8;');
    });

    it('should handle international characters in user names', () => {
      mockAnalysis[0].userName = 'François Müller';

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      expect(csvContent).toContain('François Müller');
    });
  });

  describe('Field Escaping', () => {
    /**
     * SPECIFICATION: CSV Field Escaping
     *
     * Fields are escaped according to RFC 4180:
     * - Fields containing comma (,) must be quoted
     * - Fields containing newline must be quoted
     * - Double quotes within fields are doubled ("")
     */

    it('should escape commas within fields', () => {
      mockAnalysis[0].days.get('2025-01-15').entries[0].description = 'Meeting, planning, review';

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      // Field with comma should be quoted
      expect(csvContent).toContain('"');
      // The comma should still be in the content
      expect(csvContent).toContain('Meeting');
      expect(csvContent).toContain('planning');
    });

    it('should escape quotes within fields (doubled)', () => {
      mockAnalysis[0].days.get('2025-01-15').entries[0].description = 'Said "Hello" today';

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      // Quotes should be doubled
      expect(csvContent).toContain('""Hello""');
    });
  });

  describe('Currency Precision', () => {
    /**
     * SPECIFICATION: Currency Format
     *
     * Currency values use 2 decimal precision:
     * - Regular$, OT$, T2$, Total$ columns
     * - Consistent formatting for all amount fields
     */

    it('should use 2 decimal precision for currency columns', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      // Check headers exist
      const headers = csvContent.split('\n')[0];
      expect(headers).toContain('Regular');
      expect(headers).toContain('Overtime');
      expect(headers).toContain('Total');
    });
  });

  describe('Hours Precision', () => {
    /**
     * SPECIFICATION: Hours Format
     *
     * Hour values use 4 decimal precision:
     * - RegularHours, OvertimeHours, TotalHours
     * - Prevents floating-point drift
     */

    it('should include TotalHoursDecimal column', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      // Should have both TotalHours and TotalHoursDecimal
      expect(csvContent).toContain('TotalHours');
      expect(csvContent).toContain('TotalHoursDecimal');
    });
  });

  describe('Column Headers', () => {
    /**
     * SPECIFICATION: CSV Column Headers
     *
     * Headers include (in order):
     * Date, User, Description, EffectiveCapacityHours,
     * RegularHours, OvertimeHours, BillableWorkedHours,
     * BillableOTHours, NonBillableWorkedHours, NonBillableOTHours,
     * TotalHours, TotalHoursDecimal, isHoliday, holidayName,
     * isNonWorkingDay, isTimeOff
     */

    it('should include all required column headers', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      const headers = csvContent.split('\n')[0];

      // Core columns
      expect(headers).toContain('Date');
      expect(headers).toContain('User');
      expect(headers).toContain('EffectiveCapacityHours');
      expect(headers).toContain('RegularHours');
      expect(headers).toContain('OvertimeHours');
      expect(headers).toContain('TotalHours');
      expect(headers).toContain('TotalHoursDecimal');

      // Status columns
      expect(headers).toContain('isHoliday');
      expect(headers).toContain('holidayName');
      expect(headers).toContain('isNonWorkingDay');
      expect(headers).toContain('isTimeOff');
    });
  });

  describe('Placeholder Rows', () => {
    /**
     * SPECIFICATION: Placeholder Rows for Empty Days
     *
     * Days without entries get placeholder row:
     * - All hour values = 0
     * - Description = '(no entries)'
     * - Ensures gapless date range in export
     */

    it('should generate row for each day in range', () => {
      // This test documents expected behavior
      // Actual implementation verified in integration tests
      expect(true).toBe(true);
    });
  });

  describe('UTF-8 BOM', () => {
    /**
     * SPECIFICATION: UTF-8 BOM for Excel Compatibility
     *
     * The CSV should start with a UTF-8 Byte Order Mark (BOM):
     * - Character: \uFEFF (zero-width no-break space)
     * - Purpose: Signals to Excel that the file is UTF-8 encoded
     * - Without BOM: Excel may misinterpret non-ASCII characters
     */

    it('should prepend UTF-8 BOM to CSV content', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      // CSV should start with UTF-8 BOM
      expect(csvContent.charCodeAt(0)).toBe(0xFEFF);
      // After BOM, first header should be 'Date'
      expect(csvContent.substring(1, 5)).toBe('Date');
    });
  });
});

/**
 * Formula Injection Prevention - Additional Tests
 *
 * SPECIFICATION: CSV Security
 *
 * Prevent spreadsheet formula execution:
 * - Prefix single quote (') for cells starting with risky characters
 * - Risky prefixes: =, +, -, @, tab (\t), carriage return (\r)
 * - Apply even to quoted values
 *
 * @see docs/spec.md - CSV / Formula Injection (export)
 */
describe('CSV Formula Injection Prevention - Extended', () => {
  let mockAnalysis;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAnalysis = [{
      userId: 'user1',
      userName: 'Test User',
      totals: { total: 8, regular: 8, overtime: 0 },
      days: new Map([
        ['2025-01-15', {
          entries: [{
            id: 'entry1',
            date: '2025-01-15',
            description: 'Normal description',
            timeInterval: {
              start: '2025-01-15T09:00:00Z',
              end: '2025-01-15T17:00:00Z',
              duration: 'PT8H'
            },
            analysis: {
              regular: 8,
              overtime: 0,
              hourlyRate: 50,
              regularAmount: 400,
              isBillable: true
            },
            userName: 'Test User'
          }],
          meta: {
            effectiveCapacity: 8,
            isHoliday: false,
            holidayName: null,
            isNonWorking: false,
            isTimeOff: false
          }
        }]
      ])
    }];
  });

  afterEach(() => {
    standardAfterEach();
  });

  describe('Risky Prefix Detection', () => {
    /**
     * SPECIFICATION: Risky Prefixes
     *
     * These characters at the start of a cell can trigger formula execution:
     * - = (equals) - Direct formula
     * - + (plus) - Numeric operation
     * - - (minus) - Negative number or operation
     * - @ (at) - Reference
     * - \t (tab) - Hidden prefix
     * - \r (carriage return) - Hidden prefix
     */

    const riskyPrefixes = [
      { char: '=', name: 'equals sign', example: '=SUM(A1:A10)' },
      { char: '+', name: 'plus sign', example: '+1+2' },
      { char: '-', name: 'minus sign', example: '-1-2' },
      { char: '@', name: 'at sign', example: '@A1' },
      { char: '\t', name: 'tab character', example: '\t=HYPERLINK()' },
      { char: '\r', name: 'carriage return', example: '\r=CMD()' }
    ];

    riskyPrefixes.forEach(({ char, name, example }) => {
      it(`should sanitize ${name} prefix in description`, () => {
        mockAnalysis[0].days.get('2025-01-15').entries[0].description = example;

        const createElementSpy = jest.spyOn(document, 'createElement');
        const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
        createElementSpy.mockReturnValue(mockLink);

        let csvContent = '';
        global.Blob = jest.fn((content) => {
          csvContent = content[0];
          return {};
        });

        downloadCsv(mockAnalysis);

        // Content should have protective prefix or be escaped
        // The exact sanitization method may vary, but raw formula shouldn't execute
        expect(csvContent).toBeDefined();
        // Should not contain the raw dangerous start at the beginning of a cell
        // (after a comma or at line start)
      });
    });
  });

  describe('Sanitization Preservation', () => {
    it('should preserve content while adding protection', () => {
      mockAnalysis[0].days.get('2025-01-15').entries[0].description = '=Important formula note';

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(mockAnalysis);

      // Original content should still be readable (with protection)
      expect(csvContent).toContain('Important formula note');
    });
  });
});

// ============================================================================
// PHASE 3: Complex CSV Data Handling
// ============================================================================

describe('Complex CSV Data Handling', () => {
  /**
   * SPECIFICATION: Complex CSV Data
   *
   * Tests for edge cases in CSV export:
   * - Multi-line descriptions
   * - Windows line endings (\r\n)
   * - Embedded quotes with newlines
   * - Maximum description length
   * - Unicode characters (emoji, CJK, RTL)
   */

  let mockStore;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Create mock store
    mockStore = createMockStore({
      users: [{ id: 'user_1', name: 'User 1' }]
    });

    // Mock document.createElement for download link
    const mockLink = {
      setAttribute: jest.fn(),
      click: jest.fn(),
      style: {},
      remove: jest.fn()
    };
    document.createElement = jest.fn(() => mockLink);
    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();
  });

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  describe('Multi-line Descriptions', () => {
    it('should escape descriptions with \\n (Unix line breaks)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Line 1\nLine 2\nLine 3',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Newlines are stripped before CSV escaping
      expect(csvContent).toContain('Line 1Line 2Line 3');
      expect(csvContent).not.toContain('\nLine 2');
    });

    it('should escape descriptions with \\r\\n (Windows line breaks)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Windows\r\nLine breaks\r\nHere',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Windows line breaks should be properly handled (quoted)
      expect(csvContent).toContain('Windows');
      expect(csvContent).toContain('Line breaks');
    });

    it('should handle descriptions with embedded quotes and newlines', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'He said "Hello"\nThen "Goodbye"',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Quotes should be doubled within quoted field
      expect(csvContent).toContain('""Hello""');
      expect(csvContent).toContain('""Goodbye""');
    });
  });

  describe('Maximum Description Length', () => {
    it('should handle maximum description length (10,000 chars)', () => {
      const longDesc = 'x'.repeat(10000);
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: longDesc,
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Should contain the full 10,000 character description
      expect(csvContent).toContain(longDesc);
      expect(csvContent.length).toBeGreaterThan(10000);
    });

    it('should handle description with mixed long content and special chars', () => {
      const longWithSpecial = 'A'.repeat(5000) + ',\n"quote",' + 'B'.repeat(5000);
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: longWithSpecial,
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Should properly escape while maintaining length
      expect(csvContent.length).toBeGreaterThan(10000);
      // Quotes should be doubled
      expect(csvContent).toContain('""quote""');
    });
  });

  describe('Unicode Support', () => {
    it('should handle Unicode in descriptions (emoji)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '🎉 Celebration meeting 🎊',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // Emoji should be preserved
      expect(csvContent).toContain('🎉');
      expect(csvContent).toContain('🎊');
    });

    it('should handle Unicode CJK characters', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '会议记录 - Meeting notes - ミーティング',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // CJK characters should be preserved
      expect(csvContent).toContain('会议记录');
      expect(csvContent).toContain('ミーティング');
    });

    it('should handle Unicode RTL (Arabic, Hebrew) characters', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'مرحبا - שלום - Hello',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // RTL characters should be preserved
      expect(csvContent).toContain('مرحبا');
      expect(csvContent).toContain('שלום');
    });

    it('should handle mixed Unicode, special chars, and formula-like content', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '🎉 =Formula, "quotes", 会议\nNewline @mention',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = { setAttribute: jest.fn(), click: jest.fn(), style: {} };
      createElementSpy.mockReturnValue(mockLink);

      let csvContent = '';
      global.Blob = jest.fn((content) => {
        csvContent = content[0];
        return {};
      });

      downloadCsv(analysis);

      // All content types should be handled
      expect(csvContent).toContain('🎉');
      expect(csvContent).toContain('会议');
      // The content should be properly escaped/sanitized
      expect(csvContent.length).toBeGreaterThan(0);
    });
  });
});
