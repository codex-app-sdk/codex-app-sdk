import type { RelayAction, RelayShipment } from './relay-contracts';

const actionDetails: Record<RelayAction, { label: string; outcome: string }> = {
  investigate: {
    label: 'Investigate delay',
    outcome: 'Investigate the exception, identify the operational cause, and tell me what needs attention first.',
  },
  'compare-recovery': {
    label: 'Compare recovery',
    outcome: 'Compare the viable recovery options, including delivery time, cost, SLA impact, and operational risk.',
  },
  'draft-update': {
    label: 'Draft customer update',
    outcome: 'Draft a concise customer update that explains the situation, what we are doing, and the next expected milestone.',
  },
};

export function buildRelayPrompt(action: RelayAction, shipment: RelayShipment): string {
  const details = action === 'investigate' && shipment.status === 'on-track'
    ? {
      label: 'Review recovery',
      outcome: 'Review the committed recovery, verify the new delivery expectation, and flag any remaining operational risk.',
    }
    : actionDetails[action];
  const etaLabel = shipment.etaDeltaMinutes === 0
    ? 'on time'
    : `ETA +${Math.round(shipment.etaDeltaMinutes / 60)}h`;
  const clickReason = shipment.status === 'on-track'
    ? `${shipment.exception.label.toLowerCase()} is now the active recovery state`
    : `${shipment.exception.label.toLowerCase()} has put its ${shipment.customerTier} SLA at risk`;
  return [
    `I clicked “${details.label}” for ${shipment.id} because ${clickReason}.`,
    '',
    `What I can currently see: ${shipment.origin} → ${shipment.destination}; ${etaLabel}; ${shipment.exception.reason} Last event: ${shipment.exception.detectedAt}. Promised delivery: ${shipment.promisedDelivery}. Cargo value: $${shipment.cargoValueUsd.toLocaleString('en-US')}. Customer: ${shipment.customer}.`,
    '',
    details.outcome,
    'Use the Relay MCP tools to retrieve the current operational record before answering. Treat the visible snapshot above as the reason for my click, not as authoritative live state. Do not commit a recovery action unless I explicitly approve it.',
  ].join('\n');
}
