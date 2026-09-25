// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import CodexComposer from '../src/components/CodexComposer.vue';
import CodexComposerPluginMenu from '../src/chat/ChatComposerPluginMenu.vue';
import ChatRichTextEditor, { type CodexRichTextEditorExpose } from '../src/chat/ChatRichTextEditor.vue';
import { codexCommands } from '../src/chat/codex-commands';
import type { CodexCapabilities, CodexContextUsage, CodexFileSearchItem, CodexCommandSummary, CodexConversationPresentation, CodexModelOption, CodexSkillSummary, CodexChatTranscription } from '../src/chat/contracts';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import type { CodexComposerState } from '../src/composer-state';

type ChatComposerProps = {
  canContinueInterruptedTurn?: boolean;
  composerState?: CodexComposerState;
  disabled: boolean;
  draft?: string;
  draftRevision?: number;
  isSending: boolean;
  hasAttachments?: boolean;
  hasExternalContent?: boolean;
  interruptArmed?: boolean;
  placeholder: string;
  promptHistory?: readonly string[];
  promptHistoryLoading?: boolean;
  queuedPromptId?: string | null;
};

const models: CodexModelOption[] = [
  {
    id: 'codex-max',
    model: 'gpt-5.1-codex-max',
    displayName: 'GPT-5.1 Codex Max',
    description: 'Deep coding work',
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep reasoning' },
    ],
    defaultReasoningEffort: 'high',
    isDefault: true,
  },
];

const skills: CodexSkillSummary[] = [
  {
    name: 'frontend-design',
    displayName: 'Frontend Design',
    description: 'Design polished frontend pages and UI.',
    shortDescription: 'Design polished UI.',
    path: '/Users/nbonamy/.codex/skills/frontend-design/SKILL.md',
    scope: 'project',
    enabled: true,
  },
  {
    name: 'skill-creator',
    description: 'Create or update Codex skills.',
    path: '/Users/nbonamy/.codex/skills/skill-creator/SKILL.md',
    scope: 'user',
    enabled: true,
  },
];

const files: CodexFileSearchItem[] = [
  { name: 'README.md', path: 'README.md' },
  { name: 'research.md', path: 'docs/research.md' },
  { name: 'ChatComposer.vue', path: 'src/renderer/components/ChatComposer.vue' },
];

const plugins: CodexSurfacePlugin[] = [{
  id: 'gmail@openai-curated-remote',
  name: 'gmail',
  displayName: 'Gmail',
  shortDescription: 'Read and manage Gmail',
  enabled: true,
}];

