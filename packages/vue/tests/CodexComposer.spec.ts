// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import CodexComposer from '../src/components/CodexComposer.vue';
import CodexComposerPluginMenu from '../src/chat/ChatComposerPluginMenu.vue';
import ChatRichTextEditor, { type CodexRichTextEditorExpose } from '../src/chat/ChatRichTextEditor.vue';
import { codexCommands } from '../src/chat/codex-commands';
import type { CodexContextUsage, CodexFileSearchItem, CodexCommandSummary, CodexConversationPresentation, CodexModelOption, CodexSkillSummary, CodexChatTranscription } from '../src/chat/contracts';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import type { CodexComposerState } from '../src/composer-state';

vi.mock('fix-webm-duration', () => ({
  default: vi.fn(async (blob: Blob) => blob),
}));

type ChatComposerProps = {
  composerState?: CodexComposerState;
  disabled: boolean;
  draft?: string;
  draftRevision?: number;
  isSending: boolean;
  hasAttachments?: boolean;
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

  it('submits the attachment-only prompt sentinel', async () => {
    const wrapper = mountComposer({ hasAttachments: true });

    expect(wrapper.get('.chat-composer__send').attributes()).not.toHaveProperty('disabled');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('send')).toStrictEqual([['(no user instructions)']]);
  });

  it('steers the queued prompt from an empty Cmd Enter shortcut', async () => {
    const wrapper = mountComposer({ queuedPromptId: 'queued-1' });

    await editor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-1']]);
    expect(wrapper.emitted('steer')).toBeUndefined();
  });

  it('prefills and focuses the composer from a draft revision', async () => {
    const wrapper = mountComposer({
      draft: 'quoted prompt',
      draftRevision: 1,
    });
    await nextTick();

    expect(editorValue(wrapper)).toBe('quoted prompt');
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

  it('steers with Command Enter', async () => {
    const wrapper = mountComposer({ isSending: true });

    await setEditorValue(wrapper, 'switch to the smaller fix');
    await editor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steer')).toStrictEqual([['switch to the smaller fix']]);
    expect(wrapper.emitted('send')).toBeUndefined();
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

  it('submits Codex goal from the slash command menu without showing a slash prefix', async () => {
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

    expect(wrapper.emitted('send')).toStrictEqual([['/goal']]);
    expect(editorValue(wrapper)).toBe('');
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
      expect(wrapper.emitted('send')).toStrictEqual([['dictated change']]);
    });

    expect(wrapper.emitted('send')).toHaveLength(1);
    expect(transcribeAppleSpeech).toHaveBeenCalledOnce();
    expect(editorValue(wrapper)).toBe('');
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
      expect(wrapper.emitted('send')).toStrictEqual([['queued voice prompt']]);
    });
    expect(wrapper.emitted('send')).toHaveLength(1);
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

function mountComposer(overrides: Partial<ChatComposerProps & {
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
}> = {}) {
  return mount(CodexComposer, {
    props: {
      disabled: false,
      isSending: false,
      placeholder: 'Ask for follow-up changes',
      ...overrides,
    },
  });
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

    mimeType = 'audio/webm;codecs=opus';
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
