// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatToolGroup from '../../src/chat/ChatToolGroup.vue';
import type { MessageToolCall } from '../../src/chat/types';

const completedTool: MessageToolCall = {
  args: { command: 'npm test' },
  done: true,
  function: 'npm test',
  id: 'completed-tool',
  result: 'passed',
  state: 'completed',
  status: JSON.stringify({
    source: 'codex',
    action: 'run',
    phase: 'completed',
    params: { target: 'npm test' },
  }),
};

const runningTool: MessageToolCall = {
  args: { command: 'git status' },
  done: false,
  function: 'git status',
  id: 'transitioning-tool',
  result: undefined,
  state: 'running',
  status: JSON.stringify({
    source: 'codex',
    action: 'run',
    phase: 'running',
    params: { target: 'git status' },
  }),
};

const newlyCompletedTool: MessageToolCall = {
  ...runningTool,
  done: true,
  result: 'clean',
  state: 'completed',
  status: JSON.stringify({
    source: 'codex',
    action: 'run',
    phase: 'completed',
    params: { target: 'git status' },
  }),
};

const TransitionGroupStub = defineComponent({
  emits: ['after-leave'],
  template: '<div><slot /></div>',
});

describe('ChatToolGroup recent completions', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps a newly completed tool below a collapsed header for 3 seconds and finishes its leave transition', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool, runningTool] },
      global: { stubs: { 'transition-group': TransitionGroupStub } },
    });

    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Running git status');

    await wrapper.setProps({ toolCalls: [completedTool, newlyCompletedTool] });

    expect(wrapper.get('.chat-tool-group__title').text()).toBe('2 actions done');
    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Ran git status');

    await vi.advanceTimersByTimeAsync(2_999);
    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Ran git status');

    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.get('.chat-tool-group__running').text()).not.toContain('Ran git status');

    wrapper.getComponent(TransitionGroupStub).vm.$emit('after-leave');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.chat-tool-group__running').exists()).toBe(false);
  });

  it('moves a newly completed tool directly into an expanded group without duplication', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool, runningTool] },
    });
    await wrapper.get('.chat-tool-group__header').trigger('click');

    await wrapper.setProps({ toolCalls: [completedTool, newlyCompletedTool] });

    expect(wrapper.get('.chat-tool-group__body').findAll('.chat-tool-call')).toHaveLength(2);
    expect(wrapper.find('.chat-tool-group__running').exists()).toBe(false);
  });

  it('does not duplicate a single completed tool that becomes the group header', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [runningTool] },
    });

    await wrapper.setProps({ toolCalls: [newlyCompletedTool] });

    expect(wrapper.get('.chat-tool-group__header').text()).toContain('Ran git status');
    expect(wrapper.find('.chat-tool-group__running').exists()).toBe(false);
  });
});
