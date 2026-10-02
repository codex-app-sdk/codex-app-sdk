import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sdkSourceAliases, sdkSourceModuleIds, sdkSourceRoot } from '../vite.sdk-aliases';
import { liveChatServer } from './live-chat-server';

export default defineConfig({
  plugins: [vue(), liveChatServer()],
  optimizeDeps: { exclude: sdkSourceModuleIds },
  resolve: { alias: sdkSourceAliases, dedupe: ['vue'] },
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    fs: { allow: [sdkSourceRoot] },
  },
});
