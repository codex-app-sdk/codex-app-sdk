const inheritedThemeTokens = [
  '--color-background',
  '--color-text',
  '--color-text-muted',
  '--color-border',
  '--color-border-strong',
  '--color-error',
  '--color-warning',
  '--color-success',
  '--color-primary',
  '--color-primary-container',
  '--color-secondary',
  '--color-secondary-container',
  '--color-on-primary',
  '--color-on-primary-container',
  '--color-on-secondary-container',
  '--color-overlay',
  '--color-surface-lowest',
  '--color-surface',
  '--color-surface-base',
  '--color-surface-low',
  '--color-surface-high',
  '--color-surface-highest',
  '--color-shell-main',
  '--font-family-base',
  '--font-family-mono',
  '--font-size-12',
  '--font-size-13',
  '--line-height-16',
  '--line-height-20',
  '--space-2',
  '--space-4',
  '--space-6',
  '--space-8',
  '--space-12',
  '--space-16',
  '--radius-md',
  '--radius-lg',
  '--shadow-lg',
] as const;

export type CodexPortalTheme = {
  mode: 'dark' | 'light';
  style: Record<string, string>;
};

export function captureCodexPortalTheme(element: Element | null): CodexPortalTheme {
  if (!element || typeof getComputedStyle !== 'function') {
    return { mode: 'light', style: {} };
  }

  const computed = getComputedStyle(element);
  const style: Record<string, string> = {};
  for (const token of inheritedThemeTokens) {
    const value = computed.getPropertyValue(token).trim();
    if (value) style[token] = value;
  }

  return {
    mode: computed.colorScheme.includes('dark') ? 'dark' : 'light',
    style,
  };
}
