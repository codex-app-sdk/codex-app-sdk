import { availableParallelism } from 'node:os';

export default {
  mutate: ['packages/web/src/**/*.ts', '!packages/web/src/index.ts'],
  testRunner: 'vitest',
  // Vitest related-mode misses later executions of shared transport cleanup paths.
  vitest: { configFile: 'packages/web/vitest.config.ts', related: false },
  concurrency: Math.max(1, Math.floor(availableParallelism() / 2)),
  incremental: true,
  incrementalFile: 'reports/mutation/web/incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/web/index.html' },
  tempDirName: 'reports/mutation/web/sandbox',
  thresholds: { high: 91, low: 75, break: 91 },
};
