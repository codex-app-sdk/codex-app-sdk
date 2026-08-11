import { fileURLToPath, URL } from 'node:url';

export const sdkSourceAliases = {
  '@codex-app-sdk/electron/preload': fileURLToPath(new URL('../../../packages/electron/src/preload.ts', import.meta.url)),
  '@codex-app-sdk/electron': fileURLToPath(new URL('../../../packages/electron/src/index.ts', import.meta.url)),
  '@codex-app-sdk/backend': fileURLToPath(new URL('../../../packages/backend/src/index.ts', import.meta.url)),
  '@codex-app-sdk/vue/styles.css': fileURLToPath(new URL('../../../packages/vue/src/styles.css', import.meta.url)),
  '@codex-app-sdk/core/events': fileURLToPath(new URL('../../../packages/core/src/typed-event-bus.ts', import.meta.url)),
  '@codex-app-sdk/core/native': fileURLToPath(new URL('../../../packages/core/src/native.ts', import.meta.url)),
  '@codex-app-sdk/core/surface-bridge': fileURLToPath(new URL('../../../packages/core/src/surface-bridge.ts', import.meta.url)),
  '@codex-app-sdk/core/surface': fileURLToPath(new URL('../../../packages/core/src/surface.ts', import.meta.url)),
  '@codex-app-sdk/core': fileURLToPath(new URL('../../../packages/core/src/index.ts', import.meta.url)),
  '@codex-app-sdk/vue': fileURLToPath(new URL('../../../packages/vue/src/index.ts', import.meta.url)),
};
