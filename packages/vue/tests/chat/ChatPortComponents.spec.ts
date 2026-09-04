// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatComposerShelf from '../../src/chat/ChatComposerShelf.vue';
import ChatQueuedPrompts from '../../src/chat/ChatQueuedPrompts.vue';
import ChatAnimatedDiffStat from '../../src/chat/ChatAnimatedDiffStat.vue';
import ChatToolConfirmation from '../../src/chat/ChatToolConfirmation.vue';
import ChatToolUserInputRequest from '../../src/chat/ChatToolUserInputRequest.vue';
import ChatToolCall from '../../src/chat/ChatToolCall.vue';
import ChatToolGroup from '../../src/chat/ChatToolGroup.vue';
import { provideCodexToolCallDetails } from '../../src/chat/tool-call-details';
import type { MessageToolCall } from '../../src/chat/types';

const completedTool: MessageToolCall = {
  args: { command: 'npm test' },
  done: true,
  function: 'npm test',
  id: 'tool-1',
  result: '46 passed',
  state: 'completed',
  status: 'completed',
};

const runningTool: MessageToolCall = {
  args: { path: 'src/main.ts' },
  done: false,
  function: 'read_file',
  id: 'tool-2',
  result: undefined,
  state: 'running',
  status: '{"source":"codex","action":"read","phase":"running","params":{"addedLines":2,"removedLines":1,"target":"src/main.ts"}}',
};

const confirmationTool: MessageToolCall = {
  args: { agentId: 'agent-dina' },
  done: false,
  function: 'team.register-agent',
  id: 'approval-tool',
  result: undefined,
  state: 'running',
  status: JSON.stringify({
    source: 'mcp',
    action: 'run',
    phase: 'running',
    params: {
      allowAlways: true,
      allowConversation: true,
      argumentsPreview: '{\n  "agentId": "agent-dina"\n}',
      confirmationSummary: 'Allow team to register this agent?',
      requestId: 'approval-1',
    },
  }),
};

const userInputTool: MessageToolCall = {
  args: [
    {
      id: 'target_file',
      header: 'Target',
      question: 'Which file should I inspect?',
      isOther: true,
      isSecret: false,
      options: [
        {
          label: 'README.md',
          description: 'Read the project README.',
        },
      ],
    },
  ],
  done: false,
  function: 'ask_user_question',
  id: 'ask-user-item',
  result: undefined,
  state: 'running',
  status: JSON.stringify({
    source: 'codex',
    action: 'ask_user_question',
    phase: 'running',
    params: {
      requestId: 'ask-1',
      questions: [
        {
          id: 'target_file',
          header: 'Target',
          question: 'Which file should I inspect?',
          isOther: true,
          isSecret: false,
          options: [
            {
              label: 'README.md',
              description: 'Read the project README.',
            },
          ],
        },
      ],
    },
  }),
};

const paginatedUserInputTool: MessageToolCall = {
  ...userInputTool,
  status: JSON.stringify({
    source: 'codex',
    action: 'ask_user_question',
    phase: 'running',
    params: {
      requestId: 'ask-paged',
      questions: [
        {
          id: 'target_file',
          header: 'Target',
          question: 'Which file should I inspect?',
          isOther: true,
          isSecret: false,
          options: [
            {
              label: 'README.md',
              description: 'Read the project README.',
            },
          ],
        },
        {
          id: 'depth',
          header: 'Depth',
          question: 'How deep should I go?',
          isOther: false,
          isSecret: false,
          multiSelect: true,
          options: [
            {
              label: 'Summary',
              description: 'Keep it high level.',
            },
            {
              label: 'Tests',
              description: 'Include test details.',
            },
          ],
        },
      ],
    },
  }),
};

const editingTool: MessageToolCall = {
  args: { changes: [{ path: 'src/main/codex/tool-part-adapter.ts' }] },
  done: false,
  function: '1 file change',
  id: 'tool-edit',
  result: undefined,
  state: 'running',
  status: JSON.stringify({
    source: 'codex',
    action: 'edit',
    phase: 'running',
    params: {
      addedLines: 134,
      path: 'src/main/codex/tool-part-adapter.ts',
      removedLines: 1,
      target: 'tool-part-adapter.ts',
    },
  }),
};

