import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sdkSourceAliases, sdkSourceModuleIds, sdkSourceRoot } from '../../vite.sdk-aliases';

const serverPort = Number(process.env.PORT ?? 3000);
const devServerPort = Number(process.env.VITE_PORT ?? 5173);

export default defineConfig(({ command }) => {
  const useSdkSources = command === 'serve';

  return {
    base: '/',
    root: fileURLToPath(new URL('./src/client', import.meta.url)),
    cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
    plugins: [vue()],
    optimizeDeps: useSdkSources ? { exclude: sdkSourceModuleIds } : undefined,
    resolve: {
      alias: useSdkSources ? sdkSourceAliases : {},
      dedupe: ['vue'],
    },
    server: {
      host: '127.0.0.1',
      // The backend allows WebSocket upgrades only from this origin.
      port: devServerPort,
      strictPort: true,
      fs: { allow: [sdkSourceRoot] },
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
  };
});
