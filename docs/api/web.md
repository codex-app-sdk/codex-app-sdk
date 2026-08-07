# Web transport API

The `@codex-app-sdk/web` package has browser-safe client and framework-neutral
server entry points. It depends only on `@codex-app-sdk/core`.

## Client

### `createCodexWebSurfaceClient(options)`

Returns `CodexWebSurfaceClient`, which implements `CodexSurfaceRendererApi` and
adds `disconnect()` plus `getConnectionState()`.

```ts
type CreateCodexWebSurfaceClientOptions = {
  createSocket(): CodexWebSocketPort | Promise<CodexWebSocketPort>;
  maxMessageBytes?: number;
  requestTimeoutMs?: number;
  reconnect?: boolean | {
    maxAttempts?: number;
    initialDelayMs?: number;
    maximumDelayMs?: number;
  };
};
```

Connection states are `closed`, `connecting`, `disconnected`, and `ready`.
`connect()` resolves the authoritative ready snapshot. Unexpected eligible
closures use bounded exponential reconnect when enabled. In-flight operations
reject and are not replayed.

### `createCodexBrowserWebSocketPort(socket)`

Adapts a browser `WebSocket` to `CodexWebSocketPort` without exposing the native
socket to the Vue surface.

### Errors

- `CodexWebSocketRemoteError` contains the remote `code` and message.
- `CodexWebSocketTransportError` reports socket creation, closure, framing, and
  invalid-response failures.

## Server

### `bindCodexWebSocket(options)`

Binds an already accepted socket and returns `{ ready, close }`.

```ts
type BindCodexWebSocketOptions<Context> = {
  socket: CodexWebSocketPort;
  context: Context;
  authorize(context: Context):
    | CodexWebSocketSessionLease
    | null
    | Promise<CodexWebSocketSessionLease | null>;
  maxMessageBytes?: number;
};

type CodexWebSocketSessionLease = {
  surface: CodexSurfaceBridgeTarget;
  resolveAttachment?: CodexSurfaceBridgeAttachmentResolver;
  release?(context: CodexWebSocketSessionRelease): void | Promise<void>;
};
```

Authorization denial closes with application code `4401`. Invalid framing,
unsupported properties, requests before readiness, and invalid operations close
with `4400`. Initialization or response failures close with `1011`.

`release()` receives `authorization_failed`, `server_closed`, `socket_closed`,
or `surface_failed`, plus relevant close/error context.

### `createCodexNodeWebSocketPort(socket)`

Adapts the small EventEmitter-style subset implemented by `ws`. The package
does not import or declare a dependency on `ws`; compatible server libraries
can either use this adapter or implement `CodexWebSocketPort` directly.

## Shared protocol

`@codex-app-sdk/web/protocol` exports the versioned request, response, ready,
snapshot, and event envelope types. Applications normally do not import this
entry point; the client and server own framing and validation.

See the [web integration guide](/guide/web) for host authentication, multi-user
ownership, and attachment boundaries.
