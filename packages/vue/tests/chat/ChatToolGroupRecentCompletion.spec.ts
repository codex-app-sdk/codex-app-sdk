// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
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

const FoldTransitionStub = defineComponent({
  template: '<div><slot /></div>',
});

const ToolCallStub = defineComponent({
  emits: ['cancel', 'client-response', 'open-link'],
  props: {
    summaryOnly: Boolean,
    toolCall: { type: Object, required: true },
  },
  setup(props) {
    return () => h('div', {
      class: 'tool-call-stub',
      'data-summary-only': String(props.summaryOnly),
      'data-tool-id': (props.toolCall as MessageToolCall).id,
    });
  },
});

describe('ChatToolGroup recent completions', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps an empty group static and does not create an empty status region', async () => {
    const wrapper = mount(ChatToolGroup, { props: { toolCalls: [] } });
    const header = wrapper.get('.chat-tool-group__header');

    expect(header.element.tagName).toBe('DIV');
    expect(header.classes()).toContain('chat-tool-group__header--static');
    expect(wrapper.find('.chat-tool-group__running').exists()).toBe(false);
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');

    await header.trigger('click');
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');
  });

  it('expands multiple tools or a single tool with an enabled input or result', async () => {
    const noDetails = { ...completedTool, args: undefined, result: undefined };
    const disabled = mount(ChatToolGroup, {
      props: { showToolDetails: false, toolCalls: [completedTool] },
    });
    expect(disabled.get('.chat-tool-group__header').element.tagName).toBe('DIV');

    const empty = mount(ChatToolGroup, {
      props: { showToolDetails: true, toolCalls: [noDetails] },
    });
    expect(empty.get('.chat-tool-group__header').element.tagName).toBe('DIV');

    const nullResult = mount(ChatToolGroup, {
      props: {
        showToolDetails: true,
        toolCalls: [{ ...noDetails, result: null }],
      },
    });
    expect(nullResult.get('.chat-tool-group__header').element.tagName).toBe('DIV');

    for (const detailed of [
      { ...noDetails, args: null },
      { ...noDetails, result: false },
    ]) {
      const wrapper = mount(ChatToolGroup, {
        props: { showToolDetails: true, toolCalls: [detailed] },
      });
      const header = wrapper.get('.chat-tool-group__header');
      expect(header.element.tagName).toBe('BUTTON');
    }

    const multiple = mount(ChatToolGroup, {
      props: {
        showToolDetails: false,
        toolCalls: [noDetails, { ...noDetails, id: 'second-tool' }],
      },
    });
    expect(multiple.get('.chat-tool-group__header').element.tagName).toBe('BUTTON');
  });

  it.each([
    { done: false, state: 'running', active: true },
    { done: undefined, state: 'running', active: true },
    { done: true, state: 'running', active: false },
    { done: false, state: 'completed', active: false },
  ] as const)('classifies done=$done and state=$state as active=$active', ({ done, state, active }) => {
    const candidate: MessageToolCall = {
      ...runningTool,
      done,
      id: 'candidate-tool',
      state,
    };
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool, candidate] },
    });
    const runningItems = wrapper.findAll('.chat-tool-group__running-item');

    expect(runningItems.some((item) => item.text().includes('git status'))).toBe(active);
  });

  it('renders an exact singular completed summary beside an active tool', () => {
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool, runningTool] },
    });

    expect(wrapper.get('.chat-tool-group__title').attributes('data-label')).toBe('1 action done');
    expect(wrapper.get('.chat-tool-group__title').text()).toBe('1 action done');
  });

  it('unwraps only active MCP and home confirmations with string request ids', () => {
    const confirmation = (source: string, requestId: unknown, state: MessageToolCall['state'] = 'running') => ({
      ...runningTool,
      state,
      status: JSON.stringify({
        source,
        action: 'run',
        phase: 'running',
        params: { requestId },
      }),
    });

    for (const source of ['mcp', 'home']) {
      const wrapper = mount(ChatToolGroup, {
        props: { toolCalls: [confirmation(source, `${source}-request`)] },
      });
      expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(true);
      expect(wrapper.find('.chat-tool-group').exists()).toBe(false);
    }

    for (const toolCall of [
      confirmation('other', 'request-1'),
      confirmation('mcp', 12),
      confirmation('mcp', undefined),
      {
        ...runningTool,
        status: JSON.stringify({ source: 'mcp', action: 'run', phase: 'running' }),
      },
      confirmation('mcp', 'request-1', 'completed'),
      { ...runningTool, status: 'running' },
    ]) {
      const wrapper = mount(ChatToolGroup, { props: { toolCalls: [toolCall] } });
      expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(false);
      expect(wrapper.find('.chat-tool-group').exists()).toBe(true);
    }

    const mixed = mount(ChatToolGroup, {
      props: {
        toolCalls: [confirmation('mcp', 'request-1'), completedTool],
      },
    });
    expect(mixed.find('.chat-tool-group').exists()).toBe(true);
    expect(mixed.find('.chat-tool-group__header').exists()).toBe(true);
  });

  it('shows a status item that becomes active after the group mounts', async () => {
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool] },
    });
    expect(wrapper.find('.chat-tool-group__running').exists()).toBe(false);

    await wrapper.setProps({ toolCalls: [completedTool, runningTool] });

    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Running git status');
  });

  it('keeps a newly completed tool below a collapsed header for 3 seconds and finishes its leave transition', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool, runningTool] },
      global: { stubs: { 'transition-group': TransitionGroupStub } },
    });

    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Running git status');

    await wrapper.setProps({ toolCalls: [completedTool, newlyCompletedTool] });

    expect(wrapper.get('.chat-tool-group__title').text()).toBe('2 actions done');
    const retained = wrapper.get('.chat-tool-group__running');
    expect(retained.findAll('.chat-tool-group__running-item')).toHaveLength(1);
    expect(retained.text()).toContain('Ran git status');
    expect(retained.text()).not.toContain('Ran npm test');

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

  it('does not retain a running tool that disappears instead of completing', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [runningTool] },
    });

    await wrapper.setProps({ toolCalls: [] });

    expect(wrapper.find('.chat-tool-group__running-item').exists()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears recent completion when a tool resumes and restarts retention on its next completion', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [completedTool, runningTool] },
      global: { stubs: { 'transition-group': TransitionGroupStub } },
    });

    await wrapper.setProps({ toolCalls: [completedTool, newlyCompletedTool] });
    expect(vi.getTimerCount()).toBe(1);

    await wrapper.setProps({ toolCalls: [completedTool, runningTool] });
    expect(vi.getTimerCount()).toBe(0);

    await wrapper.setProps({ toolCalls: [completedTool, newlyCompletedTool] });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Ran git status');
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find('.chat-tool-group__running-item').exists()).toBe(false);
  });

  it('cancels retention immediately when a newly completed tool is removed', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [runningTool] },
    });

    await wrapper.setProps({ toolCalls: [newlyCompletedTool] });
    expect(vi.getTimerCount()).toBe(1);
    await wrapper.setProps({ toolCalls: [] });

    expect(vi.getTimerCount()).toBe(0);
    expect(wrapper.find('.chat-tool-group__running-item').exists()).toBe(false);
  });

  it('cancels every recent-completion timer when unmounted', async () => {
    vi.useFakeTimers();
    const secondRunning = { ...runningTool, id: 'second-running-tool' };
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [runningTool, secondRunning] },
    });

    await wrapper.setProps({
      toolCalls: [
        newlyCompletedTool,
        { ...newlyCompletedTool, id: 'second-running-tool' },
      ],
    });
    expect(vi.getTimerCount()).toBe(2);

    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not hide a nonempty status container after an unrelated leave event', async () => {
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [runningTool] },
      global: { stubs: { 'transition-group': TransitionGroupStub } },
    });

    wrapper.getComponent(TransitionGroupStub).vm.$emit('after-leave');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Running git status');
  });

  it('forwards child actions from confirmation, header, completed, and running tools', async () => {
    const confirmation: MessageToolCall = {
      ...runningTool,
      status: JSON.stringify({
        source: 'mcp',
        action: 'run',
        phase: 'running',
        params: { requestId: 'confirmation-request' },
      }),
    };
    const confirmationWrapper = mountWithToolCallStubs([confirmation]);
    await emitToolActions(confirmationWrapper.getComponent(ToolCallStub), 'confirmation');
    expectForwardedToolActions(confirmationWrapper, ['confirmation']);

    const headerWrapper = mountWithToolCallStubs([completedTool]);
    const headerCalls = headerWrapper.findAllComponents(ToolCallStub);
    expect(headerCalls.map((call) => call.attributes('data-summary-only'))).toContain('true');
    for (const [index, call] of headerCalls.entries()) {
      await emitToolActions(call, `header-${index}`);
    }
    expectForwardedToolActions(headerWrapper, headerCalls.map((_, index) => `header-${index}`));

    const mixedWrapper = mountWithToolCallStubs([completedTool, runningTool]);
    const mixedCalls = mixedWrapper.findAllComponents(ToolCallStub);
    expect(mixedCalls.map((call) => call.attributes('data-tool-id'))).toStrictEqual([
      'completed-tool',
      'transitioning-tool',
    ]);
    for (const [index, call] of mixedCalls.entries()) {
      await emitToolActions(call, `mixed-${index}`);
    }
    expectForwardedToolActions(mixedWrapper, mixedCalls.map((_, index) => `mixed-${index}`));
  });
});

