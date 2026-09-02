# API entry points

The package exposes intentional layer-specific entry points. Import from the
narrowest entry point that owns the capability you need.

| Entry point | Runtime | Main exports |
| --- | --- | --- |
| `@codex-app-sdk/core` | Any TypeScript runtime | Renderer-safe surface, event, attachment, and host-capability contracts |
| `@codex-app-sdk/core/surface` | Any TypeScript runtime | Surface snapshots, actions, messages, and renderer-safe attachment options |
| `@codex-app-sdk/core/native` | Renderer-safe hosts | File/clipboard/link/transcription capability contracts |
| `@codex-app-sdk/core/events` | Any TypeScript runtime | Typed event bus primitives |
| `@codex-app-sdk/core/surface-bridge` | Host adapters | Validated surface operation dispatch shared by Electron and web |
| `@codex-app-sdk/backend` | Trusted Node host | `CodexSurface`, `CodexAppBackend`, transports, discovery, extensions, MCP, history adapters |
| `@codex-app-sdk/backend/protocol` | Trusted Node host | Low-level app-server client and generated protocol types |
| `@codex-app-sdk/electron` | Electron main + renderer types | Complete bridge, native capabilities, typed IPC composition |
| `@codex-app-sdk/electron/preload` | Electron preload | `exposeCodexElectronPreload` and preload-safe types |
| `@codex-app-sdk/web/client` | Browser | WebSocket-backed `CodexSurfaceRendererApi` and reconnect policy |
| `@codex-app-sdk/web/server` | Node or compatible server runtime | Established-socket binding, authorization callback, and surface lease |
| `@codex-app-sdk/vue` | Vue renderer | Controller, pane, composer, host-defined mentions, messages, tools, media, theme, utilities |
| `@codex-app-sdk/vue/styles.css` | Renderer CSS | Complete scoped component theme |
| `codex-app-sdk/*` | Compatibility | Previous aggregate entry points retained during migration |

## Typical imports

```ts
// Electron main
import { createCodexAppBackend } from '@codex-app-sdk/backend';
import { registerCodexElectronMain } from '@codex-app-sdk/electron';

// Preload
import { exposeCodexElectronPreload } from '@codex-app-sdk/electron/preload';

// Vue renderer
import {
  CodexConversationPane,
  useCodexSurface,
} from '@codex-app-sdk/vue';
import '@codex-app-sdk/vue/styles.css';
```

```ts
// Web server: use inside your existing upgrade/authentication flow
import {
  bindCodexWebSocket,
  createCodexNodeWebSocketPort,
} from '@codex-app-sdk/web/server';

// Browser
import {
  createCodexBrowserWebSocketPort,
  createCodexWebSurfaceClient,
} from '@codex-app-sdk/web/client';
```

The [scaffold](/guide/scaffolding) wires these imports together. Use the entry
point table when adding a capability to that generated baseline.

## Stability boundary

The surface, Electron, web, Vue, and semantic event contracts are
product-shaped. The `@codex-app-sdk/backend/protocol` entry point follows the
generated app-server schema more directly and may change when bindings are
regenerated.

Use raw generated types in trusted integration code only. Do not make ordinary
renderer components depend on them.

The [JSON-RPC coverage inventory](./json-rpc) tracks which generated app-server
methods are projected by the high-level SDK and which remain low-level only.

For the major composed contracts, start with
[conversation pane integration](/guide/conversation-pane),
[history and performance](/guide/history), or
[remote control](/guide/remote-control) before dropping to individual types.
