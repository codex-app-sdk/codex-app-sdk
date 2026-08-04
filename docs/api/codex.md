# Low-level app-server client

The `codex` entry point exposes generated protocol bindings and a typed client.
Use it in trusted host code when app-server adds a capability that the high-level
surface does not project yet.

```ts
import { CodexAppServerClient } from 'codex-app-sdk/codex';
import { CodexAppServerStdioTransport } from 'codex-app-sdk/node';

const client = new CodexAppServerClient(
  new CodexAppServerStdioTransport(),
);

await client.start();
await client.initialize({
  clientInfo: {
    name: 'advanced_surface',
    title: 'Advanced Surface',
    version: '0.1.0',
  },
  capabilities: {
    experimentalApi: true,
    requestAttestation: false,
  },
});

const { thread } = await client.request('thread/start', {});
```

## Typed requests and notifications

```ts
client.onNotification('item/agentMessage/delta', ({ params }) => {
  console.log(params.threadId, params.delta);
});

client.notify('initialized');
```

Method names determine request parameter/result and notification payload types
through the generated method maps.

## Server requests

```ts
client.onServerRequest('item/tool/requestUserInput', (request, responder) => {
  responder.resolve({ answers: {} });
  return true;
});
```

Responders allow exactly one typed resolve/reject. Unhandled requests receive a
method-not-implemented error by default.

## Client options

```ts
type CodexAppServerClientOptions = {
  requestTimeoutMs?: number;
  onProtocolError?: (error: Error) => void;
  unhandledServerRequestError?: (request) => RpcError;
};
```

The client owns request correlation, timeouts, notification routing, disconnect
propagation, server-request response state, and transport cleanup.

## Generated exports

- all app-server request/response/notification types;
- `CodexAppServerMethodMap`;
- `CodexServerRequestMethodMap`;
- JSON-RPC wire types and guards;
- `RpcRemoteError` and `RpcTransportProtocolError`;
- `codexSchemaCliVersion`.

The current checked-in schema version is `codex-cli 0.144.1`.

See the [JSON-RPC coverage inventory](./json-rpc) for every generated request,
notification, and server request, including whether the high-level SDK projects it.

::: warning Keep protocol at the edge
Adapt raw results into a framework-neutral product contract before crossing IPC.
If ordinary renderer code needs generated types, add the capability to the
high-level surface instead.
:::
