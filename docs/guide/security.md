# Security boundary

The main process is the trusted policy boundary. The renderer receives a narrow,
serializable, shape-validated surface.

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
  limits;
- ingested file names and binary payloads;
- clipboard text/HTML bounds;
- audio payload bounds and transcription options;
- external-link protocols.

It creates private temporary attachment directories and removes them during
cleanup.

## Electron window policy

Use the bridge with:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}
```

Deny arbitrary renderer navigation. Add a hostname allowlist if your product
needs stronger external-link policy than the SDK's protocol validation.

## Product responsibility

The SDK does not decide which workspaces, tools, MCP servers, permission modes,
accounts, or external hosts are appropriate for your product. Configure those
in trusted host code and test the resulting boundary.

Remote-control pairing is also a trusted-host feature. Keep pairing codes out of
logs, convert `bigint` timestamps before custom IPC, and expose only the product
state the renderer needs. See [Remote control and device pairing](/guide/remote-control).
