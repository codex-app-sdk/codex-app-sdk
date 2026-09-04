import { availableParallelism } from 'node:os';

export default {
  mutate: [
    'packages/backend/src/**/*.ts',
    '!packages/backend/src/codex/generated/**',
    '!packages/backend/src/codex/schema-version.ts',
    '!packages/backend/src/codex/method-map.ts',
    '!packages/backend/src/codex/server-request-map.ts',
    '!packages/backend/src/index.ts',
    '!packages/backend/src/node/index.ts',
    '!packages/backend/src/node/codex-surface-contracts.ts',
  ],
  testRunner: 'vitest',
  vitest: { configFile: 'packages/backend/vitest.config.ts', related: false },
  coverageAnalysis: 'off',
  concurrency: Math.max(1, Math.floor(availableParallelism() / 2)),
  incremental: true,
  incrementalFile: 'reports/mutation/backend/incremental.json',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/backend/index.html' },
  tempDirName: 'reports/mutation/backend/sandbox',
  thresholds: { high: 98, low: 75, break: 98 },
};
