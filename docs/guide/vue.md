# Vue conversation kit

The Vue package is a complete conversation system, not a demo widget. It can be
used as one bound pane or as a library of independently reusable components.

## Bound pane

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';

const surface = useCodexSurface(rendererApi);
</script>

<template>
  <CodexConversationPane :surface="surface" />
</template>
```

When `surface` is provided, the pane derives messages, approvals, catalogs,
settings, queue, goal, diff, context usage, busy/loading state, and actions from
the controller.

`rendererApi` is a `CodexSurfaceRendererApi`. Electron exposes one from preload;
web applications create one with `createCodexWebSurfaceClient()`. The Vue
package does not depend on either host adapter.

The pane is deliberately headerless. The host decides whether a header exists
and what product information it contains.

## Controlled pane adapter

Applications that own their conversation backend can use the same pane without
forwarding every individual state field and event. The grouped controller keeps
conversation identity, history, thread state, composer state, catalogs,
capabilities, and policy explicit while reducing the pane invocation to one
binding.

The controller is a controlled-view adapter, not a backend. It does not load
history, clone messages, or absorb product policy. See
[Conversation pane integration](/guide/conversation-pane) for the exact state
and action groups, reactivity guidance, precedence rules, and migration example.

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

For a custom composer layout, use `useCodexComposerVoice` with the exported
`CodexComposerVoiceButton` and `CodexComposerVoiceField`; it owns the recorder,
transcription lifecycle, state, and cleanup used by the stock composer.

See [Composer and input](/guide/composer) for canonical mention syntax,
controlled text/selection, attachment-only prompts, queued steering, voice, and
the model/reasoning/Fast mode menu.

### Message content

- `CodexMessageBlock`
- `CodexUserText`
- `CodexAttachmentBlock`
- `CodexMediaBlock`
- `CodexMermaidBlock`
- `CodexCompactionMessage`
- message editor and actions

Every terminal turn exposes Delete, Edit, and Retry; Fork is limited to
successfully completed turns. The active turn does not expose mutation controls.
Historical Delete, Edit, and Retry truncate the conversation from their selected
turn before deleting or resubmitting there. Historical Fork creates a new branch
through that turn without changing the source conversation. Copy and Quote remain
message-level actions.

Lazy DOM rendering is enabled by default. It is independent from Node history
loading and applies `transformMessage` only after the visible slice. See
[History and performance](/guide/history) for defaults, progressive prepends,
scroll anchoring, and eager opt-out.

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
- `composer-context` for host-owned context cards inside the composer
- `composer-attachment-actions`
- `composer-after-input` and `composer-after`
- `menu-icon` and `menu-item`

Use `message-block` for media-specific overrides, or mount
`CodexMediaBlock` directly.

Read, edit, and create tool titles expose an interactive file target when the
SDK can resolve an absolute path. See [Messages and tool calls](/guide/messages-tools)
for grouping, icons, multi-file links, raw-detail policy, and file activity.

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
See [Composer and input](/guide/composer).

## Localization and presentation hooks

The package exports:

- scoped providers for translation, raw tool-detail policy, and app-owned tool
  presentation;
- Markdown, KaTeX-powered LaTeX, code highlighting, mention parsing, and conversation-link helpers;
- capabilities, presentation controls, and theme helpers.

See [Vue providers](/guide/vue-providers),
[presentation and theming](/guide/presentation), and the
[Vue API reference](/api/vue).
