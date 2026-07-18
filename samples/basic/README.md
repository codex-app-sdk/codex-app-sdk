# Basic Codex surface

This runnable Electron + Vue sample demonstrates the intended SDK boundary:

- the custom left pane renders the app-server conversation list exposed by
  `useCodexSurface`;
- the right pane uses and customizes the SDK's `CodexConversationPane`;
- the SDK transport, state, and eventing handle history, streaming, models,
  reasoning, permissions, goals, skills, plan mode, approvals, app-server user
  input, message rollback actions, queued prompts, steering, interruption, and sending.

No sample file calls an app-server method or imports a generated protocol type.

From the SDK repository root:

```bash
npm install
npm run sample:start
```

For renderer HMR plus automatic Electron reloads when sample or SDK main/preload
sources change:

```bash
cd samples/basic
npm run dev
```

The sample does not send a cwd override. App-server owns the session working
directory and the conversation list is loaded globally from the active Codex home.

The renderer contains no raw app-server or IPC glue. `App.vue` binds the typed
preload API with `useCodexSurface`, owns the two-pane layout, and passes the
resulting state and actions into the SDK pane. Permission choices are validated
by the main-process surface against the profiles reported by app-server.
