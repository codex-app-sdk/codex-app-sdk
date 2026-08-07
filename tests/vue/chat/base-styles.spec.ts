// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../../packages/vue/src/chat/message-markdown';

const baseStyles = await readFile(path.resolve('packages/vue/src/base.css'), 'utf8');

beforeEach(() => {
  document.head.innerHTML = `<style>${baseStyles}</style>`;
  document.body.innerHTML = '';
});

describe('base conversation styles', () => {
  it('keeps normal message text slightly lighter and smaller than the configured size', () => {
    expect(baseStyles).toContain('.codex-markdown.chat-message-block--text {');
    expect(baseStyles).toContain('font-size: calc(var(--chat-font-size, var(--chat-message-font-size, var(--font-size-15))) - 0.5px);');
    expect(baseStyles).toContain('font-weight: var(--chat-message-font-weight, 350);');
  });

  it('matches Codex message rhythm and emphasis', () => {
    document.body.innerHTML = `
      <div
        class="codex-markdown chat-user-text chat-message-block--text"
        style="
          --chat-font-size: 15px;
          --font-size-14: 14px;
          --font-size-15: 15px;
          --font-size-16: 16px;
          --font-size-20: 20px;
          --font-size-24: 24px;
          --font-weight-bold: 600;
          --line-height-22: 22px;
          --line-height-24: 24px;
          --line-height-28: 28px;
          --space-2: 4px;
          --space-3: 6px;
          --space-4: 8px;
          --space-6: 12px;
          --space-10: 20px;
          --space-12: 24px;
          --radius-xs: 2px;
          --radius-md: 6px;
        "
      >
        <p>Paragraph with <strong>emphasis</strong> and <code>inline code</code>.</p>
        <ul><li>First</li><li>Second</li></ul>
        <h1>Heading</h1>
        <blockquote><p>Quoted text</p></blockquote>
      </div>
    `;

    const markdown = document.querySelector('.codex-markdown')!;
    const strong = document.querySelector('strong')!;
    const inlineCode = document.querySelector('code')!;
    const secondItem = document.querySelector('li + li')!;
    const heading = document.querySelector('h1')!;
    const quote = document.querySelector('blockquote')!;

    expect(getComputedStyle(markdown).lineHeight).toBe('var(--chat-message-line-height, 1.55)');
    expect(baseStyles).toContain('.codex-markdown.chat-user-text {\n  padding: var(--space-3) var(--space-6);\n}');
    expect(getComputedStyle(strong).fontWeight).toBe('var(--chat-message-strong-font-weight, 500)');
    expect(getComputedStyle(inlineCode).borderRadius).toBe('var(--radius-md)');
    expect(getComputedStyle(secondItem).marginTop).toBe('var(--space-4)');
    expect(getComputedStyle(heading).fontSize).toBe('var(--font-size-24)');
    expect(getComputedStyle(quote).color).toBe('var(--color-text)');
  });

  it('lets highlighted code tokens inherit the monospace code font', () => {
    const codeBlock = renderMarkdown([
      '```sh',
      "pkill -f '/Applications/Codex Claw.app/Contents/Resources/clawd/clawd.mjs serve'",
      '```',
    ].join('\n'));

    document.body.innerHTML = `
      <div
        class="codex-chat-theme"
        style="--font-family-base: BaseFont; --font-family-mono: MonoFont"
      >
        <div class="codex-markdown">${codeBlock}</div>
      </div>
    `;

    const theme = document.querySelector('.codex-chat-theme');
    const code = document.querySelector('code');
    const token = document.querySelector('code span span');

    expect(theme).not.toBeNull();
    expect(code).not.toBeNull();
    expect(token).not.toBeNull();
    const themeFont = getComputedStyle(theme!).fontFamily;
    const codeFont = getComputedStyle(code!).fontFamily;
    const tokenFont = getComputedStyle(token!).fontFamily;

    expect(tokenFont).toBe(codeFont);
    expect(tokenFont).not.toBe(themeFont);
  });
});
