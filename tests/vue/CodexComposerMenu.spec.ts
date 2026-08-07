// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';
import { CodexComposerMenu, type CodexComposerMenuItem } from '../../packages/vue/src';

describe('CodexComposerMenu', () => {
  const items: CodexComposerMenuItem<{ source: string }>[] = [
    {
      id: 'custom-tool',
      type: 'custom',
      label: 'Run custom tool',
      payload: { source: 'plugin' },
    },
    {
      id: 'plan-mode',
      type: 'checkbox',
      label: 'Plan mode',
      checked: false,
      payload: { source: 'built-in' },
    },
  ];

  it('opens from the default trigger, applies host classes, selects, and closes', async () => {
    const wrapper = mount(CodexComposerMenu, { props: { items, menuClass: 'host-menu' } });
    await wrapper.get('.codex-composer-menu__trigger').trigger('click');
    expect(wrapper.get('[role="menu"]').classes()).toContain('host-menu');

    const customAction = wrapper.findAll('button').find((button) => button.text().includes('Run custom tool'))!;
    await customAction.trigger('click');

    expect(wrapper.emitted('select')?.[0]).toStrictEqual([items[0]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('keeps checkbox menus open and supports a scoped trigger', async () => {
    const wrapper = mount(CodexComposerMenu, {
      props: { items },
      slots: {
        trigger: ({ toggle }: { toggle: (event?: Event) => void }) => (
          h('button', { class: 'custom-trigger', onClick: toggle }, 'More')
        ),
      },
    });
    await wrapper.get('.custom-trigger').trigger('click');
    const planMode = wrapper.findAll('button').find((button) => button.text().includes('Plan mode'))!;
    await planMode.trigger('click');

    expect(wrapper.emitted('select')?.[0]).toStrictEqual([items[1]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    await wrapper.get('.codex-composer-menu').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('supports controlled visibility, disabled state, and explicit close behavior', async () => {
    const controlledItems: CodexComposerMenuItem[] = [
      { id: 'keep-open', type: 'action', label: 'Keep open', closeOnSelect: false },
    ];
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: { disabled: true, items: controlledItems, open: true },
    });

    expect(wrapper.get('.codex-composer-menu__trigger').attributes('disabled')).toBeDefined();
    await wrapper.findAll('button').find((button) => button.text().includes('Keep open'))!.trigger('click');
    expect(wrapper.emitted('select')?.[0]).toStrictEqual([controlledItems[0]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    (wrapper.vm as unknown as { close(): void }).close();
    expect(wrapper.emitted('update:open')).toContainEqual([false]);
    await wrapper.setProps({ open: false });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('moves focus with menu keys and restores the trigger on Escape', async () => {
    const wrapper = mount(CodexComposerMenu, { attachTo: document.body, props: { items } });
    const trigger = wrapper.get('.codex-composer-menu__trigger');
    await trigger.trigger('click');

    const menuItems = wrapper.findAll('[role^="menuitem"]');
    expect(document.activeElement).toBe(menuItems[0]!.element);
    await menuItems[0]!.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[1]!.element);
    await menuItems[1]!.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(menuItems[0]!.element);
    await menuItems[0]!.trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(menuItems[1]!.element);
    await menuItems[1]!.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(menuItems[1]!.element);

    await menuItems[0]!.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it('does not open when the exposed toggle is called while disabled', () => {
    const wrapper = mount(CodexComposerMenu, { props: { disabled: true, items } });
    (wrapper.vm as unknown as { toggle(): void }).toggle();
    expect(wrapper.emitted('update:open')).toBeUndefined();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });
});
