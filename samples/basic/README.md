# Basic Codex surface

This runnable Electron + Vue sample demonstrates the intended SDK boundary:

- the custom left pane renders the app-server conversation list exposed by
  `useCodexSurface`;
- the right pane uses and customizes the SDK's `CodexConversationPane`;
- the SDK transport, state, and eventing handle history, streaming, models,
  reasoning, permissions, goals, skills, plan mode, approvals, app-server user
  input, message rollback actions, queued prompts, steering, interruption, and sending;
- the SDK-native Electron bridge supplies file picking and ingestion, attachment
  previews, image paste/drop, copy, audio capture, and Apple voice transcription;
- multiple conversations remain live concurrently and the custom sidebar can
  switch between them independently of another conversation's active turn.

Those native capabilities require no callbacks or event plumbing in `App.vue`.
The app only creates one reactive controller, renders its own conversation list,
and mounts `<CodexConversationPane :surface="surface">`.

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
preload API with `useCodexSurface`, owns the two-pane layout, and gives that one
controller to the SDK pane. Permission choices are validated by the main-process
surface against the profiles reported by app-server.
