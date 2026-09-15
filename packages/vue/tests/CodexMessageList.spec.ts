// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref, toRaw } from 'vue';
import CodexMessageList from '../src/components/CodexMessageList.vue';
import CodexMessage from '../src/components/CodexMessage.vue';
import type { Message } from '../src/chat/types';
import type { CodexSurfaceTurn, SurfaceMessage } from '@codex-app-sdk/core/surface';

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

it('folds resolved async questions with turn details while leaving pending questions accessible', async () => {
  const request = {
    id: 'async-question:q', kind: 'ask_user' as const,
    conversationId: 'thread', turnId: 'turn', itemId: 'q',
    payload: { request: { itemId: 'q', delivery: 'async' as const, blocking: false,
      questions: [{ id: 'q', header: 'Context', question: 'What context?', isOther: true, isSecret: false, options: null }],
    } },
  };
  const wrapper = mount(CodexMessageList, { props: {
    messages: [
      { id: 'work', role: 'assistant', status: 'complete', turnId: 'turn', parts: [{ type: 'text', text: 'Checking', phase: 'commentary' }] },
      { id: 'question', role: 'assistant', status: 'complete', turnId: 'turn', parts: [{ type: 'question', request }] },
      { id: 'final', role: 'assistant', status: 'complete', turnId: 'turn', parts: [{ type: 'text', text: 'Finished', phase: 'final_answer' }] },
    ] as SurfaceMessage[],
    answeredClientRequestIds: new Set<string>(),
  } });
  expect(wrapper.find('textarea').exists()).toBe(true);
  expect(wrapper.get('.chat-work-group__header').attributes('aria-expanded')).toBe('false');
  await wrapper.get('textarea').setValue('Keep the original answer.');
  await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');
  await wrapper.setProps({ answeredClientRequestIds: new Set([request.id]) });
  expect(wrapper.find('.chat-tool-user-input').exists()).toBe(false);
  await wrapper.get('.chat-work-group__header').trigger('click');
  expect(wrapper.get('.chat-tool-user-input__summary--answered').text()).toContain('Answered user question');
  expect(wrapper.get('.chat-tool-user-input__answer-value').text()).toBe('Keep the original answer.');
  await wrapper.get('.chat-work-group__header').trigger('click');
  expect(wrapper.find('.chat-tool-user-input').exists()).toBe(false);
  expect(wrapper.text()).toContain('Finished');
  const restoredMessages = [...wrapper.props('messages'), {
    id: 'reply', role: 'user', status: 'complete', turnId: 'next-turn',
    parts: [{ type: 'text', text: 'Keep the original answer.' }],
    metadata: { asyncQuestionAnswers: { q: { answers: ['Keep the original answer.'] } } },
  }] as SurfaceMessage[];
  wrapper.unmount();
  const restored = mount(CodexMessageList, { props: {
    messages: restoredMessages, answeredClientRequestIds: new Set([request.id]),
  } });
  await restored.get('.chat-work-group__header').trigger('click');
  expect(restored.get('.chat-tool-user-input__answer-value').text()).toBe('Keep the original answer.');
  restored.unmount();
});

