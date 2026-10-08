# Electron bridge API

## Complete integration

### `registerCodexElectronMain(options)`

Registers the surface and native IPC handlers and returns one cleanup function.
It creates one `CodexElectronAttachmentRegistry` shared by both handler sets,
so renderer references are resolved to trusted paths only at the main-process
surface boundary.

```ts
type CodexElectronMainOptions = {
  surface: CodexSurface;
  sender: IpcEventSender;
  ipcMain: IpcMainPort;
  clipboard: CodexNativeClipboard;
  dialog: CodexNativeDialog;
  shell: CodexNativeShell;
  native?: CodexNativeMainOptions;
  /** Rejects surface and native invocations before their handlers run when false. */
  isTrustedSender?: (event: unknown) => boolean;
};
```

### Window policy

- `installCodexWindowPolicy(webContents, { rendererUrl, openExternal })` keeps a
  window on its renderer. It denies new windows and navigations away from
  `rendererUrl` (same origin for dev servers, same file for packaged `file:`
  renderers), and passes only `http(s)`, `mailto`, and `tel` URLs to
  `openExternal`.
- `isCodexRendererSender(event, rendererUrl)` accepts only the main frame of a
  window currently showing the renderer. Pass it as `isTrustedSender`.
- `isCodexRendererUrl(url, rendererUrl)` and `codexExternalUrl(url)` expose the
  underlying checks.

### `exposeCodexElectronPreload(contextBridge, ipcRenderer)`

Available from `@codex-app-sdk/electron/preload`. Exposes both renderer APIs and
returns them as `CodexElectronRendererApis`.

## Surface IPC

- `registerCodexSurfaceIpc`
- `createCodexSurfaceRendererApi`
- `CodexSurfaceRendererApi`

The renderer variant narrows conversation creation to `approvalPreset`, `model`,
`reasoningEffort`, and `serviceTier`.

State crosses IPC as full snapshots until the renderer calls
`getVersionedSnapshot()`. When the surface supports state patches
(`CodexSurface` does), the main process then streams small structural patches
instead. `useCodexSurface` mirrors them in the renderer's own world, so
unchanged messages keep their object identity and do not re-render. Renderers
that never ask keep receiving snapshots.

## Native IPC

- `registerCodexNativeIpc`
- `createCodexNativeRendererApi`
- `exposeCodexNativeRendererApi`
- `CodexNativeRendererApi`
- attachment, clipboard, and transcription contracts
- `CodexElectronAttachmentRegistry` for custom composed integrations

### `CodexNativeMainOptions`

```ts
type CodexNativeMainOptions = {
  appleSpeechAssetsPath?: string;
  maxAttachmentBytes?: number;
  maxTotalAttachmentBytes?: number;
  maxAudioBytes?: number;
  maxImagePreviewBytes?: number;
  startSpeechSession?: typeof startAppleSpeechSession;
  transcribeAudio?: (audioData, options?) => Promise<AppleSpeechTranscriptionResult>;
};
```

### Streaming dictation

The default macOS preload exposes `streamingTranscription` on
`CodexHostCapabilities`. `createCodexNativeRendererApi` and
`exposeCodexNativeRendererApi` accept `streamingTranscription?: boolean` to
enable or disable it; `transcription: false` disables both modes. Hosts with a
custom batch-only service should set `streamingTranscription: false`.

```ts
type CodexStreamingTranscription = {
  start(options: { sessionId: string; sampleRate: number; locale?: string }): Promise<void>;
  append(sessionId: string, audio: ArrayBuffer): Promise<void>;
  stop(sessionId: string): Promise<{ text: string; error?: string }>;
  cancel(sessionId: string): Promise<void>;
  onEvent(listener: (event: CodexSpeechSessionEvent) => void): () => void;
};
```

Each audio chunk is mono Float32 little-endian PCM, delivered once, in order.
Await each append before sending the next. Transcript events contain
`{ type: 'transcript', sessionId, finalText, partialText }`; replace the current
snapshot on corrections. Error events contain `{ type: 'error', sessionId, error }`.
`stop()` drains pending recognition and returns the authoritative final text.
`cancel()` discards it. Subscribe before starting and unsubscribe on teardown;
ignore events from any other session ID.

The main bridge permits one active session per renderer and binds it to the
invoking frame. Replacing that frame's document or the main document, renderer
destruction, and bridge disposal cancel recording. Same-document navigation and
unrelated iframe navigation leave recording active. Requests use the same
`isTrustedSender` policy as other native APIs.
Audio is limited to 256 KiB per chunk and `maxAudioBytes` total (25 MiB by default,
about 6.8 minutes at 16 kHz). Use unique IDs for successive recordings.

Native recognition requires a supported Mac running macOS 26 or later and an
available Apple speech model for the locale. Missing model assets can require
a first-use download; recognition itself stays on device. Unsupported or failed
native sessions report an error, not invented provisional text.

For source-mode development, point `appleSpeechAssetsPath` (or
`CODEX_APP_SDK_ASSETS_PATH`) at the source SDK's `packages/backend/assets` so
the native helper matches the source API. Packaged apps should use the helper
from the same SDK version as their bridge.

`CodexNativeRendererApi.readImagePreview?(reference)` lazily requests a bounded,
non-SVG local image as a renderer-safe data URL. It returns `null` when the file
is missing, unsupported, or larger than `maxImagePreviewBytes` (8 MiB by
default). The optional method keeps custom/older preload implementations
backward compatible.

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
does not expose local `file://` image sources to the renderer; restored
SDK-ingested temporary images are read on demand through the native bridge,
while missing or reclaimed files fall back to a file chip.

Official remote-control pairing is intentionally a Node `CodexSurface` facade,
not a default renderer IPC method. Hosts that expose pairing UI should define a
narrow app-owned serialization boundary. See [Remote control](/guide/remote-control).

See the [Electron integration guide](/guide/electron) and
[security boundary](/guide/security).
