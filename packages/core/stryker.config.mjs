import { availableParallelism } from 'node:os';

export default {
  mutate: ['packages/core/src/**/*.ts', '!packages/core/src/index.ts', '!packages/core/src/surface.ts'],
  testRunner: 'vitest',
  vitest: { configFile: 'packages/core/vitest.config.ts', related: true },
  concurrency: Math.max(1, Math.floor(availableParallelism() / 2)),
  incremental: true,
  incrementalFile: 'reports/mutation/core/incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/core/index.html' },
  tempDirName: 'reports/mutation/core/sandbox',
  thresholds: { high: 99, low: 75, break: 99 },
};
