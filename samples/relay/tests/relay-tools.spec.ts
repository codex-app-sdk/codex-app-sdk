// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRelayTools } from '../src/mcp/relay-tools';
import { initializeRelayState } from '../src/mcp/relay-store';

describe('Relay MCP tools', () => {
  let directory = '';
  let statePath = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'relay-mcp-test-'));
    statePath = path.join(directory, 'operations.json');
    await initializeRelayState(statePath);
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('reads authoritative exception, shipment, recovery, and customer context', async () => {
    const tools = createRelayTools(statePath);

    const exceptions = await tools.listExceptions();
    expect(exceptions.metrics).toStrictEqual({ onTimePercent: 86, atRisk: 3, critical: 1 });
    expect(exceptions.exceptions.map((shipment) => shipment.id)).toStrictEqual([
      'SHP-4827',
      'SHP-7152',
      'SHP-2190',
    ]);

    const shipment = await tools.getShipment('SHP-4827');
    expect(shipment.exception).toStrictEqual({
      label: 'Customs hold',
      reason: 'The shipment was selected for a customs inspection at the Chicago terminal.',
      detectedAt: '08:42',
    });

    const recovery = await tools.findRecoveryOptions('SHP-4827');
    expect(recovery.options.map((option) => [option.id, option.additionalCostUsd])).toStrictEqual([
      ['expedited-air', 1_250],
      ['team-driver', 480],
    ]);

    const update = await tools.draftCustomerUpdate('SHP-4827', 'direct');
    expect(update.customer).toBe('Northstar Medical');
    expect(update.draft).toContain('Operational update for SHP-4827:');
    expect(update.draft).toContain('6 hours late');
  });

  it('rejects unconfirmed recovery mutations without changing the persisted state', async () => {
    const tools = createRelayTools(statePath);
    const before = await readFile(statePath, 'utf8');

    await expect(tools.rebookShipment('SHP-4827', 'expedited-air', false))
      .rejects.toThrow('explicit user confirmation');
    expect(await readFile(statePath, 'utf8')).toBe(before);
  });

  it('atomically commits an approved recovery and updates business metrics', async () => {
    const tools = createRelayTools(statePath);

    const result = await tools.rebookShipment('SHP-4827', 'expedited-air', true);

    expect(result.revision).toBe(2);
    expect(result.shipment).toMatchObject({
      id: 'SHP-4827',
      status: 'on-track',
      etaDeltaMinutes: 0,
      selectedRecoveryOptionId: 'expedited-air',
      exception: { label: 'Recovery booked' },
    });
    const exceptions = await tools.listExceptions();
    expect(exceptions.metrics).toStrictEqual({ onTimePercent: 91, atRisk: 2, critical: 0 });
    expect(exceptions.exceptions.map((shipment) => shipment.id)).not.toContain('SHP-4827');
  });

  it('fails closed for unknown shipments and recovery options', async () => {
    const tools = createRelayTools(statePath);

    await expect(tools.getShipment('SHP-0000')).rejects.toThrow("Unknown shipment 'SHP-0000'");
    await expect(tools.rebookShipment('SHP-4827', 'missing', true))
      .rejects.toThrow("Unknown recovery option 'missing'");
  });
});
