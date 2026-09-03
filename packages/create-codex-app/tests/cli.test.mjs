import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  packageManagerFromUserAgent,
  parseArguments,
  run,
  scaffoldProject,
} from '../src/cli.js';

test('parses the public command options', () => {
  assert.deepEqual(parseArguments(['my-app', '--no-install', '--package-manager', 'pnpm', '--target', 'web']), {
    directory: 'my-app',
    help: false,
    install: false,
    packageManager: 'pnpm',
    target: 'web',
    version: false,
  });
  assert.equal(parseArguments([]).target, 'electron');
  assert.equal(packageManagerFromUserAgent('pnpm/10.0.0 npm/? node/v22'), 'pnpm');
  assert.equal(packageManagerFromUserAgent(undefined), 'npm');
  assert.throws(() => parseArguments(['--package-manager', 'unknown']), /Unsupported package manager/);
  assert.throws(() => parseArguments(['--target', 'native']), /Unsupported target/);
});

test('creates a complete app without retaining template tokens', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'create-codex-app-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  const project = await scaffoldProject({ cwd: root, directory: 'My Codex App' });
  const packageJson = JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8'));
  const app = await readFile(join(project.path, 'src/renderer/App.vue'), 'utf8');
  const main = await readFile(join(project.path, 'src/main/index.ts'), 'utf8');
  const styles = await readFile(join(project.path, 'src/renderer/styles.css'), 'utf8');
  const viteEnvironment = await readFile(join(project.path, 'src/renderer/vite-env.d.ts'), 'utf8');

  assert.equal(project.packageName, 'my-codex-app');
  assert.equal(project.displayName, 'My Codex App');
  assert.equal(packageJson.name, 'my-codex-app');
  assert.equal(packageJson.productName, 'My Codex App');
  assert.equal(project.target, 'electron');
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    '@codex-app-sdk/backend',
    '@codex-app-sdk/core',
    '@codex-app-sdk/electron',
    '@codex-app-sdk/vue',
    'vue',
  ]);
  assert.match(app, /CodexConversationPane/);
  assert.match(app, /Recent chats/);
  assert.match(app, /sidebar__new-chat/);
  assert.match(app, /requiresSignIn/);
  assert.match(app, /surface\.startChatGptLogin\(\)/);
  assert.match(app, /Sign in with ChatGPT/);
  assert.match(app, /:title="conversation\.title/);
  assert.match(styles, /\.sidebar__conversation span[\s\S]*text-overflow: ellipsis/);
  assert.match(styles, /\.sidebar__conversation span[\s\S]*white-space: nowrap/);
  assert.match(styles, /--shell-glass-opacity: 65%/);
  assert.match(styles, /--workbench-appbar-height: 48px/);
  assert.match(styles, /html\[data-platform='macos'\] \.sidebar__header[\s\S]*padding-left: 88px/);
  assert.equal(app.includes('{{displayName}}'), false);
  assert.match(main, /createCodexAppBackend/);
  assert.match(main, /autoSelectFirstConversation: false/);
  assert.match(main, /setWindowOpenHandler/);
  assert.doesNotMatch(main, /will-navigate/);
  assert.match(main, /from '@codex-app-sdk\/backend'/);
  assert.match(main, /from '@codex-app-sdk\/electron'/);
  assert.match(viteEnvironment, /from '@codex-app-sdk\/electron'/);
  assert.doesNotMatch(viteEnvironment, /from 'codex-app-sdk\//);
  assert.match(main, /vibrancy: 'menu'/);
  assert.match(main, /titleBarStyle: 'hiddenInset'/);
  assert.match(main, /void app\.whenReady\(\)\.then/);
  assert.doesNotMatch(main, /^await app\.whenReady\(\);$/m);
  assert.equal((await readFile(join(project.path, '.gitignore'), 'utf8')).includes('node_modules'), true);
  assert.equal(JSON.stringify(packageJson).includes('{{'), false);
});

test('creates a thin Express web target against the modular packages', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'create-codex-app-web-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  const project = await scaffoldProject({ cwd: root, directory: 'Team Codex', target: 'web' });
  const packageJson = JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8'));
  const app = await readFile(join(project.path, 'src/client/App.vue'), 'utf8');
  const server = await readFile(join(project.path, 'src/server/index.ts'), 'utf8');
  const readme = await readFile(join(project.path, 'README.md'), 'utf8');

  assert.equal(project.target, 'web');
  assert.equal(packageJson.name, 'team-codex');
  assert.equal(packageJson.productName, 'Team Codex');
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    '@codex-app-sdk/backend',
    '@codex-app-sdk/core',
    '@codex-app-sdk/vue',
    '@codex-app-sdk/web',
    'express',
    'vue',
    'ws',
  ]);
  assert.match(app, /createCodexWebSurfaceClient/);
  assert.match(app, /CodexConversationPane/);
  assert.match(app, /CodexConversationSidebar/);
  assert.match(app, /@create="surface\.createConversation\(\)"/);
  assert.doesNotMatch(app, /JSON\.parse|requestId|addEventListener/);
  assert.match(server, /bindCodexWebSocket/);
  assert.match(server, /authenticateSiteRequest/);
  assert.match(server, /acquireCodexSession/);
  assert.match(server, /autoSelectFirstConversation: false/);
  assert.doesNotMatch(server, /codexWebSocketProtocolVersion|CodexWebSocketRequest|requestId/);
  assert.match(readme, /Team Codex/);
  assert.equal(readme.includes('{{'), false);
  assert.equal((await readFile(join(project.path, '.gitignore'), 'utf8')).includes('node_modules'), true);
});

test('refuses to overwrite a non-empty target directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'create-codex-app-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const target = join(root, 'existing');
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'keep');

  await assert.rejects(
    scaffoldProject({ cwd: root, directory: 'existing' }),
    /is not empty/,
  );
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('prints runnable next steps and can skip installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'create-codex-app-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  let output = '';
  let installed = false;

  await run(['demo', '--no-install'], {
    cwd: root,
    output: { write: (value) => { output += value; } },
    errorOutput: { write: () => undefined },
    installDependencies: async () => { installed = true; },
    throwOnError: true,
  });

  assert.equal(installed, false);
  assert.match(output, /cd demo/);
  assert.match(output, /npm install/);
  assert.match(output, /npm run dev/);
});
