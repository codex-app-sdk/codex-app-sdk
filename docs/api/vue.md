# Vue kit API

## Controller

### `useCodexSurface(api)`

Creates a reactive `CodexSurfaceController` around a renderer API.

Returned state and actions include:

- readonly `state`, `lastEvent`, and `answeredClientRequestIds`;
- `onEvent(listener)`;
- authentication actions;
- conversation list/create/select/archive/delete/unarchive actions;
- history, settings, send, review, compact, steer, and interrupt actions;
- message edit/delete/retry/fork actions;
- goals, approvals, client requests, and queued prompts.

The composable subscribes immediately and disposes its listeners with the
current Vue effect scope.

`steerMessage(prompt, options?)` accepts `CodexRendererSendMessageOptions`,
including opaque-reference attachments, just like `sendMessage`.

### Controlled pane controller

`createCodexConversationPaneController()` creates a thin adapter for hosts that
own conversation state outside `CodexSurface`:

```ts
type CodexConversationPaneController<Payload = unknown> = {
  state: CodexConversationPaneValueSource<CodexConversationPaneState>;
  actions: CodexConversationPaneValueSource<CodexConversationPaneActions<Payload>>;
};

const paneState = computed(() => ({
    identity: { conversationKey, activeTurnId, turns, messages, busy, disabled, error },
    history: { hasOlder, loading, loadingOlder },
    thread: { approvals, answeredClientRequestIds, goal, queuedPrompts, turnGitDiff, contextUsage },
    composer: { state, attachments, placeholder, leadingMenuItems, menuItems, approvalPreset, planMode, selectedModelId, selectedReasoningEffort, selectedServiceTier },
    catalogs: { files, models, commands, skills, plugins, mentionGroups, modelCatalogStatus, skillCatalogStatus },
    capabilities,
    policy: { actionsDisabled, attachEnabled, canDeleteTurn, canEditTurn, canForkTurn, canRetryTurn, followUpsDisabled },
}));

const controller = createCodexConversationPaneController({
  state: paneState,
  actions: {
    submit(prompt, options) { /* host transport */ },
    steer(prompt, options) { /* host transport */ },
    onMessageCopied(index) { /* optional analytics/UI notification */ },
    forkTurn(turnId) { /* fork through this completed turn */ },
    updateComposerState(next) { /* persist draft */ },
    updateAttachments(next) { /* persist attachments */ },
    updateSettings(settings) { /* apply settings */ },
    openVisualization({ path, title }) { /* ingest and display the task-owned artifact */ },
  },
});
```

`CodexConversationPaneValueSource<T>` is deliberately structural: provide a
plain value, a zero-argument getter, or a ref-like `{ readonly value: T }`.
This avoids Vue `ComputedRef` type conflicts when the host and SDK resolve
different copies of Vue. Prefer a stable controller with getters or refs for
individual state leaves rather than allocating a new monolithic state object
for every keystroke.

When Vue is separately resolved across the host/package boundary, prefer a
zero-argument getter such as `state: () => paneState`. The structural ref shape
solves type compatibility, but the SDK must not be expected to own a foreign
Vue runtime's dependency graph.

Use it with `<CodexConversationPane :controller="controller" />`. The complete
state groups are `identity`, `history`, `thread`, `composer`, `catalogs`,
`capabilities`, and `policy`. Actions cover submit/steer, composer updates,
settings, history, turn actions, approvals, goals, queue operations, and
client responses. Every action may return `void` or `Promise<void>`; rejected
promises are surfaced through the pane error UI.

When a controlled pane with no messages submits its first prompt, the pane
renders an optimistic user row immediately. The row survives settlement of the
`submit` promise and one `identity.conversationKey` change while the host creates
the provider conversation. Publish the authoritative user message through
`identity.messages`; matching prompt content replaces the optimistic row without
duplication. The pane also keeps its Thinking state active if provider `busy`
briefly clears during that handoff. The host must not insert a second
renderer-only optimistic row or preserve a synthetic busy flag.

`composer.leadingMenuItems` renders host actions after the built-in Approval
item and before Plan mode. `composer.menuItems` remains the trailing extension
point after Plan mode. The equivalent granular pane prop is
`leading-menu-items`.

