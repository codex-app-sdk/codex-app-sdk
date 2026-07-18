// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { applyCodexTheme } from '../../src/vue/codex-theme';

describe('applyCodexTheme', () => {
  it('applies an optional theme contract without taking ownership of the app shell', () => {
    const shell = document.createElement('main');
    shell.setAttribute('data-codex-theme', 'light');
    shell.style.setProperty('--codex-text-color', '#111');

    const restore = applyCodexTheme(shell, {
      mode: 'dark',
      tokens: {
        textColor: '#eee',
        '--codex-surface-color': '#151515',
      },
    });

    expect(shell.getAttribute('data-codex-theme')).toBe('dark');
    expect(shell.style.getPropertyValue('--codex-text-color')).toBe('#eee');
    expect(shell.style.getPropertyValue('--codex-surface-color')).toBe('#151515');

    restore();
    expect(shell.getAttribute('data-codex-theme')).toBe('light');
    expect(shell.style.getPropertyValue('--codex-text-color')).toBe('#111');
    expect(shell.style.getPropertyValue('--codex-surface-color')).toBe('');
  });

  it('defaults to system mode and rejects empty token names', () => {
    const element = document.createElement('div');
    applyCodexTheme(element);
    expect(element.getAttribute('data-codex-theme')).toBe('system');
    expect(() => applyCodexTheme(element, { tokens: { '---': '#fff' } })).toThrow(
      'Codex theme token names cannot be empty',
    );
  });
});
