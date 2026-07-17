// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  CodexComposer,
  CodexComposerSendButton,
  CodexMessage,
  CodexMessageList,
  type SurfaceMessage,
} from '../src/vue';

const messages: SurfaceMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    status: 'complete',
    parts: [{ type: 'text', text: 'Build a surface' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    status: 'streaming',
    parts: [
      { type: 'status', text: 'Working' },
      {
        type: 'tool',
        id: 'tool-1',
        title: 'Inspect repository',
        status: 'running',
        output: { files: 12 },
      },
    ],
  },
];

describe('CodexComposer', () => {
  it('emits trimmed prompts and clears its model', async () => {
    const wrapper = mount(CodexComposer, {
      props: { modelValue: '  hello Codex  ' },
    });

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('submit')).toStrictEqual([['hello Codex']]);
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['']);
  });

  it('updates drafts, preserves shifted newlines, and supports explicit shortcuts', async () => {
    const wrapper = mount(CodexComposer, {
      props: { modelValue: '', submitOnEnter: false },
    });
    await wrapper.get('textarea').setValue('next prompt');
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('submit')).toBeUndefined();

    await wrapper.setProps({ modelValue: 'next prompt' });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true });
    expect(wrapper.emitted('submit')).toStrictEqual([['next prompt']]);
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['next prompt']);
  });

  it('switches the action to interrupt while busy and respects disabled state', async () => {
    const wrapper = mount(CodexComposer, {
      props: { busy: true, modelValue: '', interruptLabel: 'Stop agent' },
    });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Stop agent');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('interrupt')).toHaveLength(1);

    await wrapper.setProps({ disabled: true });
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('exposes focus and blocks empty or composing submissions', async () => {
    const wrapper = mount(CodexComposer, { props: { modelValue: '   ' } });
    const focus = vi.spyOn(wrapper.get('textarea').element, 'focus');
    (wrapper.vm as unknown as { focus(): void }).focus();
    expect(focus).toHaveBeenCalledOnce();

    await wrapper.get('form').trigger('submit');
    await wrapper.setProps({ modelValue: 'composing' });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.emitted('submit')).toBeUndefined();
  });
});

describe('CodexComposerSendButton', () => {
  it('renders submit and busy states and emits clicks', async () => {
    const wrapper = mount(CodexComposerSendButton, { props: { submitLabel: 'Run' } });
    expect(wrapper.attributes('aria-label')).toBe('Run');
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);

    await wrapper.setProps({ busy: true });
    expect(wrapper.find('.codex-composer-send-button__spinner').exists()).toBe(true);
  });
});

describe('CodexMessage', () => {
  it('renders safe text, status, tools, and streaming state', () => {
    const wrapper = mount(CodexMessage, { props: { message: messages[1]! } });

    expect(wrapper.text()).toContain('Working');
    expect(wrapper.text()).toContain('Inspect repository');
    expect(wrapper.text()).toContain('"files": 12');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('[aria-label="Streaming"]').exists()).toBe(true);
  });

  it('supports product-specific rendering through typed slots', () => {
    const wrapper = mount(CodexMessage, {
      props: { message: messages[0]! },
      slots: {
        text: ({ part }: { part: { text: string } }) => `CUSTOM ${part.text}`,
      },
    });
    expect(wrapper.text()).toBe('CUSTOM Build a surface');
  });
});

describe('CodexMessageList', () => {
  it('renders default messages and an empty state', async () => {
    const wrapper = mount(CodexMessageList, { props: { messages } });
    expect(wrapper.text()).toContain('Build a surface');
    await wrapper.setProps({ messages: [] });
    expect(wrapper.text()).toContain('No messages yet');
  });

  it('supports custom message types through its scoped slot', () => {
    const wrapper = mount(CodexMessageList, {
      props: { messages: [{ id: 'custom-1', label: 'Custom renderer' }] },
      slots: {
        message: ({ message }: { message: { id?: string | number } }) => (
          message as { label: string }
        ).label,
      },
    });
    expect(wrapper.text()).toContain('Custom renderer');
  });

  it('tracks user stickiness and exposes an explicit scroll action', async () => {
    const wrapper = mount(CodexMessageList, { props: { messages } });
    const list = wrapper.get('.codex-message-list').element as HTMLElement;
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
    });
    list.scrollTop = 100;
    await wrapper.get('.codex-message-list').trigger('scroll');
    expect(wrapper.emitted('stickinessChange')).toContainEqual([false]);

    (wrapper.vm as unknown as { scrollToBottom(): void }).scrollToBottom();
    await nextTick();
    expect(list.scrollTop).toBe(400);
    expect(wrapper.emitted('stickinessChange')).toContainEqual([true]);
  });
});
