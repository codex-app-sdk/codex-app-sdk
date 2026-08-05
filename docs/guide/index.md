# Why Codex App SDK

Codex app-server exposes a rich bidirectional protocol. It is an excellent
foundation, but a complete desktop application needs much more than a request
helper.

The SDK packages the generic work once:

- discovering and starting the Codex executable;
- initializing JSONL-over-stdio transport and correlating requests;
- loading account state, models, skills, plugins, permission profiles, and
  persisted conversations;
- keeping multiple conversations alive and independently streaming;
- projecting history and live events into one serializable message model;
- handling approvals, app-server questions, goals, plans, reviews, queues,
  context usage, and rate limits;
- bridging trusted main-process behavior into a constrained Electron renderer;
- rendering a complete Vue conversation pane with native attachments and
  transcription.

## Default workflow

1. Follow the [scaffolding guide](/guide/scaffolding) to create and run the
   application.
2. [Tour the generated project](/guide/quick-start) so you know which files the
   SDK owns and which seams are yours.
3. Add [app-owned panels](/guide/app-ui), an [MCP server](/guide/mcp), or a
   [backend service](/guide/backend) without replacing the conversation runtime.

The scaffold is the starting point, not a throwaway demonstration. Samples are
references for particular product shapes; manual SDK installation is primarily
for existing applications.

## The boundary

The SDK owns the Codex surface. The host application owns the product.

| SDK responsibility | Application responsibility |
| --- | --- |
| App-server process and protocol lifecycle | Window lifecycle and navigation policy |
| Conversation runtime and message projection | Product shell, navigation, headers, and sidebars |
| Standard composer and message experience | Workspace, agent, cockpit, or business views |
| Native attachment/clipboard/transcription bridge | Which capabilities and presets users should see |
| Semantic events and reusable tools | Business state and external integrations |
| Extension and MCP seams | Trusted implementation of app-owned tools |

This boundary keeps samples small and prevents every application from carrying
its own subtly different conversation implementation.

## Choose your level

### High-level backend and surface

Most applications should keep the scaffold's `CodexAppBackend` in the main
process. It owns one `CodexSurface`, which the Electron bridge exposes to
`useCodexSurface` in Vue. Applications that do not need backend modules may
create the surface directly.

This level uses product concepts and serializable contracts. It does not expose
raw app-server messages to the renderer.

### Reusable Vue components

Use `CodexConversationPane` for the complete default experience. Use the
exported composer, message, tool, media, menu, goal, and queue components when
your product needs a different layout.

The pane can bind directly to `useCodexSurface`, or consume one grouped
controlled-view adapter when the application already owns its state and
transport. See [Conversation pane integration](/guide/conversation-pane).

### Low-level client

`CodexAppServerClient` and generated method types are available for capabilities
the high-level surface does not project yet. Keep that code in the trusted host,
adapt it into product-shaped data, and promote broadly useful behavior into the
surface instead of leaking protocol into renderer code.

## Next

- [Scaffold a complete Electron + Vue application](/guide/scaffolding)
- [Tour the generated application](/guide/quick-start)
- [Add an app-owned panel](/guide/app-ui)
- [Add an MCP server](/guide/mcp)
- [Install into an existing application](/guide/installation)
- [Understand the architecture](/guide/architecture)
- [Choose a pane integration](/guide/conversation-pane)
