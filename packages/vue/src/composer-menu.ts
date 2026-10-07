import type { Component } from 'vue';

export type CodexComposerMenuItemBase<Payload = unknown> = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: Component;
  payload?: Payload;
  value?: string;
  valueAppearance?: 'plain' | 'badge';
  valueIcon?: Component;
  valueIconLabel?: string;
};

export type CodexComposerMenuActionItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'action' | 'custom';
  closeOnSelect?: boolean;
  danger?: boolean;
  leadingColor?: string;
};

export type CodexComposerMenuCheckboxItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'checkbox';
  accessory?: 'check' | 'switch';
  checked: boolean;
  closeOnSelect?: boolean;
};

export type CodexComposerMenuRadioItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'radio';
  checked: boolean;
  closeOnSelect?: boolean;
};

export type CodexComposerMenuSeparatorItem = {
  id: string;
  type: 'separator';
};

export type CodexComposerMenuHeadingItem<Payload = unknown> = {
  id: string;
  type: 'heading';
  label: string;
  actions?: readonly CodexComposerMenuActionItem<Payload>[];
};

export type CodexComposerMenuSubmenuItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'submenu';
  items: readonly CodexComposerMenuItem<Payload>[];
  /** Optional action for click/Enter; hover and ArrowRight still open the submenu. */
  selectAction?: CodexComposerMenuActionItem<Payload>;
  submenuAlignment?: 'top' | 'bottom';
  submenuWidth?: 'default' | 'wide';
};

export type CodexComposerMenuItem<Payload = unknown> =
  | CodexComposerMenuActionItem<Payload>
  | CodexComposerMenuCheckboxItem<Payload>
  | CodexComposerMenuHeadingItem<Payload>
  | CodexComposerMenuRadioItem<Payload>
  | CodexComposerMenuSeparatorItem
  | CodexComposerMenuSubmenuItem<Payload>;

export type CodexComposerMenuSelectableItem<Payload = unknown> = Exclude<
  CodexComposerMenuItem<Payload>,
  CodexComposerMenuHeadingItem<Payload> | CodexComposerMenuSeparatorItem | CodexComposerMenuSubmenuItem<Payload>
>;
