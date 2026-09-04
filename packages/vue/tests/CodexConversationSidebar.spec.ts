// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodexConversationSidebar from '../src/components/CodexConversationSidebar.vue';
import type { CodexConversationSummary } from '@codex-app-sdk/core/surface';

const conversations: CodexConversationSummary[] = [{
  id: 'thread-1', title: 'Build a surface', preview: 'Build a surface', cwd: '/tmp/project', status: 'active' as const,
  turnCount: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}, {
  id: 'thread-2', title: 'Run the tests', preview: 'Run the tests', cwd: '/tmp/project', status: 'active' as const,
  turnCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}];

describe('CodexConversationSidebar', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders conversation data and exposes selection and creation interfaces', async () => {
    const wrapper = mount(CodexConversationSidebar, {
      props: { activeConversationId: 'thread-1', brand: 'My Codex', conversations },
    });
    expect(wrapper.text()).toContain('My Codex');
    expect(wrapper.get('[aria-current="page"]').text()).toContain('Build a surface');
    expect(wrapper.findAll('[aria-label="Status: active"]')).toHaveLength(2);
    await wrapper.get('.codex-conversation-sidebar__select').trigger('click');
    await wrapper.get('.codex-conversation-sidebar__new').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['thread-1']]);
    expect(wrapper.emitted('create')).toHaveLength(1);
  });

  it('shows loading and empty states and disables creation only', async () => {
    const wrapper = mount(CodexConversationSidebar, {
      props: { conversations: [], loading: true },
    });
    expect(wrapper.text()).toContain('Loading threads…');
    await wrapper.setProps({ conversations, createDisabled: true, loading: false });
    expect(wrapper.get('.codex-conversation-sidebar__new').attributes('disabled')).toBeDefined();
    const items = wrapper.findAll('.codex-conversation-sidebar__select');
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.attributes('disabled') === undefined)).toBe(true);
  });

  it('renders the default brand and settled empty state', () => {
    const wrapper = mount(CodexConversationSidebar, { props: { conversations: [] } });

    expect(wrapper.get('.codex-conversation-sidebar__brand').text()).toBe('Codex');
    expect(wrapper.get('.codex-conversation-sidebar__empty').text()).toBe('No conversations yet');
    expect(wrapper.find('.codex-conversation-sidebar__list').exists()).toBe(false);
    expect(wrapper.get('.codex-conversation-sidebar__new').attributes('disabled')).toBeUndefined();
  });

  it('renders exact relative-time boundaries and clamps future updates to now', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const elapsedMinutes = [-1, 0, 1, 59, 60, 1_439, 1_440, 2_940];
    const wrapper = mount(CodexConversationSidebar, {
      props: {
        activeConversationId: null,
        conversations: elapsedMinutes.map((minutes, index) => ({
          ...conversations[0]!,
          id: `thread-${index}`,
          title: `Thread ${index}`,
          updatedAt: new Date(now.getTime() - minutes * 60_000).toISOString(),
        })),
      },
    });

    expect(wrapper.findAll('.codex-conversation-sidebar__time').map((time) => time.text())).toStrictEqual([
      'now',
      'now',
      '1m',
      '59m',
      '1h',
      '23h',
      '1d',
      '2d',
    ]);
    expect(wrapper.find('[aria-current]').exists()).toBe(false);
  });

  it('confirms permanent deletion without selecting the conversation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrapper = mount(CodexConversationSidebar, { props: { conversations } });
    const deleteButton = wrapper.get('[aria-label="Delete Build a surface"]');

    await deleteButton.trigger('click');
    expect(confirm).toHaveBeenLastCalledWith(
      'Delete "Build a surface"? This permanently deletes the thread and cannot be undone.',
    );
    expect(wrapper.emitted('delete')).toBeUndefined();
    expect(wrapper.emitted('select')).toBeUndefined();
    await deleteButton.trigger('click');
    expect(wrapper.emitted('delete')).toStrictEqual([['thread-1']]);
  });
});
