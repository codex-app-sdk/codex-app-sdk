import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAppBackend, type CodexAppBackend } from '@codex-app-sdk/backend';
import { registerCodexElectronMain } from '@codex-app-sdk/electron';

const bundleDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let backend: CodexAppBackend | null = null;
let unregisterSdk: (() => void) | null = null;

async function createWindow(): Promise<void> {
  const windowMaterial: BrowserWindowConstructorOptions = process.platform === 'darwin'
    ? {
        backgroundColor: '#00000000',
        hasShadow: true,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        vibrancy: 'menu',
      }
    : { backgroundColor: '#f7f7f5' };
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    ...windowMaterial,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(bundleDirectory, 'preload.cjs'),
    },
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Failed to load preload '${preloadPath}':`, error);
  });
  installWindowOpenPolicy(mainWindow.webContents);
  const rendererUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadFile(path.join(bundleDirectory, '../dist-renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

void app.whenReady().then(async () => {
  backend = createCodexAppBackend({
    surfaceOptions: { autoSelectFirstConversation: false },
  });
  unregisterSdk = registerCodexElectronMain({
    clipboard,
    dialog,
    ipcMain,
    shell,
    surface: backend.surface,
    sender: { send: (channel, payload) => mainWindow?.webContents.send(channel, payload) },
  });
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error('Failed to start application:', error);
  app.quit();
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

function installWindowOpenPolicy(webContents: Pick<WebContents, 'setWindowOpenHandler'>): void {
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
}

function openExternalUrl(value: string): void {
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol.toLowerCase())) {
      void shell.openExternal(url.href).catch(() => undefined);
    }
  } catch {
    // Invalid and non-web navigation stays blocked inside the renderer.
  }
}
