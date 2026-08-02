import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCodexElectronMain } from 'codex-app-sdk/electron';
import { createCodexAppBackend, type CodexAppBackend } from 'codex-app-sdk/node';

const bundleDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let backend: CodexAppBackend | null = null;
let unregisterSdk: (() => void) | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f7f7f5',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(bundleDirectory, 'preload.cjs'),
    },
  });
  installNavigationPolicy(mainWindow.webContents);
  const rendererUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(bundleDirectory, '../dist-renderer/index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const sdkBackend = createCodexAppBackend();
  backend = sdkBackend;
  unregisterSdk = registerCodexElectronMain({
    clipboard,
    dialog,
    ipcMain,
    shell,
    surface: sdkBackend.surface,
    sender: { send: (channel, payload) => mainWindow?.webContents.send(channel, payload) },
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

function installNavigationPolicy(webContents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>): void {
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternalUrl(url);
  });
}

function openExternalUrl(url: string): void {
  const externalUrl = allowedExternalUrl(url);
  if (externalUrl) void shell.openExternal(externalUrl).catch(() => undefined);
}

function allowedExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unregisterSdk?.();
  unregisterSdk = null;
  void backend?.close().catch(() => undefined);
  backend = null;
});
