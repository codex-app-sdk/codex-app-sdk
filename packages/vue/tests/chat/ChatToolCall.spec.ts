// @vitest-environment jsdom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ChatToolCall from '../../src/chat/ChatToolCall.vue';
import ChatToolCallTitle from '../../src/chat/ChatToolCallTitle.vue';
import ChatToolConfirmation from '../../src/chat/ChatToolConfirmation.vue';
import ChatToolUserInputRequest from '../../src/chat/ChatToolUserInputRequest.vue';
import type { MessageToolCall, ToolExecutionState } from '../../src/chat/types';

const baseTool: MessageToolCall = {
  args: undefined,
  done: true,
  function: 'custom_tool',
  id: 'tool-1',
  result: undefined,
  state: 'completed',
  status: 'completed',
};

function tool(overrides: Partial<MessageToolCall> = {}): MessageToolCall {
  return { ...baseTool, ...overrides };
}

function descriptor(
  source: string,
  action: string,
  params?: unknown,
): string {
  return JSON.stringify({
    source,
    action,
    phase: 'running',
    ...(params === undefined ? {} : { params }),
  });
}

function mountTool(
  toolCall: MessageToolCall,
  props: Partial<{
    expandable: boolean;
    headerless: boolean;
    showToolDetails: boolean;
    summaryOnly: boolean;
  }> = {},
): VueWrapper {
  return mount(ChatToolCall, { props: { ...props, toolCall } });
}

