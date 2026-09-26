import { defineComponent, h, nextTick, reactive, type Component, type PropType, type Slots, type VNode } from 'vue';
import type {
  CodexComposerMenuItem,
  CodexComposerMenuSelectableItem,
  CodexComposerMenuSubmenuItem,
} from '../composer-menu';
import { CheckIcon, ChevronRightIcon } from '../icons/app-icons';

const CodexComposerMenuItems = defineComponent({
  name: 'CodexComposerMenuItems',
  props: {
    ariaLabel: {
      type: String,
      default: 'Composer actions',
    },
    items: {
      type: Array as unknown as PropType<readonly CodexComposerMenuItem<unknown>[]>,
      required: true,
    },
  },
  emits: {
    select: (_item: CodexComposerMenuSelectableItem<unknown>) => true,
  },
  setup(props, { emit, slots }) {
    const openSubmenus = reactive(new Set<string>());
    const select = (item: CodexComposerMenuSelectableItem<unknown>): void => {
      emit('select', item);
    };

    return (): VNode => renderMenu(props.items, props.ariaLabel, slots, select, openSubmenus);
  },
});

function renderMenu(
  items: readonly CodexComposerMenuItem<unknown>[],
  ariaLabel: string,
  slots: Slots,
  select: (item: CodexComposerMenuSelectableItem<unknown>) => void,
  openSubmenus: Set<string>,
  className: string | Array<string | null> = 'codex-chat-theme codex-composer-menu-list',
): VNode {
  const firstFocusableId = items.find((item) => item.type !== 'separator'
    && item.type !== 'heading'
    && !item.disabled
    && (item.type !== 'submenu' || item.items.length > 0))?.id;
  return h('div', {
    class: className,
    role: 'menu',
    'aria-label': ariaLabel,
    onKeydown: (event: KeyboardEvent) => handleMenuKeydown(event, openSubmenus),
  }, items.map((item) => renderItem(item, slots, select, openSubmenus, item.id === firstFocusableId)));
}

