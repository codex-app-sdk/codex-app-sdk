export {
  connectIpcEventsToBus,
  registerIpcMainHandlers,
  sendIpcEvent,
  TypedIpcMain,
  TypedIpcRenderer,
  type IpcEventSender,
  type IpcMainHandlers,
  type IpcMainPort,
  type IpcRendererPort,
  type IpcRequest,
  type IpcRequestArguments,
  type IpcRequestResult,
} from './typed-ipc';
export {
  createCodexSurfaceRendererApi,
  registerCodexSurfaceIpc,
  type CodexSurfaceRendererApi,
} from './codex-surface-ipc';
