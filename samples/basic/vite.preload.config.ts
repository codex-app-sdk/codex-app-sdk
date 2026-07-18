import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { sdkSourceAliases } from './vite.sdk-aliases';

export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === 'development' ? sdkSourceAliases : {} },
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
}));
