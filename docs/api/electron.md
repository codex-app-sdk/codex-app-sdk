# Electron bridge API

## Complete integration

### `registerCodexElectronMain(options)`

Registers the surface and native IPC handlers and returns one cleanup function.

```ts
type CodexElectronMainOptions = {
  surface: CodexSurface;
  sender: IpcEventSender;
  ipcMain: IpcMainPort;
  clipboard: CodexNativeClipboard;
  dialog: CodexNativeDialog;
  shell: CodexNativeShell;
  native?: CodexNativeMainOptions;
};
```

### `exposeCodexElectronPreload(contextBridge, ipcRenderer)`

Available from `codex-app-sdk/electron/preload`. Exposes both renderer APIs and
returns them as `CodexElectronRendererApis`.

## Surface IPC

- `registerCodexSurfaceIpc`
- `createCodexSurfaceRendererApi`
- `CodexSurfaceRendererApi`

The renderer variant narrows conversation creation to `approvalPreset`, `model`,
and `reasoningEffort`.

## Native IPC

- `registerCodexNativeIpc`
- `createCodexNativeRendererApi`
- `exposeCodexNativeRendererApi`
- `CodexNativeRendererApi`
- attachment, clipboard, and transcription contracts

### `CodexNativeMainOptions`

```ts
type CodexNativeMainOptions = {
  appleSpeechAssetsPath?: string;
  maxAttachmentBytes?: number;
  maxTotalAttachmentBytes?: number;
  maxAudioBytes?: number;
  transcribeAudio?: (audioData, options?) => Promise<AppleSpeechTranscriptionResult>;
};
```

## Typed IPC primitives

For applications composing the integration with an existing IPC system:

- `TypedIpcMain`
- `TypedIpcRenderer`
- `registerIpcMainHandlers`
- `connectIpcEventsToBus`
- `sendIpcEvent`
- `IpcRequest`, `IpcRequestArguments`, and `IpcRequestResult`
- main/renderer port and handler types

The helpers validate method names, argument shapes at the integration boundary,
listener cleanup, and request/event typing.

See the [Electron integration guide](/guide/electron) and
[security boundary](/guide/security).
