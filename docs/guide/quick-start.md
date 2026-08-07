# Tour the generated application

Begin with the canonical [scaffolding guide](/guide/scaffolding). This page
assumes the generated application is already running and explains what you own,
what the SDK owns, and where the next change belongs.

## Runtime flow

```text
Electron main
  createCodexAppBackend()
    └─ CodexSurface
         └─ Codex app-server

registerCodexElectronMain()
  └─ typed IPC + native capabilities

preload
  └─ window.codexSurface + window.codexAppSdkNative

Vue renderer
  useCodexSurface(window.codexSurface)
    ├─ app-owned sidebar and panels
    └─ CodexConversationPane
```

The scaffold uses the high-level path deliberately. Ordinary renderer code
does not need app-server methods, Node APIs, Electron objects, or generated
protocol types.

## Generated files and ownership

| File | What it already does | What you normally change |
| --- | --- | --- |
| `src/main/index.ts` | Creates the window and `CodexAppBackend`, registers the SDK bridge, enforces navigation policy, and closes the backend | Window policy, `surfaceOptions`, MCP definitions, backend modules, and app-owned IPC |
| `src/main/preload.ts` | Exposes the two SDK renderer APIs | Add a narrow typed bridge only when an app-owned panel needs trusted host data |
| `src/renderer/App.vue` | Binds `useCodexSurface`, renders recent conversations, and mounts `CodexConversationPane` | Navigation, branding, panels, empty states, and other product UI |
| `src/renderer/styles.css` | Defines the app shell, native macOS sidebar material, and SDK theme tokens | Product colors, dimensions, typography, and panel layout |
| `vite.config.ts` | Builds Electron main, preload, and Vue renderer | Additional build entries such as a bundled local MCP server |

## The main-process seam

The generated main process already contains the complete lifecycle. Do not
replace it with a smaller hand-built example. Customize the existing backend
construction:

```ts
backend = createCodexAppBackend({
  surfaceOptions: {
    clientInfo: {
      name: 'my_codex_app',
      title: 'My Codex App',
      version: '0.1.0',
    },
    permissionMode: 'workspace-write',
  },
  modules: [
    // App-owned services belong here.
  ],
});
```

Keep the generated `registerCodexElectronMain({ surface: backend.surface, ... })`
call and shutdown handling. They are infrastructure, not customization points.

## The renderer seam

`App.vue` owns the product shell. The SDK controller supplies conversation
state and actions; the stock pane owns the conversation experience:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';

const surface = useCodexSurface(window.codexSurface);
</script>

<template>
  <main class="app-shell">
    <MyNavigation />
    <CodexConversationPane :surface="surface" autofocus />
    <MyInspectorPanel />
  </main>
</template>
```

Your components may read `surface.state` and call controller actions such as
`createConversation()` and `selectConversation()`. They should not reproduce
composer, message, approval, queue, or history behavior already owned by
`CodexConversationPane`.

## Decide where a feature belongs

| You want to add… | Put it here |
| --- | --- |
| A sidebar, toolbar, inspector, canvas, dashboard, or settings screen | App-owned Vue components around the pane |
| Data used only by app-owned UI | A backend module plus narrow app-owned IPC |
| A capability the model should call | An app-owned MCP server |
| Per-conversation instructions or a small in-process tool | A surface extension or dynamic tool |
| Custom MCP tool icons or titles | Vue presentation providers |
| A different conversation layout | Pane slots or exported leaf components |

Continue with:

- [Add app-owned panels](/guide/app-ui)
- [Add an MCP server](/guide/mcp)
- [Add a backend service](/guide/backend)
- [Customize conversation presentation](/guide/presentation)

## Preserve the baseline

As the application grows:

- keep `contextIsolation: true`, `nodeIntegration: false`, and renderer
  sandboxing;
- keep Codex configuration and credentials in Electron main;
- keep the generated navigation policy unless the product deliberately replaces
  it with an equally strict policy;
- close `CodexAppBackend` during application shutdown;
- extend the renderer bridge with serializable, validated, product-shaped data.

The [architecture guide](/guide/architecture) explains why these boundaries
exist. The [security guide](/guide/security) lists the invariants in detail.
