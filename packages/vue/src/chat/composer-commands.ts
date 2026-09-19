import type { CodexCommandSummary } from './contracts';
import { filterComposerSearchItems } from './composer-search';

export type ActiveCommandSlash = {
  end: number;
  query: string;
  start: number;
};

export function findActiveCommandSlash(value: string, caretPosition: number): ActiveCommandSlash | null {
  const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
  if (safeCaret === 0 || value[0] !== '/') {
    return null;
  }
  const beforeCaret = value.slice(0, safeCaret);
  const query = beforeCaret.slice(1);
  if (/[\s/$]/.test(query)) {
    return null;
  }

  return {
    end: safeCaret,
    query,
    start: 0,
  };
}

export function filterComposerCommands(commands: CodexCommandSummary[], query: string, maxResults = -1): CodexCommandSummary[] {
  return filterComposerSearchItems(commands, query, [
    { values: (command) => [command.id] },
    { values: (command) => [command.name, command.displayName, command.slashName] },
    { values: (command) => [command.description] },
  ], maxResults);
}

export function commandDisplayName(command: CodexCommandSummary): string {
  return command.displayName || command.name;
}

export function commandDescription(command: CodexCommandSummary): string {
  return command.description || '';
}
