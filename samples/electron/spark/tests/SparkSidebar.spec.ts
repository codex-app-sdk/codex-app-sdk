import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SparkSidebar from '../src/renderer/components/SparkSidebar.vue';
import { surfaceSnapshot } from './fakes';

describe('SparkSidebar', () => {
  it('renders friendly SDK conversation data and emits navigation actions', async () => {
    const conversations = [
      ...surfaceSnapshot().conversations,
      {
        ...surfaceSnapshot().conversations[0]!,
        id: 'thread-2',
        title: 'Space Questions',
        preview: 'Why do stars shine?',
      },
    ];
    const wrapper = mount(SparkSidebar, {
      props: { activeConversationId: 'thread-1', accountLabel: 'grownup@example.com', conversations },
    });

    expect(wrapper.get('[aria-current="page"]').text()).toContain('Silly Dragon Story');
    expect(wrapper.text()).toContain('🪐');
    await wrapper.findAll('.spark-chat-card')[1]!.trigger('click');
    await wrapper.get('[aria-label="New chat"]').trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['thread-2']]);
    expect(wrapper.emitted('create')).toStrictEqual([[]]);
    expect(wrapper.text()).toContain('grownup@example.com');

    await wrapper.get('.spark-account__menu button').trigger('click');
    expect(wrapper.emitted('logout')).toStrictEqual([[]]);
  });

  it('shows kid-friendly loading and empty states', async () => {
    const wrapper = mount(SparkSidebar, {
      props: { conversations: [], loading: true },
    });

    expect(wrapper.text()).toContain('Finding your chats…');
    await wrapper.setProps({ createDisabled: true, loading: false });
    expect(wrapper.text()).toContain('Your next great question starts here!');
    expect(wrapper.get('[aria-label="New chat"]').attributes('disabled')).toBeDefined();
  });
});