function makeMessages(count: number, offset = 0): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${offset + index}`,
    role: 'user' as const,
    content: `Message ${offset + index}`,
    createdAt: `2026-06-05T00:00:${String(index).padStart(2, '0')}.000Z`,
  }));
}

function turnLifecycle(id: string, status: CodexSurfaceTurn['status']): CodexSurfaceTurn {
  return {
    id,
    status,
    error: null,
    willRetry: false,
    startedAt: null,
    completedAt: status === 'inProgress' ? null : '2026-06-05T00:00:01.000Z',
    durationMs: status === 'inProgress' ? null : 1_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it.each([
    ['a streaming flag on a user row', [{ id: 'user-streaming', role: 'user', content: '', streaming: true }]],
    ['a completed legacy assistant row', [{ id: 'assistant-complete', role: 'assistant', content: 'Done', streaming: false }]],
    ['a completed compaction row', [{
      id: 'compaction-complete', role: 'assistant', content: '', type: 'compaction', compactionStatus: 'completed',
    }]],
    ['a completed surface assistant row', [{
      id: 'surface-complete', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Done' }],
    }]],
  ])('adds a thinking placeholder while busy with %s', (_label, busyMessages) => {
    const wrapper = mount(CodexMessageList, { props: { busy: true, messages: busyMessages } as never });

    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(1);
  });

  it.each([
    ['a legacy streaming assistant among user rows', [
      { id: 'user-before-stream', role: 'user', content: 'Question' },
      { id: 'assistant-streaming', role: 'assistant', content: 'Working', streaming: true },
    ]],
    ['a streaming surface assistant', [{
      id: 'surface-streaming', role: 'assistant', status: 'streaming', parts: [{ type: 'text', text: 'Working' }],
    }]],
  ])('does not add a duplicate thinking placeholder for %s', (_label, busyMessages) => {
    const wrapper = mount(CodexMessageList, { props: { busy: true, messages: busyMessages } as never });

    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
    expect(wrapper.find('.chat-message__stream-dot').exists()).toBe(true);
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

  it('renders one work disclosure across assistant segments in the same steered turn', async () => {
    const initialUserMessage: SurfaceMessage = {
      id: 'user-turn-1',
      role: 'user',
      status: 'complete',
      turnId: 'turn-1',
      parts: [{ type: 'text', text: 'Run the full test.' }],
    };
    const firstToolSegment: SurfaceMessage = {
      id: 'assistant-turn-1',
      role: 'assistant',
      status: 'streaming',
      turnId: 'turn-1',
      parts: [{
        type: 'tool',
        id: 'tool-1',
        title: 'shell',
        status: 'running',
        input: { command: 'npm test' },
      }],
    };
    const turnMessages: SurfaceMessage[] = [
      initialUserMessage,
      {
        ...firstToolSegment,
        status: 'complete',
        parts: [{
          type: 'tool',
          id: 'tool-1',
          title: 'shell',
          status: 'completed',
          input: { command: 'npm test' },
        }],
      },
      {
        id: 'steer-turn-1',
        kind: 'steer',
        role: 'user',
        status: 'complete',
        turnId: 'turn-1',
        parts: [{ type: 'text', text: 'Also check the tests.' }],
      },
      {
        id: 'assistant-turn-1-segment-1',
        role: 'assistant',
        status: 'streaming',
        turnId: 'turn-1',
        parts: [{ type: 'text', text: 'Checking those now.', phase: 'commentary' }],
      },
      {
        id: 'steer-turn-1-again',
        kind: 'steer',
        role: 'user',
        status: 'complete',
        turnId: 'turn-1',
        parts: [{ type: 'text', text: 'Keep this in the same turn.' }],
      },
      {
        id: 'assistant-turn-1-segment-2',
        role: 'assistant',
        status: 'streaming',
        turnId: 'turn-1',
        parts: [{
          type: 'reasoning',
          itemId: 'reasoning-turn-1-segment-2',
          summary: 'Verifying the shared turn state.',
          summaryIndex: 0,
        }],
      },
    ];
    const wrapper = mount(CodexMessageList, {
      props: { busy: true, messages: [initialUserMessage, firstToolSegment] },
    });

    expect(wrapper.findAll('.codex-message-turn')).toHaveLength(1);
    expect(wrapper.text()).toContain('Run the full test.');
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(wrapper.get('.chat-work-group .chat-fold').classes()).toContain('chat-fold--open');

    await wrapper.setProps({ messages: turnMessages });

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Working']);
    expect(wrapper.findAll('.chat-work-group .chat-fold--open')).toHaveLength(1);
    expect(wrapper.text()).toContain('Also check the tests.');
    expect(wrapper.text()).toContain('Keep this in the same turn.');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message__stream-dot')).toHaveLength(1);

    await wrapper.setProps({
      busy: false,
      messages: turnMessages.map((message) => message.id === 'assistant-turn-1-segment-2'
        ? {
            ...message,
            status: 'complete' as const,
            parts: [
              ...message.parts,
              { type: 'text' as const, text: 'The turn is complete.', phase: 'final_answer' as const },
            ],
          }
        : { ...message, status: 'complete' as const }),
    });

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Done · View details']);
    expect(wrapper.findAll('.chat-work-group .chat-fold--open')).toHaveLength(0);
    expect(wrapper.findAll('.chat-work-group--continuation')).toHaveLength(0);
    expect(wrapper.text()).toContain('The turn is complete.');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(0);
    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(2);

    await wrapper.get('.chat-work-group__header').trigger('click');

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
    expect(wrapper.findAll('.chat-work-group--continuation')).toHaveLength(2);
    expect(wrapper.text()).toContain('Checking those now.');
    expect(wrapper.text()).toContain('Verifying the shared turn state.');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(3);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(2);
  });

  it('keeps the current turn working while busy before its next assistant segment arrives', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        busy: true,
        messages: [
          {
            id: 'assistant-before-gap',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-busy-gap',
            parts: [{ type: 'text', text: 'I am checking this.', phase: 'commentary' }],
          },
          {
            id: 'steer-before-gap',
            kind: 'steer',
            role: 'user',
            status: 'complete',
            turnId: 'turn-busy-gap',
            parts: [{ type: 'text', text: 'Also check the pending state.' }],
          },
        ],
      },
    });

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Working']);
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(1);
    expect(wrapper.findAll('.chat-message__thinking')).toHaveLength(1);
  });

  it('uses the explicit active turn instead of inferring lifecycle from global busy state', () => {
    const workMessage: SurfaceMessage = {
      id: 'explicit-turn-work',
      role: 'assistant',
      status: 'complete',
      turnId: 'turn-explicit',
      parts: [{ type: 'text', text: 'Checking.', phase: 'commentary' }],
    };
    const active = mount(CodexMessageList, {
      props: { activeTurnId: 'turn-explicit', busy: false, messages: [workMessage] },
    });
    const idle = mount(CodexMessageList, {
      props: { activeTurnId: null, busy: true, messages: [workMessage] },
    });

    expect(active.get('.chat-work-group__title').text()).toBe('Working');
    expect(idle.find('.chat-work-group__title').exists()).toBe(false);
    expect(idle.text()).toContain('Checking.');
  });

  it('reopens a completed turn when an async answer resumes assistant streaming', async () => {
    const completedMessages: SurfaceMessage[] = [{
      id: 'assistant-before-async-answer',
      role: 'assistant',
      status: 'complete',
      turnId: 'turn-async-answer',
      parts: [
        { type: 'text', text: 'I need one detail first.', phase: 'commentary' },
        { type: 'text', text: 'Choose where to run it.', phase: 'final_answer' },
      ],
    }];
    const wrapper = mount(CodexMessageList, {
      props: {
        activeTurnId: null,
        busy: false,
        messages: completedMessages,
        turns: [turnLifecycle('turn-async-answer', 'completed')],
      },
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.get('.chat-work-group__header').attributes('aria-expanded')).toBe('false');

    const resumedMessages: SurfaceMessage[] = [
      ...completedMessages,
      {
        id: 'async-answer',
        kind: 'steer',
        role: 'user',
        status: 'complete',
        turnId: 'turn-async-answer',
        parts: [{ type: 'text', text: 'Run it locally.' }],
      },
      {
        id: 'assistant-after-async-answer',
        role: 'assistant',
        status: 'streaming',
        turnId: 'turn-async-answer',
        parts: [{ type: 'text', text: 'Preparing the local workflow.', phase: 'commentary' }],
      },
    ];
    await wrapper.setProps({ busy: true, messages: resumedMessages });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(wrapper.get('.chat-work-group__header').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.chat-work-group__header').attributes()).toHaveProperty('disabled');
    expect(wrapper.text()).toContain('Preparing the local workflow.');

    const finishedMessages: SurfaceMessage[] = resumedMessages.map((message) => (
      message.id === 'assistant-after-async-answer'
        ? {
            ...message,
            status: 'complete',
            parts: [
              ...message.parts,
              { type: 'text', text: 'The local workflow is ready.', phase: 'final_answer' },
            ],
          }
        : message
    ));
    await wrapper.setProps({ busy: false, messages: finishedMessages });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.get('.chat-work-group__header').attributes('aria-expanded')).toBe('false');
    expect(wrapper.text()).toContain('The local workflow is ready.');
  });

  it('keeps unphased streaming text and tools on the flat rendering path', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        busy: true,
        messages: [{
          id: 'assistant-unphased-tool',
          role: 'assistant',
          status: 'streaming',
          turnId: 'turn-unphased',
          parts: [
            { type: 'text', text: 'Claude is checking the file.' },
            { type: 'tool', id: 'tool-read', title: 'read', status: 'running' },
          ],
        }],
      },
    });

    expect(wrapper.find('.chat-work-group').exists()).toBe(false);
    expect(wrapper.text()).toContain('Claude is checking the file.');
    expect(wrapper.text()).toContain('Running read');
  });

  it('uses visible commentary as the turn disclosure when tool blocks are hidden', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [
          {
            id: 'assistant-hidden-tool',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-hidden-tool',
            parts: [{ type: 'tool', id: 'hidden-tool', title: 'npm test', status: 'completed' }],
          },
          {
            id: 'assistant-visible-commentary',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-hidden-tool',
            parts: [{ type: 'text', text: 'Finished the verification.', phase: 'commentary' }],
          },
          {
            id: 'assistant-visible-answer',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-hidden-tool',
            parts: [{ type: 'text', text: 'Everything passed.', phase: 'final_answer' }],
          },
        ],
        presentation: { messages: { toolBlocks: false } },
      },
    });

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Done · View details']);
    expect(wrapper.text()).not.toContain('npm test');
    expect(wrapper.get('.chat-work-group').text()).toContain('Finished the verification.');
    expect(wrapper.get('.chat-work-group .chat-fold').classes()).not.toContain('chat-fold--open');
    expect(wrapper.text()).toContain('Everything passed.');
    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(1);
  });

  it('keeps generated media in order while active and folds it with completed work', async () => {
    const activeMessage: SurfaceMessage = {
      id: 'assistant-image-turn',
      role: 'assistant',
      status: 'streaming',
      turnId: 'turn-image',
      parts: [
        { type: 'text', text: 'Generating the image.', phase: 'commentary' },
        {
          type: 'tool', id: 'image-1', title: 'image_generation', status: 'completed',
        },
        {
          type: 'media', itemId: 'image-1',
          media: { url: 'data:image/png;base64,cG5n', title: 'Generated image' },
        },
        { type: 'text', text: 'Checking the generated result.', phase: 'commentary' },
      ],
    };
    const wrapper = mount(CodexMessageList, {
      props: {
        activeTurnId: 'turn-image',
        busy: true,
        messages: [activeMessage],
      },
    });

    const media = wrapper.get('.chat-media-block').element;
    const laterCommentary = wrapper.findAll('.chat-message-block--text')
      .find((block) => block.text().includes('Checking the generated result.'))?.element;

    expect(laterCommentary).toBeDefined();
    expect(media.compareDocumentPosition(laterCommentary!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(wrapper.findAll('.chat-work-group__header')).toHaveLength(1);

    await wrapper.setProps({
      activeTurnId: null,
      busy: false,
      messages: [{
        ...activeMessage,
        status: 'complete',
        parts: [
          ...activeMessage.parts,
          { type: 'text', text: 'The image is ready.', phase: 'final_answer' },
        ],
      }],
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.get('.chat-media-block').element.closest('.chat-fold')?.classList)
      .not.toContain('chat-fold--open');
    expect(wrapper.text()).toContain('The image is ready.');

    await wrapper.get('.chat-work-group__header').trigger('click');

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
    expect(wrapper.get('.chat-media-block').element.closest('.chat-fold')?.classList)
      .toContain('chat-fold--open');
  });

  it('does not render an empty row for a hidden tool segment in an active turn', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        busy: true,
        messages: [
          {
            id: 'assistant-hidden-active-tool',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-hidden-active-tool',
            parts: [{ type: 'tool', id: 'hidden-active-tool', title: 'npm test', status: 'completed' }],
          },
          {
            id: 'assistant-visible-active-commentary',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-hidden-active-tool',
            parts: [{ type: 'text', text: 'Still checking.', phase: 'commentary' }],
          },
        ],
        presentation: { messages: { toolBlocks: false } },
      },
    });

    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(1);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(0);
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
  });

  it('shows completed work directly when a turn has no final answer', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [
          {
            id: 'assistant-no-summary-work',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-no-summary',
            parts: [
              { type: 'tool', id: 'tool-no-summary', title: 'npm test', status: 'completed' },
              { type: 'text', text: 'Finished the verification.', phase: 'commentary' },
            ],
          },
          {
            id: 'steer-no-summary',
            kind: 'steer',
            role: 'user',
            status: 'complete',
            turnId: 'turn-no-summary',
            parts: [{ type: 'text', text: 'Also check the docs.' }],
          },
          {
            id: 'assistant-no-summary-work-two',
            role: 'assistant',
            status: 'complete',
            turnId: 'turn-no-summary',
            parts: [{ type: 'text', text: 'The docs are current.', phase: 'commentary' }],
          },
        ],
      },
    });

    expect(wrapper.find('.chat-work-group__header').exists()).toBe(false);
    expect(wrapper.text()).toContain('Finished the verification.');
    expect(wrapper.text()).toContain('The docs are current.');
    expect(wrapper.text()).not.toContain('Also check the docs.');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(0);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(0);
  });

  it('keeps a completed turn disclosure reachable while toggling its details', async () => {
    let resizeCallback: ResizeObserverCallback = () => undefined;
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', class MockResizeObserver {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}

      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
    });
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [{
          id: 'assistant-toggle-details',
          role: 'assistant',
          status: 'complete',
          turnId: 'turn-toggle-details',
          parts: [
            { type: 'tool', id: 'tool-toggle-details', title: 'npm test', status: 'completed' },
            { type: 'text', text: 'Finished the verification.', phase: 'commentary' },
            { type: 'text', text: 'Everything passed.', phase: 'final_answer' },
          ],
        }],
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollHeight = 1_000;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 700;

    await wrapper.get('.chat-work-group__header').trigger('click');
    scrollHeight = 2_000;
    resizeCallback([], {} as ResizeObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
    expect(scrollEl.scrollTop).toBe(700);

    await wrapper.get('.chat-work-group__header').trigger('click');
    scrollHeight = 1_000;
    resizeCallback([], {} as ResizeObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(scrollEl.scrollTop).toBe(700);
    wrapper.unmount();
  });

  it('ignores queued bottom-follow work after the reader opens turn details', async () => {
    let resizeCallback: ResizeObserverCallback = () => undefined;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', class MockResizeObserver {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}

      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [{
          id: 'assistant-pending-scroll',
          role: 'assistant',
          status: 'complete',
          turnId: 'turn-pending-scroll',
          parts: [
            { type: 'text', text: 'Finished the verification.', phase: 'commentary' },
            { type: 'text', text: 'Everything passed.', phase: 'final_answer' },
          ],
        }],
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollHeight = 1_000;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    await flushPromises();
    frames.shift()?.(0);
    scrollEl.scrollTop = 700;

    resizeCallback([], {} as ResizeObserver);
    expect(frames).toHaveLength(1);
    await wrapper.get('.chat-work-group__header').trigger('click');
    scrollHeight = 2_000;
    frames.shift()?.(0);

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
    expect(scrollEl.scrollTop).toBe(700);
    wrapper.unmount();
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

  it('keeps the latest completed assistant actions visible when a user follows it', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: [
          { role: 'assistant', content: 'Answer' },
          { role: 'user', content: 'Follow up' },
        ],
      },
    });

    const rows = wrapper.findAll('.chat-message');
    expect(rows[0]?.classes()).toContain('chat-message--actions-visible');
    expect(rows[1]?.classes()).not.toContain('chat-message--actions-visible');
  });

  it('does not mark any user action row as persistently visible without an assistant response', () => {
    const wrapper = mount(CodexMessageList, {
      props: { messages: makeMessages(2) },
    });

    expect(wrapper.findAll('.chat-message')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message--actions-visible')).toHaveLength(0);
  });

  it.each([
    ['a completed legacy response', { role: 'assistant', content: 'Done', streaming: false }, true],
    ['a streaming legacy response', { role: 'assistant', content: 'Working', streaming: true }, false],
    ['a completed surface response', {
      id: 'surface-complete-actions', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Done' }],
    }, true],
    ['a streaming surface response', {
      id: 'surface-streaming-actions', role: 'assistant', status: 'streaming', parts: [{ type: 'text', text: 'Working' }],
    }, false],
  ])('marks actions as persistently visible for %s only after completion', (_label, message, expected) => {
    const wrapper = mount(CodexMessageList, { props: { messages: [message] } as never });

    expect(wrapper.get('.chat-message').classes().includes('chat-message--actions-visible')).toBe(expected);
  });

  it('forwards provider capability flags to message actions', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        canDeleteTurn: false,
        canEditTurn: false,
        canRetryTurn: false,
        messages,
      },
    });

    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Quote"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Edit"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(false);
  });

  it('offers turn mutations on every terminal turn but not the active turn', async () => {
    const turnMessages: SurfaceMessage[] = [
      { id: 'old-user', role: 'user', status: 'complete', turnId: 'turn-old', parts: [{ type: 'text', text: 'Old' }] },
      { id: 'old-answer', role: 'assistant', status: 'complete', turnId: 'turn-old', parts: [{ type: 'text', text: 'Old answer' }] },
      { id: 'latest-user', role: 'user', status: 'complete', turnId: 'turn-latest', parts: [{ type: 'text', text: 'Latest' }] },
      { id: 'latest-answer', role: 'assistant', status: 'complete', turnId: 'turn-latest', parts: [{ type: 'text', text: 'Latest answer' }] },
      { id: 'active-user', role: 'user', status: 'complete', turnId: 'turn-active', parts: [{ type: 'text', text: 'Active' }] },
      { id: 'active-answer', role: 'assistant', status: 'streaming', turnId: 'turn-active', parts: [] },
    ];
    const turns: CodexSurfaceTurn[] = [
      turnLifecycle('turn-old', 'completed'),
      turnLifecycle('turn-latest', 'completed'),
      turnLifecycle('turn-active', 'inProgress'),
    ];
    const wrapper = mount(CodexMessageList, {
      props: {
        activeTurnId: 'turn-active',
        busy: false,
        canForkTurn: true,
        messages: turnMessages,
        turns,
      },
    });
    const rendered = wrapper.findAllComponents(CodexMessage);

    expect(rendered[0]!.get('[aria-label="Edit"]').attributes('disabled')).toBeUndefined();
    expect(rendered[0]!.get('[aria-label="Fork"]').attributes('disabled')).toBeUndefined();
    expect(rendered[0]!.get('[aria-label="Delete"]').attributes('disabled')).toBeUndefined();
    expect(rendered[1]!.get('[aria-label="Retry"]').attributes('disabled')).toBeUndefined();
    expect(rendered[1]!.get('[aria-label="Fork"]').attributes('disabled')).toBeUndefined();
    expect(rendered[1]!.get('[aria-label="Delete"]').attributes('disabled')).toBeUndefined();
    expect(rendered[2]!.get('[aria-label="Edit"]').attributes('disabled')).toBeUndefined();
    expect(rendered[2]!.get('[aria-label="Delete"]').attributes('disabled')).toBeUndefined();
    expect(rendered[3]!.get('[aria-label="Retry"]').attributes('disabled')).toBeUndefined();
    expect(rendered[3]!.get('[aria-label="Delete"]').attributes('disabled')).toBeUndefined();
    expect(rendered[4]!.find('[aria-label="Delete"]').exists()).toBe(false);
    expect(rendered[5]!.find('[aria-label="Retry"]').exists()).toBe(false);

    await rendered[1]!.get('[aria-label="Delete"]').trigger('click');
    await rendered[1]!.get('[aria-label="Retry"]').trigger('click');
    await rendered[1]!.get('[aria-label="Fork"]').trigger('click');
    expect(wrapper.emitted('delete-turn')).toStrictEqual([['turn-old']]);
    expect(wrapper.emitted('retry-turn')).toStrictEqual([['turn-old']]);
    expect(wrapper.emitted('fork-turn')).toStrictEqual([['turn-old']]);
  });

  it('infers historical turns as terminal when a controlled host omits turn lifecycle metadata', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        activeTurnId: 'turn-active',
        canForkTurn: true,
        messages: [
          { id: 'old-user', role: 'user', status: 'complete', turnId: 'turn-old', parts: [{ type: 'text', text: 'Old' }] },
          { id: 'old-answer', role: 'assistant', status: 'complete', turnId: 'turn-old', parts: [{ type: 'text', text: 'Old answer' }] },
          { id: 'active-user', role: 'user', status: 'complete', turnId: 'turn-active', parts: [{ type: 'text', text: 'Active' }] },
          { id: 'active-answer', role: 'assistant', status: 'streaming', turnId: 'turn-active', parts: [] },
        ],
      },
    });
    const rendered = wrapper.findAllComponents(CodexMessage);

    expect(rendered[0]!.find('[aria-label="Edit"]').exists()).toBe(true);
    expect(rendered[0]!.find('[aria-label="Delete"]').exists()).toBe(true);
    expect(rendered[1]!.find('[aria-label="Retry"]').exists()).toBe(true);
    expect(rendered[1]!.find('[aria-label="Fork"]').exists()).toBe(true);
    expect(rendered[2]!.find('[aria-label="Delete"]').exists()).toBe(false);
    expect(rendered[3]!.find('[aria-label="Retry"]').exists()).toBe(false);
  });

  it('does not offer fork for a latest failed turn', () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        canForkTurn: true,
        messages: [
          { id: 'failed-user', role: 'user', status: 'complete', turnId: 'turn-failed', parts: [{ type: 'text', text: 'Try' }] },
          { id: 'failed-answer', role: 'assistant', status: 'complete', turnId: 'turn-failed', parts: [{ type: 'text', text: 'Failed' }] },
        ],
        turns: [turnLifecycle('turn-failed', 'failed')],
      },
    });

    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Fork"]').exists()).toBe(false);
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

  it('normalizes zero and fractional lazy batch sizes before rendering and paging', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        initialMessageBatchSize: 0,
        lazyMessages: true,
        messageBatchSize: 1.9,
        messages: makeMessages(3),
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual(['message-2']);
    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-1',
      'message-2',
    ]);
    wrapper.unmount();
  });

  it('aligns lazy rendering batches to complete turn boundaries', async () => {
    const turnMessages: SurfaceMessage[] = [
      {
        id: 'earlier-turn-answer',
        role: 'assistant',
        status: 'complete',
        turnId: 'earlier-turn',
        parts: [{ type: 'text', text: 'Earlier answer.' }],
      },
      {
        id: 'lazy-turn-tool',
        role: 'assistant',
        status: 'complete',
        turnId: 'lazy-turn',
        parts: [{ type: 'tool', id: 'lazy-tool', title: 'read', status: 'completed' }],
      },
      {
        id: 'lazy-turn-steer',
        kind: 'steer',
        role: 'user',
        status: 'complete',
        turnId: 'lazy-turn',
        parts: [{ type: 'text', text: 'Inspect the earlier segment too.' }],
      },
      {
        id: 'lazy-turn-answer',
        role: 'assistant',
        status: 'complete',
        turnId: 'lazy-turn',
        parts: [
          { type: 'text', text: 'I inspected the visible segment.', phase: 'commentary' },
          { type: 'text', text: 'Finished.', phase: 'final_answer' },
        ],
      },
    ];
    const wrapper = mount(CodexMessageList, {
      props: {
        initialMessageBatchSize: 2,
        messageBatchSize: 1,
        messages: turnMessages,
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(3);
    expect(wrapper.text()).not.toContain('Earlier answer.');

    await wrapper.get('.chat-work-group__header').trigger('click');
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(4);
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
    expect(wrapper.text()).toContain('Ran read');
    wrapper.unmount();
  });

  it('retains the genuine conversation tail while repeatedly revealing older messages', async () => {
    const allMessages = makeMessages(120);
    const wrapper = mount(CodexMessageList, {
      props: { messages: allMessages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    for (let page = 0; page < 4; page += 1) {
      expect(wrapper.findAllComponents(CodexMessage).at(-1)?.props('message').id).toBe('message-119');
      scrollEl.scrollTop = 0;
      await wrapper.get('.message-list').trigger('scroll');
      await flushPromises();
    }

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toEqual(
      allMessages.map((message) => message.id),
    );
    wrapper.unmount();
  });

  it('requests older server history one viewport before reaching the top', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { hasOlderMessages: true, messages: makeMessages(10) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1_200 });

    scrollEl.scrollTop = 301;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toBeUndefined();

    scrollEl.scrollTop = 300;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);
    wrapper.unmount();
  });

  it.each([5, 10])('never pages or requests server history while eager rendering is active with %i messages', async (messageCount) => {
    const wrapper = mount(CodexMessageList, {
      props: {
        hasOlderMessages: true,
        messageBatchSize: 5,
        messages: makeMessages(messageCount),
        renderStrategy: 'eager',
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1_000 });

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(messageCount);
    expect(wrapper.emitted('load-older-messages')).toBeUndefined();
    wrapper.unmount();
  });

  it('requests server history only after the final in-memory batch is revealed', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        hasOlderMessages: true,
        initialMessageBatchSize: 5,
        messageBatchSize: 5,
        messages: makeMessages(20),
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    for (const expectedCount of [10, 15]) {
      scrollEl.scrollTop = 0;
      await wrapper.get('.message-list').trigger('scroll');
      await flushPromises();
      expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(expectedCount);
      expect(wrapper.emitted('load-older-messages')).toBeUndefined();
    }
    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(20);
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);
    wrapper.unmount();
  });

  it('does not request another server page while the current page is loading', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        hasOlderMessages: true,
        initialMessageBatchSize: 5,
        loadingOlderMessages: true,
        messageBatchSize: 5,
        messages: makeMessages(10),
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(10);
    expect(wrapper.emitted('load-older-messages')).toBeUndefined();
    wrapper.unmount();
  });

  it('coalesces synchronous upward scroll events into one in-memory page', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messageBatchSize: 5, messages: makeMessages(20) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });
    scrollEl.scrollTop = 0;

    scrollEl.dispatchEvent(new Event('scroll'));
    scrollEl.dispatchEvent(new Event('scroll'));
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(10);
    wrapper.unmount();
  });

  it('does not rewrite scroll position when no earlier in-memory messages exist', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { lazyMessages: true, messages: makeMessages(51) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollTop = 0;
    const writeScrollTop = vi.fn((value: number) => { scrollTop = value; });
    Object.defineProperty(scrollEl, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: writeScrollTop,
    });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1_000 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(50);
    scrollEl.scrollTop = 0;
    writeScrollTop.mockClear();
    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(51);
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 0;
    writeScrollTop.mockClear();

    await wrapper.get('.message-list').trigger('scroll');
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeScrollTop).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('prefetches one server page when revealing the final in-memory batch', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        hasOlderMessages: true,
        lazyMessages: true,
        messageBatchSize: 5,
        messages: makeMessages(10),
      },
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

    expect(wrapper.findAll('.chat-message')).toHaveLength(10);
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);

    await wrapper.setProps({ loadingOlderMessages: true });
    await wrapper.setProps({ loadingOlderMessages: false });
    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[], []]);
    wrapper.unmount();
  });

  it('releases the server-history request lock when loading completes or older history disappears', async () => {
    const wrapper = mount(CodexMessageList, {
      props: { hasOlderMessages: true, lazyMessages: true, messageBatchSize: 5, messages: makeMessages(5) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1_000 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);

    await wrapper.setProps({ loadingOlderMessages: true });
    await wrapper.setProps({ loadingOlderMessages: false });
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[], []]);

    await wrapper.setProps({ hasOlderMessages: false });
    await wrapper.setProps({ hasOlderMessages: true });
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[], [], []]);
    wrapper.unmount();
  });

  it('recomputes the visible window when render strategy and batch size change', async () => {
    const allMessages = makeMessages(8);
    const wrapper = mount(CodexMessageList, {
      props: { messageBatchSize: 3, messages: allMessages, renderStrategy: 'lazy' },
    });

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-5',
      'message-6',
      'message-7',
    ]);

    await wrapper.setProps({ renderStrategy: 'eager' });
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(8);
    expect(wrapper.findAllComponents(CodexMessage)[0]!.props('message').id).toBe('message-0');

    await wrapper.setProps({ renderStrategy: 'lazy' });
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage)[0]!.props('message').id).toBe('message-5');

    await wrapper.setProps({ messageBatchSize: 4 });
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-4',
      'message-5',
      'message-6',
      'message-7',
    ]);
  });

  it('preserves public slot identity and absolute indexes when switching from lazy to eager', async () => {
    const transformedIndexes: number[] = [];
    const createdFor: string[] = [];
    const StatefulMessage = defineComponent({
      props: { content: { required: true, type: String } },
      setup(props) {
        const mountedFor = props.content;
        createdFor.push(mountedFor);
        return () => h('p', { class: 'stateful-message' }, `${mountedFor} -> ${props.content}`);
      },
    });
    const wrapper = mount(CodexMessageList, {
      props: {
        initialMessageBatchSize: 2,
        messages: makeMessages(4).map(({ id: _id, ...message }) => message),
        renderStrategy: 'lazy',
        transformMessage(message, index) {
          transformedIndexes.push(index);
          return message;
        },
      },
      slots: {
        message: ({ index, message }: { index: number; message: Message }) => h('section', {
          'class': 'slotted-message',
          'data-index': index,
        }, [h(StatefulMessage, { content: message.content })]),
      },
    });

    expect(wrapper.findAll('.slotted-message').map((row) => row.attributes('data-index'))).toStrictEqual(['2', '3']);
    expect(transformedIndexes).toStrictEqual([2, 3]);
    transformedIndexes.length = 0;

    await wrapper.setProps({ renderStrategy: 'eager' });

    expect(wrapper.findAll('.slotted-message').map((row) => row.attributes('data-index'))).toStrictEqual([
      '0', '1', '2', '3',
    ]);
    expect(transformedIndexes).toStrictEqual([0, 1, 2, 3]);
    expect(wrapper.findAll('.stateful-message').map((row) => row.text())).toStrictEqual([
      'Message 0 -> Message 0',
      'Message 1 -> Message 1',
      'Message 2 -> Message 2',
      'Message 3 -> Message 3',
    ]);
    expect(createdFor).toStrictEqual(['Message 2', 'Message 3', 'Message 0', 'Message 1']);
  });

  it('preserves an eager transcript position when older messages are prepended', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const currentMessages = makeMessages(60);
    const olderMessages = makeMessages(10, -10);
    const wrapper = mount(CodexMessageList, {
      props: { messages: currentMessages, renderStrategy: 'eager' },
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
    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');

    await wrapper.setProps({ messages: [...olderMessages, ...currentMessages] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(70);
    expect(wrapper.findAllComponents(CodexMessage)[0]!.props('message').id).toBe('message--10');
    expect(scrollEl.scrollTop).toBe(100);
    wrapper.unmount();
  });

  it('does not scroll an eager transcript when its unused batch size changes', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { messageBatchSize: 5, messages: makeMessages(10), renderStrategy: 'eager' },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1_000 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 100;

    await wrapper.setProps({ messageBatchSize: 6 });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(10);
    expect(scrollEl.scrollTop).toBe(100);
    wrapper.unmount();
  });

  it('keeps lazy batch reconfiguration at the bottom without dragging an unstuck transcript', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { messageBatchSize: 5, messages: makeMessages(10) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollTop = 0;
    const writeScrollTop = vi.fn((value: number) => { scrollTop = value; });
    Object.defineProperty(scrollEl, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: writeScrollTop,
    });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wrapper.setProps({ messageBatchSize: 6 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(6);
    expect(scrollEl.scrollTop).toBe(600);

    scrollEl.scrollTop = 0;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('stickiness-change')).toContainEqual([false]);
    writeScrollTop.mockClear();
    await wrapper.setProps({ messageBatchSize: 4 });
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(4);
    expect(writeScrollTop).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('refreshes message boundaries when lazy batch configuration replaces a conversation', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const replacement = makeMessages(5, 100);
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messageBatchSize: 4, messages: makeMessages(5) },
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

    await wrapper.setProps({ initialMessageBatchSize: 6, messages: replacement });
    await flushPromises();
    scrollEl.scrollTop = 0;
    await wrapper.setProps({ messages: [...replacement, ...makeMessages(2, 105)] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(7);
    expect(scrollEl.scrollTop).toBe(0);
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

  it('keeps an early server prepend outside the window while local history remains', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const currentMessages = makeMessages(20);
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messageBatchSize: 5, messages: currentMessages },
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

    await wrapper.setProps({ messages: [...makeMessages(5, -5), ...currentMessages] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-15', 'message-16', 'message-17', 'message-18', 'message-19',
    ]);
    expect(scrollEl.scrollTop).toBe(0);
    wrapper.unmount();
  });

  it('reveals server-prepended history when the rendered window is already at the top', async () => {
    const currentMessages = makeMessages(5);
    const olderMessages = makeMessages(10, -10);
    const wrapper = mount(CodexMessageList, {
      props: {
        hasOlderMessages: true,
        lazyMessages: true,
        messageBatchSize: 5,
        messages: currentMessages,
      },
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

    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);

    await wrapper.setProps({
      loadingOlderMessages: true,
      messages: [...olderMessages, ...currentMessages],
    });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toEqual([
      ...olderMessages.slice(-5).map((message) => message.id),
      ...currentMessages.map((message) => message.id),
    ]);
    expect(scrollEl.scrollTop).toBe(600);
    wrapper.unmount();
  });

  it('does not mistake an append for another prepend after history reconciliation', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const currentMessages = makeMessages(10);
    const olderMessages = makeMessages(10, -10);
    const wrapper = mount(CodexMessageList, {
      props: { messageBatchSize: 10, messages: currentMessages },
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

    await wrapper.setProps({ messages: [...olderMessages, ...currentMessages] });
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual(
      currentMessages.map((message) => message.id),
    );

    scrollEl.scrollTop = 0;
    await wrapper.setProps({ messages: [...olderMessages, ...currentMessages, makeMessages(1, 10)[0]!] });

    expect(wrapper.findAllComponents(CodexMessage)[0]!.props('message').id).toBe(currentMessages[0]!.id);
    expect(wrapper.text()).not.toContain('Message -10');
    wrapper.unmount();
  });

  it('preserves the visible anchor when a hidden head is trimmed and the tail grows', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const allMessages = makeMessages(10);
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messages: allMessages },
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

    await wrapper.setProps({
      messages: [...allMessages.slice(5), ...makeMessages(6, 10)],
    });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)[0]?.props('message').id).toBe('message-5');
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(11);
    expect(scrollEl.scrollTop).toBe(0);
    wrapper.unmount();
  });

  it('preserves expanded context when a message is inserted away from either edge', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const allMessages = makeMessages(10);
    const inserted: Message = { id: 'message-middle', role: 'user', content: 'Inserted middle message' };
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messages: allMessages },
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
    scrollEl.scrollTop = 200;

    await wrapper.setProps({
      messages: [...allMessages.slice(0, 8), inserted, ...allMessages.slice(8)],
    });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-5', 'message-6', 'message-7', 'message-middle', 'message-8', 'message-9',
    ]);
    wrapper.unmount();
  });

  it('retains the latest observed tail identity across consecutive growth updates', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const initialMessages = makeMessages(10);
    const appendedMessages = [...initialMessages, makeMessages(1, 10)[0]!];
    const inserted: Message = { id: 'message-middle-after-append', role: 'user', content: 'Inserted later' };
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messages: initialMessages },
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
    scrollEl.scrollTop = 200;

    await wrapper.setProps({ messages: appendedMessages });
    await flushPromises();
    scrollEl.scrollTop = 200;
    await wrapper.setProps({
      messages: [...appendedMessages.slice(0, 8), inserted, ...appendedMessages.slice(8)],
    });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-6',
      'message-7',
      'message-middle-after-append',
      'message-8',
      'message-9',
      'message-10',
    ]);
    wrapper.unmount();
  });

  it('refreshes message boundaries after replacing a transcript with a shorter one', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const replacement = makeMessages(5, 100);
    const wrapper = mount(CodexMessageList, {
      props: { messageBatchSize: 5, messages: makeMessages(10) },
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

    await wrapper.setProps({ messages: replacement });
    await flushPromises();
    scrollEl.scrollTop = 0;
    await wrapper.setProps({ messages: [...replacement, makeMessages(1, 105)[0]!] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(6);
    expect(scrollEl.scrollTop).toBe(0);
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

  it('keeps a fully revealed local window intact when a new tail message arrives', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const allMessages = makeMessages(10);
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messageBatchSize: 5, messages: allMessages },
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
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(10);

    scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    await wrapper.get('.message-list').trigger('scroll');
    await wrapper.setProps({ messages: [...allMessages, makeMessages(1, 10)[0]!] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual(
      makeMessages(11).map((message) => message.id),
    );
    wrapper.unmount();
  });

  it('does not apply prepend anchoring when a transcript shrinks away from the bottom', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { initialMessageBatchSize: 5, messages: makeMessages(10) },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollTop = 0;
    const writeScrollTop = vi.fn((value: number) => { scrollTop = value; });
    Object.defineProperty(scrollEl, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: writeScrollTop,
    });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => wrapper.findAll('.chat-message').length * 100,
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 0;
    writeScrollTop.mockClear();

    await wrapper.setProps({ messages: makeMessages(4, 100) });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-100', 'message-101', 'message-102', 'message-103',
    ]);
    expect(scrollEl.scrollTop).toBe(0);
    expect(writeScrollTop).not.toHaveBeenCalled();
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

  it('restores the lazy tail and server-history eligibility when the conversation resets', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: {
        hasOlderMessages: true,
        messageBatchSize: 5,
        messages: makeMessages(15),
        resetKey: 'thread-a',
      },
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

    for (let page = 0; page < 2; page += 1) {
      scrollEl.scrollTop = 0;
      await wrapper.get('.message-list').trigger('scroll');
      await flushPromises();
    }
    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(15);
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[]]);
    const threadAScrollTop = scrollEl.scrollTop;

    await wrapper.setProps({ resetKey: 'thread-b' });
    await flushPromises();
    expect(wrapper.findAllComponents(CodexMessage).map((row) => row.props('message').id)).toStrictEqual([
      'message-10',
      'message-11',
      'message-12',
      'message-13',
      'message-14',
    ]);

    for (let page = 0; page < 2; page += 1) {
      scrollEl.scrollTop = 0;
      await wrapper.get('.message-list').trigger('scroll');
      await flushPromises();
    }
    expect(wrapper.emitted('load-older-messages')).toStrictEqual([[], []]);

    await wrapper.setProps({ resetKey: 'thread-a' });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(15);
    expect(scrollEl.scrollTop).toBe(threadAScrollTop);
    wrapper.unmount();
  });

  it('refreshes message boundaries when resetting to a same-length conversation', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const replacement = makeMessages(5, 100);
    const wrapper = mount(CodexMessageList, {
      props: { messageBatchSize: 5, messages: makeMessages(5), resetKey: 'thread-a' },
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

    await wrapper.setProps({ messages: replacement, resetKey: 'thread-b' });
    await flushPromises();
    scrollEl.scrollTop = 0;
    await wrapper.setProps({ messages: [...replacement, makeMessages(1, 105)[0]!] });
    await flushPromises();

    expect(wrapper.findAllComponents(CodexMessage)).toHaveLength(6);
    expect(scrollEl.scrollTop).toBe(0);
    wrapper.unmount();
  });

  it('forwards message action events from chat messages', async () => {
    const wrapper = mount(CodexMessageList, {
      props: {
        messages,
      },
    });
    const chatMessage = wrapper.getComponent(CodexMessage);
    const clientResponse = { id: 'approval-1', payload: { decision: 'allow' } };
    const editPayload = { content: 'Updated prompt', turnId: 'turn-1' };

    chatMessage.vm.$emit('cancel');
    chatMessage.vm.$emit('client-response', clientResponse);
    chatMessage.vm.$emit('copy-message', 0);
    chatMessage.vm.$emit('delete-turn', 'turn-1');
    chatMessage.vm.$emit('edit-turn', editPayload);
    chatMessage.vm.$emit('quote-message', 0);
    chatMessage.vm.$emit('retry-turn', 'turn-1');
    chatMessage.vm.$emit('send-follow-up', 'Open the failing file');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(wrapper.emitted('client-response')).toStrictEqual([[clientResponse]]);
    expect(wrapper.emitted('copy-message')).toStrictEqual([[0]]);
    expect(wrapper.emitted('delete-turn')).toStrictEqual([['turn-1']]);
    expect(wrapper.emitted('edit-turn')).toStrictEqual([[editPayload]]);
    expect(wrapper.emitted('quote-message')).toStrictEqual([[0]]);
    expect(wrapper.emitted('retry-turn')).toStrictEqual([['turn-1']]);
    expect(wrapper.emitted('send-follow-up')).toStrictEqual([['Open the failing file']]);
  });

  it('keeps the transcript stuck to the bottom when messages are appended', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: {
        messages: messages.slice(0, 1),
      },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 600;

    await (wrapper as unknown as { setProps: (props: { messages: Message[] }) => Promise<void> }).setProps({ messages });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it('defers a second initial scroll until post-mount layout is available', async () => {
    let frame: FrameRequestCallback = () => undefined;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 17;
    });
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    const wrapper = mount(CodexMessageList, {
      props: { messages: [] },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let layoutReady = false;
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      get: () => layoutReady ? 900 : 0,
    });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(scrollEl.scrollTop).toBe(0);
    layoutReady = true;
    frame(0);
    expect(scrollEl.scrollTop).toBe(900);
    wrapper.unmount();
  });

  it('does not cancel completed scroll work during unmount', async () => {
    let frame: FrameRequestCallback = () => undefined;
    const cancelAnimationFrame = vi.fn();
    const clearTimeout = vi.fn();
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 29;
    }));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    vi.stubGlobal('clearTimeout', clearTimeout);
    const wrapper = mount(CodexMessageList, { props: { messages: [] } });
    await flushPromises();

    frame(0);
    wrapper.unmount();

    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(clearTimeout).not.toHaveBeenCalled();
  });

  it('cancels a queued animation-frame scroll when unmounted', async () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 71));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const wrapper = mount(CodexMessageList, { props: { messages: [] } });
    await flushPromises();

    wrapper.unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(71);
  });

  it('clears a queued timeout when animation frames are unavailable', async () => {
    const clearTimeout = vi.fn();
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    vi.stubGlobal('setTimeout', vi.fn(() => 73));
    vi.stubGlobal('clearTimeout', clearTimeout);
    const wrapper = mount(CodexMessageList, { props: { messages: [] } });
    await flushPromises();

    wrapper.unmount();

    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(clearTimeout).toHaveBeenCalledWith(73);
  });

  it('coalesces repeated transcript observations into one queued scroll', async () => {
    let mutationCallback: MutationCallback = () => undefined;
    let frame: FrameRequestCallback = () => undefined;
    vi.stubGlobal('MutationObserver', class MockMutationObserver {
      disconnect(): void {}
      observe(): void {}
      takeRecords = (): MutationRecord[] => [];

      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
    });
    vi.stubGlobal('ResizeObserver', undefined);
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return requestAnimationFrame.mock.calls.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    const wrapper = mount(CodexMessageList, { props: { messages } });
    await flushPromises();

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    mutationCallback([], {} as MutationObserver);
    mutationCallback([], {} as MutationObserver);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    frame(0);
    mutationCallback([], {} as MutationObserver);
    mutationCallback([], {} as MutationObserver);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('exposes scroll-to-bottom only through a real parent component ref', async () => {
    const list = ref<{ scrollToBottom: () => void } | null>(null);
    const Parent = defineComponent({
      setup: () => () => h(CodexMessageList, { messages: [], ref: list }),
    });
    const wrapper = mount(Parent);
    await flushPromises();
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 640 });

    expect(Object.keys(list.value ?? {})).toStrictEqual(['scrollToBottom']);
    list.value!.scrollToBottom();
    expect(scrollEl.scrollTop).toBe(640);
  });

  it('observes transcript mutations only while stuck to the bottom and disconnects on unmount', async () => {
    const observers: Array<{
      callback: MutationCallback;
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
      takeRecords: () => MutationRecord[];
    }> = [];
    vi.stubGlobal('MutationObserver', class MockMutationObserver {
      callback: MutationCallback;
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = (): MutationRecord[] => [];

      constructor(callback: MutationCallback) {
        this.callback = callback;
        observers.push(this);
      }
    });
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { messages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    let scrollHeight = 300;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const content = wrapper.get('.codex-message-list__content').element;
    const observer = observers.find(({ observe }) => observe.mock.calls.some(([target]) => target === content));
    expect(observer).toBeDefined();
    expect(observer!.observe).toHaveBeenCalledWith(content, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    scrollHeight = 900;
    observer!.callback([], observer as unknown as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollEl.scrollTop).toBe(900);

    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');
    scrollHeight = 1_200;
    observer!.callback([], observer as unknown as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollEl.scrollTop).toBe(100);

    wrapper.unmount();
    expect(observer!.disconnect).toHaveBeenCalledOnce();
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
    vi.stubGlobal('requestAnimationFrame', undefined);
    const observers: Array<{
      callback: ResizeObserverCallback;
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal('ResizeObserver', class MockResizeObserver {
      callback: ResizeObserverCallback;
      disconnect = vi.fn();
      observe = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }

      unobserve(): void {}
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    const content = wrapper.get('.codex-message-list__content').element;
    const observer = observers.find(({ observe }) => observe.mock.calls.some(([target]) => target === content));
    expect(observer).toBeDefined();
    expect(observer!.observe).toHaveBeenCalledWith(content);

    scrollHeight = 1_200;
    observer!.callback([], observer as unknown as ResizeObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scrollEl.scrollTop).toBe(1_200);

    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');
    scrollHeight = 1_500;
    observer!.callback([], observer as unknown as ResizeObserver);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollEl.scrollTop).toBe(100);

    wrapper.unmount();
    expect(observer!.disconnect).toHaveBeenCalledOnce();
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

  it('emits each exact stickiness transition once and never emits the settled state', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, { props: { messages }, attachTo: document.body });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 600;

    await wrapper.get('.message-list').trigger('scroll');
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('stickiness-change')).toBeUndefined();

    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.emitted('stickiness-change')).toStrictEqual([[false]]);

    await wrapper.get('.codex-message-list__scroll-to-bottom').trigger('click');
    expect(wrapper.emitted('stickiness-change')).toStrictEqual([[false], [true]]);
    wrapper.unmount();
  });

  it('treats the exact bottom threshold as stuck and one pixel beyond it as unstuck', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { bottomThreshold: 24, messages },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    scrollEl.scrollTop = 576;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.find('.codex-message-list__scroll-to-bottom').exists()).toBe(false);

    scrollEl.scrollTop = 575;
    await wrapper.get('.message-list').trigger('scroll');
    expect(wrapper.find('.codex-message-list__scroll-to-bottom').exists()).toBe(true);
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

  it('restores each conversation scroll position when switching away and back', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { messages, resetKey: 'thread-a' },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');

    await wrapper.setProps({ resetKey: 'thread-b' });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(900);

    scrollEl.scrollTop = 240;
    await wrapper.get('.message-list').trigger('scroll');
    await wrapper.setProps({ resetKey: 'thread-a' });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(100);

    await wrapper.setProps({ resetKey: 'thread-b' });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(240);
    wrapper.unmount();
  });

  it('returns a conversation to the bottom after switching away from its bottom', async () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const wrapper = mount(CodexMessageList, {
      props: { messages: makeMessages(15), resetKey: 'thread-a' },
      attachTo: document.body,
    });
    const scrollEl = wrapper.get('.message-list').element as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    scrollEl.scrollTop = 100;
    await wrapper.get('.message-list').trigger('scroll');
    scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    expect(scrollEl.scrollTop).toBe(600);

    await wrapper.setProps({ messages: makeMessages(8, 100), resetKey: 'thread-b' });
    await flushPromises();
    scrollEl.scrollTop = 200;
    await wrapper.get('.message-list').trigger('scroll');

    await wrapper.setProps({ messages: makeMessages(15), resetKey: 'thread-a' });
    await flushPromises();

    expect(scrollEl.scrollTop).toBe(900);
    expect(wrapper.find('.codex-message-list__scroll-to-bottom').exists()).toBe(false);
    wrapper.unmount();
  });
});
