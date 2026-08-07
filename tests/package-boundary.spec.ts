import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const vueSourceRoot = path.join(packageRoot, 'packages/vue/src');
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const inspectedExtensions = new Set(['.css', '.json', '.md', '.mjs', '.ts', '.vue']);

describe('package boundary', () => {
  it('keeps core independent from platform and protocol packages', async () => {
    const files = await sourceFiles(path.join(packageRoot, 'packages/core/src'));
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/from\s+['"](?:node:|electron|vue|@codex-app-sdk\/(?:backend|electron|vue|web)|[^'"]*codex\/generated)/.test(content)) {
        violations.push(path.relative(packageRoot, file));
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('keeps native, Electron, Node, and surface layers independent from Vue', async () => {
    const files = (await Promise.all(['src/native', 'src/electron', 'src/surface', 'packages/backend/src']
      .map((root) => sourceFiles(path.join(packageRoot, root))))).flat();
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/from\s+['"][^'"]*vue(?:\/|['"])/.test(content)) {
        violations.push(path.relative(packageRoot, file));
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('keeps the Vue package independent from backend and host adapters', async () => {
    const files = await sourceFiles(vueSourceRoot);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/from\s+['"](?:node:|electron|@codex-app-sdk\/(?:backend|electron|web))/.test(content)) {
        violations.push(path.relative(packageRoot, file));
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('keeps the web transport independent from HTTP frameworks and WebSocket implementations', async () => {
    const files = await sourceFiles(path.join(packageRoot, 'packages/web/src'));
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/from\s+['"](?:express|ws|node:)/.test(content)) {
        violations.push(path.relative(packageRoot, file));
      }
    }
    const manifest = JSON.parse(await readFile(
      path.join(packageRoot, 'packages/web/package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> };

    expect(violations).toStrictEqual([]);
    expect(manifest.dependencies).toEqual({ '@codex-app-sdk/core': '0.1.0' });
  });

  it('builds Electron samples against the explicit modular packages', async () => {
    const sampleRoot = path.join(packageRoot, 'samples/electron');
    const files = await sourceFiles(sampleRoot);
    const compatibilityImports: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/from\s+['"]codex-app-sdk(?:\/|['"])|import\s+['"]codex-app-sdk\//.test(content)) {
        compatibilityImports.push(path.relative(packageRoot, file));
      }
    }

    expect(compatibilityImports).toStrictEqual([]);
    for (const sample of ['basic', 'spark', 'relay']) {
      const packageJson = JSON.parse(await readFile(
        path.join(sampleRoot, sample, 'package.json'),
        'utf8',
      )) as { dependencies: Record<string, string> };
      expect(Object.keys(packageJson.dependencies)).toEqual(expect.arrayContaining([
        '@codex-app-sdk/backend',
        '@codex-app-sdk/core',
        '@codex-app-sdk/electron',
        '@codex-app-sdk/vue',
      ]));
      expect(packageJson.dependencies).not.toHaveProperty('codex-app-sdk');
    }
  });

  it('keeps the Express sample free of SDK transport implementation details', async () => {
    const sampleRoot = path.join(packageRoot, 'samples/web/express');
    const files = await sourceFiles(path.join(sampleRoot, 'src'));
    const transportImplementations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/JSON\.parse|codexSurfaceBridgeOperations|codexWebSocketProtocolVersion|CodexWebSocketRequest|requestId/.test(content)) {
        transportImplementations.push(path.relative(packageRoot, file));
      }
    }
    const manifest = JSON.parse(await readFile(path.join(sampleRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const renderer = await readFile(path.join(sampleRoot, 'src/client/App.vue'), 'utf8');
    const server = await readFile(path.join(sampleRoot, 'src/server/index.ts'), 'utf8');

    expect(transportImplementations).toStrictEqual([]);
    expect(renderer).toContain("from '@codex-app-sdk/web/client'");
    expect(renderer).toContain('createCodexWebSurfaceClient');
    expect(renderer).not.toContain('addEventListener');
    expect(server).toContain("from '@codex-app-sdk/web/server'");
    expect(server).toContain('bindCodexWebSocket');
    expect(server).toContain('authenticateSiteRequest');
    expect(server).toContain('acquireCodexSession');
    expect(manifest.dependencies).toEqual(expect.objectContaining({
      express: expect.any(String),
      ws: expect.any(String),
      '@codex-app-sdk/backend': '0.1.0',
      '@codex-app-sdk/vue': '0.1.0',
      '@codex-app-sdk/web': '0.1.0',
    }));
  });

  it('keeps the preload entry renderer-only while exposing custom IPC composition', async () => {
    const preload = await readFile(path.join(packageRoot, 'packages/electron/src/preload.ts'), 'utf8');
    const compatibilityEntry = await readFile(path.join(packageRoot, 'src/electron/preload.ts'), 'utf8');

    expect(preload).toContain('TypedIpcRenderer');
    expect(preload).toContain('exposeCodexNativeRendererApi');
    expect(preload).toContain('exposeCodexElectronPreload');
    expect(preload).not.toContain("from './index'");
    expect(preload).not.toContain('codex-native-ipc');
    expect(preload).not.toContain('codex-electron-integration');
    expect(compatibilityEntry).toContain("@codex-app-sdk/electron/preload");
  });

  it('mirrors every public Vue component with one isolated test file', async () => {
    const componentNames = (await readdir(path.join(vueSourceRoot, 'components')))
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.replace(/\.vue$/, '.spec.ts'))
      .sort();
    const testNames = (await readdir(path.join(packageRoot, 'tests/vue')))
      .filter((name) => /^[A-Z].*\.spec\.ts$/.test(name))
      .sort();

    expect(testNames).toStrictEqual(componentNames);
  });

  it('exports and directly mounts every generic conversation component', async () => {
    const vueIndex = await readFile(path.join(vueSourceRoot, 'index.ts'), 'utf8');
    const exports = [...vueIndex.matchAll(
      /export \{ default as (\w+) \} from '(\.\/(?:components|chat)\/([^']+\.vue))';/g,
    )].map((match) => ({ publicName: match[1]!, source: match[2]!, sourceName: path.basename(match[3]!, '.vue') }));
    const componentSources = (await Promise.all(['components', 'chat'].map(async (directory) => (
      (await readdir(path.join(vueSourceRoot, directory)))
        .filter((name) => name.endsWith('.vue'))
        .map((name) => `./${directory}/${name}`)
    )))).flat().sort();

    expect(exports.map((entry) => entry.source).sort()).toStrictEqual(componentSources);

    const testContents = (await sourceFiles(path.join(packageRoot, 'tests/vue')))
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => readFile(file, 'utf8'));
    const joinedTests = (await Promise.all(testContents)).join('\n');
    const missingMounts = exports
      .filter(({ publicName, sourceName }) => !new RegExp(`mount\\(\\s*(?:${publicName}|${sourceName})\\b`).test(joinedTests))
      .map(({ publicName }) => publicName);

    expect(missingMounts).toStrictEqual([]);
  });

  it('names every Vue injection key with the SDK prefix', async () => {
    const files = await sourceFiles(vueSourceRoot);
    const keys: Array<{ file: string; name: string }> = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const match of content.matchAll(/InjectionKey<[^;]+?>\s*=\s*Symbol\(\s*['"]([^'"]+)['"]/g)) {
        keys.push({ file: path.relative(packageRoot, file), name: match[1]! });
      }
    }

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter(({ name }) => !name.startsWith('codex-app-sdk-'))).toStrictEqual([]);
  });

  it('ships the complete conversation theme without resetting the host application', async () => {
    const [entrypoint, base, theme, viteConfig, vueBuildEntry, packageManifest, bundleVerifier] = await Promise.all([
      readFile(path.join(vueSourceRoot, 'styles.css'), 'utf8'),
      readFile(path.join(vueSourceRoot, 'base.css'), 'utf8'),
      readFile(path.join(vueSourceRoot, 'chat-theme.css'), 'utf8'),
      readFile(path.join(packageRoot, 'packages/vue/vite.config.ts'), 'utf8'),
      readFile(path.join(packageRoot, 'packages/vue/scripts/vue-entry.mjs'), 'utf8'),
      readFile(path.join(packageRoot, 'packages/vue/package.json'), 'utf8'),
      readFile(path.join(packageRoot, 'scripts/verify-package-css.mjs'), 'utf8'),
    ]);

    expect(entrypoint).toContain("@import './chat-theme.css';");
    expect(entrypoint).toContain("@import './base.css';");
    expect(entrypoint).toContain("@import 'katex/dist/katex.min.css';");
    expect(base).toContain('.codex-text-shimmer');
    expect(base).toContain('.codex-markdown');
    expect(base).toContain('.codex-markdown .katex-display');
    expect(base).toContain('.codex-chat-theme');
    expect(theme).toContain(':where(.codex-chat-theme)');
    expect(theme).toContain('.codex-chat-theme--dark');
    expect(theme).toContain('.codex-chat-theme--system');
    expect(theme).toContain('--chat-message-font-size: var(--codex-message-font-size');
    expect(theme).toContain('--chat-composer-font-size: var(--codex-composer-font-size');
    expect(theme).toContain('--chat-menu-font-size: var(--codex-menu-font-size');
    expect(theme).toContain('--chat-composer-control-size: var(--codex-composer-control-size');
    expect(theme).toContain('--chat-message-action-control-size: var(--codex-message-action-control-size');
    expect(viteConfig).toContain("new URL('./scripts/vue-entry.mjs'");
    expect(vueBuildEntry).toContain("import '../src/styles.css';");
    expect(JSON.parse(packageManifest).scripts.build).toContain('scripts/verify-package-css.mjs');
    expect(JSON.parse(packageManifest).scripts.build).toContain('scripts/package-katex-assets.mjs');
    expect(bundleVerifier).toContain("'@media (prefers-color-scheme:dark)'");
    expect(bundleVerifier).toContain("'--font-size-15:15px'");
    expect(bundleVerifier).toContain("'--codex-message-font-size'");
    expect(bundleVerifier).toContain("'--codex-composer-control-size'");
    expect(bundleVerifier).toContain("'.chat-rich-text-editor'");
    expect(bundleVerifier).toContain("'.chat-mention-chip'");
    expect(bundleVerifier).toContain("'.chat-composer-at-menu'");

    const shippedStyles = `${base}\n${theme}`;
    expect(shippedStyles).not.toMatch(/(^|\n)\s*(?:\*|html|body|#app|:root|\.el-)/);
    expect(shippedStyles).not.toContain('[class^=');
    expect(shippedStyles).not.toContain('[class*=');
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'package-lock.json') {
      return [];
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : sourceFiles(entryPath);
    }
    return inspectedExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  }));
  return files.flat();
}
