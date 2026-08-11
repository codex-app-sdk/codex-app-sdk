import { contextBridge, ipcRenderer } from 'electron';
import { exposeCodexElectronPreload } from '@codex-app-sdk/electron/preload';
import {
  RELAY_RESET_CHANNEL,
  RELAY_SNAPSHOT_CHANNEL,
  type RelayOperationsRendererApi,
} from '../shared/relay-contracts';

exposeCodexElectronPreload(contextBridge, ipcRenderer);

const relayOperations: RelayOperationsRendererApi = {
  getSnapshot: () => ipcRenderer.invoke(RELAY_SNAPSHOT_CHANNEL),
  resetDemo: () => ipcRenderer.invoke(RELAY_RESET_CHANNEL),
};
contextBridge.exposeInMainWorld('relayOperations', relayOperations);
