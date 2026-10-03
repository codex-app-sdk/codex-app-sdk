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
- interrupted-turn continuation;
- message edit/delete/retry/fork actions;
- goals, approvals, client requests, and queued prompts.

The composable subscribes immediately and disposes its listeners with the
current Vue effect scope.

`steerMessage(prompt, options?)` accepts `CodexRendererSendMessageOptions`,
including opaque-reference attachments, just like `sendMessage`.

### `useCodexLiveChat(options)`

Experimental bidirectional voice for an existing conversation. The composable
owns browser microphone capture, a WebRTC peer, remote audio playback, and the
live transcript. Signaling uses the same renderer API as the conversation;
audio does not travel through Electron IPC or the web bridge.

```ts
import { useCodexLiveChat } from '@codex-app-sdk/vue';

const { status, error, muted, transcript, start, stop, setMuted } = useCodexLiveChat({
  surface: api, // Electron preload API or createCodexWebSurfaceClient()
  conversationId,
  session: { voice: 'marin' }, // optional; defaults to realtime V3
});

// Call from a user gesture; the browser asks for microphone permission.
await start();
setMuted(true);
await stop();
```

- `status` is a readonly ref: `idle`, `connecting`, `connected`, `stopping`, or
  `error`. `start()` resolves after SDP negotiation; `connected` means WebRTC
  has actually connected.
- `error` is a readonly `string | null` ref. Start/stop failures also reject
  their promises; catch these in UI event handlers.
- `muted` controls the microphone track only. Remote audio keeps playing.
- `transcript` contains `{ id, role, text, complete }` rows. V3 canonical item
  events update rows by identity; legacy transcript events are also supported.
  These rows are session-local, not a persisted conversation-history API.
- `session` accepts `StartCodexLiveChatOptions` except `sdp`: optional `version`,
  `voice`, `model`, `prompt`, `includeStartupContext`, and
  `flushTranscriptTailOnSessionEnd`.

Create one instance per conversation and dispose/remount it when switching
conversations. Scope disposal stops capture and playback, closes the peer,
unsubscribes, and requests session stop. Repeated start/stop calls are
coalesced. A late microphone grant or SDP answer after cancellation cannot
reopen the session. Connection failures/timeouts release local media.

Requires browser WebRTC, microphone permission in a secure context (localhost
works), and a Codex CLI/account with realtime access. The surface must implement
`startLiveChat`/`stopLiveChat`; older custom hosts fail with an explicit error.
Realtime is experimental and account/CLI availability can differ. The component
lab's **Live chat** scenario demonstrates this alongside a normal conversation
pane using the local Codex login.

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
    thread: { approvals, clientRequests, answeredClientRequestIds, goal, queuedPrompts, turnGitDiff, contextUsage },
    composer: { state, attachments, placeholder, leadingMenuItems, menuItems, modelMenuItems, approvalPreset, planMode, selectedModelId, selectedReasoningEffort, selectedServiceTier },
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

When the latest controlled `identity.turns` entry is `interrupted`, no turn is
active, and the composer is empty, the stock composer changes Send to
**Continue**. Activating it dispatches `actions.continueInterruptedTurn()`; it
does not call `submit` or create an optimistic user row. Surface-bound panes
call the equivalent SDK surface operation. A typed prompt or attachment keeps
the normal submission path. Cmd+Enter invokes the same resume action while the
composer is empty.

`CodexConversationPane` and standalone `CodexComposer` accept
`emptySendPrompt?: string` (default `''`). When set to non-whitespace text and
the composer has no text, attachments, host context, or active command,
hovering over the muted Send button enables a normal submission of that prompt.
`Cmd+Enter` does the same unless it is steering an existing queued prompt. This
does not replace the interrupted-turn action above or the busy-turn interrupt.

When a controlled pane with no messages submits its first prompt, the pane
renders an optimistic user row immediately. The row survives settlement of the
`submit` promise and one `identity.conversationKey` change while the host creates
the provider conversation. Publish the authoritative user message through
`identity.messages`; matching prompt content replaces the optimistic row without
duplication. The pane also keeps its Thinking state active if provider `busy`
briefly clears during that handoff. The host must not insert a second
renderer-only optimistic row or preserve a synthetic busy flag.

`composer.leadingMenuItems` renders host actions after the built-in Approval
item and before Plan and Goal modes. `composer.menuItems` remains the trailing
extension point after those modes. The equivalent granular pane prop is
`leading-menu-items`.

