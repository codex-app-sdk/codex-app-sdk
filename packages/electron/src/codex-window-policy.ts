type CodexNavigationEvent = {
  url: string;
  preventDefault(): void;
};

/** The `WebContents` subset used by `installCodexWindowPolicy`. */
export type CodexWindowPolicyTarget = {
  on(event: 'will-navigate', listener: (event: CodexNavigationEvent) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
};

export type CodexWindowPolicyOptions = {
  /** The URL loaded into the window: the dev server URL or the packaged renderer's `file:` URL. */
  rendererUrl: string;
  /** Usually Electron's `shell.openExternal`. Receives only http(s), mailto, and tel URLs. */
  openExternal(url: string): Promise<void> | void;
};

const externalProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Returns a normalized http(s), mailto, or tel URL that is safe to hand to the OS, otherwise null. */
export function codexExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return externalProtocols.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * True when `url` is the app's own renderer: the same origin as an http(s)
 * dev server, or the same document as a packaged `file:` renderer.
 */
export function isCodexRendererUrl(url: string | null | undefined, rendererUrl: string): boolean {
  if (!url) return false;
  try {
    const target = new URL(url);
    const renderer = new URL(rendererUrl);
    if (renderer.protocol === 'file:') {
      return target.protocol === 'file:' && target.pathname === renderer.pathname;
    }
    return target.origin === renderer.origin;
  } catch {
    return false;
  }
}

/**
 * Keeps a window on the app renderer. Electron re-runs the preload script on
 * every navigation, so any other page the window reached would receive the
 * full Codex bridge. New windows and foreign navigations are denied; safe
 * external URLs open in the system browser instead.
 */
export function installCodexWindowPolicy(
  webContents: CodexWindowPolicyTarget,
  options: CodexWindowPolicyOptions,
): void {
  const openExternal = (value: string) => {
    const url = codexExternalUrl(value);
    if (url) void Promise.resolve(options.openExternal(url)).catch(() => undefined);
  };
  webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event) => {
    if (isCodexRendererUrl(event.url, options.rendererUrl)) return;
    event.preventDefault();
    openExternal(event.url);
  });
}

/**
 * IPC sender predicate for `registerCodexElectronMain`: accepts only the main
 * frame of a window that is currently showing the app renderer.
 */
export function isCodexRendererSender(event: unknown, rendererUrl: string): boolean {
  const frame = (event as { senderFrame?: { parent: unknown; url: string } | null } | null)?.senderFrame;
  return Boolean(frame) && frame!.parent === null && isCodexRendererUrl(frame!.url, rendererUrl);
}
