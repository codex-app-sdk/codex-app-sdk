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

### High-level surface

Most applications should create a `CodexSurface` in the main process, expose it
through the Electron bridge, and bind it to `useCodexSurface` in Vue.

This level uses product concepts and serializable contracts. It does not expose
raw app-server messages to the renderer.

### Reusable Vue components

Use `CodexConversationPane` for the complete default experience. Use the
exported composer, message, tool, media, menu, goal, and queue components when
your product needs a different layout.

### Low-level client

`CodexAppServerClient` and generated method types are available for capabilities
the high-level surface does not project yet. Keep that code in the trusted host,
adapt it into product-shaped data, and promote broadly useful behavior into the
surface instead of leaking protocol into renderer code.

## Next

- [Install the SDK](/guide/installation)
- [Build the first surface](/guide/quick-start)
- [Understand the architecture](/guide/architecture)