`composer.modelMenuItems` renders host actions before the built-in Model,
Reasoning, and Speed groups. Selections preserve the original host payload and
dispatch through `actions.menuSelect`; the equivalent granular prop is
`model-menu-items`. `CodexComposerMenuHeadingItem.actions` accepts action items
rendered as accessible trailing icon controls in the heading row.
`CodexComposerMenuItemBase.valueIcon` adds a trailing icon beside `value`; set
`valueIconLabel` when the icon carries meaning. `valueAppearance: 'badge'`
renders short values as compact metadata badges.

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
| `CodexQuestionRequest` | App-server question renderer used by messages and the pane footer |
| `CodexApprovalPrompt` | Command, file-change, and permission approval UI |
| `CodexWorkbenchLayout` | Measured sticky header/content/footer layout |
| `CodexConversationHistoryLoader` | Restored-history loading treatment |

`CodexConversationPane` exposes `focusComposer()`. `CodexComposer` exposes
`focus()`. Pass `focus({ preserveSelection: true })` to focus the saved selection
instead of moving the caret to the end.

Pending approvals replace the shelf and composer, one at a time in the supplied
`approvals` order, followed by pending `confirm_tool` client requests, ahead of
expanded questions. Native approvals and tool confirmations use one shared
**Approve tool call** card, expandable Details, and left-aligned actions, with
only their supported decision scopes. Native **Allow** emits `approve, once`;
**Allow for session** emits `approve, session`. Tool confirmation responses use `actions.clientResponse`
or `clientResponse`. Their pending tool card is hidden from the transcript,
and the resolved history remains. The `approval` slot receives only
the active approval. Resolution still uses `actions.resolveApproval`, the
`resolveApproval` event, or the attached surface; the host must remove resolved
approvals from its state. A rejected resolution leaves the request visible.
Approvals and questions preserve draft text, selection, pending command mode and
attachments. The composer returns after the last expanded request resolves or is
cancelled; its saved selection is focused only if focus was still inside the
resolved request. Background resolution does not steal focus.

