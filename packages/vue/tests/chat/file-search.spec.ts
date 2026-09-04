// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { filterFileSearchItems, fuzzyScore } from '../../src/chat/file-search';

describe('filterFileSearchItems', () => {
  const files = [
    { name: 'README.md', path: 'README.md' },
    { name: 'package.json', path: 'package.json' },
    { name: 'ChatComposer.vue', path: 'src/renderer/components/ChatComposer.vue' },
    { name: 'research.md', path: 'docs/research.md' },
  ];

  it('matches files by name and path with fuzzy ranking', () => {
    expect(filterFileSearchItems(files, 'chat').map((file) => file.path)).toStrictEqual([
      'src/renderer/components/ChatComposer.vue',
    ]);

    expect(filterFileSearchItems(files, 'docsres').map((file) => file.path)).toStrictEqual([
      'docs/research.md',
    ]);
  });

  it('returns a capped unfiltered list for an empty query', () => {
    expect(filterFileSearchItems(files, '', 2)).toStrictEqual(files.slice(0, 2));
  });

  it('normalizes the query and ranks contiguous name matches ahead of path matches', () => {
    const ranked = [
      { name: 'a---b.txt', path: 'unrelated/one.txt' },
      { name: 'ab.txt', path: 'unrelated/two.txt' },
      { name: 'none.txt', path: 'directory/a_b.txt' },
    ];

    expect(filterFileSearchItems(ranked, '  Ab  ').map((file) => file.name)).toStrictEqual([
      'ab.txt',
      'a---b.txt',
      'none.txt',
    ]);
    expect(filterFileSearchItems(ranked, 'ab', 2)).toStrictEqual([
      ranked[1],
      ranked[0],
    ]);
  });
});

describe('fuzzyScore', () => {
  it.each([
    ['abc', 'abc', 22],
    ['ac', 'abc', 11],
    ['b', 'ab', 1],
    ['b', 'a/b', 5],
    ['b', 'a-b', 5],
    ['b', 'a_b', 5],
    ['b', 'a.b', 5],
    ['missing', 'target', 0],
    ['', 'target', 0],
  ])('scores %s against %s as %i', (pattern, target, expected) => {
    expect(fuzzyScore(pattern, target)).toBe(expected);
  });
});