describe('ChatComposer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('emits a trimmed prompt and clears the editor', async () => {
    const wrapper = mountComposer();

    await setEditorValue(wrapper, '  ship the ui  ');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toStrictEqual([['ship the ui']]);
    expect(editorValue(wrapper)).toBe('');
  });

  it('sends from the shared send button', async () => {
    const wrapper = mountComposer();

    await setEditorValue(wrapper, 'ship it');
    await wrapper.get('.chat-composer__send').trigger('click');

    expect(wrapper.emitted('send')).toStrictEqual([['ship it']]);
  });

  it('labels a draft as queued while Codex is working', async () => {
    const wrapper = mountComposer({ isSending: true });

    await setEditorValue(wrapper, 'follow up');

    expect(wrapper.get('.chat-composer__send').attributes('aria-label')).toBe('Queue prompt');
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--busy');
  });

  it('labels an idle composer for sending', () => {
    const wrapper = mountComposer();

    expect(wrapper.get('.chat-composer__send').attributes('aria-label')).toBe('Send prompt');
  });

  it('continues an interrupted turn from an empty composer', async () => {
    const wrapper = mountComposer({ canContinueInterruptedTurn: true });
    const button = wrapper.get('.chat-composer__send');

    expect(button.attributes()).not.toHaveProperty('disabled');
    expect(button.attributes('aria-label')).toBe('Continue');

    await button.trigger('click');

    expect(wrapper.emitted('continueInterruptedTurn')).toStrictEqual([[]]);
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('submits attachment-only work instead of interrupting while Codex is working', async () => {
    const wrapper = mountComposer({ hasAttachments: true, isSending: true });

    const button = wrapper.get('.chat-composer__send');
    expect(button.classes()).not.toContain('codex-composer-send-button--busy');
    await button.trigger('click');

    expect(wrapper.emitted('send')).toStrictEqual([['(no user instructions)']]);
    expect(wrapper.emitted('interrupt')).toBeUndefined();
  });

  it('submits empty text for host-owned composer context', async () => {
    const wrapper = mountComposer({ hasExternalContent: true });

    const button = wrapper.get('.chat-composer__send');
    expect(button.attributes()).not.toHaveProperty('disabled');
    await button.trigger('click');

    expect(wrapper.emitted('send')).toStrictEqual([['']]);
  });

  it('does not continue or interrupt while host-owned composer context is present', async () => {
    const interrupted = mountComposer({ canContinueInterruptedTurn: true, hasExternalContent: true });
    await interrupted.get('.chat-composer__send').trigger('click');
    expect(interrupted.emitted('send')).toStrictEqual([['']]);
    expect(interrupted.emitted('continueInterruptedTurn')).toBeUndefined();

    const working = mountComposer({ hasExternalContent: true, isSending: true });
    await working.get('.chat-composer__send').trigger('click');
    expect(working.emitted('send')).toStrictEqual([['']]);
    expect(working.emitted('interrupt')).toBeUndefined();
  });

  it('recalls submitted prompts from an empty composer and exits navigation after an edit', async () => {
    const wrapper = mountComposer();

    await setEditorValue(wrapper, 'first prompt');
    await wrapper.get('form').trigger('submit');
    await setEditorValue(wrapper, 'second prompt');
    await wrapper.get('form').trigger('submit');

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('second prompt');
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 13, end: 13 });

    const echoedState = wrapper.emitted('update:composerState')?.at(-1)?.[0] as CodexComposerState;
    await wrapper.setProps({ composerState: echoedState });
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('first prompt');
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 12, end: 12 });

    await editor(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('second prompt');

    await editor(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('');

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('second prompt');
    await setEditorValue(wrapper, 'second prompt!');
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    expect(editorValue(wrapper)).toBe('second prompt!');
  });

  it('does not start prompt recall while the composer contains text', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'remember me');
    await wrapper.get('form').trigger('submit');
    await setEditorValue(wrapper, 'draft');

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });

    expect(editorValue(wrapper)).toBe('draft');
  });

  it('leaves ordinary typing alone while a recalled prompt is active', async () => {
    const wrapper = mountComposer({ promptHistory: ['remembered'] });
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    const typing = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'x',
    });

    editor(wrapper).element.dispatchEvent(typing);

    expect(typing.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('remembered');
  });

  it('recalls from controlled caret state when the DOM selection is unavailable', async () => {
    const wrapper = mountComposer({ promptHistory: ['First prompt', 'Second prompt'] });
    vi.spyOn(richEditorVm(wrapper), 'getSelectionRange').mockReturnValue({
      end: 0,
      start: 0,
      valid: false,
    });

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();

    expect(editorValue(wrapper)).toBe('Second prompt');
  });

  it('leaves arrow navigation to the editor when the caret is not at the prompt end', async () => {
    const wrapper = mountComposer({ promptHistory: ['First prompt', 'Second prompt'] });

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('Second prompt');

    richEditorVm(wrapper).setSelection(6, 6);
    const up = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' });
    editor(wrapper).element.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('Second prompt');

    const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' });
    editor(wrapper).element.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('Second prompt');
  });

  it('trusts a valid live selection over stale controlled caret state for history navigation', async () => {
    const wrapper = mountComposer(
      { promptHistory: ['First prompt', 'Second prompt'] },
      { attachTo: document.body },
    );
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    const range = document.createRange();
    range.setStart(editor(wrapper).element.firstChild as Text, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const up = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowUp',
    });

    editor(wrapper).element.dispatchEvent(up);

    expect(up.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('Second prompt');
    wrapper.unmount();
  });

  it('does not recall over a selected range at the prompt end', async () => {
    const wrapper = mountComposer({ promptHistory: ['First prompt', 'Second prompt'] });
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();

    richEditorVm(wrapper).setSelection(6, 13);
    const up = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' });
    editor(wrapper).element.dispatchEvent(up);

    expect(up.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('Second prompt');
  });

  it('does not open suggestions for a recalled skill prompt', async () => {
    const wrapper = mountComposer({
      promptHistory: ['$frontend-design'],
      skills,
    });

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();

    expect(editorValue(wrapper)).toBe('$frontend-design');
    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(false);
  });

  it('resumes skill suggestions after editing a recalled prompt', async () => {
    const wrapper = mountComposer({
      promptHistory: ['$frontend-design'],
      skills,
    });
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(false);

    await setEditorValue(wrapper, '$front');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(true);
  });

  it('replays Up presses made while prompt history is loading', async () => {
    const wrapper = mountComposer({ promptHistoryLoading: true });

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    expect(editorValue(wrapper)).toBe('');

    await wrapper.setProps({
      promptHistory: ['First prompt', 'Second prompt', 'Third prompt'],
      promptHistoryLoading: false,
    });
    await nextTick();

    expect(editorValue(wrapper)).toBe('Second prompt');
  });

  it('waits for history loading to finish before replaying queued navigation', async () => {
    const wrapper = mountComposer({ promptHistoryLoading: true });
    const up = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowUp',
    });

    editor(wrapper).element.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    await wrapper.setProps({
      promptHistory: ['First prompt', 'Second prompt'],
    });
    await nextTick();
    expect(editorValue(wrapper)).toBe('');

    await wrapper.setProps({ promptHistoryLoading: false });
    await nextTick();
    expect(editorValue(wrapper)).toBe('Second prompt');
  });

  it('does not consume history navigation while a loading composer has a draft', async () => {
    const wrapper = mountComposer({ promptHistoryLoading: true });
    await setEditorValue(wrapper, 'draft');
    const up = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowUp',
    });

    editor(wrapper).element.dispatchEvent(up);

    expect(up.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('draft');
  });

  it('does not replay loading-time history navigation after the user types', async () => {
    const wrapper = mountComposer({ promptHistoryLoading: true });

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await setEditorValue(wrapper, 'new draft');
    await wrapper.setProps({
      promptHistory: ['First prompt', 'Second prompt'],
      promptHistoryLoading: false,
    });
    await nextTick();

    expect(editorValue(wrapper)).toBe('new draft');
  });

  it('queues only unmodified ArrowUp while prompt history is loading', async () => {
    const wrapper = mountComposer({ promptHistoryLoading: true });
    const modifiedUp = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowUp',
      metaKey: true,
    });
    const down = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowDown',
    });

    editor(wrapper).element.dispatchEvent(modifiedUp);
    editor(wrapper).element.dispatchEvent(down);
    await wrapper.setProps({
      promptHistory: ['First prompt', 'Second prompt'],
      promptHistoryLoading: false,
    });
    await nextTick();

    expect(modifiedUp.defaultPrevented).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('');
  });

  it('submits the attachment-only prompt sentinel', async () => {
    const wrapper = mountComposer({ hasAttachments: true });

    expect(wrapper.get('.chat-composer__send').attributes()).not.toHaveProperty('disabled');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toStrictEqual([['(no user instructions)']]);
  });

  it('does not add the attachment-only sentinel to prompt history', async () => {
    const wrapper = mountComposer({ hasAttachments: true });

    await wrapper.get('form').trigger('submit');
    await wrapper.setProps({ hasAttachments: false });
    const up = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowUp',
    });
    editor(wrapper).element.dispatchEvent(up);
    await nextTick();

    expect(up.defaultPrevented).toBe(false);
    expect(editorValue(wrapper)).toBe('');
  });

  it('steers the queued prompt from an empty Cmd Enter shortcut', async () => {
    const wrapper = mountComposer({ queuedPromptId: 'queued-1' });

    await editor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-1']]);
    expect(wrapper.emitted('steer')).toBeUndefined();
  });

  it('steers the queued prompt from a whitespace-only Cmd Enter shortcut', async () => {
    const wrapper = mountComposer({ queuedPromptId: 'queued-1' });
    await setEditorValue(wrapper, '   ');

    await editor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-1']]);
    expect(wrapper.emitted('steer')).toBeUndefined();
  });

  it('does not steer an empty, disabled, or attachment-only composer', async () => {
    const empty = mountComposer();
    const disabled = mountComposer({ disabled: true, queuedPromptId: 'queued-1' });
    const attachments = mountComposer({ hasAttachments: true });

    await editor(empty).trigger('keydown', { key: 'Enter', metaKey: true });
    await editor(disabled).trigger('keydown', { key: 'Enter', metaKey: true });
    await editor(attachments).trigger('keydown', { key: 'Enter', metaKey: true });

    for (const wrapper of [empty, disabled, attachments]) {
      expect(wrapper.emitted('steer')).toBeUndefined();
      expect(wrapper.emitted('steerQueuedPrompt')).toBeUndefined();
    }
  });

  it('does not submit a disabled composer through its form', async () => {
    const wrapper = mountComposer({ disabled: true });
    await setEditorValue(wrapper, 'must not send');

    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toBeUndefined();
    expect(editorValue(wrapper)).toBe('must not send');
  });

  it('prefills and focuses the composer from a draft revision', async () => {
    const wrapper = mountComposer({
      draft: 'quoted prompt',
      draftRevision: 1,
    });
    await nextTick();

    expect(editorValue(wrapper)).toBe('quoted prompt');
  });

  it('applies draft text only when its revision changes and no controlled state exists', async () => {
    const wrapper = mountComposer({ draft: 'not revised' });
    expect(editorValue(wrapper)).toBe('');

    await wrapper.setProps({ draftRevision: 1 });
    await nextTick();
    expect(editorValue(wrapper)).toBe('not revised');

    await wrapper.setProps({
      composerState: { text: 'controlled', selectionStart: 4, selectionEnd: 4 },
      draft: 'ignored draft',
      draftRevision: 2,
    });
    await nextTick();
    expect(editorValue(wrapper)).toBe('controlled');
  });

  it('treats a revised missing draft as empty', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'stale local text');

    await wrapper.setProps({ draftRevision: 1 });
    await nextTick();

    expect(editorValue(wrapper)).toBe('');
  });

  it('exits prompt-history navigation when a revised draft is restored', async () => {
    const wrapper = mountComposer({ promptHistory: ['first', 'second'] });
    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(editorValue(wrapper)).toBe('second');

    await wrapper.setProps({ draft: 'fresh draft', draftRevision: 1 });
    await nextTick();
    await editor(wrapper).trigger('keydown', { key: 'ArrowDown' });

    expect(editorValue(wrapper)).toBe('fresh draft');
  });

  it('focuses the rich editor only when autofocus is requested', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const withoutAutofocus = mountComposer();
    await nextTick();
    expect(focus).not.toHaveBeenCalled();

    const withAutofocus = mountComposer({ autofocus: true });
    await nextTick();
    expect(focus).toHaveBeenCalledOnce();
    withoutAutofocus.unmount();
    withAutofocus.unmount();
  });

  it('exposes a focus action that moves the caret to the end of the draft', async () => {
    const wrapper = mountComposer({}, { attachTo: document.body });
    await setEditorValue(wrapper, 'focus me');
    richEditorVm(wrapper).setCaret(0);

    (wrapper.vm as unknown as { focus(): void }).focus();
    await nextTick();

    expect(document.activeElement).toBe(editor(wrapper).element);
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 8, end: 8 });
    wrapper.unmount();
  });

  it('emits controlled text and caret state for rich-editor input', async () => {
    const wrapper = mountComposer();

    await setEditorValue(wrapper, 'hello');

    expect(wrapper.emitted('update:composerState')?.at(-1)).toStrictEqual([{
      text: 'hello', selectionStart: 5, selectionEnd: 5,
    }]);
  });

  it('emits selection-only changes and state after programmatic insertion', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'hello world');
    const richEditor = richEditorVm(wrapper);

    richEditor.setSelection(0, 5);
    expect(wrapper.emitted('update:composerState')?.at(-1)).toStrictEqual([{
      text: 'hello world', selectionStart: 0, selectionEnd: 5,
    }]);

    richEditor.setCaret(5);
    richEditor.insertTextAtSelection('!');
    await nextTick();
    expect(wrapper.emitted('update:composerState')?.at(-1)).toStrictEqual([{
      text: 'hello! world', selectionStart: 6, selectionEnd: 6,
    }]);
  });

  it('does not re-emit an unchanged controlled composer state', async () => {
    const state = { text: 'controlled', selectionStart: 4, selectionEnd: 7 };
    const wrapper = mountComposer({ composerState: state }, { attachTo: document.body });
    await nextTick();
    const countAfterRestore = wrapper.emitted('update:composerState')?.length ?? 0;

    richEditorVm(wrapper).setSelection(4, 7);
    await nextTick();

    expect(wrapper.emitted('update:composerState')?.length ?? 0).toBe(countAfterRestore);
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 4, end: 7 });
    wrapper.unmount();
  });

  it('emits state when each controlled field changes independently', async () => {
    const wrapper = mountComposer({}, { attachTo: document.body });
    await setEditorValue(wrapper, 'abc');
    richEditorVm(wrapper).setCaret(2);
    const baselineCount = wrapper.emitted('update:composerState')?.length ?? 0;

    await appendNativeCharacter(wrapper, 'd', 2);
    richEditorVm(wrapper).setSelection(1, 2);
    richEditorVm(wrapper).setSelection(1, 3);

    expect(wrapper.emitted('update:composerState')?.slice(baselineCount)).toStrictEqual([
      [{ text: 'abcd', selectionStart: 2, selectionEnd: 2 }],
      [{ text: 'abcd', selectionStart: 1, selectionEnd: 2 }],
      [{ text: 'abcd', selectionStart: 1, selectionEnd: 3 }],
    ]);
    wrapper.unmount();
  });

  it('restores normalized controlled text and selection at the public editor boundary', async () => {
    const wrapper = mountComposer({
      composerState: { text: 'short', selectionStart: -10, selectionEnd: 99 },
    }, { attachTo: document.body });
    await nextTick();
    await nextTick();

    expect(editorValue(wrapper)).toBe('short');
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 0, end: 5 });
    expect(wrapper.emitted('update:composerState') ?? []).not.toContainEqual([{
      text: 'short', selectionStart: -10, selectionEnd: 99,
    }]);
    wrapper.unmount();
  });

  it('restores each externally controlled field independently', async () => {
    const wrapper = mountComposer({
      composerState: { text: 'abc', selectionStart: 1, selectionEnd: 1 },
    }, { attachTo: document.body });
    await nextTick();
    await nextTick();

    await wrapper.setProps({
      composerState: { text: 'abd', selectionStart: 1, selectionEnd: 1 },
    });
    await nextTick();
    expect(editorValue(wrapper)).toBe('abd');
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 1, end: 1 });

    await wrapper.setProps({
      composerState: { text: 'abd', selectionStart: 0, selectionEnd: 1 },
    });
    await nextTick();
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 0, end: 1 });

    await wrapper.setProps({
      composerState: { text: 'abd', selectionStart: 0, selectionEnd: 2 },
    });
    await nextTick();
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 0, end: 2 });
    wrapper.unmount();
  });

  it('reacts to in-place changes inside externally controlled state', async () => {
    const composerState = reactive({ text: 'controlled', selectionStart: 4, selectionEnd: 4 });
    const wrapper = mountComposer({ composerState }, { attachTo: document.body });
    await nextTick();
    await nextTick();

    composerState.selectionStart = 1;
    composerState.selectionEnd = 7;
    await nextTick();
    await nextTick();

    expect(editorValue(wrapper)).toBe('controlled');
    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 1, end: 7 });
    wrapper.unmount();
  });

  it('does not steal focus when externally controlled state is restored', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mountComposer({}, { attachTo: document.body });
    outside.focus();

    await wrapper.setProps({
      composerState: { text: 'controlled', selectionStart: 2, selectionEnd: 6 },
    });
    await nextTick();

    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
    outside.remove();
  });

  it('preserves suggestions and future emissions when the host echoes controlled state', async () => {
    const wrapper = mountComposer({ skills }, { attachTo: document.body });
    await setEditorValue(wrapper, '$front');
    richEditorVm(wrapper).setCaret('$front'.length);
    await editor(wrapper).trigger('keyup');
    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(true);
    const echoedState = wrapper.emitted('update:composerState')?.at(-1)?.[0] as CodexComposerState;

    await wrapper.setProps({ composerState: echoedState });
    await nextTick();
    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(true);

    const emissionCount = wrapper.emitted('update:composerState')?.length ?? 0;
    await setEditorValue(wrapper, '$fronte');
    expect(wrapper.emitted('update:composerState')).toHaveLength(emissionCount + 1);
    wrapper.unmount();
  });

  it('grows the editor and caps it at twelve visible composer lines', async () => {
    const wrapper = mountComposer();
    const richEditor = editor(wrapper).element;
    Object.defineProperty(richEditor, 'scrollHeight', {
      configurable: true,
      value: 280,
    });

    await setEditorValue(wrapper, Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join('\n'));
    await nextTick();
    expect(richEditor.style.height).toBe('280px');

    Object.defineProperty(richEditor, 'scrollHeight', {
      configurable: true,
      value: 400,
    });
    await setEditorValue(wrapper, Array.from({ length: 13 }, (_, index) => `line ${index + 1}`).join('\n'));
    await nextTick();

    expect(richEditor.style.height).toBe('304px');
  });

  it('interrupts from the shared send button while Codex is working without a draft', async () => {
    const wrapper = mountComposer({ isSending: true });

    expect(wrapper.get('.chat-composer__send').attributes()).not.toHaveProperty('disabled');
    expect(wrapper.get('.chat-composer__send').attributes('aria-label')).toBe('Codex is working');

    await wrapper.get('.chat-composer__send').trigger('click');

    expect(wrapper.emitted('interrupt')).toStrictEqual([[]]);
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('interrupts from the armed stop button even when a draft is present', async () => {
    const wrapper = mountComposer({ interruptArmed: true, isSending: true });
    await setEditorValue(wrapper, 'queue this next');

    const button = wrapper.get('.chat-composer__send');
    expect(button.classes()).toContain('codex-composer-send-button--interrupt-armed');
    expect(button.attributes('aria-label')).toBe('Press Escape again or click to stop generation');
    await button.trigger('click');

    expect(wrapper.emitted('interrupt')).toStrictEqual([[]]);
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('keeps an empty armed interrupt button actionable before sending starts', async () => {
    const wrapper = mountComposer({ interruptArmed: true });
    const button = wrapper.get('.chat-composer__send');

    expect(button.attributes()).not.toHaveProperty('disabled');
    await button.trigger('click');

    expect(wrapper.emitted('interrupt')).toStrictEqual([[]]);
  });

  it('treats a whitespace-only draft as empty', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, '  \n  ');

    expect(wrapper.get('.chat-composer__send').attributes()).toHaveProperty('disabled');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toBeUndefined();
    expect(editorValue(wrapper)).toBe('  \n  ');
  });

  it('submits with Enter and preserves Shift Enter for multiline drafts', async () => {
    const wrapper = mountComposer();

    await setEditorValue(wrapper, 'first line');
    await editor(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('send')).toBeUndefined();
    expect(editorValue(wrapper)).toBe('first line\n');
    expect(editor(wrapper).findAll('br')).toHaveLength(2);
    expect(editor(wrapper).findAll('br')[1]?.attributes()).toHaveProperty('data-trailing-line-break');

    const richEditor = wrapper.getComponent(ChatRichTextEditor).vm as unknown as CodexRichTextEditorExpose;
    richEditor.insertTextAtSelection('second line');
    expect(editorValue(wrapper)).toBe('first line\nsecond line');
    expect(editor(wrapper).findAll('br')).toHaveLength(1);

    await editor(wrapper).trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('send')).toStrictEqual([['first line\nsecond line']]);
  });

  it('prevents the browser default for handled history, plan, and multiline keys', async () => {
    const wrapper = mountComposer({ promptHistory: ['remembered'] });
    const events = [
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' }),
      new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Tab', shiftKey: true,
      }),
      new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Enter', shiftKey: true,
      }),
    ];

    for (const event of events) editor(wrapper).element.dispatchEvent(event);
    await nextTick();

    expect(events.map((event) => event.defaultPrevented)).toStrictEqual([true, true, true]);
  });

  it('splits text with Shift Enter at the current caret position', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'beforeafter');
    const richEditor = wrapper.getComponent(ChatRichTextEditor).vm as unknown as CodexRichTextEditorExpose;
    richEditor.setCaret('before'.length);

    await editor(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true });

    expect(editorValue(wrapper)).toBe('before\nafter');
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('keeps native typing on the new line before a second Shift Enter', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'hello');
    await editor(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true });

    const sentinel = editor(wrapper).get('[data-trailing-line-break]').element;
    sentinel.before(document.createTextNode('b'));
    await editor(wrapper).trigger('input');
    await nextTick();
    await appendNativeCharacter(wrapper, 'y');
    await appendNativeCharacter(wrapper, 'e');

    expect(editorValue(wrapper)).toBe('hello\nbye');
    expect(editor(wrapper).find('[data-trailing-line-break]').exists()).toBe(false);
    expect(richEditorVm(wrapper).getSelectionRange().end).toBe('hello\nbye'.length);

    await editor(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(editorValue(wrapper)).toBe('hello\nbye\n');
    expect(editor(wrapper).findAll('br')).toHaveLength(3);
  });

  it('counts existing line breaks when splitting a later line at the caret', async () => {
    const wrapper = mountComposer();
    richEditorVm(wrapper).setText('hello\nbye', 'hello\nb'.length);

    await editor(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true });

    expect(editorValue(wrapper)).toBe('hello\nb\nye');
  });

  it('pastes plain text and blocks rich content from entering the contenteditable', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'Before ');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [new File(['png'], 'clipboard.png', { type: 'image/png' })],
        getData: (type: string) => type === 'text/plain' ? 'after' : '<img src="data:image/png;base64,cG5n">',
        types: ['text/plain', 'text/html', 'Files'],
      },
    });

    editor(wrapper).element.dispatchEvent(paste);
    await nextTick();

    expect(paste.defaultPrevented).toBe(true);
    expect(editorValue(wrapper)).toBe('Before after');
    expect(editor(wrapper).find('img').exists()).toBe(false);
  });

  it.each([
    ['an HTML flavor', { files: [], text: '', types: ['text/html'] }],
    ['a file', { files: [new File(['png'], 'clipboard.png')], text: '', types: ['Files'] }],
  ])('blocks a text-free paste containing %s', async (_label, clipboard) => {
    const wrapper = mountComposer();
    const paste = clipboardEvent(clipboard);

    editor(wrapper).element.dispatchEvent(paste);
    await nextTick();

    expect(paste.defaultPrevented).toBe(true);
    expect(editorValue(wrapper)).toBe('');
  });

  it('leaves an empty or unavailable clipboard paste to the browser', () => {
    const wrapper = mountComposer();
    const unavailable = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    const empty = clipboardEvent({ files: [], text: '', types: [] });

    editor(wrapper).element.dispatchEvent(unavailable);
    editor(wrapper).element.dispatchEvent(empty);

    expect(unavailable.defaultPrevented).toBe(false);
    expect(empty.defaultPrevented).toBe(false);
  });

  it('inserts a plain-text-only paste and prevents native rich-editor insertion', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'before ');
    const paste = clipboardEvent({ files: [], text: 'after', types: ['text/plain'] });

    editor(wrapper).element.dispatchEvent(paste);
    await nextTick();

    expect(paste.defaultPrevented).toBe(true);
    expect(editorValue(wrapper)).toBe('before after');
  });

  it('accepts plain text from a clipboard that omits the optional types list', async () => {
    const wrapper = mountComposer();
    const paste = clipboardEvent({ files: [], text: 'plain text' });

    editor(wrapper).element.dispatchEvent(paste);
    await nextTick();

    expect(paste.defaultPrevented).toBe(true);
    expect(editorValue(wrapper)).toBe('plain text');
  });

  it('steers with Command Enter', async () => {
    const wrapper = mountComposer({ isSending: true });

    await setEditorValue(wrapper, 'switch to the smaller fix');
    await editor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steer')).toStrictEqual([['switch to the smaller fix']]);
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('ignores unsupported Enter modifier combinations', async () => {
    const wrapper = mountComposer();
    await setEditorValue(wrapper, 'keep this draft');

    for (const init of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true, ctrlKey: true },
      { metaKey: true, altKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        ...init,
      });
      editor(wrapper).element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    expect(wrapper.emitted('send')).toBeUndefined();
    expect(wrapper.emitted('steer')).toBeUndefined();
    expect(editorValue(wrapper)).toBe('keep this draft');
  });

  it('leaves modified Shift Tab alone', () => {
    const wrapper = mountComposer();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
      shiftKey: true,
      ctrlKey: true,
    });

    editor(wrapper).element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted('update:planMode')).toBeUndefined();
  });

  it('honors a host capability override when toggling plan mode and skills', async () => {
    const wrapper = mountComposer({
      capabilities: disabledCapabilities(),
      skills,
    });

    await editor(wrapper).trigger('keydown', { key: 'Tab', shiftKey: true });
    await setEditorValue(wrapper, '$front');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.emitted('update:planMode')).toBeUndefined();
    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(false);
  });

  it('opens the composer action menu and toggles plan mode', async () => {
    const wrapper = mountComposer();

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');

    expect(wrapper.find('.chat-composer-action-menu').exists()).toBe(true);
    await wrapper.find('[role="menuitemcheckbox"]').trigger('click');

    expect(wrapper.emitted('update:planMode')).toStrictEqual([[true]]);
  });

  it('toggles plan mode with Shift Tab and renders active mode chips', async () => {
    const wrapper = mountComposer({
      planMode: true,
    });

    expect(wrapper.text()).toContain('Plan');

    await editor(wrapper).trigger('keydown', { key: 'Tab', shiftKey: true });

    expect(wrapper.emitted('update:planMode')).toStrictEqual([[false]]);
  });

  it('removes active mode chips through their remove affordance', async () => {
    const wrapper = mountComposer({
      planMode: true,
    });

    const removeButtons = wrapper.findAll('.chat-composer__mode__remove');
    await removeButtons[0]!.trigger('click');

    expect(wrapper.emitted('update:planMode')).toStrictEqual([[false]]);
  });

  it('disables sending without text or without an agent but keeps busy drafts submittable', async () => {
    const empty = mountComposer();
    expect(empty.get('.chat-composer__send').attributes()).toHaveProperty('disabled');

    const disabled = mountComposer({ disabled: true });
    await setEditorValue(disabled, 'hello');
    expect(disabled.get('.chat-composer__send').attributes()).toHaveProperty('disabled');

    const sending = mountComposer({ isSending: true });
    await setEditorValue(sending, 'hello');
    expect(sending.get('.chat-composer__send').attributes()).not.toHaveProperty('disabled');
    await sending.get('form').trigger('submit');
    expect(sending.emitted('send')).toStrictEqual([['hello']]);
  });

  it('renders selected Codex model and reasoning controls', async () => {
    const wrapper = mountComposer({
      models,
      selectedModelId: 'codex-max',
      selectedReasoningEffort: 'high',
    });

    expect(wrapper.text()).toContain('5.1 Codex Max');
    expect(wrapper.text()).toContain('High');

    await wrapper.get('.chat-model-selector__button').trigger('click');
    expect(wrapper.text()).toContain('GPT-5.1 Codex Max');
  });

  it('allows changing the model while Codex is responding', async () => {
    const wrapper = mountComposer({
      isSending: true,
      models: [
        ...models,
        {
          ...models[0]!,
          id: 'codex-fast',
          model: 'gpt-5.1-codex-fast',
          displayName: 'GPT-5.1 Codex Fast',
          isDefault: false,
        },
      ],
      selectedModelId: 'codex-max',
    });

    const trigger = wrapper.get<HTMLButtonElement>('.chat-model-selector__button');
    expect(trigger.element.disabled).toBe(false);

    await trigger.trigger('click');
    await wrapper.get('[data-submenu-id="model"] > button').trigger('click');
    await wrapper.findAll('[data-submenu-id="model"] [role="menuitemradio"]')[1]!.trigger('click');

    expect(wrapper.emitted('update:modelId')).toStrictEqual([['codex-fast']]);
  });

  it('keeps the editor above a split control row', () => {
    const wrapper = mountComposer({
      contextUsage: {
        totalTokens: 50_000,
        inputTokens: 40_000,
        cachedInputTokens: 10_000,
        outputTokens: 8_000,
        reasoningOutputTokens: 2_000,
        lastTotalTokens: 50_000,
        modelContextWindow: 200_000,
        usedPercent: 25,
      },
      models,
      transcribeAudio: vi.fn(async () => ({ text: 'hello' })),
    });

    const inputRow = wrapper.get('.chat-composer__input-row');
    const leading = wrapper.get('.chat-composer__meta-leading');
    const trailing = wrapper.get('.chat-composer__meta-trailing');
    expect(inputRow.find('.chat-rich-text-editor').exists()).toBe(true);
    expect(leading.find('.chat-composer-action-menu__root').exists()).toBe(true);
    expect(leading.find('.chat-context-usage').exists()).toBe(false);
    expect(trailing.find('.chat-model-selector').exists()).toBe(true);
    expect(trailing.find('.chat-context-usage').exists()).toBe(true);
    expect(trailing.find('.chat-composer__voice').exists()).toBe(true);
    expect(trailing.find('.chat-composer__send').exists()).toBe(true);
  });

  it('shows context utilization when Codex reports token usage', () => {
    const wrapper = mountComposer({
      contextUsage: {
        totalTokens: 397_740,
        inputTokens: 40_000,
        cachedInputTokens: 10_000,
        outputTokens: 8_000,
        reasoningOutputTokens: 2_000,
        lastTotalTokens: 50_000,
        modelContextWindow: 200_000,
        usedPercent: 25,
      },
    });

    expect(wrapper.find('.chat-context-usage').exists()).toBe(true);
    expect(wrapper.find('.chat-context-usage').attributes('title')).toBeUndefined();
    expect(wrapper.find('.chat-context-usage__popover').text()).toContain('25% used (75% left)');
  });

  it('hides unavailable voice input and supports a minimal composer presentation', () => {
    const contextUsage: CodexContextUsage = {
      totalTokens: 50_000,
      inputTokens: 40_000,
      cachedInputTokens: 10_000,
      outputTokens: 8_000,
      reasoningOutputTokens: 2_000,
      lastTotalTokens: 50_000,
      modelContextWindow: 200_000,
      usedPercent: 25,
    };
    const unavailable = mountComposer({ contextUsage });
    const full = mountComposer({
      contextUsage,
      transcribeAudio: vi.fn(async () => ({ text: 'hello' })),
    });
    const minimal = mountComposer({
      contextUsage,
      presentation: {
        composer: { actionMenu: false, contextUsage: false, voice: false },
      },
      transcribeAudio: vi.fn(async () => ({ text: 'hello' })),
    });

    expect(unavailable.find('.chat-composer__voice').exists()).toBe(false);
    expect(full.find('.chat-composer-action-menu__root').exists()).toBe(true);
    expect(full.find('.chat-context-usage').exists()).toBe(true);
    expect(full.find('.chat-composer__voice').exists()).toBe(true);
    expect(minimal.find('.chat-composer-action-menu__root').exists()).toBe(false);
    expect(minimal.find('.chat-context-usage').exists()).toBe(false);
    expect(minimal.find('.chat-composer__voice').exists()).toBe(false);
    expect(minimal.find('.chat-rich-text-editor').exists()).toBe(true);
    expect(minimal.find('.chat-composer__send').exists()).toBe(true);
  });

  it('opens a dollar skill menu, filters skills, and inserts the selected skill', async () => {
    const wrapper = mountComposer({ skills });

    await setEditorValue(wrapper, '$front');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-skill-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('Frontend Design');
    expect(wrapper.text()).not.toContain('skill-creator');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(editorValue(wrapper)).toBe('$frontend-design ');
  });

  it('does not reopen an escaped slash menu on the Escape keyup', async () => {
    const wrapper = mountComposer({ commands: codexCommands });

    await setEditorValue(wrapper, '/');
    await editor(wrapper).trigger('keyup', { key: '/' });
    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(true);

    await editor(wrapper).trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(false);
    await editor(wrapper).trigger('keyup', { key: 'Escape' });
    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(false);

    await setEditorValue(wrapper, '/c');
    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(true);
  });

  it('shows the canonical plugin namespace for contributed skills', async () => {
    const dropbox = {
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote',
      name: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      displayName: 'Dropbox',
      enabled: true,
    } satisfies CodexSurfacePlugin;
    const wrapper = mountComposer({
      plugins: [dropbox],
      skills: [{
        name: `${dropbox.name}:clean-up-dropbox-content`,
        description: 'Clean up Dropbox content.',
        path: '/plugins/dropbox/skills/clean-up-dropbox-content/SKILL.md',
        enabled: true,
      }],
    });

    await setEditorValue(wrapper, '$clean');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.get('.chat-composer-skill-menu__name').text())
      .toBe('dropbox:clean-up-dropbox-content');
    expect(wrapper.text()).not.toContain(dropbox.name);
  });

  it('opens a combined at-mention menu and inserts the canonical plugin name', async () => {
    const wrapper = mountComposer({ plugins });

    await setEditorValue(wrapper, '@g');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-at-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('Gmail');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(editorValue(wrapper)).toBe('@gmail ');
    expect(editor(wrapper).find('[data-plugin-name="gmail"]').exists()).toBe(true);
  });

  it('keeps @ mentions available for file search when plugins are configured', async () => {
    const wrapper = mountComposer({ plugins, files });

    await setEditorValue(wrapper, '@resea');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-at-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('Files');
  });

  it('mounts the exported plugin menu component', () => {
    const wrapper = mount(CodexComposerPluginMenu, {
      props: { activeIndex: 0, visiblePlugins: plugins },
    });

    expect(wrapper.get('[role="option"]').text()).toContain('Gmail');
  });

  it('navigates dollar skills with arrow keys and inserts with enter', async () => {
    const wrapper = mountComposer({ skills });

    await setEditorValue(wrapper, '$');
    await editor(wrapper).trigger('keyup');
    await editor(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(editorValue(wrapper)).toBe('$skill-creator ');
  });

  it('shows slash commands before skills and submits Codex compact', async () => {
    const wrapper = mountComposer({
      commands: codexCommands,
      skills,
    });

    await setEditorValue(wrapper, '/comp');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('Commands');
    expect(wrapper.text()).toContain('compact');
    expect(wrapper.text()).not.toContain('/compact');
    expect(wrapper.text()).not.toContain('/frontend-design');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toStrictEqual([['/compact']]);
    expect(editorValue(wrapper)).toBe('');
  });

  it('executes a highlighted slash command with Enter and completes it with Tab', async () => {
    const commands: CodexCommandSummary[] = [
      { id: 'host.alpha', name: 'alpha' },
      { id: 'host.beta', name: 'beta' },
    ];
    const execute = mountComposer({ commands });

    await setEditorValue(execute, '/');
    await editor(execute).trigger('keyup');
    await editor(execute).trigger('keydown', { key: 'ArrowDown' });
    await editor(execute).trigger('keydown', { key: 'Enter' });

    expect(execute.emitted('send')).toStrictEqual([['/beta']]);
    expect(editorValue(execute)).toBe('');

    const complete = mountComposer({ commands });
    await setEditorValue(complete, '/');
    await editor(complete).trigger('keyup');
    await editor(complete).trigger('keydown', { key: 'ArrowDown' });
    await editor(complete).trigger('keydown', { key: 'Tab' });

    expect(complete.emitted('send')).toBeUndefined();
    expect(editorValue(complete)).toBe('/beta ');

    const goal = mountComposer({ commands: codexCommands });
    await setEditorValue(goal, '/goa');
    await editor(goal).trigger('keyup');
    await editor(goal).trigger('keydown', { key: 'Tab' });

    expect(goal.emitted('send')).toBeUndefined();
    expect(editorValue(goal)).toBe('');
    expect(goal.get('[aria-label="Active composer modes"]').text()).toBe('Goal');

    await setEditorValue(goal, 'Ship the SDK');
    await goal.get('form').trigger('submit');

    expect(goal.emitted('send')).toStrictEqual([['/goal Ship the SDK']]);
    expect(goal.find('[aria-label="Active composer modes"]').exists()).toBe(false);
  });

  it('remembers a submitted slash command for prompt recall', async () => {
    const wrapper = mountComposer({ commands: codexCommands });
    await setEditorValue(wrapper, '/comp');
    await editor(wrapper).trigger('keyup');
    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    await editor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();

    expect(editorValue(wrapper)).toBe('/compact');
  });

  it('submits Codex review from the slash command menu without showing a slash prefix', async () => {
    const wrapper = mountComposer({
      commands: codexCommands,
      skills,
    });

    await setEditorValue(wrapper, '/rev');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('review');
    expect(wrapper.text()).not.toContain('/review');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toStrictEqual([['/review']]);
    expect(editorValue(wrapper)).toBe('');
  });

  it('submits Codex plan from the slash command menu without showing a slash prefix', async () => {
    const wrapper = mountComposer({
      commands: codexCommands,
      skills,
    });

    await setEditorValue(wrapper, '/pla');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('plan');
    expect(wrapper.text()).not.toContain('/plan');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toStrictEqual([['/plan']]);
    expect(editorValue(wrapper)).toBe('');
  });

  it('collects a required goal objective in a removable composer mode before submission', async () => {
    const wrapper = mountComposer({
      commands: codexCommands,
      skills,
    });

    await setEditorValue(wrapper, '/goa');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-slash-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('goal');
    expect(wrapper.text()).not.toContain('/goal');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toBeUndefined();
    expect(editorValue(wrapper)).toBe('');
    expect(wrapper.get('[aria-label="Active composer modes"]').text()).toBe('Goal');
    expect(wrapper.findComponent(ChatRichTextEditor).props('placeholder')).toBe('Describe the goal');
    expect(wrapper.get('.chat-composer__send').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ hasAttachments: true });
    expect(wrapper.get('.chat-composer__send').attributes('disabled')).toBeDefined();

    const controlledState = wrapper.emitted('update:composerState')?.at(-1)?.[0] as CodexComposerState;
    expect(controlledState).toStrictEqual({
      text: '', selectionStart: 0, selectionEnd: 0, activeCommandId: 'codex.goal',
    });
    await wrapper.setProps({ composerState: controlledState });
    expect(wrapper.get('[aria-label="Active composer modes"]').text()).toBe('Goal');

    await setEditorValue(wrapper, 'Keep this draft');
    await wrapper.get('[aria-label="Remove Goal command"]').trigger('click');
    expect(editorValue(wrapper)).toBe('Keep this draft');
    expect(wrapper.find('[aria-label="Active composer modes"]').exists()).toBe(false);
    expect(wrapper.findComponent(ChatRichTextEditor).props('placeholder')).toBe('Ask for follow-up changes');

    await setEditorValue(wrapper, '/goa');
    await editor(wrapper).trigger('keyup');
    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    await setEditorValue(wrapper, 'Ship the SDK');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toStrictEqual([['/goal Ship the SDK']]);
    expect(editorValue(wrapper)).toBe('');
    expect(wrapper.find('[aria-label="Remove Goal command"]').exists()).toBe(false);
  });

  it('keeps slash suggestions limited to commands', async () => {
    const wrapper = mountComposer({
      commands: codexCommands,
      skills,
    });

    await setEditorValue(wrapper, '/');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.text()).toContain('Commands');
    expect(wrapper.text()).not.toContain('Skills');

    expect(editor(wrapper).find('[data-skill-name]').exists()).toBe(false);
  });

  it('opens an @ file menu, filters files, and inserts the selected relative path', async () => {
    const wrapper = mountComposer({ files });

    await setEditorValue(wrapper, 'read @resea');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-at-menu').exists()).toBe(true);
    expect(wrapper.text()).toContain('research.md');
    expect(wrapper.text()).toContain('docs/research.md');

    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(editorValue(wrapper)).toBe('read @docs/research.md ');
    expect(editor(wrapper).find('[data-file-mention="docs/research.md"]').exists()).toBe(true);
  });

  it('continues typing at a mention inserted in the middle of a draft', async () => {
    const wrapper = mountComposer({ files }, { attachTo: document.body });
    await setEditorValue(wrapper, 'inspect @resea then');
    richEditorVm(wrapper).setCaret('inspect @resea'.length);
    await editor(wrapper).trigger('keyup');
    await editor(wrapper).trigger('keydown', { key: 'Enter' });
    await nextTick();

    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 26, end: 26 });
    richEditorVm(wrapper).insertTextAtSelection('!');
    await nextTick();
    expect(editorValue(wrapper)).toBe('inspect @docs/research.md ! then');
    wrapper.unmount();
  });

  it('navigates @ file results with arrow keys', async () => {
    const wrapper = mountComposer({
      files: [
        { name: 'alpha.ts', path: 'src/alpha.ts' },
        { name: 'beta.ts', path: 'src/beta.ts' },
      ],
    });

    await setEditorValue(wrapper, 'inspect @');
    await editor(wrapper).trigger('keyup');

    expect(wrapper.find('.chat-composer-at-menu__hint').exists()).toBe(true);

    await setEditorValue(wrapper, 'inspect @ts');
    await editor(wrapper).trigger('keyup');
    await nextTick();
    await editor(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await editor(wrapper).trigger('keydown', { key: 'Enter' });

    expect(editorValue(wrapper)).toBe('inspect @src/beta.ts ');
  });

  it('records audio and inserts the Apple speech transcript at the caret', async () => {
    installAudioRecordingMocks();
    const transcribeAppleSpeech = vi.fn(async () => ({ text: 'dictated change' }));
    const wrapper = mountComposer({ transcribeAudio: transcribeAppleSpeech });

    await setEditorValue(wrapper, 'please');
    richEditorVm(wrapper).setCaret(6);
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    expect(wrapper.find('.chat-composer-waveform').exists()).toBe(true);

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(editorValue(wrapper)).toBe('please dictated change');
    });

    expect(transcribeAppleSpeech).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      locale: navigator.language,
    });
  });

  it('normalizes transcript whitespace and separates it from surrounding text', async () => {
    installAudioRecordingMocks();
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(async () => ({ text: '  dictated change  ' })),
    }, { attachTo: document.body });
    await setEditorValue(wrapper, 'beforeafter');
    richEditorVm(wrapper).setCaret('before'.length);

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(editorValue(wrapper)).toBe('before dictated change after');
    });

    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 23, end: 23 });
    wrapper.unmount();
  });

  it('uses adjacent whitespace rather than whitespace elsewhere when inserting a transcript', async () => {
    installAudioRecordingMocks();
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(async () => ({ text: 'middle' })),
    }, { attachTo: document.body });
    await setEditorValue(wrapper, 'two wordsafter more');
    richEditorVm(wrapper).setCaret('two words'.length);

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(editorValue(wrapper)).toBe('two words middle after more');
    });

    wrapper.unmount();
  });

  it('replaces the selected draft text with the transcript', async () => {
    installAudioRecordingMocks();
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(async () => ({ text: 'new words' })),
    }, { attachTo: document.body });
    await setEditorValue(wrapper, 'keep old ending');
    richEditorVm(wrapper).setSelection(5, 8);

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(editorValue(wrapper)).toBe('keep new words ending');
    });

    expect(richEditorVm(wrapper).getSelectionRange()).toMatchObject({ start: 14, end: 14 });
    wrapper.unmount();
  });

  it('ignores an empty speech transcript without changing the draft', async () => {
    installAudioRecordingMocks();
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(async () => ({ text: '   ' })),
    });
    await setEditorValue(wrapper, 'keep me');

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('false');
    });

    await vi.waitFor(() => expect(editorValue(wrapper)).toBe('keep me'));
  });

  it('keeps send enabled while recording and submits the completed transcript once', async () => {
    installAudioRecordingMocks();
    const transcribeAppleSpeech = vi.fn(async () => ({ text: 'dictated change' }));
    const wrapper = mountComposer({ transcribeAudio: transcribeAppleSpeech });

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    expect(wrapper.get('.chat-composer__send').attributes()).not.toHaveProperty('disabled');

    await wrapper.get('.chat-composer__send').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.emitted('send')).toStrictEqual([[
        'dictated change',
        { inputMethod: 'dictated' },
      ]]);
    });

    expect(wrapper.emitted('send')).toHaveLength(1);
    expect(transcribeAppleSpeech).toHaveBeenCalledOnce();
    expect(editorValue(wrapper)).toBe('');
  });

  it('resets dictated input provenance after submission', async () => {
    installAudioRecordingMocks();
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(async () => ({ text: 'dictated change' })),
    });

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    await wrapper.get('.chat-composer__send').trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('send')).toHaveLength(1));

    await setEditorValue(wrapper, 'typed follow-up');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toStrictEqual([
      ['dictated change', { inputMethod: 'dictated' }],
      ['typed follow-up'],
    ]);
  });

  it('prevents duplicate sends while transcribe-and-send is pending', async () => {
    installAudioRecordingMocks();
    let resolveTranscription!: (value: { text: string }) => void;
    const transcribeAppleSpeech = vi.fn(() => new Promise<{ text: string }>((resolve) => {
      resolveTranscription = resolve;
    }));
    const wrapper = mountComposer({ transcribeAudio: transcribeAppleSpeech });

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });

    const send = wrapper.get('.chat-composer__send');
    await send.trigger('click');
    expect(send.attributes()).toHaveProperty('disabled');
    await send.trigger('click');
    await vi.waitFor(() => expect(transcribeAppleSpeech).toHaveBeenCalledOnce());

    resolveTranscription({ text: 'queued voice prompt' });
    await vi.waitFor(() => {
      expect(wrapper.emitted('send')).toStrictEqual([[
        'queued voice prompt',
        { inputMethod: 'dictated' },
      ]]);
    });
    expect(wrapper.emitted('send')).toHaveLength(1);
  });

  it('disables send while voice-only transcription is pending', async () => {
    installAudioRecordingMocks();
    let resolveTranscription!: (value: { text: string }) => void;
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(() => new Promise<{ text: string }>((resolve) => {
        resolveTranscription = resolve;
      })),
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });

    void wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__send').attributes()).toHaveProperty('disabled');
    });
    resolveTranscription({ text: 'finished' });
    await vi.waitFor(() => expect(editorValue(wrapper)).toBe('finished'));
  });

  it('does not send an existing draft while a voice transcript is pending', async () => {
    installAudioRecordingMocks();
    let resolveTranscription!: (value: { text: string }) => void;
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(() => new Promise<{ text: string }>((resolve) => {
        resolveTranscription = resolve;
      })),
    });
    await setEditorValue(wrapper, 'typed first');
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });

    void wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__send').attributes()).toHaveProperty('disabled');
    });
    await wrapper.get('.chat-composer__send').trigger('click');
    expect(wrapper.emitted('send')).toBeUndefined();

    resolveTranscription({ text: 'dictated second' });
    await vi.waitFor(() => expect(editorValue(wrapper)).toBe('typed first dictated second'));
  });

  it('clears transcribe-and-send pending state after transcription fails', async () => {
    installAudioRecordingMocks();
    const wrapper = mountComposer({
      transcribeAudio: vi.fn(async () => ({ error: 'No speech', text: '' })),
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });

    await wrapper.get('.chat-composer__send').trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('error')).toContainEqual(['No speech']));
    await setEditorValue(wrapper, 'typed instead');

    expect(wrapper.get('.chat-composer__send').attributes()).not.toHaveProperty('disabled');
  });

  it('keeps voice input disabled only for a disabled idle composer', () => {
    installAudioRecordingMocks();
    const transcribeAudio = vi.fn(async () => ({ text: 'hello' }));
    const idle = mountComposer({ disabled: true, transcribeAudio });
    const sending = mountComposer({ disabled: true, isSending: true, transcribeAudio });

    expect(idle.get('.chat-composer__voice').attributes()).toHaveProperty('disabled');
    expect(sending.get('.chat-composer__voice').attributes()).not.toHaveProperty('disabled');
  });

  it('emits transcription failures and clears them when recording is retried', async () => {
    installAudioRecordingMocks();
    const transcribeAppleSpeech = vi.fn(async () => ({
      error: 'No speech was recognized.',
      text: '',
    }));
    const wrapper = mountComposer({ transcribeAudio: transcribeAppleSpeech });

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('.chat-composer__voice').attributes('aria-pressed')).toBe('true');
    });
    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.emitted('error')).toContainEqual(['No speech was recognized.']);
    });

    await wrapper.get('.chat-composer__voice').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.emitted('error')).toContainEqual([null]);
    });
  });
});

