# Application backend

`CodexAppBackend` is an optional in-process composition root for applications
that combine the reusable Codex runtime with product services such as agents,
teams, or work integrations. It gives those services one shared
`CodexSurface` without making the SDK own product state or transport.

The backend belongs in the trusted host, normally Electron main or a Node
process. The renderer should continue to consume the surface through the
Electron bridge rather than importing this module directly.

`CodexAppBackend` is not the Vue pane controller. The backend composes trusted
services around a shared `CodexSurface`; the pane controller normalizes
renderer-owned state and actions. See
[Conversation pane integration](/guide/conversation-pane#backend-versus-pane-controller).

## Compose one surface

```ts
import { createCodexAppBackend } from 'codex-app-sdk/node';

type AgentService = {
  list(): Promise<readonly { id: string; name: string }[]>;
};

const backend = createCodexAppBackend({
  surfaceOptions: {
    clientInfo: { name: 'my_app', version: '0.1.0' },
    permissionMode: 'read-only',
  },
  modules: [{
    id: 'agents',
    create({ surface }) {
      return {
        list: async () => {
          // Product-owned state can use the shared Codex surface.
          return loadAgentsForSurface(surface);
        },
      } satisfies AgentService;
    },
  }],
});

await backend.surface.connect();
const agents = backend.module<AgentService>('agents');
const availableAgents = await agents.list();
```

Every module receives the same surface instance. The SDK continues to own
Codex connection lifecycle, catalogs, conversations, queues, approvals, and
semantic events; the module owns its application-specific service and state.

## Reuse an existing surface

Pass `surface` when the host already created and configured one. `surface` and
`surfaceOptions` are mutually exclusive:

```ts
const backend = createCodexAppBackend({
  surface,
  modules: [createAgentsModule(), createTeamsModule()],
});
```

This is useful when the host needs to configure the surface before composing
application services, or when multiple host components must share one runtime.
The backend does not start a second app-server for an adopted surface.

## Module IDs and lookup

Module IDs are trimmed, must be non-empty, and must be unique. `module(id)`
returns the service created for that ID and throws for an unknown ID. The
generic type on `module<Service>()` provides compile-time typing; the string ID
remains the runtime namespace boundary.

```ts
const agents = backend.module<AgentService>('agents');
// Throws: backend.module('missing')
```

## Lifecycle

Call `backend.close()` once when the host is shutting down. Closing is
idempotent, so a module may call the `closeBackend()` function from its module
context when it owns a shutdown path:

```ts
const backend = createCodexAppBackend({
  modules: [{
    id: 'workspace',
    create({ closeBackend }) {
      return { closeBackend };
    },
  }],
});

await backend.close();
```

`closeBackend()` closes the shared surface. Modules are not disposed
automatically; if a module owns timers, subscriptions, or external clients,
its host service should release those resources as part of the host shutdown
sequence.

## Optional TTL caches

For applications that keep rehydratable per-conversation or per-agent data in
memory, the backend can create a generic TTL cache. The cache tracks identity
and activity metadata; the host decides whether an entry is safe to remove and
performs the actual eviction.

```ts
const cache = backend.createTtlCache({
  ttlMs: 15 * 60_000,
  sweepIntervalMs: 60_000,
  identity: (entry: { agentId: string }) => entry.agentId,
  canEvict: (entry) => isInactiveAndIdle(entry.agentId),
  onEvict: (entry) => removeRehydratableTranscript(entry.agentId),
});

cache.set({ agentId: 'agent-a' }, lastSelectionAt);
cache.touch('agent-a', lastBackendEventAt);
```

`set()` and `touch()` retain the greatest activity timestamp seen for an
identity. Hosts should touch on both selection and generation/backend events,
so a busy or recently selected entry cannot be evicted because an older event
arrived later. An entry becomes eligible only after `ttlMs` has elapsed and
`canEvict` returns true. `onEvict` may be synchronous or asynchronous; the
entry is removed from the cache only after it succeeds.

Omit `sweepIntervalMs` for manual eviction with `await cache.sweep()`. For
deterministic tests, inject `now` and a `scheduler`. Scheduled timers call
`unref()` when available and are stopped by `cache.close()` or
`backend.close()`.

The cache does not own drafts, attachments, queues, approvals, browser state,
or any other application data. The host's eviction callback must remove only
the data it can rehydrate safely.

For conversation runtimes specifically, pair host eviction with
`surface.forgetConversation(id)`. That releases rehydratable SDK memory without
archiving or deleting the app-server thread. See
[History and performance](/guide/history#releasing-inactive-conversations).

## Electron boundary

Create the backend in Electron main, register the bridge against
`backend.surface`, and expose only the renderer-safe API:

```ts
const backend = createCodexAppBackend({ surfaceOptions: { cwd: workspace } });
const bridge = registerCodexElectronMain({ surface: backend.surface });
```

Product services can coordinate with the surface in main without exposing
generated app-server payloads, Node objects, MCP definitions, or business
state through IPC. See the [Electron integration guide](/guide/electron) and
the [Node API reference](/api/node) for the exact contracts.
