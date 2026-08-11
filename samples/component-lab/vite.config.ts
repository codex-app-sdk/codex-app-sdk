import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sdkSourceAliases, sdkSourceModuleIds, sdkSourceRoot } from '../vite.sdk-aliases';

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { exclude: sdkSourceModuleIds },
  resolve: { alias: sdkSourceAliases, dedupe: ['vue'] },
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    fs: { allow: [sdkSourceRoot] },
  },
});
