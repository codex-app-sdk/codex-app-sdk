// @vitest-environment jsdom

import { nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { CodexFileSearchItem, CodexCommandSummary, CodexSkillSummary } from '../../src/chat/contracts';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import { useChatComposerSuggestions } from '../../src/chat/use-chat-composer-suggestions';
import type { CodexComposerMentionGroup } from '../../src/chat/composer-mentions-custom';

const files: CodexFileSearchItem[] = [
  { name: 'alpha.ts', path: 'src/alpha.ts' },
  { name: 'beta.ts', path: 'src/beta.ts' },
];
const skills: CodexSkillSummary[] = [
  { name: 'frontend', path: '/skills/frontend/SKILL.md', scope: 'project', enabled: true },
  { name: 'testing', path: '/skills/testing/SKILL.md', scope: 'user', enabled: true },
];
const commands: CodexCommandSummary[] = [
  { id: 'codex:compact', name: 'compact', slashName: 'compact', submitOnSelect: true },
];
const plugins: CodexSurfacePlugin[] = [
  { id: 'ts@remote', name: 'ts', displayName: 'TypeScript', enabled: true },
];

function setup(
  initialPrompt: string,
  overrides: Partial<{
    autoSync: boolean;
    commands: () => readonly CodexCommandSummary[];
    disabled: () => boolean;
    editor: { getSelectionRange: () => { end: number; start: number; valid: boolean } } | null;
    files: () => readonly CodexFileSearchItem[];
    isSending: () => boolean;
    mentionGroups: () => readonly CodexComposerMentionGroup[];
    plugins: () => readonly CodexSurfacePlugin[];
    skills: () => readonly CodexSkillSummary[];
    skillsEnabled: () => boolean;
    withMentionCallback: boolean;
  }> = {},
) {
  const prompt = ref(initialPrompt);
  const caretPosition = ref(initialPrompt.length);
  const editor = ref(overrides.editor === undefined ? {
    getSelectionRange: () => ({
      end: caretPosition.value,
      start: caretPosition.value,
      valid: true,
    }),
  } : overrides.editor);
  const onCommandSubmitted = vi.fn();
  const onTextInserted = vi.fn();
  const onMentionSelected = vi.fn();
  const suggestions = useChatComposerSuggestions({
    caretPosition,
    commands: overrides.commands ?? (() => commands),
    disabled: overrides.disabled ?? (() => false),
    files: overrides.files ?? (() => files),
    plugins: overrides.plugins,
    mentionGroups: overrides.mentionGroups,
    isSending: overrides.isSending ?? (() => false),
    onCommandSubmitted,
    onTextInserted,
    onMentionSelected: overrides.withMentionCallback === false ? undefined : onMentionSelected,
    prompt,
    skills: overrides.skills ?? (() => skills),
    skillsEnabled: overrides.skillsEnabled ?? (() => true),
    editor,
  });
  if (overrides.autoSync !== false) suggestions.sync();
  return { caretPosition, editor, onCommandSubmitted, onMentionSelected, onTextInserted, prompt, suggestions };
}

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, key, ...init });
}

