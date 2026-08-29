import { filterComposerSearchItems } from './composer-search';

export type CodexComposerMentionItem<Payload = unknown> = {
  id: string;
  /** Stable text stored after the `@` prefix. */
  value: string;
  /** Friendly text rendered by the default mention UI. */
  label: string;
  description?: string;
  payload?: Payload;
};

export type CodexComposerMentionGroup<Payload = unknown> = {
  id: string;
  label: string;
  /** Custom groups render before built-in plugins/files unless explicitly placed after them. */
  placement?: 'before' | 'after';
  items: readonly CodexComposerMentionItem<Payload>[];
};

export type CodexComposerVisibleMentionGroup<Payload = unknown> = Omit<
  CodexComposerMentionGroup<Payload>,
  'items'
> & {
  items: readonly CodexComposerMentionItem<Payload>[];
};

export function filterComposerMentionGroups<Payload>(
  groups: readonly CodexComposerMentionGroup<Payload>[],
  query: string,
): CodexComposerVisibleMentionGroup<Payload>[] {
  return groups.flatMap((group) => {
    const items = filterComposerSearchItems([...group.items], query, [
      { values: (item) => [item.id, item.value, item.label] },
      { values: (item) => [item.description] },
    ]);
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

export function findComposerMention<Payload>(
  groups: readonly CodexComposerMentionGroup<Payload>[],
  value: string,
): { group: CodexComposerMentionGroup<Payload>; item: CodexComposerMentionItem<Payload> } | undefined {
  const normalized = value.trim().toLowerCase();
  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.value.trim().toLowerCase() === normalized);
    if (item) return { group, item };
  }
  return undefined;
}
