import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/codex/generated/**',
        'src/codex/method-map.ts',
        'src/codex/schema-version.ts',
        'tests/**',
      ],
      thresholds: {
        statements: 91,
        branches: 85,
        functions: 92,
        lines: 94,
      },
    },
  },
});