function renderItem(
  item: CodexComposerMenuItem<unknown>,
  slots: Slots,
  select: (item: CodexComposerMenuSelectableItem<unknown>) => void,
  openSubmenus: Set<string>,
  firstFocusable: boolean,
): VNode {
  if (item.type === 'separator') {
    return h('div', {
      key: item.id,
      class: 'codex-composer-menu-list__separator',
      role: 'separator',
    });
  }

  if (item.type === 'heading') {
    return h('div', {
      key: item.id,
      class: 'codex-composer-menu-list__heading',
      role: 'presentation',
    }, [
      h('span', { class: 'codex-composer-menu-list__heading-label' }, item.label),
      item.actions?.length
        ? h('span', { class: 'codex-composer-menu-list__heading-actions' }, item.actions.map((action) => (
          h('button', {
            key: action.id,
            class: 'codex-composer-menu-list__heading-action',
            type: 'button',
            role: 'menuitem',
            title: action.label,
            'aria-label': action.label,
            disabled: action.disabled,
            tabindex: -1,
            onClick: () => select(action),
          }, action.icon
            ? [h(action.icon as Component, { 'aria-hidden': 'true' })]
            : action.label)
        )))
        : null,
    ]);
  }

  if (item.type === 'submenu') {
    const enabled = !item.disabled && item.items.length > 0;
    const expanded = enabled && openSubmenus.has(item.id);
    return h('div', {
      key: item.id,
      class: [
        'codex-composer-menu-list__submenu',
        expanded ? 'codex-composer-menu-list__submenu--open' : null,
      ],
      'data-submenu-id': item.id,
      onMouseenter: () => {
        if (enabled) openSubmenus.add(item.id);
      },
      onMouseleave: (event: MouseEvent) => {
        const submenu = (event.currentTarget as HTMLElement).querySelector(
          ':scope > .codex-composer-menu-list__submenu-list',
        );
        if (!(submenu instanceof HTMLElement) || !submenu.contains(document.activeElement)) {
          openSubmenus.delete(item.id);
        }
      },
      onFocusout: (event: FocusEvent) => {
        const container = event.currentTarget as HTMLElement;
        window.setTimeout(() => {
          if (!container.contains(document.activeElement)) openSubmenus.delete(item.id);
        }, 0);
      },
    }, [
      h('button', {
        class: 'codex-composer-menu-list__item codex-composer-menu-list__item--submenu',
        type: 'button',
        role: 'menuitem',
        'aria-haspopup': 'menu',
        'aria-expanded': expanded,
        disabled: !enabled,
        tabindex: firstFocusable ? 0 : -1,
        onClick: () => expanded ? openSubmenus.delete(item.id) : openSubmenus.add(item.id),
        onKeydown: (event: KeyboardEvent) => {
          if (event.key !== 'ArrowRight' || !enabled) return;
          const trigger = event.currentTarget as HTMLElement;
          event.preventDefault();
          event.stopPropagation();
          openSubmenus.add(item.id);
          void nextTick(() => {
            const submenu = trigger.nextElementSibling as HTMLElement | null;
            focusItem(submenu, menuItems(submenu)[0]);
          });
        },
      }, [
        ...renderContent(item, slots).nodes,
        h(ChevronRightIcon, {
          class: 'codex-composer-menu-list__chevron',
          'aria-hidden': 'true',
        }),
      ]),
      enabled
        ? renderMenu(
          item.items,
          item.label,
          slots,
          select,
          openSubmenus,
          [
            'codex-composer-menu-list codex-composer-menu-list__submenu-list',
            item.submenuAlignment === 'bottom'
              ? 'codex-composer-menu-list__submenu-list--bottom-aligned'
              : null,
            item.submenuWidth === 'wide' ? 'codex-composer-menu-list__submenu-list--wide' : null,
          ],
        )
        : null,
    ]);
  }

  const content = renderContent(item, slots);
  return h('button', {
    key: item.id,
    class: [
      'codex-composer-menu-list__item',
      item.type === 'checkbox' && item.accessory === 'switch'
        ? 'codex-composer-menu-list__item--switch'
        : null,
      (item.type === 'action' || item.type === 'custom') && item.danger
        ? 'codex-composer-menu-list__item--danger'
        : null,
    ],
    type: 'button',
    role: itemRole(item),
    'aria-checked': itemChecked(item),
    disabled: item.disabled,
    tabindex: firstFocusable ? 0 : -1,
    onClick: () => select(item),
  }, [
    ...content.nodes,
    item.type === 'checkbox' && item.accessory === 'switch'
      ? h('span', {
        class: [
          'codex-composer-menu-list__switch',
          item.checked ? 'codex-composer-menu-list__switch--checked' : null,
        ],
        'aria-hidden': 'true',
      }, [h('span', { class: 'codex-composer-menu-list__switch-thumb' })])
      : item.type === 'checkbox' || (item.type === 'radio' && item.checked && !content.leadingRadioCheck)
        ? h('span', { class: 'codex-composer-menu-list__selection', 'aria-hidden': 'true' }, item.checked ? '✓' : '')
      : null,
  ]);
}

