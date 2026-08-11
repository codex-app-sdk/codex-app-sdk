import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { sdkSourceAliases } from '../../vite.sdk-aliases';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: sdkSourceAliases },
  test: { environment: 'jsdom' },
});
