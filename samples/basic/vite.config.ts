import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';
import { sdkSourceAliases } from './vite.sdk-aliases';

const sampleRoot = fileURLToPath(new URL('.', import.meta.url));
const mainEntry = fileURLToPath(new URL('./src/main/index.ts', import.meta.url));
const preloadEntry = fileURLToPath(new URL('./src/main/preload.ts', import.meta.url));
const mainOutDir = fileURLToPath(new URL('./dist-main', import.meta.url));
const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const rendererOutDir = fileURLToPath(new URL('./dist-renderer', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const useSdkSources = command === 'serve';
  const orchestrateElectron = command === 'build' || mode === 'electron';

  return {
    base: './',
    root: rendererRoot,
    cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
    plugins: [
      vue(),
      orchestrateElectron && electron({
        main: {
          entry: mainEntry,
          onstart: async ({ startup }) => {
            await startup(['.'], { cwd: sampleRoot });
          },
          vite: {
            root: sampleRoot,
            resolve: { alias: useSdkSources ? sdkSourceAliases : {} },
            build: {
              outDir: mainOutDir,
              emptyOutDir: command === 'build',
              lib: {
                entry: mainEntry,
                fileName: () => 'main.js',
              },
              rolldownOptions: {
                external: command === 'build' ? [/^codex-app-sdk\//] : [],
              },
            },
          },
        },
        preload: {
          input: preloadEntry,
          vite: {
            root: sampleRoot,
            resolve: { alias: useSdkSources ? sdkSourceAliases : {} },
            build: {
              outDir: mainOutDir,
              emptyOutDir: false,
              rolldownOptions: {
                output: {
                  format: 'cjs',
                  codeSplitting: false,
                  entryFileNames: 'preload.cjs',
                  chunkFileNames: '[name].cjs',
                  assetFileNames: '[name].[ext]',
                },
              },
            },
          },
        },
      }),
    ],
    resolve: {
      alias: {
        '@': rendererRoot,
        ...(useSdkSources ? sdkSourceAliases : {}),
      },
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { outDir: rendererOutDir, emptyOutDir: true },
  };
});