`catalogs.mentionGroups` adds app-owned grouped `@` suggestions alongside the
built-in plugin and file results. `actions.mentionSelect(item, group)` observes
selection. The `suggestion-item` and `mention` slots customize host result rows
and chips; `mention` is shared by composer and message rendering and identifies
the active surface in its slot props.

`onMessageCopied(index)` is a post-action notification: the SDK always performs
the clipboard write and copied-state feedback first. Omitting this hook does not
disable copying.

Message forking is disabled by default. Enable it with
`state.policy.canForkTurn = true` and handle `actions.forkTurn(turnId)`.
The compatibility props/events are `canForkTurn` / `forkTurn` in
TypeScript and `:can-fork-turn` / `@fork-turn` in Vue templates. In
surface-bound mode, enabling the prop delegates to the SDK surface action,
which selects the newly forked conversation.

The adapter does not load conversations, clone messages, wrap reactive sources,
or own a backend. Keep
the controller object stable and update reactive leaves in place. When supplied,
controller state and actions take precedence over legacy pane props/events, and
one gesture is dispatched exactly once.

## Primary components

| Component | Purpose |
| --- | --- |
| `CodexConversationPane` | Complete bound or unbound conversation surface |
| `CodexConversationSidebar` | Reusable conversation list with create, select, status, relative time, and confirmed delete actions |
| `CodexComposer` | Full composer with menus, attachments, voice, model/reasoning/Fast mode settings, and send/steer behavior |
| `CodexMessageList` | Conversation message collection |
| `CodexScrollToBottom` | Reusable circular control for returning to the latest messages |
| `CodexMessage` | One message with blocks, status, thinking, and actions |
| `CodexApprovalPrompt` | Command, file-change, and permission approval UI |
| `CodexWorkbenchLayout` | Measured sticky header/content/footer layout |
| `CodexConversationHistoryLoader` | Restored-history loading treatment |

`CodexConversationPane` exposes `focusComposer()`. `CodexComposer` exposes
`focus()`.

While `busy`, `CodexConversationPane` listens for two unhandled `Escape`
presses within two seconds and interrupts the active turn. The first press arms
the stop-square control; clicking that armed control also interrupts. Set the
`escapeInterrupt` prop to `false` to disable the document-wide shortcut. When
multiple panes are busy, only the pane containing document focus responds.

### Controlled composer state

```ts
type CodexComposerState = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};
```

`CodexComposer` and `CodexConversationPane` accept `composerState` and emit
`update:composerState` continuously for text and selection-only changes. When
`composerState` and `modelValue` are both supplied, `composerState` is
authoritative. Changing `conversationKey` restores the incoming state without
emitting an intermediate empty value.

### Controlled attachments and steering

`CodexConversationPane` accepts `attachments` and emits `attachmentsChange`
for host-controlled attachment queues. Changing `conversationKey` restores the
incoming `attachments` value and does not emit an intermediate empty queue.

The `composer-attachment-actions` slot adds host-owned controls immediately
before the SDK remove button for each selected attachment. Its exact scope is:

```ts
{
  attachments: readonly CodexHostAttachment[];
  index: number;
  disabled: boolean;
}
```

Derive the current attachment as `attachments[index]`; the slot intentionally
does not pass a second `attachment` field.

The pane's submit and steering actions remain renderer-safe. Their exact
attachment option type is:

```ts
submit: [prompt: string, options?: CodexRendererSendMessageOptions]
steer: [prompt: string, options?: CodexRendererSendMessageOptions]
```

Template listeners use `@steer="(prompt, options) => ..."`. Selected
attachments are included in `options.attachments` and intentionally cleared
after the steer intent is emitted. Each attachment contains `{ type,
reference }` plus optional image `detail`; renderer actions never receive a
filesystem path.

`CodexComposer` accepts `hasAttachments` when the host owns the attachment
queue. This enables submit with an otherwise empty prompt and emits the
canonical `'(no user instructions)'` prompt. It also accepts
`queuedPromptId`; when the composer is empty, Cmd/Ctrl+Enter emits
`steerQueuedPrompt` for that queued item instead of submitting an empty steer.
In `CodexConversationPane`, queued-prompt Edit loads the text into an empty
composer. Enter dispatches `updateQueuedPrompt(promptId, prompt)`, while
Cmd/Ctrl+Enter dispatches `steerQueuedPrompt(promptId, prompt)`.

## Leaf components

