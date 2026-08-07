import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['tests/**'],
      thresholds: {
        statements: 88,
        branches: 64,
        functions: 94,
        lines: 93,
      },
    },
  },
});
