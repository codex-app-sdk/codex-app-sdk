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
  configuredPlugins: CodexSurfacePlugin[] = [],
  mentionGroups: readonly CodexComposerMentionGroup[] = [],
) {
  const prompt = ref(initialPrompt);
  const caretPosition = ref(initialPrompt.length);
  const editor = ref({
    getSelectionRange: () => ({
      end: caretPosition.value,
      start: caretPosition.value,
      valid: true,
    }),
  });
  const onCommandSubmitted = vi.fn();
  const onTextInserted = vi.fn();
  const onMentionSelected = vi.fn();
  const suggestions = useChatComposerSuggestions({
    caretPosition,
    commands: () => commands,
    disabled: () => false,
    files: () => files,
    plugins: () => configuredPlugins,
    pluginsEnabled: () => true,
    mentionGroups: () => mentionGroups,
    isSending: () => false,
    onCommandSubmitted,
    onTextInserted,
    onMentionSelected,
    prompt,
    skills: () => skills,
    skillsEnabled: () => true,
    editor,
  });
  suggestions.sync();
  return { caretPosition, editor, onCommandSubmitted, onMentionSelected, onTextInserted, prompt, suggestions };
}

function key(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, key });
}

describe('useChatComposerSuggestions', () => {
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
    const state = setup('inspect @ts', plugins);
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
    const state = setup('@codex', plugins, [leading, trailing]);
    await nextTick();

    expect(state.suggestions.atMenuVisible.value).toBe(true);
    expect(state.suggestions.handleKeydown(key('Enter'))).toBe(true);
    expect(state.prompt.value).toBe('@thread:019abc ');
    expect(state.onMentionSelected).toHaveBeenCalledWith(leading.items[0], leading);

    const trailingState = setup('@person', plugins, [leading, trailing]);
    await nextTick();
    expect(trailingState.suggestions.handleKeydown(key('Enter'))).toBe(true);
    expect(trailingState.prompt.value).toBe('@person:nico ');
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

  it('keeps an escaped menu dismissed until the prompt changes', async () => {
    const state = setup('/');
    await nextTick();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);
    expect(state.suggestions.handleKeydown(key('Escape'))).toBe(true);
    expect(state.suggestions.slashMenuVisible.value).toBe(false);

    state.suggestions.sync();
    expect(state.suggestions.slashMenuVisible.value).toBe(false);

    state.prompt.value = '/c';
    state.caretPosition.value = 2;
    state.suggestions.sync();
    expect(state.suggestions.slashMenuVisible.value).toBe(true);
  });

  it('closes the combined at-mention menu with Escape', async () => {
    const state = setup('@ts', plugins);
    await nextTick();
    expect(state.suggestions.atMenuVisible.value).toBe(true);
    expect(state.suggestions.handleKeydown(key('Escape'))).toBe(true);
    expect(state.suggestions.atMenuVisible.value).toBe(false);
  });
});