describe('useChatComposerSuggestions', () => {
  it('starts every menu closed with zeroed selection indices', () => {
    const atState = setup('@ts', {
      autoSync: false,
      plugins: () => plugins,
    });
    const skillState = setup('$front', {
      autoSync: false,
      plugins: () => plugins,
    });
    const slashState = setup('/comp', { autoSync: false });

    expect(atState.suggestions.atMenuVisible.value).toBe(false);
    expect(skillState.suggestions.skillMenuVisible.value).toBe(false);
    expect(skillState.suggestions.pluginMenuVisible.value).toBe(false);
    expect(slashState.suggestions.slashMenuVisible.value).toBe(false);
    expect([
      atState.suggestions.activeAtIndex.value,
      atState.suggestions.activeFileIndex.value,
      skillState.suggestions.activeSkillIndex.value,
      skillState.suggestions.activePluginIndex.value,
      slashState.suggestions.activeSlashIndex.value,
    ]).toStrictEqual([0, 0, 0, 0, 0]);
  });

  it('shows the bare mention hint and limits matching files to five', async () => {
    const matchingFiles = Array.from({ length: 7 }, (_, index) => ({
      name: `match-${index}.ts`,
      path: `src/match-${index}.ts`,
    }));
    const state = setup('@', { files: () => matchingFiles });
    await nextTick();

    expect(state.suggestions.fileMenuShowsHint.value).toBe(true);
    expect(state.suggestions.fileMenuVisible.value).toBe(true);
    expect(state.suggestions.atMenuVisible.value).toBe(true);
    expect(state.suggestions.visibleFiles.value).toStrictEqual([]);

    state.prompt.value = '@match';
    state.caretPosition.value = state.prompt.value.length;
    state.suggestions.sync();
    await nextTick();

    expect(state.suggestions.fileMenuShowsHint.value).toBe(false);
    expect(state.suggestions.visibleFiles.value.map((file) => file.path)).toStrictEqual([
      'src/match-0.ts',
      'src/match-1.ts',
      'src/match-2.ts',
      'src/match-3.ts',
      'src/match-4.ts',
    ]);
  });

  it('hides suggestions for disabled idle input but keeps them available while sending', async () => {
    const idle = setup('@ts', {
      disabled: () => true,
      isSending: () => false,
    });
    const sending = setup('@ts', {
      disabled: () => true,
      isSending: () => true,
    });
    await nextTick();

    expect(idle.suggestions.fileMenuVisible.value).toBe(false);
    expect(idle.suggestions.atMenuVisible.value).toBe(false);
    expect(sending.suggestions.fileMenuVisible.value).toBe(true);
    expect(sending.suggestions.atMenuVisible.value).toBe(true);
  });

  it('requires the matching context, a catalog, and an open menu', async () => {
    const closed = setup('@ts');
    await nextTick();
    expect(closed.suggestions.fileMenuVisible.value).toBe(true);
    closed.suggestions.close();
    expect(closed.suggestions.fileMenuVisible.value).toBe(false);

    const noMention = setup('plain text');
    const noFiles = setup('@', { files: () => [] });
    await nextTick();
    expect(noMention.suggestions.fileMenuShowsHint.value).toBe(false);
    expect(noMention.suggestions.fileMenuVisible.value).toBe(false);
    expect(noFiles.suggestions.fileMenuShowsHint.value).toBe(false);
    expect(noFiles.suggestions.fileMenuVisible.value).toBe(false);
    expect(noFiles.suggestions.atMenuVisible.value).toBe(false);
  });

  it('uses empty queries when no skill, plugin, mention, or command token is active', () => {
    const group = {
      id: 'people',
      label: 'People',
      items: [{ id: 'person', value: 'person:nico', label: 'Nicolas' }],
    } satisfies CodexComposerMentionGroup;
    const state = setup('plain text', {
      mentionGroups: () => [group],
      plugins: () => plugins,
    });

    expect(state.suggestions.visibleSkills.value).toStrictEqual(skills);
    expect(state.suggestions.visiblePlugins.value).toStrictEqual(plugins);
    expect(state.suggestions.visibleMentionGroups.value).toStrictEqual([group]);
    expect(state.suggestions.visibleSlashCommands.value).toStrictEqual(commands);
  });

  it('filters namespaced skills by the canonical plugin display namespace', () => {
    const contributedSkill: CodexSkillSummary = {
      name: 'ts@remote:review',
      path: '/skills/review/SKILL.md',
      enabled: true,
    };
    const state = setup('$typescript', {
      plugins: () => plugins,
      skills: () => [contributedSkill],
    });

    expect(state.suggestions.visibleSkills.value).toStrictEqual([contributedSkill]);
  });

  it('supports omitted optional suggestion catalogs', () => {
    const state = setup('plain text');

    expect(state.suggestions.visiblePlugins.value).toStrictEqual([]);
    expect(state.suggestions.visibleMentionGroups.value).toStrictEqual([]);
    expect(state.suggestions.pluginMenuVisible.value).toBe(false);
  });

  it('shows only the skill menu for dollar triggers', async () => {
    const state = setup('$ts', {
      plugins: () => plugins,
    });
    await nextTick();

    expect(state.suggestions.skillMenuVisible.value).toBe(true);
    expect(state.suggestions.pluginMenuVisible.value).toBe(false);
    expect(state.suggestions.atMenuVisible.value).toBe(false);
    expect(state.suggestions.slashMenuVisible.value).toBe(false);
  });

  it('hides skill and slash menus when their result catalogs are empty', async () => {
    const skillDisabled = setup('$front', { skillsEnabled: () => false });
    const noSkills = setup('$front', { skills: () => [] });
    const noCommands = setup('/', { commands: () => [] });
    await nextTick();

    expect(skillDisabled.suggestions.skillMenuVisible.value).toBe(false);
    expect(noSkills.suggestions.skillMenuVisible.value).toBe(false);
    expect(noCommands.suggestions.slashMenuVisible.value).toBe(false);
  });

  it('keeps slash results empty when skills are disabled and there are no commands', async () => {
    const state = setup('/', {
      commands: () => [],
      skillsEnabled: () => false,
    });
    await nextTick();

    expect(state.suggestions.visibleSlashSkills.value).toStrictEqual([]);
    expect(state.suggestions.slashMenuVisible.value).toBe(false);
  });

  it('hides a stale open slash menu as soon as its token disappears', async () => {
    const state = setup('/comp');
    await nextTick();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);

    state.prompt.value = 'plain text';
    state.caretPosition.value = state.prompt.value.length;
    await nextTick();

    expect(state.suggestions.slashMenuVisible.value).toBe(false);
  });

  it('hides stale open mention and skill menus as soon as their tokens disappear', async () => {
    const atState = setup('@ts', { plugins: () => plugins });
    const skillState = setup('$front');
    await nextTick();
    expect(atState.suggestions.fileMenuVisible.value).toBe(true);
    expect(atState.suggestions.atMenuVisible.value).toBe(true);
    expect(skillState.suggestions.skillMenuVisible.value).toBe(true);

    atState.prompt.value = 'plain text';
    atState.caretPosition.value = atState.prompt.value.length;
    skillState.prompt.value = 'plain text';
    skillState.caretPosition.value = skillState.prompt.value.length;
    await nextTick();

    expect(atState.suggestions.fileMenuVisible.value).toBe(false);
    expect(atState.suggestions.atMenuVisible.value).toBe(false);
    expect(skillState.suggestions.skillMenuVisible.value).toBe(false);
  });

  it('filters, navigates, and inserts file mentions', async () => {
    const state = setup('inspect @ts');
    await nextTick();
    expect(state.suggestions.fileMenuVisible.value).toBe(true);
    expect(state.suggestions.visibleFiles.value).toHaveLength(2);

    expect(state.suggestions.handleKeydown(key('ArrowDown'))).toBe(true);
    expect(state.suggestions.handleKeydown(key('Enter'))).toBe(true);

    expect(state.prompt.value).toBe('inspect @src/beta.ts ');
    expect(state.onTextInserted).toHaveBeenCalledWith(state.prompt.value.length);
  });

  it('navigates plugin and file matches in one at-mention result list', async () => {
    const state = setup('inspect @ts', { plugins: () => plugins });
    await nextTick();

    expect(state.suggestions.atMenuVisible.value).toBe(true);
    expect(state.suggestions.visiblePlugins.value.map((plugin) => plugin.name)).toStrictEqual(['ts']);
    expect(state.suggestions.visibleFiles.value).toHaveLength(2);

    expect(state.suggestions.handleKeydown(key('ArrowDown'))).toBe(true);
    expect(state.suggestions.handleKeydown(key('Enter'))).toBe(true);
    expect(state.prompt.value).toBe('inspect @src/alpha.ts ');
  });

  it('places host mention groups around built-ins and inserts their stable value', async () => {
    const leading = {
      id: 'threads',
      label: 'Threads',
      items: [
        { id: 'thread-1', value: 'thread:019abc', label: 'codex-claw' },
        { id: 'thread-2', value: 'thread:019def', label: 'sdk-planning' },
      ],
    } satisfies CodexComposerMentionGroup;
    const trailing = {
      id: 'people',
      label: 'People',
      placement: 'after',
      items: [{ id: 'person-1', value: 'person:nico', label: 'Nicolas' }],
    } satisfies CodexComposerMentionGroup;
    const state = setup('@codex', {
      plugins: () => plugins,
      mentionGroups: () => [leading, trailing],
    });
    await nextTick();

    expect(state.suggestions.atMenuVisible.value).toBe(true);
    expect(state.suggestions.handleKeydown(key('Enter'))).toBe(true);
    expect(state.prompt.value).toBe('@thread:019abc ');
    expect(state.onMentionSelected).toHaveBeenCalledWith(leading.items[0], leading);

    const trailingState = setup('@person', {
      plugins: () => plugins,
      mentionGroups: () => [leading, trailing],
    });
    await nextTick();
    expect(trailingState.suggestions.handleKeydown(key('Enter'))).toBe(true);
    expect(trailingState.prompt.value).toBe('@person:nico ');
  });

  it('navigates the exact host, plugin, file, and trailing-host result order', async () => {
    const leading = {
      id: 'leading',
      label: 'Leading',
      items: [{ id: 'leading-x', value: 'leading:x', label: 'x leading' }],
    } satisfies CodexComposerMentionGroup;
    const trailing = {
      id: 'trailing',
      label: 'Trailing',
      placement: 'after',
      items: [{ id: 'trailing-x', value: 'trailing:x', label: 'x trailing' }],
    } satisfies CodexComposerMentionGroup;
    const matchingPlugin: CodexSurfacePlugin = {
      id: 'x@remote',
      name: 'x-plugin',
      displayName: 'X Plugin',
      enabled: true,
    };
    const matchingFile = { name: 'x.ts', path: 'src/x.ts' };
    const expectedPrompts = [
      '@leading:x ',
      '@x-plugin ',
      '@src/x.ts ',
      '@trailing:x ',
    ];

    for (const [index, expectedPrompt] of expectedPrompts.entries()) {
      const state = setup('@x', {
        files: () => [matchingFile],
        mentionGroups: () => [leading, trailing],
        plugins: () => [matchingPlugin],
      });
      await nextTick();
      for (let step = 0; step < index; step += 1) {
        expect(state.suggestions.handleKeydown(key('ArrowDown'))).toBe(true);
      }
      expect(state.suggestions.activeAtIndex.value).toBe(index);
      expect(state.suggestions.handleKeydown(key('Enter'))).toBe(true);
      expect(state.prompt.value).toBe(expectedPrompt);
    }
  });

  it('wraps upward through mention results and prevents handled browser keys', async () => {
    const matchingFiles = [
      { name: 'x-one.ts', path: 'x-one.ts' },
      { name: 'x-two.ts', path: 'x-two.ts' },
      { name: 'x-three.ts', path: 'x-three.ts' },
    ];
    const state = setup('@x', { files: () => matchingFiles });
    await nextTick();
    const arrow = key('ArrowUp');

    expect(state.suggestions.handleKeydown(arrow)).toBe(true);
    expect(arrow.defaultPrevented).toBe(true);
    expect(state.suggestions.activeAtIndex.value).toBe(2);

    const enter = key('Enter');
    expect(state.suggestions.handleKeydown(enter)).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(state.prompt.value).toBe('@x-three.ts ');
  });

  it('handles arrow keys but ignores selection when a hint has no result items', async () => {
    const state = setup('@');
    await nextTick();
    expect(state.suggestions.atMenuVisible.value).toBe(true);

    const arrow = key('ArrowDown');
    expect(state.suggestions.handleKeydown(arrow)).toBe(true);
    expect(arrow.defaultPrevented).toBe(true);
    expect(state.suggestions.activeAtIndex.value).toBe(0);

    const enter = key('Enter');
    expect(state.suggestions.handleKeydown(enter)).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(state.prompt.value).toBe('@');
  });

  it('ignores unrelated keys while a menu is visible', async () => {
    const state = setup('/comp');
    await nextTick();
    const event = key('PageDown');

    expect(state.suggestions.handleKeydown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(state.onCommandSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
  ])('does not select a slash command for modified Enter: %j', async (modifier) => {
    const state = setup('/comp');
    await nextTick();
    const event = key('Enter', modifier);

    expect(state.suggestions.handleKeydown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(state.onCommandSubmitted).not.toHaveBeenCalled();
    expect(state.prompt.value).toBe('/comp');
  });

  it('inserts skills and submits immediate slash commands', async () => {
    const skillState = setup('$front');
    await nextTick();
    expect(skillState.suggestions.skillMenuVisible.value).toBe(true);
    skillState.suggestions.handleKeydown(key('Enter'));
    expect(skillState.prompt.value).toBe('$frontend ');

    const commandState = setup('/comp');
    await nextTick();
    expect(commandState.suggestions.slashMenuVisible.value).toBe(true);
    commandState.suggestions.handleKeydown(key('Enter'));
    expect(commandState.onCommandSubmitted).toHaveBeenCalledWith('/compact');
    expect(commandState.prompt.value).toBe('');
  });

  it('replaces only the active token for skill, command, and slash-skill selections', () => {
    const skillState = setup('before $front after');
    skillState.suggestions.updateCaretPosition({ end: 'before $front'.length });
    skillState.suggestions.selectSkill(skills[0]!);
    expect(skillState.prompt.value).toBe('before $frontend  after');
    expect(skillState.caretPosition.value).toBe('before $frontend '.length);

    const command: CodexCommandSummary = {
      id: 'explain',
      name: 'explain',
      submitOnSelect: false,
    };
    const commandState = setup('/ex later', { commands: () => [command] });
    commandState.suggestions.updateCaretPosition({ end: 3 });
    commandState.suggestions.selectCommand(command);
    expect(commandState.prompt.value).toBe('/explain  later');
    expect(commandState.onCommandSubmitted).not.toHaveBeenCalled();

    const slashSkillState = setup('/front later');
    slashSkillState.suggestions.updateCaretPosition({ end: 6 });
    slashSkillState.suggestions.selectSlashSkill(skills[0]!);
    expect(slashSkillState.prompt.value).toBe('/frontend  later');
  });

  it('does not mutate text when a direct selection has no matching token', () => {
    const group = {
      id: 'people',
      label: 'People',
      items: [{ id: 'person', value: 'person:nico', label: 'Nicolas' }],
    } satisfies CodexComposerMentionGroup;
    const state = setup('plain text', {
      mentionGroups: () => [group],
      plugins: () => plugins,
    });

    state.suggestions.selectFile(files[0]!);
    state.suggestions.selectSkill(skills[0]!);
    state.suggestions.selectPlugin(plugins[0]!);
    state.suggestions.selectMention(group.items[0]!, group);
    state.suggestions.selectSlashSkill(skills[0]!);
    state.suggestions.selectCommand(commands[0]!);

    expect(state.prompt.value).toBe('plain text');
    expect(state.onTextInserted).not.toHaveBeenCalled();
    expect(state.onMentionSelected).not.toHaveBeenCalled();
    expect(state.onCommandSubmitted).not.toHaveBeenCalled();
  });

  it('requires an editor for file and command selections', () => {
    const fileState = setup('@ts', { editor: null });
    fileState.suggestions.selectFile(files[0]!);
    expect(fileState.prompt.value).toBe('@ts');
    expect(fileState.onTextInserted).not.toHaveBeenCalled();

    const commandState = setup('/comp', { editor: null });
    commandState.suggestions.selectCommand(commands[0]!);
    expect(commandState.prompt.value).toBe('/comp');
    expect(commandState.onCommandSubmitted).not.toHaveBeenCalled();
  });

  it('reports mention selection against the current catalog group', () => {
    const item = { id: 'person', value: 'person:nico', label: 'Nicolas' };
    const staleGroup = { id: 'people', label: 'Old people', items: [item] } satisfies CodexComposerMentionGroup;
    const currentGroup = { id: 'people', label: 'Current people', items: [item] } satisfies CodexComposerMentionGroup;
    let groups: readonly CodexComposerMentionGroup[] = [staleGroup];
    const state = setup('@person', { mentionGroups: () => groups });
    const otherGroup = { id: 'other', label: 'Other', items: [item] } satisfies CodexComposerMentionGroup;
    groups = [otherGroup, currentGroup];

    state.suggestions.selectMention(item, staleGroup);

    expect(state.prompt.value).toBe('@person:nico ');
    expect(state.onMentionSelected).toHaveBeenCalledWith(item, currentGroup);
  });

  it('falls back to the selected group when optional host mention hooks are absent', () => {
    const item = { id: 'person', value: 'person:nico', label: 'Nicolas' };
    const group = { id: 'people', label: 'People', items: [item] } satisfies CodexComposerMentionGroup;
    const state = setup('@person', { withMentionCallback: false });

    expect(() => state.suggestions.selectMention(item, group)).not.toThrow();
    expect(state.prompt.value).toBe('@person:nico ');
  });

  it('uses explicit, editor, then prompt-length caret positions', () => {
    const state = setup('plain text', {
      editor: {
        getSelectionRange: () => ({ end: 4, start: 2, valid: true }),
      },
    });

    state.suggestions.updateCaretPosition({ end: 3 });
    expect(state.caretPosition.value).toBe(3);
    state.suggestions.updateCaretPosition();
    expect(state.caretPosition.value).toBe(4);
    state.editor.value = null;
    state.suggestions.updateCaretPosition();
    expect(state.caretPosition.value).toBe(state.prompt.value.length);
  });

  it('keeps suspended suggestions closed until resumed and synchronized', async () => {
    const state = setup('/');
    await nextTick();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);

    state.suggestions.suspend();
    expect(state.suggestions.slashMenuVisible.value).toBe(false);
    state.prompt.value = '/c';
    state.caretPosition.value = 2;
    state.suggestions.sync();
    expect(state.suggestions.slashMenuVisible.value).toBe(false);

    state.suggestions.resume();
    expect(state.suggestions.slashMenuVisible.value).toBe(false);
    state.suggestions.sync();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);
  });

  it('closes suggestion menus after the focus handoff delay', async () => {
    vi.useFakeTimers();
    try {
      const state = setup('@ts');
      await nextTick();
      expect(state.suggestions.atMenuVisible.value).toBe(true);

      state.suggestions.closeSoon();
      await vi.advanceTimersByTimeAsync(119);
      expect(state.suggestions.atMenuVisible.value).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(state.suggestions.atMenuVisible.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns unhandled keys without preventing their default behavior', () => {
    const state = setup('plain text');
    const event = key('ArrowDown');

    expect(state.suggestions.handleKeydown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('resets active indices when each suggestion context changes', async () => {
    const group = {
      id: 'people',
      label: 'People',
      items: [
        { id: 'x', value: 'person:x', label: 'x person' },
        { id: 'y', value: 'person:y', label: 'y person' },
      ],
    } satisfies CodexComposerMentionGroup;
    const atState = setup('@x', {
      mentionGroups: () => [group],
      plugins: () => plugins,
    });
    await nextTick();
    atState.suggestions.activeAtIndex.value = 4;
    atState.suggestions.activePluginIndex.value = 3;
    atState.suggestions.activeFileIndex.value = 2;
    atState.prompt.value = '@y';
    atState.caretPosition.value = 2;
    await nextTick();
    expect(atState.suggestions.activeAtIndex.value).toBe(0);
    expect(atState.suggestions.activePluginIndex.value).toBe(0);
    expect(atState.suggestions.activeFileIndex.value).toBe(0);

    const skillState = setup('$front');
    await nextTick();
    skillState.suggestions.activeSkillIndex.value = 1;
    skillState.prompt.value = '$test';
    skillState.caretPosition.value = 5;
    await nextTick();
    expect(skillState.suggestions.activeSkillIndex.value).toBe(0);

    const slashState = setup('/');
    await nextTick();
    slashState.suggestions.activeSlashIndex.value = 3;
    slashState.prompt.value = '/c';
    slashState.caretPosition.value = 2;
    await nextTick();
    expect(slashState.suggestions.activeSlashIndex.value).toBe(0);
  });

  it('resets the combined selection when only a host group changes', async () => {
    const groups = ref<readonly CodexComposerMentionGroup[]>([{
      id: 'people',
      label: 'People',
      items: [{ id: 'x', value: 'person:x', label: 'x person' }],
    }]);
    const state = setup('@x', {
      files: () => [],
      mentionGroups: () => groups.value,
    });
    await nextTick();
    state.suggestions.activeAtIndex.value = 2;

    groups.value = [{
      id: 'threads',
      label: 'Threads',
      items: [{ id: 'x-thread', value: 'thread:x', label: 'x thread' }],
    }];
    await nextTick();

    expect(state.suggestions.activeAtIndex.value).toBe(0);
  });

  it('keeps an escaped menu dismissed until the prompt changes', async () => {
    const state = setup('/');
    await nextTick();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);
    const escape = key('Escape');
    expect(state.suggestions.handleKeydown(escape)).toBe(true);
    expect(escape.defaultPrevented).toBe(true);
    expect(state.suggestions.slashMenuVisible.value).toBe(false);

    state.suggestions.sync();
    expect(state.suggestions.slashMenuVisible.value).toBe(false);

    state.prompt.value = '/c';
    state.caretPosition.value = 2;
    state.suggestions.sync();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);
  });

  it('closes the combined at-mention menu with Escape', async () => {
    const state = setup('@ts', { plugins: () => plugins });
    await nextTick();
    expect(state.suggestions.atMenuVisible.value).toBe(true);
    expect(state.suggestions.handleKeydown(key('Escape'))).toBe(true);
    expect(state.suggestions.atMenuVisible.value).toBe(false);
  });
});
