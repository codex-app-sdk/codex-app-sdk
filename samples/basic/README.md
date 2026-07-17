# Basic Codex surface

This runnable Electron + Vue sample has two panes:

- `ConversationSidebar.vue` is sample-owned presentation fed by SDK conversation data.
- `CodexConversationPane` is imported directly from the SDK and handles messages, composing, interrupting, empty/error states, and extensible composer actions.

No sample file calls an app-server method or imports a generated protocol type.

From the SDK repository root:

```bash
npm install
npm run sample:start
```

The sample uses the current directory as its project. Set `CODEX_SAMPLE_CWD` to point it elsewhere:

```bash
CODEX_SAMPLE_CWD=/absolute/path/to/project npm run sample:start
```

The surface defaults to read-only access with no approval prompts. Change `permissionMode` and `approvalMode` in `electron/main.ts` when adding an approval UI.
