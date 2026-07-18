# Quick start

This is the complete three-layer path: create the surface in Electron main,
expose the SDK APIs from preload, and bind the conversation pane in Vue.

## 1. Main process

Create one surface and register the surface plus native-capability IPC after the
Electron app is ready.

```ts
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import { registerCodexElectronMain } from 'codex-app-sdk/electron';
import { createCodexSurface } from 'codex-app-sdk/node';

await app.whenReady();

const mainWindow = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(import.meta.dirname, 'preload.cjs'),
    sandbox: true,
  },
});

const surface = createCodexSurface();

const unregisterSdk = registerCodexElectronMain({
  clipboard,
  dialog,
  ipcMain,
  shell,
  surface,
  sender: {
    send: (channel, payload) => mainWindow.webContents.send(channel, payload),
  },
});

app.on('before-quit', () => {
  unregisterSdk();
  void surface.close();
});
```

Load your development URL or production renderer file as usual. The
[Basic sample on GitHub](https://github.com/nbonamy/codex-app-sdk/tree/main/samples/basic)
shows a complete navigation policy and development/production loader.

## 2. Preload

The SDK preload exposes two narrow APIs through `contextBridge`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeCodexElectronPreload } from 'codex-app-sdk/electron/preload';

exposeCodexElectronPreload(contextBridge, ipcRenderer);
```

Declare the globals once for the renderer:

```ts
import type {
  CodexNativeRendererApi,
  CodexSurfaceRendererApi,
} from 'codex-app-sdk/electron';

declare global {
  interface Window {
    codexAppSdkNative: CodexNativeRendererApi;
    codexSurface: CodexSurfaceRendererApi;
  }
}

export {};
```

## 3. Vue renderer

Bind the typed renderer API to reactive state and pass the controller to the
stock pane:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';

const surface = useCodexSurface(window.codexSurface);
</script>

<template>
  <main class="app-shell">
    <CodexConversationPane
      :surface="surface"
      autofocus
    />
  </main>
</template>
```

The pane connects when mounted, renders the active app-server conversation, and
wires standard actions, approvals, models, goals, attachments, image paste/drop,
copy, and speech transcription through the SDK APIs.

## Add an app-owned conversation list

The SDK owns conversation data and actions. Your application owns how a list is
rendered:

```vue
<template>
  <aside>
    <button @click="surface.createConversation()">New conversation</button>

    <button
      v-for="conversation in surface.state.conversations"
      :key="conversation.id"
      @click="surface.selectConversation(conversation.id)"
    >
      {{ conversation.title || 'Untitled conversation' }}
    </button>
  </aside>

  <CodexConversationPane :surface="surface" />
</template>
```

That is the intended application boundary: custom product chrome, stock Codex
conversation system.

## Next

- [Configure the surface runtime](/guide/surface)
- [Run concurrent conversations](/guide/conversations)
- [Customize the pane](/guide/presentation)
