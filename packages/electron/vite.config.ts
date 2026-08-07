import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

function isExternal(id: string): boolean {
  return id === 'electron'
    || id.startsWith('node:')
    || id.startsWith('@codex-app-sdk/');
}

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        preload: fileURLToPath(new URL('./src/preload.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    sourcemap: true,
  },
});
