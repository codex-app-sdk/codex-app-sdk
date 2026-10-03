# Changelog

## Unreleased

### Security

- `isAllowedCodexWebSocketOrigin()` rejects WebSocket upgrades from unexpected
  origins. The scaffolded web target and the web sample now apply it, so other
  websites can no longer drive a locally running Codex server.
- `installCodexWindowPolicy()` keeps Electron windows on the app renderer, and
  the new `isTrustedSender` option of `registerCodexElectronMain()` (with
  `isCodexRendererSender()`) rejects IPC from any other page. The scaffold and
  the Electron samples restore their navigation guard using both.

### Fixed

- Starting or reconnecting the stdio app-server no longer freezes the event
  loop (about 2 s in Electron's main process) while probing login shells.
  Discovery now runs asynchronously through the new `resolveCodexRuntime()`,
  each probe is bounded by `shellTimeoutMs` (default 5 s), and results are
  cached per process. Closing a transport while it starts no longer leaves an
  orphaned app-server.

### Performance

- Streaming no longer sends the full state for every token. `CodexSurface`
  exposes `getVersionedSnapshot()` and `onStatePatch()`, whose patches carry
  only changed values and list items (about one message per token instead of
  hundreds of kilobytes in long conversations). The Electron bridge and the web
  transport switch to patches when both sides support them and keep sending
  snapshots otherwise; the web protocol stays at version 1.
  `useCodexSurface` mirrors patches so unchanged messages keep their identity,
  and Markdown is parsed only when a block's text changes.

## 0.13.0

First public npm release of all six `@codex-app-sdk` packages. Earlier versions
remain on GitHub Packages; see the [migration guide](https://codex-app-sdk.github.io/codex-app-sdk/guide/installation.html#package-access).

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
