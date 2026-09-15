// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatMessageBlock from '../../src/chat/ChatMessageBlock.vue';
import ChatFollowUps from '../../src/chat/ChatFollowUps.vue';
import ChatToolCall from '../../src/chat/ChatToolCall.vue';
import ChatToolGroup from '../../src/chat/ChatToolGroup.vue';
import ChatVisualizationBlock from '../../src/chat/ChatVisualizationBlock.vue';
import type { MessageBlock } from '../../src/chat/message-blocks';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatMessageBlock', () => {
  it.each([
    [{ type: 'user-text', content: 'hello `user`' }, 'hello'],
    [{ type: 'text', content: '**assistant** text' }, 'assistant'],
    [{ type: 'mermaid', code: 'graph TD\n  A[Start] --> B[Done]' }, 'Start'],
    [{ type: 'visualization', path: '/tmp/chart.html', title: 'Interactive chart' }, 'Interactive chart'],
    [{ type: 'media', media: { title: 'Chart', url: 'https://example.com/chart.png' } }, 'Chart'],
    [{ type: 'follow-ups', prompts: ['Run coverage'] }, 'Run coverage'],
  ] satisfies Array<[MessageBlock, string]>)('renders %s blocks', (block, expectedText) => {
    const wrapper = mount(ChatMessageBlock, {
      props: { block },
    });

    expect(wrapper.text()).toContain(expectedText);
  });

  it('renders markdown links, tables, and code blocks with id8 classes', () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          content: [
            '[Docs](docs/architecture.md)',
            '',
            '| Name | Status |',
            '| --- | --- |',
            '| Dina | working |',
            '',
            '```ts',
            'const ok = true',
            '```',
          ].join('\n'),
          type: 'text',
        },
      },
    });

    expect(wrapper.get('a.chat-message-link').attributes('href')).toBe('docs/architecture.md');
    expect(wrapper.find('.chat-message-link__icon--file').exists()).toBe(true);
    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.find('th').text()).toBe('Name');
    expect(wrapper.find('pre code').text()).toContain('const ok = true');
    expect(wrapper.get('[data-chat-code-copy]').attributes('aria-label')).toBe('Copy code');
  });

  it('copies assistant code and temporarily confirms completion', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(ChatMessageBlock, {
      props: { block: { type: 'text', content: '```sh\nnpm test\n```' } },
    });
    const button = wrapper.get<HTMLButtonElement>('[data-chat-code-copy]');

    await button.trigger('click');
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('npm test');
    expect(button.attributes('aria-label')).toBe('Code copied');
    expect(button.attributes('title')).toBe('Code copied');
    expect(button.attributes('data-copied')).toBe('true');
    expect(wrapper.find('.chat-code-block__check-icon').exists()).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(button.attributes('aria-label')).toBe('Copy code');
    expect(button.attributes('title')).toBe('Copy code');
    expect(button.attributes('data-copied')).toBeUndefined();
  });

  it('restarts the code-copy confirmation timeout after repeated copies', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(ChatMessageBlock, {
      props: { block: { type: 'text', content: '```sh\nnpm test\n```' } },
    });
    const button = wrapper.get<HTMLButtonElement>('[data-chat-code-copy]');

    await button.trigger('click');
    await Promise.resolve();
    vi.advanceTimersByTime(1_500);
    await button.trigger('click');
    await Promise.resolve();
    vi.advanceTimersByTime(500);

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(button.attributes('data-copied')).toBe('true');

    vi.advanceTimersByTime(1_500);
    expect(button.attributes('data-copied')).toBeUndefined();
  });

  it('cancels pending code-copy confirmation work when unmounted', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
    const wrapper = mount(ChatMessageBlock, {
      props: { block: { type: 'text', content: '```sh\nnpm test\n```' } },
    });

    await wrapper.get('[data-chat-code-copy]').trigger('click');
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);

    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores ordinary message clicks and copy controls whose code is gone', async () => {
    const onError = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(ChatMessageBlock, {
      global: { config: { errorHandler: onError } },
      props: { block: { type: 'text', content: 'Intro\n\n```sh\nnpm test\n```' } },
    });

    await wrapper.get('p').trigger('click');
    expect(writeText).not.toHaveBeenCalled();

    wrapper.get('pre code').element.remove();
    await wrapper.get('[data-chat-code-copy]').trigger('click');
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores bubbled clicks whose target is not an element without reporting an application error', async () => {
    const onError = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(ChatMessageBlock, {
      global: { config: { errorHandler: onError } },
      props: { block: { type: 'text', content: 'Plain assistant text' } },
    });
    const textNode = wrapper.get('p').element.firstChild;
    expect(textNode).not.toBeNull();

    textNode!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a copy-like control outside a rendered code block without reporting an application error', async () => {
    const onError = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(ChatMessageBlock, {
      global: { config: { errorHandler: onError } },
      props: { block: { type: 'text', content: '```sh\nnpm test\n```' } },
    });
    const root = wrapper.get('.chat-message-block--text').element;
    const button = wrapper.get<HTMLButtonElement>('[data-chat-code-copy]').element;
    button.remove();
    root.append(button);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('emits follow-up prompts from follow-up blocks', async () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: { type: 'follow-ups', prompts: ['Continue'] },
      },
    });

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('send-follow-up')).toStrictEqual([['Continue']]);
  });

  it('routes visualization artifacts through the dedicated app-owned action', async () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: { type: 'visualization', path: '/tmp/backlog.html', title: 'Backlog candidates' },
      },
    });

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('open-visualization')).toStrictEqual([[
      { path: '/tmp/backlog.html', title: 'Backlog candidates' },
    ]]);
    expect(wrapper.emitted('open-link')).toBeUndefined();
  });

  it('renders single tools and tool groups', async () => {
    const tool = {
      args: { command: 'npm test' },
      done: true,
      function: 'npm test',
      id: 'tool-1',
      result: 'passed',
      state: 'completed' as const,
      status: 'completed',
    };
    const single = mount(ChatMessageBlock, {
      props: {
        block: { type: 'tool', toolCall: tool },
      },
    });
    expect(single.text()).toContain('Ran npm test');

    const group = mount(ChatMessageBlock, {
      props: {
        block: { type: 'tool-group', toolCalls: [tool, { ...tool, id: 'tool-2', function: 'git status' }] },
      },
    });
    expect(group.text()).toContain('2 actions done');

    const titled = mount(ChatMessageBlock, {
      props: {
        block: {
          type: 'tool-group',
          activityTitle: 'Planning targeted filename searches',
          toolCalls: [tool],
        },
      },
    });
    expect(titled.get('.chat-tool-group__title').text())
      .toBe('Planning targeted filename searches · 1 action done');
    await titled.get('.chat-tool-group__header').trigger('click');
    expect(titled.get('.chat-tool-group__body').text()).toContain('Ran npm test');
  });

  it('keeps the completed counter while showing every active tool below it', async () => {
    const completed = {
      args: { command: 'npm test' },
      done: true,
      function: 'npm test',
      id: 'completed-tool',
      result: 'passed',
      state: 'completed' as const,
      status: 'completed',
    };
    const running = {
      args: { path: 'src/main.ts' },
      done: false,
      function: 'read_file',
      id: 'running-tool',
      result: undefined,
      state: 'running' as const,
      status: JSON.stringify({ source: 'codex', action: 'read', phase: 'running', params: { target: 'src/main.ts' } }),
    };
    const secondRunning = {
      ...running,
      id: 'second-running-tool',
      function: 'git status',
      status: JSON.stringify({ source: 'codex', action: 'run', phase: 'running', params: { target: 'git status' } }),
    };

    const wrapper = mount(ChatMessageBlock, {
      props: { block: { type: 'tool-group', toolCalls: [completed, running, secondRunning] } },
    });

    expect(wrapper.get('.chat-tool-group__title').text()).toBe('1 action done');
    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Reading main.ts');
    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Running git status');
    expect(wrapper.get('.chat-tool-group__running').findAll('.chat-tool-call')).toHaveLength(2);
    expect(wrapper.get('.chat-tool-group__body').findAll('.chat-tool-call')).toHaveLength(1);

    await wrapper.get('.chat-tool-group__header').trigger('click');
    expect(wrapper.get('.chat-tool-group__running').classes()).toContain('chat-tool-group__running--after-completed');
    const titles = wrapper.findAll('.chat-tool-call__title').map((title) => title.text());
    expect(titles[0]).toContain('Ran npm test');
    expect(titles.slice(1)).toEqual(expect.arrayContaining(['Reading main.ts', 'Running git status']));
  });

  it('does not render a zero-count header while every tool is running', () => {
    const running = {
      args: { path: 'src/main.ts' },
      done: false,
      function: 'read_file',
      id: 'running-only-tool',
      result: undefined,
      state: 'running' as const,
      status: JSON.stringify({ source: 'codex', action: 'read', phase: 'running', params: { target: 'src/main.ts' } }),
    };

    const wrapper = mount(ChatMessageBlock, {
      props: { block: { type: 'tool-group', toolCalls: [running] } },
    });

    expect(wrapper.find('.chat-tool-group__header').exists()).toBe(false);
    expect(wrapper.get('.chat-tool-group__running').text()).toContain('Reading main.ts');
  });

  it('forwards tool cancellation and client response events', async () => {
    const tool = {
      args: { command: 'npm test' },
      done: false,
      function: 'npm test',
      id: 'tool-1',
      result: undefined,
      state: 'running' as const,
      status: JSON.stringify({
        action: 'run',
        phase: 'running',
        source: 'codex',
      }),
    };
    const response = {
      id: 'approval-1',
      payload: {
        decision: 'allow',
      },
    };
    const link = {
      href: 'https://example.com/tool-result',
      kind: 'external' as const,
    };
    const single = mount(ChatMessageBlock, {
      props: {
        block: { type: 'tool', toolCall: tool },
      },
    });

    single.getComponent(ChatToolCall).vm.$emit('cancel');
    single.getComponent(ChatToolCall).vm.$emit('client-response', response);
    single.getComponent(ChatToolCall).vm.$emit('open-link', link);
    await single.vm.$nextTick();

    expect(single.emitted('cancel')).toStrictEqual([[]]);
    expect(single.emitted('client-response')).toStrictEqual([[response]]);
    expect(single.emitted('open-link')).toStrictEqual([[link]]);

    const group = mount(ChatMessageBlock, {
      props: {
        block: { type: 'tool-group', toolCalls: [tool] },
      },
    });

    group.getComponent(ChatToolGroup).vm.$emit('cancel');
    group.getComponent(ChatToolGroup).vm.$emit('client-response', response);
    group.getComponent(ChatToolGroup).vm.$emit('open-link', link);
    await group.vm.$nextTick();

    expect(group.emitted('cancel')).toStrictEqual([[]]);
    expect(group.emitted('client-response')).toStrictEqual([[response]]);
    expect(group.emitted('open-link')).toStrictEqual([[link]]);
  });

  it('forwards actions from tools and artifacts nested inside phased work', async () => {
    const tool = {
      args: {},
      done: false,
      function: 'ask_user_question',
      id: 'question-1',
      result: null,
      state: 'running' as const,
    };
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          type: 'work-group', active: true, finalStarted: false,
          blocks: [
            { type: 'tool', toolCall: tool },
            { type: 'visualization', path: '/tmp/chart.html', title: 'Chart' },
            { type: 'follow-ups', prompts: ['Continue'] },
          ],
        },
      },
    });
    const response = { id: 'question-1', payload: { answers: { choice: 'yes' } } };
    const link = { href: 'https://example.com/result', kind: 'external' as const };
    const visualization = { path: '/tmp/chart.html', title: 'Chart' };

    wrapper.getComponent(ChatToolCall).vm.$emit('cancel');
    wrapper.getComponent(ChatToolCall).vm.$emit('client-response', response);
    wrapper.getComponent(ChatToolCall).vm.$emit('open-link', link);
    wrapper.getComponent(ChatVisualizationBlock).vm.$emit('open-visualization', visualization);
    wrapper.getComponent(ChatFollowUps).vm.$emit('send-follow-up', 'Continue');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    expect(wrapper.emitted('client-response')).toStrictEqual([[response]]);
    expect(wrapper.emitted('open-link')).toStrictEqual([[link]]);
    expect(wrapper.emitted('open-visualization')).toStrictEqual([[visualization]]);
    expect(wrapper.emitted('send-follow-up')).toStrictEqual([['Continue']]);
  });

  it('applies custom text and tool rendering inside phased work', () => {
    const tool = {
      args: {}, done: true, function: 'shell', id: 'shell-1', result: 'done', state: 'completed' as const,
    };
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          type: 'work-group', active: false, finalStarted: true,
          blocks: [
            { type: 'text', content: 'Checking the result', phase: 'commentary' },
            { type: 'tool', toolCall: tool },
          ],
        },
      },
      slots: {
        text: ({ content }: { content: string }) => `Custom text: ${content}`,
        tool: ({ toolCall }: { toolCall?: { id: string } }) => `Custom tool: ${toolCall?.id}`,
      },
    });

    expect(wrapper.text()).toContain('Custom text: Checking the result');
    expect(wrapper.text()).toContain('Custom tool: shell-1');
  });

  it('renders mermaid blocks as SVG diagrams and toggles source code', async () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          code: [
            'graph TD',
            '  A[Start] --> B[Done]',
          ].join('\n'),
          type: 'mermaid',
        },
      },
    });

    expect(wrapper.find('.chat-mermaid-block__diagram svg').exists()).toBe(true);
    expect(wrapper.find('.chat-mermaid-block').text()).toContain('Start');
    expect(wrapper.find('.chat-mermaid-block').text()).toContain('Done');

    await wrapper.find('[aria-label="Show source"]').trigger('click');
    expect(wrapper.find('.chat-mermaid-block__diagram svg').exists()).toBe(false);
    expect(wrapper.find('.chat-mermaid-block__code').text()).toContain('graph TD');

    await wrapper.find('[aria-label="Render diagram"]').trigger('click');
    expect(wrapper.find('.chat-mermaid-block__diagram svg').exists()).toBe(true);
  });

  it('opens mermaid blocks fullscreen and closes with escape', async () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          code: [
            'graph TD',
            '  A[Start] --> B[Done]',
          ].join('\n'),
          type: 'mermaid',
        },
      },
    });

    await wrapper.find('[aria-label="Open fullscreen"]').trigger('click');
    expect(document.body.querySelector('.chat-mermaid-block__fullscreen .chat-mermaid-block__diagram svg')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(document.body.querySelector('.chat-mermaid-block__fullscreen')).toBeNull();
  });

  it('renders mermaid parser errors inside the diagram block', () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          code: 'not mermaid',
          type: 'mermaid',
        },
      },
    });

    expect(wrapper.find('.chat-mermaid-block__error').text()).toContain('Invalid');
  });

  it('keeps mermaid labels escaped when rendering SVG', () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          code: [
            'graph TD',
            '  A[<script>alert(1)</script>] --> B[Done]',
          ].join('\n'),
          type: 'mermaid',
        },
      },
    });

    expect(wrapper.find('.chat-mermaid-block__diagram svg').exists()).toBe(true);
    expect(wrapper.html()).not.toContain('<script>');
    expect(wrapper.html()).toContain('&lt;script&gt;');
  });

  it('renders media fallback labels and prompt details', async () => {
    const noCaption = mount(ChatMessageBlock, {
      props: {
        block: { type: 'media', media: { url: 'https://example.com/image.png' } },
      },
    });
    expect(noCaption.find('.chat-media-block__title').text()).toBe('Generated media');
    expect(noCaption.get('.chat-media-block__image').attributes('alt')).toBe('Generated media');
    expect(noCaption.find('[aria-label="Prompt"]').exists()).toBe(false);

    const promptCaption = mount(ChatMessageBlock, {
      props: {
        block: { type: 'media', media: { prompt: 'Draw the UI', url: 'https://example.com/image.png' } },
      },
    });
    await promptCaption.find('[aria-label="Prompt"]').trigger('click');
    expect(promptCaption.find('.chat-media-block__prompt').text()).toBe('Draw the UI');
  });

  it('opens media fullscreen and closes by clicking the backdrop', async () => {
    const wrapper = mount(ChatMessageBlock, {
      props: {
        block: {
          media: {
            alt: 'A bright product photo',
            title: 'A bright product photo',
            url: '/artifacts/image.png',
          },
          type: 'media',
        },
      },
    });

    expect(wrapper.find('[aria-label="Download media"]').attributes('download')).toBe('A bright product photo');

    await wrapper.find('.chat-media-block__actions [aria-label="Open fullscreen"]').trigger('click');

    const fullscreenImage = document.body.querySelector('.chat-media-block__fullscreen-image');
    expect(fullscreenImage?.getAttribute('src')).toBe('/artifacts/image.png');
    expect(fullscreenImage?.getAttribute('alt')).toBe('A bright product photo');

    document.body.querySelector<HTMLElement>('.chat-media-block__fullscreen')?.click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.chat-media-block__fullscreen')).toBeNull();
  });
});
