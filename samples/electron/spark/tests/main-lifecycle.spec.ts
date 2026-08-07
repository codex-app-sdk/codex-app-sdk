// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, () => void>();
  const windows: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    static getAllWindows(): MockBrowserWindow[] {
      return [...windows];
    }

    readonly navigationHandlers = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    readonly webContents = {
      send: vi.fn(),
      on: vi.fn((event: string, listener: (event: { preventDefault(): void }, url: string) => void) => {
        this.navigationHandlers.set(event, listener);
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

  const surface = { close: vi.fn(async () => undefined) };
  return {
    app: {
      getPath: vi.fn((name: string) => name === 'home' ? '/tmp/spark-home' : '/tmp/spark-user-data'),
      on: vi.fn((event: string, listener: () => void) => appHandlers.set(event, listener)),
      quit: vi.fn(),
      setName: vi.fn(),
      whenReady: vi.fn(async () => undefined),
    },
    appHandlers,
    BrowserWindow: MockBrowserWindow,
    clipboard: { write: vi.fn() },
    createCodexSurface: vi.fn((_options?: unknown) => surface),
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: {},
    mkdir: vi.fn(async () => undefined),
    registerCodexElectronMain: vi.fn(() => vi.fn()),
    reset() {
      appHandlers.clear();
      windows.splice(0);
    },
    shell: { openExternal: vi.fn(async () => undefined) },
    surface,
    windows,
  };
});

vi.mock('node:fs/promises', () => ({ mkdir: mocks.mkdir }));
vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  clipboard: mocks.clipboard,
  dialog: mocks.dialog,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell,
}));
vi.mock('@codex-app-sdk/electron', () => ({
  registerCodexElectronMain: mocks.registerCodexElectronMain,
}));
vi.mock('@codex-app-sdk/backend', () => ({
  createCodexSurface: mocks.createCodexSurface,
}));

describe('Spark sample main lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.reset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('starts one surface with an isolated Codex home, workspace, and kid-safe defaults', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));

    expect(mocks.app.setName).toHaveBeenCalledWith('Spark');
    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/spark-home/.codex-spark', { recursive: true });
    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/spark-user-data/workspace', { recursive: true });
    expect(mocks.createCodexSurface).toHaveBeenCalledWith(expect.objectContaining({
      approvalMode: 'never',
      clientInfo: { name: 'spark', title: 'Spark', version: '0.1.0' },
      codexHome: '/tmp/spark-home/.codex-spark',
      conversationDefaults: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
      cwd: '/tmp/spark-user-data/workspace',
      permissionMode: 'read-only',
    }));
    const options = mocks.createCodexSurface.mock.calls[0]![0] as {
      extensions: Array<{ configureConversation(): { developerInstructions: string } }>;
    };
    const configuration = options.extensions[0]!.configureConversation();
    expect(configuration.developerInstructions).toContain('assistant for children ages 8 to 12');
  });

  it('reuses the surface on macOS reopen and closes it before quit', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));

    mocks.windows[0]!.close();
    mocks.appHandlers.get('activate')?.();
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));
    expect(mocks.createCodexSurface).toHaveBeenCalledOnce();
    expect(mocks.registerCodexElectronMain).toHaveBeenCalledOnce();

    mocks.appHandlers.get('before-quit')?.();
    expect(mocks.registerCodexElectronMain.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(mocks.surface.close).toHaveBeenCalledOnce();
  });

  it('opens only https links outside the sandboxed renderer', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));
    const handler = mocks.windows[0]!.windowOpenHandler!;

    expect(handler({ url: 'https://example.com/sign-in' })).toStrictEqual({ action: 'deny' });
    expect(handler({ url: 'http://example.com/insecure' })).toStrictEqual({ action: 'deny' });
    expect(handler({ url: 'javascript:alert(1)' })).toStrictEqual({ action: 'deny' });
    expect(mocks.shell.openExternal).toHaveBeenCalledOnce();
    expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://example.com/sign-in');
  });
});
