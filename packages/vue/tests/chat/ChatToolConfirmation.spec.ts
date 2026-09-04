// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatToolConfirmation from '../../src/chat/ChatToolConfirmation.vue';
import type { MessageToolCall } from '../../src/chat/types';

function confirmationTool(
  params: Record<string, unknown> | undefined,
  overrides: Partial<MessageToolCall> = {},
): MessageToolCall {
  return {
    args: undefined,
    done: false,
    function: 'team.check-messages',
    id: 'confirmation-1',
    result: undefined,
    state: 'running',
    status: JSON.stringify({
      source: 'mcp',
      action: 'run',
      phase: 'running',
      ...(params === undefined ? {} : { params }),
    }),
    ...overrides,
  };
}

describe('ChatToolConfirmation', () => {
  it('does not answer a confirmation whose request id is not a string', async () => {
    for (const requestId of [undefined, null, 0, false, {}]) {
      const wrapper = mount(ChatToolConfirmation, {
        props: { toolCall: confirmationTool({ requestId }) },
      });

      await wrapper.get('.chat-tool-confirmation__button--primary').trigger('click');
      expect(wrapper.emitted('client-response')).toBeUndefined();
      expect(wrapper.find('.chat-tool-confirmation--resolved').exists()).toBe(false);
    }
  });

  it('uses fallback copy for blank and non-string confirmation summaries', () => {
    for (const confirmationSummary of ['', '   ', 0, false, null, {}]) {
      const wrapper = mount(ChatToolConfirmation, {
        props: {
          toolCall: confirmationTool({
            confirmationSummary,
            requestId: 'request-1',
          }),
        },
      });

      expect(wrapper.get('.chat-tool-confirmation__question').text()).toBe(
        'Allow tool call team.check-messages?',
      );
    }
  });

  it('uses an explicit string preview exactly, including an empty preview', () => {
    const explicit = mount(ChatToolConfirmation, {
      props: {
        toolCall: confirmationTool({
          argumentsPreview: '{"scope":"repo"}',
          requestId: 'request-1',
        }),
      },
    });
    expect(explicit.get('.chat-tool-confirmation__details-body').text()).toBe('{"scope":"repo"}');

    const empty = mount(ChatToolConfirmation, {
      props: {
        toolCall: confirmationTool({
          argumentsPreview: '',
          requestId: 'request-1',
        }, { args: { ignored: true } }),
      },
    });
    expect(empty.find('.chat-tool-confirmation__details').exists()).toBe(false);
  });

  it('falls back from a non-string preview to exact structured tool arguments', () => {
    for (const argumentsPreview of [undefined, null, 0, false, {}]) {
      const wrapper = mount(ChatToolConfirmation, {
        props: {
          toolCall: confirmationTool({
            argumentsPreview,
            requestId: 'request-1',
          }, {
            args: { agentId: 'agent-dina', scopes: ['repo', 'network'] },
          }),
        },
      });

      expect(wrapper.get('.chat-tool-confirmation__details-body').text()).toBe(
        '{\n  "agentId": "agent-dina",\n  "scopes": [\n    "repo",\n    "network"\n  ]\n}',
      );
    }
  });

  it('does not invent a preview for absent or primitive tool arguments', () => {
    for (const args of [undefined, null, false, 0, '', 'raw input']) {
      const wrapper = mount(ChatToolConfirmation, {
        props: {
          toolCall: confirmationTool({ requestId: 'request-1' }, { args }),
        },
      });

      expect(wrapper.find('.chat-tool-confirmation__details').exists()).toBe(false);
    }
  });

  it('handles a malformed descriptor with fallback copy and argument preview', async () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        toolCall: confirmationTool(undefined, {
          args: { path: 'README.md' },
          status: 'running',
        }),
      },
    });

    expect(wrapper.get('.chat-tool-confirmation__question').text()).toBe(
      'Allow tool call team.check-messages?',
    );
    expect(wrapper.get('.chat-tool-confirmation__details-body').text()).toBe(
      '{\n  "path": "README.md"\n}',
    );
    await wrapper.get('.chat-tool-confirmation__button--primary').trigger('click');
    expect(wrapper.emitted('client-response')).toBeUndefined();
  });

  it('renders a completed canceled tool as denied without a local decision', () => {
    const wrapper = mount(ChatToolConfirmation, {
      props: {
        toolCall: confirmationTool({ requestId: 'request-1' }, {
          done: true,
          state: 'canceled',
        }),
      },
    });

    expect(wrapper.get('.chat-tool-confirmation--resolved').text()).toBe('Denied tool call');
    expect(wrapper.find('.chat-tool-confirmation__actions').exists()).toBe(false);
  });
});
