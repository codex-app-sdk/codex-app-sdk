import type { CodexNativeRendererApi } from '@codex-app-sdk/core/native';
import type { CodexSurfaceRendererApi } from '@codex-app-sdk/core/surface';
import {
  createCodexNativeRendererApi,
  type CodexContextBridge,
} from './codex-native-renderer';
import { createCodexSurfaceRendererApi } from './codex-surface-ipc';
import type { IpcRendererPort } from './typed-ipc';

export type CodexElectronRendererApis = {
  native: CodexNativeRendererApi;
  surface: CodexSurfaceRendererApi;
};

/** Exposes the SDK-owned renderer APIs under stable, automatically detected names. */
export function exposeCodexElectronPreload(
  contextBridge: CodexContextBridge,
  ipcRenderer: IpcRendererPort,
  options?: { transcription?: boolean },
): CodexElectronRendererApis {
  const surface = createCodexSurfaceRendererApi(ipcRenderer);
  const native = createCodexNativeRendererApi(ipcRenderer, options);
  contextBridge.exposeInMainWorld('codexSurface', surface);
  contextBridge.exposeInMainWorld('codexAppSdkNative', native);
  return { native, surface };
}
