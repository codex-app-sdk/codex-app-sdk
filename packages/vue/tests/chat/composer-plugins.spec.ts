import { describe, expect, it } from 'vitest';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import {
  filterComposerPlugins,
  pluginDescription,
  pluginDisplayName,
  pluginInsertText,
  pluginMatchesMention,
} from '../../src/chat/composer-plugins';
import { isApprovalPreset } from '../../src/chat/approval-presets';
import { filterComposerMentionGroups, findComposerMention } from '../../src/chat/composer-mentions-custom';

const plugins: CodexSurfacePlugin[] = [
  { id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', shortDescription: 'Read mail', enabled: true },
  { id: 'drive@remote', name: '', displayName: 'Drive', longDescription: 'Search documents', enabled: true },
  { id: 'calendar@remote', name: 'calendar', displayName: '', enabled: true },
];

describe('composer plugin policy', () => {
  it('ranks plugins across identity, name, and description fields', () => {
    expect(filterComposerPlugins(plugins, 'gmail')).toStrictEqual([plugins[0]]);
    expect(filterComposerPlugins(plugins, 'drive')).toStrictEqual([plugins[1]]);
    expect(filterComposerPlugins(plugins, 'documents')).toStrictEqual([plugins[1]]);
    expect(filterComposerPlugins(plugins, '', 2)).toStrictEqual(plugins.slice(0, 2));
    expect(filterComposerPlugins(plugins, 'missing')).toStrictEqual([]);
    expect(filterComposerPlugins(plugins, '')).toStrictEqual(plugins);

    const isolated = [
      { id: 'stable-identity', name: 'friendly', displayName: 'Friendly', enabled: true },
      { id: 'opaque-id', name: 'visible-name', displayName: 'Visible Label', enabled: true },
    ];
    expect(filterComposerPlugins(isolated, 'stable-identity')).toStrictEqual([isolated[0]]);
    expect(filterComposerPlugins(isolated, 'visible-name')).toStrictEqual([isolated[1]]);
  });

  it('derives display, description, and insertion fallbacks', () => {
    expect(pluginDisplayName(plugins[0]!)).toBe('Gmail');
    expect(pluginDisplayName(plugins[2]!)).toBe('calendar');
    expect(pluginDescription(plugins[0]!)).toBe('Read mail');
    expect(pluginDescription(plugins[1]!)).toBe('Search documents');
    expect(pluginDescription(plugins[2]!)).toBe('');
    expect(pluginInsertText(plugins[0]!)).toBe('gmail');
    expect(pluginInsertText(plugins[1]!)).toBe('drive@remote');
  });

  it('matches mentions case-insensitively against all identities', () => {
    expect(pluginMatchesMention(plugins[0]!, ' GMAIL ')).toBe(true);
    expect(pluginMatchesMention(plugins[0]!, 'gmail@remote')).toBe(true);
    expect(pluginMatchesMention(plugins[0]!, 'Gmail')).toBe(true);
    expect(pluginMatchesMention(plugins[0]!, 'drive')).toBe(false);
    expect(pluginMatchesMention({
      id: ' spaced-id ', name: ' spaced-name ', displayName: ' Spaced Label ', enabled: true,
    }, 'spaced-id')).toBe(true);
  });

  it('filters custom mention groups by identity fields and description', () => {
    const groups = [{
      id: 'people',
      label: 'People',
      placement: 'after' as const,
      items: [
        { id: 'stable-id', value: 'person:nico', label: 'Nicolas', description: 'Engineering' },
        { id: 'other-id', value: 'person:ada', label: 'Ada', description: 'Research' },
      ],
    }];

    expect(filterComposerMentionGroups(groups, 'stable-id')).toStrictEqual([{ ...groups[0]!, items: [groups[0]!.items[0]!] }]);
    expect(filterComposerMentionGroups(groups, 'research')).toStrictEqual([{ ...groups[0]!, items: [groups[0]!.items[1]!] }]);
    expect(filterComposerMentionGroups(groups, 'missing')).toStrictEqual([]);
    expect(filterComposerMentionGroups([{ id: 'empty', label: 'Empty', items: [] }], '')).toStrictEqual([]);
  });

  it('finds an exact custom mention after normalization and preserves its group', () => {
    const first = { id: 'first', value: ' person:first ', label: 'First' };
    const target = { id: 'target', value: ' Person:Nico ', label: 'Nicolas', payload: { userId: 42 } };
    const groups = [{ id: 'people', label: 'People', items: [first, target] }];

    expect(findComposerMention(groups, ' person:nico ')).toStrictEqual({ group: groups[0], item: target });
    expect(findComposerMention(groups, 'missing')).toBeUndefined();
    expect(findComposerMention([], 'person:nico')).toBeUndefined();
  });

  it('recognizes only supported approval presets', () => {
    expect(isApprovalPreset('ask-for-approval')).toBe(true);
    expect(isApprovalPreset('approve-for-me')).toBe(true);
    expect(isApprovalPreset('full-access')).toBe(true);
    expect(isApprovalPreset('never')).toBe(false);
    expect(isApprovalPreset(null)).toBe(false);
  });
});