### Composer and menus

`CodexComposerMenu`, `CodexComposerMenuList`, `CodexComposerSendButton`,
`CodexComposerActionMenu`, `CodexComposerActiveModes`,
`CodexComposerAtMentionMenu`,
`CodexComposerFileMentionMenu`, `CodexComposerPluginMenu`,
`CodexComposerSkillMenu`,
`CodexComposerSlashMenu`, `CodexComposerVoiceButton`, `CodexComposerVoiceField`,
`CodexComposerWaveform`, `CodexMentionChip`, `CodexRichTextEditor`,
`CodexContextUsageIndicator`, and
`CodexModelReasoningSelector`.

`CodexRichTextEditor` exposes `CodexRichTextEditorExpose` for custom composer
layouts that need its focus and selection controls. `CodexComposerAtMentionMenu`
renders the combined plugin, file, and host-defined mention groups used by the
stock composer.

`useCodexComposerVoice(options)` exposes the same recording and transcription
controller used by `CodexComposer` for custom layouts. Options are
`isDisabled`, `isSending`, `onTranscript`, and optional `transcribeAudio`.
The controller provides `buttonDisabled`, `buttonLabel`, `buttonTitle`,
`error`, `isRecording`, `isTranscribing`, `recorder`, `stop()`, `toggle()`, and
`dispose()`. `stop()` resolves to `true` after a recording is transcribed and
delivered to `onTranscript`, or `false` when recording/transcription fails.

### Messages and media

`CodexMessageBlock`, `CodexUserText`, `CodexAttachmentBlock`, `CodexMediaBlock`,
`CodexImageLightbox`,
`CodexMermaidBlock`, `CodexVisualizationBlock`, `CodexCompactionMessage`, `CodexMessageActions`,
`CodexMessageEditor`, `CodexWorkGroup`, and `CodexFoldTransition`.

Image attachments and media open `CodexImageLightbox` by default. Override
message image clicks with either `CodexConversationPane`'s `openImage` prop or
the controlled pane's `actions.openImage(image, context)`. The handler owns the
click when it returns `void` or `true`; return `false` to use the stock lightbox.
The exported renderer-safe types are `CodexMessageImage`,
`CodexMessageImageContext`, `CodexMessageImageOpenIntent`, and
`CodexMessageImageOpenHandler`.

Visualization annotations use a separate host contract because their
task-owned HTML paths are not conversation files. Controlled panes receive
`actions.openVisualization({ path, title })`; non-controller panes can use the
`openVisualization` prop or event. The exported payload type is
`CodexConversationVisualization`. The SDK does not execute or embed the HTML,
and it never degrades visualization clicks to `openLink`.

`CodexMediaBlock` owns its generated-image footer actions: fullscreen delegates
to the same overridable image-opening contract, while download uses browser
download behavior without entering the conversation-link routing path.

`CodexMessageImageContext.intent` distinguishes the semantic action:
`open` comes from clicking the inline image, while `fullscreen` comes from the
explicit maximize control. Pane handlers also receive the absolute message
`index` and adapted `message`; direct leaf-component handlers receive the
intent without message metadata. The stock SDK lightbox remains the fallback
for either intent.

Assistant Markdown rendered by `CodexMessageBlock` adds a copy control to each
fenced code block and shows a check confirmation for two seconds after copying.

### Tools and conversation state

`CodexToolCall`, `CodexToolCallTitle`, `CodexToolIcon`, `CodexToolGroup`,
`CodexToolConfirmation`, `CodexToolUserInputRequest`, `CodexGoal`,
`CodexQueuedPrompt`, `CodexQueuedPrompts`, `CodexFollowUps`,
`CodexTurnGitInfo`, and `CodexAnimatedDiffStat`.

`CodexToolIcon` accepts a `toolCall` and optional resolved `presentation`. It
uses the same icon chain as stock tool rows: a host icon, a built-in Codex
action icon, a stable kind fallback, then the generic tool icon. Only an
explicit `presentation.icon` value of `null` suppresses the icon. Image
generation uses the photo icon and human-readable activity titles by default.

`CodexScrollToBottom` is also rendered by `CodexMessageList` whenever the
transcript is scrolled away from the bottom. It accepts an optional accessible
`label` and emits `click`; use it directly when composing a custom message
layout.

