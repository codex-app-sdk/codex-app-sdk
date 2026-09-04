// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { applyCodexTheme } from '../src/codex-theme';

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
    const restore = applyCodexTheme(element);
    expect(element.getAttribute('data-codex-theme')).toBe('system');
    restore();
    expect(element.hasAttribute('data-codex-theme')).toBe(false);
    expect(() => applyCodexTheme(element, { tokens: { '---': '#fff' } })).toThrow(
      'Codex theme token names cannot be empty',
    );
  });

  it('removes every empty token value and restores its previous value', () => {
    const element = document.createElement('div');
    for (const name of ['null-value', 'undefined-value', 'empty-value', 'blank-value']) {
      element.style.setProperty(`--codex-${name}`, name);
    }

    const setProperty = vi.spyOn(element.style, 'setProperty');
    const removeProperty = vi.spyOn(element.style, 'removeProperty');
    const restore = applyCodexTheme(element, {
      tokens: {
        nullValue: null,
        undefinedValue: undefined,
        emptyValue: '',
        blankValue: '   ',
      },
    });

    expect(element.getAttribute('style')).toBe('');
    expect(removeProperty).toHaveBeenCalledWith('--codex-blank-value');
    expect(setProperty).not.toHaveBeenCalledWith('--codex-blank-value', expect.anything());
    restore();
    expect(element.style.getPropertyValue('--codex-null-value')).toBe('null-value');
    expect(element.style.getPropertyValue('--codex-undefined-value')).toBe('undefined-value');
    expect(element.style.getPropertyValue('--codex-empty-value')).toBe('empty-value');
    expect(element.style.getPropertyValue('--codex-blank-value')).toBe('blank-value');
  });

  it('normalizes semantic token names without rewriting direct Codex tokens', () => {
    const element = document.createElement('div');
    applyCodexTheme(element, {
      tokens: {
        '  accentColor  ': 'red',
        'token--name': 'blue',
        level2Color: 'green',
        'foo  // bar': 'yellow',
        '-----edge---': 'pink',
        '  --codex-direct  ': 'purple',
      },
    });

    expect(element.style.getPropertyValue('--codex-accent-color')).toBe('red');
    expect(element.style.getPropertyValue('--codex-token--name')).toBe('blue');
    expect(element.style.getPropertyValue('--codex-level2-color')).toBe('green');
    expect(element.style.getPropertyValue('--codex-foo-bar')).toBe('yellow');
    expect(element.style.getPropertyValue('--codex-edge')).toBe('pink');
    expect(element.style.getPropertyValue('--codex-direct')).toBe('purple');
  });

  it('restores the original token when accepted aliases normalize to the same name', () => {
    const element = document.createElement('div');
    element.style.setProperty('--codex-text-color', 'original');

    const restore = applyCodexTheme(element, {
      tokens: {
        textColor: 'first',
        'text-color': 'second',
      },
    });

    expect(element.style.getPropertyValue('--codex-text-color')).toBe('second');
    restore();
    expect(element.style.getPropertyValue('--codex-text-color')).toBe('original');
  });
});
