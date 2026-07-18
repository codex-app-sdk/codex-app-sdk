// @vitest-environment jsdom

import { nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { CodexFileSearchItem, CodexCommandSummary, CodexSkillSummary } from '../../../src/vue/chat/contracts';
import { useChatComposerSuggestions } from '../../../src/vue/chat/use-chat-composer-suggestions';

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

function setup(initialPrompt: string) {
  const prompt = ref(initialPrompt);
  const caretPosition = ref(initialPrompt.length);
  const textarea = ref(document.createElement('textarea'));
  textarea.value.setSelectionRange(initialPrompt.length, initialPrompt.length);
  const onCommandSubmitted = vi.fn();
  const onTextInserted = vi.fn();
  const suggestions = useChatComposerSuggestions({
    caretPosition,
    commands: () => commands,
    disabled: () => false,
    files: () => files,
    isSending: () => false,
    onCommandSubmitted,
    onTextInserted,
    prompt,
    skills: () => skills,
    skillsEnabled: () => true,
    textarea,
  });
  suggestions.sync();
  return { caretPosition, onCommandSubmitted, onTextInserted, prompt, suggestions, textarea };
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

    expect(state.prompt.value).toBe('inspect src/beta.ts ');
    expect(state.onTextInserted).toHaveBeenCalledWith(state.prompt.value.length);
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

  it('closes an open menu with Escape', async () => {
    const state = setup('$');
    await nextTick();
    expect(state.suggestions.skillMenuVisible.value).toBe(true);
    expect(state.suggestions.handleKeydown(key('Escape'))).toBe(true);
    expect(state.suggestions.skillMenuVisible.value).toBe(false);
  });
});
