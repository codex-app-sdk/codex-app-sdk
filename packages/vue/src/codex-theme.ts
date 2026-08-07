export type CodexThemeMode = 'dark' | 'light' | 'system';

export type CodexThemeOptions = {
  mode?: CodexThemeMode;
  /** CSS custom properties. Both `--codex-*` and semantic names are accepted. */
  tokens?: Readonly<Record<string, string | null | undefined>>;
};

/**
 * Applies the optional SDK theme contract to an application-owned element.
 * The SDK never owns or mutates the surrounding application shell.
 */
export function applyCodexTheme(
  element: HTMLElement,
  options: CodexThemeOptions = {},
): () => void {
  const previousTheme = element.getAttribute('data-codex-theme');
  const previousTokens = new Map<string, string>();
  const mode = options.mode ?? 'system';
  element.setAttribute('data-codex-theme', mode);

  for (const [rawName, value] of Object.entries(options.tokens ?? {})) {
    const name = codexThemeTokenName(rawName);
    previousTokens.set(name, element.style.getPropertyValue(name));
    if (value === null || value === undefined || !value.trim()) {
      element.style.removeProperty(name);
    } else {
      element.style.setProperty(name, value);
    }
  }

  return () => {
    if (previousTheme === null) element.removeAttribute('data-codex-theme');
    else element.setAttribute('data-codex-theme', previousTheme);
    for (const [name, value] of previousTokens) {
      if (value) element.style.setProperty(name, value);
      else element.style.removeProperty(name);
    }
  };
}

function codexThemeTokenName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith('--codex-')) return trimmed;
  const normalized = trimmed
    .replace(/^--/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z\d-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!normalized) throw new TypeError('Codex theme token names cannot be empty');
  return `--codex-${normalized}`;
}
