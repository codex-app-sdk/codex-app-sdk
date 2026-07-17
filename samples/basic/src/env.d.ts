/// <reference types="vite/client" />

import type { CodexSurfaceRendererApi } from 'codex-app-sdk/electron';

declare global {
  interface Window {
    codexSurface: CodexSurfaceRendererApi;
  }
}

export {};
