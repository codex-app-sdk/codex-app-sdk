# codex-app-sdk

`codex-app-sdk` is a reusable foundation for building native Codex surfaces.
The default API owns Codex discovery, app-server lifecycle, initialization,
conversation history, live updates, Electron IPC, and Vue presentation. An app
chooses its product shell and policy without learning JSON-RPC method names or
generated protocol types.

The SDK has five public layers:

- a high-level conversation surface for normal application code;
- a bidirectional, strongly typed Codex app-server client;
- automatic executable discovery and JSONL-over-stdio transport;
- secure high-level and generic Electron IPC adapters;
- Vue state bindings and extensible conversation components.

## Build a surface

Electron main creates one high-level surface. The SDK finds the Codex CLI in
normal GUI-app locations (including login-shell, Homebrew, user-bin, nvm, and
Windows `PATHEXT` paths), launches app-server, and owns its lifecycle:

```ts
import { clipboard, dialog, ipcMain, shell } from 'electron';
import { registerCodexElectronMain } from 'codex-app-sdk/electron';
import { createCodexSurface } from 'codex-app-sdk/node';

const surface = createCodexSurface();
const disposeSdk = registerCodexElectronMain({
  clipboard, dialog, ipcMain, shell, surface,
  sender: window.webContents,
});
```

Preload exposes the narrow SDK bridge; no Node or Electron primitive crosses
into the renderer:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeCodexElectronPreload } from 'codex-app-sdk/electron/preload';

exposeCodexElectronPreload(contextBridge, ipcRenderer);
```

The main-process surface loads app-server's model and skill catalogs, permission
profiles, goals, and persisted threads. Renderer settings updates are validated against that
catalog before the surface sends typed `thread/settings/update` requests. The
main IPC adapter strips unknown runtime fields before calling the surface.

Vue binds the bridge to reactive state and uses the SDK conversation pane:

```vue
<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';

const surface = useCodexSurface(window.codexSurface);
</script>

<template>
  <MyConversationList
    :conversations="surface.state.conversations"
    @create="surface.createConversation()"
    @select="surface.selectConversation($event)"
  />
  <CodexConversationPane :surface="surface" />
</template>
```

That bound-pane form auto-connects and owns the standard settings, approval,
goal, message-action, attachment, copy, and voice-transcription wiring. All
props and events remain available as additive overrides for provider-neutral or
fully controlled hosts.

`CodexSurface` exposes stable product operations: connect, list/refresh, create,
select/read/rename, send/queue/steer, interrupt, compact, start a review, update
settings, set/clear goals, approve/deny/respond, delete/edit/retry, subscribe,
and close. Its snapshots include per-thread live state, thread status, context
usage, rate limits, goals, approvals, pending app-server questions, queued
prompts, and turn git diffs. `connect()` paginates the global, non-archived app-server thread list
without applying a cwd filter, then resumes the newest thread so the first
snapshot already contains the real conversation history. By default the SDK does
not override app-server's working directory; a host may pass `cwd` explicitly for
a deliberately project-scoped new conversation. It never restricts conversation
discovery. `conversationLimit` can explicitly cap the total loaded list. Command,
file-change, and permission requests appear as serializable `state.approvals`
and are answered through `resolveApproval`; apps never handle server-request
responders. Approval objects include the exact requested filesystem/network
access and the scopes the server permits. The runtime translates persisted
history and live user, assistant, command, file-change, MCP, plan, search,
image, compaction, raw response, and agent items into the SDK's serializable
surface model. Reasoning remains internal while the empty streaming assistant
placeholder drives the standard Thinking shimmer.

### Concurrent conversations and host extensions

`CodexSurface` keeps every loaded conversation live. `conversation(id)` returns
a stable, thread-scoped handle, so several agents can send, stream, wait for
approval, steer, and finish concurrently without changing the conversation
selected by the UI:

```ts
const build = surface.conversation(buildThreadId);
const tests = surface.conversation(testThreadId);

await Promise.all([
  build.load({ cwd: '/workspace/build', extensionContext: { agentId: 'build' } }),
  tests.load({ cwd: '/workspace/tests', extensionContext: { agentId: 'tests' } }),
]);

build.onStateChange((state) => renderBuildStatus(state));
tests.onStateChange((state) => renderTestStatus(state));
await Promise.all([build.sendMessage('Implement it'), tests.sendMessage('Test it')]);
```

Conversation snapshots expose `activeTurnId` and `turnIds`; handles also expose
direct rollback, goals, settings, approvals, client responses, reviews, queues,
and message editing. The original active-conversation methods remain available
for a single `CodexConversationPane`. `listConversations({ cwd })` and the
Node-only `listSkills({ cwd })` perform scoped discovery without leaking raw
`thread/list` or `skills/list` protocol types.

Use the typed semantic event stream for incremental host integration. Events are
emitted after their matching state mutation, carry a monotonic sequence number,
and identify whether they came from a host action, app-server notification, or
surface lifecycle. The global surface receives catalog, runtime, rate-limit,
conversation, message, turn, tool, plan, approval, and client-request events;
thread handles receive only events for their conversation:

```ts
surface.onEvent((event) => persistOrRoute(event));
build.onEvent((event) => routeBuildAgentEvent(event));
```

The same stream crosses the Electron bridge through `window.codexSurface.onEvent`
and is exposed by `useCodexSurface` as `onEvent` and `lastEvent`. Snapshots remain
the authoritative initial state and resynchronization mechanism; consumers do
not need to reconstruct state by replaying events. `listModels()` performs a
fresh, paginated visible-model read by default; pass `{ forceReload: false }`
only when a cached catalog is explicitly desired.

Main-process hosts can install product-neutral extensions. The SDK applies
thread start/resume configuration and executes dynamic tool calls; application
code never handles a JSON-RPC request or responder:

```ts
const surface = createCodexSurface({
  extensions: [{
    configureConversation: ({ operation, extensionContext }) => ({
      config: { product_agent: (extensionContext as { agentId: string }).agentId },
      developerInstructions: `Product agent (${operation})`,
    }),
    dynamicTools: [{
      name: 'lookup_ticket',
      description: 'Look up a ticket by id',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: async ({ arguments: input, extensionContext }) => {
        const ticket = await lookupTicket(
          (input as { id: string }).id,
          (extensionContext as { agentId: string }).agentId,
        );
        return JSON.stringify(ticket);
      },
    }],
  }],
});

