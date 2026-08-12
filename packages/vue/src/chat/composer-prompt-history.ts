export type ComposerPromptHistoryDirection = 'ArrowDown' | 'ArrowUp';

export function createComposerPromptHistory(options: {
  apply(value: string): void;
  currentPrompt(): string;
  limit?: number;
}) {
  const entries: string[] = [];
  const limit = Math.max(1, options.limit ?? 100);
  let index: number | null = null;

  function remember(value: string): void {
    entries.push(value);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    index = null;
  }

  function exit(): void {
    index = null;
  }

  function seed(values: readonly string[]): void {
    const next = values.slice(-limit);
    if (next.length === entries.length && next.every((value, entryIndex) => value === entries[entryIndex])) return;
    entries.splice(0, entries.length, ...next);
    index = null;
  }

  function recall(direction: ComposerPromptHistoryDirection): boolean {
    if (entries.length === 0) return false;
    if (index === null && options.currentPrompt() !== '') return false;

    if (direction === 'ArrowUp') {
      index = index === null ? entries.length - 1 : Math.max(0, index - 1);
    } else {
      if (index === null) return false;
      if (index >= entries.length - 1) {
        index = null;
        options.apply('');
        return true;
      }
      index += 1;
    }

    options.apply(entries[index] ?? '');
    return true;
  }

  return { exit, recall, remember, seed };
}
