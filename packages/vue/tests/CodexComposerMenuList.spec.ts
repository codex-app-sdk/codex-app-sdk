// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { CodexComposerMenuList, type CodexComposerMenuItem } from '../src';

describe('CodexComposerMenuList', () => {
  const HeadingIcon = (props: Record<string, unknown>) => h('svg', { ...props, 'data-icon': 'heading' });
  const ValueIcon = (props: Record<string, unknown>) => h('svg', { ...props, 'data-icon': 'value' });
  const headingAction = {
    id: 'manage-actions',
    type: 'action' as const,
    label: 'Manage actions',
    icon: HeadingIcon,
    payload: { source: 'host' },
  };
  const items: CodexComposerMenuItem<{ source: string }>[] = [
    { id: 'heading', type: 'heading', label: 'Actions', actions: [headingAction] },
    { id: 'separator', type: 'separator' },
    {
      id: 'custom-tool',
      type: 'custom',
      label: 'Run custom tool',
      description: 'Provided by the host application',
      value: 'H',
      valueAppearance: 'badge',
      valueIcon: ValueIcon,
      valueIconLabel: 'Fast',
      payload: { source: 'plugin' },
    },
    {
      id: 'plan-mode',
      type: 'checkbox',
      label: 'Plan mode',
      checked: true,
      accessory: 'switch',
      payload: { source: 'built-in' },
    },
    {
      id: 'approval',
      type: 'submenu',
      label: 'Approval',
      submenuAlignment: 'bottom',
      items: [{
        id: 'approval:user',
        type: 'radio',
        label: 'Ask first',
        checked: true,
        payload: { source: 'built-in' },
      }],
    },
  ];

  it('renders every item shape and emits the selected typed item', async () => {
    const wrapper = mount(CodexComposerMenuList, {
      props: { ariaLabel: 'Prompt actions', items },
    });

    expect(wrapper.get('[role="menu"]').attributes('aria-label')).toBe('Prompt actions');
    expect(wrapper.get('.codex-composer-menu-list__heading').text()).toBe('Actions');
    const headingButton = wrapper.get('button[aria-label="Manage actions"]');
    expect(headingButton.attributes('title')).toBe('Manage actions');
    expect(headingButton.get('[data-icon="heading"]').attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Provided by the host application');
    const valueIcon = wrapper.get('[data-icon="value"]');
    expect(wrapper.get('.codex-composer-menu-list__value-badge').text()).toBe('H');
    expect(valueIcon.attributes('aria-label')).toBe('Fast');
    expect(valueIcon.attributes('title')).toBe('Fast');
    expect(wrapper.text()).toContain('Ask first');
    expect(wrapper.get('.codex-composer-menu-list__submenu-list').classes())
      .toContain('codex-composer-menu-list__submenu-list--bottom-aligned');
    expect(wrapper.get('.codex-composer-menu-list__switch').classes())
      .toContain('codex-composer-menu-list__switch--checked');

    const customAction = wrapper.findAll('button').find((button) => button.text().includes('Run custom tool'))!;
    await customAction.trigger('click');

    expect(wrapper.emitted('select')?.[0]).toStrictEqual([items[2]]);

    await headingButton.trigger('click');
    expect(wrapper.emitted('select')?.[1]).toStrictEqual([headingAction]);
  });

  it('supports host item and icon slots while suppressing disabled selection', async () => {
    const disabledItems: CodexComposerMenuItem[] = [{
      id: 'disabled',
      type: 'action',
      label: 'Disabled action',
      disabled: true,
    }];
    const wrapper = mount(CodexComposerMenuList, {
      props: { items: disabledItems },
      slots: {
        item: ({ item }: { item: { label: string } }) => h('span', { class: 'host-item' }, `Host ${item.label}`),
      },
    });

    expect(wrapper.text()).toContain('Host Disabled action');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();

    const iconWrapper = mount(CodexComposerMenuList, {
      props: { items: disabledItems },
      slots: { icon: ({ item }: { item: { label: string } }) => h('span', { class: 'host-icon' }, `!${item.label}`) },
    });
    expect(iconWrapper.find('.host-icon').exists()).toBe(true);
    expect(iconWrapper.find('.host-icon').text()).toBe('!Disabled action');
  });

  it('renders exact accessible states, decorations, and first-focus priority', () => {
    const Icon = (props: Record<string, unknown>) => h('svg', { ...props, 'data-icon': 'custom' });
    const semanticItems: CodexComposerMenuItem[] = [
      { id: 'heading', type: 'heading', label: 'Section' },
      { id: 'separator', type: 'separator' },
      { id: 'empty', type: 'submenu', label: 'Empty', items: [] },
      { id: 'disabled', type: 'action', label: 'Disabled', disabled: true },
      { id: 'empty-color', type: 'action', label: 'Empty color', leadingColor: '' },
      {
        id: 'danger',
        type: 'action',
        label: 'Delete',
        description: 'Cannot be undone',
        value: '⌘D',
        danger: true,
        leadingColor: 'rgb(255, 0, 0)',
      },
      { id: 'custom', type: 'custom', label: 'Custom', danger: true, icon: Icon },
      { id: 'check', type: 'checkbox', label: 'Check', checked: false },
      { id: 'switch-off', type: 'checkbox', label: 'Switch off', accessory: 'switch', checked: false },
      { id: 'radio', type: 'radio', label: 'Radio', checked: true },
      {
        id: 'wide',
        type: 'submenu',
        label: 'Wide',
        submenuAlignment: 'bottom',
        submenuWidth: 'wide',
        items: [{ id: 'child', type: 'action', label: 'Child' }],
      },
      {
        id: 'default-submenu',
        type: 'submenu',
        label: 'Default submenu',
        items: [{ id: 'default-child', type: 'action', label: 'Default child' }],
      },
    ];
    const wrapper = mount(CodexComposerMenuList, { props: { items: semanticItems } });
    const button = (label: string) => wrapper.findAll('button').find((candidate) => candidate.text().includes(label))!;

    const menu = wrapper.get('[role="menu"]');
    expect(menu.attributes('aria-label')).toBe('Composer actions');
    expect(menu.classes()).toEqual(expect.arrayContaining(['codex-chat-theme', 'codex-composer-menu-list']));
    expect(wrapper.get('.codex-composer-menu-list__heading').attributes('role')).toBe('presentation');
    expect(wrapper.get('.codex-composer-menu-list__separator').attributes('role')).toBe('separator');

    expect(button('Empty').attributes('disabled')).toBeDefined();
    expect(button('Empty').attributes('aria-expanded')).toBe('false');
    expect(button('Disabled').attributes('disabled')).toBeDefined();
    expect(button('Disabled').get('.codex-composer-menu-list__icon--empty').attributes('aria-hidden')).toBe('true');
    expect(button('Empty color').find('.codex-composer-menu-list__color-dot').exists()).toBe(false);
    expect(button('Empty color').find('.codex-composer-menu-list__icon--empty').exists()).toBe(true);
    expect(button('Empty color').attributes('tabindex')).toBe('0');
    expect(button('Delete').attributes('tabindex')).toBe('-1');
    expect(button('Delete').attributes('type')).toBe('button');
    expect(button('Delete').attributes('role')).toBe('menuitem');
    expect(button('Delete').classes()).toContain('codex-composer-menu-list__item--danger');
    expect(button('Delete').find('.codex-composer-menu-list__description').text()).toBe('• Cannot be undone');
    expect(button('Delete').find('.codex-composer-menu-list__value').text()).toBe('⌘D');
    expect(button('Delete').find('.codex-composer-menu-list__color-dot').attributes('style')).toContain('background-color: rgb(255, 0, 0)');
    expect(button('Delete').find('.codex-composer-menu-list__color-dot').attributes('aria-hidden')).toBe('true');

    expect(button('Custom').find('[data-icon="custom"]').classes()).toContain('codex-composer-menu-list__icon');
    expect(button('Custom').find('[data-icon="custom"]').attributes('aria-hidden')).toBe('true');
    expect(button('Custom').classes()).toContain('codex-composer-menu-list__item--danger');
    expect(button('Check').attributes('role')).toBe('menuitemcheckbox');
    expect(button('Check').classes()).toContain('codex-composer-menu-list__item');
    expect(button('Check').classes()).not.toContain('codex-composer-menu-list__item--danger');
    expect(button('Check').attributes('aria-checked')).toBe('false');
    expect(button('Check').get('.codex-composer-menu-list__selection').text()).toBe('');
    expect(button('Radio').attributes('role')).toBe('menuitemradio');
    expect(button('Radio').attributes('aria-checked')).toBe('true');
    expect(button('Radio').get('.codex-composer-menu-list__selection').text()).toBe('✓');
    expect(button('Radio').get('.codex-composer-menu-list__selection').attributes('aria-hidden')).toBe('true');
    expect(button('Switch off').get('.codex-composer-menu-list__switch').classes())
      .not.toContain('codex-composer-menu-list__switch--checked');
    expect(button('Switch off').get('.codex-composer-menu-list__switch').attributes('aria-hidden')).toBe('true');
    expect(button('Switch off').find('.codex-composer-menu-list__switch-thumb').exists()).toBe(true);
    expect(button('Empty color').find('.codex-composer-menu-list__selection').exists()).toBe(false);
    expect(button('Wide').get('.codex-composer-menu-list__chevron').attributes('aria-hidden')).toBe('true');
    expect(button('Wide').get('.codex-composer-menu-list__chevron').text()).toBe('›');
    expect(button('Wide').classes()).toContain('codex-composer-menu-list__item');
    expect(button('Wide').attributes('tabindex')).toBe('-1');
    expect(button('Wide').attributes('type')).toBe('button');
    expect(button('Wide').attributes('aria-haspopup')).toBe('menu');
    expect(wrapper.get('[data-submenu-id="wide"] > .codex-composer-menu-list__submenu-list').classes())
      .toEqual(expect.arrayContaining([
        'codex-composer-menu-list__submenu-list--bottom-aligned',
        'codex-composer-menu-list__submenu-list--wide',
      ]));
    expect(wrapper.get('[data-submenu-id="default-submenu"] > .codex-composer-menu-list__submenu-list').classes())
      .toStrictEqual(['codex-composer-menu-list', 'codex-composer-menu-list__submenu-list']);
    expect(button('Delete').find('.codex-composer-menu-list__copy').exists()).toBe(true);
    expect(button('Delete').find('.codex-composer-menu-list__label').text()).toBe('Delete');
  });

  it('wraps keyboard focus while skipping disabled and structural items', async () => {
    const keyboardItems: CodexComposerMenuItem[] = [
      { id: 'heading', type: 'heading', label: 'Heading' },
      { id: 'first', type: 'action', label: 'First' },
      { id: 'disabled', type: 'action', label: 'Disabled', disabled: true },
      { id: 'middle', type: 'action', label: 'Middle' },
      { id: 'last', type: 'action', label: 'Last' },
    ];
    const wrapper = mount(CodexComposerMenuList, { attachTo: document.body, props: { items: keyboardItems } });
    const [first, disabled, middle, last] = wrapper.findAll('button');

    first!.element.focus();
    const arrowDown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' });
    const stopPropagation = vi.spyOn(arrowDown, 'stopPropagation');
    first!.element.dispatchEvent(arrowDown);
    await wrapper.vm.$nextTick();
    expect(arrowDown.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(middle!.element);
    expect(first!.attributes('tabindex')).toBe('-1');
    expect(middle!.attributes('tabindex')).toBe('0');
    await middle!.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first!.element);
    await first!.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last!.element);
    await last!.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first!.element);
    await first!.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(last!.element);
    await last!.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(first!.element);
    expect(disabled!.attributes('tabindex')).toBe('-1');
    const arrowLeft = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' });
    first!.element.dispatchEvent(arrowLeft);
    expect(arrowLeft.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first!.element);
    wrapper.unmount();
  });

  it('makes a populated submenu first-focusable without preopening disabled submenus', async () => {
    const firstItems: CodexComposerMenuItem[] = [{
      id: 'first-submenu',
      type: 'submenu',
      label: 'First submenu',
      items: [{ id: 'child', type: 'action', label: 'Child' }],
    }];
    const wrapper = mount(CodexComposerMenuList, { props: { items: firstItems } });
    const trigger = wrapper.get('[data-submenu-id="first-submenu"] > button');

    expect(trigger.attributes('tabindex')).toBe('0');
    await wrapper.setProps({ items: [{
      id: 'first-submenu',
      type: 'submenu',
      label: 'First submenu',
      disabled: true,
      items: [{ id: 'child', type: 'action', label: 'Child' }],
    }] });
    await wrapper.get('[data-submenu-id="first-submenu"]').trigger('mouseenter');
    trigger.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    expect(trigger.attributes('aria-expanded')).toBe('false');
    await wrapper.setProps({ items: firstItems });
    expect(trigger.attributes('aria-expanded')).toBe('false');
    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    trigger.element.dispatchEvent(enter);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(enter.defaultPrevented).toBe(false);
  });

  it('toggles submenus by click and preserves them while focus remains inside', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mount(CodexComposerMenuList, { attachTo: document.body, props: { items } });
      const container = wrapper.get('[data-submenu-id="approval"]');
      const trigger = container.get(':scope > button');
      const child = container.get('.codex-composer-menu-list__submenu-list button');

      await trigger.trigger('click');
      expect(trigger.attributes('aria-expanded')).toBe('true');
      expect(container.classes()).toContain('codex-composer-menu-list__submenu--open');
      await trigger.trigger('click');
      expect(trigger.attributes('aria-expanded')).toBe('false');
      await container.trigger('mouseenter');
      (child.element as HTMLElement).focus();
      await container.trigger('mouseleave');
      expect(trigger.attributes('aria-expanded')).toBe('true');

      container.element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: child.element }));
      vi.runAllTimers();
      expect(trigger.attributes('aria-expanded')).toBe('true');
      (child.element as HTMLElement).blur();
      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      container.element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
      (child.element as HTMLElement).focus();
      vi.runAllTimers();
      await wrapper.vm.$nextTick();
      expect(trigger.attributes('aria-expanded')).toBe('true');
      (child.element as HTMLElement).blur();
      outside.focus();
      container.element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
      vi.runAllTimers();
      await wrapper.vm.$nextTick();
      expect(trigger.attributes('aria-expanded')).toBe('false');
      outside.remove();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens submenus on hover or ArrowRight without opening them on focus', async () => {
    const wrapper = mount(CodexComposerMenuList, {
      attachTo: document.body,
      props: { items },
    });
    const submenuTrigger = wrapper.findAll('button').find((button) => button.text().includes('Approval'))!;
    const submenu = wrapper.get('.codex-composer-menu-list__submenu');
    expect(submenuTrigger.attributes('aria-expanded')).toBe('false');

    await submenuTrigger.trigger('focus');
    expect(submenuTrigger.attributes('aria-expanded')).toBe('false');
    await submenu.trigger('mouseenter');
    expect(submenuTrigger.attributes('aria-expanded')).toBe('true');
    await submenu.trigger('mouseleave');
    expect(submenuTrigger.attributes('aria-expanded')).toBe('false');

    const arrowRight = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' });
    const stopPropagation = vi.spyOn(arrowRight, 'stopPropagation');
    submenuTrigger.element.dispatchEvent(arrowRight);
    await wrapper.vm.$nextTick();
    const child = wrapper.findAll('button').find((button) => button.text().includes('Ask first'))!;
    expect(arrowRight.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(submenuTrigger.attributes('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(child.element);

    await child.trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(submenuTrigger.element);
    expect(submenuTrigger.attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });
});
