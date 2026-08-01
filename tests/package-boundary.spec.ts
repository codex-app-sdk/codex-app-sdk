import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const inspectedExtensions = new Set(['.css', '.json', '.md', '.mjs', '.ts', '.vue']);

describe('package boundary', () => {
  it('keeps native, Electron, Node, and surface layers independent from Vue', async () => {
    const files = (await Promise.all(['src/native', 'src/electron', 'src/node', 'src/surface']
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

  it('keeps the preload entry renderer-only while exposing custom IPC composition', async () => {
    const preload = await readFile(path.join(packageRoot, 'src/electron/preload.ts'), 'utf8');

    expect(preload).toContain('TypedIpcRenderer');
    expect(preload).toContain('exposeCodexNativeRendererApi');
    expect(preload).toContain('exposeCodexElectronPreload');
    expect(preload).not.toContain("from './index'");
    expect(preload).not.toContain('codex-native-ipc');
    expect(preload).not.toContain('codex-electron-integration');
  });

  it('mirrors every public Vue component with one isolated test file', async () => {
    const componentNames = (await readdir(path.join(packageRoot, 'src/vue/components')))
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.replace(/\.vue$/, '.spec.ts'))
      .sort();
    const testNames = (await readdir(path.join(packageRoot, 'tests/vue')))
      .filter((name) => /^[A-Z].*\.spec\.ts$/.test(name))
      .sort();

    expect(testNames).toStrictEqual(componentNames);
  });

  it('exports and directly mounts every generic conversation component', async () => {
    const vueIndex = await readFile(path.join(packageRoot, 'src/vue/index.ts'), 'utf8');
    const exports = [...vueIndex.matchAll(
      /export \{ default as (\w+) \} from '(\.\/(?:components|chat)\/([^']+\.vue))';/g,
    )].map((match) => ({ publicName: match[1]!, source: match[2]!, sourceName: path.basename(match[3]!, '.vue') }));
    const componentSources = (await Promise.all(['components', 'chat'].map(async (directory) => (
      (await readdir(path.join(packageRoot, `src/vue/${directory}`)))
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

  it('ships the complete conversation theme without resetting the host application', async () => {
    const [entrypoint, base, theme, viteConfig, vueBuildEntry, packageManifest, bundleVerifier] = await Promise.all([
      readFile(path.join(packageRoot, 'src/vue/styles.css'), 'utf8'),
      readFile(path.join(packageRoot, 'src/vue/base.css'), 'utf8'),
      readFile(path.join(packageRoot, 'src/vue/chat-theme.css'), 'utf8'),
      readFile(path.join(packageRoot, 'vite.config.ts'), 'utf8'),
      readFile(path.join(packageRoot, 'scripts/vue-entry.mjs'), 'utf8'),
      readFile(path.join(packageRoot, 'package.json'), 'utf8'),
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
    expect(vueBuildEntry).toContain("import '../src/vue/styles.css';");
    expect(JSON.parse(packageManifest).scripts.build).toContain('node scripts/verify-package-css.mjs');
    expect(JSON.parse(packageManifest).scripts.build).toContain('node scripts/package-katex-assets.mjs');
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
