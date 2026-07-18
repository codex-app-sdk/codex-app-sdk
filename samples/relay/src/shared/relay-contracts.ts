export type RelayShipmentStatus = 'on-track' | 'at-risk' | 'critical';
export type RelayCheckpointStatus = 'complete' | 'blocked' | 'upcoming';
export type RelayAction = 'investigate' | 'compare-recovery' | 'draft-update';

export type RelayCheckpoint = {
  label: string;
  time: string;
  status: RelayCheckpointStatus;
};

export type RelayRecoveryOption = {
  id: string;
  title: string;
  description: string;
  deliveryTime: string;
  additionalCostUsd: number;
};

export type RelayShipment = {
  id: string;
  origin: string;
  destination: string;
  customer: string;
  customerTier: 'Platinum' | 'Gold' | 'Standard';
  promisedDelivery: string;
  cargoValueUsd: number;
  etaDeltaMinutes: number;
  status: RelayShipmentStatus;
  exception: {
    label: string;
    reason: string;
    detectedAt: string;
  };
  checkpoints: RelayCheckpoint[];
  recoveryOptions: RelayRecoveryOption[];
  selectedRecoveryOptionId?: string;
};

export type RelayState = {
  version: 1;
  revision: number;
  updatedAt: string;
  totalActiveShipments: number;
  shipments: RelayShipment[];
};

export type RelaySnapshot = RelayState & {
  metrics: {
    onTimePercent: number;
    atRisk: number;
    critical: number;
  };
};

export type RelayOperationsRendererApi = {
  getSnapshot(): Promise<RelaySnapshot>;
};

export const RELAY_SNAPSHOT_CHANNEL = 'relay-operations:get-snapshot';

export function relaySnapshot(state: RelayState): RelaySnapshot {
  const atRisk = state.shipments.filter((shipment) => shipment.status === 'at-risk').length;
  const critical = state.shipments.filter((shipment) => shipment.status === 'critical').length;
  const onTime = Math.max(0, state.totalActiveShipments - atRisk - critical);
  return {
    ...state,
    shipments: state.shipments.map(cloneShipment),
    metrics: {
      onTimePercent: Math.round((onTime / state.totalActiveShipments) * 100),
      atRisk: atRisk + critical,
      critical,
    },
  };
}

export function createRelaySeedState(): RelayState {
  return {
    version: 1,
    revision: 1,
    updatedAt: '2026-07-18T10:15:00.000Z',
    totalActiveShipments: 22,
    shipments: [
      {
        id: 'SHP-4827',
        origin: 'Chicago',
        destination: 'Dallas',
        customer: 'Northstar Medical',
        customerTier: 'Platinum',
        promisedDelivery: '17:00',
        cargoValueUsd: 84_000,
        etaDeltaMinutes: 360,
        status: 'critical',
        exception: {
          label: 'Customs hold',
          reason: 'The shipment was selected for a customs inspection at the Chicago terminal.',
          detectedAt: '08:42',
        },
        checkpoints: [
          { label: 'Pickup', time: '06:10', status: 'complete' },
          { label: 'Chicago', time: '08:42', status: 'complete' },
          { label: 'Customs hold', time: 'Now', status: 'blocked' },
          { label: 'Delivery', time: '17:00', status: 'upcoming' },
        ],
        recoveryOptions: [
          {
            id: 'expedited-air',
            title: 'Expedited air',
            description: 'Move the shipment from Chicago to Dallas on the 14:55 priority flight.',
            deliveryTime: '17:00',
            additionalCostUsd: 1_250,
          },
          {
            id: 'team-driver',
            title: 'Team driver',
            description: 'Keep the current linehaul and add a two-driver team for the final leg.',
            deliveryTime: '19:00',
            additionalCostUsd: 480,
          },
        ],
      },
      {
        id: 'SHP-7152',
        origin: 'Atlanta',
        destination: 'Denver',
        customer: 'Aperture Retail',
        customerTier: 'Gold',
        promisedDelivery: '20:00',
        cargoValueUsd: 41_500,
        etaDeltaMinutes: 120,
        status: 'at-risk',
        exception: {
          label: 'Weather reroute',
          reason: 'Severe storms closed the planned Memphis transfer lane.',
          detectedAt: '09:18',
        },
        checkpoints: [
          { label: 'Pickup', time: '05:30', status: 'complete' },
          { label: 'Atlanta', time: '07:50', status: 'complete' },
          { label: 'Memphis', time: 'Rerouted', status: 'blocked' },
          { label: 'Delivery', time: '20:00', status: 'upcoming' },
        ],
        recoveryOptions: [
          {
            id: 'nashville-transfer',
            title: 'Nashville transfer',
            description: 'Reroute through Nashville using available partner capacity.',
            deliveryTime: '20:45',
            additionalCostUsd: 310,
          },
        ],
      },
      {
        id: 'SHP-2190',
        origin: 'Los Angeles',
        destination: 'Seattle',
        customer: 'Juniper Home',
        customerTier: 'Standard',
        promisedDelivery: '18:30',
        cargoValueUsd: 18_900,
        etaDeltaMinutes: 60,
        status: 'at-risk',
        exception: {
          label: 'Terminal dwell',
          reason: 'The trailer has exceeded its expected dwell time at the Portland terminal.',
          detectedAt: '09:47',
        },
        checkpoints: [
          { label: 'Pickup', time: '04:20', status: 'complete' },
          { label: 'Portland', time: '09:47', status: 'blocked' },
          { label: 'Seattle', time: '17:55', status: 'upcoming' },
          { label: 'Delivery', time: '18:30', status: 'upcoming' },
        ],
        recoveryOptions: [
          {
            id: 'priority-unload',
            title: 'Priority unload',
            description: 'Move the trailer to the priority dock and retain the current driver.',
            deliveryTime: '18:45',
            additionalCostUsd: 125,
          },
        ],
      },
    ],
  };
}

function cloneShipment(shipment: RelayShipment): RelayShipment {
  return {
    ...shipment,
    exception: { ...shipment.exception },
    checkpoints: shipment.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    recoveryOptions: shipment.recoveryOptions.map((option) => ({ ...option })),
  };
}
