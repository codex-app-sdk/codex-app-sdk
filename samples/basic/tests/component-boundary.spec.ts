import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sampleRoot = process.cwd();

describe('sample component test boundary', () => {
  it('keeps one isolated test file per Vue component', async () => {
    const components = ['App.vue', ...(await readdir(path.join(sampleRoot, 'src/components')))]
      .filter((name) => name.endsWith('.vue'))
      .map((name) => name.replace(/\.vue$/, '.spec.ts'))
      .sort();
    const tests = (await readdir(path.join(sampleRoot, 'tests')))
      .filter((name) => name.endsWith('.spec.ts') && name !== 'component-boundary.spec.ts')
      .sort();
    expect(tests).toStrictEqual(components);
  });
});
