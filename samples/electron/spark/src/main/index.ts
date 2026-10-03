import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import {
  installCodexWindowPolicy,
  isCodexRendererSender,
  registerCodexElectronMain,
} from '@codex-app-sdk/electron';
import { createCodexSurface, type CodexSurface } from '@codex-app-sdk/backend';

const bundleDirectory = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
const rendererFile = path.join(bundleDirectory, '../dist-renderer/index.html');
// The window may only show this renderer, and only this renderer may call the Codex bridge.
const rendererUrl = devServerUrl || pathToFileURL(rendererFile).href;
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
  installCodexWindowPolicy(mainWindow.webContents, {
    rendererUrl,
    // Spark only hands HTTPS links to the system browser.
    openExternal: async (url) => { if (url.startsWith('https:')) await shell.openExternal(url); },
  });
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(rendererFile);
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
    isTrustedSender: (event) => isCodexRendererSender(event, rendererUrl),
    shell,
    surface: sdkSurface,
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
  void surface?.close().catch(() => undefined);
  surface = null;
});
