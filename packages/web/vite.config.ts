import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        client: fileURLToPath(new URL('./src/client.ts', import.meta.url)),
        server: fileURLToPath(new URL('./src/server.ts', import.meta.url)),
        protocol: fileURLToPath(new URL('./src/protocol.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id.startsWith('@codex-app-sdk/'),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    sourcemap: true,
  },
});
