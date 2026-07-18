# Installation

## Requirements

- Node.js 22 or newer
- Vue 3.5 or newer for `codex-app-sdk/vue`
- Electron for the included desktop bridge
- A compatible Codex executable available to discovery, or an explicit
  transport command

The checked-in app-server bindings currently target `codex-cli 0.144.1`.

## Install from the repository

The package is source-first and not yet published to npm:

```bash
npm install github:nbonamy/codex-app-sdk vue
npm install --save-dev electron
```

The package `prepare` script builds JavaScript, declarations, source maps, the
scoped stylesheet, and the native helper assets during installation.

## Package entry points

| Import | Purpose |
| --- | --- |
| `codex-app-sdk/node` | High-level surface, stdio transport, executable discovery, extensions, MCP, history adapters |
| `codex-app-sdk/electron` | Main-process integration, native bridge, and reusable typed IPC |
| `codex-app-sdk/electron/preload` | Context-bridge-safe preload exposure |
| `codex-app-sdk/vue` | Surface controller and complete Vue component kit |
| `codex-app-sdk/styles.css` | Scoped default UI and public semantic tokens |
| `codex-app-sdk/surface` | Framework-neutral serializable contracts |
| `codex-app-sdk/events` | Framework-neutral typed event bus |
| `codex-app-sdk/codex` | Generated protocol types and advanced app-server client |

## Import the component theme

Import the stylesheet exactly once in the renderer entry or root component:

```ts
import 'codex-app-sdk/styles.css';
```

All SDK styles are scoped under `.codex-chat-theme`; they do not reset `html`,
`body`, your app root, or unrelated host components.

## Executable discovery

When no transport command is configured, the Node runtime searches common
desktop-app locations, including login-shell paths, Homebrew, user bin folders,
nvm installations, and Windows `PATHEXT` candidates.

Override discovery only when the host deliberately manages a specific binary:

```ts
import { createCodexSurface } from 'codex-app-sdk/node';

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

Continue with the [quick start](/guide/quick-start).
