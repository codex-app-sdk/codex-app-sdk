/// <reference types="vite/client" />

import type { CodexNativeRendererApi, CodexSurfaceRendererApi } from '@codex-app-sdk/electron';

// Globals exposed by the SDK preload bridge.

declare global {
  interface Window {
    codexAppSdkNative: CodexNativeRendererApi;
    codexSurface: CodexSurfaceRendererApi;
  }
}

export {};
