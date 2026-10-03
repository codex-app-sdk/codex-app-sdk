import type { CodexSurface } from '@codex-app-sdk/backend';
import {
  registerCodexNativeIpc,
  type CodexNativeMainDependencies,
  type CodexNativeMainOptions,
} from './codex-native-ipc';
import { registerCodexSurfaceIpc } from './codex-surface-ipc';
import type { IpcEventSender, IpcSenderPolicy } from './typed-ipc';
import { CodexElectronAttachmentRegistry } from './codex-attachment-registry';

export type CodexElectronMainOptions = CodexNativeMainDependencies & IpcSenderPolicy & {
  native?: CodexNativeMainOptions;
  sender: IpcEventSender;
  surface: CodexSurface;
};

/** Installs the complete SDK-owned surface and native capability bridge. */
export function registerCodexElectronMain(options: CodexElectronMainOptions): () => void {
  const attachments = new CodexElectronAttachmentRegistry();
  const senderPolicy = options.isTrustedSender ? { isTrustedSender: options.isTrustedSender } : {};
  const unregisterSurface = registerCodexSurfaceIpc(
    options.ipcMain,
    options.sender,
    options.surface,
    { ...senderPolicy, resolveAttachment: (attachment) => attachments.resolve(attachment) },
  );
  try {
    const unregisterNative = registerCodexNativeIpc(options, { ...options.native, ...senderPolicy }, attachments);
    return () => {
      unregisterNative();
      unregisterSurface();
    };
  } catch (error) {
    unregisterSurface();
    throw error;
  }
}
