import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

function isExternal(id: string): boolean {
  return id.startsWith('node:')
    || id === '@codex-app-sdk/core'
    || id.startsWith('@codex-app-sdk/core/');
}

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        protocol: fileURLToPath(new URL('./src/codex/index.ts', import.meta.url)),
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
