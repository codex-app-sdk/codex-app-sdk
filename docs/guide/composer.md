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
| `@` | Plugin, file, or host-defined mention | `plugins`, `files`, `mentionGroups` |

`$skill`, `@plugin`, and `@path` remain in the submitted text. The SDK does not
replace them with private editor markup. File suggestions require a host-supplied
file catalog, normally backed by a conversation with a working directory.

Clicking a command inserts its slash text, or submits it when `submitOnSelect`
is set. With the slash menu open, `Enter` executes the highlighted command;
`Tab` only completes it, leaving the slash text in the editor for ordinary
commands. A command can instead declare a pending composer mode when it needs
arguments before submission:

```ts
const commands = [{
  id: 'host.deploy',
  name: 'deploy',
  displayName: 'Deploy',
  composerMode: {
    label: 'Deploy',
    placeholder: 'Describe the deployment',
  },
}];
```

Executing, completing, or clicking that command removes the slash query, shows
a removable mode chip, and keeps Send disabled until the user enters text.
Submission prepends the
canonical slash name, for example `/deploy staging`. The built-in `/goal`
command uses this contract so the objective is collected before a complete
`/goal Ship the SDK` command is submitted. Typing the complete command manually
remains valid.

The + menu exposes Goal mode beside Plan mode when goals are supported and the
built-in `codex.goal` command is available. It activates the same pending
objective as `/goal`; selecting it again removes the mode without clearing the
draft. Goal and Plan are mutually exclusive: activating either one turns off
the other, including when Goal is selected through slash suggestions or Plan
is toggled with Shift+Tab.

```vue
<CodexComposer
  :commands="commands"
  :skills="skills"
  :plugins="plugins"
  :files="files"
  @send="send"
/>
```

## Host-defined mentions

Apps can add grouped `@` results without disguising them as plugins or files.
Each item separates the friendly label from the stable token stored in the
prompt:

```ts
const mentionGroups = [{
  id: 'threads',
  label: 'Threads',
  placement: 'before',
  items: threads.map((thread) => ({
    id: thread.id,
    value: `thread:${thread.id}`,
    label: thread.title,
    payload: { threadId: thread.id },
  })),
}];
```

```vue
<CodexConversationPane
  :mention-groups="mentionGroups"
  @mention-select="handleMentionSelected"
>
  <template #suggestion-item="{ item }">
    <BotIcon /> {{ item.label }}
  </template>
  <template #mention="{ item, surface }">
    <ThreadMention :thread="item.payload" :surface="surface" />
  </template>
</CodexConversationPane>
```

Selection inserts canonical text such as `@thread:019abc`; the composer and
subsequently rendered user message display `item.label`. `value` must be a
single token composed of letters, digits, `_`, `.`, `:`, or `-`. Keep the
group catalog available while rendering history so the SDK can recognize the
stable token after reload. `placement` defaults to `before`, placing app groups
above Plugins and Files; use `after` for trailing groups.

The `suggestion-item` slot owns custom suggestion-row rendering. The shared
`mention` slot owns custom chips and receives `surface: 'composer' | 'message'`.
Controller-based panes supply the catalog through
`state.catalogs.mentionGroups` and receive selection through
`actions.mentionSelect`.

## Keyboard behavior

| Gesture | Result |
| --- | --- |
| `Enter` | Send while idle; while busy, use `followUpBehavior` (queue by default) |
| `Up` / `Down` with a slash menu open | Highlight a command |
| `Enter` with a slash menu open | Execute the highlighted command; commands requiring input activate their composer mode |
| `Tab` with a slash menu open | Complete the highlighted command without submitting it; commands requiring input activate their composer mode |
| `Shift+Enter` | Insert a newline at the current selection |
| `Cmd+Enter` / `Ctrl+Enter` | While busy, use the other follow-up action; while idle, use ordinary send |
| `Shift+Tab` | Toggle plan mode when the capability is enabled |
| `Up` / `Down` in an empty composer | Navigate backward / forward through submitted prompts |
| `Escape`, then `Escape` again within two seconds | Interrupt the active turn |

Set `follow-up-behavior="steer"` on `CodexComposer` or `CodexConversationPane`,
or `composer.followUpBehavior: 'steer'` in a pane controller, to make Enter and
the send button steer during an active turn. Cmd/Ctrl+Enter then queues instead.
The default is `'queue'`. Button labels and tooltip shortcuts reflect the
effective action. With `capabilities.steerPrompt: false`, both paths use ordinary
send, preserving attachments and input options; the host queues while busy.

