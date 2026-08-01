import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sdkSourceAliases } from './vite.sdk-aliases';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: sdkSourceAliases },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
