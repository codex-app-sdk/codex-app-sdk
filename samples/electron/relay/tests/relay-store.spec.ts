// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRelayTools } from '../src/mcp/relay-tools';
import { initializeRelayState, resetRelayState } from '../src/mcp/relay-store';

describe('Relay operations store', () => {
  let directory = '';
  let statePath = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'relay-store-test-'));
    statePath = path.join(directory, 'operations.json');
    await initializeRelayState(statePath);
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('atomically restores the complete seeded demo after a shipment mutation', async () => {
    await createRelayTools(statePath).rebookShipment('SHP-4827', 'expedited-air', true);

    const reset = await resetRelayState(statePath);

    expect(reset).toMatchObject({
      revision: 1,
      updatedAt: '2026-07-18T10:15:00.000Z',
      metrics: { onTimePercent: 86, atRisk: 3, critical: 1 },
    });
    expect(reset.shipments.find((shipment) => shipment.id === 'SHP-4827')).toMatchObject({
      status: 'critical',
      etaDeltaMinutes: 360,
      exception: { label: 'Customs hold' },
    });
    expect(reset.shipments.find((shipment) => shipment.id === 'SHP-4827'))
      .not.toHaveProperty('selectedRecoveryOptionId');
  });
});
