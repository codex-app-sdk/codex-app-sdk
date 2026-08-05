# Add an MCP server

Use an app-owned MCP server when Codex should call a capability supplied by your
application: search product data, inspect a project, operate a browser, or
perform a business action. Register it in the scaffold's trusted main process;
do not send MCP commands, URLs, environments, or credentials to the renderer.

## Connect an existing HTTP server

In `src/main/index.ts`, replace the generated
`createCodexAppBackend()` call with configured `surfaceOptions`:

```ts
backend = createCodexAppBackend({
  surfaceOptions: {
    mcpServers: [{
      name: 'knowledge',
      transport: {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      },
      required: true,
      enabledTools: ['search_docs', 'read_document'],
      toolApprovalMode: 'auto',
    }],
  },
});
```

Keep the generated bridge registration unchanged:

```ts
registerCodexElectronMain({
  // ...
  surface: backend.surface,
});
```

Only HTTP and HTTPS URLs are accepted. A required server prevents a conversation
from starting when the server cannot initialize.

## Bundle a local stdio server

A local MCP server needs its own build entry because it runs as a separate Node
process rather than inside Electron main.

### 1. Install the MCP dependencies

```bash
npm install @modelcontextprotocol/sdk zod
```

### 2. Create the server

Add `src/mcp/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { lookupProject } from '../shared/project-store';

const server = new McpServer({
  name: 'my-codex-app',
  version: '0.1.0',
});

server.registerTool('lookup_project', {
  description: 'Read the current project record by id.',
  inputSchema: {
    projectId: z.string().describe('Project identifier'),
  },
  annotations: { readOnlyHint: true },
}, async ({ projectId }) => ({
  content: [{
    type: 'text',
    text: JSON.stringify(await lookupProject(projectId)),
  }],
}));

await server.connect(new StdioServerTransport());
```

`lookupProject` is application code that you provide. Keep credentials and
authoritative data access in this process or in another trusted service.

### 3. Add an MCP build

Create `vite.mcp.config.ts` beside the generated `vite.config.ts`:

```ts
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: fileURLToPath(new URL('./dist-mcp', import.meta.url)),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./src/mcp/server.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'server.js',
    },
    rolldownOptions: {
      external: [/^node:/, /^@modelcontextprotocol\/sdk\//, /^zod$/],
    },
  },
});
```

Update the generated scripts so the MCP build runs before Electron:

```json
{
  "scripts": {
    "build:mcp": "vite build --config vite.mcp.config.ts",
    "dev": "npm run build:mcp && vite --mode electron",
    "build": "npm run build:mcp && vite build && vue-tsc --noEmit"
  }
}
```

### 4. Register the bundled server

The scaffold already defines `bundleDirectory`. Resolve the sibling MCP output
from it and configure the backend:

```ts
const mcpServerPath = path.join(bundleDirectory, '../dist-mcp/server.js');

backend = createCodexAppBackend({
  surfaceOptions: {
    mcpServers: [{
      name: 'my-codex-app',
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: [mcpServerPath],
        cwd: path.dirname(mcpServerPath),
        env: {
          ELECTRON_RUN_AS_NODE: '1',
        },
      },
      required: true,
      enabledTools: ['lookup_project'],
      toolApprovalMode: 'auto',
      startupTimeoutMs: 10_000,
      toolTimeoutMs: 30_000,
    }],
  },
});
```

`ELECTRON_RUN_AS_NODE` makes the Electron executable run the bundled MCP entry
as a normal Node process. For a separately installed executable, use its
absolute command path instead.

### Share data with app-owned panels

The stdio server is a separate process. It cannot share an in-memory backend
module with Electron main. If a Vue panel and MCP tools use the same data, put
the authoritative state in a file, database, or service both processes can
access. Expose a narrow read API to the panel through the application backend;
let MCP expose the model-callable operations.

## Choose approval behavior

`toolApprovalMode` accepts:

- `auto`: app-server may call tools without an extra MCP confirmation;
- `prompt`: ask before tool calls;
- `writes`: automatically allow read-only tools and confirm writes;
- `approve`: use the server/tool approval behavior advertised by app-server.

Tool annotations remain important even when the host selects a mode. Mark
read-only, destructive, and non-idempotent operations accurately.

## Scope servers to one conversation

Surface definitions apply to every new or resumed conversation by default.
Replace them for one conversation:

```ts
await backend.surface.createConversation({}, {
  mcpServers: tenantSpecificServers,
});
```

Or replace them while loading a known conversation:

```ts
await backend.surface.conversation(conversationId).load({
  mcpServers: tenantSpecificServers,
});
```

MCP definitions are start/resume configuration, not a hot-swap API.

## Present app-owned tools

MCP calls automatically use the SDK tool renderer, grouping, approvals,
history, and semantic events. In the Vue root, customize only their
presentation:

```ts
provideCodexToolPresentation(({ kind, metadata }) => {
  if (kind !== 'mcp' || metadata?.server !== 'my-codex-app') return undefined;
  return {
    icon: ProjectToolIcon,
    title: metadata.tool === 'lookup_project' ? 'Looked up project' : undefined,
  };
});
```

Returning `undefined` or `null` preserves the SDK fallback presentation. See
[Vue providers](/guide/vue-providers#tool-icons-and-titles).

## MCP server or another extension point?

| Requirement | Use |
| --- | --- |
| Model-callable capability with schemas, process isolation, or reuse outside this app | MCP server |
| Small in-process model tool owned only by this host | [Dynamic tool](/guide/extensions#dynamic-tools) |
| Per-conversation instructions or configuration | [Surface extension](/guide/extensions) |
| Deterministic data for an app-owned Vue panel | [Backend module](/guide/backend) plus IPC |

The [Relay sample](/guide/samples#relay-business-ui-mcp) is the complete
reference for a bundled stdio server, shared application state, approvals, and
UI refresh after tool completion.
