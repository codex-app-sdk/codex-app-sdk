import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const vueSourceRoot = path.join(packageRoot, 'packages/vue/src');
const sdkPackages = ['core', 'backend', 'vue', 'electron', 'web'] as const;
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const inspectedExtensions = new Set(['.css', '.json', '.md', '.mjs', '.ts', '.vue']);

describe('package boundary', () => {
  it('orchestrates every package and workspace from the root quality gates', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const sdkWorkspaces = [
      '@codex-app-sdk/core',
      '@codex-app-sdk/backend',
      '@codex-app-sdk/vue',
      '@codex-app-sdk/electron',
      '@codex-app-sdk/web',
    ];
    const supportingWorkspaces = [
      'create-codex-app',
      '@codex-app-sdk/component-lab',
      '@codex-app-sdk/basic-sample',
      '@codex-app-sdk/spark-sample',
      '@codex-app-sdk/relay-sample',
      '@codex-app-sdk/basic-web-sample',
    ];

    expect(Object.keys(manifest.scripts)).toStrictEqual(Object.keys(manifest.scripts).sort());
    expect(Object.keys(manifest.scripts).filter((script) => (
      /^(?:docs|electron|lab|relay|rpc|sample|schema|spark|web|web-sample):/.test(script)
    ))).toStrictEqual([]);
    expect(manifest.scripts.check).toBe('npm run check:sdk && npm run check:workspaces:owned && npm run build:docs');
    expect(manifest.scripts.test).toBe('npm run test:sdk && npm run test:workspaces');
    expect(manifest.scripts.typecheck).toBe('npm run typecheck:sdk && npm run typecheck:workspaces');
    expect(manifest.scripts.lint).toBe('npm run lint:sdk && npm run lint:workspaces');
    expect(manifest.scripts['build:all']).toBe('npm run build:sdk && npm run build:workspaces');
    expect(manifest.scripts['build:web']).toBe(
      'npm run build -w @codex-app-sdk/core'
      + ' && npm run build -w @codex-app-sdk/backend'
      + ' && npm run build -w @codex-app-sdk/vue'
      + ' && npm run build -w @codex-app-sdk/web'
      + ' && npm run build -w @codex-app-sdk/basic-web-sample',
    );

    for (const workspace of sdkWorkspaces) {
      expect(manifest.scripts['check:packages']).toContain(`-w ${workspace}`);
      expect(manifest.scripts['test:packages']).toContain(`-w ${workspace}`);
      expect(manifest.scripts['typecheck:packages']).toContain(`-w ${workspace}`);
      expect(manifest.scripts['lint:packages']).toContain(`-w ${workspace}`);
      expect(manifest.scripts['build:packages']).toContain(`-w ${workspace}`);
    }
    for (const workspace of supportingWorkspaces) {
      expect(manifest.scripts['check:workspaces:owned']).toContain(`-w ${workspace}`);
      expect(manifest.scripts['test:workspaces']).toContain(`-w ${workspace}`);
      expect(manifest.scripts['lint:workspaces']).toContain(`-w ${workspace}`);
      if (workspace !== 'create-codex-app') {
        expect(manifest.scripts['typecheck:workspaces']).toContain(`-w ${workspace}`);
        expect(manifest.scripts['build:workspaces']).toContain(`-w ${workspace}`);
      }
    }

    for (const surface of ['electron', 'web']) {
      for (const command of ['build', 'check', 'dev', 'start', 'test', 'typecheck']) {
        expect(manifest.scripts).toHaveProperty(`${command}:${surface}`);
      }
    }
  });

  it('gives every SDK package owned source, tests, and quality gates', async () => {
    const rootManifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const publishedSdkPackages = new Set(sdkPackages.map((name) => `@codex-app-sdk/${name}`));

    for (const packageName of sdkPackages) {
      const workspaceRoot = path.join(packageRoot, 'packages', packageName);
      const manifest = JSON.parse(await readFile(path.join(workspaceRoot, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        name?: string;
        publishConfig?: Record<string, string>;
        repository?: {
          directory?: string;
          type?: string;
          url?: string;
        };
        scripts?: Record<string, string>;
        version?: string;
      };
      const source = await sourceFiles(path.join(workspaceRoot, 'src'));
      const tests = await sourceFiles(path.join(workspaceRoot, 'tests'));

      expect(source.length, `${packageName} source`).toBeGreaterThan(0);
      expect(tests.some((file) => file.endsWith('.spec.ts')), `${packageName} tests`).toBe(true);
      expect(manifest.scripts, `${packageName} scripts`).toEqual(expect.objectContaining({
        build: expect.any(String),
        check: expect.any(String),
        lint: expect.any(String),
        test: expect.any(String),
        'test:coverage': expect.any(String),
        typecheck: expect.any(String),
      }));
      expect(manifest.scripts?.check, `${packageName} coverage gate`).toContain('test:coverage');
      expect(manifest.name, `${packageName} package scope`).toBe(`@codex-app-sdk/${packageName}`);
      expect(manifest.version, `${packageName} release version`).toBe(rootManifest.version);
      for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
        if (publishedSdkPackages.has(dependency)) {
          expect(version, `${packageName} dependency on ${dependency}`).toBe(rootManifest.version);
        }
      }
      expect(manifest.publishConfig, `${packageName} private registry`).toStrictEqual({
        access: 'restricted',
        registry: 'https://npm.pkg.github.com',
      });
      expect(manifest.repository, `${packageName} repository link`).toStrictEqual({
        directory: `packages/${packageName}`,
        type: 'git',
        url: 'git+https://github.com/codex-app-sdk/codex-app-sdk.git',
      });
      await expect(readFile(path.join(workspaceRoot, 'vitest.config.ts'), 'utf8')).resolves.toContain(
        "include: ['tests/**/*.spec.ts']",
      );
    }
  });

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

  it('keeps the component lab browser-only and on explicit renderer packages', async () => {
    const labRoot = path.join(packageRoot, 'samples/component-lab');
    const sdkManifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const manifest = JSON.parse(await readFile(path.join(labRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const files = await sourceFiles(labRoot);
    const compatibilityImports: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/from\s+['"]codex-app-sdk(?:\/|['"])|import\s+['"]codex-app-sdk\//.test(content)) {
        compatibilityImports.push(path.relative(packageRoot, file));
      }
    }

    expect(manifest.dependencies).toEqual({
      '@codex-app-sdk/core': sdkManifest.version,
      '@codex-app-sdk/vue': sdkManifest.version,
      vue: '^3.5.0',
    });
    expect(compatibilityImports).toStrictEqual([]);
  });

  it('keeps the web transport independent from HTTP frameworks and WebSocket implementations', async () => {
    const sdkManifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
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
    expect(manifest.dependencies).toEqual({ '@codex-app-sdk/core': sdkManifest.version });
  });

  it('builds Electron samples against the explicit modular packages', async () => {
    const sampleRoot = path.join(packageRoot, 'samples/electron');
    const aliases = await readFile(path.join(packageRoot, 'samples/vite.sdk-aliases.ts'), 'utf8');
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

      const viteConfig = await readFile(path.join(sampleRoot, sample, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain("from '../../vite.sdk-aliases'");
      expect(viteConfig).toContain('exclude: sdkSourceModuleIds');
    }

    for (const [specifier, source] of [
      ['@codex-app-sdk/core/events', 'typed-event-bus.ts'],
      ['@codex-app-sdk/core/native', 'native.ts'],
      ['@codex-app-sdk/core/surface', 'surface.ts'],
      ['@codex-app-sdk/core/surface-bridge', 'surface-bridge.ts'],
    ]) {
      expect(aliases, specifier).toContain(`'${specifier}'`);
      expect(aliases, source).toContain(`/packages/core/src/${source}`);
    }
  });

  it('keeps every sample dev server on the shared SDK source module graph', async () => {
    for (const configPath of [
      'samples/component-lab/vite.config.ts',
      'samples/electron/basic/vite.config.ts',
      'samples/electron/relay/vite.config.ts',
      'samples/electron/spark/vite.config.ts',
      'samples/web/basic/vite.config.ts',
    ]) {
      const viteConfig = await readFile(path.join(packageRoot, configPath), 'utf8');
      expect(viteConfig, configPath).toContain('sdkSourceAliases');
      expect(viteConfig, configPath).toContain('exclude: sdkSourceModuleIds');
      expect(viteConfig, configPath).toContain('allow: [sdkSourceRoot]');
      expect(viteConfig, configPath).toContain("dedupe: ['vue']");
    }
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
    const testNames = (await readdir(path.join(packageRoot, 'packages/vue/tests')))
      .filter((name) => /^[A-Z].*\.spec\.ts$/.test(name))
      .sort();

    expect(testNames).toEqual(expect.arrayContaining(componentNames));
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

    const testContents = (await sourceFiles(path.join(packageRoot, 'packages/vue/tests')))
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
