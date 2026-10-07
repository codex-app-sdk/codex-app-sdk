# Changelog

## Unreleased

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
