import { describe, expect, it } from 'vitest';
import { buildRelayPrompt } from '../src/shared/relay-prompts';
import { relayOperationsSnapshot } from './fakes';

describe('Relay contextual prompts', () => {
  const shipment = relayOperationsSnapshot().shipments[0]!;

  it('preserves the exact click intent and visible business context', () => {
    const prompt = buildRelayPrompt('compare-recovery', shipment);

    expect(prompt).toContain('I clicked “Compare recovery” for SHP-4827');
    expect(prompt).toContain('Chicago → Dallas');
    expect(prompt).toContain('ETA +6h');
    expect(prompt).toContain('Northstar Medical');
    expect(prompt).toContain('Cargo value: $84,000');
    expect(prompt).toContain('Use the Relay MCP tools to retrieve the current operational record');
    expect(prompt).toContain('Do not commit a recovery action unless I explicitly approve it');
  });

  it.each([
    ['investigate', 'Investigate the exception'],
    ['compare-recovery', 'Compare the viable recovery options'],
    ['draft-update', 'Draft a concise customer update'],
  ] as const)('gives the %s action a concrete outcome', (action, expected) => {
    expect(buildRelayPrompt(action, shipment)).toContain(expected);
  });

  it('keeps the click label and intent accurate after an MCP recovery mutation', () => {
    const recovered = {
      ...shipment,
      status: 'on-track' as const,
      etaDeltaMinutes: 0,
      exception: {
        label: 'Recovery booked',
        reason: 'Expedited air was approved and booked.',
        detectedAt: '2026-07-18T10:20:00.000Z',
      },
    };

    const prompt = buildRelayPrompt('investigate', recovered);
    expect(prompt).toContain('I clicked “Review recovery” for SHP-4827');
    expect(prompt).toContain('recovery booked is now the active recovery state');
    expect(prompt).toContain('verify the new delivery expectation');
  });
});
