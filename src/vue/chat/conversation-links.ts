import type { CodexConversationLink } from './contracts';

export type CodexEditorFileReference = {
  path: string;
  line: number;
  column?: number;
};

export function parseCodexEditorFileReference(value: string): CodexEditorFileReference | null {
  const match = /^(.*\.[^./\\:\s]+):(\d+)(?::(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const filePath = match[1]?.trim() ?? '';
  if (!filePath || filePath.includes(':')) return null;
  const line = Number(match[2]);
  const column = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isSafeInteger(line) || line <= 0) return null;
  if (column !== undefined && (!Number.isSafeInteger(column) || column <= 0)) return null;
  return { path: filePath, line, ...(column === undefined ? {} : { column }) };
}

export function codexConversationLinkFromHref(href: string): CodexConversationLink | null {
  const normalizedHref = href.trim();
  if (!normalizedHref || /^(?:\\\\|\/\/)/.test(normalizedHref)) return null;
  if (/^[a-z]:[\\/]/i.test(normalizedHref)) {
    return { href: normalizedHref, kind: 'file', path: safelyDecodePath(stripLinkDecoration(normalizedHref)) };
  }

  const undecoratedHref = safelyDecodePath(stripLinkDecoration(normalizedHref));
  const relativeEditorReference = parseCodexEditorFileReference(undecoratedHref);
  if (relativeEditorReference) {
    return fileReferenceLink(normalizedHref, relativeEditorReference);
  }

  try {
    const url = new URL(normalizedHref);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' || url.protocol === 'tel:') {
      return { href: normalizedHref, kind: 'external' };
    }
    if (url.protocol === 'file:') {
      const filePath = safelyDecodePath(url.pathname);
      const editorReference = parseCodexEditorFileReference(filePath);
      return editorReference
        ? fileReferenceLink(normalizedHref, editorReference)
        : { href: normalizedHref, kind: 'file', path: filePath };
    }
    return null;
  } catch {
    return undecoratedHref ? { href: normalizedHref, kind: 'file', path: undecoratedHref } : null;
  }
}

function fileReferenceLink(
  href: string,
  reference: CodexEditorFileReference,
): Extract<CodexConversationLink, { kind: 'file' }> {
  return {
    href,
    kind: 'file',
    path: reference.path,
    line: reference.line,
    ...(reference.column === undefined ? {} : { column: reference.column }),
  };
}

function stripLinkDecoration(href: string): string {
  return href.split('#', 1)[0]?.split('?', 1)[0]?.trim() ?? '';
}

function safelyDecodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
