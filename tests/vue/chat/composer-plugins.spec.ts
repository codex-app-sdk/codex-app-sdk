import { describe, expect, it } from 'vitest';
import type { CodexSurfacePlugin } from '../../../src/surface';
import {
  filterComposerPlugins,
  pluginDescription,
  pluginDisplayName,
  pluginInsertText,
  pluginMatchesMention,
} from '../../../packages/vue/src/chat/composer-plugins';
import { isApprovalPreset } from '../../../packages/vue/src/chat/approval-presets';

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
  });

  it('recognizes only supported approval presets', () => {
    expect(isApprovalPreset('ask-for-approval')).toBe(true);
    expect(isApprovalPreset('approve-for-me')).toBe(true);
    expect(isApprovalPreset('full-access')).toBe(true);
    expect(isApprovalPreset('never')).toBe(false);
    expect(isApprovalPreset(null)).toBe(false);
  });
});
