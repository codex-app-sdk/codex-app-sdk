<template>
  <header class="operations-board__header">
    <div class="relay-brand">
      <span class="relay-brand__mark" aria-hidden="true">R</span>
      <div>
        <strong>Relay</strong>
        <span>Dispatch desk</span>
      </div>
    </div>

    <dl class="operations-metrics" aria-label="Dispatch metrics">
      <div>
        <dt>On time</dt>
        <dd>{{ snapshot.metrics.onTimePercent }}%</dd>
      </div>
      <div class="operations-metrics__risk">
        <dt>At risk</dt>
        <dd>{{ snapshot.metrics.atRisk }}</dd>
      </div>
      <div class="operations-metrics__critical">
        <dt>Critical</dt>
        <dd>{{ snapshot.metrics.critical }}</dd>
      </div>
    </dl>

    <button v-if="accountLabel" class="relay-account" type="button" @click="emit('sign-out')">
      <span>{{ accountLabel }}</span>
      <small>Sign out</small>
    </button>
  </header>

  <section class="operations-board__workspace" aria-label="Relay dispatch desk">
    <aside class="exception-queue" aria-label="Exception queue">
      <div class="exception-queue__heading">
        <strong>Exception queue</strong>
        <span>Live · revision {{ snapshot.revision }}</span>
      </div>
      <button
        v-for="shipment in snapshot.shipments"
        :key="shipment.id"
        type="button"
        class="exception-row"
        :class="[
          `exception-row--${shipment.status}`,
          { 'exception-row--selected': shipment.id === selectedShipment.id },
        ]"
        :aria-current="shipment.id === selectedShipment.id ? 'true' : undefined"
        @click="emit('select', shipment.id)"
      >
        <span>
          <strong>{{ shipment.id }}</strong>
          <small>{{ shipment.origin }} → {{ shipment.destination }}</small>
        </span>
        <span class="exception-row__detail">
          <strong>{{ etaLabel(shipment) }}</strong>
          <small>{{ shipment.exception.label }}</small>
        </span>
      </button>
    </aside>

    <article class="shipment-focus" :class="`shipment-focus--${selectedShipment.status}`">
      <div class="shipment-focus__heading">
        <span>Issue detail</span>
        <small>{{ selectedShipment.exception.label }}</small>
      </div>

      <div class="shipment-focus__summary">
        <div>
          <span class="shipment-focus__id">{{ selectedShipment.id }}</span>
          <strong>{{ selectedShipment.origin }} → {{ selectedShipment.destination }}</strong>
        </div>
        <div class="shipment-focus__badges">
          <span class="shipment-badge shipment-badge--delay">{{ etaLabel(selectedShipment) }}</span>
          <span class="shipment-badge shipment-badge--sla">{{ selectedShipment.customerTier }} SLA</span>
        </div>
      </div>

      <section class="shipment-route" aria-label="Shipment route progress">
        <div class="shipment-route__heading">
          <strong>Route progress</strong>
          <span>
            {{ completedCheckpointCount(selectedShipment) }} of
            {{ selectedShipment.checkpoints.length }} complete
          </span>
        </div>

        <ol class="shipment-timeline">
          <li
            v-for="(checkpoint, index) in selectedShipment.checkpoints"
            :key="checkpoint.label"
            :class="`shipment-timeline__checkpoint--${checkpoint.status}`"
          >
            <span class="shipment-timeline__marker" aria-hidden="true">
              {{ checkpointMarker(checkpoint.status, index) }}
            </span>
            <div class="shipment-timeline__body">
              <div class="shipment-timeline__summary">
                <strong>{{ checkpoint.label }}</strong>
                <span class="shipment-timeline__status">{{ checkpointStatusLabel(checkpoint.status) }}</span>
                <small>{{ checkpoint.time }}</small>
              </div>
              <div v-if="checkpoint.status === 'blocked'" class="shipment-timeline__exception">
                <p>{{ selectedShipment.exception.reason }}</p>
                <span>Detected {{ selectedShipment.exception.detectedAt }}</span>
              </div>
            </div>
          </li>
        </ol>

        <footer class="shipment-route__impact" aria-label="Shipment exposure">
          <span>Shipment exposure</span>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>{{ selectedShipment.customer }}</dd>
            </div>
            <div>
              <dt>Cargo value</dt>
              <dd>{{ cargoValueLabel(selectedShipment) }}</dd>
            </div>
            <div>
              <dt>Commitment</dt>
              <dd>{{ selectedShipment.promisedDelivery }}</dd>
            </div>
          </dl>
        </footer>
      </section>

      <div class="shipment-actions" aria-label="Ask Relay about this shipment">
        <button type="button" :disabled="actionPending" @click="emit('action', 'investigate', selectedShipment)">
          {{ selectedShipment.status === 'on-track' ? 'Review recovery' : 'Investigate delay' }}
        </button>
        <button type="button" :disabled="actionPending" @click="emit('action', 'compare-recovery', selectedShipment)">
          Compare recovery
        </button>
        <button type="button" :disabled="actionPending" @click="emit('action', 'draft-update', selectedShipment)">
          Draft update
        </button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import type {
  RelayAction,
  RelayCheckpointStatus,
  RelayShipment,
  RelaySnapshot,
} from '../../shared/relay-contracts';

defineProps<{
  accountLabel?: string;
  actionPending?: boolean;
  selectedShipment: RelayShipment;
  snapshot: RelaySnapshot;
}>();

const emit = defineEmits<{
  action: [action: RelayAction, shipment: RelayShipment];
  select: [shipmentId: string];
  'sign-out': [];
}>();

function etaLabel(shipment: RelayShipment): string {
  if (shipment.etaDeltaMinutes === 0) return 'On time';
  const hours = Math.round(shipment.etaDeltaMinutes / 60);
  return `ETA +${hours}h`;
}

function cargoValueLabel(shipment: RelayShipment): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(shipment.cargoValueUsd);
}

function completedCheckpointCount(shipment: RelayShipment): number {
  return shipment.checkpoints.filter((checkpoint) => checkpoint.status === 'complete').length;
}

function checkpointMarker(status: RelayCheckpointStatus, index: number): string {
  if (status === 'complete') return '✓';
  if (status === 'blocked') return '!';
  return String(index + 1);
}

function checkpointStatusLabel(status: RelayCheckpointStatus): string {
  if (status === 'complete') return 'Completed';
  if (status === 'blocked') return 'Active issue';
  return 'Scheduled';
}
</script>
