import type { CodexSurfacePlugin, CodexSurfaceSkill } from '@codex-app-sdk/core/surface';
import { skillDisplayName, skillMatchesMention } from './composer-skills';
import { pluginMatchesMention } from './composer-plugins';

export type CodexUserTextToken =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'line-break' }
  | {
    type: 'plugin-mention';
    displayName: string;
    href: string;
    label: string;
    plugin?: CodexSurfacePlugin;
  }
  | {
    type: 'skill-mention';
    displayName: string;
    href: string;
    label: string;
    skill?: CodexSurfaceSkill;
  };

const userTextTokenRegex = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)|(?<![\w.%+-])([$@/])([A-Za-z0-9_.-]+(?:[ \t]+\([A-Za-z0-9_.-]+\))?)|(\n)/g;
const opaqueAppNameRegex = /^app[-_]?[a-f\d]{16,}$/i;

export function parseCodexUserText(
  content: string,
  plugins: readonly CodexSurfacePlugin[] = [],
  skills: readonly CodexSurfaceSkill[] = [],
): CodexUserTextToken[] {
  const tokens: CodexUserTextToken[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(userTextTokenRegex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: 'text', text: content.slice(lastIndex, index) });

    const raw = match[0];
    const code = match[1];
    const label = match[2];
    const href = match[3];
    const bareTrigger = match[4];
    const bareName = match[5];
    if (code !== undefined) {
      tokens.push({ type: 'code', text: code });
    } else if (label !== undefined && href !== undefined) {
      tokens.push(mentionToken(label, href, plugins, skills) ?? { type: 'text', text: raw });
    } else if (bareTrigger !== undefined && bareName !== undefined) {
      tokens.push(bareMentionToken(bareTrigger, bareName, plugins, skills) ?? { type: 'text', text: raw });
    } else {
      tokens.push({ type: 'line-break' });
    }
    lastIndex = index + raw.length;
  }

  if (lastIndex < content.length) tokens.push({ type: 'text', text: content.slice(lastIndex) });
  return tokens;
}

function bareMentionToken(
  trigger: string,
  name: string,
  plugins: readonly CodexSurfacePlugin[],
  skills: readonly CodexSurfaceSkill[],
): Extract<CodexUserTextToken, { type: 'plugin-mention' | 'skill-mention' }> | null {
  if (trigger === '$') {
    const skill = skills.find((candidate) => skillMatchesMention(candidate, name));
    if (skill) {
      return {
        type: 'skill-mention',
        displayName: skillDisplayName(skill, plugins),
        href: skill.path,
        label: `${trigger}${name}`,
        skill,
      };
    }
  }

  if (trigger !== '@') return null;
  const plugin = plugins.find((candidate) => pluginMatchesMention(candidate, name));
  if (!plugin) return null;
  return {
    type: 'plugin-mention',
    displayName: plugin.displayName || plugin.name,
    href: `plugin://${plugin.id}`,
    label: `${trigger}${name}`,
    plugin,
  };
}

function mentionToken(
  rawLabel: string,
  rawHref: string,
  plugins: readonly CodexSurfacePlugin[],
  skills: readonly CodexSurfaceSkill[],
): Extract<CodexUserTextToken, { type: 'plugin-mention' | 'skill-mention' }> | null {
  const label = rawLabel.trim();
  const href = markdownDestination(rawHref);

  if (label.startsWith('@') && href.startsWith('plugin://')) {
    const pluginId = safeDecode(href.slice('plugin://'.length));
    if (!pluginId) return null;
    const plugin = plugins.find((candidate) => candidate.id === pluginId);
    const fallbackName = label.slice(1) || pluginId.split('@')[0] || 'App';
    return {
      type: 'plugin-mention',
      displayName: plugin?.displayName || humanizeMentionName(fallbackName, 'App'),
      href,
      label,
      ...(plugin ? { plugin } : {}),
    };
  }

  if (label.startsWith('$')) {
    const skillPath = skillPathFromHref(href);
    if (!skillPath) return null;
    const mentionName = label.slice(1);
    const skill = skills.find((candidate) => candidate.path === skillPath);
    return {
      type: 'skill-mention',
      displayName: skill
        ? skillDisplayName(skill, plugins)
        : humanizeMentionName(mentionName, 'Skill'),
      href,
      label,
      ...(skill ? { skill } : {}),
    };
  }

  return null;
}

function markdownDestination(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function skillPathFromHref(href: string): string | null {
  const withoutFragment = href.split('#', 1)[0]?.split('?', 1)[0] ?? '';
  let path = safeDecode(withoutFragment);
  if (path.startsWith('file://')) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch {
      return null;
    }
  }
  return /(?:^|[\\/])SKILL\.md$/i.test(path) ? path : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function humanizeMentionName(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/^[@$]/, '');
  if (!trimmed || opaqueAppNameRegex.test(trimmed)) return fallback;
  return trimmed
    .split(/[-_:\s]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 && part === part.toUpperCase()
      ? part
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
