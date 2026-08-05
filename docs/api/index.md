# API entry points

The package exposes intentional layer-specific entry points. Import from the
narrowest entry point that owns the capability you need.

| Entry point | Runtime | Main exports |
| --- | --- | --- |
| `codex-app-sdk/node` | Node / Electron main | `CodexSurface`, `CodexAppBackend`, `CodexAppBackendTtlCache`, stdio transport, discovery, extensions, MCP, history and transcription adapters |
| `codex-app-sdk/electron` | Electron main + types | Complete bridge, native bridge, typed IPC composition |
| `codex-app-sdk/electron/preload` | Electron preload | `exposeCodexElectronPreload` and preload-safe types |
| `codex-app-sdk/vue` | Vue renderer | Controller, pane, composer, messages, tools, media, theme, utilities |
| `codex-app-sdk/styles.css` | Renderer CSS | Complete scoped component theme |
| `codex-app-sdk/surface` | Any TypeScript runtime | Serializable snapshots, actions, messages, approvals, and event contracts |
| `codex-app-sdk/events` | Any TypeScript runtime | Generic typed event bus |
| `codex-app-sdk/codex` | Trusted advanced host | Generated app-server schema, typed client, wire contracts |
| `codex-app-sdk` | Mixed | Aggregate core exports; prefer layer entry points in applications |

## Typical imports

```ts
// Electron main
import { createCodexAppBackend } from 'codex-app-sdk/node';
import { registerCodexElectronMain } from 'codex-app-sdk/electron';

// Preload
import { exposeCodexElectronPreload } from 'codex-app-sdk/electron/preload';

// Vue renderer
import {
  CodexConversationPane,
  useCodexSurface,
} from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';
```

The [scaffold](/guide/scaffolding) wires these imports together. Use the entry
point table when adding a capability to that generated baseline.

## Stability boundary

The surface, Electron, Vue, and semantic event contracts are product-shaped.
The `codex` entry point follows the generated app-server schema more directly
and may change when bindings are regenerated.

Use raw generated types in trusted integration code only. Do not make ordinary
renderer components depend on them.

The [JSON-RPC coverage inventory](./json-rpc) tracks which generated app-server
methods are projected by the high-level SDK and which remain low-level only.

For the major composed contracts, start with
[conversation pane integration](/guide/conversation-pane),
[history and performance](/guide/history), or
[remote control](/guide/remote-control) before dropping to individual types.
