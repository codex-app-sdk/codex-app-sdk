# Composer and input

`CodexComposer` is the same rich composer used by `CodexConversationPane`. It
owns text editing, suggestions, keyboard behavior, attachment state, recording,
and the standard model/reasoning selector.

## Canonical prompt syntax

The editor renders rich chips while preserving plain Codex prompt text:

| Prefix | Meaning | Catalog source |
| --- | --- | --- |
| `/` | Commands and slash-invoked skills | `commands`, `skills` |
| `$` | Codex skill mention | `skills` |
| `@` | Plugin or file mention | `plugins`, `files` |

`$skill`, `@plugin`, and `@path` remain in the submitted text. The SDK does not
replace them with private editor markup. File suggestions require a host-supplied
file catalog, normally backed by a conversation with a working directory.

```vue
<CodexComposer
  :commands="commands"
  :skills="skills"
  :plugins="plugins"
  :files="files"
  @send="send"
/>
```

## Keyboard behavior

| Gesture | Result |
| --- | --- |
| `Enter` | Submit the current prompt |
| `Shift+Enter` | Insert a newline at the current selection |
| `Cmd+Enter` | Steer the active turn |
| `Shift+Tab` | Toggle plan mode when the capability is enabled |

Suggestion menus consume navigation keys before composer shortcuts. Newline
insertion preserves the caret even when it splits text in the middle of a line,
and the editor scrolls immediately when the new line exceeds its visible height.

When `queuedPromptId` is supplied and the composer is empty, `Cmd+Enter` emits
`steerQueuedPrompt` for that queued item. It does not create an empty steer.

## Controlled text and selection

Use `composerState` for per-conversation draft persistence:

```ts
export type CodexComposerState = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};
```

```vue
<CodexConversationPane
  :composer-state="drafts[conversationId]"
  @update:composer-state="drafts[conversationId] = $event"
/>
```

The component emits updates for canonical text changes and selection-only caret
changes. Incoming selections are clamped to the text length and restored when
the conversation changes. Switching `conversationKey` does not emit an
unsolicited empty draft.

`modelValue` / `update:modelValue` remains available as a text-only compatibility
contract. When both contracts are supplied, `composerState` is authoritative.

For a controlled pane controller, place the state in `composer.state` and
handle `updateComposerState`. This avoids forwarding both Vue events manually.

## Attachments

The stock pane supports native picking, paste, and drag/drop. `attachments` and
`attachmentsChange` form the granular controlled contract; a pane controller
uses `composer.attachments` and `updateAttachments`.

Attachment paths are deduplicated and the standard pane keeps at most 20 items.
The same `SendCodexMessageOptions.attachments` shape is used for send and steer.
Changing conversations restores the host's incoming attachments without first
emitting an empty list.

An attachment-only submission is valid. When text is empty but attachments are
present, the composer submits the canonical prompt:

```text
(no user instructions)
```

This keeps the app-server turn contract explicit while allowing image- or
file-only interaction.

## Voice recording

The microphone control records without disabling the normal Send button:

- pressing the microphone again stops, transcribes, and inserts text without
  sending;
- pressing Send while recording stops, waits for transcription, updates the
  prompt, and submits the completed text exactly once;
- duplicate submission is disabled while transcribe-and-send is pending.

Custom composer layouts can reuse the same state machine:

```ts
import { useCodexComposerVoice } from 'codex-app-sdk/vue';

const voice = useCodexComposerVoice({
  isDisabled: () => disabled.value,
  isSending: () => sending.value,
  onTranscript: (text) => insertTranscript(text),
  transcribeAudio,
});
```

The controller exposes `buttonDisabled`, `buttonLabel`, `buttonTitle`, `error`,
`isRecording`, `isTranscribing`, `recorder`, `stop()`, `toggle()`, and
`dispose()`. Pair it with `CodexComposerVoiceButton` and
`CodexComposerVoiceField`.

## Model, reasoning, and Fast mode

`CodexModelReasoningSelector` uses one hierarchical menu so the active model,
reasoning effort, and service tier are visible together. Models and supported
efforts come from the app-server catalog; the component does not invent IDs.

When the model advertises a `priority` or `fast` service tier, the menu exposes
a Fast mode toggle. Enabling it emits that tier ID. Disabling it emits `null`,
not the reserved app-server `default` tier. The composer only displays the Fast
indicator while the selected tier is actually fast/priority.

## Focus and layout

`CodexConversationPane` exposes `focusComposer()`, and `CodexComposer` exposes
`focus()`. Use the pane method when an app-level shortcut should return focus to
the prompt.

The stock layout keeps attachment previews above the input and places context
usage before the model selector. Customize visibility through
`CodexConversationPresentation`; do not reach into private composer classes.

See [Native capabilities](/guide/native-capabilities),
[Conversation pane integration](/guide/conversation-pane), and the
[Vue API](/api/vue).
