# `@codex-app-sdk/backend`

Trusted Node.js runtime for Codex applications. It owns app-server protocol and
process lifecycle, transports, `CodexSurface`, and `CodexAppBackend`.

```bash
npm install @codex-app-sdk/backend @codex-app-sdk/core
```

```ts
import { createCodexAppBackend } from '@codex-app-sdk/backend';

const backend = createCodexAppBackend({
  surfaceOptions: {
    clientInfo: { name: 'my_app', title: 'My App', version: '0.1.0' },
  },
});

await backend.surface.connect();
// Grant backend.surface to one trusted Electron or web adapter.
```

The trusted surface also exposes state-neutral helpers for app-owned workflows:
`generateText()` runs an ephemeral read-only turn, while
`readConversationSummary()` and `readConversationPromptHistory()` retrieve
bounded metadata or user-only prompt history without hydrating a full thread
into renderer state.

Use `@codex-app-sdk/backend/protocol` only for low-level app-server methods not
yet projected by `CodexSurface`. Renderer code must use
`@codex-app-sdk/core` plus a host adapter instead of importing this package.

The backend does not own website users, authentication sessions, business data,
token storage, or process-pool policy. See the [runtime
guide](https://nbonamy.github.io/codex-app-sdk/guide/surface) and [Node
API](https://nbonamy.github.io/codex-app-sdk/api/node). The generated
[JSON-RPC coverage inventory](https://nbonamy.github.io/codex-app-sdk/api/json-rpc)
shows which app-server methods have a high-level SDK projection and which remain
available only through the trusted protocol client.
