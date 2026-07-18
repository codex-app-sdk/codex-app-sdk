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
import { ipcMain } from 'electron';
import { registerCodexSurfaceIpc } from 'codex-app-sdk/electron';
import { createCodexSurface } from 'codex-app-sdk/node';

const surface = createCodexSurface();

const disposeIpc = registerCodexSurfaceIpc(ipcMain, window.webContents, surface);
```

Preload exposes the narrow SDK bridge; no Node or Electron primitive crosses
into the renderer:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { createCodexSurfaceRendererApi } from 'codex-app-sdk/electron';

contextBridge.exposeInMainWorld(
  'codexSurface',
  createCodexSurfaceRendererApi(ipcRenderer),
);
```

The main-process surface loads app-server's model and skill catalogs, permission
profiles, goals, and persisted threads. Renderer settings updates are validated against that
catalog before the surface sends typed `thread/settings/update` requests. The
main IPC adapter strips unknown runtime fields before calling the surface.

Vue binds the bridge to reactive state and uses the SDK conversation pane:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import 'codex-app-sdk/styles.css';

const draft = ref('');
const surface = useCodexSurface(window.codexSurface);
const { state, connect, selectConversation, sendMessage } = surface;
onMounted(connect);
</script>

<template>
  <MyConversationList
    :conversations="state.conversations"
    @select="selectConversation"
  />
  <CodexConversationPane
    v-model="draft"
    :approvals="state.approvals"
    :busy="state.busy"
    :context-usage="state.contextUsage"
    :goal="state.goal"
    :messages="state.messages"
    :models="state.models"
    :queued-prompts="state.queuedPrompts"
    :skills="state.skills"
    @client-response="surface.respondToClientRequest"
    @delete-message="surface.deleteMessage"
    @delete-queued-prompt="surface.deleteQueuedPrompt"
    @edit-message="({ index, content }) => surface.editMessage(index, content)"
    @interrupt="surface.interrupt"
    @retry-message="surface.retryMessage"
    @steer="surface.steerMessage"
    @steer-queued-prompt="surface.steerQueuedPrompt"
    @submit="sendMessage"
  />
</template>
```

`CodexSurface` exposes stable product operations: connect, list/refresh, create,
select, send/queue/steer, interrupt, update settings, set/clear goals,
approve/deny/respond, delete/edit/retry, subscribe, and close. `connect()` paginates the global, non-archived app-server thread list
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

The [basic Electron + Vue sample](./samples/basic) proves the complete boundary:
its custom left pane renders the app-server conversation list from the SDK's
reactive state, while its right pane configures and customizes
`CodexConversationPane`. It contains no raw app-server or IPC plumbing. Run:

```bash
npm run sample:start
```

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
their shell and list/navigation UI, then bind the controller's state and actions
to `CodexConversationPane`. The pane composes message-list, composer shelf,
goals, queued prompts, error, header, and empty states plus app-owned approval
prompts. It forwards header, empty-state,
message, approval, composer, and menu slots, and accepts custom composer menu
entries without requiring a fork.

The SDK stylesheet owns the complete default presentation of every SDK-rendered
component: typography, spacing, icons, menus, message blocks, composer states,
and interaction feedback. Host applications own shell and navigation styling,
plus the content of customization slots. Apps can theme SDK components through
the documented `--codex-*` variables; the sample does not patch component
internals.

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

Every public Vue component has one same-named isolated spec. A package-boundary
test compares the component and test manifests so catch-all component suites
cannot replace that one-to-one structure.
