// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../../src/vue/chat/message-markdown';

const baseStyles = await readFile(path.resolve('src/vue/base.css'), 'utf8');

beforeEach(() => {
  document.head.innerHTML = `<style>${baseStyles}</style>`;
  document.body.innerHTML = '';
});

describe('base conversation styles', () => {
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
