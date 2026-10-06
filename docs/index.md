---
layout: home

hero:
  name: Codex App SDK
  text: Ship the app, not the plumbing.
  tagline: Open-source building blocks for Codex apps. One runtime, Electron and web transports, and a shared Vue conversation UI.
  image:
    src: /logo.svg
    alt: Codex App SDK
  actions:
    - theme: brand
      text: Try it from source
      link: /guide/installation#try-the-public-source
    - theme: alt
      text: Explore the architecture
      link: /guide/architecture
    - theme: alt
      text: View on GitHub
      link: https://github.com/codex-app-sdk/codex-app-sdk

features:
  - icon: ⚡
    title: App-server, handled
    details: Discovery, process lifecycle, typed JSONL transport, authentication, catalogs, history, reconnects, and server requests.
  - icon: 🧵
    title: Truly concurrent threads
    details: Keep several conversations loaded and streaming independently without coupling them to the selected UI thread.
  - icon: 💬
    title: Full conversation UI
    details: Prompt recall, editable queues, double-Escape interruption, tools, approvals, goals, generated media, code copying, Markdown, LaTeX, Mermaid, and native attachments.
  - icon: 🧱
    title: Two narrow host adapters
    details: Electron IPC and framework-neutral WebSockets carry the same renderer-safe snapshots, events, and validated actions.
  - icon: 🧰
    title: Built to extend
    details: Add grouped @ mentions, custom mention rendering, host instructions, opaque context, dynamic tools, app-owned MCP servers, visualization actions, and sub-agent UI without leaking raw protocol into the renderer.
  - icon: 🎨
    title: Product-ready customization
    details: Capabilities, presentation controls, slots, reusable leaf components, scoped styles, semantic tokens, and light/dark themes.
---

## One surface. Five focused packages.

Build your own Codex experience on an Apache-2.0 SDK. Start with the mocked
component lab, connect a real app-server, then make the application your own.

<div class="sdk-layer-grid">
  <div class="sdk-layer">
    <strong>Core</strong>
    <p>Share renderer-safe surface, event, attachment, and host-capability contracts across every runtime.</p>
  </div>
  <div class="sdk-layer">
    <strong>Backend</strong>
    <p>Own app-server startup, global state, concurrent conversations, semantic events, extensions, tools, and MCP configuration.</p>
  </div>
  <div class="sdk-layer">
    <strong>Electron</strong>
    <p>Project the surface over typed IPC and provide native attachments, clipboard, links, and speech capabilities.</p>
  </div>
  <div class="sdk-layer">
    <strong>Web</strong>
    <p>Bind a host-authorized WebSocket without taking ownership of HTTP, authentication, users, or process pooling.</p>
  </div>
  <div class="sdk-layer">
    <strong>Vue</strong>
    <p>Drop in the shared sidebar and conversation pane or compose the same messages, composer, tools, media, and menus yourself.</p>
  </div>
</div>

Start with the [complete application scaffold](/guide/scaffolding), then update
the generated project with your own shell, backend modules, tools, and product
behavior. The renderer boundary remains intentionally small:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';
import '@codex-app-sdk/vue/styles.css';

const surface = useCodexSurface(rendererApi);
</script>

<template>
  <CodexConversationPane :surface="surface" />
</template>
```

The pane connects through the SDK bridge and renders the active app-server
conversation. Your app can add its own conversation list, workspace controls,
business UI, or custom tools without recreating the conversation system.

## Start with the scaffold, learn from the samples

| If you are building… | Start from… |
| --- | --- |
| A new Electron + Vue application | [Project scaffolder](/guide/scaffolding) |
| A web application embedded in an existing site | [Web integration](/guide/web) |
| A runnable Express + `ws` web baseline | [Basic web sample](/guide/samples#basic-web-transport-boundary) |
| A full multi-thread Codex client | [Basic sample](/guide/samples#basic-multi-thread-client) |
| A focused, branded chat experience | [Spark sample](/guide/samples#spark-focused-chat) |
| A business application with model-driven operations | [Relay sample](/guide/samples#relay-business-ui-mcp) |
| A custom runtime or non-Vue renderer | [Surface runtime](/guide/surface) and [surface contracts](/api/surface) |
| A protocol experiment not yet projected by the SDK | [Low-level client](/api/codex) |

::: tip Design rule
Ordinary application code should speak in conversations, messages, approvals,
goals, and events—not `thread/*`, `turn/*`, JSON-RPC envelopes, or generated
protocol types.
:::

## Source and package access

The repository and documentation are public. You can clone the source and run
the [component lab or samples](/guide/installation#try-the-public-source)
without package credentials. Starting with 0.14.0, all six scoped packages,
including the scaffolder, are public on npm and install without authentication.
See [installation](/guide/installation#package-access) for setup and migration
from the older GitHub Packages releases.

The SDK is pre-1.0. These docs follow `main`; package releases may lag behind.
The [JSON-RPC inventory](/api/json-rpc) records the checked-in app-server schema
version and its coverage.

[Scaffold an application →](/guide/scaffolding)
