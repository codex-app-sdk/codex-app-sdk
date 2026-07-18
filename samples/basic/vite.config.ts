import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sdkSourceAliases } from './vite.sdk-aliases';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      ...(mode === 'development' ? sdkSourceAliases : {}),
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist-renderer', emptyOutDir: true },
}));
