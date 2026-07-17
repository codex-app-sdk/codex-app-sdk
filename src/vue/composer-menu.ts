import type { Component } from 'vue';

export type CodexComposerMenuItemBase<Payload = unknown> = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: Component;
  payload?: Payload;
  value?: string;
};

export type CodexComposerMenuActionItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'action' | 'custom';
  closeOnSelect?: boolean;
  danger?: boolean;
};

export type CodexComposerMenuCheckboxItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'checkbox';
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

export type CodexComposerMenuSubmenuItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'submenu';
  items: readonly CodexComposerMenuItem<Payload>[];
};

export type CodexComposerMenuItem<Payload = unknown> =
  | CodexComposerMenuActionItem<Payload>
  | CodexComposerMenuCheckboxItem<Payload>
  | CodexComposerMenuRadioItem<Payload>
  | CodexComposerMenuSeparatorItem
  | CodexComposerMenuSubmenuItem<Payload>;

export type CodexComposerMenuSelectableItem<Payload = unknown> = Exclude<
  CodexComposerMenuItem<Payload>,
  CodexComposerMenuSeparatorItem | CodexComposerMenuSubmenuItem<Payload>
>;
