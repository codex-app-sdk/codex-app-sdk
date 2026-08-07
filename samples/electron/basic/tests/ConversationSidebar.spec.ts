import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationSidebar from '../src/renderer/components/ConversationSidebar.vue';

const conversations = [{
  id: 'thread-1', title: 'Build a surface', preview: 'Build a surface', cwd: '/tmp/project', status: 'active' as const,
  turnCount: 2,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}, {
  id: 'thread-2', title: 'Run the tests', preview: 'Run the tests', cwd: '/tmp/project', status: 'active' as const,
  turnCount: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}];

describe('ConversationSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders SDK conversation data and exposes selection and creation interfaces', async () => {
    const wrapper = mount(ConversationSidebar, {
      props: { activeConversationId: 'thread-1', conversations },
    });
    expect(wrapper.get('[aria-current="page"]').text()).toContain('Build a surface');
    expect(wrapper.find('[aria-label="Status: active"]').exists()).toBe(true);
    await wrapper.get('.conversation-sidebar__select').trigger('click');
    await wrapper.get('.conversation-sidebar__new').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['thread-1']]);
    expect(wrapper.emitted('create')).toHaveLength(1);
  });

  it('shows loading and empty states and can disable creation', async () => {
    const wrapper = mount(ConversationSidebar, {
      props: { conversations: [], loading: true },
    });
    expect(wrapper.text()).toContain('Loading threads…');
    await wrapper.setProps({ createDisabled: true, loading: false });
    expect(wrapper.text()).toContain('No conversations yet');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('never disables switching conversations when creation is disabled', async () => {
    const wrapper = mount(ConversationSidebar, {
      props: { conversations, createDisabled: true },
    });

    expect(wrapper.get('.conversation-sidebar__new').attributes('disabled')).toBeDefined();
    const items = wrapper.findAll('.conversation-sidebar__select');
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.attributes('disabled') === undefined)).toBe(true);
    expect(wrapper.findAll('[aria-label="Status: active"]')).toHaveLength(2);
    await items[0]!.trigger('click');
    await items[1]!.trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['thread-1'], ['thread-2']]);
  });

  it('confirms a permanent thread deletion without also selecting the conversation', async () => {
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const wrapper = mount(ConversationSidebar, {
      props: { conversations },
    });
    const deleteButton = wrapper.get('[aria-label="Delete Build a surface"]');

    expect(deleteButton.attributes('title')).toBe('Delete thread');
    expect(deleteButton.find('svg[aria-hidden="true"]').exists()).toBe(true);

    await deleteButton.trigger('click');
    expect(confirm).toHaveBeenLastCalledWith(
      'Delete "Build a surface"? This permanently deletes the thread and cannot be undone.',
    );
    expect(wrapper.emitted('delete')).toBeUndefined();
    expect(wrapper.emitted('select')).toBeUndefined();

    await deleteButton.trigger('click');
    expect(wrapper.emitted('delete')).toStrictEqual([['thread-1']]);
    expect(wrapper.emitted('select')).toBeUndefined();
  });
});
