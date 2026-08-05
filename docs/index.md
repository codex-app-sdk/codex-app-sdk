---
layout: home

hero:
  name: Codex App SDK
  text: Ship the app, not the plumbing.
  tagline: A complete app-server runtime, Electron bridge, and Vue conversation kit for building distinctive Codex desktop products.
  image:
    src: /logo.svg
    alt: Codex App SDK
  actions:
    - theme: brand
      text: Scaffold an application
      link: /guide/scaffolding
    - theme: alt
      text: Explore the architecture
      link: /guide/architecture
    - theme: alt
      text: View on GitHub
      link: https://github.com/nbonamy/codex-app-sdk

features:
  - icon: ⚡
    title: App-server, handled
    details: Discovery, process lifecycle, typed JSONL transport, authentication, catalogs, history, reconnects, and server requests.
  - icon: 🧵
    title: Truly concurrent threads
    details: Keep several conversations loaded and streaming independently without coupling them to the selected UI thread.
  - icon: 💬
    title: Full conversation UI
    details: Composer, messages, thinking, tools, approvals, goals, queues, generated media, Markdown, LaTeX, Mermaid, and native attachments.
  - icon: 🧱
    title: Narrow Electron boundary
    details: Main-process policy stays trusted while the renderer gets serializable snapshots, semantic events, and validated actions.
  - icon: 🧰
    title: Built to extend
    details: Add host instructions, opaque context, dynamic tools, and app-owned MCP servers without leaking raw protocol into the renderer.
  - icon: 🎨
    title: Product-ready customization
    details: Capabilities, presentation controls, slots, reusable leaf components, scoped styles, semantic tokens, and light/dark themes.
---

## One surface. Three reusable layers.

<div class="sdk-layer-grid">
  <div class="sdk-layer">
    <strong>Runtime</strong>
    <p>Own app-server startup, global state, concurrent conversations, semantic events, extensions, tools, and MCP configuration.</p>
  </div>
  <div class="sdk-layer">
    <strong>Electron bridge</strong>
    <p>Project a narrow typed API over IPC and keep commands, environments, raw permissions, and filesystem policy in main.</p>
  </div>
  <div class="sdk-layer">
    <strong>Vue kit</strong>
    <p>Drop in the stock conversation pane or compose the same polished messages, composer, tools, media, and menus yourself.</p>
  </div>
</div>

Start with the [complete application scaffold](/guide/scaffolding), then update
the generated project with your own shell, backend modules, tools, and product
behavior. The renderer boundary remains intentionally small:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';

const surface = useCodexSurface(window.codexSurface);
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

## Publication status

The SDK is currently `0.1.x` and generated against `codex-cli 0.146.0`. Package
publication is pending, but the documentation uses the intended npm package
names and scaffold-first workflow throughout. The high-level API is deliberately
smaller and more stable than app-server.

[Scaffold an application →](/guide/scaffolding)
