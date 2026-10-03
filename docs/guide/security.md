# Security boundary

The Electron main process or web server is the trusted policy boundary. The
renderer receives a narrow, serializable, shape-validated surface.

## What stays in main

- `CODEX_HOME`
- raw `cwd` policy
- `approvalMode` and `permissionMode`
- arbitrary app-server config and instructions
- executable command, arguments, environment, and timeouts
- MCP commands, URLs, paths, environments, and enabled tools
- extension context and dynamic tool implementations
- generated protocol types and JSON-RPC envelopes
- product secrets and business-service credentials

## What the renderer receives

- serializable authentication and catalog state
- conversation summaries and active conversation state
- `SurfaceMessage` projections
- approvals and app-server client requests
- goals, plans, queue, diff, context usage, and rate limits
- high-level actions such as create/select/send/interrupt
- catalog-validated model, reasoning, and approval-preset selection
- semantic events
- explicit native capability methods
- opaque attachment references rather than trusted filesystem paths

## Renderer conversation creation

The Node API can create a conversation with trusted `cwd`, raw permissions,
instructions, and config. The renderer creation API is intentionally narrower:

```ts
type CreateCodexRendererConversationOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  model?: string;
  reasoningEffort?: string;
};
```

Approval presets are validated against app-server's advertised catalog. Unknown
keys and malformed payloads are rejected at IPC.

::: danger Presentation is not policy
Vue capabilities and presentation controls decide what the stock UI renders.
They are not an authorization mechanism. A custom renderer can still call any
action exposed by the renderer API.
:::

## Native input validation

The native bridge validates:

- attachment counts, per-file size, total size, file metadata, and preview
  limits, including bounded image-only historical preview reads;
- ingested file names and binary payloads;
- clipboard text/HTML bounds;
- audio payload bounds and transcription options;
- external-link protocols.

It creates private operating-system temporary attachment directories. They
survive bridge teardown so app-server `localImage` history remains valid across
an application restart, and are eventually reclaimed by the operating system.

The renderer cannot submit a filesystem path. Electron resolves only references
issued by its integration-scoped registry. A web host must apply the same rule:
authenticate upload endpoints, scope references to the authorized user/session,
and resolve them inside the granted surface lease.

## Web session policy

`bindCodexWebSocket()` never authenticates a website user. It requires the host
to authorize every accepted connection and returns `4401` when authorization is
denied. Before binding, validate the upgrade path, website session, expected
origin/CSRF policy, account state, and connection quota. Never accept a browser
supplied user ID as authority for selecting a surface.

Browsers do not apply the same-origin policy to WebSockets: any page the user
visits can open a socket to a local or intranet Codex server and drive it. Reject
upgrades from unexpected origins before calling `handleUpgrade`:

```ts
import { isAllowedCodexWebSocketOrigin } from '@codex-app-sdk/web/server';

if (!isAllowedCodexWebSocketOrigin(request, ['https://app.example.com'])) {
  socket.destroy();
  return;
}
```

Requests without an `Origin` header are rejected. The scaffolded web target and
the web sample apply this check, configurable through `ALLOWED_ORIGINS`.

Use stable isolated `codexHome` directories when credentials should persist per
user. The website owns encrypted storage, process pooling, eviction, deployment
routing, and tenancy; the SDK lease only connects one authorized socket to one
surface. See [Web integration](/guide/web).

The web transport defaults to a 64 MiB message ceiling on both endpoints.
Treat that as a resource bound, not a guarantee that every proxy or deployment
accepts the same size. Set a lower host-specific limit when appropriate, keep
client/server values aligned, apply connection and request quotas, and monitor
large initial snapshots. Vue's lazy DOM rendering reduces browser mount cost
after delivery but does not reduce the WebSocket payload itself.

## Electron window policy

Use the bridge with:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}
```

Electron re-runs the preload script on every navigation, so any page the window
reaches receives the full Codex bridge. Keep the window on your renderer and
accept IPC only from it:

```ts
import { installCodexWindowPolicy, isCodexRendererSender, registerCodexElectronMain } from '@codex-app-sdk/electron';

const rendererUrl = devServerUrl || pathToFileURL(rendererFile).href;
installCodexWindowPolicy(window.webContents, {
  rendererUrl,
  openExternal: (url) => shell.openExternal(url),
});
registerCodexElectronMain({
  // ...
  isTrustedSender: (event) => isCodexRendererSender(event, rendererUrl),
});
```

`installCodexWindowPolicy` denies new windows and foreign navigations and hands
only `http(s)`, `mailto`, and `tel` URLs to `openExternal`. Same-origin dev
server reloads and the packaged `file:` renderer stay allowed. Add a hostname
allowlist inside `openExternal` if your product needs a stricter link policy.

## Product responsibility

The SDK does not decide which workspaces, tools, MCP servers, permission modes,
accounts, or external hosts are appropriate for your product. Configure those
in trusted host code and test the resulting boundary.

Remote-control pairing is also a trusted-host feature. Keep pairing codes out of
logs, convert `bigint` timestamps before custom IPC, and expose only the product
state the renderer needs. See [Remote control and device pairing](/guide/remote-control).
