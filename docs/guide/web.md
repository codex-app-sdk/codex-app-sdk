# Web integration

`@codex-app-sdk/web` carries the renderer-safe Codex surface over an established
WebSocket. It does not create an HTTP server, depend on Express or `ws`, parse
website cookies, store users or tokens, or decide how app-server processes are
pooled.

The [Basic web sample](https://github.com/nbonamy/codex-app-sdk/tree/main/samples/web/basic)
is the smallest runnable integration. Its renderer is the same exported
sidebar/pane shell as the Basic desktop sample plus the web client; its server
is almost entirely Express/`ws`, site-authentication, and session-acquisition
code.

## What you add to an existing website

The SDK-specific integration is deliberately small:

1. create or acquire a `CodexAppBackend` for the authenticated site user;
2. authorize the HTTP upgrade using the website's existing session system;
3. adapt the accepted socket and grant a connection-scoped surface lease;
4. create `CodexWebSurfaceClient` in the browser and pass it to
   `useCodexSurface()`;
5. mount the Vue pane wherever it belongs in the larger page.

Everything else—Express/Fastify/Hono routes, page layout, login, organizations,
token encryption, persistence, upload APIs, and deployment—is ordinary host
application code.

## Server boundary

Authenticate the HTTP upgrade in the host, adapt the accepted socket, and
return an authorized surface lease:

```ts
import { WebSocketServer } from 'ws';
import {
  bindCodexWebSocket,
  createCodexNodeWebSocketPort,
} from '@codex-app-sdk/web/server';

const sockets = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, networkSocket, head) => {
  const siteUser = authenticateSiteRequest(request);
  if (!siteUser) {
    networkSocket.destroy();
    return;
  }

  sockets.handleUpgrade(request, networkSocket, head, (socket) => {
    bindCodexWebSocket({
      socket: createCodexNodeWebSocketPort(socket),
      context: { request, siteUser },
      authorize: ({ siteUser }) => sessionPool.acquire(siteUser.id),
    });
  });
});
```

`authorize()` is required and may be asynchronous. It returns `null` to deny
the connection or a connection-scoped lease containing:

- `surface`: the authorized user's `CodexSurface`-compatible target;
- optional `resolveAttachment`: maps an opaque renderer attachment reference to
  a trusted host path;
- optional `release`: releases host session/accounting resources when the
  socket closes.

The SDK validates protocol envelopes and surface arguments, serializes actions,
correlates responses, pushes snapshots and events, and applies message-size
limits. The host still validates upgrade paths, cookies, CSRF/origin policy,
user status, quotas, and concurrency before granting the lease.

Both endpoints default to a 64 MiB message ceiling. This is a transport safety
bound, not the history-rendering policy: a large ready snapshot must first fit
through the socket, after which the Vue pane's default lazy render strategy
mounts only the newest message batch. Configure `maxMessageBytes` consistently
on client and server if the host chooses another ceiling, and account for lower
limits imposed by reverse proxies or hosting platforms.

## Multi-user ownership

A production website typically maps one authenticated site user to one stable
Codex identity and an isolated `codexHome`. That mapping is intentionally not
an SDK database abstraction.

The host owns:

- website authentication, sessions, organizations, and authorization;
- encrypted token storage and restoration;
- stable per-user `codexHome` directories;
- app-server process or runner pools and idle eviction;
- quotas, persistence, observability, and deployment routing;
- attachment upload endpoints and reference lifetime.

The SDK owns the app-server runtime inside each acquired backend, the
renderer-safe surface, and the WebSocket projection. `CodexAppBackendTtlCache`
can help an in-process host retain and evict backends, but it does not become a
user store or distributed scheduler.

Stock ChatGPT login can still use the surface. The browser calls
`startChatGptLogin()`, the host opens the returned URL, and app-server persists
successful credentials into the isolated `codexHome` selected by the host.

## Browser boundary

Create a renderer API and pass it to the same Vue controller used by Electron:

```ts
import {
  createCodexBrowserWebSocketPort,
  createCodexWebSurfaceClient,
} from '@codex-app-sdk/web/client';
import { useCodexSurface } from '@codex-app-sdk/vue';

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const api = createCodexWebSurfaceClient({
  createSocket: () => createCodexBrowserWebSocketPort(
    new WebSocket(`${protocol}//${location.host}/codex`),
  ),
  reconnect: true,
});
const surface = useCodexSurface(api);
```

Reconnect creates a fresh socket and requires a fresh authorized lease. Pending
actions reject when transport is lost and are never replayed automatically;
the next authoritative `ready` snapshot resynchronizes the renderer.

Browser-native clipboard, external-link, upload, or transcription behavior is
a separate host-capability concern. The communication package does not create
upload routes. A host that enables attachments uploads bytes through its own
authenticated endpoint and gives the renderer only an opaque `reference`; the
lease resolves that reference when a message is submitted.

See the [web transport API](/api/web), [security boundary](/guide/security), and
[Vue conversation kit](/guide/vue).
