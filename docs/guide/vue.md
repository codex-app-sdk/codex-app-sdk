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

## Controlled pane adapter

Applications that own their conversation backend can use the same pane without
forwarding every individual state field and event. Create one stable controller
from grouped state and actions:

```ts
import { computed } from 'vue';
import {
  createCodexConversationPaneController,
  type CodexConversationPaneState,
} from 'codex-app-sdk/vue';

const paneState = computed<CodexConversationPaneState>(() => ({
  identity: {
    conversationKey: activeConversationId.value,
    messages: messages.value,
    busy: isSending.value,
    disabled: !agent.value,
    error: error.value,
  },
  history: {
    hasOlder: history.hasOlder,
    loading: history.loading,
    loadingOlder: history.loadingOlder,
  },
  thread: {
    approvals: approvals.value,
    goal: goal.value,
    queuedPrompts: queuedPrompts.value,
    contextUsage: contextUsage.value,
  },
  composer: {
    state: composerState.value,
    attachments: attachments.value,
    placeholder: 'Ask for follow-up changes',
    selectedModelId: selectedModelId.value,
    selectedReasoningEffort: selectedReasoningEffort.value,
    selectedServiceTier: selectedServiceTier.value,
    planMode: planMode.value,
  },
  catalogs: {
    files: files.value,
    models: models.value,
    commands: commands.value,
    skills: skills.value,
    plugins: plugins.value,
  },
  capabilities: capabilities.value,
  policy: {
    attachEnabled: true,
    canDeleteMessage: true,
    canEditMessage: true,
    canRetryMessage: true,
  },
}));

const paneController = createCodexConversationPaneController({
  state: paneState,
  actions: {
    submit: (prompt, options) => sendPrompt(prompt, options),
    steer: (prompt, options) => steerPrompt(prompt, options),
    updateComposerState: (state) => updateComposerState(state),
    updateAttachments: (next) => updateAttachments(next),
    updateSettings: (settings) => updateSettings(settings),
    interrupt: () => interruptConversation(),
    // Add the remaining message, approval, goal, and queue actions as needed.
  },
});
```

```vue
<CodexConversationPane
  :controller="paneController"
  :presentation="presentation"
  :transform-message="transformMessage"
>
  <template #message-header="{ message }">
    <MessageHeader :message="message" />
  </template>
</CodexConversationPane>
```

The controller is a thin view adapter. It does not load conversations, clone
messages, or own a backend. Keep the controller object stable and update its
reactive state leaves in place; high-frequency composer updates must not rebuild
the entire message or catalog state. Controller state and actions take
precedence over legacy pane props and events, so one gesture is never dispatched
twice. The controller accepts plain values, zero-argument getters, and
ref-like `{ readonly value }` sources, so it remains compatible with a host's
Vue installation. Actions may return `void` or `Promise<void>`; rejected
promises are shown through the pane error state. A supplied controller is
authoritative: omitted actions do not fall back to legacy pane events.

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

### Message content

- `CodexMessageBlock`
- `CodexUserText`
- `CodexAttachmentBlock`
- `CodexMediaBlock`
- `CodexMermaidBlock`
- `CodexCompactionMessage`
- message editor and actions

The latest completed assistant message keeps its actions visible for quick
follow-up. Older messages reveal actions on hover or focus as usual.

For long conversations, opt into incremental message rendering on either
`CodexMessageList` or `CodexConversationPane`:

```vue
<CodexConversationPane
  :conversation-key="conversationId"
  :lazy-messages="true"
  :message-batch-size="50"
  :surface="surface"
/>
```

Lazy mode mounts the newest 50 messages, adds older batches as the user scrolls
upward to the top, and preserves the scroll anchor while doing so. It keeps the current
tail, including an active streaming assistant row, mounted and follows new
messages at the bottom. Lazy rendering is enabled by default; set
`:lazy-messages="false"` to render the complete array eagerly. Hosts still
provide the complete message array.

Use `transformMessage` when a host needs to remove or adapt an envelope before
SDK rendering. In lazy mode it runs only for the visible batch, so a full
history does not need to be eagerly transformed:

```vue
<CodexConversationPane
  :surface="surface"
  :transform-message="presentMessage"
/>
```

The callback receives the original message and absolute index, and returns a
`Message | SurfaceMessage`. The SDK keeps the original message id as the row
key and preserves the index for actions and slots.

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

Read, edit, and create tool titles expose an interactive file target when the
SDK can resolve an absolute path. Clicking the target emits the pane's
`openLink` event with a file link containing `filepath` and `action`. When the
tool came from a surface message, the link also carries optional `turnId`,
`messageId`, and `itemId` context so hosts can open a turn-specific diff or
editor view. It does not expand or collapse the tool details. Hosts can use
this event to reveal the file in a sidebar or editor.

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
