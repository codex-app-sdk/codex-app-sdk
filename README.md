# Codex App SDK

Build complete desktop Codex experiences without rebuilding app-server process
management, Electron IPC, conversation state, and chat UI in every app.

[![Documentation](https://github.com/nbonamy/codex-app-sdk/actions/workflows/deploy-docs.yml/badge.svg)](https://nbonamy.github.io/codex-app-sdk/)
[![License](https://img.shields.io/badge/license-Apache--2.0-0b7a65.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933.svg)](./package.json)
[![Vue](https://img.shields.io/badge/vue-%3E%3D3.5-42b883.svg)](https://vuejs.org/)

**[Read the full documentation →](https://nbonamy.github.io/codex-app-sdk/)**

`codex-app-sdk` is a high-level runtime, a narrow typed Electron bridge, and a
full Vue conversation kit for Codex app-server. The SDK owns the reusable Codex
plumbing and conversation experience. Your app owns its product shell, policy,
business data, and integrations.

## What you get

- App-server discovery, startup, initialization, reconnects, and typed protocol
  handling.
- Persisted conversation discovery plus several concurrently streaming threads.
- Authentication, models, skills, plugins, permissions, approvals, plans,
  goals, reviews, rate limits, and restored history.
- A validated main/preload/renderer IPC boundary for Electron.
- Native attachments, image paste/drop, clipboard actions, and macOS speech
  transcription.
- `CodexConversationPane` with composer, messages, tools, generated media,
  thinking, queues, context usage, and customization hooks.
- A grouped controlled-pane adapter for hosts that own conversation state
  outside the SDK surface.
- Host extensions, dynamic tools, and trusted per-surface or per-conversation
  MCP servers.

## A deliberately small renderer

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';

const surface = useCodexSurface(window.codexSurface);
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
or Electron objects need to cross into ordinary renderer code.

## Start here

The default workflow is to scaffold a complete Electron + Vue application and
then update its generated shell and backend for your product. The
[scaffolding guide](https://nbonamy.github.io/codex-app-sdk/guide/scaffolding)
is the canonical source for commands, package-publication status, and options.
For an existing application, follow the
[installation guide](https://nbonamy.github.io/codex-app-sdk/guide/installation).

- [Scaffold an application](https://nbonamy.github.io/codex-app-sdk/guide/scaffolding)
- [Tour the generated application](https://nbonamy.github.io/codex-app-sdk/guide/quick-start)
- [Add app-owned panels](https://nbonamy.github.io/codex-app-sdk/guide/app-ui)
- [Add an MCP server](https://nbonamy.github.io/codex-app-sdk/guide/mcp)
- [Add a backend service](https://nbonamy.github.io/codex-app-sdk/guide/backend)
- [Existing app installation](https://nbonamy.github.io/codex-app-sdk/guide/installation)
- [Architecture](https://nbonamy.github.io/codex-app-sdk/guide/architecture)
- [Vue conversation kit](https://nbonamy.github.io/codex-app-sdk/guide/vue)
- [Controlled pane integration](https://nbonamy.github.io/codex-app-sdk/guide/conversation-pane)
- [History and performance](https://nbonamy.github.io/codex-app-sdk/guide/history)
- [Vue providers](https://nbonamy.github.io/codex-app-sdk/guide/vue-providers)
- [API reference](https://nbonamy.github.io/codex-app-sdk/api/)
- [JSON-RPC coverage inventory](https://nbonamy.github.io/codex-app-sdk/api/json-rpc)

## Samples

| Sample | Product shape | Run |
| --- | --- | --- |
| [Basic](./samples/basic) | Custom conversation sidebar and the full stock pane | `cd samples/basic && npm run dev` |
| [Component lab](./samples/component-lab) | Fully mocked conversation, composer, streaming, and lifecycle scenarios | `npm run lab:dev` |
| [Spark](./samples/spark) | Focused themed chat with isolated auth and fixed defaults | `npm run spark:dev` |
| [Relay](./samples/relay) | Logistics operations UI backed by an app-owned MCP server | `npm run relay:dev` |

The samples are product demonstrations, not templates for child safety or a
production logistics backend. See the
[sample guide](https://nbonamy.github.io/codex-app-sdk/guide/samples) for the
boundaries each one demonstrates.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run build
npm run docs:dev
```

Build the documentation exactly as GitHub Pages does:

```bash
npm run docs:build
npm run docs:preview
```

The checked-in generated protocol bindings currently target
`codex-cli 0.146.0`. See the
[development guide](https://nbonamy.github.io/codex-app-sdk/guide/development)
before updating them.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
