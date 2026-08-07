import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNative: vi.fn(() => ({ capabilities: {} })),
  createSurface: vi.fn(() => ({ connect: vi.fn() })),
  disposeNative: vi.fn(),
  disposeSurface: vi.fn(),
  registerNative: vi.fn(() => mocks.disposeNative),
  registerSurface: vi.fn(() => mocks.disposeSurface),
}));

vi.mock('../packages/electron/src/codex-native-ipc', () => ({
  registerCodexNativeIpc: mocks.registerNative,
}));
vi.mock('../packages/electron/src/codex-native-renderer', () => ({
  createCodexNativeRendererApi: mocks.createNative,
}));
vi.mock('../packages/electron/src/codex-surface-ipc', () => ({
  createCodexSurfaceRendererApi: mocks.createSurface,
  registerCodexSurfaceIpc: mocks.registerSurface,
}));

import { registerCodexElectronMain } from '../packages/electron/src/codex-electron-integration';
import { exposeCodexElectronPreload } from '../packages/electron/src/codex-electron-preload';

describe('combined Electron integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers and disposes surface and native main-process bridges together', () => {
    const options = {
      clipboard: {}, dialog: {}, ipcMain: {}, sender: {}, shell: {}, surface: {},
      native: { maxAudioBytes: 42 },
    };

    const dispose = registerCodexElectronMain(options as never);

    expect(mocks.registerSurface).toHaveBeenCalledWith(options.ipcMain, options.sender, options.surface);
    expect(mocks.registerNative).toHaveBeenCalledWith(options, options.native);
    dispose();
    expect(mocks.disposeNative).toHaveBeenCalledOnce();
    expect(mocks.disposeSurface).toHaveBeenCalledOnce();
  });

  it('rolls back the surface bridge if native registration fails', () => {
    mocks.registerNative.mockImplementationOnce(() => { throw new Error('native failed'); });

    expect(() => registerCodexElectronMain({
      clipboard: {}, dialog: {}, ipcMain: {}, sender: {}, shell: {}, surface: {},
    } as never)).toThrow('native failed');
    expect(mocks.disposeSurface).toHaveBeenCalledOnce();
  });

  it('exposes both renderer APIs from one preload call', () => {
    const contextBridge = { exposeInMainWorld: vi.fn() };
    const ipcRenderer = {};

    const apis = exposeCodexElectronPreload(contextBridge, ipcRenderer as never, { transcription: false });

    expect(mocks.createSurface).toHaveBeenCalledWith(ipcRenderer);
    expect(mocks.createNative).toHaveBeenCalledWith(ipcRenderer, { transcription: false });
    expect(contextBridge.exposeInMainWorld).toHaveBeenNthCalledWith(1, 'codexSurface', apis.surface);
    expect(contextBridge.exposeInMainWorld).toHaveBeenNthCalledWith(2, 'codexAppSdkNative', apis.native);
  });
});
