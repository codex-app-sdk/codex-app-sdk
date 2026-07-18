# Spark chatbot

Spark is a kid-friendly chatbot built from the public Codex App SDK surface.
It deliberately reuses `CodexConversationPane` and customizes it through typed
capabilities, slots, and semantic theme tokens instead of reimplementing the
SDK conversation UI.

The sample demonstrates:

- an app-specific `CODEX_HOME` under Electron's user-data directory;
- authoritative SDK account state with a kid-friendly signed-out landing page
  and ChatGPT login opened through the SDK native bridge;
- a grown-up account menu that calls the SDK's real `logout()` action and
  returns the same surface to the signed-out landing page;
- host-owned conversation defaults pinned to `gpt-5.6-terra` with `medium`
  reasoning effort even though the selectors are hidden;
- a dedicated, read-only workspace and host-owned child-friendly instructions;
- a simplified composer with advanced Codex capabilities disabled through the
  SDK's `CodexCapabilities` contract;
- optional composer, shelf, message-action, and tool UI hidden through the
  SDK's typed `CodexConversationPresentation` contract;
- a sample-owned colorful conversation sidebar and empty-state suggestions;
- a host class plus supported semantic `--codex-*` color, typography, and
  control-size tokens for product theming;
- the SDK-owned Electron lifecycle, bridge, state, conversation, and message UI.

From the repository root:

```bash
npm run spark:start
```

For renderer HMR and automatic Electron restarts:

```bash
npm run spark:dev
```
