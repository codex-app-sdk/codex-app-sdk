# App-owned MCP servers

Register trusted stdio or HTTP MCP servers in the main-process surface. The SDK
compiles typed definitions into app-server thread configuration; raw MCP
commands, URLs, paths, and environments never enter renderer IPC or snapshots.

## Stdio server

```ts
import path from 'node:path';
import { createCodexSurface } from 'codex-app-sdk/node';

const surface = createCodexSurface({
  mcpServers: [{
    name: 'operations',
    transport: {
      type: 'stdio',
      command: process.execPath,
      args: [mcpServerPath],
      cwd: path.dirname(mcpServerPath),
      env: {
        OPERATIONS_STATE_PATH: statePath,
      },
    },
    toolApprovalMode: 'writes',
    required: true,
    enabledTools: [
      'list_exceptions',
      'get_shipment',
      'rebook_shipment',
    ],
    startupTimeoutMs: 10_000,
    toolTimeoutMs: 30_000,
  }],
});
```

## HTTP server

```ts
const surface = createCodexSurface({
  mcpServers: [{
    name: 'knowledge',
    transport: {
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    },
    required: true,
  }],
});
```

Only HTTP and HTTPS URLs are accepted. Server names, absolute stdio paths,
timeouts, environments, duplicate definitions, and config collisions are
validated before app-server starts a thread.

## Approval modes

`toolApprovalMode` accepts the app-server modes:

- `auto`
- `prompt`
- `writes`
- `approve`

Choose the mode in trusted host code. Approval requests are projected into the
same `clientRequests` state and confirmation components as other SDK tool
confirmations.

## Per-conversation replacement

Surface definitions apply to every new or resumed conversation by default.
Replace them for one conversation:

```ts
await surface.createConversation({}, {
  mcpServers: tenantSpecificServers,
});
```

Disable SDK-provided definitions for a conversation:

```ts
await surface.conversation(conversationId).load({
  mcpServers: [],
});
```

Definitions are start/resume configuration, not a hot-swap API. Configure them
before starting or loading the relevant thread.

## Rendering and events

MCP calls flow through the standard conversation model:

- tool blocks show inputs, progress, status, and output;
- elicited confirmations render through the standard approval experience;
- `tool.started`, progress, and `tool.completed` semantic events are emitted;
- restored MCP history uses the same tool projection.

MCP tool parts retain their server and tool identity as renderer-safe metadata.
Use [`provideCodexToolPresentation`](/guide/vue-providers#tool-icons-and-titles)
to give an app-owned server or individual tool a custom Vue icon and title
without replacing the SDK tool renderer.

The [Relay sample](/guide/samples#relay-business-ui-mcp) demonstrates a full
business loop: UI intent → visible prompt → MCP read/write → user confirmation →
tool event → business-state refresh.
