// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexNativeRendererApi } from '@codex-app-sdk/core/native';
import {
  copyableMessageHtml,
  copyableMessageText,
  copyMessageToClipboard,
  copyTextToClipboard,
  stripMessageMarkup,
} from '../../src/chat/message-actions';

describe('message actions', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'codexAppSdkNative');
    Reflect.deleteProperty(globalThis, 'ClipboardItem');
    vi.restoreAllMocks();
  });

  it('removes surface-only markup and conversation context', () => {
    expect(stripMessageMarkup([
      '<context>hidden context</context>',
      'Visible',
      '<tool id="tool-1"></tool>',
      '<tool index="2"></tool>',
      '<follow-up>Try again</follow-up>',
    ].join('\n'))).toBe('Visible');
  });

  it('removes tool markers with repeated protocol whitespace', () => {
    expect(stripMessageMarkup([
      'Before',
      '<tool   id="tool-1"></tool>',
      '<tool\t\tindex="2"></tool>',
      'After',
    ].join('\n'))).toBe('Before\n\n\nAfter');
  });

  it('converts markdown blocks and inline formatting into readable text', () => {
    expect(copyableMessageText([
      '# Heading',
      '',
      'A **bold** paragraph.  ',
      'Next line',
      '',
      '- First',
      '- Second',
      '',
      '> Quote',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n'))).toBe([
      'Heading',
      'A bold paragraph.\nNext line',
      'First',
      'Second',
      'Quote',
      'const value = 1;',
    ].join('\n'));
    expect(copyableMessageText('')).toBe('');
  });

  it('preserves multiline code and inline block text when copying markdown', () => {
    expect(copyableMessageText([
      '## Heading **detail**',
      '',
      '- List *detail*',
      '',
      '```txt',
      'first line   ',
      'second line',
      '',
      '',
      'last line',
      '```',
    ].join('\n'))).toBe([
      'Heading detail',
      'List detail',
      'first line',
      'second line',
      '',
      'last line',
    ].join('\n'));
  });

  it('copies inline and displayed math as its original readable expression', () => {
    expect(copyableMessageText([
      'Inline \\(x^2\\) done.',
      '',
      '\\[',
      'y + 1',
      '\\]',
    ].join('\n'))).toBe('Inline x^2 done.\ny + 1');
  });

  it('copies table cells and escaped HTML in document order', () => {
    expect(copyableMessageText([
      '| Name | Value |',
      '| --- | --- |',
      '| alpha | **one** |',
    ].join('\n'))).toBe('Name\nValue\nalpha\none');
    expect(copyableMessageText('<custom>literal</custom>')).toBe('<custom>literal</custom>');
  });

  it('does not add separators for empty rendered code or math blocks', () => {
    expect(copyableMessageText([
      'before',
      '',
      '```',
      '```',
      '',
      '```txt',
      '',
      'inside',
      '',
      '```',
      '',
      '#',
      '',
      '-',
      '',
      '\\[   \\]',
      '',
      'after',
    ].join('\n'))).toBe('before\ninside\nafter');
  });

  it('returns sanitized rendered HTML', () => {
    const html = copyableMessageHtml('Hello <script>alert(1)</script> **world**');
    expect(html).toContain('<strong>world</strong>');
    expect(html).not.toContain('<script>');
  });

  it('uses the native renderer clipboard when available', async () => {
    const copyToClipboard = vi.fn(async () => undefined);
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { copyToClipboard } as unknown as CodexNativeRendererApi,
    });

    await copyMessageToClipboard('**Done**');
    expect(copyToClipboard).toHaveBeenCalledWith({
      text: 'Done',
      html: '<p><strong>Done</strong></p>',
    });

    await copyMessageToClipboard('');
    expect(copyToClipboard).toHaveBeenLastCalledWith({ text: '' });
  });

  it('uses rich browser clipboard items when supported', async () => {
    const write = vi.fn(async (_items: ClipboardItem[]) => undefined);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });
    const ClipboardItemMock = vi.fn(function ClipboardItem(this: { values: Record<string, Blob> }, values) {
      this.values = values;
    });
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: ClipboardItemMock,
    });

    await copyMessageToClipboard('Hello');
    expect(ClipboardItemMock).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0]![0][0] as unknown as { values: Record<string, Blob> };
    expect(item.values['text/html']?.type).toBe('text/html');
    expect(item.values['text/plain']?.type).toBe('text/plain');
    await expect(item.values['text/html']?.text()).resolves.toBe('<p>Hello</p>');
    await expect(item.values['text/plain']?.text()).resolves.toBe('Hello');
  });

  it.each([
    {
      name: 'ClipboardItem is unavailable',
      clipboard: { write: vi.fn(async () => undefined) },
      installClipboardItem: false,
      content: 'plain text',
    },
    {
      name: 'clipboard.write is unavailable',
      clipboard: {},
      installClipboardItem: true,
      content: 'plain text',
    },
    {
      name: 'the rendered HTML is empty',
      clipboard: { write: vi.fn(async () => undefined) },
      installClipboardItem: true,
      content: '',
    },
  ])('uses plain text when $name', async ({ clipboard, installClipboardItem, content }) => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { ...clipboard, writeText },
    });
    if (installClipboardItem) {
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        value: vi.fn(function ClipboardItem() {}),
      });
    }

    await copyMessageToClipboard(content);

    expect(writeText).toHaveBeenCalledWith(content);
    if ('write' in clipboard) {
      expect(clipboard.write).not.toHaveBeenCalled();
    }
  });

  it('falls back to plain clipboard text without the rich API', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await copyMessageToClipboard('A **plain** message');
    expect(writeText).toHaveBeenCalledWith('A plain message');
  });

  it('copies code as plain text through native host capabilities', async () => {
    const copyToClipboard = vi.fn(async () => undefined);

    await copyTextToClipboard(
      'const value = 1;',
      { copyToClipboard } as unknown as CodexNativeRendererApi,
    );

    expect(copyToClipboard).toHaveBeenCalledWith({ text: 'const value = 1;' });
  });
});
