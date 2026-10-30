# Changelog

## Unreleased

## 0.19.0

### Added

- Load history summaries first with `historyItemsView: 'summary'`; expand
  Working to fetch and cache one turn's details while active turns stream normally.
- Read conversation images and diffs on demand through bounded content chunks.
- Recover recorded tool screenshots from original Codex history, including
  captures whose temporary files have been deleted or overwritten.
- Load image previews near the viewport and reserve their intrinsic aspect ratio
  before download to keep scrolling stable.

### Changed

- Retain compressed originals and thumbnails within the preview budget, so
  returning to earlier screenshots avoids repeated downloads. Open, copy, and
  download actions preserve the original image bytes.

### Fixed

- Keep queued prompts and their action controls inside the conversation width.

## 0.18.2

### Fixed

- Discard unanswered asynchronous questions when a new turn starts, keeping
  them resolved across replay and rejecting late answers to resolved questions.

## 0.18.1

### Fixed

- Show Goal controls when a host composer advertises Goal support without a
  native Codex conversation ID.
- Restore skill, plugin, and custom mention pills from canonical links after
  reloading a conversation, retaining custom labels and stable targets.
- Match message reference pills to composer styling and keep selected plugins
  out of the attachment list.
- Resume the Working display when app-server activity follows an answer,
  replacing the earlier summary until a new answer arrives.
- Keep suggestion menus open when typing resumes before an earlier blur delay
  expires.

## 0.18.0

### Added

- Render code blocks with Highlights after WebAssembly initializes, with Shiki
  providing the initial rendering and fallback when Highlights is unavailable.

### Changed

- Update the public app-server bindings and supported CLI target to Codex 0.164.0,
  including the `partial_answer` message phase.
- Use `thread/revert` for paginated conversation edits, retries, and deletions.
  Legacy conversations remain readable and accept new prompts; these mutations
  reject without changing history because legacy rollback is no longer supported.

## 0.17.0

### Added

- Preserve explicitly selected skills, plugins, files, and host mentions through
  drafts, queued prompts, message editing, retries, and conversation rendering.
- Share serializable prompt content and text-editing helpers across desktop,
  web, and native clients without requiring Vue or a mention catalog for display.

### Changed

- Keep typed or pasted `$skill` and `@name` text literal; accepting a suggestion
  creates a selected mention with a saved label and stable target.
- Send selected skills as canonical Markdown references for the model while
  retaining native skill inputs and the friendly labels displayed to the user.

### Fixed

- Prevent WebKit undo and redo from replaying a submitted chip into another
  draft while editing a message.

## 0.16.9

### Added

- Add reusable composer drawers and rows, plus a `composer-drawers` slot, so
  hosts can display their own items beside queued prompts with consistent styling.

### Fixed

- Prevent dependency optimization from reloading the browser focus test during
  selection checks.

## 0.16.8

### Added

- Expose request-usage availability and missing evidence so analytics consumers
  can distinguish unknown request costs from zero consumption.

### Fixed

- Keep live work timers running when Codex omits the turn start timestamp,
  preserving the observed start until provider timing becomes available.

## 0.16.7

### Added

- Show elapsed time in the work disclosure: a live `Working · 1m 12s` while a
  turn runs and `Done · 4m 38s · View details` once it finishes, including the
  stopped and failed variants.

## 0.16.6

### Added

- Accept suggested follow-ups into an empty draft with Right Arrow or Space,
  alongside Tab, without sending the message.

## 0.16.5

### Fixed

- Keep question cards inside expanded tool groups sized to the conversation
  width as sidebars and windows resize.

## 0.16.4

### Fixed

- Show readable running and completed titles for unknown MCP and plain tools,
  removing server prefixes and replacing underscores and hyphens with spaces.

## 0.16.3

### Fixed

- Attribute token usage for the first turn of a newly created conversation,
  preserving prior provider evidence and unknown baselines for resumed or
  forked conversations.
- Generate Electron and web applications with SDK dependencies that include
  the latest fixes.

## 0.16.2

### Fixed

- Preserve images returned by tools in live conversations and restored history.
- Resolve host-owned image paths in attachments and generated media, keeping
  previews stable across conversation updates.

## 0.16.1

### Fixed

- Keep message actions available on completed replies containing only tool
  activity, without requiring a written final answer.
- Preserve the reading position when offscreen message layout changes while
  scrolling, including in WebKit-based views.

## 0.16.0

### Added

- Redeem an earned reset through an explicit, idempotency-keyed API, with
  normalized outcomes, stale-account protection, and no automatic retries.
- Read fresh account rate limits and earned-reset details through native,
  Electron, and web surfaces, with exact counts and stale-account rejection.
- Read account-wide token summaries and daily buckets explicitly, separately
  from local turn usage and telemetry.
- Observe cumulative execution usage when lifecycle and counter evidence permit
  attribution, retaining unknowns, late corrections, and model reroutes.
- Observe native streaming dictation operation outcomes through an optional
  content-free hook, without coupling recording to observation or consent.

## 0.15.1

### Fixed

- Keep the model selector accessible on phone-sized screens with a compact
  brain-icon button. Desktop layouts retain the model and reasoning label.

## 0.15.0

### Added

- On-device live dictation on supported Macs, with provisional words, finalized
  text, and an audio-reactive listening indicator. Preserve drafts and attachments
  across stop, cancel, navigation, and send-on-stop.
- Shared streaming speech sessions across the native helper, Electron bridge,
  and Vue voice controller, with batch transcription fallback.

### Changed

- Deliver live transcription sooner using Apple's fast-result reporting mode.
  Batch transcription retains its standard recognition mode.
