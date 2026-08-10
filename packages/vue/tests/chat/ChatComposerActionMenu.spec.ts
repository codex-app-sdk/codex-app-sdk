// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatComposerActionMenu from '../../src/chat/ChatComposerActionMenu.vue';

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

  it('selects an approval preset through the visible hover submenu', async () => {
    const wrapper = mountMenu({
      approvalPreset: 'ask-for-approval',
      approvalPresets: ['ask-for-approval', 'approve-for-me', 'full-access'],
      showApprovalMenu: true,
    });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    const approvalSubmenu = wrapper.get('.codex-composer-menu-list__submenu');
    await approvalSubmenu.trigger('mouseenter');

    expect(approvalSubmenu.classes()).toContain('codex-composer-menu-list__submenu--open');
    const fullAccess = wrapper.findAll('[role="menuitemradio"]')
      .find((item) => item.text().includes('Full access'))!;

    // Chromium briefly clears focus between pointer-down and focusing the
    // submenu item. The submenu must remain mounted for the matching click.
    const approvalTrigger = approvalSubmenu.get('button[role="menuitem"]');
    (approvalTrigger.element as HTMLButtonElement).blur();
    await wrapper.vm.$nextTick();
    (fullAccess.element as HTMLButtonElement).focus();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(approvalSubmenu.classes()).toContain('codex-composer-menu-list__submenu--open');
    await fullAccess.trigger('click');

    expect(wrapper.emitted('selectApprovalPreset')).toStrictEqual([['full-access']]);
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

  it('renders leading host actions after Approval and before Plan mode', async () => {
    const wrapper = mountMenu({
      approvalPreset: 'ask-for-approval',
      approvalPresets: ['ask-for-approval'],
      leadingMenuItems: [{
        id: 'permissions',
        type: 'custom',
        label: 'Permissions',
        payload: { source: 'host' },
      }],
      items: [{ id: 'refresh', type: 'custom', label: 'Refresh', payload: { source: 'host' } }],
      showApprovalMenu: true,
      showPlanMode: true,
    });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');

    const menu = wrapper.get('.chat-composer-action-menu').element;
    const labels = Array.from(menu.children).flatMap((child) => {
      const button = child instanceof HTMLButtonElement
        ? child
        : child.querySelector(':scope > button');
      const label = button?.querySelector('.codex-composer-menu-list__label')?.textContent?.trim();
      return label ? [label] : [];
    });
    expect(labels).toStrictEqual(['Approval', 'Permissions', 'Plan mode', 'Refresh']);
  });

  it('enables attachment selection only when the host supports it', async () => {
    const wrapper = mountMenu({ attachEnabled: true });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');

    expect(wrapper.emitted('attach')).toStrictEqual([[]]);
  });

  it('renders no action-menu root when every menu source is empty', () => {
    const wrapper = mountMenu({ attachEnabled: false, showPlanMode: false });

    expect(wrapper.find('.chat-composer-action-menu__root').exists()).toBe(false);
    expect(wrapper.find('.chat-composer-action-menu__button').exists()).toBe(false);
  });

  it('omits the attachment item and its separator when attachments are unavailable', async () => {
    const wrapper = mountMenu({ attachEnabled: false, showPlanMode: true });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');

    expect(wrapper.text()).toContain('Plan mode');
    expect(wrapper.text()).not.toContain('Add Files & Photos');
    expect(wrapper.find('.codex-composer-menu-list__separator').exists()).toBe(false);
  });
});

function mountMenu(props: Partial<{
  approvalPreset: 'ask-for-approval' | 'approve-for-me' | 'full-access' | null;
  approvalPresets: ('ask-for-approval' | 'approve-for-me' | 'full-access')[];
  attachEnabled: boolean;
  disabled: boolean;
  leadingMenuItems: { id: string; type: 'custom'; label: string; payload: { source: string } }[];
  items: { id: string; type: 'custom'; label: string; payload: { source: string } }[];
  planMode: boolean;
  showApprovalMenu: boolean;
  showPlanMode: boolean;
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
