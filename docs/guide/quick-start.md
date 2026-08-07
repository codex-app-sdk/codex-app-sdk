# Tour the generated targets

Begin with the canonical [scaffolding guide](/guide/scaffolding). This page
assumes an Electron or web target is already running and explains what the SDK
owns, what the host owns, and where the next change belongs.

## Shared runtime flow

Both targets converge on the same renderer contract and Vue components:

```text
Trusted Node host
  createCodexAppBackend()
    └─ CodexSurface
         └─ Codex app-server

Host adapter
  ├─ Electron: typed IPC + native capabilities
  └─ Web: authorized WebSocket lease

Vue renderer
  useCodexSurface(rendererApi)
    ├─ app-owned shell, sidebar, and panels
    └─ CodexConversationPane
```

Ordinary renderer code does not need app-server method names, Node APIs,
Electron objects, filesystem paths, or generated protocol types.

## Electron target

```text
Electron main
  createCodexAppBackend()
  registerCodexElectronMain()
        │
preload │ window.codexSurface + window.codexAppSdkNative
        ▼
Vue renderer
  useCodexSurface(window.codexSurface)
```

| File | What it already does | What you normally change |
| --- | --- | --- |
| `src/main/index.ts` | Creates the window and backend, registers the SDK bridge, enforces navigation policy, and closes the backend | Window policy, `surfaceOptions`, MCP definitions, backend modules, and app-owned IPC |
| `src/main/preload.ts` | Exposes the surface and native renderer APIs | Add a narrow typed bridge only when an app-owned panel needs trusted host data |
| `src/renderer/App.vue` | Binds `useCodexSurface`, renders recent conversations, and mounts the stock pane | Navigation, branding, panels, empty states, and other product UI |
| `src/renderer/styles.css` | Defines the app shell and SDK theme tokens | Product colors, dimensions, typography, and layout |
| `vite.config.ts` | Builds Electron main, preload, and Vue renderer | Additional build entries such as a bundled local MCP server |

Customize the generated backend construction while retaining bridge
registration and shutdown:

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

Keep `registerCodexElectronMain({ surface: backend.surface, ... })`, the strict
`webPreferences`, navigation policy, and `backend.close()` lifecycle.

## Web target

```text
Node web server
  authenticateSiteRequest()
  acquireCodexSession()
  bindCodexWebSocket()
        │ authorized WebSocket lease
        ▼
Browser client
  createCodexWebSurfaceClient()
  useCodexSurface(api)
```

| File | What it already does | What you normally change |
| --- | --- | --- |
| `src/server/index.ts` | Serves the browser bundle, accepts one WebSocket path, authorizes it, and grants a backend surface lease | Website session lookup, origin policy, per-user backend/process acquisition, quotas, and uploads |
| `src/client/main.ts` | Creates the reconnecting browser surface API and mounts Vue | Socket URL or host-specific browser bootstrapping |
| `src/client/App.vue` | Uses the shared sidebar and conversation pane | The surrounding website/product shell and signed-in experience |
| `src/client/styles.css` | Defines the standalone sample shell and SDK theme tokens | Styles needed when embedding the pane in the larger site |
| `vite.config.ts` | Builds the browser bundle | Existing-site bundler integration |

The generated `authenticateSiteRequest()` and `acquireCodexSession()` seams are
local-demo placeholders. A production host replaces them with its own website
authentication and a stable per-user backend/process pool. The SDK does not own
users, cookies, tokens, `codexHome` mapping, databases, HTTP routes, or
deployment topology.

The web package also does not require Express or `ws`. Those dependencies are
used by the generated target to make the boundary concrete. Existing servers
can adapt any accepted socket to `CodexWebSocketPort` and mount the browser
client inside any page.

## Shared renderer seam

After the adapter creates a `CodexSurfaceRendererApi`, the Vue integration is
identical:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';

const surface = useCodexSurface(rendererApi);
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
| Data used only by app-owned UI | A backend module plus host-owned IPC or HTTP API |
| A capability the model should call | An app-owned MCP server |
| Per-conversation instructions or a small in-process tool | A surface extension or dynamic tool |
| Custom MCP tool icons or titles | Vue presentation providers |
| A different conversation layout | Pane slots or exported leaf components |

Continue with:

- [Electron integration](/guide/electron)
- [Web integration](/guide/web)
- [Add app-owned panels](/guide/app-ui)
- [Add an MCP server](/guide/mcp)
- [Add a backend service](/guide/backend)
- [Customize conversation presentation](/guide/presentation)

The [architecture guide](/guide/architecture) explains the package boundaries.
The [security guide](/guide/security) lists the invariants for both targets.
