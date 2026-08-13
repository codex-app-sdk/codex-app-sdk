# `@codex-app-sdk/vue`

Reusable Vue 3 conversation sidebar, pane, composer, messages, tools,
composables, and scoped theme for Codex applications.

```bash
npm install @codex-app-sdk/core @codex-app-sdk/vue vue
```

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

`rendererApi` may come from Electron preload or
`createCodexWebSurfaceClient()`. This package depends only on renderer-safe core
contracts and does not import the backend, Electron, or web server packages.

The stock pane includes prompt recall, editable queued prompts, double-Escape
interruption, copied-state feedback for code blocks, renderer-safe image
lightboxes/downloads, and host-owned image or visualization actions.

For host-owned state, use `createCodexConversationPaneController()`. Its
submit/steer actions receive `CodexRendererSendMessageOptions`; attachments are
opaque `{ type, reference }` values and never host filesystem paths.
Controlled hosts also own queue persistence through `updateQueuedPrompt` and
`steerQueuedPrompt`; the pane owns the editing interaction but never mutates a
host queue behind the controller.

See the [Vue guide](https://nbonamy.github.io/codex-app-sdk/guide/vue),
[conversation pane guide](https://nbonamy.github.io/codex-app-sdk/guide/conversation-pane),
and [Vue API](https://nbonamy.github.io/codex-app-sdk/api/vue).
