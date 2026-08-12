# Conversation pane integration

`CodexConversationPane` supports two primary integration modes. Use the bound
surface mode when the SDK owns the Codex runtime. Use the controlled adapter when
the host already owns conversation state and transport.

## Surface-bound pane

This is the recommended path for a new Codex application:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';

const surface = useCodexSurface(rendererApi);
</script>

<template>
  <CodexConversationPane :surface="surface" autofocus />
</template>
```

The pane derives messages, catalogs, approvals, settings, goals, queues,
attachments, history state, and actions from the surface controller. The host
still owns its page/window, navigation, header, conversation list, and product
views. Electron preload and the web client both satisfy the same renderer API.

## Controlled pane

Use `createCodexConversationPaneController()` when the host owns a different
backend adapter or already maintains the conversation state. It replaces a long
list of paired props and listeners with grouped state and actions:

```ts
import {
  createCodexConversationPaneController,
  type CodexConversationPaneActions,
  type CodexConversationPaneState,
} from '@codex-app-sdk/vue';

const state: CodexConversationPaneState = {
  identity: {
    get conversationKey() { return activeConversationId.value; },
    get messages() { return messages.value; },
    get busy() { return sending.value; },
    get disabled() { return !activeConversationId.value; },
    get error() { return error.value; },
  },
  history: {
    get hasOlder() { return history.value.hasOlder; },
    get loading() { return history.value.loading; },
    get loadingOlder() { return history.value.loadingOlder; },
  },
  composer: {
    get state() { return drafts.value[activeConversationId.value]; },
    get attachments() { return attachments.value[activeConversationId.value]; },
    get leadingMenuItems() { return providerMenuItems.value; },
    get selectedModelId() { return settings.value.modelId; },
    get selectedReasoningEffort() { return settings.value.reasoningEffort; },
    get selectedServiceTier() { return settings.value.serviceTier; },
  },
  catalogs: {
    get models() { return models.value; },
    get skills() { return skills.value; },
    get plugins() { return plugins.value; },
    get files() { return files.value; },
  },
  get capabilities() { return capabilities.value; },
  policy: {
    canForkMessage: true,
  },
};

const actions: CodexConversationPaneActions = {
  submit: (prompt, options) => backend.send(prompt, options),
  steer: (prompt, options) => backend.steer(prompt, options),
  interrupt: () => backend.interrupt(),
  updateComposerState: (next) => saveDraft(activeConversationId.value, next),
  updateAttachments: (next) => saveAttachments(activeConversationId.value, next),
  updateSettings: (next) => backend.updateSettings(next),
  loadOlderHistory: () => backend.loadOlderHistory(),
  resolveApproval: (id, decision, scope) => backend.resolveApproval(id, decision, scope),
  forkMessage: (index) => backend.forkMessage(index),
  openImage: (image, context) => imageTabs.open(image, context),
};

export const paneController = createCodexConversationPaneController({
  state: () => state,
  actions,
});
```

```vue
<CodexConversationPane
  :controller="paneController"
  :presentation="presentation"
  :transform-message="transformMessage"
>
  <template #message-header="{ message }">
    <AppMessageHeader :message="message" />
  </template>
</CodexConversationPane>
```

The adapter is intentionally a controlled-view boundary. It does not create a
`CodexSurface`, fetch history, clone messages, or own application state.

## State groups

| Group | Contents |
| --- | --- |
| `identity` | Conversation key, messages, busy/disabled state, and error |
| `history` | Initial loading, older-page availability, and older-page loading |
| `thread` | Approvals, answered requests, goal, queued prompts, git diff, and context usage |
| `composer` | Text/selection state, attachments, placeholder, menus, model/reasoning/tier, approval preset, and plan mode |
| `catalogs` | Files, models, commands, skills, plugins, and catalog status |
| `capabilities` | Which standard conversation behaviors the host exposes |
| `policy` | Message-action, attachment, follow-up, and disabled policies |

Only `identity.messages` is required beyond the `identity` object itself. Omit
an optional group or leaf when that capability is not present.

Use `composer.leadingMenuItems` for host actions that belong beside the built-in
Codex controls. They render after Approval and before Plan mode. Existing
`composer.menuItems` remain after Plan mode; both collections use
`CodexComposerMenuItem` and dispatch through `actions.menuSelect`.

## Action groups

Controller actions cover:

- submit, steer, interrupt, and queued-prompt steering;
- composer state, attachments, prompt-history loading, settings, menu selection, and attachment picking;
- older-history loading;
- copy notification, quote, edit, retry, fork, and delete message behavior;
- image opening, with the SDK fullscreen lightbox as the default fallback;
- approvals and app-server client responses;
- goals, follow-ups, and queued-prompt deletion;
- conversation-link navigation.

Mutation actions return `void | Promise<void>`; `readPromptHistory` returns
prompt strings synchronously or asynchronously. The pane can preserve pending/error UI
until an asynchronous host action settles. `onMessageCopied` is only a
post-action notification: `CodexMessage` performs the clipboard write and
copied-state feedback itself.

Message forking is deliberately opt-in. In controlled mode, set
`state.policy.canForkMessage = true` and implement `actions.forkMessage(index)`.
The Fork control appears immediately before Delete on both user and assistant
messages. With the granular compatibility API, use
`:can-fork-message="true"` and `@fork-message="forkMessage"`. A surface-bound
pane can also opt in with `:can-fork-message="true"`; the active surface action
creates and selects the fork.

While a turn is running, completed-message actions remain rendered, but Retry,
Delete, and Fork are disabled because they change thread history. Copy and Quote
remain available. The assistant message currently being generated keeps its
action toolbar hidden until streaming completes.

## Reactivity and package boundaries

`CodexConversationPaneValueSource<T>` accepts a value, a zero-argument getter,
or a structural `{ readonly value: T }` source. The structural shape prevents
nominal `ComputedRef` conflicts when the host and SDK resolve different Vue
packages.

Prefer a stable controller and stable nested objects with reactive property
getters. If Vue is resolved separately across the package boundary, pass
`state: () => state` rather than relying on the SDK runtime to subscribe to a
foreign computed dependency graph. Do not rebuild or deep-reactivize the full
messages array on every composer keystroke.

## Precedence and migration

When `controller` is supplied, it is authoritative:

- controller state wins over matching pane props and surface state;
- controller actions win over legacy pane events;
- a gesture is dispatched once, never to both contracts;
- an omitted controller action is a no-op and does not fall back to a legacy
  event.

Keep presentation props, `transformMessage`, and slots outside the controller.
They describe how the SDK-owned view is presented, not conversation state.

The granular props/events remain supported for compatibility and small custom
compositions, but new advanced integrations should prefer the grouped adapter.

## Backend versus pane controller

`CodexAppBackend` and the pane controller solve different problems:

| API | Runtime | Responsibility |
| --- | --- | --- |
| `CodexAppBackend` | Trusted Node host | Compose one `CodexSurface` with app-owned services |
| `CodexSurface` | Trusted Node host | Own app-server and Codex conversation state |
| `useCodexSurface` | Renderer | Make any `CodexSurfaceRendererApi` reactive |
| Pane controller | Renderer | Normalize host-owned view state and actions |

See [Add a backend service](/guide/backend), [Composer and input](/guide/composer),
and [History and performance](/guide/history).
