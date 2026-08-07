// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, reactive } from 'vue';
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
  type CodexSurfaceController,
  type SurfaceMessage,
} from '../../packages/vue/src';
import type { CodexSurfaceSnapshot } from '../../src/surface';
import type { Message } from '../../packages/vue/src/chat/types';

const messages: SurfaceMessage[] = [{
  id: 'assistant-1',
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'Ready to build' }],
}];

describe('CodexConversationPane', () => {
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

    const olderBatches = Array.from({ length: 15 }, (_, index) => makeMessages(75 - index * 20, 20));
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
  }, 30000);

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
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { messages, modelValue: 'Profile this conversation' },
    });

    (wrapper.vm as unknown as { focusComposer(): void }).focusComposer();
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

    await wrapper.setProps({ busy: true, modelValue: '' });
    await wrapper.get('button[aria-label="Codex is working"]').trigger('click');
    expect(wrapper.emitted('interrupt')).toHaveLength(1);
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
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });

    pane.element.dispatchEvent(paste);
    pane.element.dispatchEvent(drop);
    await wrapper.vm.$nextTick();

    expect(paste.defaultPrevented).toBe(true);
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
  });

  it('binds directly to a surface controller while preserving controlled mode overrides', async () => {
    const controller = fakeSurfaceController();
    const wrapper = mount(CodexConversationPane, { props: { surface: controller } });

    await vi.waitFor(() => expect(controller.connect).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(wrapper.text()).toContain('Bound controller message'));
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
          canDeleteMessage: false,
          canEditMessage: false,
          canRetryMessage: false,
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

async function setComposerText(wrapper: VueWrapper, value: string): Promise<void> {
  composerEditor(wrapper).element.textContent = value;
  await composerEditor(wrapper).trigger('input');
  await nextTick();
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
    connect,
    createConversation: action,
    deleteMessage: action,
    deleteQueuedPrompt: action,
    editMessage: action,
    interrupt: action,
    listConversations: vi.fn(async () => []),
    readConversationHistory: vi.fn(async () => ({
      conversationId: 'thread-bound', messages: [], threadStatus: null,
    })),
    refreshConversations: action,
    renameConversation: action,
    respondToClientRequest: action,
    resolveApproval: action,
    retryMessage: action,
    selectConversation: action,
    sendMessage,
    setGoal: action,
    startReview: action,
    steerMessage: action,
    steerQueuedPrompt: action,
    updateConversationSettings,
  } as unknown as CodexSurfaceController & { state: CodexSurfaceSnapshot };
}