Suggestion menus consume navigation keys before composer shortcuts. Newline
insertion preserves the caret even when it splits text in the middle of a line,
and the editor scrolls immediately when the new line exceeds its visible height.
The composer grows upward with multiline content until twelve lines are visible,
then keeps that height and scrolls internally.

While a conversation pane is busy, the first unhandled `Escape` holds the
button's normal hover state for two seconds: the progress spinner gives way to
the stop square. Press `Escape` again or click the button to interrupt. The
listener is document-wide, so the composer does not need focus. It ignores
modified, repeated, already-handled, IME, and modal-dialog key events. If more
than one pane is busy, the shortcut only applies when focus is inside one of
them. Set `:escape-interrupt="false"` on `CodexConversationPane` when the host
owns the shortcut.

Prompt recall is bounded to 100 entries. A surface-bound pane loads one
`thread/turns/list` page with `itemsView: 'summary'` when the conversation
becomes active, then immediately retains only visible user prompt strings;
assistant summaries and the raw response are not stored in renderer state.
The result is cached per conversation and merged with the currently visible
lazy-history page. An `Up` press made during the brief load is replayed when the
prompts arrive. Editing a recalled prompt exits navigation.
Recall only intercepts Up/Down while the selection is collapsed at the very
end of the prompt. Moving the caret left or selecting text restores the
editor's native vertical cursor movement.

Controlled panes can either provide `composer.promptHistory` directly or
implement `actions.readPromptHistory()`. The latter is invoked once on first
activation of a conversation key and must resolve to chronological prompt
strings. Standalone `CodexComposer` consumers can pass `promptHistory` and,
when loading asynchronously, `promptHistoryLoading`.

While busy, when `queuedPromptId` is supplied and the composer is empty, the
steer shortcut emits `steerQueuedPrompt` for that queued item. This is
Cmd/Ctrl+Enter by default, or Enter with `followUpBehavior: 'steer'`.
It does not create an empty steer, and unsupported steering leaves the queue alone.

Set `empty-send-prompt="continue"` on `CodexConversationPane` (or
`CodexComposer`) to submit `continue` when Send is activated with an otherwise
empty composer. With no text, attachments, host context, or active command, the
muted Send button becomes available on hover; clicking it or pressing
Cmd/Ctrl+Enter submits the configured fallback text while idle. The default is empty, which
preserves the normal disabled Send behavior. This does not override the
dedicated interrupted-turn Continue action, an active-turn interrupt, or
the busy-composer steer shortcut on an existing queued prompt.

`CodexConversationPane` also renders an Edit action for each queued prompt.
Editing is disabled while the composer contains a draft. A normal submit saves
the edited text in the same queue position; the steer shortcut while busy
steers the edited text immediately and removes the queued item. Unsupported
steering saves the edit instead, without duplicating it.

## Controlled text and selection

Use `composerState` for per-conversation draft persistence:

```ts
export type CodexComposerState = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  activeCommandId?: string | null;
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
unsolicited empty draft. `activeCommandId` preserves a pending composer-mode
command across controlled echoes and conversation switches; keep the referenced
command in the supplied command catalog while restoring that state.

`modelValue` / `update:modelValue` remains available as a text-only compatibility
contract. When both contracts are supplied, `composerState` is authoritative.

For a controlled pane controller, place the state in `composer.state` and
handle `updateComposerState`. This avoids forwarding both Vue events manually.

## Attachments

The stock pane supports native picking, paste, and drag/drop. `attachments` and
`attachmentsChange` form the granular controlled contract; a pane controller
uses `composer.attachments` and `updateAttachments`.

Attachment references are deduplicated and the standard pane keeps at most 20
items. Send and steer both emit `CodexRendererSendMessageOptions`; each
attachment contains an opaque `{ type, reference }` plus optional image
`detail`, never a filesystem path. Electron main or the authorized web lease
resolves that reference immediately before the backend call. Changing
conversations restores the host's incoming attachments without first emitting
an empty list.

Add host-specific controls beside each selected attachment with the generic
`composer-attachment-actions` slot:

```vue
<CodexConversationPane>
  <template #composer-attachment-actions="{ attachments, index, disabled }">
    <button :disabled="disabled" @click="inspect(attachments[index])">
      Inspect
    </button>
  </template>
