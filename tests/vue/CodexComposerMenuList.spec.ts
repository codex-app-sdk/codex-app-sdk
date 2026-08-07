// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';
import { CodexComposerMenuList, type CodexComposerMenuItem } from '../../packages/vue/src';

describe('CodexComposerMenuList', () => {
  const items: CodexComposerMenuItem<{ source: string }>[] = [
    { id: 'heading', type: 'heading', label: 'Actions' },
    { id: 'separator', type: 'separator' },
    {
      id: 'custom-tool',
      type: 'custom',
      label: 'Run custom tool',
      description: 'Provided by the host application',
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
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Provided by the host application');
    expect(wrapper.text()).toContain('Ask first');
    expect(wrapper.get('.codex-composer-menu-list__switch').classes())
      .toContain('codex-composer-menu-list__switch--checked');

    const customAction = wrapper.findAll('button').find((button) => button.text().includes('Run custom tool'))!;
    await customAction.trigger('click');

    expect(wrapper.emitted('select')?.[0]).toStrictEqual([items[2]]);
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
      slots: { icon: () => h('span', { class: 'host-icon' }, '!') },
    });
    expect(iconWrapper.find('.host-icon').exists()).toBe(true);
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

    await submenuTrigger.trigger('keydown', { key: 'ArrowRight' });
    const child = wrapper.findAll('button').find((button) => button.text().includes('Ask first'))!;
    expect(document.activeElement).toBe(child.element);

    await child.trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(submenuTrigger.element);
    expect(submenuTrigger.attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });
});
