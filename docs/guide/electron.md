# Electron integration

The Electron package provides one high-level registration function and reusable
lower-level pieces for applications with an existing IPC framework.

The [project scaffold](/guide/scaffolding) already applies the complete bridge,
preload, window-security, navigation, and shutdown pattern below. Keep that
generated wiring unless you are integrating the SDK into an existing Electron
application or deliberately composing a custom IPC layer.

## Complete bridge

```ts
import { registerCodexElectronMain } from '@codex-app-sdk/electron';

const unregister = registerCodexElectronMain({
  clipboard,
  dialog,
  ipcMain,
  shell,
  surface,
  sender: {
    send: (channel, payload) => mainWindow.webContents.send(channel, payload),
  },
  native: {
    maxAttachmentBytes: 25 * 1024 * 1024,
    maxTotalAttachmentBytes: 100 * 1024 * 1024,
    maxAudioBytes: 25 * 1024 * 1024,
  },
});
```

Registration installs:

- the surface action/snapshot/event IPC contract;
- native attachment picker and ingestion handlers;
- clipboard writes;
- supported-protocol external-link opening;
- audio transcription;
- cleanup for temporary attachment directories and every handler.

Call the returned function before destroying the integration.

## Preload

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeCodexElectronPreload } from '@codex-app-sdk/electron/preload';

exposeCodexElectronPreload(contextBridge, ipcRenderer);
```

This exposes:

- `window.codexSurface`: renderer-safe surface snapshots and actions;
- `window.codexAppSdkNative`: native capability flags and methods.

The preload entry is renderer-only and does not import the main-process
integration module.

## Window security

```ts
const window = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: preloadPath,
  },
});
```

Also deny renderer navigation and decide deliberately which protocols may open
externally. The SDK validates `http`, `https`, `mailto`, and `tel` protocols; it
does not implement a product-specific hostname allowlist.

## Compose with existing IPC

Advanced hosts can use these exports independently:

- `registerCodexSurfaceIpc`
- `registerCodexNativeIpc`
- `createCodexSurfaceRendererApi`
- `createCodexNativeRendererApi`
- `TypedIpcMain` and `TypedIpcRenderer`
- `registerIpcMainHandlers`, `connectIpcEventsToBus`, and `sendIpcEvent`

Keep the high-level contract intact even when composing the pieces yourself.

See the [Electron API reference](/api/electron).