function editor(wrapper: ReturnType<typeof mountComposer>) {
  return wrapper.get<HTMLElement>('.chat-rich-text-editor');
}

function richEditorVm(wrapper: ReturnType<typeof mountComposer>): CodexRichTextEditorExpose {
  return wrapper.findComponent(ChatRichTextEditor).vm as unknown as CodexRichTextEditorExpose;
}

function editorValue(wrapper: ReturnType<typeof mountComposer>): string {
  return richEditorVm(wrapper).readText();
}

async function setEditorValue(wrapper: ReturnType<typeof mountComposer>, value: string): Promise<void> {
  editor(wrapper).element.textContent = value;
  await editor(wrapper).trigger('input');
  await nextTick();
}

async function appendNativeCharacter(
  wrapper: ReturnType<typeof mountComposer>,
  character: string,
  reportedCaretOffsetFromEnd = 0,
): Promise<void> {
  const element = editor(wrapper).element;
  const lastTextNode = [...element.childNodes].reverse()
    .find((node): node is Text => node.nodeType === Node.TEXT_NODE);
  if (!lastTextNode) throw new Error('Expected an editor text node');
  lastTextNode.data += character;
  const range = document.createRange();
  range.setStart(lastTextNode, lastTextNode.length - reportedCaretOffsetFromEnd);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await editor(wrapper).trigger('input');
  await nextTick();
}

