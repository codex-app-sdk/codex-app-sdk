# Installation

## Requirements

- Node.js 22 or newer
- Vue 3.5 or newer for `@codex-app-sdk/vue`
- Electron for the included desktop bridge
- A compatible Codex executable available to discovery, or an explicit
  transport command

The checked-in app-server bindings currently target `codex-cli 0.146.0`.

For a new Electron + Vue application, the fastest path is the
[project scaffolder](/guide/scaffolding). Continue below when integrating the
SDK into an existing application.

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
  @codex-app-sdk/web @codex-app-sdk/vue vue express ws
```

The package `prepare` script builds JavaScript, declarations, source maps, the
scoped stylesheet, and the native helper assets during installation.

## Package entry points

| Import | Purpose |
| --- | --- |
| `@codex-app-sdk/core` | Renderer-safe surface, event, attachment, and host-capability contracts |
| `@codex-app-sdk/backend` | Node runtime, app-server transports, `CodexSurface`, and `CodexAppBackend` |
| `@codex-app-sdk/electron` | Main/preload/renderer Electron integration and native capabilities |
| `@codex-app-sdk/electron/preload` | Context-bridge-safe preload exposure |
| `@codex-app-sdk/web/client` | Browser WebSocket surface client with bounded reconnect |
| `@codex-app-sdk/web/server` | Framework-neutral established-socket binding and authorized leases |
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
modes, and MCP definitions belong in the main process. They are intentionally
absent from the renderer creation API.
:::

## Repository development

```bash
git clone git@github.com:nbonamy/codex-app-sdk.git
cd codex-app-sdk
npm install
npm test
npm run typecheck
npm run build
```

Continue with the [tour of the generated application](/guide/quick-start) for
the recommended ownership boundaries, then use the advanced guides as a
checklist while adapting them to the existing host.
