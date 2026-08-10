// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  CodexConversationPane,
  createCodexConversationPaneController,
} from '../src';

describe('CodexConversationPane composer menu', () => {
  it('routes controller leading items between Approval and Plan mode', async () => {
    const menuSelect = vi.fn();
    const permissions = { id: 'permissions', type: 'custom' as const, label: 'Permissions' };
    const controller = createCodexConversationPaneController({
      state: {
        identity: { messages: [] },
        composer: {
          approvalPreset: 'ask-for-approval',
          leadingMenuItems: [permissions],
          menuItems: [{ id: 'custom', type: 'custom', label: 'Custom' }],
        },
      },
      actions: { menuSelect },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');

    const menu = wrapper.get('.chat-composer-action-menu').element;
    const labels = Array.from(menu.children).flatMap((child) => {
      const button = child instanceof HTMLButtonElement
        ? child
        : child.querySelector(':scope > button');
      const label = button?.querySelector('.codex-composer-menu-list__label')?.textContent?.trim();
      return label ? [label] : [];
    });
    expect(labels).toStrictEqual(['Approval', 'Permissions', 'Plan mode', 'Custom', 'Add Files & Photos']);

    await wrapper.findAll('button').find((button) => button.text().includes('Permissions'))!.trigger('click');
    expect(menuSelect).toHaveBeenCalledWith(permissions);
  });
});