describe('ChatToolCall', () => {
  it.each([
    ['create', 'add'], ['edit', 'update'], ['delete', 'delete'],
  ])('opens each %s diff with inline or deferred bytes, including files beyond the title summary', async (action, changeKind) => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('codexAppSdkNative', { copyToClipboard: copy });
    try {
    for (const diff of ['', '# README 🪴\n']) {
      const diffContent = { sessionId: 'thread', contentId: 'a'.repeat(64), byteLength: diff ? new TextEncoder().encode(diff).length : 100_000, changeKind };
      const changes = Array.from({ length: 4 }, (_, index) => ({ path: `/repo/file${index}.txt`, kind: { type: changeKind }, diff, diffContent }));
      const wrapper = mountTool(tool({ kind: 'fileChange', args: { changes }, metadata: { changes }, status: descriptor('codex', action, { target: 'files' }) }));
      await wrapper.get('a').trigger('click');
      expect(wrapper.emitted('open-link')?.[0]?.[0]).toMatchObject({ path: '/repo/file0.txt', diffContent });
      expect(wrapper.find('.chat-tool-call__body').exists()).toBe(false);
      await wrapper.get('[aria-label="Copy full text"]').trigger('click'); await flushPromises();
      expect(copy.mock.lastCall?.[0].text).toContain('file3.txt');
      await wrapper.get('[aria-label="Expand full text"]').trigger('click');
      const last = wrapper.findAll('a').find(link => link.attributes('href') === '/repo/file3.txt');
      expect(last).toBeDefined();
      await last!.trigger('click');
      expect(wrapper.emitted('open-link')?.at(-1)?.[0]).toMatchObject({ path: '/repo/file3.txt', diffContent });
      wrapper.unmount();
    }
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([
    { done: false, state: 'running', running: true },
    { done: undefined, state: 'running', running: true },
    { done: true, state: 'running', running: false },
    { done: false, state: 'completed', running: false },
  ] satisfies Array<{ done: boolean | undefined; state: ToolExecutionState; running: boolean }>)
  ('derives running presentation from done=$done and state=$state', ({ done, state, running }) => {
    const wrapper = mountTool(tool({ done, state }));
    const title = wrapper.get('.chat-tool-call__title');

    expect(title.classes().includes('chat-tool-call__title--running')).toBe(running);
    expect(title.classes().includes('codex-text-shimmer')).toBe(running);
  });

  it('routes only active MCP and home requests with string ids to confirmation cards', () => {
    for (const source of ['mcp', 'home']) {
      const wrapper = mountTool(tool({
        done: false,
        state: 'running',
        status: descriptor(source, 'run', { requestId: `${source}-request` }),
      }));
      expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(true);
      expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
    }

    const ordinaryCases = [
      tool({ done: false, state: 'running', status: descriptor('codex', 'run', { requestId: 'request-1' }) }),
      tool({ done: false, state: 'running', status: descriptor('mcp', 'run') }),
      tool({ done: false, state: 'running', status: descriptor('mcp', 'run', { requestId: 12 }) }),
      tool({ done: false, state: 'running', status: descriptor('mcp', 'run', null) }),
      tool({ done: false, state: 'running', status: descriptor('mcp', 'run', []) }),
      tool({ done: true, state: 'completed', status: descriptor('mcp', 'run', { requestId: 'request-1' }) }),
      tool({ done: false, state: 'running', status: 'running' }),
    ];

    for (const toolCall of ordinaryCases) {
      const wrapper = mountTool(toolCall);
      expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(false);
      expect(wrapper.find('.chat-tool-call').exists()).toBe(true);
    }
  });

  it('routes pending and answered Codex ask-user requests with string ids to question cards', () => {
    const request = tool({
      done: false,
      state: 'running',
      status: descriptor('codex', 'ask_user_question', {
        requestId: 'question-1',
        questions: [],
      }),
    });
    const active = mountTool(request);
    expect(active.find('.chat-message__thinking').exists()).toBe(true);
    expect(active.find('.chat-tool-call').exists()).toBe(false);

    const answered = mountTool(tool({ ...request, done: true, state: 'completed',
      status: descriptor('codex', 'ask_user_question', { requestId: 'question-1',
        questions: [{ id: 'framework', header: 'Framework', question: 'Which framework?',
          isOther: false, isSecret: false, options: [{ label: 'Vue' }] }] }),
      result: { answers: { framework: { answers: ['Vue'] } } } }));
    expect(answered.get('.chat-tool-user-input__summary--answered').text()).toContain('User answered question');
    expect(answered.find('.chat-tool-call').exists()).toBe(false);

    const ordinaryCases = [
      tool({ ...request, status: descriptor('other', 'ask_user_question', { requestId: 'question-1' }) }),
      tool({ ...request, status: descriptor('codex', 'plan', { requestId: 'question-1' }) }),
      tool({ ...request, status: descriptor('codex', 'ask_user_question') }),
      tool({ ...request, status: descriptor('codex', 'ask_user_question', { requestId: 12 }) }),
      tool({ ...request, done: true, state: 'completed' }),
    ];

    for (const toolCall of ordinaryCases) {
      const wrapper = mountTool(toolCall);
      expect(wrapper.find('.chat-tool-user-input').exists()).toBe(false);
      expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
      expect(wrapper.find('.chat-tool-call').exists()).toBe(true);
    }
  });

  it.each([
    { args: undefined, result: undefined },
    { args: undefined, result: null },
  ])('does not offer details for args=$args and result=$result', ({ args, result }) => {
    const wrapper = mountTool(tool({ args, result }), { showToolDetails: true });

    expect(wrapper.get('.chat-tool-call__header').element.tagName).toBe('DIV');
    expect(wrapper.find('.chat-tool-call__chevron').exists()).toBe(false);
    expect(wrapper.find('.chat-tool-call__section').exists()).toBe(false);
  });

  it.each([
    { result: false, rendered: 'false' },
    { result: 0, rendered: '0' },
    { result: '', rendered: '' },
  ])('renders the falsey result $result as an available detail', async ({ result, rendered }) => {
    const wrapper = mountTool(tool({ result }), { showToolDetails: true });

    const disclosure = wrapper.get('button.chat-tool-call__details-toggle');
    expect(disclosure.attributes('aria-expanded')).toBe('false');
    await disclosure.trigger('click');
    expect(disclosure.attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('.chat-tool-call__section-title').map((node) => node.text())).toStrictEqual(['Result']);
    expect(wrapper.get('.chat-tool-call__json').text()).toBe(rendered);
  });

  it('distinguishes absent input from null and preserves raw strings', () => {
    const nullInput = mountTool(tool({ args: null }), { showToolDetails: true });
    expect(nullInput.findAll('.chat-tool-call__section-title').map((node) => node.text())).toStrictEqual(['Input']);
    expect(nullInput.get('.chat-tool-call__json').text()).toBe('null');

    const strings = mountTool(tool({ args: 'raw input', result: 'raw result' }), { showToolDetails: true });
    expect(strings.findAll('.chat-tool-call__json').map((node) => node.text())).toStrictEqual([
      'raw input',
      'raw result',
    ]);
  });

  it('formats structured input and results as exact indented JSON', () => {
    const wrapper = mountTool(tool({
      args: { command: 'npm test', flags: ['--run'] },
      result: { passed: 46 },
    }), { showToolDetails: true });

    expect(wrapper.findAll('.chat-tool-call__json').map((node) => node.text())).toStrictEqual([
      '{\n  "command": "npm test",\n  "flags": [\n    "--run"\n  ]\n}',
      '{\n  "passed": 46\n}',
    ]);
  });

  it('opens and closes available details through the visible disclosure', async () => {
    const wrapper = mountTool(tool({ args: { command: 'npm test' } }), { showToolDetails: true });
    const header = wrapper.get('.chat-tool-call__header');

    expect(wrapper.get('.chat-tool-call').classes()).not.toContain('chat-tool-call--open');
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');
    expect(wrapper.get('.chat-tool-call__chevron').classes()).toContain('tabler-icon-chevron-down');

    await wrapper.get('.chat-tool-call__title-content').trigger('click');
    expect(wrapper.get('.chat-tool-call').classes()).toContain('chat-tool-call--open');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.get('.chat-tool-call__chevron').classes()).toContain('tabler-icon-chevron-up');

    await header.trigger('click');
    expect(wrapper.get('.chat-tool-call').classes()).not.toContain('chat-tool-call--open');
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');
    expect(wrapper.get('.chat-tool-call__chevron').classes()).toContain('tabler-icon-chevron-down');
  });

  it('reveals overflowing titles without enabling verbose details or inventing empty details', async () => {
    let resize!: ResizeObserverCallback;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {} unobserve() {} disconnect() {}
    });
    const disabled = mount(ChatToolCall, { props: {
      toolCall: tool({ args: { command: 'npm test' }, result: 'passed' }), showToolDetails: false,
    }, attachTo: document.body });
    try {
      expect(disabled.get('.chat-tool-call__header').element.tagName).toBe('DIV');
      expect(disabled.find('.chat-fold').exists()).toBe(false);
      await nextTick();
      const text = disabled.get('.chat-tool-call__title-content').element;
      let width = 40;
      Object.defineProperties(text, { clientWidth: { get: () => width }, scrollWidth: { get: () => 400 } });
      resize?.([{ target: text } as ResizeObserverEntry], {} as ResizeObserver);
      await nextTick();
      const expand = disabled.get('button[aria-label="Expand full text"]');
      expect(expand.attributes('aria-expanded')).toBe('false');
      await disabled.get('.chat-tool-call__title-content').trigger('click');
      expect(disabled.get('.chat-tool-call__title').classes()).toContain('chat-tool-call__title--expanded');
      expect(disabled.get('[aria-label="Collapse full text"]').attributes('aria-expanded')).toBe('true');
      expect(disabled.find('.chat-fold').exists()).toBe(false);
      expect(disabled.text()).not.toContain('passed');
      expect(disabled.find('[aria-label="Copy"]').exists()).toBe(false);
      await disabled.get('[aria-label="Collapse full text"]').trigger('click');
      width = 800;
      resize([{ target: text } as ResizeObserverEntry], {} as ResizeObserver);
      await nextTick();
      expect(disabled.find('[aria-label="Expand full text"]').exists()).toBe(false);
      await disabled.get('.chat-tool-call__title-content').trigger('click');
      expect(disabled.find('[aria-label="Collapse full text"]').exists()).toBe(false);
    } finally { disabled.unmount(); vi.unstubAllGlobals(); }

    const empty = mountTool(tool(), { showToolDetails: true });
    expect(empty.get('.chat-tool-call__header').element.tagName).toBe('DIV');
    expect(empty.find('.chat-fold').exists()).toBe(false);
  });

  it('copies the full current tool title through its leading icon and briefly confirms success', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    vi.useFakeTimers();
    const wrapper = mount(ChatToolCall, { props: { toolCall: tool({ status: 'Searched 3 files' }) }, attachTo: document.body });
    try {
      expect(wrapper.get('.chat-tool-call__title').attributes('data-label')).toBe('Searched 3 files');
      const button = wrapper.get('[aria-label="Copy full text"]');
      await button.trigger('pointerenter', { pointerType: 'mouse' });
      expect(button.find('.tabler-icon-copy').exists()).toBe(true);
      await button.trigger('click'); await flushPromises();
      expect(copy).toHaveBeenLastCalledWith('Searched 3 files');
      expect(wrapper.get('[aria-label="Copied"]').find('.tabler-icon-check').exists()).toBe(true);
      await vi.advanceTimersByTimeAsync(1500);
      expect(wrapper.find('[aria-label="Copied"]').exists()).toBe(false);
      await button.trigger('pointerleave');
      await button.trigger('pointerenter', { pointerType: 'touch' });
      expect(button.find('.tabler-icon-copy').exists()).toBe(false);
      await button.trigger('focusin');
      expect(button.find('.tabler-icon-copy').exists()).toBe(false);
      await button.trigger('focusout');
      await wrapper.setProps({ toolCall: tool({ kind: 'command', args: { command: 'first line\nsecond line with complete arguments' }, status: 'Ran a human-readable command summary' }) });
      await wrapper.get('[aria-label="Copy full text"]').trigger('click'); await flushPromises();
      expect(copy).toHaveBeenLastCalledWith('first line\nsecond line with complete arguments');
    } finally { wrapper.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('forwards responses and links from every specialized and header renderer', async () => {
    const confirmationResponse = { id: 'confirmation-1', payload: { decision: 'allow' as const } };
    const confirmation = mountTool(tool({
      done: false,
      state: 'running',
      status: descriptor('mcp', 'run', { requestId: 'confirmation-1' }),
    }));
    confirmation.getComponent(ChatToolConfirmation).vm.$emit('client-response', confirmationResponse);
    await confirmation.vm.$nextTick();
    expect(confirmation.emitted('client-response')).toStrictEqual([[confirmationResponse]]);

    const answersResponse = { id: 'question-1', payload: { answers: {} } };
    const question = mountTool(tool({
      done: false,
      state: 'running',
      status: descriptor('codex', 'ask_user_question', {
        questions: [],
        requestId: 'question-1',
      }),
    }));
    question.getComponent(ChatToolUserInputRequest).vm.$emit('client-response', answersResponse);
    await question.vm.$nextTick();
    expect(question.emitted('client-response')).toStrictEqual([[answersResponse]]);

    const link = { href: 'https://example.com/tool', kind: 'external' as const };
    const staticHeader = mountTool(tool());
    staticHeader.getComponent(ChatToolCallTitle).vm.$emit('open-link', link);
    await staticHeader.vm.$nextTick();
    expect(staticHeader.emitted('open-link')).toStrictEqual([[link]]);

    const expandableHeader = mountTool(tool({ args: { command: 'npm test' } }), {
      showToolDetails: true,
    });
    expandableHeader.getComponent(ChatToolCallTitle).vm.$emit('open-link', link);
    await expandableHeader.vm.$nextTick();
    expect(expandableHeader.emitted('open-link')).toStrictEqual([[link]]);
  });
});
