import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRelayTools } from './relay-tools';
import { initializeRelayState } from './relay-store';

export function createRelayMcpServer(statePath: string): McpServer {
  const tools = createRelayTools(statePath);
  const server = new McpServer(
    { name: 'relay-operations', version: '0.1.0' },
    {
      instructions: [
        'Relay is the source of truth for the logistics exception desk.',
        'Call get_shipment before giving shipment-specific advice.',
        'Call find_recovery_options before recommending a recovery plan.',
        'Never call rebook_shipment until the user has explicitly approved a named option.',
        'After a mutation, report the committed result and the new state revision.',
      ].join(' '),
    },
  );

  server.registerTool('list_exceptions', {
    description: 'List the current logistics exceptions and dispatch-level risk metrics.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => toolResult(await tools.listExceptions()));

  server.registerTool('get_shipment', {
    description: 'Read the authoritative operational record for a shipment.',
    inputSchema: { shipmentId: z.string().describe('Shipment id such as SHP-4827') },
    annotations: { readOnlyHint: true },
  }, async ({ shipmentId }) => toolResult(await tools.getShipment(shipmentId)));

  server.registerTool('find_recovery_options', {
    description: 'Return viable recovery options with delivery time and additional cost.',
    inputSchema: { shipmentId: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ shipmentId }) => toolResult(await tools.findRecoveryOptions(shipmentId)));

  server.registerTool('draft_customer_update', {
    description: 'Draft a customer-facing shipment update grounded in the current record.',
    inputSchema: {
      shipmentId: z.string(),
      tone: z.enum(['direct', 'reassuring']).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ shipmentId, tone }) => toolResult(await tools.draftCustomerUpdate(shipmentId, tone)));

  server.registerTool('rebook_shipment', {
    description: 'Commit an approved recovery option and update the authoritative shipment state.',
    inputSchema: {
      shipmentId: z.string(),
      optionId: z.string(),
      confirmed: z.boolean().describe('Must be true only after explicit user approval'),
    },
    annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false },
  }, async ({ shipmentId, optionId, confirmed }) => {
    try {
      return toolResult(await tools.rebookShipment(shipmentId, optionId, confirmed));
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startRelayMcpServer(statePath: string): Promise<void> {
  await initializeRelayState(statePath);
  const server = createRelayMcpServer(statePath);
  await server.connect(new StdioServerTransport());
}

function toolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  const statePath = process.env.RELAY_STATE_PATH?.trim();
  if (!statePath) {
    console.error('RELAY_STATE_PATH is required');
    process.exitCode = 1;
  } else {
    void startRelayMcpServer(statePath).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
