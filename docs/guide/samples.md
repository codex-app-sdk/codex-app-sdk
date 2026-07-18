# Samples

The repository includes three Electron + Vue applications. Each demonstrates a
different product boundary while reusing the same SDK runtime, IPC, and
conversation components.

## Basic: multi-thread client

**Shape:** custom conversation sidebar + stock `CodexConversationPane`.

It demonstrates:

- global app-server conversation discovery without an implicit `cwd` filter;
- custom create/select/delete conversation UI;
- several simultaneously live conversations;
- the full composer, models, reasoning, permissions, plan mode, goals, skills,
  approvals, queues, message actions, and history;
- native picking, ingestion, paste/drop, copy, and speech transcription;
- almost no renderer-side SDK plumbing.

```bash
cd samples/basic
npm run dev
```

Production-style build/start:

```bash
npm run sample:start
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
npm run spark:dev
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
- no raw app-server or MCP configuration in the renderer.

```bash
npm run relay:dev
```

Relay uses a seeded local JSON store. It demonstrates the integration loop, not
a production logistics backend.

## Choose a starting point

| Need | Sample |
| --- | --- |
| Full Codex client or custom thread list | Basic |
| Narrow branded assistant | Spark |
| Model-assisted business workflow | Relay |

Copy the product shape, not internal SDK code. Applications should import the
public package entry points and leave app-server protocol handling inside the
SDK.