function mountWithToolCallStubs(toolCalls: MessageToolCall[]) {
  return mount(ChatToolGroup, {
    props: { toolCalls },
    global: {
      stubs: {
        ChatFoldTransition: FoldTransitionStub,
        ChatToolCall: ToolCallStub,
        'transition-group': TransitionGroupStub,
      },
    },
  });
}

async function emitToolActions(
  toolCall: Omit<VueWrapper<any>, 'exists'>,
  id: string,
): Promise<void> {
  toolCall.vm.$emit('cancel');
  toolCall.vm.$emit('client-response', { id, payload: { decision: 'allow' } });
  toolCall.vm.$emit('open-link', { href: `https://example.com/${id}`, kind: 'external' });
  await toolCall.vm.$nextTick();
}

function expectForwardedToolActions(
  wrapper: ReturnType<typeof mountWithToolCallStubs>,
  ids: string[],
): void {
  expect(wrapper.emitted('cancel')).toStrictEqual(ids.map(() => []));
  expect(wrapper.emitted('client-response')).toStrictEqual(ids.map((id) => [
    { id, payload: { decision: 'allow' } },
  ]));
  expect(wrapper.emitted('open-link')).toStrictEqual(ids.map((id) => [
    { href: `https://example.com/${id}`, kind: 'external' },
  ]));
}
