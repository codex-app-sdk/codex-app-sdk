// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureCodexPortalTheme } from '../../src/chat/portal-theme';

describe('captureCodexPortalTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a light empty theme without an element or CSSOM support', () => {
    expect(captureCodexPortalTheme(null)).toStrictEqual({ mode: 'light', style: {} });

    vi.stubGlobal('getComputedStyle', undefined);
    expect(captureCodexPortalTheme(document.createElement('main'))).toStrictEqual({
      mode: 'light',
      style: {},
    });
  });

  it('captures only nonempty inherited tokens and trims their values', () => {
    const element = document.createElement('main');
    const getPropertyValue = vi.fn((token: string) => ({
      '--color-background': '  #111  ',
      '--color-text': '#eee',
      '--color-text-muted': '   ',
    })[token] ?? '');
    const getComputedStyle = vi.fn(() => ({ colorScheme: 'light dark', getPropertyValue }));
    vi.stubGlobal('getComputedStyle', getComputedStyle);

    expect(captureCodexPortalTheme(element)).toStrictEqual({
      mode: 'dark',
      style: {
        '--color-background': '#111',
        '--color-text': '#eee',
      },
    });
    expect(getComputedStyle).toHaveBeenCalledWith(element);
    expect(getPropertyValue).toHaveBeenCalledWith('--font-family-mono');
    expect(getPropertyValue).toHaveBeenCalledWith('--shadow-lg');
  });

  it.each(['light', '', 'normal'])('uses light mode for color scheme %j', (colorScheme) => {
    vi.stubGlobal('getComputedStyle', () => ({
      colorScheme,
      getPropertyValue: () => '',
    }));

    expect(captureCodexPortalTheme(document.createElement('main'))).toStrictEqual({
      mode: 'light',
      style: {},
    });
  });
});
