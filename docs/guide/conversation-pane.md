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
    get activeTurnId() { return activeTurnId.value; },
    get turns() { return turns.value; },
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
  thread: {
    get clientRequests() { return clientRequests.value; },
    get answeredClientRequestIds() { return answeredClientRequestIds.value; },
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
    canForkTurn: true,
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
  forkTurn: (turnId) => backend.forkTurn(turnId),
  updateQueuedPrompt: (id, prompt) => backend.updateQueuedPrompt(id, prompt),
  steerQueuedPrompt: (id, prompt) => backend.steerQueuedPrompt(id, prompt),
  openImage: (image, context) => imageTabs.open(image, context),
  openVisualization: (visualization) => artifactTabs.open(visualization),
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

## Questions in the composer

When the app-server provides a structured question, the pane shows that question
once; its fallback agent-message text is not shown separately. Other assistant
messages in the turn remain visible.

Blocking tool questions and async agent-message questions use the same composer
replacement and answer controls. A surface-bound pane reads blocking requests
from its SDK snapshot. A controlled pane should pass the provider's pending
requests through `thread.clientRequests` and route `actions.clientResponse`;
the pane hides the active tool card from the transcript and retains the answered
tool summary afterward. The standalone `clientRequests` prop provides the same
input outside controller mode.

While a turn is running, an unanswered async question replaces the composer.
When that turn finishes, the composer returns with a **Pending question** button
beside its action menu. Click the label to answer, or hover over the leading
question icon to reveal a cancel control. Sending or steering a prompt
dismisses the button instead; the question stays in the
historical transcript, but it does not reappear when the next turn starts or
after reloading the conversation. Controlled hosts should provide turn status
and messages through the pane controller so this transition follows the
provider's state.

## Host-owned message selection and composer context

Hosts can opt into text selection from rendered chat messages without moving
their product workflow into the SDK:

```vue
<CodexConversationPane
  :controller="paneController"
  :message-text-selection="true"
  :has-composer-context="annotations.length > 0"
  @message-text-selection-change="selectedMessageText = $event"
>
  <template #composer-context="{ disabled }">
    <AppAnnotationList
      :annotations="annotations"
      :disabled="disabled"
      @remove="removeAnnotation"
    />
  </template>
</CodexConversationPane>
```

`messageTextSelectionChange` emits `CodexMessageTextSelection | null`. A
selection contains the trimmed text, message ID/index/role, optional turn ID,
and a viewport-relative anchor rectangle suitable for a host-owned popover.
The SDK rejects selections spanning messages and clears the value when the
selection collapses, leaves the transcript, scrolls, or the conversation key
changes. The feature is disabled by default.

`composer-context` is a generic rendering slot; the SDK does not serialize its
contents. Set `hasComposerContext` while host-owned cards are present so Send
remains available with an empty text field. A context-only controlled submit
passes `prompt === ''` to `actions.submit`, and the host must serialize its
context before transport. Native image/file attachment-only submissions keep
the existing `(no user instructions)` prompt.

Use `composer-shelf-actions` for compact host-owned controls that belong in the
shelf above the composer rather than inside submitted context. The row renders
after the SDK turn diff, queued prompts, and active goal, so it remains closest
to the composer without replacing those sections. Its scope is
`{ disabled: boolean }`; hosts should apply `disabled` to interactive controls.
The exported `CodexComposerShelf` exposes the same row through its lower-level
`actions` slot. When the slot renders no content, the SDK omits the row and does
not leave an empty shelf above the composer.

## State groups

| Group | Contents |
| --- | --- |
| `identity` | Conversation key, messages, busy/disabled state, and error |
| `history` | Initial loading, older-page availability, and older-page loading |
| `thread` | Approvals, pending and answered requests, goal, queued prompts, git diff, and context usage |
| `composer` | Text/selection/pending-command state, attachments, placeholder, menus, model/reasoning/tier, approval preset, and plan mode |
| `catalogs` | Files, models, commands, skills, plugins, host mention groups, and catalog status |
| `capabilities` | Which standard conversation behaviors the host exposes |
| `policy` | Message-action, attachment, follow-up, and disabled policies |

Only `identity.messages` is required beyond the `identity` object itself. Omit
an optional group or leaf when that capability is not present.
The default composer shelf presents active, paused, and limited goals, but
hides a goal once its status is `complete`; the terminal goal remains available
to controller state and event consumers.

The built-in `/goal` command first activates a removable Goal mode in the
composer and requires an objective before submission. Controlled hosts persist
that pending state through `composer.state.activeCommandId`; editing an existing
goal restores its objective with the same Goal mode instead of exposing raw
slash syntax in the editor.

Use `composer.leadingMenuItems` for host actions that belong beside the built-in
Codex controls. They render after Approval and before Plan mode. Existing
`composer.menuItems` remain after Plan mode; both collections use
`CodexComposerMenuItem` and dispatch through `actions.menuSelect`.
Use `composer.modelMenuItems` for host-owned presets or actions that belong
inside the model selector. They render before the SDK-owned Model, Reasoning,
and Speed groups and dispatch the host's original payload through the same
`actions.menuSelect` callback. The SDK keeps its own selector commands distinct
from host payloads, so hosts do not need to mirror or namespace built-in menu
behavior. A `heading` item may include compact trailing `actions`; those icon
actions use the same typed payload and menu-selection flow. Items may pair a
short trailing `value` with `valueIcon` and `valueIconLabel` for accessible
compact metadata. Set `valueAppearance` to `badge` for short categorical values.
Host-defined `catalogs.mentionGroups` render grouped `@` results before or
after Plugins and Files and dispatch through `actions.mentionSelect`. Keep Vue
rendering in the pane's `suggestion-item` and `mention` slots rather than in
controller state.

## Action groups

Controller actions cover:

- submit, steer, interrupt, and queued-prompt update/steering;
- composer state, attachments, prompt-history loading, settings, menu selection, and attachment picking;
- older-history loading;
- copy notification and quote behavior, plus edit, retry, fork, and delete turn behavior;
- image opening, with the SDK fullscreen lightbox as the default fallback;
- approvals and app-server client responses;
- goals, follow-ups, and queued-prompt deletion;
- conversation-link navigation.

Queue editing is host-routed in controlled mode. The pane keeps the edit state
and composer interaction, while `updateQueuedPrompt(id, prompt)` must replace
the existing record without changing its position. The
`steerQueuedPrompt(id, prompt?)` action sends the queued item immediately; when
edited text is supplied, the host must steer that text and remove the selected
queue record atomically.

Mutation actions return `void | Promise<void>`; `readPromptHistory` returns
prompt strings synchronously or asynchronously. The pane can preserve pending/error UI
until an asynchronous host action settles. `onMessageCopied` is only a
post-action notification: `CodexMessage` performs the clipboard write and
copied-state feedback itself.

For the first controlled submission, keep `actions.submit(prompt, options)` as a
normal transport action. The pane owns the temporary user row while
`identity.messages` is empty, preserves it if the provisional conversation key
becomes the provider thread ID, and reconciles it when the matching authoritative
user message arrives. The submit promise may resolve before that message; do not
add a host-owned optimistic transcript row or delay promise settlement just for
rendering. While the temporary row is pending, the pane keeps Thinking visible
even if provider busy state briefly clears during thread creation. A rejected
action removes both temporary states and surfaces the error.

Message forking is deliberately opt-in. In controlled mode, set
`state.policy.canForkTurn = true` and implement `actions.forkTurn(turnId)`.
The Fork control appears immediately before Delete on both user and assistant
messages. With the granular compatibility API, use
`:can-fork-turn="true"` and `@fork-turn="forkTurn"`. A surface-bound
pane can also opt in with `:can-fork-turn="true"`; the active surface action
creates and selects the fork.

The SDK offers turn mutations on every terminal turn when the host supplies the
corresponding global capability. Delete, Edit, and Retry may target completed,
failed, or interrupted turns; Fork requires successful completion. The active
turn never exposes mutation controls, and all historical mutation controls are
disabled while another turn is running. Acting on an older turn truncates the
conversation from that turn: Delete stops there, while Edit and Retry resubmit
the edited or original prompt. Copy and Quote remain available.

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
