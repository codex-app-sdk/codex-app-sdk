import { contextBridge, ipcRenderer } from 'electron';
import { exposeCodexElectronPreload } from '@codex-app-sdk/electron/preload';

exposeCodexElectronPreload(contextBridge, ipcRenderer);
