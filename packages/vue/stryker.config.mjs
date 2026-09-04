import { availableParallelism } from 'node:os';

export default {
  mutate: [
    'packages/vue/src/**/*.{ts,vue}',
    '!packages/vue/src/index.ts',
    '!packages/vue/src/style.d.ts',
    '!packages/vue/src/types.ts',
  ],
  testRunner: 'vitest',
  // Vitest related-mode misses direct SFC handler executions and reports false NoCoverage results.
  vitest: { configFile: 'packages/vue/vitest.config.ts', related: false },
  // Per-test coverage attribution also misses exercised SFC and runtime-helper paths.
  coverageAnalysis: 'off',
  concurrency: Math.max(1, Math.floor(availableParallelism() / 2)),
  // Incremental mode forces per-test attribution back on and produces false NoCoverage
  // results for Vue SFC and API-boundary tests, even when coverageAnalysis is disabled.
  incremental: false,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/vue/index.html' },
  jsonReporter: { fileName: 'reports/mutation/vue/mutation.json' },
  tempDirName: 'reports/mutation/vue/sandbox',
  thresholds: { high: 95, low: 75, break: 95 },
};
