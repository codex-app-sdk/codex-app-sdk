import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  installCodexWindowPolicy,
  isCodexRendererSender,
  registerCodexElectronMain,
} from '@codex-app-sdk/electron';
import { createCodexAppBackend, type CodexAppBackend } from '@codex-app-sdk/backend';

const bundleDirectory = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
const rendererFile = path.join(bundleDirectory, '../dist-renderer/index.html');
// The window may only show this renderer, and only this renderer may call the Codex bridge.
const rendererUrl = devServerUrl || pathToFileURL(rendererFile).href;
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
  installCodexWindowPolicy(mainWindow.webContents, {
    rendererUrl,
    openExternal: (url) => shell.openExternal(url),
  });
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(rendererFile);
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const sdkBackend = createCodexAppBackend({
    surfaceOptions: { autoSelectFirstConversation: false },
  });
  backend = sdkBackend;
  unregisterSdk = registerCodexElectronMain({
    clipboard,
    dialog,
    ipcMain,
    isTrustedSender: (event) => isCodexRendererSender(event, rendererUrl),
    shell,
    surface: sdkBackend.surface,
    sender: { send: (channel, payload) => mainWindow?.webContents.send(channel, payload) },
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unregisterSdk?.();
  unregisterSdk = null;
  void backend?.close().catch(() => undefined);
  backend = null;
});
