import { fileURLToPath, URL } from 'node:url';

export const sdkSourceAliases = {
  '@codex-app-sdk/core/native': fileURLToPath(new URL('../../packages/core/src/native.ts', import.meta.url)),
  '@codex-app-sdk/core/surface': fileURLToPath(new URL('../../packages/core/src/surface.ts', import.meta.url)),
  '@codex-app-sdk/vue/styles.css': fileURLToPath(new URL('../../packages/vue/src/styles.css', import.meta.url)),
  '@codex-app-sdk/vue': fileURLToPath(new URL('../../packages/vue/src/index.ts', import.meta.url)),
};
