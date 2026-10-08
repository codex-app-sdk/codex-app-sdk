import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const packageDependencies = Object.keys(packageJson.dependencies);

function isExternalDependency(id: string): boolean {
  return id.startsWith('node:')
    || id === 'vue'
    || packageDependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`));
}

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        codex: fileURLToPath(new URL('./src/codex/index.ts', import.meta.url)),
        electron: fileURLToPath(new URL('./src/electron/index.ts', import.meta.url)),
        'electron-preload': fileURLToPath(new URL('./src/electron/preload.ts', import.meta.url)),
        events: fileURLToPath(new URL('./src/events/index.ts', import.meta.url)),
        node: fileURLToPath(new URL('./src/node/index.ts', import.meta.url)),
        surface: fileURLToPath(new URL('./src/surface/index.ts', import.meta.url)),
        vue: fileURLToPath(new URL('./scripts/vue-entry.mjs', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: isExternalDependency,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'codex-app-sdk[extname]',
      },
    },
    sourcemap: true,
  },
});
