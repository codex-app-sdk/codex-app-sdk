import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        events: fileURLToPath(new URL('./src/typed-event-bus.ts', import.meta.url)),
        native: fileURLToPath(new URL('./src/native.ts', import.meta.url)),
        surface: fileURLToPath(new URL('./src/surface.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    sourcemap: true,
  },
});
