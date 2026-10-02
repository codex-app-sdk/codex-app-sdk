# Component lab

A visual lab for the Codex App SDK conversation
components. It covers rich mentions, multiline composer behavior, prompt
recall, deterministic streaming, steering, editable queues, tool states,
reasoning-aware live activity titles, attachments, context and diff shelves,
empty state, errors, and themes without starting app-server or Electron.
These fixtures remain fully mocked.

```bash
npm run dev:lab
```

The lab uses SDK source aliases in development, so component changes appear
directly without rebuilding `dist`.

Compile it without starting Vite with `npm run build:lab`.

## Live chat

Select **Live chat**, then **Create lab conversation** and **Start live chat**.
This opt-in scenario starts a local app-server using your existing Codex CLI
login (`codex login`), creates a read-only conversation, and asks for microphone
permission. It requires an installed CLI/account with experimental realtime V3
access. No separate API key is required for ChatGPT-authenticated WebRTC.

Talk naturally, mute/unmute, or stop. The upper panel shows the live transcript;
the normal conversation pane below shows Codex work and approval requests.
Resetting or leaving the scenario releases capture and closes the connection.
The created conversation remains in your Codex history.

The local signaling endpoint is dev-only, loopback and same-origin. It is not a
production authentication example and is not included in a static lab build.
Errors are displayed in the lab, including microphone, signaling, and realtime
availability failures. Other scenarios do not start app-server.
