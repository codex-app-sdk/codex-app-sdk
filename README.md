# Codex App SDK

Build complete desktop and web Codex experiences without rebuilding app-server
process management, transport bridges, conversation state, and chat UI in every app.

[![Documentation](https://github.com/nbonamy/codex-app-sdk/actions/workflows/deploy-docs.yml/badge.svg)](https://nbonamy.github.io/codex-app-sdk/)
[![License](https://img.shields.io/badge/license-Apache--2.0-0b7a65.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933.svg)](./package.json)
[![Vue](https://img.shields.io/badge/vue-%3E%3D3.5-42b883.svg)](https://vuejs.org/)

**[Read the full documentation →](https://nbonamy.github.io/codex-app-sdk/)**

Codex App SDK is a set of five focused packages around Codex app-server. The
SDK owns reusable Codex plumbing, renderer-safe contracts, desktop/web
transports, and the conversation experience. Your app owns its product shell,
authentication, tenancy, policy, business data, and integrations.

| Package | Responsibility |
| --- | --- |
| `@codex-app-sdk/core` | Renderer-safe surface, event, attachment, and host-capability contracts |
| `@codex-app-sdk/backend` | Trusted Node app-server lifecycle, `CodexSurface`, and backend composition |
| `@codex-app-sdk/electron` | Electron IPC, preload exposure, and native desktop capabilities |
| `@codex-app-sdk/web` | Framework-neutral WebSocket server binding and browser client |
| `@codex-app-sdk/vue` | Shared sidebar, conversation pane, composer, messages, tools, and theme |

## What you get

- App-server discovery, startup, initialization, reconnects, and typed protocol
  handling.
- Persisted conversation discovery plus several concurrently streaming threads.
- Authentication, models, skills, plugins, permissions, approvals, plans,
  goals, reviews, rate limits, and restored history.
- A validated main/preload/renderer IPC boundary for Electron.
- A framework-neutral WebSocket bridge for browser surfaces, with no Express or
  WebSocket implementation dependency.
- Native attachments, image paste/drop, clipboard actions, and macOS speech
  transcription.
- `CodexConversationPane` with prompt recall, editable queues, double-Escape
  interruption, tools, generated media, code copying, context usage, and
  customization hooks.
- Renderer-safe restored images with stock fullscreen, clipboard, and download
  actions, plus host-owned image and visualization actions.
- A grouped controlled-pane adapter for hosts that own conversation state
  outside the SDK surface.
- Host extensions, dynamic tools, trusted per-surface or per-conversation MCP
  servers, headless sub-agent events, and ephemeral backend text generation.

## A deliberately small renderer

Both host adapters provide `CodexSurfaceRendererApi`. Electron exposes it from
preload; web applications create it with `@codex-app-sdk/web/client`. The Vue
code after that boundary is the same:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';
import '@codex-app-sdk/vue/styles.css';

const surface = useCodexSurface(rendererApi);
</script>

<template>
  <MyConversationList
    :conversations="surface.state.conversations"
    :active-id="surface.state.activeConversationId"
    @create="surface.createConversation()"
    @select="surface.selectConversation($event)"
  />
  <CodexConversationPane :surface="surface" />
</template>
```

No raw JSON-RPC method names, generated app-server payloads, Node primitives,
filesystem paths, or Electron objects need to cross into ordinary renderer
code. See the [Electron](https://nbonamy.github.io/codex-app-sdk/guide/electron)
and [web](https://nbonamy.github.io/codex-app-sdk/guide/web) guides for how each
host creates `rendererApi`.

## Start here

The default scaffold is a complete Electron + Vue application. Pass
`--target web` for an Express + `ws` host using the same backend, surface, and
Vue pane. Then update the generated host seams and shell for your product. The
[scaffolding guide](https://nbonamy.github.io/codex-app-sdk/guide/scaffolding)
is the canonical source for commands, package-publication status, and options.
For an existing application, follow the
[installation guide](https://nbonamy.github.io/codex-app-sdk/guide/installation).

- [Scaffold an application](https://nbonamy.github.io/codex-app-sdk/guide/scaffolding)
- [Tour the generated targets](https://nbonamy.github.io/codex-app-sdk/guide/quick-start)
- [Add app-owned panels](https://nbonamy.github.io/codex-app-sdk/guide/app-ui)
- [Add an MCP server](https://nbonamy.github.io/codex-app-sdk/guide/mcp)
- [Add a backend service](https://nbonamy.github.io/codex-app-sdk/guide/backend)
- [Existing app installation](https://nbonamy.github.io/codex-app-sdk/guide/installation)
- [Architecture](https://nbonamy.github.io/codex-app-sdk/guide/architecture)
- [Web integration](https://nbonamy.github.io/codex-app-sdk/guide/web)
- [Vue conversation kit](https://nbonamy.github.io/codex-app-sdk/guide/vue)
- [Controlled pane integration](https://nbonamy.github.io/codex-app-sdk/guide/conversation-pane)
- [History and performance](https://nbonamy.github.io/codex-app-sdk/guide/history)
- [Vue providers](https://nbonamy.github.io/codex-app-sdk/guide/vue-providers)
- [API reference](https://nbonamy.github.io/codex-app-sdk/api/)
- [JSON-RPC coverage inventory](https://nbonamy.github.io/codex-app-sdk/api/json-rpc)

## Samples

| Sample | Product shape | Run |
| --- | --- | --- |
| [Basic](./samples/electron/basic) | Shared conversation sidebar and the full stock pane over Electron | `npm run dev:electron` |
| [Component lab](./samples/component-lab) | Fully mocked conversation, composer, streaming, and lifecycle scenarios | `npm run dev:lab` |
| [Spark](./samples/electron/spark) | Focused themed chat with isolated auth and fixed defaults | `npm run dev:spark` |
| [Relay](./samples/electron/relay) | Logistics operations UI backed by an app-owned MCP server | `npm run dev:relay` |
| [Basic web](./samples/web/basic) | The Basic shell over a thin Express/`ws` host | `npm run dev:web` |

The development commands resolve the five SDK packages directly from source.
They do not require `npm run build` first, and renderer changes under
`packages/vue` hot-reload through Vite.

The samples are product demonstrations, not templates for child safety or a
production logistics backend. See the
[sample guide](https://nbonamy.github.io/codex-app-sdk/guide/samples) for the
boundaries each one demonstrates.

## Develop

```bash
npm install
npm run check
npm run build:all
npm run dev:docs
```

`npm run check` covers the five SDK packages, compatibility facade,
scaffolder, all five samples, and the documentation build. Use the narrower
`test:*`, `typecheck:*`, `build:*`, and `dev:*` commands while iterating.

Build the documentation exactly as GitHub Pages does:

```bash
npm run build:docs
npm run preview:docs
```

The checked-in generated protocol bindings currently target
`codex-cli 0.151.0`. See the
[development guide](https://nbonamy.github.io/codex-app-sdk/guide/development)
before updating them.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
