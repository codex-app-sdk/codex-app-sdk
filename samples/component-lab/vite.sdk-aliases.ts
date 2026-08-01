import { fileURLToPath, URL } from 'node:url';

export const sdkSourceAliases = {
  'codex-app-sdk/styles.css': fileURLToPath(new URL('../../src/vue/styles.css', import.meta.url)),
  'codex-app-sdk/surface': fileURLToPath(new URL('../../src/surface/index.ts', import.meta.url)),
  'codex-app-sdk/vue': fileURLToPath(new URL('../../src/vue/index.ts', import.meta.url)),
};
