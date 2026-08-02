// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatToolCall from '../../../src/vue/chat/ChatToolCall.vue';
import type { MessageToolCall } from '../../../src/vue/chat/types';

const actions = [
  ['create', 'circle-plus'],
  ['delete', 'trash'],
  ['edit', 'pencil'],
  ['explore', 'eye'],
  ['list', 'folder'],
  ['plan', 'list-details'],
  ['read', 'file-text'],
  ['run', 'terminal'],
  ['search', 'search'],
] as const;

describe('ChatToolCall action icons', () => {
  it.each(actions)('renders an icon for the %s action', (action, iconName) => {
    const toolCall: MessageToolCall = {
      args: undefined,
      done: true,
      function: action,
      id: `tool-${action}`,
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action,
        phase: 'completed',
        source: 'codex',
        params: action === 'plan' ? { operation: 'update' } : { target: 'src' },
      }),
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain(`tabler-icon-${iconName}`);
  });

  it.each([
    ['an app-specific descriptor', JSON.stringify({ action: 'delegate', phase: 'completed', source: 'claw' })],
    ['an unknown Codex action', JSON.stringify({ action: 'custom', phase: 'completed', source: 'codex' })],
    ['no structured descriptor', 'completed'],
  ])('renders the generic tool icon for %s', (_scenario, status) => {
    const toolCall: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'custom_tool',
      id: 'tool-custom',
      result: undefined,
      state: 'completed',
      status,
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-tool');
  });
});
