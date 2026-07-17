import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ConversationSidebar from '../src/components/ConversationSidebar.vue';

const conversations = [{
  id: 'thread-1', title: 'Build a surface', preview: 'Build a surface', cwd: '/tmp/project', status: 'idle' as const,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}];

describe('ConversationSidebar', () => {
  it('renders SDK conversation data and exposes selection and creation interfaces', async () => {
    const wrapper = mount(ConversationSidebar, {
      props: { activeConversationId: 'thread-1', conversations },
    });
    expect(wrapper.get('[aria-current="page"]').text()).toContain('Build a surface');
    await wrapper.get('.conversation-sidebar__item').trigger('click');
    await wrapper.get('.conversation-sidebar__new').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['thread-1']]);
    expect(wrapper.emitted('create')).toHaveLength(1);
  });

  it('shows loading and empty states and respects disabled interactions', async () => {
    const wrapper = mount(ConversationSidebar, {
      props: { conversations: [], loading: true },
    });
    expect(wrapper.text()).toContain('Loading threads…');
    await wrapper.setProps({ disabled: true, loading: false });
    expect(wrapper.text()).toContain('No conversations yet');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});
