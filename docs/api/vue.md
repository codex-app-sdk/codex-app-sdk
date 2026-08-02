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

## Primary components

| Component | Purpose |
| --- | --- |
| `CodexConversationPane` | Complete bound or unbound conversation surface |
| `CodexComposer` | Full composer with menus, attachments, voice, settings, and send/steer behavior |
| `CodexMessageList` | Conversation message collection |
| `CodexMessage` | One message with blocks, status, thinking, and actions |
| `CodexApprovalPrompt` | Command, file-change, and permission approval UI |
| `CodexWorkbenchLayout` | Measured sticky header/content/footer layout |
| `CodexConversationHistoryLoader` | Restored-history loading treatment |

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

### Messages and media

`CodexMessageBlock`, `CodexUserText`, `CodexAttachmentBlock`, `CodexMediaBlock`,
`CodexMermaidBlock`, `CodexCompactionMessage`, `CodexMessageActions`,
`CodexMessageEditor`, and `CodexFoldTransition`.

### Tools and conversation state

`CodexToolCall`, `CodexToolCallTitle`, `CodexToolGroup`,
`CodexToolConfirmation`, `CodexToolUserInputRequest`, `CodexGoal`,
`CodexQueuedPrompt`, `CodexQueuedPrompts`, `CodexFollowUps`,
`CodexTurnGitInfo`, and `CodexAnimatedDiffStat`.

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
- model, reasoning, skill, plugin, command, context-usage, goal, diff, and
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

- `provideCodexChatTranslate`
- `provideCodexToolCallDetails` and `useCodexToolCallDetails`
- `registerCodexToolTitlePresenter`
- capability/presentation resolvers
- composer command, plugin, skill, queue, and mention helpers

See the [Vue guide](/guide/vue) and [presentation guide](/guide/presentation).
