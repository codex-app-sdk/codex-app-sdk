import { contextBridge, ipcRenderer } from 'electron';
import { createCodexSurfaceRendererApi } from 'codex-app-sdk/electron';

contextBridge.exposeInMainWorld('codexSurface', createCodexSurfaceRendererApi(ipcRenderer));
