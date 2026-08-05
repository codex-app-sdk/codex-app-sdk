# Add app-owned panels

The scaffold deliberately gives you a useful sidebar and the stock
`CodexConversationPane`, but it does not prescribe the rest of your product.
Toolbars, inspectors, canvases, dashboards, settings, and business views belong
to the application.

## Add a panel beside the conversation

Start in `src/renderer/App.vue`. Keep the existing surface controller and pane,
then compose ordinary Vue components around them:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import ProjectInspector from './components/ProjectInspector.vue';

const surface = useCodexSurface(window.codexSurface);
const inspectorOpen = ref(true);
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <!-- Keep or replace the generated conversation navigation. -->
    </aside>

    <section class="workspace">
      <CodexConversationPane
        class="workspace__conversation"
        :surface="surface"
        autofocus
      />

      <ProjectInspector
        v-if="inspectorOpen"
        class="workspace__inspector"
        :conversation-id="surface.state.activeConversationId"
        @close="inspectorOpen = false"
      />
    </section>
  </main>
</template>
```

Add the layout in `src/renderer/styles.css`:

```css
.workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) 320px;
  background: var(--codex-surface-color);
}

.workspace__conversation,
.workspace__inspector {
  min-width: 0;
  min-height: 0;
}

.workspace__inspector {
  overflow: auto;
  border-left: 1px solid var(--codex-border-color);
}
```

`min-width: 0` and `min-height: 0` matter in grid and flex shells. Without
them, a long message or panel can force the conversation pane beyond the window
instead of scrolling inside its own viewport.

## Use conversation state without copying it

The controller already exposes the active conversation and global catalog:

```ts
const activeId = computed(() => surface.state.activeConversationId);
const activeMessages = computed(() => surface.state.messages);
const conversations = computed(() => surface.state.conversations);
```

Use those values to coordinate app chrome. Do not copy the transcript into a
second renderer store unless the product has a concrete projection requirement.
The SDK owns history merging, streaming updates, queues, approvals, and active
turn state.

## Choose the panel's data source

### Renderer-local state

Use ordinary Vue state for presentation concerns such as the selected tab,
panel width, filters, or whether an inspector is open.

### SDK conversation state

Use `surface.state`, semantic events, pane slots, and Vue presentation
providers when the panel reflects Codex conversations, messages, tools, goals,
or context usage.

### Trusted application data

If the panel reads files, databases, credentials, OS services, or business
state, create an [application backend module](/guide/backend) and expose a
narrow typed API through preload. Do not import Node or Electron into the Vue
renderer.

### Model-callable application data

If Codex should query or mutate that data, expose it through an
[app-owned MCP server](/guide/mcp). A panel and an MCP server may share the same
underlying service, but their boundaries differ:

- the panel API is designed for deterministic UI reads and user actions;
- MCP tools are designed for model calls, schemas, approvals, and tool results.

## Integrate with conversation presentation

Use the pane's additive seams before replacing its renderer:

- `#message-header` adds app-owned context above a message;
- `transformMessage` adapts only lazily mounted messages;
- `provideCodexToolPresentation` customizes app-owned tool icons and titles;
- capability and presentation props hide actions the product does not expose;
- semantic events let panels react to completed tools or conversation activity.

See [Presentation and theming](/guide/presentation),
[Messages and tool calls](/guide/messages-tools), and
[Vue providers](/guide/vue-providers).

## Keep product UI app-owned

The SDK should not learn about the purpose of your inspector, dashboard, or
workspace. Keeping those components in the generated application means you can
change the product freely while still receiving SDK improvements to the
composer, messages, history, approvals, and app-server runtime.
