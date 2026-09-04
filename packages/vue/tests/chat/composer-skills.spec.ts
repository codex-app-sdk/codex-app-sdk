import { describe, expect, it } from 'vitest';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import {
  findActiveSkillSlash,
  findActiveSkillTrigger,
  promptSkillInputsFromText,
  skillDisplayName,
  skillInsertText,
  skillMatchesMention,
} from '../../src/chat/composer-skills';
import type { CodexSkillSummary } from '../../src/chat/contracts';

describe('composer skills', () => {
  it('finds the latest skill trigger at a clamped mid-string caret', () => {
    expect(findActiveSkillTrigger('use $old then $new trailing', 18)).toStrictEqual({
      end: 18,
      query: 'new',
      start: 14,
      trigger: '$',
    });
    expect(findActiveSkillSlash('/review', 99)).toStrictEqual({
      end: 7,
      query: 'review',
      start: 0,
      trigger: '/',
    });
    expect(findActiveSkillTrigger('$review', -1)).toBeNull();
    expect(findActiveSkillTrigger('plain', 5)).toBeNull();
  });

  it.each(['a', 'Z', '0', '_', '.', '%', '+', '-'])(
    'rejects a skill trigger after the token character %s',
    (previous) => {
      expect(findActiveSkillTrigger(`${previous}$skill`, previous.length + 6)).toBeNull();
    },
  );

  it.each([' ', '\t', '/', '$'])(
    'rejects a skill query containing %j',
    (separator) => {
      expect(findActiveSkillTrigger(`$ski${separator}ll`, 7)).toBeNull();
    },
  );

  it('allows triggers after punctuation and returns an empty query', () => {
    expect(findActiveSkillTrigger('($', 2)).toStrictEqual({
      end: 2,
      query: '',
      start: 1,
      trigger: '$',
    });
  });

  it('prefers explicit skill display metadata and rejects malformed namespaces', () => {
    expect(skillDisplayName(skill({ name: 'plugin:tool', displayName: 'Explicit' }))).toBe('Explicit');
    expect(skillDisplayName(skill({ name: ':tool' }), [plugin({ id: '@remote', name: 'other' })])).toBe(':tool');
    expect(skillDisplayName(skill({ name: 'plugin:' }))).toBe('plugin:');
    expect(skillDisplayName(skill({ name: 'plain' }))).toBe('plain');
    expect(skillDisplayName(skill({ name: 'missing:tool' }), [])).toBe('missing:tool');

    const plugins = [plugin({ id: 'plai', name: 'plai', displayName: 'Wrong' })];
    expect(skillDisplayName(skill({ name: 'plain' }), plugins)).toBe('plain');
    expect(skillDisplayName(skill({ name: 'plugin:' }), [plugin({ id: 'plugin', name: 'plugin', displayName: 'Wrong' })]))
      .toBe('plugin:');
    expect(skillDisplayName(skill({ name: 'missing:tool' }), [plugin({ id: 'other', name: 'other' })]))
      .toBe('missing:tool');
  });

  it.each([
    ['id', { id: 'plugin', name: 'different' }],
    ['name', { id: 'different', name: 'plugin' }],
    ['versioned id', { id: 'plugin@remote', name: 'different' }],
  ] as const)('matches a plugin by %s and normalizes its namespace', (_kind, identity) => {
    const plugin: CodexSurfacePlugin = {
      ...identity,
      displayName: '  My CLOUD! App  ',
      enabled: true,
    };
    expect(skillDisplayName(skill({ name: 'plugin:clean-up' }), [plugin])).toBe('my-cloud-app:clean-up');
  });

  it('falls back to the plugin name when its display name has no namespace characters', () => {
    const plugin: CodexSurfacePlugin = {
      id: 'plugin@remote',
      name: 'fallback-name',
      displayName: ' !!! ',
      enabled: true,
    };
    expect(skillDisplayName(skill({ name: 'plugin:tool' }), [plugin])).toBe('fallback-name:tool');
  });

  it('derives insertion text from an alias, safe name, path, or normalized fallback', () => {
    expect(skillInsertText({ name: 'Fancy Skill (alias_1)   ', path: '/skills/fancy/SKILL.md' })).toBe('alias_1');
    expect(skillInsertText({ name: 'Safe.Name-1', path: '/ignored/SKILL.md' })).toBe('Safe.Name-1');
    expect(skillInsertText({ name: 'Fancy Skill', path: '/skills/fancy-name/SKILL.md' })).toBe('fancy-name');
    expect(skillInsertText({ name: 'Windows Skill', path: 'C:\\skills\\windows-name\\skill.MD' })).toBe('windows-name');
    expect(skillInsertText({ name: 'Repeated Separator', path: '/skills/repeated///SKILL.md' })).toBe('repeated');
    expect(skillInsertText({ name: '  Fallback   Name  ', path: '' })).toBe('fallback-name');
    expect(skillInsertText({ name: 'Skill (alias) suffix', path: '/skills/from-path/SKILL.md' })).toBe('from-path');
    expect(skillInsertText({ name: 'Backup Skill', path: '/skills/name/SKILL.md.backup' })).toBe('SKILL.md.backup');
  });

  it.each([
    ['id', { id: 'stable-id' }, ' STABLE-ID '],
    ['name', {}, ' skill-name '],
    ['display name', { displayName: 'Display Label' }, 'display label'],
    ['directory', { path: '/skills/directory-name/SKILL.md' }, 'directory-name'],
    ['insert alias', { name: 'Fancy Skill (alias)' }, 'ALIAS'],
  ] as const)('matches a mention by %s case-insensitively', (_kind, overrides, mention) => {
    expect(skillMatchesMention(skill({ name: 'skill-name', ...overrides }), mention)).toBe(true);
  });

  it('rejects a mention that matches no stable skill identity', () => {
    expect(skillMatchesMention(skill({ name: 'skill-name' }), 'other')).toBe(false);
  });

  it('matches exact directory names without treating embedded skill filenames as suffixes', () => {
    expect(skillMatchesMention(
      skill({ name: 'safe-backup', path: '/skills/name/SKILL.md.backup' }),
      'skill.md.backup',
    )).toBe(true);
    expect(skillMatchesMention(
      skill({ name: 'safe-repeated', path: '/skills/repeated///SKILL.md' }),
      'repeated',
    )).toBe(true);
  });

  it('extracts unique start-of-input and punctuated skill inputs while rejecting token lookalikes', () => {
    const skills = [
      skill({ name: 'start-only', path: '/skills/start-only/SKILL.md' }),
      skill({ name: 'review', path: '/skills/review/SKILL.md' }),
      skill({ name: 'tests', path: '/skills/tests/SKILL.md' }),
      skill({ name: 'missing', path: '' }),
    ];
    expect(promptSkillInputsFromText(
      '$start-only, then $review, (/tests), and $review; reject email@example.com/$tests and word$tests plus /missing.',
      skills,
    )).toStrictEqual([
      { name: 'start-only', path: '/skills/start-only/SKILL.md' },
      { name: 'review', path: '/skills/review/SKILL.md' },
      { name: 'tests', path: '/skills/tests/SKILL.md' },
    ]);
  });
});

function skill(overrides: Partial<CodexSkillSummary>): CodexSkillSummary {
  return {
    name: 'skill-name',
    path: '/skills/skill-name/SKILL.md',
    enabled: true,
    ...overrides,
  };
}

function plugin(overrides: Partial<CodexSurfacePlugin>): CodexSurfacePlugin {
  return {
    id: 'plugin',
    name: 'plugin',
    displayName: 'Plugin',
    enabled: true,
    ...overrides,
  };
}
