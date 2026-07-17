import { defineComponent, h, type Component, type PropType, type Slots, type VNode } from 'vue';
import type {
  CodexComposerMenuItem,
  CodexComposerMenuItemBase,
  CodexComposerMenuSelectableItem,
} from '../composer-menu';

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
    const select = (item: CodexComposerMenuSelectableItem<unknown>): void => {
      if (!item.disabled) {
        emit('select', item);
      }
    };

    return (): VNode => renderMenu(props.items, props.ariaLabel, slots, select);
  },
});

function renderMenu(
  items: readonly CodexComposerMenuItem<unknown>[],
  ariaLabel: string,
  slots: Slots,
  select: (item: CodexComposerMenuSelectableItem<unknown>) => void,
  className = 'codex-composer-menu-list',
): VNode {
  return h('div', {
    class: className,
    role: 'menu',
    'aria-label': ariaLabel,
  }, items.map((item) => renderItem(item, slots, select)));
}

function renderItem(
  item: CodexComposerMenuItem<unknown>,
  slots: Slots,
  select: (item: CodexComposerMenuSelectableItem<unknown>) => void,
): VNode {
  if (item.type === 'separator') {
    return h('div', {
      key: item.id,
      class: 'codex-composer-menu-list__separator',
      role: 'separator',
    });
  }

  if (item.type === 'submenu') {
    return h('div', {
      key: item.id,
      class: 'codex-composer-menu-list__submenu',
    }, [
      h('button', {
        class: 'codex-composer-menu-list__item',
        type: 'button',
        role: 'menuitem',
        'aria-haspopup': 'menu',
        'aria-expanded': !item.disabled && item.items.length > 0,
        disabled: item.disabled || item.items.length === 0,
      }, [
        ...renderContent(item, slots),
        h('span', { class: 'codex-composer-menu-list__chevron', 'aria-hidden': 'true' }, '›'),
      ]),
      !item.disabled && item.items.length > 0
        ? renderMenu(
          item.items,
          item.label,
          slots,
          select,
          'codex-composer-menu-list codex-composer-menu-list__submenu-list',
        )
        : null,
    ]);
  }

  return h('button', {
    key: item.id,
    class: [
      'codex-composer-menu-list__item',
      (item.type === 'action' || item.type === 'custom') && item.danger
        ? 'codex-composer-menu-list__item--danger'
        : null,
    ],
    type: 'button',
    role: itemRole(item),
    'aria-checked': itemChecked(item),
    disabled: item.disabled,
    onClick: () => select(item),
  }, [
    ...renderContent(item, slots),
    item.type === 'checkbox' || item.type === 'radio'
      ? h('span', { class: 'codex-composer-menu-list__selection', 'aria-hidden': 'true' }, item.checked ? '✓' : '')
      : null,
  ]);
}

function renderContent(item: CodexComposerMenuItemBase<unknown>, slots: Slots): Array<VNode | null> {
  const customContent = slots.item?.({ item });
  if (customContent?.length) {
    return customContent;
  }

  const customIcon = slots.icon?.({ item });
  const icon = customIcon?.length ? customIcon : (item.icon
    ? [h(item.icon as Component, { class: 'codex-composer-menu-list__icon', 'aria-hidden': 'true' })]
    : [h('span', {
      class: 'codex-composer-menu-list__icon codex-composer-menu-list__icon--empty',
      'aria-hidden': 'true',
    })]);

  return [
    ...icon,
    h('span', { class: 'codex-composer-menu-list__copy' }, [
      h('span', { class: 'codex-composer-menu-list__label' }, item.label),
      item.description
        ? h('span', { class: 'codex-composer-menu-list__description' }, item.description)
        : null,
    ]),
    item.value
      ? h('span', { class: 'codex-composer-menu-list__value' }, item.value)
      : null,
  ];
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
