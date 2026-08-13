# Samples

The repository includes three Electron + Vue applications under
`samples/electron`, one web + Vue application with a thin Express host under
`samples/web`, and one browser-only component lab. Each reuses the same SDK
conversation components at a different product or testing boundary.

For a new application, start with the [project scaffolder](/guide/scaffolding)
and update the generated shell. Use these samples as focused references for a
particular product shape or integration pattern, not as alternative templates.

All sample `dev` commands consume SDK source directly. A prior SDK build is not
required; Vue SDK changes hot-reload in the browser or Electron renderer, and
the Basic Web server restarts for backend or transport changes.

Run every command below from the repository root. The development shortcuts
follow `verb:target` consistently:

| Sample | Development | Production build |
| --- | --- | --- |
| Basic Electron | `npm run dev:electron` | `npm run build:electron` |
| Spark | `npm run dev:spark` | `npm run build:spark` |
| Relay | `npm run dev:relay` | `npm run build:relay` |
| Basic web | `npm run dev:web` | `npm run build:web` |
| Component lab | `npm run dev:lab` | `npm run build:lab` |

`npm run check:workspaces` builds the SDK once, then runs the owned lint, test,
and build gates for the scaffolder and every sample. Use
`npm run build:workspaces` for a compile-only pass across the five checked-in
samples.

## Basic: multi-thread client

**Shape:** shared `CodexConversationSidebar` + stock `CodexConversationPane`.

It demonstrates:

- global app-server conversation discovery without an implicit `cwd` filter;
- custom create/select/delete conversation UI;
- several simultaneously live conversations;
- the full composer, models, reasoning, permissions, plan mode, goals, skills,
  approvals, queues, message actions, and history;
- native picking, ingestion, paste/drop, copy, and speech transcription;
- almost no renderer-side SDK plumbing;
- a trusted main-process `CodexAppBackend` that owns the shared surface.

```bash
npm run dev:electron
```

Production-style build/start:

```bash
npm run start:electron
```

## Spark: focused chat

**Shape:** a branded, simplified chat surface with app-owned sign-in and account
UI.

It demonstrates:

- a per-product `CODEX_HOME` and workspace;
- authoritative signed-out state and browser login;
- logout on the same mounted controller;
- host-owned fixed model/reasoning defaults;
- read-only host policy and custom developer instructions;
- capabilities and presentation controls that hide advanced UI cleanly;
- semantic color, typography, and control-size tokens;
- custom empty state and conversation chrome around the stock pane.

```bash
npm run dev:spark
```

Spark demonstrates SDK customization. It is not a child-safety system or a
substitute for product-specific safety review.

## Relay: business UI + MCP

**Shape:** logistics exception desk above/beside one persistent stock
conversation.

It demonstrates:

- app-owned operational state and business controls;
- rich visible prompts generated from UI actions;
- a trusted stdio MCP server registered through `mcpServers`;
- standard tool rendering and write confirmations;
- semantic `tool.completed` events refreshing business state;
- a narrow sample-owned read-only IPC endpoint;
- `CodexAppBackend` composing the shared Codex surface with an app-owned
  operations module;
- no raw app-server or MCP configuration in the renderer.

```bash
npm run dev:relay
```

Relay uses a seeded local JSON store. It demonstrates the integration loop, not
a production logistics backend.

## Basic web: transport boundary

**Shape:** the same sidebar/pane shell as Basic over a thin Express + `ws` host.

It demonstrates:

- host-owned HTTP upgrade and site-authentication seams;
- the framework-neutral `@codex-app-sdk/web/server` lease boundary;
- the browser client and the same `@codex-app-sdk/vue` pane used by Electron;
- the same exported `CodexConversationSidebar` create/select/delete flow as
  Basic, without copying the component between samples;
- default local Codex authentication;
- no sample-owned request IDs, protocol parsing, surface-operation mapping, or
  reconnect implementation.

```bash
npm run dev:web
```

For a production-style build followed by the Node server, use
`npm run start:web`.

The fixed demo user is not production authentication. Replace the two named
host seams with the website's session lookup and per-user backend/process pool.

## Component lab: mocked visual scenarios

Run it from the repository root:

```bash
npm run dev:lab
```

The browser-only component lab uses deterministic mock data instead of
app-server. It provides selectable states for rich mentions, middle-of-text
multiline editing, steering, tool calls, attachments, streaming responses, busy
and queued work, context usage, turn diffs, empty conversations, errors, and
light/dark/system themes. Use it to inspect SDK rendering and interactions
without Codex authentication or Electron.

## Choose a starting point

| Need | Sample |
| --- | --- |
| Full Codex client or custom thread list | Basic |
| Visual regression and interaction inspection | Component lab |
| Narrow branded assistant | Spark |
| Model-assisted business workflow | Relay |
| Web transport and website embedding | Basic web |

Copy the product shape, not internal SDK code. Applications should import the
public package entry points and leave app-server protocol handling inside the
SDK.
