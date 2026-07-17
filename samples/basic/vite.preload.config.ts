import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./electron/preload.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: 'dist-main',
    emptyOutDir: false,
    rollupOptions: { external: ['electron'] },
  },
});
