import { availableParallelism } from 'node:os';

export default {
  mutate: ['packages/electron/src/**/*.ts', '!packages/electron/src/index.ts', '!packages/electron/src/preload.ts'],
  testRunner: 'vitest',
  // Vitest related-mode misclassified exercised IPC closure bodies as uncovered.
  vitest: { configFile: 'packages/electron/vitest.config.ts', related: false },
  concurrency: Math.max(1, Math.floor(availableParallelism() / 2)),
  incremental: true,
  incrementalFile: 'reports/mutation/electron/incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/electron/index.html' },
  tempDirName: 'reports/mutation/electron/sandbox',
  thresholds: { high: 99, low: 75, break: 99 },
};
