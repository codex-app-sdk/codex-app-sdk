// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import ChatCompactionMessage from '../../src/vue/chat/ChatCompactionMessage.vue';
import CodexMessage from '../../src/vue/components/CodexMessage.vue';
import ChatMessageEditor from '../../src/vue/chat/ChatMessageEditor.vue';

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountMessage(props: Record<string, unknown>) {
  return mount(CodexMessage, {
    props: props as never,
  });
}

describe('CodexMessage', () => {
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

  it('hides ambient context from rendering, editing, and clipboard output', async () => {
    const wrapper = mountMessage({
      message: {
        id: 'user-with-ambient-context',
        role: 'user',
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
      canDeleteMessage: false,
      canEditMessage: false,
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
      canDeleteMessage: false,
      canRetryMessage: false,
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
      canDeleteMessage: false,
      canEditMessage: true,
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
      message: { role: 'user', content: 'Old prompt', createdAt: new Date().toISOString() },
    });

    await wrapper.find('[aria-label="Quote"]').trigger('click');
    await wrapper.find('[aria-label="Delete"]').trigger('click');
    await wrapper.find('[aria-label="Edit"]').trigger('click');
    wrapper.getComponent(ChatMessageEditor).vm.$emit('save', 'New prompt');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('quote-message')).toStrictEqual([[2]]);
    expect(wrapper.emitted('delete-message')).toStrictEqual([[2]]);
    expect(wrapper.emitted('edit-message')).toStrictEqual([[{ content: 'New prompt', index: 2 }]]);
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

  it('renders assistant retry actions and reserves them while streaming', async () => {
    const wrapper = mountMessage({
      index: 5,
      message: { role: 'assistant', content: 'Answer', createdAt: new Date().toISOString() },
    });
    const streaming = mountMessage({
      message: { role: 'assistant', content: 'Answer', streaming: true },
    });

    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Delete"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Edit"]').exists()).toBe(false);
    await wrapper.find('[aria-label="Retry"]').trigger('click');
    await wrapper.find('[aria-label="Delete"]').trigger('click');
    expect(wrapper.emitted('retry-message')).toStrictEqual([[5]]);
    expect(wrapper.emitted('delete-message')).toStrictEqual([[5]]);
    expect(streaming.get('.chat-message__actions').classes()).toContain('chat-message__actions--reserved');
    expect(streaming.get('.chat-message__actions').attributes('aria-hidden')).toBe('true');
  });
});
