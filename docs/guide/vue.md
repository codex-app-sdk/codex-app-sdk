# Vue conversation kit

The Vue package is a complete conversation system, not a demo widget. It can be
used as one bound pane or as a library of independently reusable components.

## Bound pane

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';

const surface = useCodexSurface(window.codexSurface);
</script>

<template>
  <CodexConversationPane :surface="surface" />
</template>
```

When `surface` is provided, the pane derives messages, approvals, catalogs,
settings, queue, goal, diff, context usage, busy/loading state, and actions from
the controller.

The pane is deliberately headerless. The host decides whether a header exists
and what product information it contains.

## Unbound composition

The pane can also receive messages and callbacks through props/events without a
surface controller. Or build a different layout from exported components:

### Structure

- `CodexWorkbenchLayout`
- `CodexConversationHistoryLoader`
- `CodexMessageList`
- `CodexScrollToBottom`
- `CodexMessage`
- `CodexConversationPane`

### Composer

- `CodexComposer`
- `CodexComposerMenu` and `CodexComposerMenuList`
- `CodexComposerActionMenu`
- model/reasoning, skill, slash, and file-mention menus
- voice button, field, waveform, send button, active modes, context usage, and
  composer shelf

### Message content

- `CodexMessageBlock`
- `CodexUserText`
- `CodexAttachmentBlock`
- `CodexMediaBlock`
- `CodexMermaidBlock`
- `CodexCompactionMessage`
- message editor and actions

### Tools and state

- `CodexToolCall`, `CodexToolGroup`, and `CodexToolCallTitle`
- `CodexToolConfirmation` and `CodexToolUserInputRequest`
- `CodexApprovalPrompt`
- `CodexGoal`
- queued-prompt components
- `CodexTurnGitInfo`

## Slots

`CodexConversationPane` forwards scoped slots for:

- `empty`
- `message`, the additive `message-header`, and `message-block`
- `message-text`, `message-attachment`, and `message-tool`
- `message-thinking`, `message-status`, and `message-actions`
- `approval`
- `before-composer` and `after-composer`
- `composer-after-input` and `composer-after`
- `menu-icon` and `menu-item`

Use `message-block` for media-specific overrides, or mount
`CodexMediaBlock` directly.

Use `message-header` to add host-owned context above a message without replacing
the SDK body, attachments, tools, or actions:

```vue
<CodexConversationPane :surface="surface">
  <template #message-header="{ message }">
    <p v-if="messageHeaders[message.id]">
      {{ messageHeaders[message.id] }}
    </p>
  </template>
</CodexConversationPane>
```

## Catalog-driven controls

Model, reasoning, service-tier, skill, plugin, and approval controls are driven by the
surface catalogs. The pane does not invent model IDs, reasoning efforts, or
permission presets.

When the selected model advertises a `priority` or `fast` service tier, the
model menu includes a Fast mode toggle below Reasoning. The toggle emits
`update:serviceTier` with the tier ID when enabled and `null` when disabled;
bound panes apply it through `updateConversationSettings({ serviceTier })`.

File mentions are host-provided through the `files` prop. Attachments, paste,
and drag/drop use the native capability bridge automatically when available.

## Localization and presentation hooks

The package exports:

- scoped providers for translation, raw tool-detail policy, and app-owned tool
  presentation;
- Markdown, KaTeX-powered LaTeX, code highlighting, mention parsing, and conversation-link helpers;
- capabilities, presentation controls, and theme helpers.

See [Vue providers](/guide/vue-providers),
[presentation and theming](/guide/presentation), and the
[Vue API reference](/api/vue).