const created = await surface.createConversation(
  { cwd: '/workspace/build', developerInstructions: 'Keep changes focused.' },
  { extensionContext: { agentId: 'build' } },
);
const conversation = surface.conversation(created.activeConversationId!);
```

`extensionContext` is opaque host-only data. It is retained per conversation,
passed to start/resume configuration and dynamic tools, and is never exposed by
the renderer IPC API.

The [basic Electron + Vue sample](./samples/basic) proves the complete boundary:
its custom left pane renders the app-server conversation list from the SDK's
reactive state and per-conversation status, while its right pane mounts one
bound `CodexConversationPane`. SDK defaults supply native file picking and
ingestion, image paste/drop, attachment previews, copy, audio capture and Apple
speech transcription, models, permissions, plans, goals, and concurrent live
conversation state without `App.vue` plumbing. It contains no raw app-server or
IPC plumbing. Run:

```bash
npm run sample:start
```

For renderer HMR and automatic Electron restarts when sample or SDK source
changes, run `npm run dev` inside `samples/basic`. The development command is
owned by the developer; the SDK does not launch a background watcher itself.

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

## Advanced: typed app-server client

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

The transport and wire envelopes are replaceable. This layer is for advanced
features that the high-level surface does not yet cover; ordinary surface code
should use `CodexSurface` and never handle these generated types.

## Events and Electron IPC

`TypedEventBus` provides app-owned event contracts without coupling state to a
framework. `TypedIpcRenderer`, `TypedIpcMain`, `registerIpcMainHandlers`, and `sendIpcEvent`
apply the same contracts across Electron's security boundary using narrow
structural ports—`codex-app-sdk` never exposes Electron or Node primitives to
the renderer.

A custom low-level desktop pipeline is:

```text
Codex notification -> product adapter -> TypedEventBus -> Electron IPC
  -> renderer event bus/store -> Vue components
```

Protocol-specific payloads should be adapted before they cross IPC. Components
consume surface-owned messages and state, not raw app-server notifications.
Fatal app-server transport failures move the surface into an error state; calling
`connect()` starts a fresh process and initializes it again.

## Vue surfaces

The Vue entry includes `CodexConversationPane`, `CodexApprovalPrompt`,
`CodexComposer`, `CodexComposerMenu`, `CodexComposerMenuList`,
`CodexComposerSendButton`, `CodexMessage`, and `CodexMessageList`:

```ts
import { CodexComposer, CodexMessageList } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';
```

`useCodexSurface` is the app-server-backed reactive controller. Applications own
their shell, header, and list/navigation UI, then bind the controller's state
and actions to `CodexConversationPane`. The pane is deliberately headerless: it
composes the conversation history loader, message list, composer shelf, goals,
queued prompts, errors, empty state, and approval prompts. It forwards
empty-state, message, message-action, message-block, thinking, tool, approval,
composer, and menu slots, and accepts custom composer menu entries without
requiring a fork. Apps that want a measured sticky header/footer layout can
compose the separately exported `CodexWorkbenchLayout`; apps can also use
`CodexConversationHistoryLoader` independently.

The SDK stylesheet owns the complete default presentation of every SDK-rendered
component: typography, spacing, icons, menus, message blocks, composer states,
thinking shimmer, history loading, light/dark presentation, and interaction
feedback. Host applications own shell and navigation styling, plus the content
of customization slots. Import `codex-app-sdk/styles.css` once. Components apply
the scoped `.codex-chat-theme` root themselves, so the stylesheet does not reset
the host application. Set `data-codex-theme="dark"`,
`data-codex-theme="system"`, `.codex-chat-theme--dark`, or
`.codex-chat-theme--system` on an ancestor to choose a theme; override semantic
`--codex-*` variables for product theming. The sample does not patch component
internals. `applyCodexTheme(element, { mode, tokens })` is an optional helper
for hosts that want the SDK to install and later clean up theme attributes and
token overrides; direct CSS variables remain supported.

`CodexComposerMenu` accepts nested action, checkbox, radio, separator, submenu,
and custom entries. Typed payloads let a host application contribute its own
actions, while scoped `trigger`, `item`, and `icon` slots can replace the
default presentation without forking menu behavior. The default menu implements
roving focus, arrow/Home/End navigation, submenu state, and Escape focus restore.

`CodexMessage` renders the SDK's safe `SurfaceMessage` contract. Message and
message-list slots let products replace text, tool, status, and full-message
rendering while retaining tested layout and auto-scroll behavior. Components
use `--codex-*` semantic CSS variables with neutral fallbacks and do not depend
on Element Plus, Electron, application stores, or raw app-server types.

Every top-level Vue component has one same-named isolated spec. Public leaf
components copied from the conversation kit are also mounted directly by the
Vue tests. Package-boundary tests enforce both inventories so a component cannot
be shipped accidentally without executable coverage.
