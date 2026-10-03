# Changelog

## Unreleased

### Security

- `isAllowedCodexWebSocketOrigin()` rejects WebSocket upgrades from unexpected
  origins. The scaffolded web target and the web sample now apply it, so other
  websites can no longer drive a locally running Codex server.

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