function handleMenuKeydown(event: KeyboardEvent, openSubmenus: Set<string>): void {
  const menu = event.currentTarget as HTMLElement;
  const items = menuItems(menu);
  const current = event.target as HTMLButtonElement;
  const currentIndex = items.indexOf(current);
  let target: HTMLButtonElement | undefined;
  let submenuToClose: string | undefined;
  switch (event.key) {
    case 'ArrowDown': target = items[(currentIndex + 1 + items.length) % items.length]; break;
    case 'ArrowUp': target = items[(currentIndex - 1 + items.length) % items.length]; break;
    case 'Home': target = items[0]; break;
    case 'End': target = items.at(-1); break;
    case 'ArrowLeft': {
      if (!menu.classList.contains('codex-composer-menu-list__submenu-list')) return;
      const container = menu.parentElement;
      const trigger = container?.querySelector(':scope > button[role="menuitem"]') as HTMLButtonElement | null;
      submenuToClose = container?.dataset.submenuId;
      target = trigger ?? undefined;
      break;
    }
    default: return;
  }
  event.preventDefault();
  event.stopPropagation();
  focusItem(menu, target);
  if (submenuToClose) openSubmenus.delete(submenuToClose);
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  if (!menu) return [];
  const items: HTMLButtonElement[] = [];
  for (const child of menu.children) {
    const candidates = child.matches('button[role^="menuitem"]')
      ? [child]
      : child.querySelectorAll(
        ':scope > button[role^="menuitem"], :scope > .codex-composer-menu-list__heading-actions > button[role^="menuitem"]',
      );
    for (const candidate of candidates) {
      if (candidate instanceof HTMLButtonElement && !candidate.disabled) items.push(candidate);
    }
  }
  return items;
}

function focusItem(menu: HTMLElement | null, target: HTMLButtonElement | undefined): void {
  if (!target) return;
  for (const item of menuItems(menu)) item.tabIndex = item === target ? 0 : -1;
  target.focus();
}

function renderContent(
  item: CodexComposerMenuSelectableItem<unknown> | CodexComposerMenuSubmenuItem<unknown>,
  slots: Slots,
): { nodes: Array<VNode | null>; leadingRadioCheck: boolean } {
  const customContent = slots.item?.({ item });
  if (customContent?.length) {
    return { nodes: customContent, leadingRadioCheck: false };
  }

  const customIcon = slots.icon?.({ item });
  const leadingRadioCheck = item.type === 'radio' && item.checked && !customIcon?.length;
  let icon: VNode[];
  if (customIcon?.length) {
    icon = customIcon;
  } else if (leadingRadioCheck) {
    icon = [h(CheckIcon, {
      class: 'codex-composer-menu-list__icon codex-composer-menu-list__radio-check',
      'aria-hidden': 'true',
    })];
  } else if ('leadingColor' in item && item.leadingColor) {
    icon = [h('span', {
      class: 'codex-composer-menu-list__color-dot',
      style: { backgroundColor: item.leadingColor },
      'aria-hidden': 'true',
    })];
  } else if (item.icon) {
    icon = [h(item.icon as Component, { class: 'codex-composer-menu-list__icon', 'aria-hidden': 'true' })];
  } else {
    icon = [h('span', {
      class: 'codex-composer-menu-list__icon codex-composer-menu-list__icon--empty',
      'aria-hidden': 'true',
    })];
  }

  return {
    nodes: [
      ...icon,
      h('span', { class: 'codex-composer-menu-list__copy' }, [
        h('span', { class: 'codex-composer-menu-list__label' }, item.label),
        item.description
          ? h('span', { class: 'codex-composer-menu-list__description' }, ` • ${item.description}`)
          : null,
      ]),
      item.value || item.valueIcon
        ? h('span', { class: 'codex-composer-menu-list__value' }, [
          item.value
            ? h('span', {
              class: item.valueAppearance === 'badge'
                ? 'codex-composer-menu-list__value-badge'
                : undefined,
            }, item.value)
            : null,
          item.valueIcon
            ? h(item.valueIcon as Component, {
              class: 'codex-composer-menu-list__value-icon',
              title: item.valueIconLabel,
              'aria-label': item.valueIconLabel,
              'aria-hidden': item.valueIconLabel ? undefined : 'true',
            })
            : null,
        ])
        : null,
    ],
    leadingRadioCheck,
  };
}

function itemRole(item: CodexComposerMenuSelectableItem<unknown>): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  if (item.type === 'checkbox') {
    return 'menuitemcheckbox';
  }
  if (item.type === 'radio') {
    return 'menuitemradio';
  }
  return 'menuitem';
}

function itemChecked(item: CodexComposerMenuSelectableItem<unknown>): boolean | undefined {
  return item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined;
}

export default CodexComposerMenuItems;
