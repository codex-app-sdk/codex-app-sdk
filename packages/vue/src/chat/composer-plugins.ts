import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import { filterComposerSearchItems } from './composer-search';

export function filterComposerPlugins(
  plugins: CodexSurfacePlugin[],
  query: string,
  maxResults = -1,
): CodexSurfacePlugin[] {
  return filterComposerSearchItems(plugins, query, [
    { values: (plugin) => [plugin.id] },
    { values: (plugin) => [plugin.name, plugin.displayName] },
    { values: (plugin) => [plugin.shortDescription, plugin.longDescription] },
  ], maxResults);
}

export function pluginDisplayName(plugin: CodexSurfacePlugin): string {
  return plugin.displayName || plugin.name;
}

export function pluginDescription(plugin: CodexSurfacePlugin): string {
  return plugin.shortDescription || plugin.longDescription || '';
}

export function pluginInsertText(plugin: CodexSurfacePlugin): string {
  return plugin.name || plugin.id;
}

export function pluginMatchesMention(plugin: CodexSurfacePlugin, mention: string): boolean {
  const normalized = mention.trim().toLowerCase();
  return [plugin.id, plugin.name, plugin.displayName]
    .some((candidate) => candidate.trim().toLowerCase() === normalized);
}