describe('ported id8 chat components', () => {
  it('normalizes invalid animated diff values', () => {
    const wrapper = mount(ChatAnimatedDiffStat, {
      props: {
        kind: 'added',
        label: 'Added lines',
        value: Number.NaN,
      },
    });

    expect(wrapper.text()).toContain('+0');
    expect(wrapper.attributes('aria-label')).toBe('Added lines: +0');
  });

  it('keeps animated digit columns aligned by decimal place as values grow', async () => {
    const wrapper = mount(ChatAnimatedDiffStat, {
      props: {
        kind: 'deleted',
        label: 'Deleted lines',
        value: 98,
      },
    });
    const originalColumns = wrapper.findAll('.chat-animated-diff-stat__digit-column')
      .map((column) => column.element);

    expect(wrapper.findAll('.chat-animated-diff-stat__digit').map((digit) => digit.text()))
      .toStrictEqual(['9', '8']);

    await wrapper.setProps({ value: 1_098 });
    const expandedColumns = wrapper.findAll('.chat-animated-diff-stat__digit-column')
      .map((column) => column.element);

    expect(wrapper.findAll('.chat-animated-diff-stat__digit').map((digit) => digit.text()))
      .toStrictEqual(['1', '0', '9', '8']);
    expect(expandedColumns[2]).toBe(originalColumns[0]);
    expect(expandedColumns[3]).toBe(originalColumns[1]);
    expect(wrapper.attributes('aria-label')).toBe('Deleted lines: -1098');
  });

  it('renders queued prompts and emits deletes', async () => {
    const wrapper = mount(ChatQueuedPrompts, {
      props: {
        prompts: [{ id: 'prompt-1', text: 'Run the tests after this turn' }],
      },
    });

    expect(wrapper.text()).toContain('Run the tests after this turn');
    await wrapper.get('[aria-label="Steer queued prompt now"]').trigger('click');
    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    await wrapper.get('[aria-label="Delete queued prompt"]').trigger('click');
    expect(wrapper.emitted('steer')).toStrictEqual([['prompt-1']]);
    expect(wrapper.emitted('edit')).toStrictEqual([['prompt-1']]);
    expect(wrapper.emitted('delete')).toStrictEqual([['prompt-1']]);
  });

  it('stacks queued prompts above the active goal', async () => {
    const wrapper = mount(ChatComposerShelf, {
      props: {
        queuedPrompts: [{ id: 'prompt-1', text: 'Run the tests after this turn' }],
        goal: {
          threadId: 'thread-1',
          objective: 'Ship the goal surface',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });

    const shelfItems = wrapper.findAll('.chat-composer-shelf > *');
    expect(shelfItems[0]?.classes()).toContain('chat-queued-prompts');
    expect(shelfItems[1]?.classes()).toContain('chat-goal');
    expect(wrapper.text()).toContain('Run the tests after this turn');
    expect(wrapper.text()).toContain('Ship the goal surface');

    await wrapper.get('[aria-label="Steer queued prompt now"]').trigger('click');
    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    await wrapper.get('[aria-label="Clear goal"]').trigger('click');
    await wrapper.get('[aria-label="Edit goal"]').trigger('click');

    expect(wrapper.emitted('steerQueuedPrompt')).toStrictEqual([['prompt-1']]);
    expect(wrapper.emitted('editQueuedPrompt')).toStrictEqual([['prompt-1']]);
    expect(wrapper.emitted('clearGoal')).toStrictEqual([[]]);
    expect(wrapper.emitted('editGoal')).toStrictEqual([[]]);
  });

  it('hides a completed goal from the composer shelf', () => {
    const wrapper = mount(ChatComposerShelf, {
      props: {
        queuedPrompts: [],
        goal: {
          threadId: 'thread-1',
          objective: 'Ship the goal surface',
          status: 'complete',
          tokenBudget: null,
          tokensUsed: 100,
          timeUsedSeconds: 60,
          createdAt: 0,
          updatedAt: 1,
        },
      },
    });

    expect(wrapper.find('.chat-goal').exists()).toBe(false);
    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(false);
  });

  it('renders current turn diff in the composer shelf', () => {
    const wrapper = mount(ChatComposerShelf, {
      props: {
        turnGitDiff: {
          turnId: 'turn-1',
          addedLines: 45,
          removedLines: 23,
          updatedAt: '2026-06-11T10:00:00.000Z',
        },
        queuedPrompts: [{ id: 'prompt-1', text: 'Run the tests after this turn' }],
        goal: null,
      },
    });

    expect(wrapper.find('.chat-turn-git-info').exists()).toBe(true);
    expect(wrapper.text()).toContain('Current turn');
    expect(wrapper.text()).toContain('+45');
    expect(wrapper.text()).toContain('-23');
  });

  it('independently controls the default composer shelf sections', async () => {
    const wrapper = mount(ChatComposerShelf, {
      props: {
        goal: {
          threadId: 'thread-1', objective: 'Ship it', status: 'active', tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0,
        },
        presentation: { goal: false, queuedPrompts: true, turnGitDiff: false },
        queuedPrompts: [{ id: 'prompt-1', text: 'Run the tests' }],
        turnGitDiff: {
          turnId: 'turn-1', addedLines: 5, removedLines: 2, updatedAt: '2026-06-11T10:00:00.000Z',
        },
      },
    });

    expect(wrapper.find('.chat-queued-prompts').exists()).toBe(true);
    expect(wrapper.find('.chat-goal').exists()).toBe(false);
    expect(wrapper.find('.chat-turn-git-info').exists()).toBe(false);

    await wrapper.setProps({ presentation: { goal: true, queuedPrompts: false, turnGitDiff: true } });
    expect(wrapper.find('.chat-queued-prompts').exists()).toBe(false);
    expect(wrapper.find('.chat-goal').exists()).toBe(true);
    expect(wrapper.find('.chat-turn-git-info').exists()).toBe(true);

    await wrapper.setProps({ presentation: { goal: false, queuedPrompts: false, turnGitDiff: false } });
    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(false);
  });

  it('omits an entirely empty composer shelf', () => {
    const wrapper = mount(ChatComposerShelf, {
      props: {
        goal: null,
        queuedPrompts: [],
        turnGitDiff: null,
      },
    });

    expect(wrapper.find('.chat-composer-shelf').exists()).toBe(false);
    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it('renders collapsible tool calls with params and result', async () => {
    const hidden = mount(ChatToolCall, {
      props: { toolCall: completedTool },
    });
    expect(hidden.text()).toContain('Ran npm test');
    expect(hidden.text()).not.toContain('Input');
    expect(hidden.text()).not.toContain('46 passed');
    expect(hidden.get('.chat-tool-call__header').element.tagName).toBe('DIV');
    expect(hidden.find('.chat-tool-call__chevron').exists()).toBe(false);

    const wrapper = mount(ChatToolCall, {
      props: {
        showToolDetails: true,
        toolCall: completedTool,
      },
    });

    expect(wrapper.text()).toContain('Ran npm test');
    await wrapper.get('.chat-tool-call__header').trigger('click');
    expect(wrapper.text()).toContain('Input');
    expect(wrapper.text()).toContain('Result');
    expect(wrapper.text()).toContain('46 passed');

    const structuredResult = mount(ChatToolCall, {
      props: {
        showToolDetails: true,
        toolCall: {
          ...completedTool,
          function: 'team.set-status',
          result: {
            agentId: 'agent-dina',
            status: 'Registered and idle',
          },
        },
      },
    });
    expect(structuredResult.text()).toContain('Ran team.set-status');
    await structuredResult.get('.chat-tool-call__header').trigger('click');
    expect(structuredResult.text()).toContain('"status": "Registered and idle"');

    const completedWorkItem = mount(ChatToolCall, {
      props: {
        toolCall: {
          ...completedTool,
          function: 'team.mark-work-item-completed',
          result: {
            message: 'Work item marked completed.',
            status: 'completed',
            workItemId: 'work-item-12',
          },
        },
      },
    });
    expect(completedWorkItem.text()).toContain('Ran team.mark-work-item-completed');
  });

  it('enables raw tool details once for a provided component subtree', async () => {
    const host = defineComponent({
      setup() {
        provideCodexToolCallDetails(true);
        return () => h(ChatToolCall, { toolCall: completedTool });
      },
    });
    const wrapper = mount(host);

    await wrapper.get('.chat-tool-call__header').trigger('click');

    expect(wrapper.text()).toContain('Input');
    expect(wrapper.text()).toContain('46 passed');

    const overriddenHost = defineComponent({
      setup() {
        provideCodexToolCallDetails(true);
        return () => h(ChatToolCall, { showToolDetails: false, toolCall: completedTool });
      },
    });
    const overridden = mount(overriddenHost);
    expect(overridden.text()).not.toContain('Input');
    expect(overridden.get('.chat-tool-call__header').element.tagName).toBe('DIV');
  });

  it('uses a generic fallback for host-specific MCP calls', () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        toolCall: {
          args: { path: 'docs/mcp.md' },
          done: true,
          function: 'mcp__team__display-markdown',
          id: 'tool-markdown',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });

    expect(wrapper.text()).toContain('Ran mcp__team__display-markdown');
  });

  it('renders headerless, summary-only, descriptor, and bare tool states', async () => {
    const headerless = mount(ChatToolCall, {
      props: {
        headerless: true,
        showToolDetails: true,
        toolCall: completedTool,
      },
    });
    expect(headerless.text()).toContain('Input');
    expect(headerless.find('.chat-tool-call__header').exists()).toBe(false);

    const summary = mount(ChatToolCall, {
      props: {
        summaryOnly: true,
        toolCall: runningTool,
      },
    });
    expect(summary.text()).toContain('Reading main.ts');

    const customStatus = mount(ChatToolCall, {
      props: {
        toolCall: { ...completedTool, status: 'Searched 3 files' },
      },
    });
    expect(customStatus.text()).toContain('Searched 3 files');

    const completedRead = mount(ChatToolCall, {
      props: {
        toolCall: {
          ...completedTool,
          function: '/bin/bash -lc "sed -n 1,220p README.md"',
          status: '{"source":"codex","action":"read","phase":"completed","params":{"target":"README.md"}}',
        },
      },
    });
    expect(completedRead.text()).toContain('Read README.md');

    const writingPlan = mount(ChatToolCall, {
      props: {
        toolCall: {
          args: undefined,
          done: false,
          function: 'plan',
          id: 'plan-tool',
          result: undefined,
          state: 'running',
          status: '{"source":"codex","action":"plan","phase":"running","params":{"addedLines":3,"operation":"write"}}',
        },
      },
    });
    expect(writingPlan.text()).toContain('Writing plan');
    expect(writingPlan.find('.chat-tool-call__chevron').exists()).toBe(false);
    expect(writingPlan.find('.chat-tool-call__header').element.tagName).toBe('DIV');

    const editing = mount(ChatToolCall, {
      props: {
        summaryOnly: true,
        toolCall: editingTool,
      },
    });
    expect(editing.text()).toContain('Editing');
    expect(editing.find('.chat-tool-call__title-target').text()).toBe('tool-part-adapter.ts');
    expect(editing.find('.chat-animated-diff-stat--added').text()).toBe('+134');
    expect(editing.find('.chat-animated-diff-stat--deleted').text()).toBe('-1');

    const bare = mount(ChatToolCall, {
      props: {
        toolCall: { ...completedTool, args: undefined, result: undefined },
      },
    });
    await bare.get('.chat-tool-call__header').trigger('click');
    expect(bare.text()).not.toContain('Input');
    expect(bare.text()).not.toContain('Result');

    const nullResult = mount(ChatToolCall, {
      props: {
        toolCall: { ...runningTool, args: undefined, result: null },
      },
    });
    await nullResult.get('.chat-tool-call__header').trigger('click');
    expect(nullResult.text()).not.toContain('Result');
  });

  it('renders grouped tools with running diff status and expands children', async () => {
    const wrapper = mount(ChatToolGroup, {
      props: {
        toolCalls: [completedTool, runningTool],
      },
    });

    expect(wrapper.text()).toContain('Reading main.ts');
    expect(wrapper.text()).toContain('+2');
    expect(wrapper.text()).toContain('-1');
    await wrapper.get('.chat-tool-group__header').trigger('click');
    expect(wrapper.findAll('.chat-tool-call').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the sum of completed edit diffs in a grouped header', async () => {
    const edit = (id: string, addedLines: number, removedLines: number): MessageToolCall => ({
      ...completedTool,
      function: 'fileChange',
      id,
      status: JSON.stringify({
        action: 'edit',
        phase: 'completed',
        source: 'codex',
        params: { addedLines, removedLines, target: `${id}.ts` },
      }),
    });
    const wrapper = mount(ChatToolGroup, {
      props: { toolCalls: [edit('one', 31, 26), edit('two', 97, 70)] },
    });

    const header = wrapper.get('.chat-tool-group__header');
    expect(header.text()).toContain('2 actions done');
    expect(header.get('.chat-animated-diff-stat--added').text()).toBe('+128');
    expect(header.get('.chat-animated-diff-stat--deleted').text()).toBe('-96');

    await header.trigger('click');
    expect(wrapper.findAll('.chat-tool-call__diff')).toHaveLength(2);
  });

  it('renders MCP tool confirmations and emits the selected decision', async () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        toolCall: confirmationTool,
      },
    });

    expect(wrapper.text()).toContain('Approve tool call');
    expect(wrapper.text()).toContain('Allow team to register this agent?');
    expect(wrapper.text()).toContain('Allow for session');
    expect(wrapper.text()).toContain('Always allow');

    await wrapper.get('.chat-tool-confirmation__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([
      [
        {
          id: 'approval-1',
          payload: {
            decision: 'allow',
          },
        },
      ],
    ]);
    expect(wrapper.text()).toContain('Allowed tool call');
  });

  it('renders fallback confirmation copy without persistent actions', () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        toolCall: {
          args: undefined,
          done: false,
          function: 'team.check-messages',
          id: 'approval-tool-minimal',
          result: undefined,
          state: 'running',
          status: JSON.stringify({
            source: 'mcp',
            action: 'run',
            phase: 'running',
            params: {
              requestId: 'approval-minimal',
            },
          }),
        },
      },
    });

    expect(wrapper.text()).toContain('Allow tool call team.check-messages?');
    expect(wrapper.text()).not.toContain('Allow for session');
    expect(wrapper.text()).not.toContain('Always allow');
    expect(wrapper.find('.chat-tool-confirmation__details').exists()).toBe(false);
  });

  it('marks externally answered confirmations as resolved', async () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        answeredClientRequestIds: new Set(['approval-1']),
        toolCall: confirmationTool,
      },
    });

    expect(wrapper.text()).toContain('Allowed tool call');
    expect(wrapper.find('.chat-tool-confirmation__button--primary').exists()).toBe(false);
    expect(wrapper.emitted('client-response')).toBeUndefined();
  });

  it('renders denied confirmation decisions as resolved', async () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        toolCall: confirmationTool,
      },
    });

    const denyButton = wrapper
      .findAll('.chat-tool-confirmation__button')
      .find((button) => button.text() === 'Deny');
    expect(denyButton).toBeTruthy();
    await denyButton?.trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([
      [
        {
          id: 'approval-1',
          payload: {
            decision: 'deny',
          },
        },
      ],
    ]);
    expect(wrapper.text()).toContain('Denied tool call');
  });

  it('ignores confirmation clicks without a request id', async () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        toolCall: {
          ...confirmationTool,
          status: JSON.stringify({
            source: 'mcp',
            action: 'run',
            phase: 'running',
            params: {},
          }),
        },
      },
    });

    await wrapper.get('.chat-tool-confirmation__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')).toBeUndefined();
  });

  it('switches running confirmation-style tools to the confirmation renderer', () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        toolCall: confirmationTool,
      },
    });

    expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(true);
    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
  });

  it('renders app-server user input requests and emits answers', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: userInputTool,
      },
    });

    expect(wrapper.text()).toContain('Target');
    expect(wrapper.text()).toContain('Which file should I inspect?');
    await wrapper.get('.chat-tool-user-input__option').trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([
      [
        {
          id: 'ask-1',
          payload: {
            answers: {
              target_file: {
                answers: ['README.md'],
              },
            },
          },
        },
      ],
    ]);
    expect(wrapper.text()).toContain('Answered user question');
    expect(wrapper.text()).toContain('README.md');
  });

  it('paginates app-server user input requests and preserves multi-select answers', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: paginatedUserInputTool,
      },
    });

    expect(wrapper.text()).toContain('1 / 2');
    expect(wrapper.text()).toContain('Which file should I inspect?');
    expect(wrapper.text()).not.toContain('How deep should I go?');

    await wrapper.findAll('.chat-tool-user-input__option')[0]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.text()).toContain('2 / 2');
    expect(wrapper.text()).toContain('How deep should I go?');
    await wrapper.findAll('.chat-tool-user-input__option')[0]!.trigger('click');
    await wrapper.findAll('.chat-tool-user-input__option')[1]!.trigger('click');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([
      [
        {
          id: 'ask-paged',
          payload: {
            answers: {
              target_file: {
                answers: ['README.md'],
              },
              depth: {
                answers: ['Summary', 'Tests'],
              },
            },
          },
        },
      ],
    ]);
    expect(wrapper.text()).toContain('Answered user question');
    expect(wrapper.text()).toContain('Summary, Tests');
  });

  it('supports app-server user input cancellation with empty answers', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: paginatedUserInputTool,
      },
    });

    await wrapper.findAll('.chat-tool-user-input__button').at(-1)?.trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([
      [
        {
          id: 'ask-paged',
          payload: {
            answers: {},
            cancelled: true,
          },
        },
      ],
    ]);
    expect(wrapper.text()).toContain('Cancelled user question');
  });

  it('supports free-form app-server user input answers', async () => {
    const wrapper = mount(ChatToolUserInputRequest, {
      props: {
        toolCall: userInputTool,
      },
    });

    await wrapper.find('.chat-tool-user-input__option--other').trigger('click');
    await wrapper.find('.chat-tool-user-input__other-input').setValue('docs/frontend.md');
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([
      [
        {
          id: 'ask-1',
          payload: {
            answers: {
              target_file: {
                answers: ['docs/frontend.md'],
              },
            },
          },
        },
      ],
    ]);
  });

  it('switches running app-server user input tools to the user input renderer', () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        toolCall: userInputTool,
      },
    });

    expect(wrapper.find('.chat-tool-user-input').exists()).toBe(true);
    expect(wrapper.find('.chat-tool-call').exists()).toBe(false);
  });

  it('does not wrap a single confirmation tool group in a collapsible header', () => {
    const wrapper = mount(ChatToolGroup, {
      props: {
        toolCalls: [confirmationTool],
      },
    });

    expect(wrapper.find('.chat-tool-confirmation').exists()).toBe(true);
    expect(wrapper.find('.chat-tool-group__header').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Running team.register-agent');
  });

  it('summarizes completed tool groups and handles an empty group', async () => {
    const completed = mount(ChatToolGroup, {
      props: {
        showToolDetails: true,
        toolCalls: [completedTool],
      },
    });

    expect(completed.text()).toContain('Ran npm test');
    expect(completed.find('.chat-fold--open').exists()).toBe(false);
    await completed.get('.chat-tool-group__header').trigger('click');
    expect(completed.find('.chat-fold--open').exists()).toBe(true);
    expect(completed.text()).toContain('Input');

    const empty = mount(ChatToolGroup, {
      props: {
        toolCalls: [],
      },
    });

    expect(empty.text()).toContain('No actions');
  });
});
