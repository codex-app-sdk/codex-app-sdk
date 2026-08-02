// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { toRaw } from 'vue';
import CodexMessageList from '../../src/vue/components/CodexMessageList.vue';
import CodexMessage from '../../src/vue/components/CodexMessage.vue';
import type { Message } from '../../src/vue/chat/types';
import type { SurfaceMessage } from '../../src/surface/types';

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

describe('CodexMessageList', () => {
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
    scrollEl.scrollTop = 100;

    await wrapper.get('.message-list').trigger('scroll');

    expect(scrollEl.scrollTop).toBe(100);
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
