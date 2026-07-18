# Extensions and dynamic tools

Extensions let a product add trusted host behavior while preserving the
surface/renderer boundary.

## Configure conversation start and resume

```ts
import { createCodexSurface } from 'codex-app-sdk/node';

const surface = createCodexSurface({
  extensions: [{
    configureConversation: ({ operation, extensionContext }) => {
      const context = extensionContext as { agentId?: string } | undefined;
      return {
        developerInstructions: `Product agent (${operation})`,
        ...(context?.agentId
          ? { config: { product_agent: context.agentId } }
          : {}),
      };
    },
  }],
});
```

The hook can return:

- `baseInstructions`
- `developerInstructions`
- serializable app-server `config`

The surface merges extension contributions with explicit host creation options
and rejects collisions with SDK-owned MCP configuration.

## Opaque extension context

Associate host-only data with a loaded conversation:

```ts
await surface.conversation(conversationId).load({
  extensionContext: {
    agentId: 'research',
    tenantId: 'acme',
  },
});
```

`extensionContext` is retained by the Node runtime and passed to configuration
hooks and dynamic tools. It never appears in snapshots, semantic events, or
renderer IPC.

## Dynamic tools

```ts
const surface = createCodexSurface({
  extensions: [{
    dynamicTools: [{
      name: 'lookup_ticket',
      description: 'Look up a support ticket by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      execute: async ({ arguments: input, extensionContext }) => {
        const { id } = input as { id: string };
        const tenant = (extensionContext as { tenantId: string }).tenantId;
        const ticket = await lookupTicket(tenant, id);
        return JSON.stringify(ticket);
      },
    }],
  }],
});
```

An execution receives:

- `callId`
- `conversationId`
- `turnId`
- JSON arguments
- the conversation's opaque extension context

Return a string or structured text/image content. Tool execution stays in the
trusted Node runtime; app-server sees the declared schema and result.

## When to use an extension or MCP

| Use | Best for |
| --- | --- |
| `configureConversation` | Instructions, config, and host context applied at start/resume |
| Dynamic tool | A small in-process function owned by the host |
| MCP server | A substantial tool service, independent lifecycle, shared protocol, or multiple related resources/tools |

See [MCP servers](/guide/mcp) for the external tool-service seam.
