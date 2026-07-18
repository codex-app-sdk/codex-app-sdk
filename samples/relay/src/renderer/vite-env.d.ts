/// <reference types="vite/client" />

import type { CodexNativeRendererApi, CodexSurfaceRendererApi } from 'codex-app-sdk/electron';
import type { RelayOperationsRendererApi } from '../shared/relay-contracts';

declare global {
  interface Window {
    codexAppSdkNative: CodexNativeRendererApi;
    codexSurface: CodexSurfaceRendererApi;
    relayOperations: RelayOperationsRendererApi;
  }
}

export {};
