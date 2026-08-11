// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { CodexCommandSummary, CodexSkillSummary } from '../../src/chat/contracts';
import {
  commandDescription,
  commandDisplayName,
  filterComposerCommands,
  findActiveCommandSlash,
} from '../../src/chat/composer-commands';
import {
  filterComposerSkills,
  findActiveSkillSlash,
  findActiveSkillTrigger,
  promptSkillInputsFromText,
  skillDescription,
  skillDisplayName,
} from '../../src/chat/composer-skills';

describe('composer search ranking', () => {
  it('ranks skill id matches before name matches and description matches', () => {
    const skills: CodexSkillSummary[] = [
      skill({
        name: 'frontend-polish',
        displayName: 'Frontend Polish',
        description: 'Use before handing off and run the DOD checklist.',
      }),
      skill({
        name: 'release-dod',
        displayName: 'Release Definition Of Done',
        description: 'Validate release readiness.',
      }),
      skill({
        id: 'project-dod',
        name: 'project-readiness',
        displayName: 'Project Readiness',
        description: 'Check the project status.',
      }),
      skill({
        name: 'daily-review',
        displayName: 'Daily Review',
        description: 'Do the handoff carefully.',
      }),
    ];

    expect(filterComposerSkills(skills, 'dod').map((entry) => entry.name)).toStrictEqual([
      'project-readiness',
      'release-dod',
      'frontend-polish',
    ]);
  });

  it('ranks command id matches before command name matches and descriptions', () => {
    const commands: CodexCommandSummary[] = [
      command({
        id: 'codex.ship',
        name: 'ship',
        description: 'Run the DOD process.',
      }),
      command({
        id: 'codex.release',
        name: 'release-dod',
        description: 'Prepare release notes.',
      }),
      command({
        id: 'codex.dod',
        name: 'readiness',
        description: 'Check readiness.',
      }),
      command({
        id: 'codex.daily',
        name: 'daily',
        description: 'Do the handoff carefully.',
      }),
    ];

    expect(filterComposerCommands(commands, 'dod').map((entry) => entry.name)).toStrictEqual([
      'readiness',
      'release-dod',
      'ship',
    ]);
  });

  it('keeps original ordering for empty queries', () => {
    const skills: CodexSkillSummary[] = [
      skill({ name: 'alpha' }),
      skill({ name: 'beta' }),
    ];

    expect(filterComposerSkills(skills, '').map((entry) => entry.name)).toStrictEqual(['alpha', 'beta']);
  });

  it('finds command and skill triggers only at valid prompt boundaries', () => {
    expect(findActiveCommandSlash('please /review', 14)).toStrictEqual({
      end: 14,
      query: 'review',
      start: 7,
    });
    expect(findActiveCommandSlash('email@example/test', 18)).toBeNull();
    expect(findActiveCommandSlash('plain text', 10)).toBeNull();
    expect(findActiveCommandSlash('/review later', 13)).toBeNull();
    expect(findActiveCommandSlash('/review', -10)).toBeNull();

    expect(findActiveSkillTrigger('use $release', 12)).toStrictEqual({
      end: 12,
      query: 'release',
      start: 4,
      trigger: '$',
    });
    expect(findActiveSkillSlash('/frontend', 99)).toStrictEqual({
      end: 9,
      query: 'frontend',
      start: 0,
      trigger: '/',
    });
    expect(findActiveSkillTrigger('price$release', 13)).toBeNull();
    expect(findActiveSkillTrigger('$release/next', 13)).toBeNull();
  });

  it('derives unique, enabled catalog skill inputs from both prompt syntaxes', () => {
    const skills = [
      skill({ name: 'review', path: '/skills/review/SKILL.md' }),
      skill({ name: 'tests', path: '/skills/tests/SKILL.md' }),
      skill({ name: 'missing-path', path: '' }),
    ];

    expect(promptSkillInputsFromText(
      'Use $review, then /tests and $review again; ignore user@example.com and /unknown.',
      skills,
    )).toStrictEqual([
      { name: 'review', path: '/skills/review/SKILL.md' },
      { name: 'tests', path: '/skills/tests/SKILL.md' },
    ]);
    expect(promptSkillInputsFromText('Use /missing-path', skills)).toStrictEqual([]);
  });

  it('uses display metadata with stable name and empty-description fallbacks', () => {
    const namedSkill = skill({
      name: 'review',
      displayName: 'Review changes',
      shortDescription: 'Inspect the diff.',
      description: 'Long description.',
    });
    expect(skillDisplayName(namedSkill)).toBe('Review changes');
    expect(skillDescription(namedSkill)).toBe('Inspect the diff.');
    expect(skillDisplayName(skill({ name: 'tests', displayName: undefined }))).toBe('tests');
    expect(skillDescription(skill({ shortDescription: undefined, description: 'Run checks.' }))).toBe('Run checks.');
    expect(skillDescription(skill({ shortDescription: undefined, description: undefined }))).toBe('');

    const pluginSkill = skill({
      name: 'app-69b31dc2110c8191b8b47dc98fe5a052:clean-up-dropbox-content',
    });
    expect(skillDisplayName(pluginSkill, [{
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote',
      name: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      displayName: 'Dropbox',
      enabled: true,
    }])).toBe('dropbox:clean-up-dropbox-content');
    expect(skillDisplayName(pluginSkill)).toBe(pluginSkill.name);
    expect(filterComposerSkills([pluginSkill], 'dropbox', -1, [{
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote',
      name: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      displayName: 'Dropbox',
      enabled: true,
    }])).toStrictEqual([pluginSkill]);

    const namedCommand = command({ name: 'review', displayName: 'Review changes', description: 'Inspect the diff.' });
    expect(commandDisplayName(namedCommand)).toBe('Review changes');
    expect(commandDescription(namedCommand)).toBe('Inspect the diff.');
    expect(commandDisplayName(command({ name: 'tests', displayName: undefined }))).toBe('tests');
    expect(commandDescription(command({ description: undefined }))).toBe('');
  });
});

function skill(overrides: Partial<CodexSkillSummary>): CodexSkillSummary {
  return {
    name: 'frontend-polish',
    path: '/Users/nbonamy/.codex/skills/frontend-polish/SKILL.md',
    enabled: true,
    ...overrides,
  };
}

function command(overrides: Partial<CodexCommandSummary>): CodexCommandSummary {
  return {
    id: 'codex.ship',
    name: 'ship',
    submitOnSelect: true,
    ...overrides,
  };
}
