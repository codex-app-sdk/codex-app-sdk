import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import { registerCodexElectronMain } from 'codex-app-sdk/electron';
import { createCodexSurface, type CodexSurface } from 'codex-app-sdk/node';

const bundleDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let surface: CodexSurface | null = null;
let unregisterSdk: (() => void) | null = null;

app.setName('Spark');

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 580,
    backgroundColor: '#fffaf1',
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
  const appData = app.getPath('userData');
  const codexHome = path.join(app.getPath('home'), '.codex-spark');
  const workspace = path.join(appData, 'workspace');
  await Promise.all([
    mkdir(codexHome, { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);

  const sdkSurface = createCodexSurface({
    approvalMode: 'never',
    clientInfo: { name: 'spark', title: 'Spark', version: '0.1.0' },
    codexHome,
    conversationDefaults: {
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
    },
    cwd: workspace,
    extensions: [{
      configureConversation: () => ({
        developerInstructions: [
          'You are Spark, a warm and encouraging assistant for children ages 8 to 12.',
          'Use clear, age-appropriate language and short paragraphs.',
          'Help the child learn, imagine, write stories, and explore questions.',
          'Never ask for personal details. For dangerous or adult topics, give a brief safe response and suggest asking a trusted grown-up.',
        ].join(' '),
      }),
    }],
    permissionMode: 'read-only',
  });
  surface = sdkSurface;
  unregisterSdk = registerCodexElectronMain({
    clipboard,
    dialog,
    ipcMain,
    shell,
    surface: sdkSurface,
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
    return url.protocol.toLowerCase() === 'https:' ? url.href : null;
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
  void surface?.close().catch(() => undefined);
  surface = null;
});
