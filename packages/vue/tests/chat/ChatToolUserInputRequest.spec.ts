// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ChatToolUserInputRequest from '../../src/chat/ChatToolUserInputRequest.vue';
import type { AskUserQuestion } from '../../src/chat/contracts';
import type { MessageToolCall } from '../../src/chat/types';

const firstQuestion: AskUserQuestion = {
  id: 'target',
  header: 'Target',
  question: 'Which target?',
  isOther: true,
  isSecret: false,
  options: [
    { label: 'README.md', description: 'Read the README.' },
    { label: 'package.json', description: 'Read the manifest.' },
  ],
};

const secondQuestion: AskUserQuestion = {
  id: 'depth',
  header: 'Depth',
  question: 'How deep?',
  isOther: false,
  isSecret: false,
  multiSelect: true,
  options: [
    { label: 'Summary', description: 'Summarize.' },
    { label: 'Tests', description: 'Include tests.' },
    { label: 'Risks', description: 'Include risks.' },
  ],
};

const multiOtherQuestion: AskUserQuestion = {
  id: 'scope',
  header: 'Scope',
  question: 'What should be included?',
  isOther: true,
  isSecret: false,
  multiSelect: true,
  options: [
    { label: 'Implementation', description: 'Include implementation.' },
    { label: 'Tests', description: 'Include tests.' },
  ],
};

function requestTool(
  questions: unknown,
  overrides: Partial<MessageToolCall> = {},
  requestId: unknown = 'request-1',
): MessageToolCall {
  return {
    args: undefined,
    done: false,
    function: 'ask_user_question',
    id: 'ask-user-1',
    result: undefined,
    state: 'running',
    status: JSON.stringify({
      source: 'codex',
      action: 'ask_user_question',
      phase: 'running',
      params: { questions, requestId },
    }),
    ...overrides,
  };
}

