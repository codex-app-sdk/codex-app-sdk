# Architecture

The SDK is a surface architecture, not a thin JSON-RPC wrapper. Each layer has a
specific trust boundary and public vocabulary.

For a file-by-file view of these layers in runnable Electron and web projects,
begin with the [generated target tour](/guide/quick-start). This page explains
the deeper runtime boundaries behind both scaffolds.

![Codex App SDK architecture](/architecture.svg)

## Modular packages

| Package | Owns | Must not own |
| --- | --- | --- |
| `@codex-app-sdk/core` | Renderer-safe surface, bridge, event, attachment, and host-capability contracts | Node, Electron, Vue, or generated app-server code |
| `@codex-app-sdk/backend` | Trusted Node app-server runtime, process transports, `CodexSurface`, backend composition | Website users, product data, or UI |
| `@codex-app-sdk/vue` | Reusable conversation controller, components, and scoped theme | Backend processes or host transports |
| `@codex-app-sdk/electron` | Main/preload/renderer IPC and native desktop capabilities | Product orchestration |
| `@codex-app-sdk/web` | Established-WebSocket surface projection and browser client | HTTP frameworks, website authentication, user storage, or runner pools |

The root `codex-app-sdk` package is a compatibility facade while applications
migrate to explicit packages. Core is the shared vocabulary; Electron and web
are sibling adapters over the same surface bridge, so operation validation is
not duplicated between frontends.

## Node runtime

`CodexSurface` owns the app-server client and turns a volatile protocol into a
product-shaped state machine:

- executable discovery and child-process lifecycle;
- initialization and reconnect behavior;
- authentication-dependent bootstrap;
- global conversation/model/plugin catalogs;
- one runtime per loaded conversation;
- history and live-notification projection;
- approvals and app-server client requests;
- semantic events emitted after state mutation;
- host extensions, dynamic tools, and MCP configuration.

Snapshots are the authoritative state and resynchronization mechanism. Events
are ordered incremental integration signals.

`CodexAppBackend` is the in-process composition root for applications that need
product services around that runtime. It creates or adopts one `CodexSurface`
and gives named application modules the shared surface plus one idempotent
backend-close operation. Modules own app concepts such as teams or agents; the
SDK continues to own product-neutral Codex connection, catalog, conversation,
queue, and event behavior. The embedding application still chooses the process
and transport boundary, so this composition does not require another daemon.
See [Add a backend service](/guide/backend) for the module contract and
shutdown lifecycle.

## Electron bridge

The bridge projects `CodexSurfaceApi` into validated IPC handlers. The renderer
can create conversations with a model, reasoning effort, or an advertised
approval preset, but it cannot submit raw `cwd`, `approvalMode`,
`permissionMode`, config, commands, environments, MCP definitions, extension
context, or protocol envelopes.

Native file, clipboard, link, and transcription operations use explicit typed
handlers instead of exposing Node or Electron objects.

## Web bridge

The web server binds an established WebSocket only after a host authorization
callback grants a connection-scoped surface lease. The browser receives the
same renderer-safe API used by the Vue controller in Electron. The SDK owns
framing, correlation, validation, ordering, snapshots, events, and bounded
reconnect; the embedding website owns HTTP, site authentication, tenancy,
stable per-user `codexHome` selection, process pooling, quotas, persistence,
and upload endpoints. See [Web integration](/guide/web).

## Vue kit

`useCodexSurface` keeps a reactive snapshot synchronized with the renderer API.
`CodexConversationPane` consumes the controller and composes the standard
conversation experience.

Hosts with their own renderer state can use the grouped pane controller instead
of forwarding dozens of props/events. That controller is a view adapter and is
separate from the trusted `CodexAppBackend` composition root. See
[Conversation pane integration](/guide/conversation-pane).

Applications can progressively customize:

1. semantic theme tokens;
2. capability and presentation props;
3. scoped slots;
4. exported leaf components;
5. a fully custom renderer over the same surface contracts.

## State ordering

For a meaningful app-server update, the surface:

1. validates and adapts the protocol payload;
2. mutates the relevant conversation/global state;
3. notifies snapshot listeners;
4. emits the matching semantic event with a monotonic sequence number.

An event handler can therefore read the updated snapshot immediately.

## Conversation identity

The global catalog is intentionally not filtered by an implicit working
directory. A configured `cwd` scopes new/resumed runtime behavior, while
`listConversations({ cwd })` is an explicit query.

Several loaded conversations can stream simultaneously. Selection is a UI
concern, not a runtime ownership constraint.

Hosts that bridge one `CodexSurface` to several independently active agents
should use the conversation-targeted helpers from
`@codex-app-sdk/core/surface-bridge`. Each invocation and subscription is keyed
by `conversationId` and delegates to `surface.conversation(conversationId)`, so
messages, turn actions, approvals, and stream updates never depend on the
surface's UI selection. The original global bridge remains available for
single-pane Electron and web clients whose operations intentionally follow the
active conversation.

Conversation state notifications are scoped to the conversation that changed.
Global catalog and authentication updates still notify every subscribed
conversation. Consumers should keep message identities stable and prefer
semantic events for incremental integrations instead of repeatedly projecting
or serializing complete transcripts.

History loading and Vue mounting are separate policies. The surface can keep
full-detail history available while the renderer mounts only its newest bounded
window. See [History and performance](/guide/history).

## Advanced protocol access

When app-server adds a method that the surface does not yet project, use the
[low-level client](/api/codex) in the trusted host. Convert the response into a
serializable product contract before crossing IPC.

If ordinary renderer code needs `thread/*`, `turn/*`, or generated app-server
types, extend the surface boundary instead.
