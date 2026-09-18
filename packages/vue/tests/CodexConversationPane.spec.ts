// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, reactive, ref, type Component } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  CodexConversationPane,
  createCodexConversationPaneController,
  CodexMessage,
  CodexMessageList,
  CodexRichTextEditor,
  type CodexRichTextEditorExpose,
  type CodexComposerMenuItem,
  type CodexNativeAttachment,
  type CodexConversationPaneState,
  type CodexMessageTextSelection,
  type CodexSurfaceController,
  type SurfaceMessage,
} from '../src';
import type { CodexSurfaceSnapshot, CodexSurfaceTurn } from '@codex-app-sdk/core/surface';
import type { Message } from '../src/chat/types';
import ChatComposerShelf from '../src/chat/ChatComposerShelf.vue';
import CodexComposer from '../src/components/CodexComposer.vue';

const messages: SurfaceMessage[] = [{
  id: 'assistant-1',
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'Ready to build' }],
}];

const routingApproval = {
  id: 'routing-approval',
  kind: 'file-change' as const,
  conversationId: 'routing-thread',
  turnId: 'routing-turn',
  itemId: 'routing-item',
  title: 'Apply routing changes',
};
const routingMenuItem = {
  id: 'routing-menu-item', type: 'custom' as const, label: 'Route action', payload: { source: 'routing' },
};
const routingMentionGroup = {
  id: 'routing-mentions',
  label: 'Routing mentions',
  items: [{ id: 'routing-mention', value: 'thread:routing', label: 'Routing thread' }],
};