Message rendering is incremental by default: `CodexMessageList` and
`CodexConversationPane` initially mount only the newest batch. Set
`renderStrategy="eager"` when a host needs eager rendering of every supplied
message:

```vue
<CodexConversationPane
  render-strategy="lazy"
  :initial-message-batch-size="50"
  :message-batch-size="25"
  :conversation-key="conversationId"
  :surface="surface"
/>
```

`initialMessageBatchSize` defaults to `50`, `messageBatchSize` defaults to `25`,
and `renderStrategy` defaults to `lazy`.
Lazy mode initially mounts the newest batch, prepends one batch when the user
scrolls within one viewport of the top, preserves the visible scroll anchor,
and keeps bottom-follow behavior for new messages. The current tail, including
an active streaming assistant row, is always included; stale historical
streaming markers do not expand the window. Changing `conversationKey` resets
the window to the newest batch.
The host still supplies the complete message array; no pagination or backend
contract is required.

`lazyMessages` remains as a deprecated compatibility alias. Use
`renderStrategy="eager|lazy"` in new code.

Configure `loadingStrategy` on `CodexSurfaceOptions` to select the data policy;
configure `renderStrategy` on `CodexConversationPane` to select the DOM policy
when the host controls the message array. These are independent, so all four
combinations are valid:

- `lazy` (the default) loads the newest page and prefetches older pages when
  the user scrolls within one viewport of the top;
- `eager` hydrates all pages progressively;
- `renderStrategy="lazy"` mounts only the visible message batch;
- `renderStrategy="eager"` mounts every supplied message.

The pane exposes `hasOlderHistory` and `loadingOlderHistory` for hosts that own
the page request, and emits `loadOlderHistory` one viewport before the top of
the list needs another page. Returning to the bottom collapses lazy rendering
back to the newest batch without discarding the loaded messages.

Both components also accept an optional typed `transformMessage` callback:

```ts
type CodexMessageTransform = (
  message: Message | SurfaceMessage,
  index: number,
) => Message | SurfaceMessage;
```

The callback runs only after lazy slicing and only for mounted messages. It is
invoked for every message when `renderStrategy` is `eager`. The `index` is always
the original absolute rendering index, and the original message id remains the
rendering key. The default behavior is identity.

`CodexChatMessage` preserves the optional `turnId` from `SurfaceMessage`.
`CodexMessageList` projects adjacent messages with that identity into one
logical turn. Steering messages remain in chronological order, while all
assistant commentary, reasoning, and tool segments share one `Working` / `Done`
disclosure. A transform that returns a `CodexChatMessage` should retain
`turnId` for that behavior. A tool-only active segment is treated as structured
work before the first phased text arrives; unphased messages containing
ordinary text retain the flat rendering path.

Pass `activeTurnId` and `turns` when controlling the list, or put them in
`controller.state.identity`. Surface-bound panes wire both automatically.
`activeTurnId` is authoritative for `Working`; `busy` remains the broader
conversation-level pending state used by the composer and Thinking placeholder.

Pass `busy` to `CodexMessageList` (the conversation pane wires this from its
surface state) to keep a `Thinking` shimmer visible while a turn is accepted
but the app-server has not yet materialized its first assistant row. When the
latest visible message has a `turnId`, that pending state remains part of the
same logical turn so its `Working` disclosure and steers do not fold during the
gap. Lazy batch sizes are approximate: each boundary expands backward to keep
the complete turn mounted instead of rendering a partial turn.

Turn mutations are offered on every terminal turn. Delete, Edit, and Retry are
available for completed, failed, and interrupted turns; Fork requires successful
completion. The active turn never exposes mutation controls. Historical actions
use normal Codex rollback semantics: Delete removes the selected turn and every
later turn, while Edit and Retry truncate that suffix before resubmitting the
edited or original prompt. Copy and Quote remain message-level actions. While an
asynchronous Delete action is pending, the stock action bar keeps the turn
visible, replaces Delete with a progress spinner, and disables its other actions
until the operation settles.

`CodexMessage` renders `Empty response` in muted italic text when a completed
assistant message contains no renderable content. Empty streaming messages keep
the normal `Thinking` presentation instead.

