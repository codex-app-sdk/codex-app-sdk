import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createRelaySeedState,
  relaySnapshot,
  type RelaySnapshot,
  type RelayState,
} from '../shared/relay-contracts';

let operationTail = Promise.resolve();

export async function initializeRelayState(statePath: string): Promise<RelaySnapshot> {
  await mkdir(path.dirname(statePath), { recursive: true });
  try {
    const handle = await open(statePath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(createRelaySeedState(), null, 2), 'utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
  }
  return readRelayState(statePath);
}

export async function readRelayState(statePath: string): Promise<RelaySnapshot> {
  const parsed: unknown = JSON.parse(await readFile(statePath, 'utf8'));
  if (!isRelayState(parsed)) throw new Error(`Relay state at ${statePath} has an invalid shape`);
  return relaySnapshot(parsed);
}

export function updateRelayState(
  statePath: string,
  update: (state: RelayState) => RelayState | void,
): Promise<RelaySnapshot> {
  const operation = operationTail.then(async () => {
    const snapshot = await readRelayState(statePath);
    const mutableState = toState(snapshot);
    const nextState = update(mutableState) ?? mutableState;
    nextState.revision = snapshot.revision + 1;
    nextState.updatedAt = new Date().toISOString();
    await writeRelayState(statePath, nextState);
    return relaySnapshot(nextState);
  });
  operationTail = operation.then(() => undefined, () => undefined);
  return operation;
}

export function resetRelayState(statePath: string): Promise<RelaySnapshot> {
  const operation = operationTail.then(async () => {
    const state = createRelaySeedState();
    await writeRelayState(statePath, state);
    return relaySnapshot(state);
  });
  operationTail = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function writeRelayState(statePath: string, state: RelayState): Promise<void> {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function toState(snapshot: RelaySnapshot): RelayState {
  const { metrics: _metrics, ...state } = snapshot;
  return state;
}

function isRelayState(value: unknown): value is RelayState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RelayState>;
  return candidate.version === 1
    && typeof candidate.revision === 'number'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.totalActiveShipments === 'number'
    && Array.isArray(candidate.shipments)
    && candidate.shipments.every((shipment) => (
      shipment
      && typeof shipment.id === 'string'
      && Array.isArray(shipment.checkpoints)
      && Array.isArray(shipment.recoveryOptions)
    ));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
