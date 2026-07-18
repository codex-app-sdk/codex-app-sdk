import type { CodexSurface } from '../node/codex-surface';
import {
  registerCodexNativeIpc,
  type CodexNativeMainDependencies,
  type CodexNativeMainOptions,
} from './codex-native-ipc';
import { registerCodexSurfaceIpc } from './codex-surface-ipc';
import type { IpcEventSender } from './typed-ipc';

export type CodexElectronMainOptions = CodexNativeMainDependencies & {
  native?: CodexNativeMainOptions;
  sender: IpcEventSender;
  surface: CodexSurface;
};

/** Installs the complete SDK-owned surface and native capability bridge. */
export function registerCodexElectronMain(options: CodexElectronMainOptions): () => void {
  const unregisterSurface = registerCodexSurfaceIpc(
    options.ipcMain,
    options.sender,
    options.surface,
  );
  try {
    const unregisterNative = registerCodexNativeIpc(options, options.native);
    return () => {
      unregisterNative();
      unregisterSurface();
    };
  } catch (error) {
    unregisterSurface();
    throw error;
  }
}
