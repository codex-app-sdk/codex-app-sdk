import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.vue', 'packages/*/src/**/*.ts', 'packages/*/src/**/*.vue'],
      exclude: [
        'packages/backend/src/codex/generated/**',
        'packages/backend/src/codex/method-map.ts',
        'packages/backend/src/codex/schema-version.ts',
        'tests/**',
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
