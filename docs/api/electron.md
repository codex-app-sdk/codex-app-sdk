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
`reasoningEffort`, and `serviceTier`.

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

The native attachment bridge carries bounded renderer-safe image previews. It
does not expose local `file://` image sources to the renderer; restored local
images without a surviving preview fall back to a file chip.

Official remote-control pairing is intentionally a Node `CodexSurface` facade,
not a default renderer IPC method. Hosts that expose pairing UI should define a
narrow app-owned serialization boundary. See [Remote control](/guide/remote-control).

See the [Electron integration guide](/guide/electron) and
[security boundary](/guide/security).
