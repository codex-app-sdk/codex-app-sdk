# Relay logistics exception desk

Relay is a business-oriented Electron + Vue sample built around one persistent
Codex conversation. A shared KPI header sits above a vertical workspace: the
sample-owned exception queue and issue detail are stacked in the left rail,
while the right side remains the stock SDK `CodexConversationPane` with only
light semantic theming.

The sample demonstrates a complete bidirectional product loop:

1. A dispatcher selects a shipment exception or clicks a concrete business
   action such as **Compare recovery**.
2. Relay sends a visible prompt containing the exact click intent, the snapshot
   the dispatcher saw, and why the action was offered.
3. The model calls the sample-owned `relay` MCP server for authoritative live
   state.
4. Read tools render through the SDK's normal tool blocks. The destructive
   `rebook_shipment` tool uses the SDK's standard write approval flow.
5. A completed tool event causes the app-owned operations board to read its
   latest state through a narrow, read-only Electron IPC method.

The renderer contains no raw app-server, MCP configuration, filesystem, or
Electron primitives. Trusted stdio MCP configuration remains in the main
process through `CodexAppBackend`'s shared `CodexSurface`; the sample's
read-only operations snapshot is a small app-owned backend module.

Relay starts its own app-server process and gives that process the dedicated
`~/.codex-relay` `CODEX_HOME`; it never connects to or modifies normal
`~/.codex` conversations.

Use **Reset demo** in the header to restore the seeded shipment state after a
recovery has been booked. This resets the operations fixture while leaving the
Relay conversation available for comparison and follow-up questions.

## MCP tools

- `list_exceptions`
- `get_shipment`
- `find_recovery_options`
- `draft_customer_update`
- `rebook_shipment`

The MCP server is built from `src/mcp/server.ts` with the official
`@modelcontextprotocol/sdk` TypeScript package. Its seeded business state is
stored under Relay's Electron user-data directory, isolated from the SDK and
from other samples.

## Run

From the repository root:

```bash
npm run start:relay
```

For renderer HMR and automatic Electron restarts:

```bash
npm run dev:relay
```

Focused gates:

```bash
npm run test:relay
npm run typecheck:relay
npm run build:relay
```
