// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatToolCall from '../../../src/vue/chat/ChatToolCall.vue';
import ChatToolIcon from '../../../src/vue/chat/ChatToolIcon.vue';
import { provideCodexToolPresentation } from '../../../src/vue/chat/tool-presentation';
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
  it('directly renders the generic fallback icon', () => {
    const wrapper = mount(ChatToolIcon, {
      props: {
        toolCall: {
          args: undefined,
          done: true,
          function: 'custom_tool',
          id: 'generic-tool-icon',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });

    expect(wrapper.get('svg').classes()).toContain('tabler-icon-tool');
  });

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

  it('uses a tree-scoped app presentation for an owned MCP tool', () => {
    const BrowserIcon = defineComponent({
      name: 'BrowserIcon',
      setup: () => () => h('svg', { class: 'app-browser-icon' }),
    });
    const toolCall: MessageToolCall = {
      args: { url: 'https://example.com' },
      done: true,
      function: 'codex_claw.browser_open',
      id: 'browser-open',
      kind: 'mcp',
      metadata: { server: 'codex_claw', tool: 'browser_open' },
      result: undefined,
      state: 'completed',
      status: 'completed',
    };
    const Host = defineComponent({
      setup() {
        provideCodexToolPresentation(({ kind, metadata }) => (
          kind === 'mcp' && metadata?.server === 'codex_claw' && metadata.tool === 'browser_open'
            ? { icon: BrowserIcon, title: 'Opened in-app browser' }
            : undefined
        ));
        return () => h(ChatToolCall, { summaryOnly: true, toolCall });
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.get('.chat-tool-call__title').text()).toBe('Opened in-app browser');
    expect(wrapper.find('.app-browser-icon').exists()).toBe(true);
    expect(wrapper.find('.tabler-icon-tool').exists()).toBe(false);
  });

  it('keeps SDK fallback presentation when the provided resolver does not match', () => {
    const toolCall: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'other.tool',
      id: 'other-tool',
      kind: 'mcp',
      metadata: { server: 'other', tool: 'tool' },
      result: undefined,
      state: 'completed',
      status: 'completed',
    };
    const Host = defineComponent({
      setup() {
        provideCodexToolPresentation(() => undefined);
        return () => h(ChatToolCall, { summaryOnly: true, toolCall });
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-tool');
  });

  it('keeps SDK fallback presentation when an app returns an undefined icon', () => {
    const toolCall: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'other.tool',
      id: 'other-tool-with-undefined-icon',
      kind: 'mcp',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };
    const Host = defineComponent({
      setup() {
        provideCodexToolPresentation(() => ({ icon: undefined }));
        return () => h(ChatToolCall, { summaryOnly: true, toolCall });
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-tool');
  });

  it('keeps the terminal icon for a run command when the provided resolver does not match', () => {
    const toolCall: MessageToolCall = {
      args: { command: '/bin/bash -lc npm test' },
      done: true,
      function: '/bin/bash -lc npm test',
      id: 'run-command',
      kind: 'command',
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action: 'run',
        phase: 'completed',
        params: { target: '/bin/bash -lc npm test' },
        source: 'codex',
      }),
    };
    const Host = defineComponent({
      setup() {
        provideCodexToolPresentation(() => undefined);
        return () => h(ChatToolCall, { summaryOnly: true, toolCall });
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.get('.chat-tool-call__title').text()).toContain('Ran /bin/bash -lc npm test');
    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-terminal');
  });

  it('uses the command kind when a completed update has no structured descriptor', () => {
    const toolCall: MessageToolCall = {
      args: { command: '/bin/bash -lc npm test' },
      done: true,
      function: '/bin/bash -lc npm test',
      id: 'completed-command',
      kind: 'command',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.get('.chat-tool-call__title').text()).toContain('Ran /bin/bash -lc npm test');
    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-terminal');
  });

  it('allows a scoped resolver to suppress an icon explicitly', () => {
    const toolCall: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'quiet_tool',
      id: 'quiet-tool',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };
    const Host = defineComponent({
      setup() {
        provideCodexToolPresentation(() => ({ icon: null }));
        return () => h(ChatToolCall, { summaryOnly: true, toolCall });
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.find('.chat-tool-call__title svg').exists()).toBe(false);
    expect(wrapper.get('.chat-tool-call__title').text()).toBe('Ran quiet_tool');
  });
});
