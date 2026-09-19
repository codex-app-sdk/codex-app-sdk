// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { CodexCommandSummary, CodexSkillSummary } from '../../src/chat/contracts';
import { filterComposerSearchItems } from '../../src/chat/composer-search';
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
  it('ranks field priority before match quality, then score and original order', () => {
    const items = [
      { id: 'secondary-exact', primary: 'unrelated', secondary: 'alpha' },
      { id: 'primary-contains', primary: 'xxalphaxx', secondary: '' },
      { id: 'primary-start', primary: 'alpha suffix', secondary: '' },
      { id: 'primary-exact-first', primary: 'alpha', secondary: '' },
      { id: 'primary-exact-second', primary: 'ALPHA', secondary: '' },
    ];

    expect(filterComposerSearchItems(items, 'alpha', [
      { values: (item) => [item.primary] },
      { values: (item) => [item.secondary] },
    ]).map((item) => item.id)).toStrictEqual([
      'primary-exact-first',
      'primary-exact-second',
      'primary-start',
      'primary-contains',
      'secondary-exact',
    ]);
  });

  it('uses the best value inside a field while retaining the earliest matching field', () => {
    const items = [
      { id: 'dual', primary: ['xxalphaxx'], secondary: ['alpha'] },
      { id: 'best-value', primary: ['xxalphaxx', 'alpha'], secondary: [] },
      { id: 'primary-start', primary: ['alpha suffix'], secondary: [] },
    ];

    expect(filterComposerSearchItems(items, 'alpha', [
      { values: (item) => item.primary },
      { values: (item) => item.secondary },
    ]).map((item) => item.id)).toStrictEqual(['best-value', 'primary-start', 'dual']);
  });

  it('does not let a stronger later-field match replace an earlier-field match', () => {
    const items = [
      { id: 'later-only', primary: '', secondary: 'alpha' },
      { id: 'dual', primary: 'xxalphaxx', secondary: 'alpha' },
    ];

    expect(filterComposerSearchItems(items, 'alpha', [
      { values: (item) => [item.primary] },
      { values: (item) => [item.secondary] },
    ]).map((item) => item.id)).toStrictEqual(['dual', 'later-only']);
  });

  it('ranks true prefixes above suffixes and earlier contains above later contains', () => {
    const fields = [{ values: (item: { label: string }) => [item.label] }];
    const prefixAndSuffix = [
      { id: 'suffix', label: 'xalpha' },
      { id: 'prefix', label: 'alphax' },
    ];
    const contains = [
      { id: 'later', label: 'xxalpha' },
      { id: 'earlier', label: 'xalpha' },
    ];

    expect(filterComposerSearchItems(prefixAndSuffix, 'alpha', fields).map((item) => item.id))
      .toStrictEqual(['prefix', 'suffix']);
    expect(filterComposerSearchItems(contains, 'alpha', fields).map((item) => item.id))
      .toStrictEqual(['earlier', 'later']);
  });

  it('normalizes query whitespace and target case without matching empty values', () => {
    const items = [
      { id: 'match', values: ['PREFIX Alpha SUFFIX'] },
      { id: 'empty', values: ['', null, undefined] },
    ];

    expect(filterComposerSearchItems(items, '  ALPHA  ', [{ values: (item) => item.values }]))
      .toStrictEqual([items[0]]);
    expect(filterComposerSearchItems(items, 'stryker', [{ values: (item) => item.values }]))
      .toStrictEqual([]);
  });

  it('preserves and limits input order for an empty query', () => {
    const items = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
    const fields = [{ values: (item: { id: string }) => [item.id] }];

    expect(filterComposerSearchItems(items, ' \t ', fields)).toStrictEqual(items);
    expect(filterComposerSearchItems(items, '', [])).toStrictEqual(items);
    expect(filterComposerSearchItems(items, '', fields, 2)).toStrictEqual(items.slice(0, 2));
    expect(filterComposerSearchItems(items, '', fields, 0)).toStrictEqual([]);
    expect(filterComposerSearchItems(items, '', fields, -2)).toStrictEqual(items);
  });

  it('drops nonmatches and applies the result limit after ranking', () => {
    const items = [
      { id: 'contains-late', label: 'xxalphaxx' },
      { id: 'missing', label: 'beta' },
      { id: 'exact', label: 'alpha' },
      { id: 'starts', label: 'alphabet' },
    ];

    expect(filterComposerSearchItems(items, 'alpha', [{ values: (item) => [item.label] }], 2))
      .toStrictEqual([items[2], items[3]]);
  });

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

  it('finds command slashes only at the start and skill triggers at valid boundaries', () => {
    expect(findActiveCommandSlash('/review', 7)).toStrictEqual({
      end: 7,
      query: 'review',
      start: 0,
    });
    expect(findActiveCommandSlash(' /review', 8)).toBeNull();
    expect(findActiveCommandSlash('please /review', 14)).toBeNull();
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
