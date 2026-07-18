import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { sdkSourceAliases } from './vite.sdk-aliases';

export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === 'development' ? sdkSourceAliases : {} },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./electron/main.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: 'dist-main',
    emptyOutDir: mode !== 'development',
    rollupOptions: {
      external: mode === 'development'
        ? [/^node:/, 'electron']
        : [/^node:/, 'electron', /^codex-app-sdk\//],
    },
  },
}));