describe('CodexConversationPane', () => {
  it('forwards opt-in message selections and host-owned composer context', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        hasComposerContext: true,
        messageTextSelection: true,
        messages,
        modelValue: '',
      },
      slots: {
        'composer-context': ({ disabled }: { disabled: boolean }) => h(
          'div',
          { class: 'host-composer-context', 'data-disabled': String(disabled) },
          'Selected quote',
        ),
      },
    });
    const selection: CodexMessageTextSelection = {
      anchor: { x: 10, y: 20, width: 30, height: 40 },
      messageId: 'assistant-1',
      messageIndex: 0,
      role: 'assistant',
      text: 'Ready to build',
    };
    const list = wrapper.getComponent(CodexMessageList);

    expect(list.props('messageTextSelection')).toBe(true);
    expect(composerProps(wrapper).hasExternalContent).toBe(true);
    expect(wrapper.get('.host-composer-context').text()).toBe('Selected quote');

    list.vm.$emit('message-text-selection-change', selection);
    await nextTick();
    expect(wrapper.emitted('messageTextSelectionChange')).toStrictEqual([[selection]]);
  });

  it('submits host-owned composer context without inventing prompt text', async () => {
    const submit = vi.fn(async () => undefined);
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'thread-context', messages } },
      actions: { submit },
    });
    const wrapper = mount(CodexConversationPane, {
      props: { controller, hasComposerContext: true },
    });

    await wrapper.get('button[aria-label="Send prompt"]').trigger('click');
    await flushPromises();

    expect(submit).toHaveBeenCalledWith('', undefined);
  });

  it('seeds prompt recall from existing user messages', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        conversationKey: 'thread-1',
        messages: [
          { id: 'user-1', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'First prompt' }] },
          { id: 'assistant-1', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Done' }] },
          { id: 'user-2', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Second prompt' }] },
        ],
        modelValue: '',
      },
    });

    await composerEditor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(composerValue(wrapper)).toBe('Second prompt');
    await composerEditor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(composerValue(wrapper)).toBe('First prompt');
  });

  it('loads bounded prompt history on activation and merges the visible lazy page', async () => {
    const readPromptHistory = vi.fn(async () => ['First prompt', 'Second prompt']);
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'thread-1',
          messages: [
            { id: 'user-2', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Second prompt' }] },
            { id: 'assistant-2', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Done' }] },
            { id: 'user-3', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Third prompt' }] },
          ],
        },
      },
      actions: { readPromptHistory },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await vi.waitFor(() => expect(readPromptHistory).toHaveBeenCalledOnce());
    await composerEditor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(composerValue(wrapper)).toBe('Third prompt');
    await composerEditor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(composerValue(wrapper)).toBe('Second prompt');
    await composerEditor(wrapper).trigger('keydown', { key: 'ArrowUp' });
    await nextTick();
    expect(composerValue(wrapper)).toBe('First prompt');
  });

  it('keeps prompt-history loading observable and clears it after optional loader failures', async () => {
    let rejectHistory!: (reason?: unknown) => void;
    const readPromptHistory = vi.fn(() => new Promise<readonly string[]>((_resolve, reject) => {
      rejectHistory = reject;
    }));
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'thread-loading', messages: [] } },
      actions: { readPromptHistory },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await vi.waitFor(() => expect(readPromptHistory).toHaveBeenCalledOnce());
    expect(composerProps(wrapper).promptHistoryLoading).toBe(true);
    rejectHistory(new Error('history unavailable'));
    await flushPromises();

    expect(composerProps(wrapper).promptHistoryLoading).toBe(false);
    expect(composerProps(wrapper).promptHistory).toStrictEqual([]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('skips prompt-history loading for configured history and missing conversation keys', async () => {
    const configuredLoader = vi.fn(async () => ['must not load']);
    const configured = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'thread-configured', messages: [] },
        composer: { promptHistory: ['Configured prompt'] },
      },
      actions: { readPromptHistory: configuredLoader },
    });
    const configuredWrapper = mount(CodexConversationPane, { props: { controller: configured } });
    await flushPromises();

    expect(configuredLoader).not.toHaveBeenCalled();
    expect(composerProps(configuredWrapper).promptHistory).toStrictEqual([
      'Configured prompt',
    ]);
    expect(composerProps(configuredWrapper).promptHistoryLoading).toBe(false);

    const missingKeyLoader = vi.fn(async () => ['must not load']);
    const missingKey = createCodexConversationPaneController({
      state: { identity: { conversationKey: null, messages: [] } },
      actions: { readPromptHistory: missingKeyLoader },
    });
    const missingKeyWrapper = mount(CodexConversationPane, { props: { controller: missingKey } });
    await flushPromises();

    expect(missingKeyLoader).not.toHaveBeenCalled();
    expect(composerProps(missingKeyWrapper).promptHistory).toStrictEqual([]);
    expect(composerProps(missingKeyWrapper).promptHistoryLoading).toBe(false);

    const undefinedKeyLoader = vi.fn(async () => ['must not load']);
    const undefinedKey = createCodexConversationPaneController({
      state: { identity: { messages: [] } },
      actions: { readPromptHistory: undefinedKeyLoader },
    });
    const undefinedKeyWrapper = mount(CodexConversationPane, { props: { controller: undefinedKey } });
    await flushPromises();
    expect(undefinedKeyLoader).not.toHaveBeenCalled();
    expect(composerProps(undefinedKeyWrapper).promptHistoryLoading).toBe(false);
  });

  it('loads prompt history when a controlled loader becomes available', async () => {
    const readPromptHistory = vi.fn(async () => ['Late history']);
    const actions = ref<{ readPromptHistory?: () => Promise<readonly string[]> }>({});
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'thread-late-loader', messages: [] } },
      actions,
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await flushPromises();
    expect(composerProps(wrapper).promptHistory).toStrictEqual([]);

    actions.value = { readPromptHistory };
    await vi.waitFor(() => expect(readPromptHistory).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory).toStrictEqual(['Late history']));
  });

  it('loads surface prompt history when an active conversation becomes available', async () => {
    const surface = fakeSurfaceController();
    surface.state.status = 'ready';
    const wrapper = mount(CodexConversationPane, {
      props: { conversationKey: 'stable-history-cache-key', surface },
    });
    await flushPromises();
    expect(surface.readConversationPromptHistory).not.toHaveBeenCalled();

    surface.state.activeConversationId = 'thread-late-surface';
    await vi.waitFor(() => expect(surface.readConversationPromptHistory)
      .toHaveBeenCalledWith('thread-late-surface'));
    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory).toStrictEqual(['Earlier prompt']));
  });

  it('loads controlled prompt history when an explicit history override is removed', async () => {
    const state = reactive<CodexConversationPaneState>({
      identity: { conversationKey: 'thread-history-override', messages: [] },
      composer: { promptHistory: ['Configured history'] },
    });
    const readPromptHistory = vi.fn(async () => ['Loaded history']);
    const controller = createCodexConversationPaneController({ state, actions: { readPromptHistory } });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await flushPromises();
    expect(readPromptHistory).not.toHaveBeenCalled();

    state.composer!.promptHistory = undefined;
    await vi.waitFor(() => expect(readPromptHistory).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory).toStrictEqual(['Loaded history']));
  });

  it('ignores stale prompt-history responses after the active conversation changes', async () => {
    const state = reactive<CodexConversationPaneState>({
      identity: { conversationKey: 'thread-old', messages: [] },
    });
    const pending: Array<{ key: string; resolve(prompts: readonly string[]): void }> = [];
    const readPromptHistory = vi.fn(() => new Promise<readonly string[]>((resolve) => {
      pending.push({ key: String(state.identity.conversationKey), resolve });
    }));
    const controller = createCodexConversationPaneController({ state, actions: { readPromptHistory } });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]!.key).toBe('thread-old');
    state.identity.conversationKey = 'thread-new';
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.key).toBe('thread-new');

    pending[1]!.resolve(['Current prompt']);
    await flushPromises();
    expect(composerProps(wrapper).promptHistory).toStrictEqual(['Current prompt']);

    pending[0]!.resolve(['Stale prompt']);
    await flushPromises();
    expect(composerProps(wrapper).promptHistory).toStrictEqual(['Current prompt']);
    expect(composerProps(wrapper).promptHistoryLoading).toBe(false);
  });

  it('reuses prompt-history results when returning to a previously loaded conversation', async () => {
    const state = reactive<CodexConversationPaneState>({
      identity: { conversationKey: 'thread-one', messages: [] },
    });
    const readPromptHistory = vi.fn(async () => [`History for ${state.identity.conversationKey}`]);
    const controller = createCodexConversationPaneController({ state, actions: { readPromptHistory } });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory)
      .toStrictEqual(['History for thread-one']));
    state.identity.conversationKey = 'thread-two';
    await vi.waitFor(() => expect(readPromptHistory).toHaveBeenCalledTimes(2));
    await flushPromises();
    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory)
      .toStrictEqual(['History for thread-two']));
    expect(readPromptHistory).toHaveBeenCalledTimes(2);

    state.identity.conversationKey = 'thread-one';
    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory)
      .toStrictEqual(['History for thread-one']));
    expect(readPromptHistory).toHaveBeenCalledTimes(2);
  });

  it('keeps a replacement history request authoritative while the stale same-key request settles', async () => {
    let resolveFirst!: (prompts: readonly string[]) => void;
    let resolveSecond!: (prompts: readonly string[]) => void;
    const first = vi.fn(() => new Promise<readonly string[]>((resolve) => {
      resolveFirst = resolve;
    }));
    const second = vi.fn(() => new Promise<readonly string[]>((resolve) => {
      resolveSecond = resolve;
    }));
    const actions = ref({ readPromptHistory: first });
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'same-thread', messages: [] } },
      actions,
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());

    actions.value = { readPromptHistory: second };
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    resolveFirst(['Stale prompt']);
    await flushPromises();

    expect(composerProps(wrapper).promptHistory).toStrictEqual([]);
    expect(composerProps(wrapper).promptHistoryLoading).toBe(true);

    resolveSecond(['Current prompt']);
    await flushPromises();
    expect(composerProps(wrapper).promptHistory).toStrictEqual(['Current prompt']);
    expect(composerProps(wrapper).promptHistoryLoading).toBe(false);
  });

  it('bounds loaded prompt history to the latest one hundred entries', async () => {
    const history = Array.from({ length: 103 }, (_, index) => `Prompt ${index}`);
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'bounded-history', messages: [] } },
      actions: { readPromptHistory: async () => history },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory).toHaveLength(100));
    expect(composerProps(wrapper).promptHistory).toStrictEqual(history.slice(3));
  });

  it('merges prompt history only when the entire visible prefix overlaps its suffix', async () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'partial-overlap',
          messages: [
            { id: 'visible-1', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Shared' }] },
            { id: 'visible-2', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Different' }] },
          ],
        },
      },
      actions: { readPromptHistory: async () => ['Older', 'Shared', 'Not the same'] },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory).toStrictEqual([
      'Older', 'Shared', 'Not the same', 'Shared', 'Different',
    ]));
  });

  it('matches every suffix position and bounds the combined history window', async () => {
    const older = Array.from({ length: 100 }, (_, index) => `Older ${index}`);
    older.splice(97, 3, 'Distinct', 'Shared', 'Ending');
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'suffix-overlap',
          messages: [
            { id: 'visible-1', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Shared' }] },
            { id: 'visible-2', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Ending' }] },
            { id: 'visible-3', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Newest' }] },
          ],
        },
      },
      actions: { readPromptHistory: async () => older },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await vi.waitFor(() => expect(composerProps(wrapper).promptHistory).toHaveLength(100));
    expect(composerProps(wrapper).promptHistory).toStrictEqual([
      ...older.slice(1),
      'Newest',
    ]);
  });

  it('keeps the lazy window bounded across progressive prepends from a host', async () => {
    const makeMessages = (start: number, count: number): SurfaceMessage[] => Array.from({ length: count }, (_, offset) => ({
      id: `surface-${start + offset}`,
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: `Message ${start + offset}` }],
    }));
    let currentMessages = makeMessages(95, 5);
    const transformMessage = vi.fn((message: SurfaceMessage | Message) => message);
    const wrapper = mount(CodexConversationPane, {
      props: { messages: currentMessages, transformMessage },
      attachTo: document.body,
    });
    const messageList = wrapper.findComponent(CodexMessageList);
    const scrollEl = messageList.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAllComponents(CodexMessage).length * 100,
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messageList.props('renderStrategy')).toBe('lazy');
    expect(messageList.props('initialMessageBatchSize')).toBe(50);
    expect(messageList.props('messageBatchSize')).toBe(25);
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(5);
    transformMessage.mockClear();

    const olderBatches = Array.from({ length: 3 }, (_, index) => makeMessages(75 - index * 20, 20));
    for (const olderBatch of olderBatches) {
      scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight - 100;
      await wrapper.get('.message-list').trigger('scroll');
      scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
      currentMessages = [...olderBatch, ...currentMessages];
      await wrapper.setProps({ messages: currentMessages });
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const visibleIds = new Set(currentMessages.slice(-50).map((message) => message.id));
      const transformedIds = transformMessage.mock.calls
        .map(([message]) => message.id)
        .filter((id): id is string => typeof id === 'string');
      expect(wrapper.findAllComponents(CodexMessage).length).toBeLessThanOrEqual(50);
      expect(transformedIds.every((id) => visibleIds.has(id))).toBe(true);
      transformMessage.mockClear();
      scrollEl.dispatchEvent(new Event('scroll'));
      await flushPromises();
    }

    expect(wrapper.findAllComponents(CodexMessage).length).toBe(50);
    wrapper.unmount();
  });

  it('forwards the opt-in lazy message window settings', () => {
    const transformMessage = vi.fn((message: SurfaceMessage | Message) => message);
    const wrapper = mount(CodexConversationPane, {
      props: {
        renderStrategy: 'eager',
        initialMessageBatchSize: 30,
        messageBatchSize: 12,
        messages,
        modelValue: '',
        transformMessage,
      },
    });

    const messageList = wrapper.findComponent(CodexMessageList);
    expect(messageList.props('renderStrategy')).toBe('eager');
    expect(messageList.props('initialMessageBatchSize')).toBe(30);
    expect(messageList.props('messageBatchSize')).toBe(12);
    expect(messageList.props('transformMessage')).toBe(transformMessage);
  });

  it('exposes an application-level composer focus action', async () => {
    const pane = ref<{ focusComposer(): void } | null>(null);
    const wrapper = mount({
      setup: () => () => h(CodexConversationPane as Component, {
        ref: pane,
        messages,
        modelValue: 'Profile this conversation',
      }),
    }, {
      attachTo: document.body,
    });

    expect(pane.value).not.toBeNull();
    pane.value?.focusComposer();
    await nextTick();

    expect(document.activeElement).toBe(composerEditor(wrapper).element);
    wrapper.unmount();
  });

  it('renders messages, empty state, and errors without owning an application header', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { error: 'Connection lost', messages, modelValue: '' },
    });
    expect(wrapper.find('header').exists()).toBe(false);
    expect(wrapper.text()).toContain('Ready to build');
    expect(wrapper.get('[role="alert"]').text()).toBe('Connection lost');

    await wrapper.setProps({ error: null, messages: [] });
    expect(wrapper.text()).toContain('Start a conversation with Codex');
  });

  it('renders catalog-backed app and skill mentions without pane-specific adapters', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          role: 'user',
          content: [
            'Use [@gmail](plugin://gmail@openai-curated-remote)',
            'and [$bank](/skills/update-bank-balance-sheet/SKILL.md)',
          ].join(' '),
        }],
        modelValue: '',
        plugins: [{
          id: 'gmail@openai-curated-remote',
          name: 'gmail',
          displayName: 'Gmail',
          iconUrl: 'https://files.openai.com/gmail.png',
          brandColor: '#EA4335',
          enabled: true,
        }],
        skills: [{
          name: 'update-bank-balance-sheet',
          displayName: 'Update Bank Balance Sheet',
          path: '/skills/update-bank-balance-sheet/SKILL.md',
          enabled: true,
        }],
      },
    });

    expect(wrapper.get('.chat-user-text__mention--plugin').text()).toBe('Gmail');
    expect(wrapper.get('.chat-user-text__mention--skill').text()).toBe('Update Bank Balance Sheet');
    expect(wrapper.text()).not.toContain('plugin://');
    expect(wrapper.text()).not.toContain('/skills/update-bank-balance-sheet');
  });

  it('quotes only the visible portion of ambient-enriched user messages', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          role: 'user',
          content: [
            '## My request for Codex:',
            'Find a rental car',
            '<in-app-browser-context source="ambient-ui-state">hidden browser state</in-app-browser-context>',
          ].join('\n'),
        }],
        modelValue: '',
      },
    });

    await wrapper.get('[aria-label="Quote"]').trigger('click');
    expect(composerEditor(wrapper).text()).toBe('Find a rental car');
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['Find a rental car']);
    expect(wrapper.emitted('quoteMessage')).toStrictEqual([[0]]);
  });

  it('ignores missing, assistant, and blank user messages when quoting', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [
          { id: 'assistant', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Assistant text' }] },
          { id: 'blank-user', role: 'user', content: '   ' },
        ],
        modelValue: 'Keep this draft',
      },
    });
    const list = wrapper.findComponent(CodexMessageList);

    list.vm.$emit('quote-message', 99);
    list.vm.$emit('quote-message', 0);
    list.vm.$emit('quote-message', 1);

    expect(composerValue(wrapper)).toBe('Keep this draft');
    expect(wrapper.emitted('quoteMessage')).toBeUndefined();
  });

  it('routes quoting exclusively through controller ownership while still updating the draft', async () => {
    const userMessage: SurfaceMessage = {
      id: 'controlled-user', role: 'user', status: 'complete',
      parts: [{ type: 'text', text: 'Quote through controller' }],
    };
    const quoteMessage = vi.fn();
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'controlled-quote', messages: [userMessage] } },
      actions: { quoteMessage },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    wrapper.findComponent(CodexMessageList).vm.$emit('quote-message', 0);
    await flushPromises();

    expect(composerValue(wrapper)).toBe('Quote through controller');
    expect(quoteMessage).toHaveBeenCalledWith(0);
    expect(wrapper.emitted('quoteMessage')).toBeUndefined();

    const noAction = mount(CodexConversationPane, {
      props: {
        controller: createCodexConversationPaneController({
          state: { identity: { conversationKey: 'controlled-quote-no-action', messages: [userMessage] } },
          actions: {},
        }),
      },
    });
    noAction.findComponent(CodexMessageList).vm.$emit('quote-message', 0);
    await nextTick();
    expect(composerValue(noAction)).toBe('Quote through controller');
    expect(noAction.emitted('quoteMessage')).toBeUndefined();
  });

  it('edits a legacy goal into the composer and emits its exact ownership event', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        goal: {
          threadId: 'goal-thread', objective: 'Ship the release', status: 'active', tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0,
        },
        messages,
        modelValue: '',
      },
    });

    await wrapper.get('[aria-label="Edit goal"]').trigger('click');

    expect(composerValue(wrapper)).toBe('/goal Ship the release');
    expect(wrapper.emitted('editGoal')).toStrictEqual([[]]);
  });

  it('routes goal editing exclusively through controller ownership', async () => {
    const goal = {
      threadId: 'controlled-goal', objective: 'Harden controller routing', status: 'active' as const,
      tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0,
    };
    const editGoal = vi.fn();
    const wrapper = mount(CodexConversationPane, {
      props: {
        controller: createCodexConversationPaneController({
          state: { identity: { conversationKey: 'goal-controller', messages }, thread: { goal } },
          actions: { editGoal },
        }),
      },
    });

    await wrapper.get('[aria-label="Edit goal"]').trigger('click');
    await flushPromises();

    expect(composerValue(wrapper)).toBe('/goal Harden controller routing');
    expect(editGoal).toHaveBeenCalledOnce();
    expect(wrapper.emitted('editGoal')).toBeUndefined();

    const noAction = mount(CodexConversationPane, {
      props: {
        controller: createCodexConversationPaneController({
          state: { identity: { conversationKey: 'goal-controller-no-action', messages }, thread: { goal } },
          actions: {},
        }),
      },
    });
    await noAction.get('[aria-label="Edit goal"]').trigger('click');
    expect(composerValue(noAction)).toBe('/goal Harden controller routing');
    expect(noAction.emitted('editGoal')).toBeUndefined();
  });

  it('does not edit an empty goal objective', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        goal: {
          threadId: 'blank-goal', objective: '   ', status: 'active', tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0,
        },
        messages,
        modelValue: 'Existing draft',
      },
    });

    await wrapper.get('[aria-label="Edit goal"]').trigger('click');

    expect(composerValue(wrapper)).toBe('Existing draft');
    expect(wrapper.emitted('editGoal')).toBeUndefined();
  });

  it('shows composer failures and exposes them to pane consumers', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
    });
    const composer = wrapper.findComponent({ name: 'CodexComposer' });

    composer.vm.$emit('error', 'Speech transcription failed.');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[role="alert"]').text()).toBe('Speech transcription failed.');
    expect(wrapper.emitted('error')).toStrictEqual([['Speech transcription failed.']]);

    composer.vm.$emit('error', null);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.emitted('error')).toStrictEqual([
      ['Speech transcription failed.'],
      [null],
    ]);
  });

  it('owns composer behavior through its public events', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { busy: false, messages, modelValue: '  Ship it  ' },
    });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toStrictEqual([['Ship it']]);
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['']);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);

    await wrapper.setProps({ busy: true, modelValue: '' });
    await wrapper.get('button[aria-label="Codex is working"]').trigger('click');
    expect(wrapper.emitted('interrupt')).toHaveLength(1);
  });

  it('continues a restored interrupted turn from an empty controlled composer', async () => {
    const continueInterruptedTurn = vi.fn(async () => undefined);
    const submit = vi.fn(async () => undefined);
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'thread-restored',
          busy: false,
          messages: [{
            id: 'assistant-interrupted',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-interrupted',
            parts: [{ type: 'text', text: 'Partial work', phase: 'commentary' }],
          }],
          turns: [{
            id: 'turn-interrupted', status: 'interrupted', error: null, willRetry: false,
            startedAt: null, completedAt: null, durationMs: null,
          }],
        },
      },
      actions: { continueInterruptedTurn, submit },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    const button = wrapper.get('button[aria-label="Continue"]');
    expect(button.attributes()).not.toHaveProperty('disabled');

    await button.trigger('click');

    expect(continueInterruptedTurn).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(0);
  });

  it('continues an interrupted turn through a directly bound surface', async () => {
    const surface = fakeSurfaceController();
    surface.state.activeConversationId = 'thread-restored';
    surface.state.activeTurnId = null;
    surface.state.turns = [{
      id: 'turn-interrupted', status: 'interrupted', error: null, willRetry: false,
      startedAt: null, completedAt: null, durationMs: null,
    }];
    const wrapper = mount(CodexConversationPane, { props: { surface } });
    await flushPromises();

    await wrapper.get('button[aria-label="Continue"]').trigger('click');

    expect(surface.continueInterruptedTurn).toHaveBeenCalledOnce();
    expect(surface.sendMessage).not.toHaveBeenCalled();
    expect(wrapper.emitted('continueInterruptedTurn')).toStrictEqual([[]]);
  });

  it('keeps a controlled initial submission visible while the provider conversation is created', async () => {
    const submit = vi.fn(async () => undefined);
    const state = reactive<CodexConversationPaneState>({
      identity: { conversationKey: 'agent-provisional', messages: [] },
    });
    const controller = createCodexConversationPaneController({ state, actions: { submit } });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await setComposerText(wrapper, 'Create the first turn');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.codex-conversation-pane__hero').exists()).toBe(false);
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);
    expect(wrapper.text()).toContain('Create the first turn');

    state.identity.busy = true;
    await nextTick();
    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(1);

    state.identity.conversationKey = 'thread-created';
    state.identity.messages = [];
    state.identity.busy = false;
    await nextTick();

    expect(wrapper.find('.codex-conversation-pane__hero').exists()).toBe(false);
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);
    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(1);

    state.identity.messages = [{
      id: 'authoritative-user',
      role: 'user',
      status: 'complete',
      turnId: 'turn-created',
      parts: [{ type: 'text', text: 'Create the first turn' }],
    }];
    state.identity.busy = true;
    await nextTick();

    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);
    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(1);
    expect(wrapper.text().match(/Create the first turn/g)).toHaveLength(1);
  });

  it('removes a controlled initial submission when the host rejects it', async () => {
    let rejectSubmit!: (error: Error) => void;
    const submit = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectSubmit = reject;
    }));
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'agent-provisional', messages: [] } },
      actions: { submit },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await setComposerText(wrapper, 'Reject this turn');
    await wrapper.get('form').trigger('submit');
    await nextTick();
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);
    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(1);

    rejectSubmit(new Error('Submission rejected'));
    await flushPromises();

    expect(wrapper.findAll('.chat-message--user')).toHaveLength(0);
    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(0);
    expect(wrapper.find('.codex-conversation-pane__hero').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toBe('Submission rejected');
  });

  it('clears an armed Escape interrupt when the composer requests interruption', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        busy: true,
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'interrupt-queue', text: 'Queued prompt' }],
      },
      attachTo: document.body,
    });
    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    const queueButton = wrapper.get<HTMLElement>('button[aria-label="Queue prompt"]');
    queueButton.element.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));
    await nextTick();
    expect(composerProps(wrapper).interruptArmed).toBe(true);

    (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).vm.$emit('interrupt');
    await nextTick();

    expect(composerProps(wrapper).interruptArmed).toBe(false);
    expect(wrapper.emitted('interrupt')).toStrictEqual([[]]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('suppresses legacy submission when a pane controller intentionally omits submit', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'controller-only', type: 'file', reference: 'attachment:controller-only',
      name: 'controller.md', mimeType: 'text/markdown', size: 1,
    };
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controller-no-submit', messages },
        composer: {
          attachments: [attachment],
          state: { text: 'Do not leak', selectionStart: 11, selectionEnd: 11 },
        },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.emitted('attachmentsChange')).toBeUndefined();
    expect(composerValue(wrapper)).toBe('');
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('routes older-history requests through legacy, controller, and surface ownership', async () => {
    const legacy = mount(CodexConversationPane, {
      props: { hasOlderHistory: true, messages, modelValue: '' },
    });
    legacy.findComponent(CodexMessageList).vm.$emit('load-older-messages');
    expect(legacy.emitted('loadOlderHistory')).toStrictEqual([[]]);

    const keyedLegacy = mount(CodexConversationPane, {
      props: { conversationKey: 'legacy-key-without-surface', hasOlderHistory: true, messages },
    });
    keyedLegacy.findComponent(CodexMessageList).vm.$emit('load-older-messages');
    await flushPromises();
    expect(keyedLegacy.emitted('loadOlderHistory')).toStrictEqual([[]]);
    expect(keyedLegacy.find('[role="alert"]').exists()).toBe(false);

    const loadOlderHistory = vi.fn();
    const controlled = mount(CodexConversationPane, {
      props: {
        controller: createCodexConversationPaneController({
          state: { identity: { conversationKey: 'controlled-history', messages } },
          actions: { loadOlderHistory },
        }),
      },
    });
    controlled.findComponent(CodexMessageList).vm.$emit('load-older-messages');
    await flushPromises();
    expect(loadOlderHistory).toHaveBeenCalledOnce();
    expect(controlled.emitted('loadOlderHistory')).toBeUndefined();

    const surface = fakeSurfaceController();
    surface.state.status = 'ready';
    surface.state.activeConversationId = 'surface-active';
    const bound = mount(CodexConversationPane, {
      props: { conversationKey: 42, messages, surface },
    });
    bound.findComponent(CodexMessageList).vm.$emit('load-older-messages');
    await flushPromises();
    expect(surface.loadOlderConversationHistory).toHaveBeenCalledWith('42');
    expect(bound.emitted('loadOlderHistory')).toBeUndefined();
  });

  it('keeps controller-owned older-history requests inside controller mode without an action', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        controller: createCodexConversationPaneController({
          state: { identity: { conversationKey: 'controller-no-history-action', messages } },
          actions: {},
        }),
      },
    });

    wrapper.findComponent(CodexMessageList).vm.$emit('load-older-messages');

    expect(wrapper.emitted('loadOlderHistory')).toBeUndefined();
  });

  it('owns native attachment picking, previews, removal, and typed submit options', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'attachment-1',
      type: 'image',
      reference: 'attachment:diagram',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 3,
      previewUrl: 'data:image/png;base64,cG5n',
    };
    const pickAttachments = vi.fn(async () => [attachment]);
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '', pickAttachments },
    });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(true));
    expect(wrapper.emitted('attach')).toStrictEqual([[]]);
    expect(wrapper.get('.codex-conversation-pane__attachment-preview').attributes('src')).toBe(
      attachment.previewUrl,
    );

    await setComposerText(wrapper, 'review this image');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toStrictEqual([[
      'review this image',
      {
        attachments: [{
          type: 'image',
          reference: 'attachment:diagram',
        }],
      },
    ]]);
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('routes attachment selection exclusively through a controller action', async () => {
    const attach = vi.fn();
    const pickAttachments = vi.fn(async () => []);
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controller-attach', messages },
        policy: { attachEnabled: true },
      },
      actions: { attach },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller, pickAttachments } });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await flushPromises();

    expect(attach).toHaveBeenCalledOnce();
    expect(pickAttachments).not.toHaveBeenCalled();
    expect(wrapper.emitted('attach')).toBeUndefined();
  });

  it('uses a configured picker in controller mode without leaking a legacy attach event', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'controller-picker', type: 'file', reference: 'attachment:controller-picker',
      name: 'controller-picker.md', mimeType: 'text/markdown', size: 1,
    };
    const pickAttachments = vi.fn(async () => [attachment]);
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controller-picker', messages },
        policy: { attachEnabled: true },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller, pickAttachments } });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('controller-picker.md'));

    expect(pickAttachments).toHaveBeenCalledOnce();
    expect(wrapper.emitted('attach')).toBeUndefined();
    expect(wrapper.emitted('attachmentsChange')).toBeUndefined();
  });

  it('surfaces attachment picker failures without adding a partial selection', async () => {
    const pickAttachments = vi.fn(async () => {
      throw new Error('Attachment picker failed');
    });
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '', pickAttachments },
    });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('attach')).toStrictEqual([[]]);
    expect(wrapper.get('[role="alert"]').text()).toBe('Attachment picker failed');
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('rejects stale composer attachment requests after attachment support is disabled', async () => {
    const pickAttachments = vi.fn(async () => [{
      id: 'must-not-appear', type: 'file' as const, reference: 'attachment:disabled-request',
      name: 'disabled.md', mimeType: 'text/markdown', size: 1,
    }]);
    const wrapper = mount(CodexConversationPane, {
      props: { attachEnabled: false, messages, modelValue: '', pickAttachments },
    });

    (wrapper.findComponent({ name: 'CodexComposer' }) as unknown as VueWrapper).vm.$emit('attach');
    await flushPromises();

    expect(wrapper.emitted('attach')).toStrictEqual([[]]);
    expect(pickAttachments).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('ingests a pasted image once while inserting only its accompanying plain text', async () => {
    const file = new File(['png'], 'clipboard.png', { type: 'image/png' });
    const ingestAttachments = vi.fn(async () => [{
      id: 'clipboard-image',
      type: 'image' as const,
      reference: 'attachment:clipboard',
      name: 'clipboard.png',
      mimeType: 'image/png',
      size: 3,
    }]);
    const wrapper = mount(CodexConversationPane, {
      props: { ingestAttachments, messages, modelValue: '' },
    });
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [file], getData: () => 'pasted text' },
    });
    composerEditor(wrapper).element.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(composerEditor(wrapper).text()).toBe('pasted text');
    await vi.waitFor(() => expect(ingestAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'clipboard.png', mimeType: 'image/png' }),
    ]));
    expect(wrapper.text()).toContain('clipboard.png');
  });

  it('uses clipboard items when the clipboard file list is empty and ingests only images', async () => {
    const image = new File(['png'], 'item-image.png', { type: 'image/png' });
    const documentFile = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const ignoredStringItem = { kind: 'string', getAsFile: vi.fn(() => image) };
    const emptyFileItem = { kind: 'file', getAsFile: vi.fn(() => null) };
    const imageItem = { kind: 'file', getAsFile: vi.fn(() => image) };
    const documentItem = { kind: 'file', getAsFile: vi.fn(() => documentFile) };
    const ingestAttachments = vi.fn(async () => [{
      id: 'clipboard-item-image', type: 'image' as const, reference: 'attachment:item-image',
      name: 'item-image.png', mimeType: 'image/png', size: 3,
    }]);
    const wrapper = mount(CodexConversationPane, {
      props: { ingestAttachments, messages, modelValue: '' },
    });
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        items: [ignoredStringItem, emptyFileItem, imageItem, documentItem],
      },
    });

    wrapper.get('.codex-conversation-pane').element.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(ingestAttachments).toHaveBeenCalledOnce());
    expect(ingestAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'item-image.png', mimeType: 'image/png' }),
    ]);
    expect(ignoredStringItem.getAsFile).not.toHaveBeenCalled();
    expect(emptyFileItem.getAsFile).toHaveBeenCalledOnce();
    expect(imageItem.getAsFile).toHaveBeenCalledOnce();
    expect(documentItem.getAsFile).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('item-image.png');
    expect(wrapper.text()).not.toContain('notes.txt');
  });

  it('leaves image-free and unavailable clipboards to normal paste handling', async () => {
    const ingestAttachments = vi.fn(async () => []);
    const wrapper = mount(CodexConversationPane, {
      props: { ingestAttachments, messages, modelValue: '' },
    });
    const unavailable = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    const empty = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(empty, 'clipboardData', { value: { files: [] } });
    const documentOnly = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(documentOnly, 'clipboardData', {
      value: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] },
    });

    wrapper.get('.codex-conversation-pane').element.dispatchEvent(unavailable);
    wrapper.get('.codex-conversation-pane').element.dispatchEvent(empty);
    wrapper.get('.codex-conversation-pane').element.dispatchEvent(documentOnly);
    await flushPromises();

    expect(unavailable.defaultPrevented).toBe(false);
    expect(empty.defaultPrevented).toBe(false);
    expect(documentOnly.defaultPrevented).toBe(false);
    expect(ingestAttachments).not.toHaveBeenCalled();
  });

  it('owns file drag-over and drop handling only when files can be ingested', async () => {
    const file = new File(['drop'], 'dropped.txt', { type: 'text/plain' });
    const attachment: CodexNativeAttachment = {
      id: 'dropped-file', type: 'file', reference: 'attachment:dropped',
      name: 'dropped.txt', mimeType: 'text/plain', size: 4,
    };
    const ingestAttachments = vi.fn(async () => [attachment]);
    const wrapper = mount(CodexConversationPane, {
      props: { ingestAttachments, messages, modelValue: '' },
    });
    const pane = wrapper.get('.codex-conversation-pane');
    const fileDrag = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(fileDrag, 'dataTransfer', { value: { types: ['Files'] } });
    const textDrag = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(textDrag, 'dataTransfer', { value: { types: ['text/plain'] } });
    const unavailableDrag = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    const emptyDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(emptyDrop, 'dataTransfer', { value: { files: [], types: ['Files'] } });
    const unavailableDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    const fileDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(fileDrop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });

    pane.element.dispatchEvent(fileDrag);
    pane.element.dispatchEvent(textDrag);
    pane.element.dispatchEvent(unavailableDrag);
    pane.element.dispatchEvent(emptyDrop);
    pane.element.dispatchEvent(unavailableDrop);
    pane.element.dispatchEvent(fileDrop);

    expect(fileDrag.defaultPrevented).toBe(true);
    expect(textDrag.defaultPrevented).toBe(false);
    expect(unavailableDrag.defaultPrevented).toBe(false);
    expect(emptyDrop.defaultPrevented).toBe(false);
    expect(unavailableDrop.defaultPrevented).toBe(false);
    expect(fileDrop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(ingestAttachments).toHaveBeenCalledOnce());
    expect(ingestAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'dropped.txt', mimeType: 'text/plain' }),
    ]);
    expect(wrapper.text()).toContain('dropped.txt');
  });

  it('surfaces dropped-file ingestion failures without retaining an attachment', async () => {
    const file = new File(['drop'], 'broken.txt', { type: 'text/plain' });
    const ingestAttachments = vi.fn(async () => {
      throw new Error('Dropped file could not be ingested');
    });
    const wrapper = mount(CodexConversationPane, {
      props: { ingestAttachments, messages, modelValue: '' },
    });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });

    wrapper.get('.codex-conversation-pane').element.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text())
      .toBe('Dropped file could not be ingested'));
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('replaces duplicate attachment references and retains only the first twenty references', async () => {
    const initial = Array.from({ length: 19 }, (_, index): CodexNativeAttachment => ({
      id: `initial-${index}`,
      type: 'file',
      reference: `attachment:${index}`,
      name: `initial-${index}.txt`,
      mimeType: 'text/plain',
      size: index,
    }));
    const replacement: CodexNativeAttachment = {
      id: 'replacement-5', type: 'file', reference: 'attachment:5',
      name: 'replacement-5.txt', mimeType: 'text/plain', size: 50,
    };
    const additions = Array.from({ length: 3 }, (_, offset): CodexNativeAttachment => ({
      id: `added-${19 + offset}`,
      type: 'file',
      reference: `attachment:${19 + offset}`,
      name: `added-${19 + offset}.txt`,
      mimeType: 'text/plain',
      size: 19 + offset,
    }));
    const pickAttachments = vi.fn(async () => [replacement, ...additions]);
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: initial, messages, modelValue: '', pickAttachments },
    });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.codex-conversation-pane__attachment')).toHaveLength(20));

    const names = wrapper.findAll('.codex-conversation-pane__attachment-name').map((node) => node.text());
    expect(names).toStrictEqual(initial.map((attachment, index) => (
      index === 5 ? replacement.name : attachment.name
    )).concat(additions[0]!.name));
    expect(names).not.toContain(additions[1]!.name);
    expect(names).not.toContain(additions[2]!.name);

    await wrapper.get('button[aria-label="Remove replacement-5.txt"]').trigger('click');

    expect(wrapper.findAll('.codex-conversation-pane__attachment')).toHaveLength(19);
    const finalAttachments = wrapper.emitted('attachmentsChange')!.at(-1)![0] as CodexNativeAttachment[];
    expect(finalAttachments.map((attachment) => attachment.reference)).toStrictEqual([
      ...initial.filter((attachment) => attachment.reference !== replacement.reference)
        .map((attachment) => attachment.reference),
      additions[0]!.reference,
    ]);
  });

  it('routes attachment removal through controller ownership', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'controlled-removal', type: 'file', reference: 'attachment:controlled-removal',
      name: 'controlled-removal.txt', mimeType: 'text/plain', size: 1,
    };
    const updateAttachments = vi.fn();
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-removal', messages },
        composer: { attachments: [attachment] },
      },
      actions: { updateAttachments },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('button[aria-label="Remove controlled-removal.txt"]').trigger('click');

    expect(updateAttachments).toHaveBeenCalledOnce();
    expect(updateAttachments).toHaveBeenCalledWith([]);
    expect(wrapper.emitted('attachmentsChange')).toBeUndefined();
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('exposes attachment rendering as a pane-level customization slot', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          id: 'user-file',
          role: 'user',
          status: 'complete',
          parts: [{
            type: 'attachment',
            attachment: { kind: 'file', name: 'report.pdf', path: '/tmp/report.pdf' },
          }],
        }],
        modelValue: '',
      },
      slots: {
        'message-attachment': ({ attachment }: { attachment: { name: string } }) => (
          h('strong', { class: 'custom-attachment' }, attachment.name)
        ),
      },
    });

    expect(wrapper.get('.custom-attachment').text()).toBe('report.pdf');
    expect(wrapper.find('.chat-attachment-block').exists()).toBe(false);
  });

  it('blocks pasted and dropped files when attachments are disabled', async () => {
    const file = new File(['png'], 'blocked.png', { type: 'image/png' });
    const ingestAttachments = vi.fn(async () => []);
    const wrapper = mount(CodexConversationPane, {
      props: { attachEnabled: false, ingestAttachments, messages, modelValue: '' },
    });
    const pane = wrapper.get('.codex-conversation-pane');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file] } });
    const drag = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drag, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });

    pane.element.dispatchEvent(paste);
    pane.element.dispatchEvent(drag);
    pane.element.dispatchEvent(drop);
    await flushPromises();

    expect(paste.defaultPrevented).toBe(true);
    expect(drag.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(ingestAttachments).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('clears an existing attachment queue when attachments become disabled', async () => {
    const pickAttachments = vi.fn(async () => [{
      id: 'queued-image',
      type: 'image' as const,
      reference: 'attachment:queued',
      name: 'queued.png',
      mimeType: 'image/png',
      size: 3,
    }]);
    const wrapper = mount(CodexConversationPane, {
      props: { attachEnabled: true, messages, modelValue: '', pickAttachments },
    });
    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(true));

    await wrapper.setProps({ attachEnabled: false });

    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
    expect(wrapper.emitted('attachmentsChange')).toContainEqual([[]]);
  });

  it('restores controlled composer text and selection without emitting an empty intermediate state', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        composerState: { text: 'thread one draft', selectionStart: 7, selectionEnd: 10 },
        conversationKey: 'thread-1',
        messages,
        modelValue: 'ignored text-only draft',
      },
    });
    await nextTick();
    expect(composerEditor(wrapper).text()).toBe('thread one draft');

    await wrapper.setProps({
      composerState: { text: 'thread two draft', selectionStart: 3, selectionEnd: 3 },
      conversationKey: 'thread-2',
    });
    await nextTick();

    expect(composerEditor(wrapper).text()).toBe('thread two draft');
    expect((wrapper.getComponent(CodexRichTextEditor).vm as unknown as CodexRichTextEditorExpose)
      .getSelectionRange()).toMatchObject({ start: 3, end: 3 });
    expect(wrapper.emitted('update:modelValue') ?? []).not.toContainEqual(['']);
    expect(wrapper.emitted('update:composerState') ?? []).not.toContainEqual([{
      text: '', selectionStart: 0, selectionEnd: 0,
    }]);
  });

  it('synchronizes legacy model updates but does not override either controlled composer source', async () => {
    const legacy = mount(CodexConversationPane, {
      props: { messages, modelValue: 'First legacy draft' },
    });
    await legacy.setProps({ modelValue: 'Updated legacy draft' });
    await nextTick();
    expect(composerEditor(legacy).text()).toBe('Updated legacy draft');
    expect((legacy.getComponent(CodexRichTextEditor).vm as unknown as CodexRichTextEditorExpose)
      .getSelectionRange()).toMatchObject({ start: 20, end: 20 });

    const composerState = mount(CodexConversationPane, {
      props: {
        composerState: { text: 'Controlled prop draft', selectionStart: 4, selectionEnd: 4 },
        messages,
        modelValue: 'Ignored legacy value',
      },
    });
    await composerState.setProps({ modelValue: 'Still ignored' });
    expect(composerEditor(composerState).text()).toBe('Controlled prop draft');

    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-draft', messages },
        composer: { state: { text: 'Controller draft', selectionStart: 3, selectionEnd: 3 } },
      },
      actions: {},
    });
    const controlled = mount(CodexConversationPane, {
      props: { controller, modelValue: 'Ignored legacy value' },
    });
    await controlled.setProps({ modelValue: 'Still ignored' });
    expect(composerEditor(controlled).text()).toBe('Controller draft');
  });

  it('reacts to in-place controlled composer changes and preserves the last draft when state is absent', async () => {
    const state = reactive<CodexConversationPaneState>({
      identity: { conversationKey: 'deep-controlled-draft', messages },
      composer: { state: { text: 'Initial draft', selectionStart: 2, selectionEnd: 2 } },
    });
    const controller = createCodexConversationPaneController({ state, actions: {} });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    state.composer!.state!.text = 'Nested replacement';
    state.composer!.state!.selectionStart = 6;
    state.composer!.state!.selectionEnd = 11;
    await flushPromises();

    expect(composerEditor(wrapper).text()).toBe('Nested replacement');
    expect(composerProps(wrapper).composerState).toStrictEqual({
      text: 'Nested replacement', selectionStart: 6, selectionEnd: 11,
    });

    state.composer!.state = undefined;
    await nextTick();
    expect(composerEditor(wrapper).text()).toBe('Nested replacement');
    expect(composerProps(wrapper).composerState).toStrictEqual({
      text: 'Nested replacement', selectionStart: 6, selectionEnd: 11,
    });
  });

  it('resets a controller-owned draft when the conversation changes without replacement state', async () => {
    const state = reactive<CodexConversationPaneState>({
      identity: { conversationKey: 'controller-draft-one', messages },
    });
    const controller = createCodexConversationPaneController({ state, actions: {} });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    await setComposerText(wrapper, 'Ephemeral controller draft');
    expect(composerEditor(wrapper).text()).toBe('Ephemeral controller draft');

    state.identity.conversationKey = 'controller-draft-two';
    await flushPromises();

    expect(composerEditor(wrapper).text()).toBe('');
    expect(composerProps(wrapper).composerState).toStrictEqual({
      text: '', selectionStart: 0, selectionEnd: 0,
    });
  });

  it('restores controlled attachments on conversation changes without emitting an empty state', async () => {
    const first: CodexNativeAttachment = {
      id: 'first', type: 'file', reference: 'attachment:first', name: 'first.md', mimeType: 'text/markdown', size: 1,
    };
    const second: CodexNativeAttachment = {
      id: 'second', type: 'file', reference: 'attachment:second', name: 'second.md', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: [first], conversationKey: 'thread-1', messages, modelValue: '' },
    });
    expect(wrapper.text()).toContain('first.md');

    await wrapper.setProps({ attachments: [second], conversationKey: 'thread-2' });

    expect(wrapper.text()).toContain('second.md');
    expect(wrapper.text()).not.toContain('first.md');
    expect(wrapper.emitted('attachmentsChange') ?? []).not.toContainEqual([[]]);
  });

  it('synchronizes controlled attachments without requiring a conversation change', async () => {
    const first: CodexNativeAttachment = {
      id: 'same-thread-first', type: 'file', reference: 'attachment:first', name: 'first.md', mimeType: 'text/markdown', size: 1,
    };
    const second: CodexNativeAttachment = {
      id: 'same-thread-second', type: 'file', reference: 'attachment:second', name: 'second.md', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: [first], conversationKey: 'same-thread', messages, modelValue: '' },
    });

    await wrapper.setProps({ attachments: [second] });

    expect(wrapper.text()).toContain('second.md');
    expect(wrapper.text()).not.toContain('first.md');
    expect(composerProps(wrapper).hasAttachments).toBe(true);
  });

  it('preserves attachments when enabling them and avoids redundant empty clears', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'disabled-attachment', type: 'file', reference: 'attachment:disabled', name: 'disabled.md', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: { attachEnabled: false, attachments: [attachment], messages, modelValue: '' },
    });
    expect(wrapper.text()).toContain('disabled.md');

    await wrapper.setProps({ attachEnabled: true });
    expect(wrapper.text()).toContain('disabled.md');
    expect(wrapper.emitted('attachmentsChange')).toBeUndefined();

    const empty = mount(CodexConversationPane, {
      props: { attachEnabled: true, attachments: [], messages, modelValue: '' },
    });
    await empty.setProps({ attachEnabled: false });
    expect(empty.emitted('attachmentsChange')).toBeUndefined();
  });

  it('emits attachment options when steering and clears the selected attachments', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'notes', type: 'file', reference: 'attachment:notes', name: 'Notes', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: [attachment], busy: true, messages, modelValue: '' },
    });
    await setComposerText(wrapper, 'Use these notes');
    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steer')).toStrictEqual([[
      'Use these notes',
      { attachments: [{ type: 'file', reference: 'attachment:notes' }] },
    ]]);
    expect(wrapper.emitted('attachmentsChange')).toContainEqual([[]]);
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('routes attachment steering exclusively through a controller action', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'controlled-steer', type: 'file', reference: 'attachment:controlled-steer',
      name: 'controlled-steer.md', mimeType: 'text/markdown', size: 1,
    };
    const steer = vi.fn();
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-steer', messages, busy: true },
        composer: { attachments: [attachment] },
      },
      actions: { steer },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).vm.$emit('steer', 'Controlled steer');
    await flushPromises();

    expect(steer).toHaveBeenCalledWith('Controlled steer', {
      attachments: [{ type: 'file', reference: 'attachment:controlled-steer' }],
    });
    expect(wrapper.emitted('steer')).toBeUndefined();
    expect(wrapper.emitted('attachmentsChange')).toBeUndefined();
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('keeps attachment steering controller-owned when the action is absent', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'controlled-steer-absent', type: 'file', reference: 'attachment:controlled-steer-absent',
      name: 'controlled-steer-absent.md', mimeType: 'text/markdown', size: 1,
    };
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-steer-absent', messages, busy: true },
        composer: { attachments: [attachment] },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).vm
      .$emit('steer', 'Suppressed steer');
    await flushPromises();

    expect(wrapper.emitted('steer')).toBeUndefined();
    expect(wrapper.emitted('attachmentsChange')).toBeUndefined();
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('forwards attachment steering to a compatibility event and attached surface', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'surface-steer', type: 'image', reference: 'attachment:surface-steer',
      name: 'surface-steer.png', mimeType: 'image/png', size: 1,
    };
    const surface = fakeSurfaceController();
    surface.state.busy = true;
    const steerMessage = vi.fn(async () => surface.state);
    Object.assign(surface, { steerMessage });
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: [attachment], surface },
    });
    await vi.waitFor(() => expect(surface.connect).toHaveBeenCalledOnce());

    (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).vm.$emit('steer', 'Surface steer');
    await flushPromises();

    const options = { attachments: [{ type: 'image', reference: 'attachment:surface-steer' }] };
    expect(wrapper.emitted('steer')).toStrictEqual([['Surface steer', options]]);
    expect(steerMessage).toHaveBeenCalledWith('Surface steer', options);
    expect(wrapper.emitted('attachmentsChange')).toContainEqual([[]]);
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
  });

  it('forwards dictated input provenance with attachment options', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'notes', type: 'file', reference: 'attachment:notes', name: 'Notes', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: [attachment], messages, modelValue: '' },
    });

    wrapper.getComponent({ name: 'CodexComposer' }).vm.$emit(
      'send',
      'Dictated task',
      { inputMethod: 'dictated' },
    );

    expect(wrapper.emitted('submit')).toStrictEqual([[
      'Dictated task',
      {
        inputMethod: 'dictated',
        attachments: [{ type: 'file', reference: 'attachment:notes' }],
      },
    ]]);
  });

  it('submits attachment-only prompts with the no-instructions sentinel', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'image', type: 'image', reference: 'attachment:image', name: 'image.png', mimeType: 'image/png', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: { attachments: [attachment], messages, modelValue: '' },
    });

    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toStrictEqual([[
      '(no user instructions)',
      { attachments: [{ type: 'image', reference: 'attachment:image' }] },
    ]]);
  });

  it('steers the first queued prompt from an empty Cmd Enter composer', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        busy: true,
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'queued-1', text: 'Run the tests' }],
      },
    });

    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-1']]);
    expect(wrapper.emitted('steer')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('edits a queued prompt in place through a normal composer submit', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'queued-attachment', type: 'file', reference: 'attachment:queued-edit',
      name: 'queued-edit.md', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: {
        attachments: [attachment],
        messages,
        modelValue: '',
        queuedPrompts: [
          { id: 'queued-1', text: 'Keep first' },
          { id: 'queued-2', text: 'Original text' },
        ],
      },
      attachTo: document.body,
    });

    await wrapper.findAll('[aria-label="Edit queued prompt"]')[1]!.trigger('click');
    expect(document.activeElement).toBe(composerEditor(wrapper).element);
    await setComposerText(wrapper, 'Replacement text');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('updateQueuedPrompt')).toStrictEqual([['queued-2', 'Replacement text']]);
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.emitted('attachmentsChange')).toContainEqual([[]]);
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('ignores queued-prompt edit requests while drafting or for an unknown prompt', async () => {
    const drafting = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: 'Existing draft',
        queuedPrompts: [{ id: 'queued-known', text: 'Known prompt' }],
      },
    });
    drafting.findComponent(ChatComposerShelf).vm.$emit('editQueuedPrompt', 'queued-known');
    await nextTick();
    expect(composerValue(drafting)).toBe('Existing draft');

    const missing = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'queued-known', text: 'Known prompt' }],
      },
    });
    missing.findComponent(ChatComposerShelf).vm.$emit('editQueuedPrompt', 'queued-missing');
    await nextTick();
    expect(composerValue(missing)).toBe('');
  });

  it('deleting the prompt being edited returns the composer to normal submission', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [
          { id: 'queued-first', text: 'First prompt' },
          { id: 'queued-editing', text: 'Prompt being edited' },
        ],
      },
    });
    await wrapper.findAll('[aria-label="Edit queued prompt"]')[1]!.trigger('click');
    await wrapper.findAll('[aria-label="Delete queued prompt"]')[1]!.trigger('click');
    await setComposerText(wrapper, 'Normal submission after deletion');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('deleteQueuedPrompt')).toStrictEqual([['queued-editing']]);
    expect(wrapper.emitted('submit')).toStrictEqual([['Normal submission after deletion']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('keeps editing when a different queued prompt is deleted', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [
          { id: 'queued-other', text: 'Other queued prompt' },
          { id: 'queued-editing', text: 'Prompt being edited' },
        ],
      },
    });
    await wrapper.findAll('[aria-label="Edit queued prompt"]')[1]!.trigger('click');
    await wrapper.findAll('[aria-label="Delete queued prompt"]')[0]!.trigger('click');
    await setComposerText(wrapper, 'Updated after deleting another prompt');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('deleteQueuedPrompt')).toStrictEqual([['queued-other']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toStrictEqual([
      ['queued-editing', 'Updated after deleting another prompt'],
    ]);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('leaves queue-edit mode when the edited prompt is steered from the shelf', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'queued-editing', text: 'Prompt being edited' }],
      },
    });
    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    await wrapper.get('[aria-label="Steer queued prompt now"]').trigger('click');
    await setComposerText(wrapper, 'Normal submission after steering');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-editing']]);
    expect(wrapper.emitted('submit')).toStrictEqual([['Normal submission after steering']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toBeUndefined();
  });

  it('keeps editing when a different queued prompt is steered from the shelf', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [
          { id: 'queued-other', text: 'Other queued prompt' },
          { id: 'queued-editing', text: 'Prompt being edited' },
        ],
      },
    });
    await wrapper.findAll('[aria-label="Edit queued prompt"]')[1]!.trigger('click');
    await wrapper.findAll('[aria-label="Steer queued prompt now"]')[0]!.trigger('click');
    await setComposerText(wrapper, 'Updated edited prompt');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-other']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toStrictEqual([
      ['queued-editing', 'Updated edited prompt'],
    ]);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('routes every queued-prompt operation exclusively through controller actions', async () => {
    const actions = {
      deleteQueuedPrompt: vi.fn(),
      steerQueuedPrompt: vi.fn(),
      updateQueuedPrompt: vi.fn(),
    };
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-queue', messages },
        thread: { queuedPrompts: [{ id: 'controlled-queued', text: 'Controlled queue' }] },
      },
      actions,
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    const shelf = wrapper.findComponent(ChatComposerShelf);

    shelf.vm.$emit('deleteQueuedPrompt', 'controlled-queued');
    shelf.vm.$emit('steerQueuedPrompt', 'controlled-queued');
    shelf.vm.$emit('editQueuedPrompt', 'controlled-queued');
    await nextTick();
    await setComposerText(wrapper, 'Controlled replacement');
    await wrapper.get('form').trigger('submit');
    shelf.vm.$emit('editQueuedPrompt', 'controlled-queued');
    await nextTick();
    await setComposerText(wrapper, 'Controlled immediate steer');
    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });
    await flushPromises();

    expect(actions.deleteQueuedPrompt).toHaveBeenCalledWith('controlled-queued');
    expect(actions.updateQueuedPrompt).toHaveBeenCalledWith(
      'controlled-queued',
      'Controlled replacement',
    );
    expect(actions.steerQueuedPrompt.mock.calls).toStrictEqual([
      ['controlled-queued'],
      ['controlled-queued', 'Controlled immediate steer'],
    ]);
    expect(wrapper.emitted('deleteQueuedPrompt')).toBeUndefined();
    expect(wrapper.emitted('updateQueuedPrompt')).toBeUndefined();
    expect(wrapper.emitted('steerQueuedPrompt')).toBeUndefined();
  });

  it('keeps every queued-prompt operation controller-owned when actions are absent', async () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-queue-absent', messages },
        thread: { queuedPrompts: [{ id: 'controlled-queued', text: 'Controlled queue' }] },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    const shelf = wrapper.findComponent(ChatComposerShelf);

    shelf.vm.$emit('deleteQueuedPrompt', 'controlled-queued');
    shelf.vm.$emit('steerQueuedPrompt', 'controlled-queued');
    shelf.vm.$emit('editQueuedPrompt', 'controlled-queued');
    await nextTick();
    await setComposerText(wrapper, 'Suppressed replacement');
    await wrapper.get('form').trigger('submit');
    shelf.vm.$emit('editQueuedPrompt', 'controlled-queued');
    await nextTick();
    await setComposerText(wrapper, 'Suppressed immediate steer');
    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });
    await flushPromises();

    expect(wrapper.emitted('deleteQueuedPrompt')).toBeUndefined();
    expect(wrapper.emitted('updateQueuedPrompt')).toBeUndefined();
    expect(wrapper.emitted('steerQueuedPrompt')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('forwards every queued-prompt operation to legacy events and an attached surface', async () => {
    const surface = fakeSurfaceController();
    surface.state.queuedPrompts = [{ id: 'surface-queued', text: 'Surface queue' }];
    const surfaceActions = {
      deleteQueuedPrompt: vi.fn(async () => surface.state),
      steerQueuedPrompt: vi.fn(async () => surface.state),
      updateQueuedPrompt: vi.fn(async () => surface.state),
    };
    Object.assign(surface, surfaceActions);
    const wrapper = mount(CodexConversationPane, { props: { surface } });
    await vi.waitFor(() => expect(surface.connect).toHaveBeenCalledOnce());
    const shelf = wrapper.findComponent(ChatComposerShelf);

    shelf.vm.$emit('deleteQueuedPrompt', 'surface-queued');
    shelf.vm.$emit('steerQueuedPrompt', 'surface-queued');
    shelf.vm.$emit('editQueuedPrompt', 'surface-queued');
    await nextTick();
    await setComposerText(wrapper, 'Surface replacement');
    await wrapper.get('form').trigger('submit');
    shelf.vm.$emit('editQueuedPrompt', 'surface-queued');
    await nextTick();
    await setComposerText(wrapper, 'Surface immediate steer');
    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });
    await flushPromises();

    expect(surfaceActions.deleteQueuedPrompt).toHaveBeenCalledWith('surface-queued');
    expect(surfaceActions.updateQueuedPrompt).toHaveBeenCalledWith(
      'surface-queued',
      'Surface replacement',
    );
    expect(surfaceActions.steerQueuedPrompt.mock.calls).toStrictEqual([
      ['surface-queued'],
      ['surface-queued', 'Surface immediate steer'],
    ]);
    expect(wrapper.emitted('deleteQueuedPrompt')).toStrictEqual([['surface-queued']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toStrictEqual([
      ['surface-queued', 'Surface replacement'],
    ]);
    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([
      ['surface-queued'],
      ['surface-queued', 'Surface immediate steer'],
    ]);
  });

  it('stops editing a queued prompt when the host removes it', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'queued-removed', text: 'Original text' }],
      },
    });

    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    await wrapper.setProps({ queuedPrompts: [{ id: 'queued-other', text: 'Other prompt' }] });
    await setComposerText(wrapper, 'Submit normally');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toStrictEqual([['Submit normally']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toBeUndefined();
  });

  it('continues editing when the queued prompt remains after a host refresh', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: '',
        queuedPrompts: [
          { id: 'queued-other', text: 'Other prompt' },
          { id: 'queued-retained', text: 'Original text' },
        ],
      },
    });

    await wrapper.findAll('[aria-label="Edit queued prompt"]')[1]!.trigger('click');
    await wrapper.setProps({
      queuedPrompts: [
        { id: 'queued-before', text: 'Inserted before' },
        { id: 'queued-retained', text: 'Host refreshed text' },
        { id: 'queued-after', text: 'Inserted after' },
      ],
    });
    await wrapper.setProps({
      queuedPrompts: [{ id: 'queued-retained', text: 'Host refreshed text' }],
    });
    await setComposerText(wrapper, 'Retained replacement');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('updateQueuedPrompt')).toStrictEqual([
      ['queued-retained', 'Retained replacement'],
    ]);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('clears queued editing and an armed Escape interrupt when the conversation changes', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        busy: true,
        conversationKey: 'thread-before-reset',
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'queued-reset', text: 'Queued text' }],
      },
      attachTo: document.body,
    });
    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    const queueButton = wrapper.get<HTMLElement>('button[aria-label="Queue prompt"]');
    queueButton.element.focus();
    expect(document.activeElement).toBe(queueButton.element);
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
    await nextTick();
    expect(composerProps(wrapper).interruptArmed).toBe(true);

    await wrapper.setProps({ conversationKey: 'thread-after-reset' });
    expect(composerProps(wrapper).interruptArmed).toBe(false);
    await setComposerText(wrapper, 'Fresh conversation prompt');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toStrictEqual([['Fresh conversation prompt']]);
    expect(wrapper.emitted('updateQueuedPrompt')).toBeUndefined();
    wrapper.unmount();
  });

  it('steers and removes the edited queue item with Cmd Enter', async () => {
    const attachment: CodexNativeAttachment = {
      id: 'queued-steer-attachment', type: 'file', reference: 'attachment:queued-steer',
      name: 'queued-steer.md', mimeType: 'text/markdown', size: 1,
    };
    const wrapper = mount(CodexConversationPane, {
      props: {
        attachments: [attachment],
        busy: true,
        messages,
        modelValue: '',
        queuedPrompts: [{ id: 'queued-1', text: 'Original text' }],
      },
    });

    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    await setComposerText(wrapper, 'Edited steer');
    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-1', 'Edited steer']]);
    expect(wrapper.emitted('steer')).toBeUndefined();
    expect(wrapper.emitted('attachmentsChange')).toContainEqual([[]]);
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
    expect(composerValue(wrapper)).toBe('');

    await setComposerText(wrapper, 'Next regular steer');
    await composerEditor(wrapper).trigger('keydown', { key: 'Enter', metaKey: true });

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['queued-1', 'Edited steer']]);
    expect(wrapper.emitted('steer')).toStrictEqual([['Next regular steer']]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('disables queue editing while the composer is not empty', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages,
        modelValue: 'Existing draft',
        queuedPrompts: [{ id: 'queued-1', text: 'Queued text' }],
      },
    });

    expect(wrapper.get('[aria-label="Edit queued prompt"]').attributes('disabled')).toBeDefined();
  });

  it('binds directly to a surface controller while preserving controlled mode overrides', async () => {
    const controller = fakeSurfaceController();
    const wrapper = mount(CodexConversationPane, { props: { surface: controller } });

    await vi.waitFor(() => expect(controller.connect).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(wrapper.text()).toContain('Bound controller message'));
    await vi.waitFor(() => expect(controller.readConversationPromptHistory).toHaveBeenCalledWith('thread-bound'));
    await setComposerText(wrapper, '/goal ship the SDK');
    await wrapper.get('form').trigger('submit');
    expect(controller.sendMessage).toHaveBeenCalledWith('/goal ship the SDK', undefined);

    await wrapper.setProps({
      messages: [{ id: 'controlled', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Controlled override' }] }],
    });
    expect(wrapper.text()).toContain('Controlled override');
    expect(wrapper.text()).not.toContain('Bound controller message');
  });

  it('uses the pane controller as the single state and action source', async () => {
    const controlledMessage: SurfaceMessage = {
      id: 'controller-message',
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'Controller-owned message' }],
    };
    const submit = vi.fn();
    const onMessageCopied = vi.fn();
    const updateComposerState = vi.fn();
    const paneState: CodexConversationPaneState = {
      identity: {
        conversationKey: 'controller-thread',
        messages: [controlledMessage],
      },
      composer: {
        state: { text: '', selectionStart: 0, selectionEnd: 0 },
      },
    };
    const controller = createCodexConversationPaneController({
      state: paneState,
      actions: { submit, onMessageCopied, updateComposerState },
    });
    const wrapper = mount(CodexConversationPane, {
      props: {
        controller,
        messages,
        modelValue: 'legacy draft',
      },
    });

    expect(wrapper.text()).toContain('Controller-owned message');
    expect(wrapper.text()).not.toContain('Ready to build');

    await setComposerText(wrapper, 'Submit through controller');
    await wrapper.get('form').trigger('submit');

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith('Submit through controller', undefined);
    expect(updateComposerState).toHaveBeenCalled();
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    wrapper.findComponent(CodexMessageList).vm.$emit('copy-message', 0);
    expect(onMessageCopied).toHaveBeenCalledOnce();
    expect(onMessageCopied).toHaveBeenCalledWith(0);
    expect(wrapper.emitted('copyMessage')).toBeUndefined();
  });

  it('forwards the complete pane action table through exact legacy events', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
    });
    const response = { id: 'legacy-request', payload: { decision: 'allow' } };
    const edit = { content: 'Edited legacy prompt', turnId: 'turn-3' };
    const composerState = { text: 'Legacy draft', selectionStart: 2, selectionEnd: 6 };

    emitPaneActionTable(wrapper, { composerState, edit, response });
    await flushPromises();

    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(wrapper.emitted('clientResponse')).toStrictEqual([[response]]);
    expect(wrapper.emitted('copyMessage')).toStrictEqual([[1]]);
    expect(wrapper.emitted('deleteTurn')).toStrictEqual([['turn-2']]);
    expect(wrapper.emitted('editTurn')).toStrictEqual([[edit]]);
    expect(wrapper.emitted('forkTurn')).toStrictEqual([['turn-4']]);
    expect(wrapper.emitted('retryTurn')).toStrictEqual([['turn-5']]);
    expect(wrapper.emitted('sendFollowUp')).toStrictEqual([['Continue with tests']]);
    expect(wrapper.emitted('clearGoal')).toStrictEqual([[]]);
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['Legacy draft']]);
    expect(wrapper.emitted('update:composerState')).toStrictEqual([[composerState]]);
  });

  it('forwards pane actions to both compatibility events and an attached surface', async () => {
    const surface = fakeSurfaceController();
    const surfaceActions = {
      clearGoal: vi.fn(async () => surface.state),
      deleteTurn: vi.fn(async () => surface.state),
      editTurn: vi.fn(async () => surface.state),
      forkTurn: vi.fn(async () => surface.state),
      interrupt: vi.fn(async () => surface.state),
      respondToClientRequest: vi.fn(async () => surface.state),
      retryTurn: vi.fn(async () => surface.state),
      sendMessage: vi.fn(async () => surface.state),
    };
    Object.assign(surface, surfaceActions);
    const wrapper = mount(CodexConversationPane, { props: { surface } });
    await vi.waitFor(() => expect(surface.connect).toHaveBeenCalledOnce());
    const response = { id: 'surface-request', payload: { decision: 'deny' } };
    const edit = { content: 'Edited surface prompt', turnId: 'turn-3' };
    const composerState = { text: 'Surface draft', selectionStart: 1, selectionEnd: 4 };

    emitPaneActionTable(wrapper, { composerState, edit, response });
    await flushPromises();

    expect(surfaceActions.interrupt).toHaveBeenCalledOnce();
    expect(surfaceActions.respondToClientRequest).toHaveBeenCalledWith(response);
    expect(surfaceActions.deleteTurn).toHaveBeenCalledWith('turn-2');
    expect(surfaceActions.editTurn).toHaveBeenCalledWith('turn-3', 'Edited surface prompt');
    expect(surfaceActions.forkTurn).toHaveBeenCalledWith('turn-4');
    expect(surfaceActions.retryTurn).toHaveBeenCalledWith('turn-5');
    expect(surfaceActions.sendMessage).toHaveBeenCalledWith('Continue with tests');
    expect(surfaceActions.clearGoal).toHaveBeenCalledOnce();
    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(wrapper.emitted('clientResponse')).toStrictEqual([[response]]);
    expect(wrapper.emitted('copyMessage')).toStrictEqual([[1]]);
    expect(wrapper.emitted('deleteTurn')).toStrictEqual([['turn-2']]);
    expect(wrapper.emitted('editTurn')).toStrictEqual([[edit]]);
    expect(wrapper.emitted('forkTurn')).toStrictEqual([['turn-4']]);
    expect(wrapper.emitted('retryTurn')).toStrictEqual([['turn-5']]);
    expect(wrapper.emitted('sendFollowUp')).toStrictEqual([['Continue with tests']]);
    expect(wrapper.emitted('clearGoal')).toStrictEqual([[]]);
    expect(wrapper.emitted('update:composerState')).toStrictEqual([[composerState]]);
  });

  it('keeps a deleting turn visible, shows progress, and disables its actions until deletion settles', async () => {
    let finishDelete!: () => void;
    const deleteTurn = vi.fn(() => new Promise<void>((resolve) => {
      finishDelete = resolve;
    }));
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'pending-delete',
          activeTurnId: null,
          turns: [{
            id: 'turn-delete', status: 'completed', error: null, willRetry: false,
            startedAt: null, completedAt: null, durationMs: null,
          }],
          messages: [{
            id: 'user-delete', role: 'user', status: 'complete', turnId: 'turn-delete',
            parts: [{ type: 'text', text: 'Delete this turn' }],
          }],
        },
        policy: { canDeleteTurn: true, canEditTurn: true, canForkTurn: true },
      },
      actions: { deleteTurn },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('button[aria-label="Delete"]').trigger('click');
    await nextTick();

    expect(deleteTurn).toHaveBeenCalledWith('turn-delete');
    expect(wrapper.text()).toContain('Delete this turn');
    expect(wrapper.find('button[aria-label="Delete"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Deleting"] .chat-message-actions__spinner').exists()).toBe(true);
    for (const button of wrapper.findAll('.chat-message-actions button')) {
      expect(button.attributes('disabled')).toBeDefined();
    }

    finishDelete();
    await flushPromises();

    expect(wrapper.find('button[aria-label="Deleting"]').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="Delete"]').attributes('disabled')).toBeUndefined();
  });

  it('keeps deletion pending for fire-and-forget controller actions until controlled state removes the turn', async () => {
    const state = reactive<CodexConversationPaneState>({
      identity: {
        conversationKey: 'emitted-delete',
        activeTurnId: null,
        turns: [{
          id: 'turn-delete', status: 'completed', error: null, willRetry: false,
          startedAt: null, completedAt: null, durationMs: null,
        }],
        messages: [{
          id: 'user-delete', role: 'user', status: 'complete', turnId: 'turn-delete',
          parts: [{ type: 'text', text: 'Delete through a host event' }],
        }],
      },
      policy: { canDeleteTurn: true },
    });
    const deleteTurn = vi.fn();
    const controller = createCodexConversationPaneController({ state, actions: { deleteTurn } });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('button[aria-label="Delete"]').trigger('click');
    await nextTick();

    expect(deleteTurn).toHaveBeenCalledWith('turn-delete');
    expect(wrapper.find('button[aria-label="Deleting"]').exists()).toBe(true);

    state.identity.messages = [];
    state.identity.turns = [];
    await nextTick();

    expect(wrapper.find('button[aria-label="Deleting"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Delete through a host event');
  });

  it('routes the complete pane action table exclusively through controller actions', async () => {
    const actions = {
      cancel: vi.fn(),
      clientResponse: vi.fn(),
      onMessageCopied: vi.fn(),
      deleteTurn: vi.fn(),
      editTurn: vi.fn(),
      forkTurn: vi.fn(),
      retryTurn: vi.fn(),
      sendFollowUp: vi.fn(),
      clearGoal: vi.fn(),
      updateComposerState: vi.fn(),
    };
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'controller-actions', messages } },
      actions,
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    const response = { id: 'controller-request', payload: { decision: 'allow' } };
    const edit = { content: 'Edited controlled prompt', turnId: 'turn-3' };
    const composerState = { text: 'Controlled draft', selectionStart: 3, selectionEnd: 7 };

    emitPaneActionTable(wrapper, { composerState, edit, response });
    await flushPromises();

    expect(actions.cancel).toHaveBeenCalledOnce();
    expect(actions.clientResponse).toHaveBeenCalledWith(response);
    expect(actions.onMessageCopied).toHaveBeenCalledWith(1);
    expect(actions.deleteTurn).toHaveBeenCalledWith('turn-2');
    expect(actions.editTurn).toHaveBeenCalledWith(edit);
    expect(actions.forkTurn).toHaveBeenCalledWith('turn-4');
    expect(actions.retryTurn).toHaveBeenCalledWith('turn-5');
    expect(actions.sendFollowUp).toHaveBeenCalledWith('Continue with tests');
    expect(actions.clearGoal).toHaveBeenCalledOnce();
    expect(actions.updateComposerState).toHaveBeenCalledWith(composerState);
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.emitted('clientResponse')).toBeUndefined();
    expect(wrapper.emitted('copyMessage')).toBeUndefined();
    expect(wrapper.emitted('deleteTurn')).toBeUndefined();
    expect(wrapper.emitted('editTurn')).toBeUndefined();
    expect(wrapper.emitted('forkTurn')).toBeUndefined();
    expect(wrapper.emitted('retryTurn')).toBeUndefined();
    expect(wrapper.emitted('sendFollowUp')).toBeUndefined();
    expect(wrapper.emitted('clearGoal')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('update:composerState')).toBeUndefined();
  });

  it('keeps pane actions controller-owned when their optional actions are absent', async () => {
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'controller-actions-absent', messages } },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    const composerState = { text: 'Locally controlled draft', selectionStart: 2, selectionEnd: 5 };

    emitPaneActionTable(wrapper, {
      composerState,
      edit: { content: 'Must stay controlled', turnId: 'turn-3' },
      response: { id: 'controller-request-absent', payload: { decision: 'deny' } },
    });
    await flushPromises();

    expect(composerValue(wrapper)).toBe('Locally controlled draft');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.emitted('clientResponse')).toBeUndefined();
    expect(wrapper.emitted('copyMessage')).toBeUndefined();
    expect(wrapper.emitted('deleteTurn')).toBeUndefined();
    expect(wrapper.emitted('editTurn')).toBeUndefined();
    expect(wrapper.emitted('forkTurn')).toBeUndefined();
    expect(wrapper.emitted('retryTurn')).toBeUndefined();
    expect(wrapper.emitted('sendFollowUp')).toBeUndefined();
    expect(wrapper.emitted('clearGoal')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('update:composerState')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('forwards composer settings and decisions through exact legacy events', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { approvals: [routingApproval], messages, modelValue: '' },
    });

    emitComposerActionTable(wrapper);
    await wrapper.findAll('button').find((button) => button.text() === 'Allow once')!.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('interrupt')).toStrictEqual([[]]);
    expect(wrapper.emitted('selectApprovalPreset')).toStrictEqual([['full-access']]);
    expect(wrapper.emitted('resolveApproval')).toStrictEqual([
      ['routing-approval', 'approve', 'once'],
    ]);
    expect(wrapper.emitted('update:modelId')).toStrictEqual([['gpt-routing']]);
    expect(wrapper.emitted('update:planMode')).toStrictEqual([[true]]);
    expect(wrapper.emitted('update:reasoningEffort')).toStrictEqual([['high']]);
    expect(wrapper.emitted('update:serviceTier')).toStrictEqual([['priority']]);
    expect(wrapper.emitted('menuSelect')).toStrictEqual([[routingMenuItem]]);
    expect(wrapper.emitted('mentionSelect')).toStrictEqual([
      [routingMentionGroup.items[0], routingMentionGroup],
    ]);
  });

  it('forwards composer settings and decisions to an attached surface', async () => {
    const surface = fakeSurfaceController();
    const surfaceActions = {
      interrupt: vi.fn(async () => surface.state),
      resolveApproval: vi.fn(async () => surface.state),
      updateConversationSettings: vi.fn(async () => surface.state),
    };
    Object.assign(surface, surfaceActions);
    const wrapper = mount(CodexConversationPane, {
      props: { approvals: [routingApproval], surface },
    });
    await vi.waitFor(() => expect(surface.connect).toHaveBeenCalledOnce());

    emitComposerActionTable(wrapper);
    await wrapper.findAll('button').find((button) => button.text() === 'Allow once')!.trigger('click');
    await flushPromises();

    expect(surfaceActions.interrupt).toHaveBeenCalledOnce();
    expect(surfaceActions.resolveApproval).toHaveBeenCalledWith('routing-approval', 'approve', 'once');
    expect(surfaceActions.updateConversationSettings.mock.calls).toStrictEqual([
      [{ approvalPreset: 'full-access' }],
      [{ modelId: 'gpt-routing' }],
      [{ planMode: true }],
      [{ reasoningEffort: 'high' }],
      [{ serviceTier: 'priority' }],
    ]);
    expect(wrapper.emitted('interrupt')).toStrictEqual([[]]);
    expect(wrapper.emitted('resolveApproval')).toStrictEqual([
      ['routing-approval', 'approve', 'once'],
    ]);
    expect(wrapper.emitted('menuSelect')).toStrictEqual([[routingMenuItem]]);
    expect(wrapper.emitted('mentionSelect')).toStrictEqual([
      [routingMentionGroup.items[0], routingMentionGroup],
    ]);
  });

  it('routes composer settings and decisions exclusively through controller actions', async () => {
    const actions = {
      interrupt: vi.fn(),
      menuSelect: vi.fn(),
      mentionSelect: vi.fn(),
      resolveApproval: vi.fn(),
      selectApprovalPreset: vi.fn(),
      updateSettings: vi.fn(),
    };
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-composer-actions', messages },
        thread: { approvals: [routingApproval] },
      },
      actions,
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    emitComposerActionTable(wrapper);
    await wrapper.findAll('button').find((button) => button.text() === 'Allow once')!.trigger('click');
    await flushPromises();

    expect(actions.interrupt).toHaveBeenCalledOnce();
    expect(actions.selectApprovalPreset).toHaveBeenCalledWith('full-access');
    expect(actions.resolveApproval).toHaveBeenCalledWith('routing-approval', 'approve', 'once');
    expect(actions.updateSettings.mock.calls).toStrictEqual([
      [{ modelId: 'gpt-routing' }],
      [{ planMode: true }],
      [{ reasoningEffort: 'high' }],
      [{ serviceTier: 'priority' }],
    ]);
    expect(actions.menuSelect).toHaveBeenCalledWith(routingMenuItem);
    expect(actions.mentionSelect).toHaveBeenCalledWith(
      routingMentionGroup.items[0],
      routingMentionGroup,
    );
    expect(wrapper.emitted('interrupt')).toBeUndefined();
    expect(wrapper.emitted('selectApprovalPreset')).toBeUndefined();
    expect(wrapper.emitted('resolveApproval')).toBeUndefined();
    expect(wrapper.emitted('update:modelId')).toBeUndefined();
    expect(wrapper.emitted('update:planMode')).toBeUndefined();
    expect(wrapper.emitted('update:reasoningEffort')).toBeUndefined();
    expect(wrapper.emitted('update:serviceTier')).toBeUndefined();
    expect(wrapper.emitted('menuSelect')).toBeUndefined();
    expect(wrapper.emitted('mentionSelect')).toBeUndefined();
  });

  it('uses controlled settings as the approval-preset fallback action', async () => {
    const updateSettings = vi.fn();
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'controlled-preset-fallback', messages } },
      actions: { updateSettings },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).vm
      .$emit('selectApprovalPreset', 'approve-for-me');
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({ approvalPreset: 'approve-for-me' });
    expect(wrapper.emitted('selectApprovalPreset')).toBeUndefined();
  });

  it('keeps composer settings and decisions controller-owned when actions are absent', async () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controlled-composer-actions-absent', messages },
        thread: { approvals: [routingApproval] },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    emitComposerActionTable(wrapper);
    await wrapper.findAll('button').find((button) => button.text() === 'Allow once')!.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('interrupt')).toBeUndefined();
    expect(wrapper.emitted('selectApprovalPreset')).toBeUndefined();
    expect(wrapper.emitted('resolveApproval')).toBeUndefined();
    expect(wrapper.emitted('update:modelId')).toBeUndefined();
    expect(wrapper.emitted('update:planMode')).toBeUndefined();
    expect(wrapper.emitted('update:reasoningEffort')).toBeUndefined();
    expect(wrapper.emitted('update:serviceTier')).toBeUndefined();
    expect(wrapper.emitted('menuSelect')).toBeUndefined();
    expect(wrapper.emitted('mentionSelect')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not fall back to legacy values when a controller supplies explicit empty values', async () => {
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'controller-thread',
          messages: [],
          busy: false,
          disabled: false,
          error: null,
        },
        composer: {
          state: { text: '', selectionStart: 0, selectionEnd: 0 },
          approvalPreset: null,
          planMode: false,
          selectedModelId: null,
          selectedReasoningEffort: null,
          selectedServiceTier: null,
        },
        history: { hasOlder: false, loading: false, loadingOlder: false },
        thread: { approvals: [], queuedPrompts: [], goal: null, contextUsage: null },
        catalogs: { files: [], models: [], commands: [], skills: [], plugins: [] },
        policy: {
          actionsDisabled: false,
          attachEnabled: false,
          canDeleteTurn: false,
          canEditTurn: false,
          canRetryTurn: false,
          followUpsDisabled: false,
        },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, {
      props: {
        controller,
        busy: true,
        disabled: true,
        error: 'legacy error',
        messages,
        modelValue: 'legacy draft',
        planMode: true,
        selectedModelId: 'legacy-model',
      },
    });

    expect(wrapper.get('.codex-conversation-pane').attributes('aria-busy')).toBe('false');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Start a conversation with Codex');
    expect(wrapper.text()).not.toContain('legacy draft');
    expect(composerEditor(wrapper).attributes('aria-disabled')).toBe('false');
  });

  it('projects every populated controller catalog, policy, and selection into its owning child', () => {
    const models = [{
      id: 'model-controller',
      model: 'gpt-controller',
      displayName: 'Controller model',
      supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
    }];
    const skills = [{ name: 'controller-skill', path: '/controller/SKILL.md', enabled: true }];
    const plugins = [{
      id: 'controller@plugin',
      name: 'controller',
      displayName: 'Controller plugin',
      enabled: true,
    }];
    const commands = [{ id: 'controller-command', name: 'controller-command' }];
    const files = [{ name: 'controller.ts', path: '/repo/controller.ts' }];
    const leadingMenuItems = [{ id: 'leading-controller', label: 'Leading', type: 'action' as const }];
    const menuItems = [{ id: 'menu-controller', label: 'Menu', type: 'custom' as const }];
    const modelMenuItems = [{ id: 'model-menu-controller', label: 'Favorite', type: 'action' as const }];
    const queuedPrompts = [{ id: 'queued-controller', text: 'Controller queue' }];
    const turnGitDiff = {
      turnId: 'turn-controller',
      addedLines: 3,
      removedLines: 1,
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    const turns: CodexSurfaceTurn[] = [{
      id: 'turn-controller',
      status: 'completed',
      error: null,
      willRetry: false,
      startedAt: '2026-09-03T00:00:00.000Z',
      completedAt: '2026-09-03T00:00:01.000Z',
      durationMs: 1_000,
    }];
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controller-thread', messages, turns },
        thread: { queuedPrompts, turnGitDiff },
        composer: {
          approvalPreset: 'full-access',
          leadingMenuItems,
          menuItems,
          modelMenuItems,
          placeholder: 'Controller placeholder',
          planMode: true,
          selectedModelId: 'model-controller',
          selectedReasoningEffort: 'high',
          selectedServiceTier: 'priority',
        },
        catalogs: {
          commands,
          files,
          modelCatalogStatus: 'loaded',
          models,
          plugins,
          skillCatalogStatus: 'error',
          skills,
        },
        capabilities: {
          models: true,
          skills: true,
          reasoningEffort: true,
          serviceTier: true,
          planMode: true,
          goals: true,
          steerPrompt: true,
          interrupt: true,
          history: true,
          deleteTurn: true,
          editTurn: true,
          retryTurn: true,
          approvals: true,
          approvalPresets: ['full-access'],
        },
        policy: {
          actionsDisabled: true,
          canDeleteTurn: false,
          canEditTurn: false,
          canForkTurn: true,
          canRetryTurn: false,
          followUpsDisabled: true,
        },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, {
      props: {
        controller,
        commands: [{ id: 'legacy-command', name: 'legacy-command' }],
        modelValue: '',
        placeholder: 'Legacy placeholder',
        selectedModelId: 'legacy-model',
      },
    });

    const composer = wrapper.findComponent(CodexComposer) as unknown as VueWrapper;
    expect(composer.props()).toMatchObject({
      approvalPreset: 'full-access',
      commands,
      files,
      leadingMenuItems,
      menuItems,
      modelMenuItems,
      modelCatalogStatus: 'loaded',
      models,
      placeholder: 'Controller placeholder',
      planMode: true,
      plugins,
      selectedModelId: 'model-controller',
      selectedReasoningEffort: 'high',
      selectedServiceTier: 'priority',
      skillCatalogStatus: 'error',
      skills,
    });
    expect((composer.props() as { capabilities: { approvalPresets: readonly string[] } }).capabilities.approvalPresets)
      .toStrictEqual(['full-access']);

    expect(wrapper.findComponent(CodexMessageList).props()).toMatchObject({
      actionsDisabled: true,
      canDeleteTurn: false,
      canEditTurn: false,
      canForkTurn: true,
      canRetryTurn: false,
      followUpsDisabled: true,
      plugins,
      skills,
      turns,
    });
    expect(wrapper.findComponent(ChatComposerShelf).props()).toMatchObject({ queuedPrompts, turnGitDiff });
  });

  it('uses public controller defaults when optional controller sections are absent', () => {
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'minimal-controller', messages } },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });
    const composer = wrapper.findComponent(CodexComposer) as unknown as VueWrapper;

    expect(composer.props()).toMatchObject({
      commands: [],
      files: [],
      leadingMenuItems: [],
      menuItems: [],
      modelMenuItems: [],
      placeholder: 'Ask Codex…',
      selectedModelId: undefined,
      selectedReasoningEffort: undefined,
      selectedServiceTier: undefined,
      skillCatalogStatus: undefined,
    });
    expect(wrapper.findComponent(CodexMessageList).props()).toMatchObject({
      actionsDisabled: false,
      canDeleteTurn: true,
      canEditTurn: true,
      canForkTurn: false,
      canRetryTurn: true,
      followUpsDisabled: false,
    });
    expect(wrapper.findComponent(ChatComposerShelf).props()).toMatchObject({
      queuedPrompts: [],
      turnGitDiff: undefined,
    });
  });

  it('projects explicit legacy selections and catalogs without a controller', () => {
    const commands = [{ id: 'legacy-command', name: 'legacy-command' }];
    const files = [{ name: 'legacy.ts', path: '/repo/legacy.ts' }];
    const leadingMenuItems = [{ id: 'legacy-leading', label: 'Leading', type: 'action' as const }];
    const menuItems = [{ id: 'legacy-menu', label: 'Menu', type: 'custom' as const }];
    const modelMenuItems = [{ id: 'legacy-model-menu', label: 'Favorite', type: 'action' as const }];
    const turnGitDiff = {
      turnId: 'turn-legacy',
      addedLines: 5,
      removedLines: 2,
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    const wrapper = mount(CodexConversationPane, {
      props: {
        actionsDisabled: true,
        canDeleteTurn: false,
        canEditTurn: false,
        canForkTurn: true,
        canRetryTurn: false,
        commands,
        files,
        followUpsDisabled: true,
        leadingMenuItems,
        menuItems,
        modelMenuItems,
        messages,
        modelValue: '',
        placeholder: 'Legacy placeholder',
        selectedModelId: 'legacy-model',
        selectedReasoningEffort: 'medium',
        selectedServiceTier: 'priority',
        skillCatalogStatus: 'loading',
        turnGitDiff,
      },
    });
    const composer = wrapper.findComponent(CodexComposer) as unknown as VueWrapper;

    expect(composer.props()).toMatchObject({
      commands,
      files,
      leadingMenuItems,
      menuItems,
      modelMenuItems,
      placeholder: 'Legacy placeholder',
      selectedModelId: 'legacy-model',
      selectedReasoningEffort: 'medium',
      selectedServiceTier: 'priority',
      skillCatalogStatus: 'loading',
    });
    expect(wrapper.findComponent(CodexMessageList).props()).toMatchObject({
      actionsDisabled: true,
      canDeleteTurn: false,
      canEditTurn: false,
      canForkTurn: true,
      canRetryTurn: false,
      followUpsDisabled: true,
    });
    expect(wrapper.findComponent(ChatComposerShelf).props('turnGitDiff')).toStrictEqual(turnGitDiff);
  });

  it('uses surface selections and approval presets when legacy props are omitted', async () => {
    const surface = fakeSurfaceController();
    const turnGitDiff = {
      turnId: 'turn-surface',
      addedLines: 7,
      removedLines: 3,
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    surface.state.selectedModelId = 'surface-model';
    surface.state.selectedReasoningEffort = 'high';
    surface.state.selectedServiceTier = 'priority';
    surface.state.turnGitDiff = turnGitDiff;
    surface.state.approvalPresets = ['full-access'];
    const wrapper = mount(CodexConversationPane, {
      props: {
        capabilities: {
          models: true,
          skills: true,
          reasoningEffort: true,
          planMode: true,
          goals: true,
          steerPrompt: true,
          interrupt: true,
          history: true,
          deleteTurn: true,
          editTurn: true,
          retryTurn: true,
          approvals: true,
          approvalPresets: ['ask-for-approval'],
        },
        surface,
      },
    });
    await vi.waitFor(() => expect(surface.connect).toHaveBeenCalledOnce());
    const composer = wrapper.findComponent(CodexComposer) as unknown as VueWrapper;

    expect(composer.props()).toMatchObject({
      selectedModelId: 'surface-model',
      selectedReasoningEffort: 'high',
      selectedServiceTier: 'priority',
    });
    expect((composer.props() as { capabilities: { approvalPresets: readonly string[] } }).capabilities.approvalPresets)
      .toStrictEqual(['full-access']);
    expect(wrapper.findComponent(ChatComposerShelf).props('turnGitDiff')).toStrictEqual(turnGitDiff);
  });

  it('starts the transcript for a pending approval without messages or busy work', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        approvals: [{
          id: 'approval-only',
          kind: 'command',
          conversationId: 'conversation-approval-only',
          itemId: 'item-approval-only',
          title: 'Run tests',
          command: 'npm test',
          cwd: '/repo',
        }],
        messages: [],
        modelValue: '',
      },
    });

    expect(wrapper.findComponent(CodexMessageList).exists()).toBe(true);
    expect(wrapper.find('.codex-conversation-pane__hero').exists()).toBe(false);
    expect(wrapper.text()).toContain('npm test');
  });

  it('passes empty legacy defaults to the shelf and message list', () => {
    const wrapper = mount(CodexConversationPane, { props: { messages, modelValue: '' } });

    expect(wrapper.findComponent(ChatComposerShelf).props('queuedPrompts')).toStrictEqual([]);
    expect(wrapper.findComponent(CodexMessageList).props()).toMatchObject({
      actionsDisabled: false,
      followUpsDisabled: false,
    });
  });

  it('surfaces rejected controller actions through the pane error UI', async () => {
    const submit = vi.fn(async () => {
      throw new Error('Controller rejected submission');
    });
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controller-thread', messages },
        composer: { state: { text: 'Try again', selectionStart: 8, selectionEnd: 8 } },
      },
      actions: { submit },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Controller rejected submission');
  });

  it('follows bound surface booleans when their controlled props are omitted', async () => {
    const controller = fakeSurfaceController();
    const wrapper = mount(CodexConversationPane, { props: { surface: controller } });
    await vi.waitFor(() => expect(controller.connect).toHaveBeenCalledOnce());

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.get('[role="menuitemcheckbox"]').trigger('click');
    await vi.waitFor(() => expect(controller.updateConversationSettings).toHaveBeenCalledWith({ planMode: true }));
    expect(wrapper.text()).toContain('Plan');
    expect(wrapper.get('[role="menuitemcheckbox"]').attributes('aria-checked')).toBe('true');

    await wrapper.get('[aria-label="Disable plan mode"]').trigger('click');
    await vi.waitFor(() => expect(controller.updateConversationSettings).toHaveBeenLastCalledWith({ planMode: false }));
    await setComposerText(wrapper, '/plan');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(controller.sendMessage).toHaveBeenCalledWith('/plan', undefined));
    expect(wrapper.text()).toContain('Plan');

    controller.state.busy = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.codex-conversation-pane').attributes('aria-busy')).toBe('true');

    controller.state.busy = false;
    controller.state.historyLoading = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[aria-label="Loading conversation"]').exists()).toBe(true);

    controller.state.historyLoading = false;
    controller.state.status = 'connecting';
    await wrapper.vm.$nextTick();
    expect(composerEditor(wrapper).attributes('aria-disabled')).toBe('true');
  });

  it('clears a stale local action error after the bound conversation recovers', async () => {
    const controller = fakeSurfaceController();
    vi.mocked(controller.connect).mockRejectedValueOnce(new Error('resume failed'));
    const wrapper = mount(CodexConversationPane, { props: { surface: controller } });

    await vi.waitFor(() => expect(wrapper.text()).toContain('resume failed'));
    controller.state.status = 'ready';
    controller.state.error = null;
    controller.state.activeConversationId = 'thread-recovered';
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('retains a local action error until the bound surface is both ready and error-free', async () => {
    const controller = fakeSurfaceController();
    vi.mocked(controller.connect).mockRejectedValueOnce(new Error('connect failed'));
    const wrapper = mount(CodexConversationPane, { props: { surface: controller } });
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toBe('connect failed'));

    controller.state.status = 'ready';
    controller.state.error = 'surface still failing';
    await nextTick();
    expect(wrapper.get('[role="alert"]').text()).toBe('connect failed');

    controller.state.status = 'connecting';
    controller.state.error = null;
    await nextTick();
    expect(wrapper.get('[role="alert"]').text()).toBe('connect failed');

    controller.state.status = 'ready';
    await nextTick();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not reconnect a surface that is already beyond the idle state', async () => {
    const controller = fakeSurfaceController();
    controller.state.status = 'ready';
    const wrapper = mount(CodexConversationPane, { props: { surface: controller } });
    await nextTick();

    expect(controller.connect).not.toHaveBeenCalled();
    expect(composerProps(wrapper).disabled).toBe(false);
  });

  it('exposes slots and extensible composer menu entries', async () => {
    const menuItems: CodexComposerMenuItem<{ source: string }>[] = [{
      id: 'custom-action',
      type: 'custom',
      label: 'Custom action',
      payload: { source: 'sample' },
    }];
    const wrapper = mount(CodexConversationPane, {
      props: { menuItems, messages: [], modelValue: '' },
      slots: {
        empty: '<p class="custom-empty">Pick a prompt</p>',
        'before-composer': '<div class="custom-toolbar">Toolbar</div>',
      },
    });
    expect(wrapper.get('.custom-empty').text()).toBe('Pick a prompt');
    expect(wrapper.get('.custom-toolbar').text()).toBe('Toolbar');

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Custom action'))!.trigger('click');
    expect(wrapper.emitted('menuSelect')?.[0]).toStrictEqual([menuItems[0]]);
  });

  it('routes host mention groups and rendering through the stock pane', async () => {
    const group = {
      id: 'threads',
      label: 'Threads',
      items: [{ id: 'thread-1', value: 'thread:019abc', label: 'codex-claw' }],
    };
    const wrapper = mount(CodexConversationPane, {
      props: {
        mentionGroups: [group],
        messages: [{
          id: 'user-thread',
          role: 'user',
          status: 'complete',
          parts: [{ type: 'text', text: 'Ask @thread:019abc' }],
        } satisfies SurfaceMessage],
      },
      slots: {
        mention: ({ item, surface }: { item: { label: string }; surface: string }) => (
          h('span', { class: `host-mention host-mention--${surface}` }, `🤖 ${item.label}`)
        ),
        'suggestion-item': ({ item }: { item: { label: string } }) => (
          h('span', { class: 'host-suggestion' }, `Thread: ${item.label}`)
        ),
      },
    });

    expect(wrapper.get('.host-mention--message').text()).toBe('🤖 codex-claw');
    await setComposerText(wrapper, '@codex');
    expect(wrapper.get('.host-suggestion').text()).toBe('Thread: codex-claw');
    await wrapper.get('.chat-composer-at-menu__item').trigger('mousedown');
    expect(composerValue(wrapper)).toBe('@thread:019abc ');
    expect(wrapper.get('.host-mention--composer').text()).toBe('🤖 codex-claw');
    expect(wrapper.emitted('mentionSelect')).toStrictEqual([[group.items[0], group]]);
  });

  it('routes host mention selection exclusively through controller actions in controller mode', async () => {
    const group = {
      id: 'threads',
      label: 'Threads',
      items: [{ id: 'thread-1', value: 'thread:019abc', label: 'codex-claw' }],
    };
    const mentionSelect = vi.fn();
    const controller = createCodexConversationPaneController({
      state: {
        identity: { conversationKey: 'controller-thread', messages: [] },
        catalogs: { mentionGroups: [group] },
      },
      actions: { mentionSelect },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await setComposerText(wrapper, '@codex');
    await wrapper.get('.chat-composer-at-menu__item').trigger('mousedown');
    await flushPromises();

    expect(mentionSelect).toHaveBeenCalledWith(group.items[0], group);
    expect(wrapper.emitted('mentionSelect')).toBeUndefined();
  });

  it('composes approvals and forwards decisions without exposing protocol types', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        approvals: [{
          id: 'approval-1', kind: 'file-change', conversationId: 'thread-1', turnId: 'turn-1',
          itemId: 'item-1', title: 'Apply file changes',
        }],
        messages,
        modelValue: '',
      },
    });
    await wrapper.findAll('button').find((button) => button.text() === 'Allow once')!.trigger('click');
    expect(wrapper.emitted('resolveApproval')).toStrictEqual([['approval-1', 'approve', 'once']]);
  });

  it('forwards presentation extension slots at each composition boundary', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        approvals: [{
          id: 'approval-slot', kind: 'permissions', conversationId: 'thread-1', itemId: 'item-1',
          title: 'Permissions',
        }],
        menuItems: [{ id: 'custom', type: 'custom', label: 'Custom' }],
        messages,
        modelValue: '',
      },
      slots: {
        approval: '<div class="approval-slot">Approval slot</div>',
        message: '<div class="message-slot">Message slot</div>',
        'composer-after-input': '<div class="input-slot">Input slot</div>',
        'composer-after': '<div class="after-slot">After slot</div>',
        'after-composer': '<div class="footer-slot">Footer slot</div>',
      },
    });
    expect(wrapper.get('.approval-slot').text()).toBe('Approval slot');
    expect(wrapper.get('.message-slot').text()).toBe('Message slot');
    expect(wrapper.get('.input-slot').text()).toBe('Input slot');
    expect(wrapper.get('.after-slot').text()).toBe('After slot');
    expect(wrapper.get('.footer-slot').text()).toBe('Footer slot');
  });

  it('makes history loading authoritative over a previously rendered transcript', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { historyLoading: true, messages, modelValue: '' },
    });

    expect(wrapper.find('[aria-label="Loading conversation"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Ready to build');

    await wrapper.setProps({ historyLoading: false });
    expect(wrapper.text()).toContain('Ready to build');
  });

  it('keeps completed message actions available while reserving the message being generated', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        busy: true,
        messages: [
          { id: 'user-1', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Ship it' }] },
          { id: 'assistant-1', role: 'assistant', status: 'streaming', parts: [] },
        ],
        modelValue: '',
      },
    });

    const actions = wrapper.findAll('.chat-message__actions');
    expect(actions[0]?.attributes('aria-hidden')).toBeUndefined();
    expect(actions[0]?.attributes()).not.toHaveProperty('inert');
    expect(actions[1]?.attributes('aria-hidden')).toBe('true');
    expect(actions[1]?.attributes()).toHaveProperty('inert');
  });

  it('leaves empty and same-page fragment links to the browser', () => {
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
      slots: {
        message: () => h('div', [
          h('a', { class: 'blank-link', href: '   ' }, 'Blank'),
          h('a', { class: 'fragment-link', href: '#details' }, 'Details'),
        ]),
      },
    });

    for (const selector of ['.blank-link', '.fragment-link']) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      wrapper.get(selector).element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(wrapper.emitted('openLink')).toBeUndefined();
  });

  it('ignores bubbled conversation clicks whose target is not an element', () => {
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
      slots: { message: () => h('span', { class: 'text-target' }, 'Plain text') },
    });
    const text = wrapper.get('.text-target').element.firstChild!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    text.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted('openLink')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('routes links exclusively through controller ownership', async () => {
    const expected = { href: 'https://example.com/controller', kind: 'external' as const };
    const openLink = vi.fn();
    const compatibility = vi.fn();
    const controller = createCodexConversationPaneController({
      state: { identity: { conversationKey: 'controlled-link', messages } },
      actions: { openLink },
    });
    const wrapper = mount(CodexConversationPane, {
      props: { controller, openConversationLink: compatibility },
      slots: { message: () => h('a', { class: 'controlled-link', href: expected.href }, 'Open') },
    });

    await wrapper.get('.controlled-link').trigger('click');
    await flushPromises();
    expect(openLink).toHaveBeenCalledWith(expected);
    expect(compatibility).not.toHaveBeenCalled();
    expect(wrapper.emitted('openLink')).toBeUndefined();

    const noAction = mount(CodexConversationPane, {
      props: {
        controller: createCodexConversationPaneController({
          state: { identity: { conversationKey: 'controlled-link-no-action', messages } },
          actions: {},
        }),
        openConversationLink: compatibility,
      },
      slots: { message: () => h('a', { class: 'controlled-link', href: expected.href }, 'Open') },
    });
    await noAction.get('.controlled-link').trigger('click');
    expect(compatibility).not.toHaveBeenCalled();
    expect(noAction.emitted('openLink')).toBeUndefined();
  });

  it('opens external links in a hardened browser window when no host owns them', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    open.mockClear();
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
      slots: { message: () => h('a', { class: 'external-link', href: 'https://example.com/fallback' }, 'Open') },
    });

    await wrapper.get('.external-link').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('openLink')).toStrictEqual([[
      { href: 'https://example.com/fallback', kind: 'external' },
    ]]);
    expect(open).toHaveBeenCalledWith('https://example.com/fallback', '_blank', 'noopener,noreferrer');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('does not send file links to the browser fallback', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    open.mockClear();
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
      slots: { message: () => h('a', { class: 'file-link', href: 'src/index.ts:12' }, 'Open') },
    });

    await wrapper.get('.file-link').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('openLink')).toStrictEqual([[
      { href: 'src/index.ts:12', kind: 'file', path: 'src/index.ts', line: 12 },
    ]]);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens external links through host capabilities when available', async () => {
    const openExternal = vi.fn(async () => undefined);
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: {
          capabilities: {
            attachments: false, clipboard: false, externalLinks: true, transcription: false,
          },
          openExternal,
      },
    });
    try {
      const wrapper = mount(CodexConversationPane, {
        props: { messages, modelValue: '' },
        slots: { message: () => h('a', { class: 'host-external-link', href: 'https://example.com/host' }, 'Open') },
      });

      await wrapper.get('.host-external-link').trigger('click');
      await flushPromises();

      expect(openExternal).toHaveBeenCalledWith('https://example.com/host');
    } finally {
      Reflect.deleteProperty(window, 'codexAppSdkNative');
    }
  });

  it.each([
    ['docs/design%20notes.md?raw=1#overview', { href: 'docs/design%20notes.md?raw=1#overview', kind: 'file', path: 'docs/design notes.md' }],
    ['README.md:40', { href: 'README.md:40', kind: 'file', path: 'README.md', line: 40 }],
    ['file:///tmp/README.md:40:2', { href: 'file:///tmp/README.md:40:2', kind: 'file', path: '/tmp/README.md', line: 40, column: 2 }],
    ['file:///tmp/design%20notes.md#L4', { href: 'file:///tmp/design%20notes.md#L4', kind: 'file', path: '/tmp/design notes.md' }],
    ['C:/repo/src/App.vue#L9', { href: 'C:/repo/src/App.vue#L9', kind: 'file', path: 'C:/repo/src/App.vue' }],
    ['C:\\repo\\src\\App.vue#L9', { href: 'C:\\repo\\src\\App.vue#L9', kind: 'file', path: 'C:\\repo\\src\\App.vue' }],
    ['https://example.com/docs', { href: 'https://example.com/docs', kind: 'external' }],
  ])('intercepts %s and delegates opening to the host', async (href, expected) => {
    const openConversationLink = vi.fn();
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '', openConversationLink },
      slots: { message: () => h('a', { class: 'test-link', href }, 'Open') },
    });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.get('.test-link').element.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted('openLink')).toStrictEqual([[expected]]);
    expect(openConversationLink).toHaveBeenCalledWith(expected);
  });

  it('delegates visualization artifacts through their dedicated host action', async () => {
    const visualization = { path: '/tmp/backlog-icon-candidates.html', title: 'Backlog icon candidates' };
    const openVisualization = vi.fn();
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          id: 'assistant-visualization',
          role: 'assistant',
          status: 'complete',
          parts: [{
            type: 'text',
            text: `\uE200visualize\uE202${JSON.stringify(visualization)}\uE201`,
          }],
        }],
        modelValue: '',
        openVisualization,
      },
    });

    await wrapper.get('.chat-visualization-block').trigger('click');

    expect(wrapper.emitted('openVisualization')).toStrictEqual([[visualization]]);
    expect(wrapper.emitted('openLink')).toBeUndefined();
    expect(openVisualization).toHaveBeenCalledWith(visualization);
  });

  it('emits visualization artifacts without invoking an absent compatibility handler', async () => {
    const visualization = { path: '/tmp/no-handler.html', title: 'No handler' };
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          id: 'assistant-visualization-no-handler', role: 'assistant', status: 'complete',
          parts: [{ type: 'text', text: `\uE200visualize\uE202${JSON.stringify(visualization)}\uE201` }],
        }],
        modelValue: '',
      },
    });

    await wrapper.get('.chat-visualization-block').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('openVisualization')).toStrictEqual([[visualization]]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('keeps visualization actions inside controller mode when no action is supplied', async () => {
    const visualization = { path: '/tmp/controller-no-handler.html', title: 'Controlled' };
    const compatibility = vi.fn();
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          conversationKey: 'controlled-visualization-no-action',
          messages: [{
            id: 'assistant-controlled-visualization-no-action', role: 'assistant', status: 'complete',
            parts: [{ type: 'text', text: `\uE200visualize\uE202${JSON.stringify(visualization)}\uE201` }],
          }],
        },
      },
      actions: {},
    });
    const wrapper = mount(CodexConversationPane, {
      props: { controller, openVisualization: compatibility },
    });

    await wrapper.get('.chat-visualization-block').trigger('click');
    await flushPromises();

    expect(compatibility).not.toHaveBeenCalled();
    expect(wrapper.emitted('openVisualization')).toBeUndefined();
  });

  it('dispatches visualization artifacts through a controlled pane action', async () => {
    const visualization = { path: '/tmp/diagram.html', title: 'Architecture diagram' };
    const openVisualization = vi.fn();
    const controller = createCodexConversationPaneController({
      state: {
        identity: {
          messages: [{
            id: 'assistant-controlled-visualization',
            role: 'assistant',
            status: 'complete',
            parts: [{
              type: 'text',
              text: `\uE200visualize\uE202${JSON.stringify(visualization)}\uE201`,
            }],
          }],
        },
      },
      actions: { openVisualization },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('.chat-visualization-block').trigger('click');
    await flushPromises();

    expect(openVisualization).toHaveBeenCalledWith(visualization);
    expect(wrapper.emitted('openVisualization')).toBeUndefined();
    expect(wrapper.emitted('openLink')).toBeUndefined();
  });

  it('emits an absolute file link with the operation when a tool target is clicked', async () => {
    const openConversationLink = vi.fn();
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          id: 'assistant-file-tool',
          role: 'assistant',
          status: 'complete',
          turnId: 'turn-file-tool',
          parts: [{
            type: 'tool',
            id: 'read-file',
            kind: 'command',
            title: 'cat app-state.spec.ts',
            status: 'completed',
            statusText: JSON.stringify({
              action: 'read',
              phase: 'completed',
              source: 'codex',
              params: { target: 'app-state.spec.ts' },
            }),
            input: {
              cwd: '/workspace/project',
              commandActions: [{ type: 'read', name: 'app-state.spec.ts', path: 'tests/app-state.spec.ts' }],
            },
          }],
        }],
        modelValue: '',
        openConversationLink,
      },
    });

    const target = wrapper.get('.chat-tool-call__title-target--link');
    await target.trigger('click');
    const expected = {
      action: 'read',
      filepath: '/workspace/project/tests/app-state.spec.ts',
      href: '/workspace/project/tests/app-state.spec.ts',
      itemId: 'read-file',
      kind: 'file',
      messageId: 'assistant-file-tool',
      path: '/workspace/project/tests/app-state.spec.ts',
      turnId: 'turn-file-tool',
    };
    expect(wrapper.emitted('openLink')).toStrictEqual([[expected]]);
    expect(openConversationLink).toHaveBeenCalledWith(expected);
  });

  it.each(['javascript:alert(1)', 'data:text/html,boom', '\\\\server\\share\\file.ts'])('blocks unsupported link %s without delegating it', async (href) => {
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
      slots: { message: () => h('a', { class: 'test-link', href }, 'Open') },
    });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.get('.test-link').element.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted('openLink')).toBeUndefined();
  });

  it('routes a minimal presentation through messages, shelf, and composer', () => {
    const toolSlot = vi.fn(() => h('div', { class: 'custom-tool' }, 'Custom tool'));
    const wrapper = mount(CodexConversationPane, {
      props: {
        contextUsage: {
          cachedInputTokens: 10_000,
          inputTokens: 40_000,
          lastTotalTokens: 50_000,
          modelContextWindow: 200_000,
          outputTokens: 8_000,
          reasoningOutputTokens: 2_000,
          totalTokens: 50_000,
          usedPercent: 25,
        },
        goal: {
          threadId: 'thread-1', objective: 'Ship it', status: 'active', tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0,
        },
        messages: [{
          id: 'assistant-tools',
          role: 'assistant',
          content: 'Visible before.<tool id="tool-1"></tool>Visible after.',
          toolCalls: [{
            args: {}, done: true, function: 'shell', id: 'tool-1', result: 'ok', state: 'completed',
          }],
        }],
        modelValue: '',
        presentation: {
          composer: { actionMenu: false, contextUsage: false, voice: false },
          shelf: { goal: false, queuedPrompts: false, turnGitDiff: false },
          messages: {
            actions: { copy: false, delete: false, edit: false, quote: false, retry: false },
            toolBlocks: false,
          },
        },
        queuedPrompts: [{ id: 'prompt-1', text: 'Run the tests' }],
        transcribeAudio: vi.fn(async () => ({ text: 'hello' })),
        turnGitDiff: {
          turnId: 'turn-1', addedLines: 5, removedLines: 2, updatedAt: '2026-06-11T10:00:00.000Z',
        },
      },
      slots: { 'message-tool': toolSlot },
    });

    expect(wrapper.text()).toContain('Visible before.');
    expect(wrapper.text()).toContain('Visible after.');
    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
    expect(wrapper.find('.chat-tool-group').exists()).toBe(false);
    expect(toolSlot).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Quote"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(false);
    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(false);
    expect(wrapper.find('.chat-composer-action-menu__root').exists()).toBe(false);
    expect(wrapper.find('.chat-context-usage').exists()).toBe(false);
    expect(wrapper.find('.chat-composer__voice').exists()).toBe(false);
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(true);
    expect(wrapper.find('.chat-composer__send').exists()).toBe(true);
  });

  it('passes typed message tool and action slots through the whole pane', () => {
    const wrapper = mount(CodexConversationPane, {
      props: {
        messages: [{
          role: 'assistant',
          content: '<tool id="tool-1"></tool>',
          toolCalls: [{ args: {}, done: true, function: 'shell', id: 'tool-1', result: 'ok', state: 'completed' }],
        }],
        modelValue: '',
      },
      slots: {
        'message-actions': ({ index }: { index: number }) => h('button', { class: 'custom-message-action' }, `Action ${index}`),
        'message-tool': ({ toolCall, toolCalls }: { toolCall?: { function: string }; toolCalls?: Array<{ function: string }> }) => h('div', { class: 'custom-tool' }, toolCall?.function ?? toolCalls?.[0]?.function),
      },
    });

    expect(wrapper.get('.custom-tool').text()).toBe('shell');
    expect(wrapper.get('.custom-message-action').text()).toBe('Action 0');
  });

  it('forwards the additive message-header slot without replacing SDK message rendering', () => {
    const wrapper = mount(CodexConversationPane, {
      props: { messages, modelValue: '' },
      slots: {
        'message-header': ({ message, index }: { message: { id?: string }; index: number }) => (
          h('div', { class: 'custom-message-header' }, `${message.id}:${index}`)
        ),
      },
    });

    expect(wrapper.get('.custom-message-header').text()).toBe('assistant-1:0');
    expect(wrapper.text()).toContain('Ready to build');
    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);
  });
});

