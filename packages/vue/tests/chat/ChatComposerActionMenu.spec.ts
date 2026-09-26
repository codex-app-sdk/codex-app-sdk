// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatComposerActionMenu from '../../src/chat/ChatComposerActionMenu.vue';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../../src/composer-menu';

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
    const approvalItems = wrapper.findAll('[role="menuitemradio"]');
    expect(approvalItems.map((item) => item.attributes('aria-checked')))
      .toStrictEqual(['false', 'false', 'true']);
    expect(approvalItems.map((item) => item.get('svg').attributes('class'))).toStrictEqual([
      expect.stringContaining('tabler-icon-hand-stop'),
      expect.stringContaining('tabler-icon-sparkles'),
      expect.stringContaining('codex-composer-menu-list__radio-check'),
    ]);
    await wrapper.findAll('[role="menuitemradio"]')[1]?.trigger('click');

    expect(wrapper.emitted('selectApprovalPreset')).toStrictEqual([['approve-for-me']]);
    expect(wrapper.find('.chat-composer-action-menu').exists()).toBe(false);
  });

  it.each([
    [false, true],
    [true, false],
  ])('toggles plan mode from %s to %s', async (planMode, expected) => {
    const wrapper = mountMenu({ planMode });

    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    const planItem = wrapper.get('[role="menuitemcheckbox"]');
    expect(planItem.attributes('aria-checked')).toBe(String(planMode));
    expect(planItem.find('.codex-composer-menu-list__switch').exists()).toBe(true);
    await planItem.trigger('click');

    expect(wrapper.emitted('update:planMode')).toStrictEqual([[expected]]);
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

  it('adds exactly one attachment separator only after an existing action', async () => {
    const attachOnly = mountMenu({ attachEnabled: true, showPlanMode: false });
    await attachOnly.get('.chat-composer-action-menu__button').trigger('click');
    expect(attachOnly.findAll('.codex-composer-menu-list__separator')).toHaveLength(0);

    const afterAction = mountMenu({ attachEnabled: true, showPlanMode: true });
    await afterAction.get('.chat-composer-action-menu__button').trigger('click');
    expect(afterAction.findAll('.codex-composer-menu-list__separator')).toHaveLength(1);

    const afterSeparator = mountMenu({
      attachEnabled: true,
      items: [{ id: 'existing-separator', type: 'separator' }],
      showPlanMode: false,
    });
    await afterSeparator.get('.chat-composer-action-menu__button').trigger('click');
    expect(afterSeparator.findAll('.codex-composer-menu-list__separator')).toHaveLength(1);
  });

  it.each([
    ['approval id without an action payload', { id: 'approval:host', type: 'custom', label: 'Approval host', payload: null }],
    ['approval payload without an approval id', {
      id: 'host-approval', type: 'custom', label: 'Host approval',
      payload: { kind: 'approval', preset: 'full-access' },
    }],
    ['non-approval action payload', {
      id: 'approval:attach', type: 'custom', label: 'Approval attach', payload: { kind: 'attach' },
    }],
    ['primitive payload', { id: 'approval:text', type: 'custom', label: 'Approval text', payload: 'host' }],
  ] satisfies Array<[string, CodexComposerMenuItem<unknown>]>)('routes a host item with %s to the host', async (_, item) => {
    const wrapper = mountMenu({ items: [item] });
    await wrapper.get('.chat-composer-action-menu__button').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes(item.label))!.trigger('click');

    expect(wrapper.emitted('select')).toStrictEqual([[item]]);
    expect(wrapper.emitted('selectApprovalPreset')).toBeUndefined();
    expect(wrapper.emitted('attach')).toBeUndefined();
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

  it('forwards host item and icon slots through both composer menu layers', async () => {
    const item: CodexComposerMenuItem<{ source: string }> = {
      id: 'host-action',
      type: 'custom',
      label: 'Host action',
      payload: { source: 'host' },
    };
    const itemSlotWrapper = mount(ChatComposerActionMenu, {
      props: {
        items: [item],
        planMode: false,
        showPlanMode: false,
      },
      slots: {
        item: ({ item: slotItem }: { item: CodexComposerMenuSelectableItem }) => (
          h('span', { class: 'host-menu-item' }, `item:${slotItem.label}`)
        ),
      },
    });
    await itemSlotWrapper.get('.chat-composer-action-menu__button').trigger('click');
    expect(itemSlotWrapper.get('.host-menu-item').text()).toBe('item:Host action');

    const iconSlotWrapper = mount(ChatComposerActionMenu, {
      props: {
        items: [item],
        planMode: false,
        showPlanMode: false,
      },
      slots: {
        icon: ({ item: slotItem }: { item: CodexComposerMenuSelectableItem }) => (
          h('span', { class: 'host-menu-icon' }, `icon:${slotItem.id}`)
        ),
      },
    });
    await iconSlotWrapper.get('.chat-composer-action-menu__button').trigger('click');

    expect(iconSlotWrapper.get('.host-menu-icon').text()).toBe('icon:host-action');
  });
});

function mountMenu(props: Partial<{
  approvalPreset: 'ask-for-approval' | 'approve-for-me' | 'full-access' | null;
  approvalPresets: ('ask-for-approval' | 'approve-for-me' | 'full-access')[];
  attachEnabled: boolean;
  disabled: boolean;
  leadingMenuItems: CodexComposerMenuItem<unknown>[];
  items: CodexComposerMenuItem<unknown>[];
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
