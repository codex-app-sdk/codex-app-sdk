# `@codex-app-sdk/web`

Framework-neutral WebSocket transport for browser Codex surfaces.

- `@codex-app-sdk/web/client` creates a browser-side `CodexSurfaceRendererApi`.
- `@codex-app-sdk/web/server` binds an established socket to a host-authorized
  surface lease.

The package does not create an HTTP server, parse site authentication, manage
users, or depend on Express or a WebSocket implementation.
