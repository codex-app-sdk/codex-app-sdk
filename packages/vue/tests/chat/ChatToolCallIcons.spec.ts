// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatToolCall from '../../src/chat/ChatToolCall.vue';
import ChatToolIcon from '../../src/chat/ChatToolIcon.vue';
import { provideCodexToolPresentation } from '../../src/chat/tool-presentation';
import type { MessageToolCall } from '../../src/chat/types';

const actions = [
  ['create', 'pencil'],
  ['delete', 'trash'],
  ['edit', 'pencil'],
  ['explore', 'folder'],
  ['list', 'folder'],
  ['plan', 'list-details'],
  ['read', 'file-text'],
  ['run', 'terminal-2'],
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

  it('uses command metadata without relying on command text', () => {
    const commandKind = mount(ChatToolIcon, {
      props: {
        toolCall: {
          args: undefined,
          done: true,
          function: 'opaque-tool',
          id: 'command-kind-only',
          kind: 'command',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });
    const commandArgument = mount(ChatToolIcon, {
      props: {
        toolCall: {
          args: { command: 'npm test' },
          done: true,
          function: 'opaque-tool',
          id: 'command-argument-only',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });
    const nonStringArgument = mount(ChatToolIcon, {
      props: {
        toolCall: {
          args: { command: false },
          done: true,
          function: 'opaque-tool',
          id: 'non-string-command',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });

    expect(commandKind.get('svg').classes()).toContain('tabler-icon-terminal-2');
    expect(commandArgument.get('svg').classes()).toContain('tabler-icon-terminal-2');
    expect(nonStringArgument.get('svg').classes()).toContain('tabler-icon-tool');
  });

  it.each([
    ['bash', true],
    ['/bin/bash -lc npm test', true],
    ['prefix bash -lc npm test', true],
    ['Run pwsh', true],
    ['fish --version', true],
    ['embash', false],
    ['bashful', false],
    ['prefix/bin/bash', false],
  ])('classifies shell-like function text %s: %s', (value, terminal) => {
    const wrapper = mount(ChatToolIcon, {
      props: {
        toolCall: {
          args: undefined,
          done: true,
          function: value,
          id: 'shell-text',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });

    expect(wrapper.get('svg').classes()).toContain(
      terminal ? 'tabler-icon-terminal-2' : 'tabler-icon-tool',
    );
  });

  it('treats null arguments as an ordinary non-command payload', () => {
    const errors: unknown[] = [];
    const wrapper = mount(ChatToolIcon, {
      global: { config: { errorHandler: (error) => errors.push(error) } },
      props: {
        toolCall: {
          args: null,
          done: true,
          function: 'opaque-tool',
          id: 'null-args',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });

    expect(errors).toStrictEqual([]);
    expect(wrapper.get('svg').classes()).toContain('tabler-icon-tool');
  });

  it('renders a dedicated icon for a web search tool', () => {
    const wrapper = mount(ChatToolIcon, {
      props: {
        toolCall: {
          args: { query: 'Codex App SDK' },
          done: true,
          function: 'Web search',
          id: 'web-search-icon',
          kind: 'webSearch',
          result: undefined,
          state: 'completed',
          status: 'completed',
        },
      },
    });

    expect(wrapper.get('svg').classes()).toContain('tabler-icon-world-search');
  });

  it('renders a dedicated image-generation icon and activity title', () => {
    const wrapper = mount(ChatToolCall, {
      props: {
        summaryOnly: true,
        toolCall: {
          args: { revisedPrompt: 'A paper sculpture' },
          done: false,
          function: 'image_generation',
          id: 'image-generation-icon',
          kind: 'dynamic',
          result: undefined,
          state: 'running',
          status: 'running',
        },
      },
    });

    expect(wrapper.get('.chat-tool-call__title').text()).toBe('Generating image');
    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-photo');
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

  it('renders provider-neutral semantic actions with the same native presentation', async () => {
    const toolCall: MessageToolCall = {
      args: {
        path: '/workspace/project/README.md',
        cwd: '/workspace/project',
      },
      done: true,
      function: 'Read',
      id: 'claude-read-file',
      result: '# Project',
      state: 'completed',
      status: JSON.stringify({
        action: 'read',
        phase: 'completed',
        source: 'claude',
        params: { target: 'README.md' },
      }),
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.get('.chat-tool-call__title').text()).toContain('Read README.md');
    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-file-text');
    await wrapper.get('.chat-tool-call__title-target--link').trigger('click');
    expect(wrapper.emitted('open-link')).toEqual([[
      {
        action: 'read',
        filepath: '/workspace/project/README.md',
        href: '/workspace/project/README.md',
        kind: 'file',
        path: '/workspace/project/README.md',
      },
    ]]);
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

  it('emits a full file link only when a file target is clicked', async () => {
    const toolCall: MessageToolCall = {
      args: {
        commandActions: [{ type: 'read', name: 'app-state.spec.ts', path: 'tests/app-state.spec.ts' }],
        cwd: '/workspace/project',
      },
      done: true,
      function: 'cat app-state.spec.ts',
      id: 'read-file-target',
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action: 'read',
        phase: 'completed',
        source: 'codex',
        params: { target: 'app-state.spec.ts' },
      }),
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.find('.chat-tool-call__title-target--link').exists()).toBe(true);
    expect(wrapper.emitted('open-link')).toBeUndefined();
    await wrapper.get('.chat-tool-call__title-target--link').trigger('click');
    expect(wrapper.emitted('open-link')).toEqual([[
      {
        action: 'read',
        filepath: '/workspace/project/tests/app-state.spec.ts',
        href: '/workspace/project/tests/app-state.spec.ts',
        kind: 'file',
        path: '/workspace/project/tests/app-state.spec.ts',
      },
    ]]);
  });

  it('includes tool context in a clicked file link', async () => {
    const toolCall: MessageToolCall = {
      args: {
        commandActions: [{ type: 'read', name: 'app-state.spec.ts', path: 'tests/app-state.spec.ts' }],
        cwd: '/workspace/project',
      },
      done: true,
      function: 'cat app-state.spec.ts',
      id: 'item-read',
      itemId: 'item-read',
      messageId: 'assistant-turn-context',
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action: 'read',
        phase: 'completed',
        source: 'codex',
        params: { target: 'app-state.spec.ts' },
      }),
      turnId: 'turn-context',
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    await wrapper.get('.chat-tool-call__title-target--link').trigger('click');
    expect(wrapper.emitted('open-link')).toEqual([[
      {
        action: 'read',
        filepath: '/workspace/project/tests/app-state.spec.ts',
        href: '/workspace/project/tests/app-state.spec.ts',
        itemId: 'item-read',
        kind: 'file',
        messageId: 'assistant-turn-context',
        path: '/workspace/project/tests/app-state.spec.ts',
        turnId: 'turn-context',
      },
    ]]);
  });

  it('renders each changed filename as an individually clickable target', async () => {
    const toolCall: MessageToolCall = {
      args: {
        changes: [
          { kind: 'update', path: '/workspace/project/tests/app-state.spec.ts' },
          { kind: 'update', path: '/workspace/project/src/ConversationPane.vue' },
        ],
      },
      done: true,
      function: 'fileChange',
      id: 'edit-file-targets',
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action: 'edit',
        phase: 'completed',
        source: 'codex',
        params: {
          addedLines: 2,
          removedLines: 0,
          target: 'app-state.spec.ts, ConversationPane.vue',
        },
      }),
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    const targets = wrapper.findAll('.chat-tool-call__title-target--link');
    expect(targets.map((target) => target.text())).toEqual(['app-state.spec.ts', 'ConversationPane.vue']);
    expect(wrapper.text()).not.toContain('2 files');

    await targets[0]!.trigger('click');
    await targets[1]!.trigger('click');
    expect(wrapper.emitted('open-link')).toEqual([
      [{ action: 'edit', filepath: '/workspace/project/tests/app-state.spec.ts', href: '/workspace/project/tests/app-state.spec.ts', kind: 'file', path: '/workspace/project/tests/app-state.spec.ts' }],
      [{ action: 'edit', filepath: '/workspace/project/src/ConversationPane.vue', href: '/workspace/project/src/ConversationPane.vue', kind: 'file', path: '/workspace/project/src/ConversationPane.vue' }],
    ]);
  });

  it('renders each read filename as an individually clickable target', async () => {
    const toolCall: MessageToolCall = {
      args: {
        commandActions: [
          { type: 'read', name: 'app-state.spec.ts', path: '/workspace/project/tests/app-state.spec.ts' },
          { type: 'read', name: 'ConversationPane.vue', path: '/workspace/project/src/ConversationPane.vue' },
        ],
      },
      done: true,
      function: 'cat files',
      id: 'read-file-targets',
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action: 'read',
        phase: 'completed',
        source: 'codex',
        params: { target: 'app-state.spec.ts, ConversationPane.vue' },
      }),
    };
    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    const targets = wrapper.findAll('.chat-tool-call__title-target--link');
    expect(targets.map((target) => target.text())).toEqual(['app-state.spec.ts', 'ConversationPane.vue']);

    await targets[1]!.trigger('click');
    expect(wrapper.emitted('open-link')).toEqual([[
      { action: 'read', filepath: '/workspace/project/src/ConversationPane.vue', href: '/workspace/project/src/ConversationPane.vue', kind: 'file', path: '/workspace/project/src/ConversationPane.vue' },
    ]]);
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
    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-terminal-2');
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
    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-terminal-2');
  });

  it('recognizes command-shaped calls when app-server kind metadata is missing', () => {
    const toolCall: MessageToolCall = {
      args: { command: 'npm test' },
      done: true,
      function: 'exec_command',
      id: 'command-shaped-tool',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-terminal-2');
  });

  it('recognizes completed shell commands from their rendered status text', () => {
    const toolCall: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'exec',
      id: 'completed-shell-status',
      result: undefined,
      state: 'completed',
      status: "Ran /bin/bash -lc 'git add src/vue/chat/ChatToolGroup.vue'",
    };

    const wrapper = mount(ChatToolCall, { props: { summaryOnly: true, toolCall } });

    expect(wrapper.get('.chat-tool-call__title svg').classes()).toContain('tabler-icon-terminal-2');
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
