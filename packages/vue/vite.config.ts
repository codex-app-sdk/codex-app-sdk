import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const dependencies = Object.keys(packageJson.dependencies);

function isExternal(id: string): boolean {
  return id === 'vue'
    || dependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`));
}

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./scripts/vue-entry.mjs', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: isExternal,
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
    sourcemap: true,
  },
});
