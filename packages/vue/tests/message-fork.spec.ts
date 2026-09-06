// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  CodexConversationPane,
  CodexMessage,
  createCodexConversationPaneController,
  type CodexConversationPaneState,
  type SurfaceMessage,
} from '../src';

const assistantMessage: SurfaceMessage = {
  id: 'assistant-fork',
  turnId: 'turn-fork',
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'Fork from here.' }],
};

describe('message fork action', () => {
  it('stays opt-in and renders immediately before delete', async () => {
    const wrapper = mount(CodexMessage, {
      props: { canForkTurn: true, index: 3, message: assistantMessage },
    });

    const actionLabels = wrapper.findAll('.chat-message-actions button')
      .map((button) => button.attributes('aria-label'));
    expect(actionLabels).toContain('Fork');
    expect(actionLabels.indexOf('Fork')).toBe(actionLabels.indexOf('Delete') - 1);
    const icon = wrapper.get('[aria-label="Fork"] svg');
    expect(icon.classes()).toContain('tabler-icon-arrow-fork');
    expect(icon.classes()).toContain('chat-message-actions__fork-icon');

    await wrapper.get('[aria-label="Fork"]').trigger('click');
    expect(wrapper.emitted('fork-turn')).toStrictEqual([['turn-fork']]);

    await wrapper.setProps({ canForkTurn: false });
    expect(wrapper.find('[aria-label="Fork"]').exists()).toBe(false);
  });

  it('forwards the granular pane event with the stable turn id', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { canForkTurn: true, messages: [assistantMessage], modelValue: '' },
    });

    await wrapper.get('[aria-label="Fork"]').trigger('click');

    expect(wrapper.emitted('forkTurn')).toStrictEqual([['turn-fork']]);
  });

  it('dispatches through an authoritative controlled pane action', async () => {
    const forkTurn = vi.fn();
    const state: CodexConversationPaneState = {
      identity: { conversationKey: 'thread-fork', messages: [assistantMessage] },
      policy: { canForkTurn: true },
    };
    const controller = createCodexConversationPaneController({
      state,
      actions: { forkTurn },
    });
    const wrapper = mount(CodexConversationPane, { props: { controller } });

    await wrapper.get('[aria-label="Fork"]').trigger('click');

    expect(forkTurn).toHaveBeenCalledWith('turn-fork');
    expect(wrapper.emitted('forkTurn')).toBeUndefined();
  });
});
