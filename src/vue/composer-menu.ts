export type CodexComposerMenuItemBase<Payload = unknown> = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: unknown;
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

export type CodexComposerMenuHeadingItem = {
  id: string;
  type: 'heading';
  label: string;
};

export type CodexComposerMenuSubmenuItem<Payload = unknown> = CodexComposerMenuItemBase<Payload> & {
  type: 'submenu';
  items: readonly CodexComposerMenuItem<Payload>[];
};

export type CodexComposerMenuItem<Payload = unknown> =
  | CodexComposerMenuActionItem<Payload>
  | CodexComposerMenuCheckboxItem<Payload>
  | CodexComposerMenuHeadingItem
  | CodexComposerMenuRadioItem<Payload>
  | CodexComposerMenuSeparatorItem
  | CodexComposerMenuSubmenuItem<Payload>;

export type CodexComposerMenuSelectableItem<Payload = unknown> = Exclude<
  CodexComposerMenuItem<Payload>,
  CodexComposerMenuHeadingItem | CodexComposerMenuSeparatorItem | CodexComposerMenuSubmenuItem<Payload>
>;
