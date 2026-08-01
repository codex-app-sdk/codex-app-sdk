import type { CodexSkillSummary, PromptSkillInput } from './contracts';
import { filterComposerSearchItems } from './composer-search';

export type ActiveSkillSlash = {
  end: number;
  query: string;
  start: number;
  trigger: '$' | '/';
};

export function findActiveSkillTrigger(value: string, caretPosition: number, trigger: '$' | '/' = '$'): ActiveSkillSlash | null {
  const safeCaret = Math.max(0, Math.min(caretPosition, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const start = beforeCaret.lastIndexOf(trigger);
  if (start < 0) {
    return null;
  }

  const previous = start > 0 ? beforeCaret[start - 1] : '';
  if (previous && /[\w.%+-]/.test(previous)) {
    return null;
  }

  const query = beforeCaret.slice(start + 1);
  if (/[\s/$]/.test(query)) {
    return null;
  }

  return {
    end: safeCaret,
    query,
    start,
    trigger,
  };
}

export function findActiveSkillSlash(value: string, caretPosition: number): ActiveSkillSlash | null {
  return findActiveSkillTrigger(value, caretPosition, '/');
}

export function filterComposerSkills(skills: CodexSkillSummary[], query: string, maxResults = -1): CodexSkillSummary[] {
  return filterComposerSearchItems(skills, query, [
    { values: (skill) => [skill.id] },
    { values: (skill) => [skill.name, skill.displayName] },
    { values: (skill) => [skill.shortDescription, skill.description] },
  ], maxResults);
}

export function skillDisplayName(skill: CodexSkillSummary): string {
  return skill.displayName || skill.name;
}

export function skillDescription(skill: CodexSkillSummary): string {
  return skill.shortDescription || skill.description || '';
}

export function skillInsertText(skill: Pick<CodexSkillSummary, 'name' | 'path'>): string {
  const alias = /\(([A-Za-z0-9_.-]+)\)\s*$/.exec(skill.name)?.[1];
  if (alias) return alias;
  if (/^[A-Za-z0-9_.-]+$/.test(skill.name)) return skill.name;
  const directoryName = skill.path.replace(/[\\/]+SKILL\.md$/i, '').split(/[\\/]/).at(-1);
  return directoryName || skill.name.trim().replace(/\s+/g, '-').toLowerCase();
}

export function skillMatchesMention(
  skill: { id?: string; name: string; displayName?: string; path: string },
  mention: string,
): boolean {
  const normalized = mention.trim().toLowerCase();
  const directoryName = skill.path.replace(/[\\/]+SKILL\.md$/i, '').split(/[\\/]/).at(-1);
  return [skill.id, skill.name, skill.displayName, directoryName, skillInsertText(skill)]
    .some((candidate) => candidate?.trim().toLowerCase() === normalized);
}

export function promptSkillInputsFromText(text: string, skills: CodexSkillSummary[]): PromptSkillInput[] {
  const names = new Set<string>();
  const pattern = /(?:^|[^\w.%+-])[$/]([A-Za-z0-9_.-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    if (name) names.add(name);
  }

  return skills
    .filter((skill) => [...names].some((name) => skillMatchesMention(skill, name)) && Boolean(skill.path))
    .map((skill) => ({
      name: skill.name,
      path: skill.path,
    }));
}
