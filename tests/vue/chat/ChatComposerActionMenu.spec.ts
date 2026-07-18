// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatComposerActionMenu from '../../../src/vue/chat/ChatComposerActionMenu.vue';

describe('ChatComposerActionMenu', () => {
  it('closes when clicking outside the menu', async () => {
    const wrapper = mountMenu();

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    expect(wrapper.find('.chat-composer-action-menu').exists()).toBe(true);

    document.body.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.chat-composer-action-menu').exists()).toBe(false);
  });

  it('does not open when disabled', async () => {
    const wrapper = mountMenu({ disabled: true });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');

    expect(wrapper.find('.chat-composer-action-menu').exists()).toBe(false);
  });

  it('shows approval presets and emits selected mode', async () => {
    const wrapper = mountMenu({
      approvalPreset: 'full-access',
      approvalPresets: ['ask-for-approval', 'approve-for-me', 'full-access'],
      showApprovalMenu: true,
    });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');

    expect(wrapper.text()).toContain('Approval');
    expect(wrapper.text()).toContain('Ask for approval');
    expect(wrapper.text()).toContain('Approve for me');
    expect(wrapper.text()).toContain('Full access');
    expect(wrapper.find('.codex-composer-menu-list__chevron').exists()).toBe(true);
    await wrapper.findAll('[role="menuitemradio"]')[1]?.trigger('click');

    expect(wrapper.emitted('selectApprovalPreset')).toStrictEqual([['approve-for-me']]);
    expect(wrapper.find('.chat-composer-action-menu').exists()).toBe(false);
  });

  it('disables approval presets unavailable from backend capabilities', async () => {
    const wrapper = mountMenu({
      approvalPreset: 'ask-for-approval',
      approvalPresets: ['ask-for-approval'],
      showApprovalMenu: true,
    });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');

    expect(wrapper.text()).toContain('Approval');
    expect(wrapper.text()).toContain('Ask for approval');
    expect(wrapper.text()).toContain('Approve for me');
    expect(wrapper.text()).toContain('Full access');
    expect(wrapper.findAll('[role="menuitemradio"]').map((item) => item.attributes('disabled'))).toStrictEqual([
      undefined,
      '',
      '',
    ]);
  });

  it('merges host actions into the full menu and emits their payload', async () => {
    const wrapper = mountMenu({
      items: [{ id: 'refresh', type: 'custom', label: 'Refresh', payload: { source: 'host' } }],
    });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Refresh'))!.trigger('click');

    expect(wrapper.emitted('select')).toStrictEqual([[
      expect.objectContaining({ id: 'refresh', payload: { source: 'host' } }),
    ]]);
  });

  it('enables attachment selection only when the host supports it', async () => {
    const wrapper = mountMenu({ attachEnabled: true });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');

    expect(wrapper.emitted('attach')).toStrictEqual([[]]);
  });
});

function mountMenu(props: Partial<{
  approvalPreset: 'ask-for-approval' | 'approve-for-me' | 'full-access' | null;
  approvalPresets: ('ask-for-approval' | 'approve-for-me' | 'full-access')[];
  attachEnabled: boolean;
  disabled: boolean;
  items: { id: string; type: 'custom'; label: string; payload: { source: string } }[];
  planMode: boolean;
  showApprovalMenu: boolean;
}> = {}) {
  return mount(ChatComposerActionMenu, {
    props: {
      disabled: false,
      approvalPreset: null,
      planMode: false,
      showApprovalMenu: false,
      ...props,
    },
    attachTo: document.body,
  });
}
