import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./electron/main.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: 'dist-main',
    emptyOutDir: true,
    rollupOptions: { external: [/^node:/, 'electron', /^codex-app-sdk\//] },
  },
});
