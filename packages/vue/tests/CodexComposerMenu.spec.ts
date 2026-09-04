// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { CodexComposerMenu, type CodexComposerMenuItem } from '../src';

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
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: { items, menuClass: 'host-menu' },
    });
    await wrapper.get('.codex-composer-menu__trigger').trigger('click');
    const trigger = wrapper.get('.codex-composer-menu__trigger');
    expect(wrapper.get('[role="menu"]').classes()).toContain('host-menu');

    const customAction = wrapper.findAll('button').find((button) => button.text().includes('Run custom tool'))!;
    await customAction.trigger('click');

    expect(wrapper.emitted('select')?.[0]).toStrictEqual([items[0]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
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

  it('focuses the first item when initially rendered open under host control', async () => {
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: { items, open: true },
    });
    await nextTick();

    expect(document.activeElement).toBe(wrapper.findAll('[role^="menuitem"]')[0]!.element);
    wrapper.unmount();
  });

  it('keeps controlled open requests out of internal state', async () => {
    const wrapper = mount(CodexComposerMenu, {
      props: { items, open: false },
    });

    (wrapper.vm as unknown as { open(): void }).open();
    expect(wrapper.emitted('update:open')).toStrictEqual([[true]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await wrapper.setProps({ open: undefined });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('does not emit or move focus when an already closed menu is closed', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: { items },
    });

    (wrapper.vm as unknown as { close(): void }).close();
    await nextTick();

    expect(wrapper.emitted('update:open')).toBeUndefined();
    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
    outside.remove();
  });

  it('closes an open menu without restoring focus by default', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: { items },
    });
    await wrapper.get('.codex-composer-menu__trigger').trigger('click');
    outside.focus();

    (wrapper.vm as unknown as { close(): void }).close();
    await nextTick();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
    outside.remove();
  });

  it('keeps inside clicks open and closes outside without stealing focus', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: { items },
    });
    await wrapper.get('.codex-composer-menu__trigger').trigger('click');

    await wrapper.get('.codex-composer-menu').trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    outside.focus();
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
    outside.remove();
  });

  it('opens and closes safely without a trigger element or selectable item', async () => {
    const wrapper = mount(CodexComposerMenu, {
      attachTo: document.body,
      props: {
        items: [{ id: 'heading', type: 'heading', label: 'No actions' }],
        open: true,
      },
    });
    await nextTick();

    expect(wrapper.get('[role="menu"]').text()).toContain('No actions');
    (wrapper.vm as unknown as { close(restoreFocus: boolean): void }).close(true);
    await nextTick();
    expect(wrapper.emitted('update:open')).toStrictEqual([[false]]);
    wrapper.unmount();
  });

  it('abandons pending initial focus when unmounted immediately', async () => {
    const wrapper = mount(CodexComposerMenu, {
      props: { items, open: true },
    });

    wrapper.unmount();

    await expect(nextTick()).resolves.toBeUndefined();
  });

  it('removes its document click listener when unmounted', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const wrapper = mount(CodexComposerMenu, { props: { items } });
    const clickListener = addEventListener.mock.calls.find(([event]) => event === 'click')?.[1];

    wrapper.unmount();

    expect(clickListener).toEqual(expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('click', clickListener);
    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });
});
