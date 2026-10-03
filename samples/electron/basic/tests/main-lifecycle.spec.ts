// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const appHandlers = new Map<string, () => void>();
  const windows: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    static getAllWindows(): MockBrowserWindow[] {
      return [...windows];
    }

    windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    navigationHandler: ((event: { url: string; preventDefault(): void }) => void) | undefined;
    readonly webContents = {
      send: vi.fn(),
      on: vi.fn((_event: 'will-navigate', handler: (event: { url: string; preventDefault(): void }) => void) => {
        this.navigationHandler = handler;
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: 'deny' }) => {
        this.windowOpenHandler = handler;
      }),
    };
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
    clipboard: { write: vi.fn() },
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: {},
    shell: { openExternal: vi.fn(async () => undefined) },
    reset() {
      appHandlers.clear();
      windows.splice(0);
    },
    windows,
  };
});

const sdk = vi.hoisted(() => {
  const surface = { close: vi.fn(async () => undefined) };
  const backend = { close: vi.fn(async () => undefined), surface };
  return {
    createCodexAppBackend: vi.fn(() => backend),
    registerCodexElectronMain: vi.fn(() => vi.fn()),
    backend,
    surface,
  };
});

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  clipboard: electron.clipboard,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  shell: electron.shell,
}));
vi.mock('@codex-app-sdk/electron', async (importOriginal) => ({
  ...await importOriginal<typeof import('@codex-app-sdk/electron')>(),
  registerCodexElectronMain: sdk.registerCodexElectronMain,
}));
vi.mock('@codex-app-sdk/backend', () => ({
  createCodexAppBackend: sdk.createCodexAppBackend,
}));

describe('basic sample main lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electron.reset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reuses one surface and IPC registration when macOS reopens a window', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));

    electron.windows[0]!.close();
    electron.appHandlers.get('activate')?.();
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));

    expect(sdk.createCodexAppBackend).toHaveBeenCalledOnce();
    expect(sdk.createCodexAppBackend).toHaveBeenCalledWith({
      surfaceOptions: { autoSelectFirstConversation: false },
    });
    expect(sdk.registerCodexElectronMain).toHaveBeenCalledOnce();
    expect(sdk.registerCodexElectronMain).toHaveBeenCalledWith(expect.objectContaining({
      clipboard: electron.clipboard,
      dialog: electron.dialog,
      ipcMain: electron.ipcMain,
      shell: electron.shell,
      surface: sdk.surface,
      sender: { send: expect.any(Function) },
    }));
    expect(electron.windows[0]?.loadFile).toHaveBeenCalledOnce();

    electron.appHandlers.get('before-quit')?.();
    expect(sdk.registerCodexElectronMain.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(sdk.backend.close).toHaveBeenCalledOnce();
  });

  it('loads the Vite server during development', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173/');
    await import('../src/main/index');
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));

    expect(electron.windows[0]?.loadURL).toHaveBeenCalledWith('http://localhost:5173/');
    expect(electron.windows[0]?.loadFile).not.toHaveBeenCalled();
  });

  it('denies renderer-created windows and opens only allowlisted external schemes', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));
    const handler = electron.windows[0]!.windowOpenHandler!;

    expect(handler({ url: 'https://example.com/docs' })).toStrictEqual({ action: 'deny' });
    expect(handler({ url: 'mailto:team@example.com' })).toStrictEqual({ action: 'deny' });
    expect(handler({ url: 'javascript:alert(1)' })).toStrictEqual({ action: 'deny' });
    expect(handler({ url: 'file:///tmp/secret' })).toStrictEqual({ action: 'deny' });

    expect(electron.shell.openExternal).toHaveBeenCalledTimes(2);
    expect(electron.shell.openExternal).toHaveBeenNthCalledWith(1, 'https://example.com/docs');
    expect(electron.shell.openExternal).toHaveBeenNthCalledWith(2, 'mailto:team@example.com');
  });

  it('keeps the window and the Codex bridge on the development renderer', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173/');
    await import('../src/main/index');
    await vi.waitFor(() => expect(electron.windows).toHaveLength(1));
    const navigate = (url: string) => {
      const preventDefault = vi.fn();
      electron.windows[0]!.navigationHandler!({ url, preventDefault });
      return preventDefault.mock.calls.length > 0;
    };
    const { isTrustedSender } = (sdk.registerCodexElectronMain.mock.calls[0] as unknown as [{
      isTrustedSender(event: unknown): boolean;
    }])[0];

    expect(navigate('http://localhost:5173/?reload=1')).toBe(false);
    expect(navigate('https://attacker.example/')).toBe(true);
    expect(isTrustedSender({ senderFrame: { url: 'http://localhost:5173/', parent: null } })).toBe(true);
    expect(isTrustedSender({ senderFrame: { url: 'https://attacker.example/', parent: null } })).toBe(false);
  });
});
