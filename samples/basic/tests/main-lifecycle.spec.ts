// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const appHandlers = new Map<string, () => void>();
  const windows: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    static getAllWindows(): MockBrowserWindow[] {
      return [...windows];
    }

    readonly webContents = { send: vi.fn() };
    readonly loadFile = vi.fn(async () => undefined);
    readonly loadURL = vi.fn(async () => undefined);
    readonly handlers = new Map<string, () => void>();

    constructor(_options: unknown) {
      windows.push(this);
    }

    on(event: string, listener: () => void): void {
      this.handlers.set(event, listener);
    }

    close(): void {
      windows.splice(windows.indexOf(this), 1);
      this.handlers.get('closed')?.();
    }
  }

  return {
    app: {
      whenReady: vi.fn(async () => undefined),
      on: vi.fn((event: string, listener: () => void) => appHandlers.set(event, listener)),
      quit: vi.fn(),
    },
    appHandlers,
    BrowserWindow: MockBrowserWindow,
    ipcMain: {},
    reset() {
      appHandlers.clear();
      windows.splice(0);
    },
    windows,
  };
});

const sdk = vi.hoisted(() => {
  const surface = { close: vi.fn(async () => undefined) };
  return {
    createCodexSurface: vi.fn(() => surface),
    registerCodexSurfaceIpc: vi.fn(() => vi.fn()),
    surface,
  };
});

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  ipcMain: electron.ipcMain,
}));
vi.mock('codex-app-sdk/electron', () => ({
  registerCodexSurfaceIpc: sdk.registerCodexSurfaceIpc,
}));
vi.mock('codex-app-sdk/node', () => ({
  createCodexSurface: sdk.createCodexSurface,
}));

describe('basic sample main lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electron.reset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reuses one surface and IPC registration when macOS reopens a window', async () => {
    await import('../electron/main');
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));

    electron.windows[0]!.close();
    electron.appHandlers.get('activate')?.();
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));

    expect(sdk.createCodexSurface).toHaveBeenCalledOnce();
    expect(sdk.createCodexSurface).toHaveBeenCalledWith({
      clientInfo: { name: 'codex_sdk_basic_sample', title: 'Codex SDK Basic Sample', version: '0.1.0' },
    });
    expect(sdk.registerCodexSurfaceIpc).toHaveBeenCalledOnce();
    expect(electron.windows[0]?.loadFile).toHaveBeenCalledOnce();

    electron.appHandlers.get('before-quit')?.();
    expect(sdk.registerCodexSurfaceIpc.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(sdk.surface.close).toHaveBeenCalledOnce();
  });

  it('loads the Vite server during development', async () => {
    vi.stubEnv('CODEX_SAMPLE_RENDERER_URL', 'http://127.0.0.1:5173/');
    await import('../electron/main');
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));

    expect(electron.windows[0]?.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/');
    expect(electron.windows[0]?.loadFile).not.toHaveBeenCalled();
  });
});