function composerEditor(wrapper: VueWrapper) {
  return wrapper.get<HTMLElement>('.chat-rich-text-editor');
}

function composerValue(wrapper: VueWrapper): string {
  return (wrapper.findComponent(CodexRichTextEditor).vm as unknown as CodexRichTextEditorExpose).readText();
}

function composerProps(wrapper: VueWrapper): Record<string, unknown> {
  return (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).props() as Record<string, unknown>;
}

async function setComposerText(wrapper: VueWrapper, value: string): Promise<void> {
  composerEditor(wrapper).element.textContent = value;
  await composerEditor(wrapper).trigger('input');
  await nextTick();
}

function emitPaneActionTable(
  wrapper: VueWrapper,
  options: {
    composerState: { text: string; selectionStart: number; selectionEnd: number };
    edit: { content: string; turnId: string };
    response: { id: string; payload: { decision: string } };
  },
): void {
  const messageList = wrapper.findComponent(CodexMessageList);
  messageList.vm.$emit('cancel');
  messageList.vm.$emit('client-response', options.response);
  messageList.vm.$emit('copy-message', 1);
  messageList.vm.$emit('delete-turn', 'turn-2');
  messageList.vm.$emit('edit-turn', options.edit);
  messageList.vm.$emit('fork-turn', 'turn-4');
  messageList.vm.$emit('retry-turn', 'turn-5');
  messageList.vm.$emit('send-follow-up', 'Continue with tests');
  wrapper.findComponent(ChatComposerShelf).vm.$emit('clearGoal');
  (wrapper.findComponent(CodexComposer) as unknown as VueWrapper).vm
    .$emit('update:composerState', options.composerState);
}

