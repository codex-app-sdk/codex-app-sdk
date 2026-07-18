/// <reference types="vite/client" />

import type { CodexNativeRendererApi, CodexSurfaceRendererApi } from 'codex-app-sdk/electron';

declare global {
  interface Window {
    codexAppSdkNative: CodexNativeRendererApi;
    codexSurface: CodexSurfaceRendererApi;
  }
}

export {};
