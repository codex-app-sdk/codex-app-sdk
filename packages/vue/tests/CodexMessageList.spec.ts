// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { toRaw } from 'vue';
import CodexMessageList from '../src/components/CodexMessageList.vue';
import CodexMessage from '../src/components/CodexMessage.vue';
import type { Message } from '../src/chat/types';
import type { SurfaceMessage } from '@codex-app-sdk/core/surface';

const messages: Message[] = [
  {
    id: 'user-1',
    role: 'user',
    content: 'Please inspect the composer.',
    createdAt: '2026-06-05T00:00:00.000Z',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: 'I am checking it now.\n\n- first\n- second\n\n<follow-up>Open the failing file</follow-up>',
    streaming: true,
    createdAt: '2026-06-05T00:00:01.000Z',
    toolCalls: [
      {
        args: { output: 'vitest started' },
        done: false,
        function: 'npm test',
        id: 'tool-1',
        result: 'vitest started',
        state: 'running',
        status: 'running',
      },
    ],
  },
];

function makeMessages(count: number, offset = 0): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${offset + index}`,
    role: 'user' as const,
    content: `Message ${offset + index}`,
    createdAt: `2026-06-05T00:00:${String(index).padStart(2, '0')}.000Z`,
  }));
}

describe('CodexMessageList', () => {
  it('keeps the thinking shimmer visible while a busy turn has no assistant row yet', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        busy: true,
        messages: [messages[0]!],
      },
    });

    expect(wrapper.get('.chat-message__thinking').classes()).toContain('codex-text-shimmer');
    expect(wrapper.text()).toContain('Thinking');

    await wrapper.setProps({ busy: false });
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
  });

  it('keeps a running compaction marker visible instead of adding a thinking row', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        busy: true,
        messages: [{
          id: 'compaction-1',
          role: 'assistant',
          content: '',
          type: 'compaction',
          compactionStatus: 'running',
        }],
      },
    });

    expect(wrapper.get('.chat-message--compaction-running')).toBeTruthy();
    expect(wrapper.text()).toContain('Compacting context');
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
  });

  it('renders user text, markdown, streaming assistant state, follow-ups, and tool groups', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages,
      },
    });

    expect(wrapper.text()).toContain('Please inspect the composer.');
    expect(wrapper.text()).toContain('I am checking it now.');
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.text()).toContain('Open the failing file');
    expect(wrapper.text()).toContain('npm test');
    expect(wrapper.text()).not.toContain('vitest started');
    expect(wrapper.find('.chat-message__stream-dot').exists()).toBe(true);
  });

  it('passes surface messages to keyed rows without eagerly projecting the full transcript', () => {
    const surfaceMessage: SurfaceMessage = {
      id: 'surface-user',
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text: 'Keep this object stable.' }],
    };
    const wrapper = mount(CodexMessageList, { props: { messages: [surfaceMessage] } });

    expect(toRaw(wrapper.getComponent(CodexMessage).props('message'))).toBe(surfaceMessage);
    expect(wrapper.text()).toContain('Keep this object stable.');
  });

  it('only exposes tool input and output when explicitly enabled', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages,
        showToolDetails: true,
      },
    });

    await wrapper.get('.chat-tool-group__running .chat-tool-call__header').trigger('click');

    expect(wrapper.text()).toContain('vitest started');
  });

  it('renders steered conversation markers between messages', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [
          messages[1]!,
          {
            id: 'steer-1',
            role: 'user',
            content: 'read every markdown file',
            createdAt: '2026-06-05T00:00:02.000Z',
            type: 'steer',
          },
        ],
      },
    });

    expect(wrapper.text()).toContain('Steered conversation');
    expect(wrapper.text()).toContain('read every markdown file');
    expect(wrapper.find('.chat-message--steer').exists()).toBe(true);
  });

  it('keeps actions visible on the latest completed assistant message only', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [
          { role: 'assistant', content: 'Earlier answer' },
          { role: 'user', content: 'Follow up' },
          { role: 'assistant', content: 'Latest answer' },
        ],
      },
    });

    const rows = wrapper.findAll('.chat-message');
    expect(rows[0]?.classes()).not.toContain('chat-message--actions-visible');
    expect(rows[2]?.classes()).toContain('chat-message--actions-visible');
  });

  it('forwards provider capability flags to message actions', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        canDeleteMessage: false,
        canEditMessage: false,
        canRetryMessage: false,
        messages,
      },
    });

    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Quote"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Edit"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false);
  });

  it('routes conversation presentation to message actions and tool blocks', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages,
        presentation: {
          messages: {
            actions: { copy: false, delete: false, edit: false, quote: false, retry: false },
            toolBlocks: false,
          },
        },
      },
    });

    expect(wrapper.text()).toContain('Please inspect the composer.');
    expect(wrapper.text()).toContain('I am checking it now.');
    expect(wrapper.find('.chat-tool-group').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Quote"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false);
  });

  it('opts out of lazy rendering with an explicit false value', () => {
    const allMessages = makeMessages(75);
    const defaultWrapper = mount(CodexMessageList, { props: { lazyMessages: false, messages: allMessages } });
    const lazyWrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 20, messages: allMessages },
    });

    expect(defaultWrapper.findAll('.chat-message')).toHaveLength(75);
    expect(lazyWrapper.findAll('.chat-message')).toHaveLength(20);
    expect(lazyWrapper.text()).not.toContain('Message 0');
    expect(lazyWrapper.text()).toContain('Message 74');
  });

  it('mounts 50 messages initially and reveals 25 more per upward batch by default', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { messages: makeMessages(80) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    expect(wrapper.findAll('.chat-message')).toHaveLength(50);
    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAll('.chat-message')).toHaveLength(75);
    expect(wrapper.findAllComponents(CodexMessage)[0]?.props('index')).toBe(5);
    expect(wrapper.findAllComponents(CodexMessage).at(-1)?.props('index')).toBe(79);
    wrapper.unmount();
  });

  it('transforms only the mounted lazy batch and preserves absolute indexes', () => {
    const allMessages = makeMessages(75);
    const transformMessage = vi.fn((message: Message | SurfaceMessage, index: number) => ({
      ...message,
      content: `Transformed ${index}`,
    }));
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 20, messages: allMessages, transformMessage },
    });

    expect(transformMessage).toHaveBeenCalledTimes(20);
    expect(transformMessage.mock.calls.map(([, index]) => index)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 55),
    );
    const renderedRows = wrapper.findAllComponents(CodexMessage);
    expect(renderedRows[0]?.props('index')).toBe(55);
    expect(renderedRows.at(-1)?.props('index')).toBe(74);
    expect(wrapper.text()).toContain('Transformed 74');
  });

  it('transforms a prepended lazy batch when it becomes visible', async () => {
    const allMessages = makeMessages(25);
    const transformMessage = vi.fn((message: Message | SurfaceMessage, index: number) => ({
      ...message,
      content: `Transformed ${index}`,
    }));
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 10, messages: allMessages, transformMessage },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    transformMessage.mockClear();

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.findAllComponents(CodexMessage)[0]?.props('index')).toBe(5);
    expect(transformMessage).toHaveBeenCalled();
    expect(transformMessage.mock.calls.map(([, index]) => index)).toEqual(
      expect.arrayContaining(Array.from({ length: 10 }, (_, index) => index + 5)),
    );
    expect(transformMessage.mock.calls.every(([, index]) => index >= 5 && index < 25)).toBe(true);
    expect(wrapper.text()).toContain('Transformed 5');
    wrapper.unmount();
  });

  it('keeps prepended history outside the lazy window until the user scrolls up', async () => {
    const currentMessages = makeMessages(10);
    const firstOlderMessages = makeMessages(10, -10);
    const secondOlderMessages = makeMessages(10, -20);
    const olderMessages = [...secondOlderMessages, ...firstOlderMessages];
    const transformMessage = vi.fn((message: Message | SurfaceMessage) => message);
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 10, messages: currentMessages, transformMessage },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    transformMessage.mockClear();

    await wrapper.setProps({ messages: [...firstOlderMessages, ...currentMessages] });

    const prependedIds = new Set(olderMessages.map((message) => message.id));
    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toEqual(
      currentMessages.map((message) => message.id),
    );
    expect(transformMessage.mock.calls.every(([message]) => !prependedIds.has(message.id))).toBe(true);

    await wrapper.setProps({ messages: [...secondOlderMessages, ...firstOlderMessages, ...currentMessages] });

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toEqual(
      currentMessages.map((message) => message.id),
    );
    expect(transformMessage.mock.calls.every(([message]) => !prependedIds.has(message.id))).toBe(true);

    scrollEl.scrollTop = 500;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();
    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)[0]?.props('message').id).toBe(firstOlderMessages[0]!.id);
    expect(transformMessage.mock.calls.some(([message]) => firstOlderMessages.some((older) => older.id === message.id))).toBe(true);

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)[0]?.props('message').id).toBe(secondOlderMessages[0]!.id);
    expect(transformMessage.mock.calls.some(([message]) => secondOlderMessages.some((older) => older.id === message.id))).toBe(true);
    wrapper.unmount();
  });

  it('does not let a stale historical streaming row expand the lazy window', () => {
    const allMessages = makeMessages(75);
    allMessages[0] = { ...allMessages[0]!, role: 'assistant', streaming: true };
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 20, messages: allMessages },
    });

    expect(wrapper.text()).not.toContain('Message 0');
    expect(wrapper.findAll('.chat-message')).toHaveLength(20);
  });

  it('keeps a current tail streaming message mounted in a lazy window', () => {
    const allMessages = makeMessages(75);
    allMessages[74] = { ...allMessages[74]!, role: 'assistant', streaming: true };
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 20, messages: allMessages },
    });

    expect(wrapper.text()).toContain('Message 74');
    expect(wrapper.findAll('.chat-message')).toHaveLength(20);
  });

  it('prepends older lazy batches while preserving the visible scroll anchor', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 10, messages: makeMessages(25) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAll('.chat-message')).toHaveLength(20);
    expect(wrapper.text()).toContain('Message 5');
    expect(wrapper.text()).not.toContain('Message 4');
    expect(scrollEl.scrollTop).toBe(1_000);
    wrapper.unmount();
  });

  it('keeps a lazy transcript at the bottom when appending at the bottom', async () => {
    const allMessages = makeMessages(15);
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 5, messages: allMessages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });

    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.setProps({ messages: [...allMessages, makeMessages(1, 15)[0]!] });
    await flushPromises();

    expect(wrapper.text()).toContain('Message 15');
    expect(wrapper.text()).not.toContain('Message 10');
    expect(scrollEl.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it('uses viewport geometry when stickiness is stale during a prepend', async () => {
    const currentMessages = makeMessages(50);
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 50, messages: currentMessages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100 + 300,
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight - 100;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('stickiness-change')).toContainEqual([false]);

    scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    await wrapper.setProps({ messages: [...makeMessages(10, -10), ...currentMessages] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(50);
    expect(wrapper.findAllComponents(CodexMessage)[0]?.props('message').id).toBe(currentMessages[0]!.id);
    wrapper.unmount();
  });

  it('does not jump to the bottom when appending while scrolled away', async () => {
    const allMessages = makeMessages(15);
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 5, messages: allMessages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('stickiness-change')).toContainEqual([false]);

    await wrapper.setProps({ messages: [...allMessages, makeMessages(1, 15)[0]!] });
    await flushPromises();

    expect(wrapper.text()).toContain('Message 15');
    expect(scrollEl.scrollTop).toBe(100);
    wrapper.unmount();
  });

  it('resets the lazy window when the conversation key changes', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messageBatchSize: 5, messages: makeMessages(15), resetKey: 'thread-a' },
    });

    await wrapper.setProps({ messages: makeMessages(8, 100), resetKey: 'thread-b' });
    await flushPromises();

    expect(wrapper.text()).toContain('Message 107');
    expect(wrapper.text()).not.toContain('Message 100');
  });

  it('forwards message action events from chat messages', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages,
      },
    });
    const chatMessage = wrapper.getComponent(CodexMessage);
    const clientResponse = { id: 'approval-1', payload: { decision: 'allow' } };
    const editPayload = { content: 'Updated prompt', index: 0 };

    chatMessage.vm.$emit('cancel');
    chatMessage.vm.$emit('client-response', clientResponse);
    chatMessage.vm.$emit('copy-message', 0);
    chatMessage.vm.$emit('delete-message', 0);
    chatMessage.vm.$emit('edit-message', editPayload);
    chatMessage.vm.$emit('quote-message', 0);
    chatMessage.vm.$emit('retry-message', 1);
    chatMessage.vm.$emit('send-follow-up', 'Open the failing file');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(wrapper.emitted('client-response')).toStrictEqual([[clientResponse]]);
    expect(wrapper.emitted('copy-message')).toStrictEqual([[0]]);
    expect(wrapper.emitted('delete-message')).toStrictEqual([[0]]);
    expect(wrapper.emitted('edit-message')).toStrictEqual([[editPayload]]);
    expect(wrapper.emitted('quote-message')).toStrictEqual([[0]]);
    expect(wrapper.emitted('retry-message')).toStrictEqual([[1]]);
    expect(wrapper.emitted('send-follow-up')).toStrictEqual([['Open the failing file']]);
  });

  it('keeps the transcript stuck to the bottom when messages are appended', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: messages.slice(0, 1),
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });

    await (wrapper as unknown as { setProps: (props: { messages: Message[] }) => Promise<void> }).setProps({ messages });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it('keeps the transcript stuck to the bottom when a streaming row changes', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { messages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    scrollEl.scrollTop = 0;

    await wrapper.setProps({
      messages: [messages[0]!, { ...messages[1]!, content: `${messages[1]!.content}\nStill working.` }],
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scrollEl.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it('follows late transcript layout growth after the initial history render', async () => {
    let notifyResize: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void { disconnect(); }
    });
    const wrapper = mount(CodexMessageList, {
      props: { messages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollHeight = 300;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();

    scrollHeight = 1_200;
    notifyResize();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(scrollEl.scrollTop).toBe(1_200);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('updates stickiness when the transcript scrolls', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages,
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 100;

    await wrapper.get('.message-list').trigger('scroll');

    expect(scrollEl.scrollTop).toBe(100);
    wrapper.unmount();
  });

  it('shows a scroll-to-bottom control when the transcript is away from the bottom', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { messages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    scrollEl.scrollTop = 100;

    await wrapper.get('.message-list').trigger('scroll');

    const button = wrapper.get('.codex-message-list__scroll-to-bottom');
    expect(button.attributes('aria-label')).toBe('Scroll to bottom');
    expect(button.element.parentElement).toBe(wrapper.get('.codex-message-list').element);
    await button.trigger('click');
    expect(scrollEl.scrollTop).toBe(900);
    expect(wrapper.find('.codex-message-list__scroll-to-bottom').exists()).toBe(false);
    wrapper.unmount();
  });

  it('resets scroll position when the conversation key changes', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { messages, resetKey: 'thread-a' },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');

    await wrapper.setProps({ resetKey: 'thread-b' });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(900);
    wrapper.unmount();
  });
});
