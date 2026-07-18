import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const sampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readiness = { main: false, preload: false };
const watchers = [];
let electronProcess = null;
let restartTimer = null;
let shuttingDown = false;

const renderer = await createServer({
  configFile: path.join(sampleRoot, 'vite.config.ts'),
  mode: 'development',
});
await renderer.listen();
const rendererUrl = renderer.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';
renderer.printUrls();

watchers.push(
  await watchBuild('main', 'vite.main.config.ts'),
  await watchBuild('preload', 'vite.preload.config.ts'),
);

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

async function watchBuild(name, configFile) {
  const watcher = await build({
    configFile: path.join(sampleRoot, configFile),
    mode: 'development',
    build: { watch: {} },
  });
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') {
      readiness[name] = true;
      void event.result.close();
      console.log(`[dev] ${name} rebuilt`);
      scheduleElectronRestart();
    } else if (event.code === 'ERROR') {
      console.error(event.error);
    }
  });
  return watcher;
}

function scheduleElectronRestart() {
  if (!readiness.main || !readiness.preload || shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(restartElectron, 120);
}

function restartElectron() {
  if (shuttingDown) return;
  if (electronProcess) {
    console.log('[dev] restarting Electron');
    const previous = electronProcess;
    electronProcess = null;
    previous.once('exit', startElectron);
    previous.kill();
    return;
  }
  startElectron();
}

function startElectron() {
  if (shuttingDown) return;
  console.log(`[dev] starting Electron at ${rendererUrl}`);
  electronProcess = spawn(electronBinary, ['.'], {
    cwd: sampleRoot,
    env: { ...process.env, CODEX_SAMPLE_RENDERER_URL: rendererUrl },
    stdio: 'inherit',
  });
  electronProcess.once('exit', (code, signal) => {
    if (!electronProcess) return;
    electronProcess = null;
    if (!shuttingDown) void shutdown(code ?? (signal ? 1 : 0));
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  electronProcess?.kill();
  await Promise.allSettled([
    renderer.close(),
    ...watchers.map((watcher) => watcher.close()),
  ]);
  process.exit(exitCode);
}
