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
- message edit/delete/retry actions;
- goals, approvals, client requests, and queued prompts.

The composable subscribes immediately and disposes its listeners with the
current Vue effect scope.

`steerMessage(prompt, options?)` accepts `SendCodexMessageOptions`, including
attachments, just like `sendMessage`.

## Primary components

| Component | Purpose |
| --- | --- |
| `CodexConversationPane` | Complete bound or unbound conversation surface |
| `CodexComposer` | Full composer with menus, attachments, voice, model/reasoning/Fast mode settings, and send/steer behavior |
| `CodexMessageList` | Conversation message collection |
| `CodexScrollToBottom` | Reusable circular control for returning to the latest messages |
| `CodexMessage` | One message with blocks, status, thinking, and actions |
| `CodexApprovalPrompt` | Command, file-change, and permission approval UI |
| `CodexWorkbenchLayout` | Measured sticky header/content/footer layout |
| `CodexConversationHistoryLoader` | Restored-history loading treatment |

### Controlled attachments and steering

`CodexConversationPane` accepts `attachments` and emits `attachmentsChange`
for host-controlled attachment queues. Changing `conversationKey` restores the
incoming `attachments` value and does not emit an intermediate empty queue.

The pane's exact steering event is:

```ts
steer: [prompt: string, options?: SendCodexMessageOptions]
```

Template listeners use `@steer="(prompt, options) => ..."`. Selected
attachments are included in `options.attachments` and intentionally cleared
after the steer intent is emitted.

## Leaf components

### Composer and menus

`CodexComposerMenu`, `CodexComposerMenuList`, `CodexComposerSendButton`,
`CodexComposerActionMenu`, `CodexComposerActiveModes`,
`CodexComposerFileMentionMenu`, `CodexComposerPluginMenu`,
`CodexComposerSkillMenu`,
`CodexComposerSlashMenu`, `CodexComposerVoiceButton`, `CodexComposerVoiceField`,
`CodexComposerWaveform`, `CodexMentionChip`, `CodexRichTextEditor`,
`CodexContextUsageIndicator`, and
`CodexModelReasoningSelector`.

`useCodexComposerVoice(options)` exposes the same recording and transcription
controller used by `CodexComposer` for custom layouts. Options are
`isDisabled`, `isSending`, `onTranscript`, and optional `transcribeAudio`.
The controller provides `buttonDisabled`, `buttonLabel`, `buttonTitle`,
`error`, `isRecording`, `isTranscribing`, `recorder`, `toggle()`, and
`dispose()`.

### Messages and media

`CodexMessageBlock`, `CodexUserText`, `CodexAttachmentBlock`, `CodexMediaBlock`,
`CodexMermaidBlock`, `CodexCompactionMessage`, `CodexMessageActions`,
`CodexMessageEditor`, and `CodexFoldTransition`.

### Tools and conversation state

`CodexToolCall`, `CodexToolCallTitle`, `CodexToolIcon`, `CodexToolGroup`,
`CodexToolConfirmation`, `CodexToolUserInputRequest`, `CodexGoal`,
`CodexQueuedPrompt`, `CodexQueuedPrompts`, `CodexFollowUps`,
`CodexTurnGitInfo`, and `CodexAnimatedDiffStat`.

`CodexToolIcon` accepts a `toolCall` and optional resolved `presentation`. It
uses the same icon chain as stock tool rows: a host icon, a built-in Codex
action icon, a stable kind fallback, then the generic tool icon. Only an
explicit `presentation.icon` value of `null` suppresses the icon.

`CodexScrollToBottom` is also rendered by `CodexMessageList` whenever the
transcript is scrolled away from the bottom. It accepts an optional accessible
`label` and emits `click`; use it directly when composing a custom message
layout.

Pass `busy` to `CodexMessageList` (the conversation pane wires this from its
surface state) to keep a `Thinking` shimmer visible while a turn is accepted
but the app-server has not yet materialized its first assistant row.

Message actions remain visible on the latest completed assistant message. Older
message rows keep the hover/focus visibility behavior.

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
import { provideCodexToolCallDetails } from 'codex-app-sdk/vue';

provideCodexToolCallDetails(true);
```

An explicit component prop takes precedence over the provided value.

## Configuration contracts

- `CodexCapabilities`
- `CodexConversationPresentation` and its composer/message/shelf subtypes
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

See the [Vue guide](/guide/vue), [Vue provider guide](/guide/vue-providers), and
[presentation guide](/guide/presentation).