</CodexConversationPane>
```

The slot renders immediately before the SDK-owned remove button. It exposes the
complete readonly attachment list and current index so hosts can derive the
selected attachment without duplicating attachment state.

An attachment-only submission is valid. When text is empty but attachments are
present, the composer submits the canonical prompt:

```text
(no user instructions)
```

This keeps the app-server turn contract explicit while allowing image- or
file-only interaction. Attachment-only prompts also work while a turn is busy:
the queue and steer actions use the same sentinel and attachment references,
regardless of the follow-up preference.

## Voice recording

On supported macOS hosts, words appear in the composer while you speak. Unstable
words are quieter and can change as recognition improves. Finalized phrases use
normal text, followed by a small translucent dot that reacts to microphone volume
without waiting for words to arrive. It stays still in silence. The
microphone button becomes a primary-colored
circle with a white icon. Batch-only hosts use the same active microphone state
and transcribe on stop.

The microphone control records without disabling the normal Send button:

- pressing the microphone again stops, transcribes, and inserts text without
  sending;
- pressing Send while recording stops, waits for transcription, updates the
  prompt, and submits the completed text exactly once;
- duplicate submission is disabled while transcribe-and-send is pending.
- Escape discards dictation, restoring the existing draft and attachments.

Draft text is preserved until finalization, and the transcript is inserted at
the saved caret (or replaces the selected text). A failed or empty recording
does not submit the old draft. Apple recognition runs on device; it may require
a first-use speech-model download. See [native setup](/api/electron#streaming-dictation).
Live dictation favors faster text delivery using Apple's fast-result mode, which
can trade some recognition accuracy for responsiveness. Review the text before
sending when accuracy is important; batch transcription retains its standard mode.

When transcription contributes to a submission, the stock composer includes
`inputMethod: 'dictated'` in the emitted `CodexRendererSendMessageOptions` and
resets that provenance after submission. Typed submissions keep the option
absent.

Custom composer layouts can reuse the same state machine:

```ts
import { useCodexComposerVoice } from '@codex-app-sdk/vue';

const voice = useCodexComposerVoice({
  isDisabled: () => disabled.value,
  isSending: () => sending.value,
  onTranscript: (text) => insertTranscript(text),
});
```

The controller exposes `buttonDisabled`, `buttonLabel`, `buttonTitle`, `error`,
`isStarting`, `isRecording`, `isTranscribing`, `isLive`, `transcript`, `audioLevel`,
`stop()`, `cancel()`, `toggle()`, and `dispose()`. Pair it with
`CodexComposerVoiceButton` and `CodexComposerVoiceField`:

```vue
<CodexComposerVoiceField
  :starting="voice.isStarting.value"
  :recording="voice.isRecording.value"
  :transcript="voice.transcript.value"
  :audio-level="voice.audioLevel.value"
/>
<CodexComposerVoiceButton
  :disabled="voice.buttonDisabled.value"
  :label="voice.buttonLabel.value"
  :recording="voice.isRecording.value"
  :title="voice.buttonTitle.value"
  @toggle="voice.toggle()"
/>
```

The controller discovers the scoped host capability automatically. A custom
batch `transcribeAudio` callback remains supported and opts out of native
streaming. Custom fields can instead supply a `streamingTranscription` service;
only `onTranscript` should insert final text into their editable value.

## Model, reasoning, and Fast mode

`CodexModelReasoningSelector` uses one hierarchical menu so the active model,
reasoning effort, and service tier are visible together. Models and supported
efforts come from the app-server catalog; the component does not invent IDs. The
selector stays available while a turn is running. Changes update the conversation
settings used by subsequent prompts without interrupting the active turn.
Models appear directly at the menu root. Each model opens a submenu containing
only its supported reasoning efforts; hovering or pressing ArrowRight opens it
without changing settings. Clicking a model (or pressing Enter) selects it
immediately, preserving the current effort when supported. Otherwise it chooses
High, then the model's supported default, then its first supported effort.
Choosing an effort selects that model and effort, then closes the menu. Models
without reasoning options (or with `showReasoning` disabled) are selected
directly. The current model shows its effort beside its name, and the selected
effort is highlighted without a checkmark. Fast mode remains below the model
list and applies to the currently selected model.

Hosts can prepend their own actions and nested presets with
`composer.modelMenuItems` on a controlled pane, or `model-menu-items` on the
granular pane/composer components. The SDK renders those entries before its
built-in groups and returns the original host payload through `menuSelect`; the
host owns only the custom action and its persistence, not a duplicate selector.
Use `heading.actions` for compact icon actions beside a host section title.
Use `valueIcon` with `valueIconLabel` when a trailing status is clearer as an
icon than as text; it may be combined with a short `value`.
Set `valueAppearance` to `badge` when that short value is categorical metadata.
Host items keep their own `closeOnSelect` behavior, so a preset can still apply
all of its settings and close the menu in one step.

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
