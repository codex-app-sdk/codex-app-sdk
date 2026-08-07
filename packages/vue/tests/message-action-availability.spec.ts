// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { CodexConversationPane, CodexMessage, type SurfaceMessage } from '../src';

const messages: SurfaceMessage[] = [
  {
    id: 'user-complete',
    role: 'user',
    status: 'complete',
    parts: [{ type: 'text', text: 'Run the tests.' }],
  },
  {
    id: 'assistant-complete',
    role: 'assistant',
    status: 'complete',
    parts: [{ type: 'text', text: 'The earlier result.' }],
  },
  {
    id: 'assistant-streaming',
    role: 'assistant',
    status: 'streaming',
    parts: [{ type: 'text', text: 'Working…' }],
  },
];

describe('message action availability while busy', () => {
  it('keeps completed actions visible but disables thread mutations', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { busy: true, canForkMessage: true, messages, modelValue: '' },
    });
    const renderedMessages = wrapper.findAllComponents(CodexMessage);
    const user = renderedMessages[0]!;
    const assistant = renderedMessages[1]!;
    const streaming = renderedMessages[2]!;

    for (const action of ['Fork', 'Delete']) {
      const button = user.get(`[aria-label="${action}"]`);
      expect(button.attributes()).toHaveProperty('disabled');
      expect(button.classes()).toContain('chat-icon-button--disabled');
    }
    expect(user.get('[aria-label="Copy"]').attributes()).not.toHaveProperty('disabled');
    expect(user.get('[aria-label="Quote"]').attributes()).not.toHaveProperty('disabled');

    for (const action of ['Retry', 'Fork', 'Delete']) {
      const button = assistant.get(`[aria-label="${action}"]`);
      expect(button.attributes()).toHaveProperty('disabled');
      expect(button.classes()).toContain('chat-icon-button--disabled');
    }
    expect(assistant.get('[aria-label="Copy"]').attributes()).not.toHaveProperty('disabled');
    expect(streaming.get('.chat-message__actions').attributes('aria-hidden')).toBe('true');

    await assistant.get('[aria-label="Fork"]').trigger('click');
    expect(wrapper.emitted('forkMessage')).toBeUndefined();

    await wrapper.setProps({ busy: false });
    expect(assistant.get('[aria-label="Retry"]').attributes()).not.toHaveProperty('disabled');
    expect(assistant.get('[aria-label="Fork"]').attributes()).not.toHaveProperty('disabled');
    expect(assistant.get('[aria-label="Delete"]').attributes()).not.toHaveProperty('disabled');
  });
});
