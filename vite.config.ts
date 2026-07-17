import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        codex: fileURLToPath(new URL('./src/codex/index.ts', import.meta.url)),
        electron: fileURLToPath(new URL('./src/electron/index.ts', import.meta.url)),
        events: fileURLToPath(new URL('./src/events/index.ts', import.meta.url)),
        node: fileURLToPath(new URL('./src/node/index.ts', import.meta.url)),
        vue: fileURLToPath(new URL('./src/vue/index.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^node:/, 'vue'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'codex-app-sdk[extname]',
      },
    },
    sourcemap: true,
  },
});
