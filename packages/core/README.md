# `@codex-app-sdk/core`

Renderer-safe Codex contracts shared by backend, Electron, web, and Vue. This
package has no Node, Electron, Vue, or generated app-server dependencies.

```bash
npm install @codex-app-sdk/core
```

## Entry points

- `@codex-app-sdk/core` re-exports the public contracts.
- `@codex-app-sdk/core/surface` contains snapshots, messages, actions, semantic
  events, and trusted/renderer attachment option types.
- `@codex-app-sdk/core/native` describes optional attachment, clipboard,
  external-link, preview, and transcription capabilities.
- `@codex-app-sdk/core/events` exports `TypedEventBus`.
- `@codex-app-sdk/core/surface-bridge` is the validated operation dispatcher
  used by transport adapters.

Renderer attachments contain opaque `reference` values, never filesystem
paths. Host adapters resolve those references at a trusted boundary.

Semantic surface events include provider-neutral `subagent.*` activity for
hosts that want to build their own agent tree or activity pane. Core defines
the renderer-safe contract; it deliberately does not prescribe sub-agent UI.

Most applications consume these contracts indirectly through
`@codex-app-sdk/electron`, `@codex-app-sdk/web`, or
`@codex-app-sdk/vue`. See the [architecture
guide](https://nbonamy.github.io/codex-app-sdk/guide/architecture) and [surface
API](https://nbonamy.github.io/codex-app-sdk/api/surface).