function emitComposerActionTable(wrapper: VueWrapper): void {
  const composer = wrapper.findComponent(CodexComposer) as unknown as VueWrapper;
  composer.vm.$emit('interrupt');
  composer.vm.$emit('selectApprovalPreset', 'full-access');
  composer.vm.$emit('update:modelId', 'gpt-routing');
  composer.vm.$emit('update:planMode', true);
  composer.vm.$emit('update:reasoningEffort', 'high');
  composer.vm.$emit('update:serviceTier', 'priority');
  composer.vm.$emit('menuSelect', routingMenuItem);
  composer.vm.$emit('mentionSelect', routingMentionGroup.items[0], routingMentionGroup);
}

function fakeSurfaceController(): CodexSurfaceController & { state: CodexSurfaceSnapshot } {
  const state = reactive<CodexSurfaceSnapshot>({
    status: 'idle',
    authentication: {
      status: 'notLoaded',
      account: null,
      requiresOpenaiAuth: null,
      error: null,
      login: { status: 'idle', loginId: null, authUrl: null, error: null },
    },
    conversations: [],
    activeConversationId: null,
    activeTurnId: null,
    turns: [],
    messages: [],
    clientRequests: [],
    answeredClientRequestIds: [],
    approvals: [],
    models: [],
    modelCatalogStatus: 'loaded',
    skills: [],
    skillCatalogStatus: 'loaded',
    plugins: [],
    pluginCatalogStatus: 'loaded',
    permissionProfiles: [],
    approvalPresets: [],
    approvalPreset: null,
    selectedModelId: null,
    selectedReasoningEffort: null,
    planMode: false,
    contextUsage: null,
    goal: null,
    turnGitDiff: null,
    threadStatus: null,
    rateLimits: null,
    queuedPrompts: [],
    busy: false,
    historyLoading: false,
    error: null,
  });
  const snapshot = () => structuredClone(state);
  const connect = vi.fn(async () => {
    state.status = 'ready';
    state.activeConversationId = 'thread-bound';
    state.messages = [{
      id: 'bound-message',
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'Bound controller message' }],
    }];
    return snapshot();
  });
  const sendMessage = vi.fn(async (prompt: string) => {
    if (/^\/plan(?:\s|$)/.test(prompt.trim())) state.planMode = true;
    return snapshot();
  });
  const updateConversationSettings = vi.fn(async (settings: { planMode?: boolean }) => {
    if (typeof settings.planMode === 'boolean') state.planMode = settings.planMode;
    return snapshot();
  });
  const action = vi.fn(async () => snapshot());
  return {
    state,
    answeredClientRequestIds: new Set<string>(),
    clearGoal: action,
    compactConversation: action,
    continueInterruptedTurn: action,
    connect,
    createConversation: action,
    deleteTurn: action,
    deleteQueuedPrompt: action,
    editTurn: action,
    interrupt: action,
    listConversations: vi.fn(async () => []),
    loadOlderConversationHistory: action,
    readConversationHistory: vi.fn(async () => ({
      conversationId: 'thread-bound', messages: [], threadStatus: null,
    })),
    readConversationPromptHistory: vi.fn(async () => ({
      conversationId: 'thread-bound', prompts: ['Earlier prompt'],
    })),
    refreshConversations: action,
    renameConversation: action,
    respondToClientRequest: action,
    resolveApproval: action,
    retryTurn: action,
    selectConversation: action,
    sendMessage,
    setGoal: action,
    startReview: action,
    steerMessage: action,
    steerQueuedPrompt: action,
    updateConversationSettings,
  } as unknown as CodexSurfaceController & { state: CodexSurfaceSnapshot };
}
