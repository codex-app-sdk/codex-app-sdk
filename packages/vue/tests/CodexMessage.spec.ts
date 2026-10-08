// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import type { SurfaceMessagePart } from '@codex-app-sdk/core/surface';
import ChatCompactionMessage from '../src/chat/ChatCompactionMessage.vue';
import CodexMessage from '../src/components/CodexMessage.vue';
import ChatMessageActions from '../src/chat/ChatMessageActions.vue';
import ChatMessageBlock from '../src/chat/ChatMessageBlock.vue';
import ChatMessageEditor from '../src/chat/ChatMessageEditor.vue';

const clipboardWriteText = vi.fn();

beforeEach(() => {
  clipboardWriteText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });
  vi.stubGlobal('ClipboardItem', undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountMessage(props: Record<string, unknown>) {
  return mount(CodexMessage, {
    props: props as never,
  });
}

describe('CodexMessage', () => {
  it('renders an async question once when provider text and header repeat its title', () => {
    const question = 'Does the field receive focus?';
    const wrapper = mountMessage({
      index: 0,
      message: {
        id: 'question-duplicates', role: 'assistant', status: 'complete',
        parts: [
          { type: 'text', text: question },
          { type: 'question', request: {
            id: 'async-question:duplicate', kind: 'ask_user',
            conversationId: 'thread-1', turnId: 'turn-1', itemId: 'duplicate',
            payload: { request: {
              itemId: 'duplicate', delivery: 'async', blocking: false,
              questions: [{ id: 'q', header: question, question, isOther: true, isSecret: false, options: null }],
            } },
          } },
        ],
      },
    });

    expect(wrapper.text().split(question)).toHaveLength(2);
    expect(wrapper.get('.chat-tool-user-input__eyebrow').text()).toBe('Question');
    expect(wrapper.find('textarea').exists()).toBe(true);
  });

  it('renders and answers an asynchronous agent question outside the work disclosure', async () => {
    const request = {
      id: 'async-question:agent-question',
      kind: 'ask_user' as const,
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'agent-question',
      payload: {
        request: {
          itemId: 'agent-question',
          delivery: 'async' as const,
          blocking: false,
          questions: [{
            id: '["request_user_input_async","agent-question",0]',
            header: 'Framework',
            question: 'Which framework should I use?',
            isOther: true,
            isSecret: false,
            options: [
              { label: 'Vue', description: 'Use the SDK component package' },
              { label: 'React', description: 'Use a custom renderer' },
            ],
          }],
        },
      },
    };
    const wrapper = mountMessage({
      answeredClientRequestIds: new Set<string>(),
      index: 0,
      message: {
        id: 'assistant-question',
        role: 'assistant',
        status: 'complete',
        turnId: 'turn-1',
        parts: [
          { type: 'text', text: 'I need one decision.' },
          { type: 'question', request },
        ],
      },
    });

    expect(wrapper.text()).toContain('I need one decision.');
    expect(wrapper.text()).toContain('Which framework should I use?');
    expect(wrapper.find('.chat-work-group').exists()).toBe(false);
    const vueOption = wrapper.findAll('button').find((button) => button.text().includes('Vue'))!;
    await vueOption.trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([{
      id: request.id,
      payload: {
        answers: {
          '["request_user_input_async","agent-question",0]': { answers: ['Vue'] },
        },
      },
    }].map((response) => [response]));
  });

  it('renders an additive header once above default content while preserving actions', async () => {
    const wrapper = mount(CodexMessage, {
      props: { index: 2, message: { id: 'user-header', role: 'user', content: 'Keep SDK rendering' } },
      slots: {
        header: ({ index }: { index: number }) => h('div', { class: 'test-message-header' }, `Header ${index}`),
      },
    });

    expect(wrapper.findAll('.test-message-header')).toHaveLength(1);
    expect(wrapper.get('.chat-message--steer').text()).toContain('Header 2');
    expect(wrapper.get('.test-message-header').text()).toBe('Header 2');
    expect(wrapper.get('.chat-message-block--text').text()).toContain('Keep SDK rendering');
    expect(wrapper.get('.test-message-header').element.compareDocumentPosition(
      wrapper.get('.chat-message__stack').element,
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await wrapper.get('[aria-label="Quote"]').trigger('click');
    expect(wrapper.emitted('quote-message')).toStrictEqual([[2]]);
  });

  it('places matching metadata spacing immediately above and below a steered message', () => {
    const wrapper = mount(CodexMessage, {
      props: {
        message: { id: 'steered-header', role: 'user', content: 'Keep SDK rendering', type: 'steer' },
      },
      slots: {
        header: () => h('div', 'Message from the host'),
      },
    });

    const header = wrapper.get('.chat-message--steer-above');
    const stack = wrapper.get('.chat-message__stack');
    const footer = wrapper.get('.chat-message--steer-below');
    expect(header.element.nextElementSibling).toBe(stack.element);
    expect(stack.element.nextElementSibling).toBe(footer.element);
  });

  it('delegates compaction presentation to the dedicated component', () => {
    const wrapper = mountMessage({
      message: { role: 'assistant', content: '', compactionStatus: 'running', type: 'compaction' },
    });

    expect(wrapper.getComponent(ChatCompactionMessage).props()).toMatchObject({
      completedTitle: 'Context compacted',
      runningTitle: 'Compacting context',
      status: 'running',
    });
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
  });

  it('renders thinking for empty streaming assistant messages', () => {
    const wrapper = mountMessage({
      message: { role: 'assistant', content: '', streaming: true, toolCalls: [] },
    });

    expect(wrapper.text()).toContain('Thinking');
    expect(wrapper.get('.chat-message__thinking').classes()).toContain('codex-text-shimmer');
  });

  it('renders the thinking shimmer directly from an app-server surface placeholder', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-turn-live',
        role: 'assistant',
        status: 'streaming',
        parts: [],
        turnId: 'turn-live',
      },
    });

    expect(wrapper.get('.chat-message__thinking').text()).toBe('Thinking');
    expect(wrapper.get('.chat-message__thinking').classes()).toContain('codex-text-shimmer');
    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
  });

  it.each([
    ['attachment', [{
      type: 'attachment',
      attachment: { kind: 'file', name: 'result.txt', path: '/tmp/result.txt' },
    }]],
    ['media', [{
      type: 'media',
      media: { mimeType: 'image/png', title: 'Result', url: 'data:image/png;base64,cG5n' },
    }]],
    ['tool', [{
      type: 'tool',
      toolCall: {
        args: {}, done: false, function: 'ask_user_question', id: 'question-1', result: null, state: 'running',
      },
    }]],
    ['tool-group', [{
      type: 'tool',
      toolCall: { args: {}, done: false, function: 'shell', id: 'shell-1', result: null, state: 'running' },
    }]],
  ])('uses the streaming status dot for visible %s activity', (blockType, parts) => {
    const wrapper = mount(CodexMessage, {
      props: {
        message: { id: `assistant-${blockType}`, role: 'assistant', content: '', parts, streaming: true },
      } as never,
      slots: {
        block: ({ block }: { block: { type: string } }) => h('span', { 'data-block-type': block.type }, block.type),
      },
    });

    expect(wrapper.get('[data-block-type]').attributes('data-block-type')).toBe(blockType);
    expect(wrapper.get('.chat-message__stream-dot').attributes('aria-label')).toBe('Streaming');
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
    expect(wrapper.find('.chat-message__empty-response').exists()).toBe(false);
  });

  it.each([
    ['mermaid', ['```mermaid', 'graph TD; A-->B;', '```'].join('\n')],
    ['visualization', '\uE200visualize\uE202{"path":"/tmp/chart.html","title":"Chart"}\uE201'],
  ])('treats a streaming %s block as visible assistant activity', (blockType, content) => {
    const wrapper = mount(CodexMessage, {
      props: { message: { id: `assistant-${blockType}`, role: 'assistant', content, streaming: true } },
      slots: {
        block: ({ block }: { block: { type: string } }) => h('span', { 'data-block-type': block.type }, block.type),
      },
    });

    expect(wrapper.get('[data-block-type]').attributes('data-block-type')).toBe(blockType);
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
    expect(wrapper.get('.chat-message__stream-dot').attributes('aria-label')).toBe('Streaming');
  });

  it('does not treat a follow-up suggestion as streamed assistant response content', () => {
    const wrapper = mount(CodexMessage, {
      props: {
        message: {
          id: 'assistant-follow-up-only',
          role: 'assistant',
          content: '<follow-up>Try the next step</follow-up>',
          streaming: true,
        },
      },
      slots: {
        block: ({ block }: { block: { type: string } }) => h('span', { 'data-block-type': block.type }, block.type),
      },
    });

    expect(wrapper.get('[data-block-type]').attributes('data-block-type')).toBe('follow-ups');
    expect(wrapper.get('.chat-message__thinking').text()).toBe('Thinking');
    expect(wrapper.find('.chat-message__stream-dot').exists()).toBe(false);
  });

  it('does not render assistant-only status UI for an empty user message', () => {
    const wrapper = mountMessage({ message: { id: 'user-empty', role: 'user', content: '' } });

    expect(wrapper.find('.chat-message__empty-response').exists()).toBe(false);
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
    expect(wrapper.find('.chat-message__stream-dot').exists()).toBe(false);
  });

  it('expands phased work while active and collapses it when the final answer starts', async () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-phased',
        role: 'assistant',
        status: 'streaming',
        parts: [
          {
            type: 'reasoning',
            summary: 'Inspecting the message pipeline',
            itemId: 'reasoning-1',
            summaryIndex: 0,
          },
          {
            type: 'text',
            text: 'I am checking the renderer.',
            itemId: 'commentary-1',
            phase: 'commentary',
          },
        ],
      },
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(wrapper.get('.chat-work-group .chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.find('.chat-message-block--reasoning').exists()).toBe(false);

    await wrapper.setProps({
      message: {
        id: 'assistant-phased',
        role: 'assistant',
        status: 'streaming',
        parts: [
          {
            type: 'reasoning',
            summary: 'Inspecting the message pipeline',
            itemId: 'reasoning-1',
            summaryIndex: 0,
          },
          {
            type: 'text',
            text: 'I am checking the renderer.',
            itemId: 'commentary-1',
            phase: 'commentary',
          },
          {
            type: 'text',
            text: 'The renderer is fixed.',
            itemId: 'answer-1',
            phase: 'final_answer',
          },
        ],
      },
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.get('.chat-work-group .chat-fold').classes()).not.toContain('chat-fold--open');
    expect(wrapper.get('.chat-message__stack').text()).toContain('The renderer is fixed.');

    await wrapper.get('.chat-work-group__header').trigger('click');
    expect(wrapper.get('.chat-work-group .chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
  });

  it('uses only the latest reasoning summary as the live activity title', async () => {
    const completedTools: SurfaceMessagePart[] = Array.from({ length: 7 }, (_, index) => ({
      type: 'tool' as const,
      id: `completed-tool-${index}`,
      title: `Completed tool ${index}`,
      kind: 'command' as const,
      status: 'completed',
    }));
    const runningTool: Extract<SurfaceMessagePart, { type: 'tool' }> = {
      type: 'tool' as const,
      id: 'running-tool',
      title: 'Inspecting component contract backend',
      kind: 'command' as const,
      status: 'running',
    };
    const activeParts: SurfaceMessagePart[] = [
      {
        type: 'reasoning' as const,
        summary: '**Planning targeted filename searches**',
        itemId: 'reasoning-1',
        summaryIndex: 0,
      },
      ...completedTools,
      {
        type: 'reasoning' as const,
        summary: '**Inspecting component contract backend**',
        itemId: 'reasoning-2',
        summaryIndex: 0,
      },
      runningTool,
    ];
    const wrapper = mountMessage({
      message: {
        id: 'assistant-activity',
        role: 'assistant',
        status: 'streaming',
        parts: activeParts,
      },
    });

    expect(wrapper.findAll('.chat-tool-group')).toHaveLength(1);
    expect(wrapper.get('.chat-tool-group__title').text())
      .toBe('Inspecting component contract backend · 7 actions done');
    expect(wrapper.find('.chat-message-block--reasoning').exists()).toBe(false);

    await wrapper.setProps({
      message: {
        id: 'assistant-activity',
        role: 'assistant',
        status: 'streaming',
        parts: [
          ...activeParts.slice(0, -1),
          { ...runningTool, status: 'completed' },
          { type: 'text', text: 'The component contract is clear.', phase: 'commentary' },
        ],
      },
    });

    expect(wrapper.findAll('.chat-tool-group')).toHaveLength(1);
    expect(wrapper.get('.chat-tool-group__title').text()).toBe('8 actions done');
    expect(wrapper.find('.chat-message-block--reasoning').exists()).toBe(false);
    expect(wrapper.text()).toContain('The component contract is clear.');
  });

  it('shows completed phased work directly when there is no final answer', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-phased-without-answer',
        role: 'assistant',
        status: 'complete',
        parts: [{
          type: 'text',
          text: 'The backend does not emit a separate summary.',
          phase: 'commentary',
        }],
      },
    });

    expect(wrapper.find('.chat-work-group__header').exists()).toBe(false);
    expect(wrapper.text()).toContain('The backend does not emit a separate summary.');
  });

  it('keeps unphased assistant output on the existing flat rendering path', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-unphased',
        role: 'assistant',
        status: 'complete',
        parts: [{ type: 'text', text: 'Claude response' }],
      },
    });

    expect(wrapper.find('.chat-work-group').exists()).toBe(false);
    expect(wrapper.get('.chat-message-block--text').text()).toBe('Claude response');
  });

  it('keeps phased work wrappers and superseded reasoning out of the public block slot', () => {
    const seenTypes: string[] = [];
    const wrapper = mount(CodexMessage, {
      props: {
        message: {
          id: 'assistant-custom-blocks',
          role: 'assistant',
          status: 'streaming',
          parts: [
            {
              type: 'reasoning',
              summary: 'Checking the public slot',
              itemId: 'reasoning-1',
              summaryIndex: 0,
            },
            {
              type: 'text',
              text: 'Still working',
              itemId: 'commentary-1',
              phase: 'commentary',
            },
          ],
        },
      },
      slots: {
        block: ({ block }: { block: { type: string } }) => {
          seenTypes.push(block.type);
          return h('div', { class: `custom-${block.type}` }, block.type);
        },
      },
    });

    expect(seenTypes).toStrictEqual(['text']);
    expect(wrapper.find('.custom-reasoning').exists()).toBe(false);
    expect(wrapper.find('.custom-text').exists()).toBe(true);
    expect(seenTypes).not.toContain('work-group');
  });

  it('forwards every action emitted by a phased work group', async () => {
    const wrapper = mount(CodexMessage, {
      props: {
        message: {
        id: 'assistant-work-actions',
        role: 'assistant',
        status: 'streaming',
          parts: [
            {
              type: 'reasoning',
              summary: 'Waiting for a decision',
              itemId: 'reasoning-1',
              summaryIndex: 0,
            },
            {
              type: 'text',
              text: 'Checking the available choices',
              itemId: 'commentary-1',
              phase: 'commentary',
            },
          ],
        },
      },
      slots: {
        text: ({ content }: { content: string }) => `Custom work text: ${content}`,
      },
    });
    const response = { id: 'question-1', payload: { answers: { choice: 'yes' } } };
    const link = { href: 'https://example.com/result', kind: 'external' as const };
    const visualization = { path: '/tmp/chart.html', title: 'Chart' };
    const workGroup = wrapper.getComponent(ChatMessageBlock);

    expect(wrapper.text()).toContain('Custom work text: Checking the available choices');

    workGroup.vm.$emit('cancel');
    workGroup.vm.$emit('client-response', response);
    workGroup.vm.$emit('open-link', link);
    workGroup.vm.$emit('open-visualization', visualization);
    workGroup.vm.$emit('send-follow-up', 'Continue');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(wrapper.emitted('client-response')).toStrictEqual([[response]]);
    expect(wrapper.emitted('open-link')).toStrictEqual([[link]]);
    expect(wrapper.emitted('open-visualization')).toStrictEqual([[visualization]]);
    expect(wrapper.emitted('send-follow-up')).toStrictEqual([['Continue']]);
  });

  it('renders a muted italic fallback for an empty completed assistant response', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-empty',
        role: 'assistant',
        status: 'complete',
        parts: [{ type: 'text', text: '', itemId: 'agent-empty' }],
      },
    });

    expect(wrapper.get('.chat-message__empty-response').text()).toBe('Empty response');
    expect(wrapper.get('.chat-message__empty-response').element.tagName).toBe('SPAN');
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
  });

  it('applies the SDK base markdown styles to rendered messages', () => {
    const wrapper = mountMessage({
      message: { role: 'assistant', content: 'Hello **world**' },
    });

    expect(wrapper.get('.chat-message-block--text').classes()).toContain('codex-markdown');
  });

  it('renders optimistic image previews and persisted file chips in user messages', () => {
    const wrapper = mountMessage({
      message: {
        id: 'user-attachments',
        role: 'user',
        status: 'complete',
        parts: [
          { type: 'text', text: 'Review both' },
          {
            type: 'attachment',
            attachment: {
              kind: 'image',
              name: 'preview.png',
              path: '/tmp/preview.png',
              url: 'data:image/png;base64,cG5n',
              mimeType: 'image/png',
            },
          },
          {
            type: 'attachment',
            attachment: {
              kind: 'file',
              name: 'notes.md',
              path: '/tmp/notes.md',
              mimeType: 'text/markdown',
            },
          },
        ],
      },
    });

    expect(wrapper.get('.chat-message-block--text').text()).toBe('Review both');
    expect(wrapper.get('.chat-message__attachments').element.nextElementSibling)
      .toBe(wrapper.get('.chat-message__stack').element);
    expect(wrapper.get('.chat-message__attachments').findAll('.chat-attachment-block')).toHaveLength(2);
    expect(wrapper.get('.chat-attachment-block__preview').attributes('src'))
      .toBe('data:image/png;base64,cG5n');
    expect(wrapper.findAll('.chat-attachment-block').map((block) => block.text()))
      .toStrictEqual(['', 'notes.md']);
    expect(wrapper.get('a.chat-attachment-block--chip').attributes('href')).toBe('/tmp/notes.md');
  });

  it('keeps assistant attachments in the response stack', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-attachment',
        role: 'assistant',
        status: 'complete',
        parts: [{
          type: 'attachment',
          attachment: { kind: 'file', name: 'result.txt', path: '/tmp/result.txt' },
        }],
      },
    });

    expect(wrapper.find('.chat-message__attachments').exists()).toBe(false);
    expect(wrapper.get('.chat-message__stack .chat-attachment-block').text()).toBe('result.txt');
  });

  it('hides ambient context from rendering, editing, and clipboard output', async () => {
    const wrapper = mountMessage({
      message: {
        id: 'user-with-ambient-context',
        role: 'user',
        turnId: 'turn-context',
        content: [
          '## My request for Codex:',
          'Find a rental car',
          '',
          '<in-app-browser-context source="ambient-ui-state">',
          'Current URL: https://www.skyscanner.com/car-rental',
          '</in-app-browser-context>',
        ].join('\n'),
      },
    });

    expect(wrapper.text()).toContain('Find a rental car');
    expect(wrapper.text()).not.toContain('Current URL');
    expect(wrapper.text()).not.toContain('in-app-browser-context');
    expect(wrapper.text()).not.toContain('My request for Codex');

    await wrapper.get('[aria-label="Copy"]').trigger('click');
    expect(clipboardWriteText).toHaveBeenCalledWith('Find a rental car');

    await wrapper.get('[aria-label="Edit"]').trigger('click');
    expect(wrapper.get('textarea').element.value).toBe('Find a rental car');
  });

  it('hides unsupported user mutation actions while keeping copy and quote', () => {
    const wrapper = mountMessage({
      canDeleteTurn: false,
      canEditTurn: false,
      index: 0,
      message: { id: 'user-1', role: 'user', content: 'Inspect the composer.' },
    });

    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Quote"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Edit"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false);
  });

  it('hides unsupported assistant mutation actions while keeping copy', () => {
    const wrapper = mountMessage({
      canDeleteTurn: false,
      canRetryTurn: false,
      index: 1,
      message: { id: 'assistant-1', role: 'assistant', content: 'Checking now.' },
    });

    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false);
  });

  it('does not render an action toolbar for steer markers', () => {
    const wrapper = mount(CodexMessage, {
      props: {
        message: { id: 'steer-1', role: 'user', content: 'Focus on the renderer.', type: 'steer' },
      },
      slots: {
        actions: '<div class="custom-message-actions">Actions</div>',
      },
    });

    expect(wrapper.find('.chat-message__actions').exists()).toBe(false);
    expect(wrapper.find('.custom-message-actions').exists()).toBe(false);
  });

  it('combines message capabilities with presentation action visibility', () => {
    const wrapper = mountMessage({
      canDeleteTurn: false,
      canEditTurn: true,
      message: { id: 'user-1', role: 'user', content: 'Inspect the composer.' },
      presentation: {
        messages: {
          actions: { copy: false, delete: true, edit: false, quote: false, retry: true },
        },
      },
    });

    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Quote"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Edit"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false);
  });

  it('suppresses tool blocks without removing neighboring assistant content', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-tools',
        role: 'assistant',
        content: 'Before.<tool id="tool-1"></tool>After.',
        toolCalls: [{
          args: {}, done: true, function: 'shell', id: 'tool-1', result: 'ok', state: 'completed',
        }],
      },
      presentation: { messages: { toolBlocks: false } },
    });

    expect(wrapper.text()).toContain('Before.');
    expect(wrapper.text()).toContain('After.');
    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
    expect(wrapper.find('.chat-tool-group').exists()).toBe(false);
  });

  it('keeps generated media visible when technical tool blocks are suppressed', () => {
    const wrapper = mountMessage({
      message: {
        id: 'assistant-generated',
        role: 'assistant',
        status: 'complete',
        parts: [
          {
            type: 'tool', id: 'image-1', kind: 'dynamic', title: 'image_generation',
            status: 'completed',
          },
          {
            type: 'media', itemId: 'image-1',
            media: {
              url: 'data:image/png;base64,aW1hZ2U=',
              mimeType: 'image/png',
              prompt: 'Draw a route map',
              title: 'Generated image',
            },
          },
        ],
      },
      presentation: { messages: { toolBlocks: false } },
    });

    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
    expect(wrapper.find('.chat-tool-group').exists()).toBe(false);
    expect(wrapper.get('.chat-media-block__image').attributes('src'))
      .toBe('data:image/png;base64,aW1hZ2U=');
    expect(wrapper.text()).toContain('Generated image');
  });

  it('routes user actions and editor output through its public events', async () => {
    const wrapper = mountMessage({
      index: 2,
      message: { role: 'user', content: 'Old prompt', createdAt: new Date().toISOString(), turnId: 'turn-2' },
    });

    await wrapper.find('[aria-label="Quote"]').trigger('click');
    await wrapper.find('[aria-label="Delete"]').trigger('click');
    await wrapper.find('[aria-label="Edit"]').trigger('click');
    wrapper.getComponent(ChatMessageEditor).vm.$emit('save', 'New prompt');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('quote-message')).toStrictEqual([[2]]);
    expect(wrapper.emitted('delete-turn')).toStrictEqual([['turn-2']]);
    expect(wrapper.emitted('edit-turn')).toStrictEqual([[{ content: 'New prompt', turnId: 'turn-2' }]]);
    expect(wrapper.findComponent(ChatMessageEditor).exists()).toBe(false);
  });

  it('closes editing on cancel without emitting a replacement', async () => {
    const wrapper = mountMessage({
      message: { id: 'user-cancel', role: 'user', content: 'Keep me', turnId: 'turn-cancel' },
    });

    await wrapper.get('[aria-label="Edit"]').trigger('click');
    wrapper.getComponent(ChatMessageEditor).vm.$emit('cancel');
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(ChatMessageEditor).exists()).toBe(false);
    expect(wrapper.emitted('edit-turn')).toBeUndefined();
  });

  it('rejects child mutation events that violate role, capability, or thread policy', async () => {
    const unavailable = mountMessage({
      canDeleteTurn: false,
      canEditTurn: false,
      canForkTurn: false,
      canRetryTurn: false,
      message: { id: 'user-unavailable', role: 'user', content: 'Locked' },
    });
    const unavailableActions = unavailable.getComponent(ChatMessageActions);
    for (const event of ['delete', 'edit', 'fork', 'retry'] as const) unavailableActions.vm.$emit(event);
    await unavailable.vm.$nextTick();
    expect(unavailable.findComponent(ChatMessageEditor).exists()).toBe(false);
    expect(unavailable.emitted('delete-turn')).toBeUndefined();
    expect(unavailable.emitted('fork-turn')).toBeUndefined();
    expect(unavailable.emitted('retry-turn')).toBeUndefined();

    const disabled = mountMessage({
      canForkTurn: true,
      message: { id: 'assistant-disabled', role: 'assistant', content: 'Locked' },
      threadActionsDisabled: true,
    });
    const disabledActions = disabled.getComponent(ChatMessageActions);
    for (const event of ['delete', 'fork', 'retry'] as const) disabledActions.vm.$emit(event);
    disabledActions.vm.$emit('edit');
    await disabled.vm.$nextTick();
    expect(disabled.findComponent(ChatMessageEditor).exists()).toBe(false);
    expect(disabled.emitted('delete-turn')).toBeUndefined();
    expect(disabled.emitted('fork-turn')).toBeUndefined();
    expect(disabled.emitted('retry-turn')).toBeUndefined();
  });

  it('copies messages without tool markers or follow-up chips', async () => {
    const wrapper = mountMessage({
      index: 4,
      message: {
        role: 'assistant',
        content: 'Done.<tool id="tool-1"></tool>\n\n<follow-up>Do another thing</follow-up>',
      },
    });

    await wrapper.find('[aria-label="Copy"]').trigger('click');

    expect(clipboardWriteText).toHaveBeenCalledWith('Done.');
    expect(wrapper.emitted('copy-message')).toStrictEqual([[4]]);
  });

  it('shows copied state for 1.5 seconds, extends it on repeat copy, and cancels cleanup on unmount', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const wrapper = mountMessage({
      index: 6,
      message: { id: 'assistant-copy-state', role: 'assistant', content: 'Copy me' },
    });

    await wrapper.get('[aria-label="Copy"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[aria-label="Copied"]').exists()).toBe(true);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1_500);
    const firstResetTimer = setTimeoutSpy.mock.results.at(-1)!.value;

    vi.advanceTimersByTime(1_000);
    await wrapper.get('[aria-label="Copied"]').trigger('click');
    await flushPromises();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(firstResetTimer);
    vi.advanceTimersByTime(1_499);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[aria-label="Copied"]').exists()).toBe(true);
    vi.advanceTimersByTime(1);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);

    await wrapper.get('[aria-label="Copy"]').trigger('click');
    await flushPromises();
    const unmountResetTimer = setTimeoutSpy.mock.results.at(-1)!.value;
    wrapper.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(unmountResetTimer);
  });

  it('renders assistant retry actions and reserves them while streaming', async () => {
    const wrapper = mountMessage({
      index: 5,
      message: { role: 'assistant', content: 'Answer', createdAt: new Date().toISOString(), turnId: 'turn-5' },
    });
    const streaming = mountMessage({
      message: { role: 'assistant', content: 'Answer', streaming: true, turnId: 'turn-streaming' },
    });

    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Edit"]').exists()).toBe(false);
    await wrapper.find('[aria-label="Retry"]').trigger('click');
    await wrapper.find('[aria-label="Delete"]').trigger('click');
    expect(wrapper.emitted('retry-turn')).toStrictEqual([['turn-5']]);
    expect(wrapper.emitted('delete-turn')).toStrictEqual([['turn-5']]);
    expect(streaming.get('.chat-message__actions').classes()).toContain('chat-message__actions--reserved');
    expect(streaming.get('.chat-message__actions').attributes('aria-hidden')).toBe('true');
  });

  it('marks completed assistant actions for persistent visibility when requested', () => {
    const wrapper = mountMessage({
      actionsAlwaysVisible: true,
      message: { role: 'assistant', content: 'Answer' },
    });

    expect(wrapper.get('.chat-message').classes()).toContain('chat-message--actions-visible');
  });

  it('does not mark a reserved action slot as persistently visible', () => {
    const wrapper = mountMessage({
      actionsAlwaysVisible: true,
      actionsDisabled: true,
      message: { id: 'assistant-reserved', role: 'assistant', content: 'Answer' },
    });

    expect(wrapper.get('.chat-message__actions').classes()).toContain('chat-message__actions--reserved');
    expect(wrapper.get('.chat-message').classes()).not.toContain('chat-message--actions-visible');
  });
});
