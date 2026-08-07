# `@codex-app-sdk/electron`

Electron adapter for Codex applications. It binds one authorized backend
surface to typed main/preload/renderer IPC and provides native attachments,
clipboard, external links, image previews, and Apple speech transcription.

```bash
npm install @codex-app-sdk/backend @codex-app-sdk/core \
  @codex-app-sdk/electron
```

```ts
// Electron main
import { registerCodexElectronMain } from '@codex-app-sdk/electron';

const unregister = registerCodexElectronMain({
  surface: backend.surface,
  ipcMain,
  sender: { send: (channel, payload) => window.webContents.send(channel, payload) },
  clipboard,
  dialog,
  shell,
});
```

```ts
// Preload
import { exposeCodexElectronPreload } from '@codex-app-sdk/electron/preload';

exposeCodexElectronPreload(contextBridge, ipcRenderer);
```

The complete registration owns one attachment registry, so renderer-safe
references become filesystem paths only immediately before the trusted backend
call. Keep context isolation and renderer sandboxing enabled.

See the [Electron integration
guide](https://nbonamy.github.io/codex-app-sdk/guide/electron) and [Electron
API](https://nbonamy.github.io/codex-app-sdk/api/electron).
