# Changelog

## Unreleased

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