function clipboardEvent({
  files,
  text,
  types,
}: {
  files: File[];
  text: string;
  types?: string[];
}): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      getData: (type: string) => type === 'text/plain' ? text : '',
      types,
    },
  });
  return event;
}

function mountComposer(overrides: Partial<ChatComposerProps & {
  autofocus: boolean;
  capabilities: CodexCapabilities;
  contextUsage: CodexContextUsage;
  commands: readonly CodexCommandSummary[];
  models: CodexModelOption[];
  planMode: boolean;
  presentation: CodexConversationPresentation;
  selectedModelId: string;
  selectedReasoningEffort: string;
  files: CodexFileSearchItem[];
  skills: CodexSkillSummary[];
  plugins: CodexSurfacePlugin[];
  transcribeAudio: CodexChatTranscription;
}> = {}, options: { attachTo?: HTMLElement } = {}) {
  return mount(CodexComposer, {
    ...options,
    props: {
      disabled: false,
      isSending: false,
      placeholder: 'Ask for follow-up changes',
      ...overrides,
    },
  });
}

function disabledCapabilities(): CodexCapabilities {
  return {
    models: false,
    skills: false,
    reasoningEffort: false,
    serviceTier: false,
    planMode: false,
    goals: false,
    steerPrompt: false,
    interrupt: false,
    history: false,
    deleteTurn: false,
    editTurn: false,
    retryTurn: false,
    approvals: false,
  };
}

function installAudioRecordingMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    color: 'rgb(10, 20, 30)',
  } as CSSStyleDeclaration);
  const analyser = {
    disconnect: vi.fn(),
    fftSize: 0,
    frequencyBinCount: 4,
    getByteTimeDomainData: vi.fn((target: Uint8Array) => {
      target.fill(128);
    }),
  };
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  class FakeAudioContext {
    close = vi.fn(async () => undefined);
    createAnalyser = vi.fn(() => analyser);
    createMediaStreamSource = vi.fn(() => source);
    decodeAudioData = vi.fn(async () => ({
      length: 1,
      numberOfChannels: 1,
      sampleRate: 16_000,
      getChannelData: () => new Float32Array([0]),
    } as unknown as AudioBuffer));
    resume = vi.fn(async () => undefined);
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  });

  class FakeMediaRecorder {
    static isTypeSupported = vi.fn(() => true);

    mimeType = 'audio/wav';
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    state: RecordingState = 'inactive';

    start(): void {
      this.state = 'recording';
    }

    stop(): void {
      this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) } as BlobEvent);
      this.state = 'inactive';
      this.onstop?.();
    }
  }

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
}
