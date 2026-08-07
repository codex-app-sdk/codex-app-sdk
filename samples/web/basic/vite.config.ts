import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const serverPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  base: '/',
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/codex': {
        target: `ws://127.0.0.1:${serverPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
});
