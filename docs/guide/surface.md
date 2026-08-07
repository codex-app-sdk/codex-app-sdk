# The surface runtime

`CodexSurface` is the high-level Node runtime. Create it in the trusted host:
Electron main for a desktop app, or a server-side session/process owner for a
website. Let it own app-server for the lifetime of the application surface or
pooled user session.

Both scaffolds create it through `CodexAppBackend`, so configure the same
options under `surfaceOptions` there. Create a surface directly when integrating
without a scaffold or backend modules.

```ts
import path from 'node:path';
import { createCodexSurface } from '@codex-app-sdk/backend';

const surface = createCodexSurface({
  clientInfo: {
    name: 'my_app',
    title: 'My App',
    version: '0.1.0',
  },
  codexHome: path.join(hostDataDirectory, 'codex-home'),
  approvalMode: 'ask',
  permissionMode: 'read-only',
  conversationLimit: 50,
});
```

## Important options

| Option | Meaning |
| --- | --- |
| `clientInfo` | Identity sent during app-server initialization |
| `codexHome` | `CODEX_HOME` for the spawned child only; never mutates the parent process |
| `cwd` | Default workspace for new/resumed conversations; omitted by default |
| `conversationDefaults` | Host-owned default model and reasoning effort for explicit and implicit creation |
| `approvalMode` | Raw host policy: `ask` or `never` |
| `permissionMode` | Raw host policy: `read-only`, `workspace-write`, or `full-access` |
| `approvalPreset` | Initial preset when advertised by app-server |
| `conversationLimit` | Number of summaries loaded during bootstrap |
| `loadingStrategy` | `lazy` demand-paging or `eager` progressive full-history hydration |
| `autoSelectFirstConversation` | Whether bootstrap selects the first catalog item |
| `extensions` | Host configuration hooks and dynamic tools |
| `mcpServers` | Trusted default MCP definitions |
| `onUnknownNotification` | Observation seam for newer app-server notifications |
| `transport` | Explicit Codex command, arguments, environment, and timeouts |

History loading is independent from Vue's DOM rendering strategy. See
[History and performance](/guide/history) before changing either default.

## No implicit working directory

The SDK does not send a working directory unless the host configures one. It
also does not use `cwd` as an implicit conversation-list filter.

```ts
const surface = createCodexSurface(); // no cwd is sent
```

Query a workspace explicitly when the product needs it:

```ts
const workspaceThreads = await surface.listConversations({
  cwd: '/absolute/workspace/path',
});
```

## Host-owned conversation defaults

Fixed product experiences can own the default model, reasoning effort, and
service tier:

```ts
const surface = createCodexSurface({
  conversationDefaults: {
    model: 'a-model-id-known-to-this-host',
    reasoningEffort: 'medium',
    serviceTier: 'priority',
  },
});
```

Defaults apply when explicit values are omitted from `createConversation()` and
when the SDK creates a conversation automatically for a first message, goal, or
review. Model IDs and efforts must be available in the connected account's
app-server catalog.

## Connect and close

```ts
const snapshot = await surface.connect();

console.log(snapshot.status); // ready
console.log(snapshot.authentication);

await surface.close();
```

A signed-out app-server connection can still be `ready`; authentication is
separate state. Fatal transport errors move the surface to `error`. Calling
`connect()` again starts and initializes a fresh app-server process.

## Snapshots and events

```ts
const unsubscribeState = surface.onStateChange((snapshot) => {
  renderGlobalState(snapshot);
});

const unsubscribeEvents = surface.onEvent((event) => {
  if (event.type === 'tool.completed') refreshBusinessState();
});

unsubscribeState();
unsubscribeEvents();
```

Snapshots are authoritative. Events are ordered and emitted after the matching
state mutation.

See the complete [Node runtime API](/api/node).

For transport ownership, continue with [Electron integration](/guide/electron)
or [Web integration](/guide/web).
