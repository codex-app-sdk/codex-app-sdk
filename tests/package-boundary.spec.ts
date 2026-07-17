import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const forbiddenHostName = ['cl', 'aw'].join('');
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const inspectedExtensions = new Set(['.json', '.md', '.mjs', '.ts', '.vue']);

describe('package boundary', () => {
  it('keeps host product names out of SDK source and documentation', async () => {
    const files = await sourceFiles(packageRoot);
    const violations: string[] = [];

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (content.toLowerCase().includes(forbiddenHostName)) {
        violations.push(path.relative(packageRoot, file));
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it('mirrors every public Vue component with one isolated test file', async () => {
    const componentNames = (await readdir(path.join(packageRoot, 'src/vue/components')))
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.replace(/\.vue$/, '.spec.ts'))
      .sort();
    const testNames = (await readdir(path.join(packageRoot, 'tests/vue')))
      .filter((name) => name.endsWith('.spec.ts'))
      .sort();

    expect(testNames).toStrictEqual(componentNames);
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
