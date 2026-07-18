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

The package is currently source-first and not yet published to npm.

```bash
npm install github:nbonamy/codex-app-sdk vue
npm install --save-dev electron
```

- [Installation](https://nbonamy.github.io/codex-app-sdk/guide/installation)
- [Quick start](https://nbonamy.github.io/codex-app-sdk/guide/quick-start)
- [Architecture](https://nbonamy.github.io/codex-app-sdk/guide/architecture)
- [Vue conversation kit](https://nbonamy.github.io/codex-app-sdk/guide/vue)
- [API reference](https://nbonamy.github.io/codex-app-sdk/api/)

## Samples

| Sample | Product shape | Run |
| --- | --- | --- |
| [Basic](./samples/basic) | Custom conversation sidebar and the full stock pane | `cd samples/basic && npm run dev` |
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
`codex-cli 0.144.1`. See the
[development guide](https://nbonamy.github.io/codex-app-sdk/guide/development)
before updating them.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
