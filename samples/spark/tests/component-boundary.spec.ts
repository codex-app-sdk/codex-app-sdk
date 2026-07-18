import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sampleRoot = path.resolve(import.meta.dirname, '..');

describe('Spark sample component test boundary', () => {
  it('keeps one isolated test file per Vue component', async () => {
    const components = ['App.vue', ...(await readdir(path.join(sampleRoot, 'src/renderer/components')))]
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.replace(/\.vue$/, '.spec.ts'))
      .sort();
    const tests = (await readdir(path.join(sampleRoot, 'tests')))
      .filter((name) => components.includes(name))
      .sort();
    expect(tests).toStrictEqual(components);
  });
});
