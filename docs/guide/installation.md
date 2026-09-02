# Installation

## Requirements

- Node.js 22 or newer
- Vue 3.5 or newer for `@codex-app-sdk/vue`
- Electron only when using the desktop bridge
- An HTTP/WebSocket server implementation only when using the web bridge
- A compatible Codex executable available to discovery, or an explicit
  transport command

The checked-in app-server bindings currently target `codex-cli 0.146.0`.

During connection, `CodexSurface` negotiates image-aware compaction with the
running app-server. When `compaction_image_budget` is advertised but disabled,
the SDK enables it for that app-server process before loading conversations.
Older app-server releases that do not expose feature discovery remain usable,
but cannot receive this compatibility improvement; hosts should ship a current
stable Codex executable for reliable compaction of image-heavy threads.

For a new application, the fastest path is the [project
scaffolder](/guide/scaffolding): Electron is the default and `--target web`
creates a runnable Express + `ws` baseline. Continue below when integrating the
SDK into an existing host.

::: warning Package publication pending
The scoped SDK packages and `create-codex-app` are not yet published to npm.
The npm commands below are the intended public API; use the repository source
workflow at the end of this section until publication.
:::

## Install from npm

Add the SDK to an existing Electron + Vue application:

```bash
npm install @codex-app-sdk/backend @codex-app-sdk/core \
  @codex-app-sdk/electron @codex-app-sdk/vue vue
npm install --save-dev electron
```

For a Node web host and Vue browser surface:

```bash
npm install @codex-app-sdk/backend @codex-app-sdk/core \
  @codex-app-sdk/web @codex-app-sdk/vue vue
npm install express ws # only for this host implementation
```

Express and `ws` are sample host choices, not SDK dependencies. The web package
accepts an established `CodexWebSocketPort`; an existing Node server may use
`createCodexNodeWebSocketPort()` for a compatible socket or supply its own
adapter.

## Package entry points

| Import | Purpose |
| --- | --- |
| `@codex-app-sdk/core` | Renderer-safe surface, event, attachment, and host-capability contracts |
| `@codex-app-sdk/backend` | Node runtime, app-server transports, `CodexSurface`, and `CodexAppBackend` |
| `@codex-app-sdk/electron` | Main/preload/renderer Electron integration and native capabilities |
| `@codex-app-sdk/electron/preload` | Context-bridge-safe preload exposure |
| `@codex-app-sdk/web` | Convenience re-exports for the web transport |
| `@codex-app-sdk/web/client` | Browser WebSocket surface client with bounded reconnect |
| `@codex-app-sdk/web/server` | Framework-neutral established-socket binding and authorized leases |
| `@codex-app-sdk/web/protocol` | Versioned envelopes for custom transport integrations |
| `@codex-app-sdk/vue` | Surface controller, complete Vue component kit, and styles |

The root `codex-app-sdk` package retains compatibility entry points during the
modular transition. New applications should use the scoped packages directly.

## Import the component theme

Import the stylesheet exactly once in the renderer entry or root component:

```ts
import '@codex-app-sdk/vue/styles.css';
```

All SDK styles are scoped under `.codex-chat-theme`; they do not reset `html`,
`body`, your app root, or unrelated host components.

## Executable discovery

When no transport command is configured, the Node runtime searches common
desktop-app locations, including login-shell paths, Homebrew, user bin folders,
nvm installations, and Windows `PATHEXT` candidates.

Override discovery only when the host deliberately manages a specific binary:

```ts
import { createCodexSurface } from '@codex-app-sdk/backend';

const surface = createCodexSurface({
  transport: {
    command: '/absolute/path/to/codex',
  },
});
```

::: warning Keep transport configuration trusted
The executable command, arguments, environment, `CODEX_HOME`, raw permission
modes, and MCP definitions belong in the trusted Node host. They are
intentionally absent from the renderer creation API.
:::

## Repository development

```bash
git clone git@github.com:nbonamy/codex-app-sdk.git
cd codex-app-sdk
npm install
npm run check
npm run dev:docs
```

`npm run check` covers the SDK packages, compatibility facade, scaffolder,
samples, generated JSON-RPC inventory, and VitePress build. Use
`npm run test:ai` for a compact test-only pass while iterating. Sample `dev:*`
commands resolve SDK source directly and do not require a prior package build.

Continue with the [tour of the generated targets](/guide/quick-start) for
the recommended ownership boundaries, then use the advanced guides as a
checklist while adapting them to the existing host.
