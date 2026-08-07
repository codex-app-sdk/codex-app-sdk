import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sampleRoot = fileURLToPath(new URL('..', import.meta.url));

test('uses the public web transport without reimplementing its protocol', async () => {
  const files = await sourceFiles(path.join(sampleRoot, 'src'));
  const transportImplementations = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    if (/JSON\.parse|codexSurfaceBridgeOperations|codexWebSocketProtocolVersion|CodexWebSocketRequest|requestId/.test(content)) {
      transportImplementations.push(path.relative(sampleRoot, file));
    }
  }

  const manifest = JSON.parse(await readFile(path.join(sampleRoot, 'package.json'), 'utf8'));
  const renderer = await readFile(path.join(sampleRoot, 'src/client/App.vue'), 'utf8');
  const server = await readFile(path.join(sampleRoot, 'src/server/index.ts'), 'utf8');
  const viteConfig = await readFile(path.join(sampleRoot, 'vite.config.ts'), 'utf8');
  const devRunner = await readFile(path.join(sampleRoot, 'scripts/dev.mjs'), 'utf8');

  assert.deepEqual(transportImplementations, []);
  assert.match(renderer, /from '@codex-app-sdk\/web\/client'/);
  assert.match(renderer, /createCodexWebSurfaceClient/);
  assert.match(renderer, /new WebSocket\(`\$\{protocol\}\/\/\$\{window\.location\.host\}\/codex`\)/);
  assert.doesNotMatch(renderer, /addEventListener/);
  assert.match(server, /from '@codex-app-sdk\/web\/server'/);
  assert.match(server, /bindCodexWebSocket/);
  assert.match(server, /authenticateSiteRequest/);
  assert.match(server, /acquireCodexSession/);
  assert.match(viteConfig, /['"]\/codex['"]/);
  assert.match(viteConfig, /ws:\s*true/);
  assert.match(devRunner, /spawn\('vite'/);
  assert.match(devRunner, /spawn\(process\.execPath, \['src\/server\/index\.ts'\]/);
  assert.deepEqual(
    Object.keys(manifest.dependencies).sort(),
    [
      '@codex-app-sdk/backend',
      '@codex-app-sdk/core',
      '@codex-app-sdk/vue',
      '@codex-app-sdk/web',
      'express',
      'vue',
      'ws',
    ],
  );
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}
