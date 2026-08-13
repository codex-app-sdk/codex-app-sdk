# Basic web sample

A web version of the Basic desktop sample. Both use the shared
`CodexConversationSidebar`, stock conversation pane, and surface controller.
Express owns the HTTP server and site-authentication seam; `ws` owns the
upgrade; the SDK owns the Codex WebSocket protocol and Vue surface integration.

```bash
npm run dev:web
```

Open `http://127.0.0.1:3000`. The sample uses the default Codex home, so it
reuses the authentication from a normal local Codex installation.

The dev command consumes SDK source directly, hot-reloads Vue changes, and
restarts the sample server when backend or web-transport sources change. Use
`npm run start:web` for a production-style build followed by server startup.

`authenticateSiteRequest()` is intentionally a fixed local demo user. In a
multi-user host, replace it with the website's session authentication and make
`authorize()` acquire that user's surface from the host's backend/process pool.
The host remains responsible for stable per-user `codexHome` directories,
encrypted token storage, quotas, persistence, and backend shutdown policy.

The renderer contains only the shared SDK sidebar/pane and the SDK web client.
It does not implement request IDs, protocol parsing, surface-operation routing,
or reconnect behavior.

Client and server use the SDK's 64 MiB default WebSocket message ceiling. The
pane also uses lazy DOM rendering by default, so opening a long thread delivers
one authoritative snapshot but initially mounts only its newest message batch.
