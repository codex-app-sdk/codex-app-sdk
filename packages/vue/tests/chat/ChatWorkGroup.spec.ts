// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatWorkGroup from '../../src/chat/ChatWorkGroup.vue';

describe('ChatWorkGroup', () => {
  it('expands active work, collapses completed work, and lets the reader reopen it', async () => {
    const wrapper = mount(ChatWorkGroup, {
      props: { active: true, finalStarted: false },
      slots: { default: 'Inspected the renderer' },
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');

    await wrapper.setProps({ active: false, finalStarted: true });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');

    await wrapper.get('.chat-work-group__header').trigger('click');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
  });
});