describe('ChatToolUserInputRequest normalization and resolution', () => {
  it.each([undefined, null, false, 0, '', {}, { id: 'not-an-array' }])
  ('shows preparation state for invalid question data %#', (questions) => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool(questions) },
    });

    expect(wrapper.get('.chat-message__thinking').text()).toBe('Preparing question...');
    expect(wrapper.find('.chat-tool-user-input').exists()).toBe(false);
  });

  it('shows and focuses a direct answer field when a question has no options', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      attachTo: document.body,
      props: {
        toolCall: requestTool([{
          id: 'free-text',
          header: 'Details',
          question: 'What should I know?',
          isOther: true,
          isSecret: false,
          options: null,
        }]),
      },
    });

    const input = wrapper.get<HTMLTextAreaElement>('.chat-tool-user-input__other-input--direct');
    expect(wrapper.find('.chat-tool-user-input__option--other').exists()).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(input.element));
    expect(wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary').element.disabled).toBe(true);

    await input.setValue('  A direct answer  ');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([[
      {
        id: 'request-1',
        payload: { answers: { 'free-text': { answers: ['A direct answer'] } } },
      },
    ]]);
    wrapper.unmount();
  });

  it('filters malformed questions and supplies exact defaults for valid minimal entries', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: requestTool([
          null,
          false,
          true,
          1,
          'primitive',
          {},
          { id: 'missing-question' },
          { id: 12, question: 'Wrong id' },
          { id: 'wrong-question', question: 12 },
          { id: 'minimal', question: 'Minimal question', header: '', options: 'invalid' },
          {
            id: 'secret',
            question: 'Secret question',
            header: 'Secret',
            isOther: true,
            isSecret: true,
            options: [],
          },
        ]),
      },
    });

    expect(wrapper.findAll('.chat-tool-user-input__progress-dot')).toHaveLength(2);
    expect(wrapper.find('.chat-tool-user-input__tag').exists()).toBe(false);
    expect(wrapper.get('.chat-tool-user-input__question').text()).toBe('Minimal question');
    expect(wrapper.findAll('.chat-tool-user-input__option')).toHaveLength(0);
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('Type your answer...');

    await wrapper.get('textarea').setValue('minimal answer');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.get('.chat-tool-user-input__tag').text()).toBe('Secret');
    expect(wrapper.get('.chat-tool-user-input__question').text()).toBe('Secret question');
    expect(wrapper.findAll('.chat-tool-user-input__option')).toHaveLength(1);
    await wrapper.get('.chat-tool-user-input__option--other').trigger('click');
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('Enter private answer');
    expect(wrapper.get('textarea').attributes('type')).toBe('password');
  });

  it('defaults omitted Other and secret flags to false', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: requestTool([
          {
            id: 'ordinary',
            question: 'Ordinary question',
            options: [{ label: 'Only option' }],
          },
          {
            id: 'other',
            question: 'Other question',
            isOther: true,
            options: [],
          },
        ]),
      },
    });

    expect(wrapper.find('.chat-tool-user-input__option--other').exists()).toBe(false);
    await wrapper.get('.chat-tool-user-input__option').trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');
    await wrapper.get('.chat-tool-user-input__option--other').trigger('click');

    expect(wrapper.get('textarea').attributes('placeholder')).toBe('Type your answer...');
    expect(wrapper.get('textarea').attributes('type')).toBe('text');
  });

  it('keeps invalid request ids interactive but refuses submit and cancel responses', async () => {
    for (const requestId of [Symbol('missing'), null, 0, false, {}]) {
      const wrapper = mount(ChatToolUserInputRequest, {
        props: { toolCall: requestTool([firstQuestion], {}, requestId) },
      });
      await wrapper.findAll('.chat-tool-user-input__option')[0]!.trigger('click');
      await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');
      await wrapper.get('[aria-label="Cancel question"]').trigger('click');

      expect(wrapper.emitted('client-response')).toBeUndefined();
      expect(wrapper.find('.chat-tool-user-input--resolved').exists()).toBe(false);
    }
  });

  it('renders exact externally supplied answers and filters blank summary values', () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: requestTool([firstQuestion, secondQuestion], {
          done: true,
          result: {
            answers: {
              target: { answers: ['README.md', '', 'package.json'] },
              depth: { answers: ['', 'Tests', ''] },
            },
          },
          state: 'completed',
        }),
      },
    });

    expect(wrapper.get('.chat-tool-user-input__summary--answered').text()).toContain('Answered user question');
    expect(wrapper.findAll('.chat-tool-user-input__answer-label').map((node) => node.text())).toStrictEqual([
      'Target',
      'Depth',
    ]);
    expect(wrapper.findAll('.chat-tool-user-input__answer-value').map((node) => node.text())).toStrictEqual([
      'README.md, package.json',
      'Tests',
    ]);
  });

  it('renders a dash for missing and empty answers in a resolved response', () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: requestTool([firstQuestion, secondQuestion], {
          result: { answers: { target: { answers: [] } } },
        }),
      },
    });

    expect(wrapper.findAll('.chat-tool-user-input__answer-value').map((node) => node.text())).toStrictEqual([
      '-',
      '-',
    ]);
  });

  it('resolves only for the matching externally answered request id', () => {
    const matching = mount(ChatToolUserInputRequest, {
      props: {
        answeredClientRequestIds: new Set(['request-1']),
        toolCall: requestTool([firstQuestion]),
      },
    });
    expect(matching.get('.chat-tool-user-input__summary--answered').text()).toContain('Answered user question');
    expect(matching.get('.chat-tool-user-input__answer-value').text()).toBe('-');

    const other = mount(ChatToolUserInputRequest, {
      props: {
        answeredClientRequestIds: new Set(['other-request']),
        toolCall: requestTool([firstQuestion]),
      },
    });
    expect(other.find('.chat-tool-user-input__summary--answered').exists()).toBe(false);
    expect(other.find('.chat-tool-user-input__actions').exists()).toBe(true);
  });

  it('gives cancellation precedence over an external answer', () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        answeredClientRequestIds: new Set(['request-1']),
        toolCall: requestTool([firstQuestion], { state: 'canceled' }),
      },
    });

    expect(wrapper.get('.chat-tool-user-input__summary--muted').text()).toBe('Cancelled user question');
    expect(wrapper.find('.chat-tool-user-input__summary--answered').exists()).toBe(false);
  });

  it('handles a malformed descriptor without rendering a broken question card', () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool(undefined, { status: 'running' }) },
    });

    expect(wrapper.get('.chat-message__thinking').text()).toBe('Preparing question...');
    expect(wrapper.find('.chat-tool-user-input').exists()).toBe(false);
  });
});

