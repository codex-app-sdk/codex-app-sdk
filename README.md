# codex-app-sdk

`codex-app-sdk` is a reusable foundation for building native Codex surfaces.
It packages reusable protocol, transport, event, IPC, and presentation seams
without importing any host application's domain model or product state.

The SDK is being built around four public layers:

- a bidirectional, strongly typed Codex app-server client;
- transport adapters, beginning with JSONL-over-stdio;
- a transport-neutral event bus and typed Electron IPC adapters;
- Vue components for composers, messages, and message lists.

## Generated app-server types

Codex app-server's schema is version-specific. The checked-in bindings are
generated from the local Codex CLI and include experimental APIs because rich
surfaces need goals, plans, approvals, and streamed item events.

```bash
npm run schema:generate
```

The generator records the source CLI version and creates method maps that pair
every generated request's parameter and response types. A small explicit table
handles protocol response-type naming exceptions where `FooParams` does not
pair with `FooResponse`; it does not override runtime responses. Applications
consume those maps through the typed client instead of assembling JSON-RPC
envelopes.

## Development

```bash
npm install
npm test
npm run test:coverage
npm run typecheck
npm run build
```

The package targets Node 22 or newer and Vue 3.5. Vue is a peer dependency so
applications keep ownership of their renderer runtime.

## Typed app-server client

The client performs request correlation, timeouts, notifications, and
server-initiated request responses while preserving generated method types:

```ts
import { CodexAppServerClient } from 'codex-app-sdk/codex';
import { CodexAppServerStdioTransport } from 'codex-app-sdk/node';

const client = new CodexAppServerClient(new CodexAppServerStdioTransport());
await client.start();
await client.initialize({
  clientInfo: { name: 'my_surface', title: 'My Surface', version: '0.1.0' },
  capabilities: { experimentalApi: true, requestAttestation: false },
});

const { thread } = await client.request('thread/start', {
  cwd: process.cwd(),
});

client.onNotification('item/agentMessage/delta', ({ params }) => {
  console.log(params.delta);
});

client.onServerRequest('item/tool/requestUserInput', (request, responder) => {
  responder.resolve({ answers: {} });
  return true;
});
```

The transport and wire envelopes are replaceable. Surface code only sees
generated methods, params, results, notifications, and request responders.

## Events and Electron IPC

`TypedEventBus` provides app-owned event contracts without coupling state to a
framework. `TypedIpcRenderer`, `TypedIpcMain`, `registerIpcMainHandlers`, and `sendIpcEvent`
apply the same contracts across Electron's security boundary using narrow
structural ports—`codex-app-sdk` never exposes Electron or Node primitives to
the renderer.

A typical desktop pipeline is:

```text
Codex notification -> product adapter -> TypedEventBus -> Electron IPC
  -> renderer event bus/store -> Vue components
```

Protocol-specific payloads should be adapted before they cross IPC. Components
consume surface-owned messages and state, not raw app-server notifications.

## Vue surfaces

The Vue entry includes `CodexComposer`, `CodexComposerMenu`,
`CodexComposerMenuList`, `CodexComposerSendButton`, `CodexMessage`, and
`CodexMessageList`:

```ts
import { CodexComposer, CodexMessageList } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';
```

`CodexComposerMenu` accepts nested action, checkbox, radio, separator, submenu,
and custom entries. Typed payloads let a host application contribute its own
actions, while scoped `trigger`, `item`, and `icon` slots can replace the
default presentation without forking menu behavior.

`CodexMessage` renders the SDK's safe `SurfaceMessage` contract. Message and
message-list slots let products replace text, tool, status, and full-message
rendering while retaining tested layout and auto-scroll behavior. Components
use `--codex-*` semantic CSS variables with neutral fallbacks and do not depend
on Element Plus, Electron, application stores, or raw app-server types.

Every public Vue component has one same-named isolated spec. A package-boundary
test compares the component and test manifests so catch-all component suites
cannot replace that one-to-one structure.
