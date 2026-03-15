/**
 * Performance Benchmark Suite for OTPLUS v2.0
 * Measures baseline performance before optimization
 */

import { calculateAnalysis } from '../../js/calc.js';
import { generateMockUsers, generateMockEntries } from '../helpers/mock-data.js';

console.log('='.repeat(60));
console.log('OTPLUS v2.0 - Performance Benchmark Suite');
console.log('='.repeat(60));
console.log('');

// Create mock store
function createMockStore(userCount) {
  const users = generateMockUsers(userCount);
  return {
    users,
    config: {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      overtimeBasis: 'daily'
    },
    calcParams: {
      dailyThreshold: 8,
      weeklyThreshold: 40,
      overtimeMultiplier: 1.5
    },
    profiles: new Map(),
    holidays: new Map(),
    timeOff: new Map(),
    overrides: {},
    apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 }
  };
}

// Benchmark scenarios
const scenarios = [
  { name: 'Small (10 users, 100 entries)', users: 10, entries: 100 },
  { name: 'Medium (20 users, 500 entries)', users: 20, entries: 500 },
  { name: 'Large (50 users, 1000 entries)', users: 50, entries: 1000 },
  { name: 'XL (100 users, 5000 entries)', users: 100, entries: 5000 }
];

const results = [];

scenarios.forEach(scenario => {
  console.log(`Running: ${scenario.name}...`);

  const users = generateMockUsers(scenario.users);
  const entries = generateMockEntries(scenario.entries, scenario.users);
  const store = createMockStore(scenario.users);
  const dateRange = { start: '2025-01-01', end: '2025-01-31' };

  // Warmup run (JIT optimization)
  calculateAnalysis(entries.slice(0, Math.min(100, entries.length)), store, dateRange);

  // Benchmark run
  const start = performance.now();
  const iterations = scenario.users <= 20 ? 100 : 10; // More iterations for smaller datasets

  for (let i = 0; i < iterations; i++) {
    calculateAnalysis(entries, store, dateRange);
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  console.log(`  Total time (${iterations} iterations): ${totalTime.toFixed(2)}ms`);
  console.log(`  Average time: ${avgTime.toFixed(2)}ms`);
  console.log('');

  results.push({
    scenario: scenario.name,
    iterations,
    totalTime,
    avgTime,
    users: scenario.users,
    entries: scenario.entries
  });
});

// Print summary
console.log('='.repeat(60));
console.log('BENCHMARK RESULTS SUMMARY');
console.log('='.repeat(60));
console.log('');

results.forEach(result => {
  console.log(`${result.scenario}:`);
  console.log(`  Average: ${result.avgTime.toFixed(2)}ms`);
  console.log(`  Throughput: ${(result.entries / result.avgTime * 1000).toFixed(0)} entries/sec`);
  console.log('');
});

// Save to file
import { writeFileSync } from 'fs';
const report = `OTPLUS v2.0 Performance Baseline
Generated: ${new Date().toISOString()}

${results.map(r => `${r.scenario}: ${r.avgTime.toFixed(2)}ms (${r.iterations} iterations)`).join('\n')}

${JSON.stringify(results, null, 2)}
`;

writeFileSync('performance-baseline.txt', report);
console.log('Results saved to: performance-baseline.txt');
console.log('');
