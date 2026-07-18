import type { RelayShipment } from '../shared/relay-contracts';
import { readRelayState, updateRelayState } from './relay-store';

export function createRelayTools(statePath: string) {
  return {
    async listExceptions() {
      const snapshot = await readRelayState(statePath);
      return {
        revision: snapshot.revision,
        metrics: snapshot.metrics,
        exceptions: snapshot.shipments
          .filter((shipment) => shipment.status !== 'on-track')
          .map(shipmentSummary),
      };
    },

    async getShipment(shipmentId: string) {
      const snapshot = await readRelayState(statePath);
      return requireShipment(snapshot.shipments, shipmentId);
    },

    async findRecoveryOptions(shipmentId: string) {
      const snapshot = await readRelayState(statePath);
      const shipment = requireShipment(snapshot.shipments, shipmentId);
      return {
        shipmentId: shipment.id,
        promisedDelivery: shipment.promisedDelivery,
        currentDelayMinutes: shipment.etaDeltaMinutes,
        options: shipment.recoveryOptions,
      };
    },

    async draftCustomerUpdate(shipmentId: string, tone: 'direct' | 'reassuring' = 'reassuring') {
      const snapshot = await readRelayState(statePath);
      const shipment = requireShipment(snapshot.shipments, shipmentId);
      const opening = tone === 'direct'
        ? `Operational update for ${shipment.id}:`
        : `We wanted to share a proactive update on shipment ${shipment.id}.`;
      return {
        shipmentId: shipment.id,
        customer: shipment.customer,
        tone,
        draft: [
          opening,
          `${shipment.exception.reason} The current estimate is ${delayLabel(shipment.etaDeltaMinutes)} against the ${shipment.promisedDelivery} commitment.`,
          'Our operations team is reviewing recovery capacity now, and we will confirm the selected plan at the next milestone.',
        ].join(' '),
      };
    },

    async rebookShipment(shipmentId: string, optionId: string, confirmed: boolean) {
      if (!confirmed) {
        throw new Error('Rebooking requires explicit user confirmation. Set confirmed=true only after approval.');
      }
      let appliedOptionTitle = '';
      const snapshot = await updateRelayState(statePath, (state) => {
        const shipment = requireShipment(state.shipments, shipmentId);
        const option = shipment.recoveryOptions.find((candidate) => candidate.id === optionId);
        if (!option) throw new Error(`Unknown recovery option '${optionId}' for ${shipment.id}`);
        appliedOptionTitle = option.title;
        shipment.selectedRecoveryOptionId = option.id;
        shipment.etaDeltaMinutes = 0;
        shipment.status = 'on-track';
        shipment.exception = {
          label: 'Recovery booked',
          reason: `${option.title} was approved and booked. Expected delivery is ${option.deliveryTime}.`,
          detectedAt: new Date().toISOString(),
        };
        shipment.checkpoints = shipment.checkpoints.map((checkpoint) => (
          checkpoint.status === 'blocked'
            ? { ...checkpoint, status: 'complete', time: 'Cleared' }
            : checkpoint.label === 'Delivery'
              ? { ...checkpoint, time: option.deliveryTime }
              : checkpoint
        ));
      });
      return {
        shipment: requireShipment(snapshot.shipments, shipmentId),
        result: `${appliedOptionTitle} is booked and the Relay operations view can refresh.`,
        revision: snapshot.revision,
      };
    },
  };
}

function requireShipment(shipments: readonly RelayShipment[], shipmentId: string): RelayShipment {
  const shipment = shipments.find((candidate) => candidate.id === shipmentId);
  if (!shipment) throw new Error(`Unknown shipment '${shipmentId}'`);
  return shipment;
}

function shipmentSummary(shipment: RelayShipment) {
  return {
    id: shipment.id,
    route: `${shipment.origin} → ${shipment.destination}`,
    customer: shipment.customer,
    customerTier: shipment.customerTier,
    etaDeltaMinutes: shipment.etaDeltaMinutes,
    promisedDelivery: shipment.promisedDelivery,
    status: shipment.status,
    exception: shipment.exception,
  };
}

function delayLabel(delayMinutes: number): string {
  if (delayMinutes === 0) return 'on time';
  const hours = Math.round(delayMinutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} late`;
}
