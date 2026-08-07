# Component lab

A browser-only, fully mocked visual lab for the Codex App SDK conversation components. It covers rich mentions, multiline composer behavior, deterministic streaming, steering, tool states, attachments, busy/queued state, context and diff shelves, empty state, errors, and themes without starting app-server or Electron.

```bash
npm run dev:lab
```

The lab uses SDK source aliases in development, so component changes appear directly without rebuilding `dist`.