File-operation targets in read, edit, and create tool titles are interactive
targets when the SDK can resolve an absolute path from the tool input. Clicking
a target emits the existing `CodexConversationPane` `openLink` event and does
not toggle tool details. File links emitted from tool titles include the canonical
`filepath` and the operation `action` (`read`, `edit`, or `create`) alongside
the normal file-link `path` for compatibility:

```ts
openLink: [link: {
  href: string;
  kind: 'file';
  path: string;
  filepath?: string;
  action?: 'read' | 'edit' | 'create';
  turnId?: string;
  messageId?: string;
  itemId?: string;
  line?: number;
  column?: number;
}]
```

Raw tool-call input and output are inaccessible by default: stock tool rows do
not render a disclosure control or place those values in the DOM. Enable access
for one component tree with the `show-tool-details` prop on
`CodexConversationPane`, `CodexMessageList`, `CodexMessage`, `CodexToolGroup`,
or `CodexToolCall`. Applications can set the policy once for a Vue subtree:

```ts
import { provideCodexToolCallDetails } from '@codex-app-sdk/vue';

provideCodexToolCallDetails(true);
```

An explicit component prop takes precedence over the provided value.

## Configuration contracts

- `CodexCapabilities`
- `CodexConversationPresentation` and its composer/message/shelf subtypes
- `CodexComposerMentionGroup`, `CodexComposerMentionItem`, and
  `CodexComposerVisibleMentionGroup`
- `CodexComposerMenuItem` discriminated union
- model, reasoning, service-tier/Fast mode, skill, plugin, command, context-usage, goal, diff, and
  client-request view types
- `CodexChatMessage`, block, attachment, media, tool, and status types

## Utilities

### Theme

- `applyCodexTheme`
- `CodexThemeMode`
- `CodexThemeOptions`

### Native capabilities

- `getCodexNativeRendererApi`
- `pickCodexAttachments`
- `ingestCodexAttachments`

### Rendering and parsing

- `renderMarkdown`
- `renderCodeBlock` and `languageForFilePath`
- `parseCodexUserText` and `humanizeMentionName`
- conversation-link parsing helpers
- surface-to-chat message adapters

`CodexUserText` recognizes both linked mentions and the composer’s plain
`$skill` and `@plugin` forms when matching catalogs are supplied,
rendering recognized names as compact mention chips.

`CodexComposer` uses the same catalog-backed chip renderer while editing. It
keeps `$skill`, `@plugin`, and `@path` as the canonical submitted prompt text. Slash-prefixed text remains reserved for commands. Plugin and file results share the `@` suggestion menu; files appear only when the host supplies a thread/CWD-backed file catalog.
Host-defined `CodexComposerMentionGroup` entries share that menu. Their stable
`item.value` remains in canonical text while `item.label` is used for default
display. `CodexComposerMentionItem`, `CodexComposerVisibleMentionGroup`,
`filterComposerMentionGroups`, and `findComposerMention` are exported for
custom composer implementations.
When the composer is empty, Up recalls submitted prompts from newest to oldest
and Down moves forward, returning to an empty prompt after the newest entry.
Recalled prompts keep the caret at the end, and editing one exits history
navigation. Arrow keys do not start recall while the composer contains text.
For plugin-contributed skills whose fallback name starts with an opaque plugin
ID, the skill picker and user-message chip replace that prefix with the matching
plugin catalog name (for example, `dropbox:find-dropbox-content`). The original
skill name and path remain unchanged for prompt submission.

### Customization

- `provideCodexChatTranslate` and `useCodexChatTranslate`
- `provideCodexToolCallDetails` and `useCodexToolCallDetails`
- `provideCodexToolPresentation` and `useCodexToolPresentation`
- `CodexToolPresentation`, `CodexToolPresentationContext`, and
  `CodexToolPresentationResolver`
- `registerCodexToolTitlePresenter`
- capability/presentation resolvers
- composer command, plugin, skill, queue, and mention helpers

`CodexMessageToolCall` preserves optional `kind` and `metadata` fields from the
surface tool part. MCP metadata includes `server`, `tool`, `pluginId`, and MCP
app resource identity when supplied by app-server.

See the [Vue guide](/guide/vue),
[conversation pane integration](/guide/conversation-pane),
[composer guide](/guide/composer), [history guide](/guide/history),
[message/tool guide](/guide/messages-tools),
[Vue provider guide](/guide/vue-providers), and
[presentation guide](/guide/presentation).
