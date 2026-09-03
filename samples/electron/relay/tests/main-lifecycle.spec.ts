// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_RESET_CHANNEL, RELAY_SNAPSHOT_CHANNEL } from '../src/shared/relay-contracts';
import { relayOperationsSnapshot } from './fakes';

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, () => void>();
  const ipcHandlers = new Map<string, () => unknown>();
  const windows: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    static getAllWindows(): MockBrowserWindow[] {
      return [...windows];
    }

    windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    readonly webContents = {
      send: vi.fn(),
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
  const readRelayState = vi.fn(async (_statePath: string) => relayOperationsSnapshot());
  const resetRelayState = vi.fn(async (_statePath: string) => relayOperationsSnapshot());
  const backend = {
    close: vi.fn(async () => undefined),
    module: vi.fn(() => ({
      readSnapshot: () => readRelayState('/tmp/relay-user-data/relay-operations.json'),
      resetDemo: () => resetRelayState('/tmp/relay-user-data/relay-operations.json'),
    })),
    surface,
  };
  return {
    app: {
      getPath: vi.fn((name: string) => name === 'home' ? '/tmp/relay-home' : '/tmp/relay-user-data'),
      on: vi.fn((event: string, listener: () => void) => appHandlers.set(event, listener)),
      quit: vi.fn(),
      setName: vi.fn(),
      whenReady: vi.fn(async () => undefined),
    },
    appHandlers,
    BrowserWindow: MockBrowserWindow,
    clipboard: { write: vi.fn() },
    createCodexAppBackend: vi.fn((_options?: unknown) => backend),
    dialog: { showOpenDialog: vi.fn() },
    initializeRelayState: vi.fn(async () => relayOperationsSnapshot()),
    ipcHandlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: () => unknown) => ipcHandlers.set(channel, handler)),
      removeHandler: vi.fn((channel: string) => ipcHandlers.delete(channel)),
    },
    mkdir: vi.fn(async () => undefined),
    readRelayState,
    resetRelayState,
    registerCodexElectronMain: vi.fn(() => vi.fn()),
    reset() {
      appHandlers.clear();
      ipcHandlers.clear();
      windows.splice(0);
    },
    shell: { openExternal: vi.fn(async () => undefined) },
    surface,
    backend,
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
  createCodexAppBackend: mocks.createCodexAppBackend,
}));
vi.mock('../src/mcp/relay-store', () => ({
  initializeRelayState: mocks.initializeRelayState,
  readRelayState: mocks.readRelayState,
  resetRelayState: mocks.resetRelayState,
}));

describe('Relay sample main lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.reset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('owns one isolated surface with typed stdio MCP configuration', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));

    expect(mocks.app.setName).toHaveBeenCalledWith('Relay');
    expect(mocks.initializeRelayState).toHaveBeenCalledWith('/tmp/relay-user-data/relay-operations.json');
    expect(mocks.createCodexAppBackend).toHaveBeenCalledWith(expect.objectContaining({
      surfaceOptions: expect.objectContaining({
        approvalPreset: 'ask-for-approval',
        autoSelectFirstConversation: true,
        clientInfo: { name: 'relay', title: 'Relay', version: '0.1.0' },
        codexHome: '/tmp/relay-home/.codex-relay',
        conversationLimit: 1,
        cwd: '/tmp/relay-user-data/workspace',
        permissionMode: 'read-only',
        mcpServers: [expect.objectContaining({
          name: 'relay',
          required: true,
          toolApprovalMode: 'writes',
          enabledTools: [
            'list_exceptions',
            'get_shipment',
            'find_recovery_options',
            'draft_customer_update',
            'rebook_shipment',
          ],
          transport: expect.objectContaining({
            type: 'stdio',
            command: process.execPath,
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              RELAY_STATE_PATH: '/tmp/relay-user-data/relay-operations.json',
            },
          }),
        })],
      }),
      modules: [expect.objectContaining({ id: 'relay.operations', create: expect.any(Function) })],
    }));
    expect(mocks.backend.module).toHaveBeenCalledWith('relay.operations');
    const options = mocks.createCodexAppBackend.mock.calls[0]![0] as {
      surfaceOptions: {
        extensions: Array<{ configureConversation(): { developerInstructions: string } }>;
      };
    };
    expect(options.surfaceOptions.extensions[0]!.configureConversation().developerInstructions)
      .toContain('Never call rebook_shipment until the user explicitly approves');
  });

  it('exposes typed read and reset operations through app-owned IPC', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(mocks.ipcHandlers.has(RELAY_SNAPSHOT_CHANNEL)).toBe(true));

    await expect(mocks.ipcHandlers.get(RELAY_SNAPSHOT_CHANNEL)!())
      .resolves.toMatchObject({ revision: 1, metrics: { critical: 1 } });
    expect(mocks.readRelayState).toHaveBeenCalledWith('/tmp/relay-user-data/relay-operations.json');
    await expect(mocks.ipcHandlers.get(RELAY_RESET_CHANNEL)!())
      .resolves.toMatchObject({ revision: 1, metrics: { critical: 1 } });
    expect(mocks.resetRelayState).toHaveBeenCalledWith('/tmp/relay-user-data/relay-operations.json');
  });

  it('reuses one surface on reopen and removes both SDK and app IPC before quit', async () => {
    await import('../src/main/index');
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));

    mocks.windows[0]!.close();
    mocks.appHandlers.get('activate')?.();
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));
    expect(mocks.createCodexAppBackend).toHaveBeenCalledOnce();

    mocks.appHandlers.get('before-quit')?.();
    expect(mocks.registerCodexElectronMain.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(mocks.ipcMain.removeHandler).toHaveBeenCalledWith(RELAY_SNAPSHOT_CHANNEL);
    expect(mocks.ipcMain.removeHandler).toHaveBeenCalledWith(RELAY_RESET_CHANNEL);
    expect(mocks.backend.close).toHaveBeenCalledOnce();
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