describe('ChatToolUserInputRequest interactions', () => {
  it('shows every choice explanation and separates a recommendation from the answer label', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: requestTool([{
          ...firstQuestion,
          isOther: false,
          options: [
            { label: 'README.md (Recommended)', description: 'Start with the project overview.' },
            { label: 'package.json', description: 'Inspect package scripts and dependencies.' },
          ],
        }]),
      },
    });
    const options = wrapper.findAll<HTMLButtonElement>('.chat-tool-user-input__option');

    expect(options.map((option) => option.get('.chat-tool-user-input__option-description').text())).toStrictEqual([
      'Start with the project overview.',
      'Inspect package scripts and dependencies.',
    ]);
    expect(options[0]!.get('.chat-tool-user-input__option-label').text()).toBe('README.md');
    expect(options[0]!.get('.chat-tool-user-input__recommended').text()).toBe('Recommended');
    expect(options[0]!.attributes('aria-label')).toBe('README.md (Recommended)');

    await options[0]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')?.[0]?.[0]).toStrictEqual({
      id: 'request-1',
      payload: { answers: { target: { answers: ['README.md (Recommended)'] } } },
    });
  });

  it('toggles a single option and submits the exact selected answer', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([firstQuestion]) },
    });
    const options = wrapper.findAll('.chat-tool-user-input__option:not(.chat-tool-user-input__option--other)');
    const primary = wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary');

    expect(primary.element.disabled).toBe(true);
    expect(options[0]!.classes()).not.toContain('chat-tool-user-input__option--selected');
    expect(options[0]!.attributes('aria-pressed')).toBe('false');

    await options[0]!.trigger('click');
    expect(options[0]!.classes()).toContain('chat-tool-user-input__option--selected');
    expect(options[0]!.attributes('aria-pressed')).toBe('true');
    expect(options[0]!.find('.chat-tool-user-input__icon--checked').exists()).toBe(true);
    expect(primary.element.disabled).toBe(false);

    await options[0]!.trigger('click');
    expect(options[0]!.classes()).not.toContain('chat-tool-user-input__option--selected');
    expect(options[0]!.attributes('aria-pressed')).toBe('false');
    expect(primary.element.disabled).toBe(true);

    await options[1]!.trigger('click');
    await primary.trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([[
      {
        id: 'request-1',
        payload: { answers: { target: { answers: ['package.json'] } } },
      },
    ]]);
    expect(wrapper.get('.chat-tool-user-input__summary--answered').text()).toContain('Answered user question');
    expect(wrapper.get('.chat-tool-user-input__answer-value').text()).toBe('package.json');
  });

  it('makes a single-select Other answer mutually exclusive and clears deselected text', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([firstQuestion]) },
    });
    const other = wrapper.get('.chat-tool-user-input__option--other');
    const option = wrapper.findAll('.chat-tool-user-input__option:not(.chat-tool-user-input__option--other)')[0]!;
    const primary = wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary');

    await option.trigger('click');
    await other.trigger('keydown', { key: 'Enter' });
    expect(option.classes()).not.toContain('chat-tool-user-input__option--selected');
    expect(other.classes()).toContain('chat-tool-user-input__option--selected');
    expect(primary.element.disabled).toBe(true);

    await wrapper.get('textarea').setValue('  custom target  ');
    expect(primary.element.disabled).toBe(false);

    await other.trigger('keydown', { key: ' ' });
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(primary.element.disabled).toBe(true);

    await other.trigger('click');
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('');
    await wrapper.get('textarea').setValue('ignored after option selection');
    await option.trigger('click');
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(option.classes()).toContain('chat-tool-user-input__option--selected');
  });

  it('adds and removes multi-select options while preserving an independent Other answer', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([multiOtherQuestion]) },
    });
    const options = wrapper.findAll('.chat-tool-user-input__option:not(.chat-tool-user-input__option--other)');
    const other = wrapper.get('.chat-tool-user-input__option--other');

    await options[0]!.trigger('click');
    await options[1]!.trigger('click');
    await options[0]!.trigger('click');
    expect(options[0]!.classes()).not.toContain('chat-tool-user-input__option--selected');
    expect(options[1]!.classes()).toContain('chat-tool-user-input__option--selected');

    await other.trigger('click');
    await wrapper.get('textarea').setValue('  Documentation  ');
    expect(options[1]!.classes()).toContain('chat-tool-user-input__option--selected');

    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');
    expect(wrapper.emitted('client-response')).toStrictEqual([[
      {
        id: 'request-1',
        payload: { answers: { scope: { answers: ['Tests', 'Documentation'] } } },
      },
    ]]);
  });

  it('does not append an empty selected Other value to a valid multi-select answer', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([multiOtherQuestion]) },
    });

    await wrapper.findAll('.chat-tool-user-input__option')[0]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__option--other').trigger('click');
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('');
    expect(wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary').element.disabled).toBe(false);
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')?.[0]?.[0]).toStrictEqual({
      id: 'request-1',
      payload: { answers: { scope: { answers: ['Implementation'] } } },
    });
    expect(wrapper.get('.chat-tool-user-input__answer-value').text()).toBe('Implementation');
  });

  it('requires non-whitespace Other text before allowing progression', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([{ ...firstQuestion, options: [] }]) },
    });
    const primary = wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary');

    await wrapper.get('.chat-tool-user-input__option--other').trigger('click');
    await wrapper.get('textarea').setValue('   ');
    expect(primary.element.disabled).toBe(true);

    await wrapper.get('textarea').setValue('  usable answer  ');
    expect(primary.element.disabled).toBe(false);
    await primary.trigger('click');

    expect(wrapper.emitted('client-response')?.[0]?.[0]).toStrictEqual({
      id: 'request-1',
      payload: { answers: { target: { answers: ['usable answer'] } } },
    });
  });

  it('navigates forward and backward while preserving answers and gates final submission', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([firstQuestion, secondQuestion]) },
    });

    expect(wrapper.get('.chat-tool-user-input__index').text()).toBe('1 / 2');
    expect(wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary').element.disabled).toBe(true);
    await wrapper.findAll('.chat-tool-user-input__option')[0]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.get('.chat-tool-user-input__tag').text()).toBe('Depth');
    expect(wrapper.get('.chat-tool-user-input__index').text()).toBe('2 / 2');
    expect(wrapper.get('.chat-tool-user-input__button--primary').text()).toBe('Send');
    expect(wrapper.get<HTMLButtonElement>('.chat-tool-user-input__button--primary').element.disabled).toBe(true);

    const back = wrapper.findAll('.chat-tool-user-input__button').find((button) => button.text() === 'Back');
    expect(back).toBeDefined();
    await back!.trigger('click');
    expect(wrapper.get('.chat-tool-user-input__tag').text()).toBe('Target');
    expect(wrapper.findAll('.chat-tool-user-input__option')[0]!.classes()).toContain('chat-tool-user-input__option--selected');

    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');
    await wrapper.findAll('.chat-tool-user-input__option')[1]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')?.[0]?.[0]).toStrictEqual({
      id: 'request-1',
      payload: {
        answers: {
          target: { answers: ['README.md'] },
          depth: { answers: ['Tests'] },
        },
      },
    });
  });

  it('emits the exact cancellation response once and renders the resolved state', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: { toolCall: requestTool([firstQuestion]) },
    });
    await wrapper.get('[aria-label="Cancel question"]').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([[
      {
        id: 'request-1',
        payload: { answers: {}, cancelled: true },
      },
    ]]);
    expect(wrapper.get('.chat-tool-user-input__summary--muted').text()).toBe('Cancelled user question');
    expect(wrapper.find('.chat-tool-user-input__actions').exists()).toBe(false);
  });

  it('summarizes current selections when the host resolves the request externally', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        answeredClientRequestIds: new Set<string>(),
        toolCall: requestTool([multiOtherQuestion]),
      },
    });

    await wrapper.findAll('.chat-tool-user-input__option')[0]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__option--other').trigger('click');
    await wrapper.get('textarea').setValue('  Docs  ');
    await wrapper.setProps({ answeredClientRequestIds: new Set(['request-1']) });

    expect(wrapper.get('.chat-tool-user-input__answer-value').text()).toBe('Implementation, Docs');
    expect(wrapper.find('.chat-tool-user-input__actions').exists()).toBe(false);
    expect(wrapper.emitted('client-response')).toBeUndefined();
  });
});
