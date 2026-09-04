import { describe, expect, it } from 'vitest';
import { findActiveFileMention, findActivePluginMention } from '../../src/chat/composer-mentions';

describe('composer mentions', () => {
  it('finds the latest plugin or skill trigger at the clamped caret', () => {
    expect(findActivePluginMention('use @old then $new trailing', 18)).toStrictEqual({
      end: 18,
      query: 'new',
      start: 14,
      trigger: '$',
    });
    expect(findActivePluginMention('@plugin', 99)).toStrictEqual({
      end: 7,
      query: 'plugin',
      start: 0,
      trigger: '@',
    });
    expect(findActivePluginMention('@plugin', -1)).toBeNull();
  });

  it.each(['a', 'Z', '0', '_', '.', '%', '+', '-'])(
    'does not start a plugin mention after the token character %s',
    (previous) => {
      expect(findActivePluginMention(`${previous}@plugin`, previous.length + 7)).toBeNull();
    },
  );

  it.each([' ', '\t', '@', '$', '/'])(
    'rejects the plugin mention when its query contains %j',
    (separator) => {
      expect(findActivePluginMention(`@plug${separator}in`, 8)).toBeNull();
    },
  );

  it('allows a plugin mention after punctuation and at the start of input', () => {
    expect(findActivePluginMention('(@plug', 6)).toStrictEqual({
      end: 6,
      query: 'plug',
      start: 1,
      trigger: '@',
    });
    expect(findActivePluginMention('$', 1)).toStrictEqual({
      end: 1,
      query: '',
      start: 0,
      trigger: '$',
    });
    expect(findActivePluginMention('plain text', 10)).toBeNull();
  });

  it('finds file mentions at an exact mid-string caret without consuming suffix text', () => {
    expect(findActiveFileMention('open @file.ts later', 13)).toStrictEqual({
      end: 13,
      query: 'file.ts',
      start: 5,
      trigger: '@',
    });
    expect(findActiveFileMention('@file.ts', 99)).toStrictEqual({
      end: 8,
      query: 'file.ts',
      start: 0,
      trigger: '@',
    });
    expect(findActiveFileMention('@src/file.ts', -1)).toBeNull();
  });

  it.each(['a', 'Z', '0', '_', '.', '%', '+', '-'])(
    'does not start a file mention after the token character %s',
    (previous) => {
      expect(findActiveFileMention(`${previous}@file`, previous.length + 5)).toBeNull();
    },
  );

  it.each([' ', '\t', '@', '$', '/'])(
    'rejects the file mention when its query contains %j',
    (separator) => {
      expect(findActiveFileMention(`@fi${separator}le`, 6)).toBeNull();
    },
  );

  it('ignores skill triggers for files and allows file mentions after punctuation', () => {
    expect(findActiveFileMention('$file', 5)).toBeNull();
    expect(findActiveFileMention('(@file', 6)).toStrictEqual({
      end: 6,
      query: 'file',
      start: 1,
      trigger: '@',
    });
  });
});
