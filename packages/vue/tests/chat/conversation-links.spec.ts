import { describe, expect, it } from 'vitest';

import {
  codexConversationLinkFromHref,
  parseCodexEditorFileReference,
} from '../../src/chat/conversation-links';

describe('conversation links', () => {
  it('parses trimmed editor references with an optional multi-digit column', () => {
    expect(parseCodexEditorFileReference('  src/chat/message.ts:12:34  ')).toStrictEqual({
      path: 'src/chat/message.ts',
      line: 12,
      column: 34,
    });
    expect(parseCodexEditorFileReference('src/chat/message.ts:12')).toStrictEqual({
      path: 'src/chat/message.ts',
      line: 12,
    });
  });

  it.each([
    'bad:src/chat/message.ts:12',
    'garbage\nsrc/chat/message.ts:12',
    'src/chat/message.ts:12 suffix',
    'src/chat/message.ts:0',
    'src/chat/message.ts:9007199254740992',
    'src/chat/message.ts:12:0',
    'src/chat/message.ts:12:9007199254740992',
  ])('rejects invalid editor reference %s', (value) => {
    expect(parseCodexEditorFileReference(value)).toBeNull();
  });

  it.each([
    'http://example.com/docs',
    'https://example.com/docs',
    'mailto:hello@example.com',
    'tel:+15551234567',
  ])('classifies supported absolute link %s as external', (href) => {
    expect(codexConversationLinkFromHref(href)).toStrictEqual({ href, kind: 'external' });
  });

  it('normalizes authored whitespace while preserving malformed path escapes', () => {
    expect(codexConversationLinkFromHref('  http://example.com/docs  ')).toStrictEqual({
      href: 'http://example.com/docs',
      kind: 'external',
    });
    expect(codexConversationLinkFromHref('docs/design.md   ?raw=1#overview')).toStrictEqual({
      href: 'docs/design.md   ?raw=1#overview',
      kind: 'file',
      path: 'docs/design.md',
    });
    expect(codexConversationLinkFromHref('docs/bad%escape.md')).toStrictEqual({
      href: 'docs/bad%escape.md',
      kind: 'file',
      path: 'docs/bad%escape.md',
    });
  });
});
