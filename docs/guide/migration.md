# Migrate to the successor SDKs

Use the `@korus-dev` SDKs for new integrations and when migrating an existing
Codex App SDK application. Choose the layers your application needs:

| Package | Responsibility | API baseline for this guide |
| --- | --- | --- |
| [`@korus-dev/codex-sdk`](https://korus-dev.github.io/codex-sdk/) | Typed Codex app-server client, protocol and Node transports | `0.167.1` |
| [`@korus-dev/multi-agent-sdk`](https://korus-dev.github.io/multi-agent-sdk/) | Provider integration, harnesses, sessions, history and shared conversation contracts | `0.26.0` |
| [`@korus-dev/agent-ui-sdk`](https://korus-dev.github.io/agent-ui-sdk/) | Vue controls, renderer host capabilities, Electron native integration and speech | `0.25.0` |

The Codex SDK is independently maintained under `@korus-dev`; its npm name is
separate from OpenAI's official SDKs.

Existing `@codex-app-sdk/*` releases and their reference documentation remain
available. This guide does not change npm deprecation status. Applications can
migrate one boundary at a time while retaining their existing provider history
and product-owned data.

## Package and entry-point map

| Existing import or integration | Successor |
| --- | --- |
| Low-level client and protocol from `@codex-app-sdk/backend` or `/protocol` | `@korus-dev/codex-sdk` |
| `CodexSurface`, conversation lifecycle and backend composition | `createHarnessDriver` and `HarnessDriver`/`Session` from `@korus-dev/multi-agent-sdk`; adapt lifecycle and state explicitly |
| Conversation, message, turn, request and prompt types from `@codex-app-sdk/core/surface` | Provider-neutral types from `@korus-dev/multi-agent-sdk` |
| Browser-safe state helpers and prompt authoring | `@korus-dev/multi-agent-sdk/renderer` and `/prompt` |
| Attachment, clipboard, image and speech host contracts from `@codex-app-sdk/core/native` | `@korus-dev/agent-ui-sdk/host.js` |
| `@codex-app-sdk/vue` | `@korus-dev/agent-ui-sdk`; adapt the pane/controller API |
| `@codex-app-sdk/vue/styles.css` | `@korus-dev/agent-ui-sdk/styles.css` |
| Native attachments, clipboard, links and speech IPC from `@codex-app-sdk/electron` | `@korus-dev/agent-ui-sdk/electron.js` and `/electron/preload.js` |
| Apple and OpenAI speech helpers from the old backend or Electron entry | `@korus-dev/agent-ui-sdk/speech.js`, also re-exported by `/electron.js` |
| Surface IPC: `registerCodexSurfaceIpc`, `createCodexSurfaceRendererApi`, `useCodexSurface` | Application-owned session bridge plus Agent UI SDK's session/controller binding |
| `@codex-app-sdk/web/client`, `/server`, `/protocol` | [Browser-to-host session bridge](#browser-to-host-websocket-bridge) |
| `@codex-app-sdk/create-codex-app` | [Successor application samples](#generated-applications) |

The old `core` and `backend` packages each span more than one new layer. Review
symbols and data shapes rather than replacing every package string in bulk.
Renderer code uses `/renderer`, `/prompt`, UI entries and type-only imports;
provider execution stays in the trusted host.

## Prerequisites and dependencies

Examples and entry points below target the published versions in the table.
Successor documentation may describe newer APIs; check the installed package
declarations before adopting those APIs.

The successor SDKs require Node.js **22.19 or newer** for trusted host code.
Agent UI SDK requires Vue **3.5 or newer** and a Vue-aware ESM bundler.
TypeScript consumers use Bundler module resolution. Electron is an optional peer
for the desktop adapters. At Agent UI SDK `0.25.0`, use the explicit `.js`
suffix for optional host, speech and Electron entries in Node ESM, as shown
below; the package root and stylesheet imports stay unchanged.

Install only the layers you call directly. A high-level agent application uses:

```sh
npm install @korus-dev/multi-agent-sdk@0.26.0
```

A Vue application adds:

```sh
npm install @korus-dev/agent-ui-sdk@0.25.0 vue@^3.5.0
```

Applications that call raw app-server RPCs directly also declare:

```sh
npm install @korus-dev/codex-sdk@0.167.1
```

Keep the old dependencies until their imports and integrations have been
replaced. Check the application's resolved dependency tree and install from
npm when qualifying the migration; sibling source aliases alone do not verify
the published artifacts.

## Raw Codex protocol clients

The low-level client and transport names are available from the new Codex SDK.
For example, replace:

```ts
import {
  CodexAppServerClient,
  CodexAppServerStdioTransport,
} from '@codex-app-sdk/backend';
```

with:

```ts
import {
  CodexAppServerClient,
  CodexAppServerStdioTransport,
} from '@korus-dev/codex-sdk';

const client = new CodexAppServerClient(new CodexAppServerStdioTransport());
```

The new package's root also exports generated protocol types. Review
initialization, executable discovery, feature flags and recovery against its
[connection guide](https://korus-dev.github.io/codex-sdk/guide/connecting.html).
A raw protocol client does not provide the old `CodexSurface` state model.

### App-server connections versus application connections

The supplied Codex transports connect a trusted Node host to Codex app-server:

- **Stdio:** launch an app-server and exchange JSONL over its pipes.
- **Unix control socket:** attach to a running app-server without taking
  ownership of the server process. This transport uses WebSocket framing over
  the Unix socket.

The old `@codex-app-sdk/web` WebSocket connection serves a different boundary:
it carries application state and actions between a browser and the application's
Node host. That host then connects to app-server through its chosen Codex
transport. Migrating the browser bridge does not change the choice between
stdio and a Unix socket.

Codex app-server also supports `--listen ws://IP:PORT`. That direct app-server
WebSocket endpoint is distinct from the old browser-to-host surface bridge.
The Codex SDK baseline above supplies stdio and Unix-socket transports; to
connect to a direct WebSocket endpoint, implement its `RpcTransport` contract. See its [transport reference](https://korus-dev.github.io/codex-sdk/api/transports.html).

## Replace surface ownership with harness sessions

Use Multi Agent SDK when the application needs provider integration and
projected conversation state. A `HarnessDriver` owns opaque `Session` handles;
operations take the session they act on. Keep these handles in the trusted host.

```ts
import { createHarnessDriver } from '@korus-dev/multi-agent-sdk';

const driver = createHarnessDriver('codex', { client: { name: 'my-app' } });
const session = driver.open({ id: 'conversation-1', folder: process.cwd() });
const unsubscribe = driver.onEvent(event => {
  if (event.type === 'session.changed' && event.session === session) {
    console.log(event.state.messages);
    // Observe event.state.turns for completion, failure or interruption.
  }
});

const admission = await driver.sendPrompt(session, 'Explain this project');
console.log(admission.turnId);

// Keep the driver open while the turn runs. At application shutdown:
// unsubscribe();
// await driver.close();
```

Migrate the lifecycle as a whole: opening/loading sessions, subscribing to state,
prompt admission, turn completion, interruption and releasing resources.
`sendPrompt` reports admission, not terminal completion. Observe session state
through `onEvent` or `readSession` for the turn outcome. Do not treat admission
as the old surface snapshot returned by `sendMessage`.
Use the harness's capabilities to enable optional operations and retain request
IDs and decisions when forwarding approvals or questions.

See the [Multi Agent SDK consumer contract](https://korus-dev.github.io/multi-agent-sdk/consumer-contract.html)
and [API reference](https://korus-dev.github.io/multi-agent-sdk/api/).

### Preserve existing conversations

Keep the existing provider home, native conversation identity, workspace and
application storage. Replacing the SDK does not require deleting provider
history or starting every conversation over.

Use `listConversations` and `readConversationMessages` to inspect native history,
then explicitly resume the selected conversation. Preserve its active/archived
state. Existing serialized application records need an explicit adapter into
the new API; old `CodexSurface` snapshots are not `SessionData`.

For sessions managed by the new harness, persist the detached data returned by
`getSessionData` and restore it with `restoreSession`, followed by
`loadConversation`. Keep these records associated with their provider and home.
The [sessions guide](https://korus-dev.github.io/multi-agent-sdk/guide/sessions.html)
explains the restoration and reference contracts.

## Bind the conversation UI

Replace `CodexConversationPane` and `useCodexSurface` integration with
`ConversationPane` and a session/controller binding. The UI receives reactive
plain state and renderer-safe operations through the application's bridge.
It does not receive the trusted harness or a provider session handle.

For example, this application helper binds a session state snapshot:

```ts
import { shallowRef } from 'vue';
import type { HarnessCapabilities, SessionState } from '@korus-dev/multi-agent-sdk';
import { createSessionConversationController } from '@korus-dev/agent-ui-sdk';

export function bindConversation(
  conversationKey: string,
  initialState: SessionState,
  capabilities: HarnessCapabilities,
  client: Parameters<typeof createSessionConversationController>[0]['client'],
) {
  const state = shallowRef(initialState);
  const binding = createSessionConversationController({
    conversationKey, state, capabilities, client,
  });
  return { state, ...binding };
}
```

Update `state.value` from bridge subscriptions, pass `binding.controller` to
`<ConversationPane :controller="binding.controller" />`, and unsubscribe and
call `binding.dispose()` when the view closes. Replace the stylesheet import
with `@korus-dev/agent-ui-sdk/styles.css`.

Hosts that already own queues and actions can use
`createConversationPaneController` and `sessionStateToConversationPaneState`
instead. Review slots, event payloads, message projection, permission settings
and presentation types against the [pane guide](https://korus-dev.github.io/agent-ui-sdk/guide/conversation-pane).
The [session-binding guide](https://korus-dev.github.io/agent-ui-sdk/guide/conversation-pane#session-binding)
shows the renderer port and prompt-option conversion.

## Electron native capabilities and speech

| Existing symbol | Successor symbol and import |
| --- | --- |
| `registerCodexNativeIpc` | `registerNativeIpc` from `@korus-dev/agent-ui-sdk/electron.js` |
| `CodexElectronAttachmentRegistry` | `ElectronAttachmentRegistry` from `/electron.js` |
| `exposeCodexNativeRendererApi` | `exposeNativeRendererApi` from `/electron/preload.js` |
| `createCodexNativeRendererApi` | `createNativeRendererApi` from `/electron/preload.js` |
| `provideCodexHostCapabilities` | `provideHostCapabilities` from the UI root |
| Apple and OpenAI speech starters | Same starter names from `/speech.js` or `/electron.js` |

Agent UI SDK `0.25.0` provides these neutral names as aliases and retains the
`window.codexAppSdkNative` default global and `codex-native:*` channels. Deploy
matching main and preload adapters together; a package rename alone does not
change this IPC contract. Check a newer release's contract before changing
globals or channels. Native capability IPC is separate from session transport.

This version also retains the surface IPC compatibility exports, including
`registerSurfaceIpc` and `createSurfaceRendererApi`. They can support a staged
cutover; the session/controller binding above is the target integration.

Retain the application's sender authorization, attachment registry lifetime,
opaque attachment references, audio limits and cancellation wiring. Supply
OpenAI credentials only in the trusted host. The
[Electron guide](https://korus-dev.github.io/agent-ui-sdk/guide/native-capabilities#electron)
and [speech reference](https://korus-dev.github.io/agent-ui-sdk/guide/native-capabilities#speech)
cover these adapters.

## Browser-to-host WebSocket bridge

Browser applications own the connection that projects a harness session into
the renderer. Use provider-neutral state and capabilities and session-bound
operations for Agent UI SDK's controller. The new SDKs do not export
`CodexWebSurfaceClient` or `bindCodexWebSocket` as a replacement browser
client/server pair. The retained Electron surface IPC compatibility exports
do not replace that WebSocket bridge.

Keep the existing bridge while migrating the application behind it, or replace
its client and server together. Define request correlation, snapshot/patch
ordering, reconnect behavior and cancellation in the application protocol.
Continue validating the authenticated user, conversation ownership, origin and
attachment references in the trusted host.

Preserve compatibility with already shipped clients, including mobile clients,
until both ends of a changed protocol are deployed. A package rename does not
translate the old wire envelopes. The legacy [web integration guide](/guide/web)
remains the reference for applications retaining that bridge.

## Generated applications

The successor SDKs provide [Agent UI SDK application samples](https://github.com/Korus-Dev/agent-ui-sdk/tree/main/samples):
Basic, Spark and Relay. Use them as references for a new application's host,
preload and renderer composition.

There is no successor `create-codex-app` command in these three packages.
Existing generated applications are ordinary consumer projects: migrate their
imports, state binding, native integration and dependencies using this guide.
The legacy [scaffolding guide](/guide/scaffolding) remains available for the old
command.

## Qualify the application cutover

Before removing the old packages, install the successor versions from npm and
check the application's normal build and runtime paths. Include restoration of
existing conversations, streamed output, approvals and questions, interruption,
attachments and image reloads, and any dictation or remote client integration
the application exposes. Confirm that the renderer bundle contains no provider
runtime, filesystem access or credentials.

Remove the old dependencies once their integrations have been replaced and
verify that no `@codex-app-sdk/*` imports remain in the migrated application.
Provider homes and application history remain intact through the cutover.