- Simplify approval and question cards, including immediate selection of answers.
- Replace the waveform UI with live text and microphone controls. Custom voice
  layouts should use `CodexComposerVoiceField` and the controller's `transcript`
  and `audioLevel` state; the `CodexComposerWaveform` and
  `CodexComposerVoiceRecorder` exports and controller `recorder` field are removed.

## 0.14.4

### Added

- Configurable composer follow-up behavior: Queue (default) or Steer on Enter
  and the send button, with Cmd/Ctrl+Enter using the alternate action while busy.
  Idle shortcuts use ordinary send, Shift+Enter keeps inserting a newline,
  and unsupported steering falls back to ordinary send.

### Fixed

- Keep new assistant activity below the compaction divider when a tool started
  before compaction finishes afterward.

### Release infrastructure

- Use a single production publishing run: validate packages, publish to npm,
  and create the GitHub release. Remove the separate workflow dry-run mode.

## 0.14.3

### Added

- Interactive inline HTML previews for assistant artifacts and full-document
  HTML fences. Sandboxed streaming preserves DOM, input, and script state
  without replacing the page on each chunk. Includes source/copy/download
  controls and a streaming component-lab scenario with a Chart.js example.
  HTTPS script libraries are supported without granting host-origin access
  or enabling API fetches.

### Changed

- List models directly in the composer menu, with a reasoning-effort submenu
  per model. Clicking a model preserves a supported effort or falls back to
  High, then the model default. Hovering lets users browse without switching.
- Align menu and suggestion labels and headings at 13.5px regular weight.
- Refresh public npm installation and scaffolder README guidance.

## 0.14.2

### Release infrastructure

- Publish all six packages through GitHub Actions using npm trusted publishing
  and provenance. Add version confirmation, a dry-run mode, and GitHub release
  creation for the published commit.
- No runtime or API changes from 0.14.1.

## 0.14.1

### Added

- Press Tab in an empty composer to accept a host-provided placeholder as an
  editable draft, without submitting it. Native undo and caret placement are
  preserved; default hints and active command modes are not accepted.

### Fixed

- Composer placeholders use a more muted color while retaining normal text weight.
- Non-macOS builds skip validation of the macOS-only speech helper.

## 0.14.0

First complete public npm release of all six scoped SDK packages.

### Security

- `isAllowedCodexWebSocketOrigin()` rejects WebSocket upgrades from unexpected
  origins. The scaffolded web target and the web sample now apply it, so other
  websites can no longer drive a locally running Codex server.
- `installCodexWindowPolicy()` keeps Electron windows on the app renderer, and
  the new `isTrustedSender` option of `registerCodexElectronMain()` (with
  `isCodexRendererSender()`) rejects IPC from any other page. The scaffold and
  the Electron samples restore their navigation guard using both.

### Fixed

- Non-image attachments now deliver their filename and original path to the
  model, while preserving attachment chips in live and reloaded history.
- Composer paste operations participate in native undo history.
- Paged history loading state stays synchronized in conversation replicas,
  allowing older messages to load when scrolling back.
- Completed turns without assistant messages no longer leave a stale working
  indicator, and Goal mode precedes Plan mode in the composer menu.
- Thread idle no longer fabricates an interrupted turn outcome. It restores
  readiness and queue progress while waiting for authoritative completion;
  late completions preserve a newer active or pending turn in both the runtime
  and conversation replica.
- Starting or reconnecting the stdio app-server no longer freezes the event
  loop (about 2 s in Electron's main process) while probing login shells.
  Discovery now runs asynchronously through the new `resolveCodexRuntime()`,
  each probe is bounded by `shellTimeoutMs` (default 5 s), and results are
  cached per process. Closing a transport while it starts no longer leaves an
  orphaned app-server.
- A conversation updated while the list was being paged no longer appears
  twice in `conversations`.
- An exception thrown by a notification or state listener (for example
  `webContents.send` on a destroyed window) was reported as "malformed JSON"
  and rejected every in-flight request, and a throwing `onStateChange` listener
  made the action that triggered it fail. Listeners are now isolated: others
  still run, requests are unaffected, and the error goes to the new
  `onListenerError` option of `CodexSurface` and `CodexAppServerClient`
  (a process warning by default).

### Performance

- Streaming no longer sends the full state for every token. `CodexSurface`
  exposes `getVersionedSnapshot()` and `onStatePatch()`, whose patches carry
  only changed values and list items (about one message per token instead of
  hundreds of kilobytes in long conversations). The Electron bridge and the web
  transport switch to patches when both sides support them and keep sending
  snapshots otherwise; the web protocol stays at version 1.
  `useCodexSurface` mirrors patches so unchanged messages keep their identity,
  and Markdown is parsed only when a block's text changes.
- Refreshing the conversation list or plugin catalog keeps unchanged entries,
  so a refresh that finds nothing new sends no state change.

## 0.13.0

Initial public npm release preparation; only `@codex-app-sdk/backend` was
published. Use 0.14.0 or newer for the complete SDK. Earlier versions remain on
GitHub Packages; see the [migration guide](https://codex-app-sdk.github.io/codex-app-sdk/guide/installation.html#package-access).

### Added

- Live chat support with a component-lab example.
- Unified approval requests in the composer, preserving drafts and attachments
  while approvals or questions are pending.
- An always-visible inline Other answer input that selects the custom answer
  when used.

### Fixed

- Composer and queue actions honor the host's steering capability.
- Exact skill aliases rank before substring matches in suggestions.
- Composer action menus preserve host theme colors.

### Documentation

- Public npm installation and scaffolding instructions, registry migration
  guidance, and refreshed GitHub Pages documentation.
- Consolidated request examples and reordered the component lab from basic to
  advanced features.