`CodexConversationPane` renders both blocking tool questions and asynchronous
agent-message questions with the same answer controls. A pending question replaces the
shelf and composer while its turn is running. Surface-bound panes read blocking
requests from the SDK snapshot; controlled panes pass them through as
`thread.clientRequests` (or the standalone `clientRequests` prop). The active
blocking tool card is hidden in the transcript while the question is in the
composer; its answered summary remains in history. When an async question's turn
ends, the composer returns with a **Pending question** button beside its action
menu; clicking the label reopens the question, while its leading icon changes
to a cancel control on hover. Answering or cancelling removes that
button. Sending or steering a prompt also dismisses it, including after the
conversation is reloaded. Additional questions remain available in request
order. The historical agent message is not deleted. Surface-bound panes send responses through
`respondToClientRequest()` automatically. Controlled panes dispatch
`actions.clientResponse`; keep `thread.answeredClientRequestIds` current so
resolved questions render consistently. The component lab's **Approvals & questions**
scenario covers native/tool approvals, choices or free text, single or multi-step
questions, and blocking or async delivery. **Complete turn** exposes the async
pending-question chip. Questions whose `options` value is `null` render an
immediately focused free-text field. Questions with `isOther: true` and options
show an always-visible, initially one-line field beside Other. Focusing or typing
in it selects Other, preserving any other selections only for `multiSelect`
questions. Question cards omit a header that repeats
the question, and an immediately preceding text part that exactly matches a
structured question is not rendered twice. Distinct introductory text and
short question labels remain visible. Answered questions stack their label
above the answer, with wrapping and line breaks preserved. Once their ID is in
`answeredClientRequestIds` (answered or cancelled), they fold into the turn's
work details.
Submitted answers survive disclosure remounts. Rehydrated surface user messages
carry structured `metadata.asyncQuestionAnswers`, keyed by question ID, so the
message list can restore answers alongside their original questions.

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
  activeCommandId?: string | null;
};
```

`CodexComposer` and `CodexConversationPane` accept `composerState` and emit
`update:composerState` continuously for text and selection-only changes. When
`composerState` and `modelValue` are both supplied, `composerState` is
authoritative. Changing `conversationKey` restores the incoming state without
emitting an intermediate empty value. `activeCommandId` identifies an active
command whose `CodexCommandSummary.composerMode` supplies the visible chip label
and placeholder. Submitting serializes `/<slashName-or-name> <text>` and clears
the active command; removing its chip preserves the current text. The built-in
Goal mode can also be toggled in the + menu when goals and `codex.goal` are
available. It uses the same `activeCommandId` state as `/goal`, and is mutually
exclusive with Plan mode.

```ts
type CodexCommandSummary = {
  // existing identity and description fields
  composerMode?: {
    label?: string;
    placeholder?: string;
  };
};
```

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
canonical `'(no user instructions)'` prompt for send, queue, or steer. It also accepts
`queuedPromptId`; when the composer is empty, Cmd+Enter emits
`steerQueuedPrompt` for that queued item instead of submitting an empty steer.
In `CodexConversationPane`, queued-prompt Edit loads the text into an empty
composer. Enter dispatches `updateQueuedPrompt(promptId, prompt)`, while
Cmd+Enter dispatches `steerQueuedPrompt(promptId, prompt)`.

### Host-owned message selection and composer context

`CodexMessageList` and `CodexConversationPane` accept
`messageTextSelection` (default `false`) and emit
`messageTextSelectionChange` with `CodexMessageTextSelection | null`:

```ts
type CodexMessageTextSelection = {
  text: string;
  messageId?: string;
  turnId?: string;
  messageIndex: number;
  role: 'user' | 'assistant';
  anchor: { x: number; y: number; width: number; height: number };
};
```

Only a non-empty selection contained by one rendered message is emitted. The
anchor uses viewport coordinates. Scrolling, collapsing the selection,
changing the conversation key, or disabling the feature emits `null` after an
active selection.

`CodexConversationPane` also provides the `composer-context` slot and
`hasComposerContext`. These are for host-rendered context cards whose semantics
remain outside the SDK. `hasComposerContext` enables Send with no typed prompt;
a context-only controlled submit receives an empty string so the host can
serialize the cards. `CodexComposer` exposes the lower-level equivalent as
`hasExternalContent`. Neither API modifies renderer attachments.

`CodexConversationPane` provides `composer-shelf-actions` for host-owned
controls in the shelf above the composer. It renders after the built-in turn
diff, queued prompts, and active goal, and receives `{ disabled: boolean }`.
The exported `CodexComposerShelf` exposes the same position as its `actions`
slot with the same scope. Empty slot output does not mount an action row or
shelf. Slot content does not alter SDK conversation state.

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
to the same overridable image-opening contract, copy writes the rendered image
blob to the browser clipboard and shows a brief check confirmation, and download
uses browser download behavior without entering the conversation-link routing path.

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
streaming markers do not expand the window. An unseen `conversationKey` opens
at the newest batch; returning to a previously viewed key restores its mounted
window and scroll position.
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
assistant commentary, reasoning-aware tool groups, and generated media share
one logical turn. Commentary and tool groups share the `Working` / `Done`
disclosure, while generated media remains visible outside that fold in its
chronological position. The latest reasoning summary labels only the currently
active tool group; normal assistant text removes that transient label. A transform that returns a `CodexChatMessage` should retain
`turnId` for that behavior. A tool-only active segment is treated as structured
work before the first phased text arrives; unphased messages containing
ordinary text retain the flat rendering path.

Pass `activeTurnId` and `turns` when controlling the list, or put them in
`controller.state.identity`. Surface-bound panes wire both automatically.
`activeTurnId` is authoritative for completed message groups; `busy` remains
the broader conversation-level pending state used by the composer and Thinking
placeholder. A real streaming assistant segment reopens its own turn even when
the provider has not restored `activeTurnId` yet, including after an asynchronous
question answer resumes a previously completed turn. An active `Working`
disclosure is always expanded and cannot be collapsed.

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

Skill suggestions rank IDs, names, display names, and insertion aliases together:
exact matches first, then whole words, word prefixes, and substrings.
Description-only matches come last; equally scored matches retain catalog order.
For example, `$cp` ranks **Commit Push (cp)** above **sites:sites-mcp**.

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

`CodexConversationPane` and `CodexMessageList` accept
`toolVisibility?: CodexToolVisibility`, where
`CodexToolVisibility = (toolCall: CodexMessageToolCall) => boolean`. Return
`false` to omit a tool from rendered messages and work counts; the default is
visible. This does not alter snapshots, events, or tool execution.

See the [Vue guide](/guide/vue),
[conversation pane integration](/guide/conversation-pane),
[composer guide](/guide/composer), [history guide](/guide/history),
[message/tool guide](/guide/messages-tools),
[Vue provider guide](/guide/vue-providers), and
[presentation guide](/guide/presentation).
