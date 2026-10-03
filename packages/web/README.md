# `@codex-app-sdk/web`

Framework-neutral WebSocket transport for browser Codex surfaces.

```bash
npm install @codex-app-sdk/core @codex-app-sdk/web
```

- `@codex-app-sdk/web/client` creates a reconnecting browser-side
  `CodexSurfaceRendererApi`.
- `@codex-app-sdk/web/server` binds an already accepted socket to a
  host-authorized surface lease.
- `@codex-app-sdk/web/protocol` exports versioned envelopes for custom
  transport integrations.

Both endpoints default to a 64 MiB message ceiling. The server adapter can wrap
the EventEmitter-style subset implemented by `ws`, or the host can implement
`CodexWebSocketPort` for another library.

The package does not create an HTTP server, parse cookies, authenticate users,
store tokens, manage `codexHome` directories, pool app-server processes, create
upload routes, or depend on Express or a WebSocket implementation. Those are
host-application responsibilities.

See the [web integration
guide](https://codex-app-sdk.github.io/codex-app-sdk/guide/web.html), [web
API](https://codex-app-sdk.github.io/codex-app-sdk/api/web.html), and [Basic Express
sample](https://github.com/codex-app-sdk/codex-app-sdk/tree/main/samples/web/basic).
