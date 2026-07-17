// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { CodexMessageList, type SurfaceMessage } from '../../src/vue';

const messages: SurfaceMessage[] = [{
  id: 'user-1',
  role: 'user',
  status: 'complete',
  parts: [{ type: 'text', text: 'Build a surface' }],
}];
const incomingMessage: SurfaceMessage = {
  id: 'assistant-1',
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'Surface built' }],
};

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
    await nextTick();
    list.scrollTop = 100;
    await wrapper.get('.codex-message-list').trigger('scroll');
    expect(wrapper.emitted('stickinessChange')).toContainEqual([false]);

    await wrapper.setProps({
      messages: [...messages, incomingMessage],
    });
    await nextTick();
    expect(list.scrollTop).toBe(100);
    expect(wrapper.emitted('stickinessChange')).toStrictEqual([[false]]);

    (wrapper.vm as unknown as { scrollToBottom(): void }).scrollToBottom();
    await nextTick();
    expect(list.scrollTop).toBe(400);
    expect(wrapper.emitted('stickinessChange')).toStrictEqual([[false], [true]]);
  });
});
