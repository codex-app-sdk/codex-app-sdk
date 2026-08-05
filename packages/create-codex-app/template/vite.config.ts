import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const mainEntry = fileURLToPath(new URL('./src/main/index.ts', import.meta.url));
const preloadEntry = fileURLToPath(new URL('./src/main/preload.ts', import.meta.url));
const mainOutDir = fileURLToPath(new URL('./dist-main', import.meta.url));
const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const rendererOutDir = fileURLToPath(new URL('./dist-renderer', import.meta.url));

export default defineConfig(({ command, mode }) => ({
  base: './',
  root: rendererRoot,
  plugins: [
    vue(),
    (command === 'build' || mode === 'electron') && electron({
      main: {
        entry: mainEntry,
        onstart: async ({ startup }) => {
          await startup(['.'], { cwd: projectRoot });
        },
        vite: {
          root: projectRoot,
          build: {
            outDir: mainOutDir,
            emptyOutDir: command === 'build',
            lib: { entry: mainEntry, fileName: () => 'main.js' },
            rolldownOptions: { external: command === 'build' ? [/^codex-app-sdk\//] : [] },
          },
        },
      },
      preload: {
        input: preloadEntry,
        vite: {
          root: projectRoot,
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
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: rendererOutDir,
    emptyOutDir: true,
    // The stock conversation pane includes local syntax-highlighting grammars.
    chunkSizeWarningLimit: 4_000,
  },
}));
