import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCodexSurfaceIpc } from 'codex-app-sdk/electron';
import { createCodexSurface, type CodexSurface } from 'codex-app-sdk/node';

const directory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let surface: CodexSurface | null = null;
let unregisterSurfaceIpc: (() => void) | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f7f7f5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(directory, 'preload.cjs'),
    },
  });
  const rendererUrl = process.env.CODEX_SAMPLE_RENDERER_URL;
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(directory, '../dist-renderer/index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  surface = createCodexSurface({
    clientInfo: { name: 'codex_sdk_basic_sample', title: 'Codex SDK Basic Sample', version: '0.1.0' },
  });
  unregisterSurfaceIpc = registerCodexSurfaceIpc(ipcMain, {
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload),
  }, surface);
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unregisterSurfaceIpc?.();
  unregisterSurfaceIpc = null;
  void surface?.close().catch(() => undefined);
  surface = null;
});
