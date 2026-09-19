// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ChatMessageActions from '../../src/chat/ChatMessageActions.vue';
import { formatMessageSentAt, fullMessageSentAt } from '../../src/chat/message-time';
import type { CodexMessageActionsPresentation } from '../../src/chat/contracts';
import type { Message } from '../../src/chat/types';

function mountActions(
  message: Message,
  options: {
    deleting?: boolean;
    canFork?: boolean;
    copyAction?: () => Promise<void> | void;
    mutationDisabled?: boolean;
    presentation?: CodexMessageActionsPresentation;
  } = {},
) {
  return mount(ChatMessageActions, {
    props: {
      canFork: options.canFork,
      copyAction: options.copyAction,
      deleting: options.deleting,
      message,
      mutationDisabled: options.mutationDisabled,
      presentation: options.presentation,
    },
  });
}

function actionLabels(wrapper: ReturnType<typeof mountActions>) {
  return wrapper.findAll('button').map((button) => button.attributes('aria-label'));
}

describe('ChatMessageActions', () => {
  it('renders the complete role-specific default action sets', () => {
    const user = mountActions({ role: 'user', content: 'Question' }, { canFork: true });
    const assistant = mountActions({ role: 'assistant', content: 'Answer' }, { canFork: true });

    expect(actionLabels(user)).toStrictEqual(['Copy', 'Edit', 'Quote', 'Fork', 'Delete']);
    expect(actionLabels(assistant)).toStrictEqual(['Copy', 'Retry', 'Fork', 'Delete']);
    expect(user.find('.chat-message-actions__sent-at').exists()).toBe(false);
    expect(assistant.find('.chat-message-actions__sent-at').exists()).toBe(false);
  });

  it('independently suppresses every presentation-controlled action', () => {
    const hiddenPresentation = {
      copy: false,
      delete: false,
      edit: false,
      fork: false,
      quote: false,
      retry: false,
    } satisfies CodexMessageActionsPresentation;
    const user = mountActions(
      { role: 'user', content: 'Question' },
      { canFork: true, presentation: hiddenPresentation },
    );
    const assistant = mountActions(
      { role: 'assistant', content: 'Answer' },
      { canFork: true, presentation: hiddenPresentation },
    );

    expect(actionLabels(user)).toStrictEqual([]);
    expect(actionLabels(assistant)).toStrictEqual([]);
  });

  it('forwards mutation disabling and emits every visible action exactly', async () => {
    const copyAction = vi.fn(async () => undefined);
    const assistant = mountActions(
      { role: 'assistant', content: 'Answer' },
      { canFork: true, copyAction, mutationDisabled: true },
    );

    expect(actionLabels(assistant)).toStrictEqual(['Copy', 'Retry', 'Fork', 'Delete']);
    expect(assistant.get('button[aria-label="Copy"]').attributes('disabled')).toBeUndefined();
    for (const label of ['Retry', 'Fork', 'Delete']) {
      expect(assistant.get(`button[aria-label="${label}"]`).attributes('disabled')).toBeDefined();
    }

    await assistant.get('button[aria-label="Copy"]').trigger('click');
    await flushPromises();
    expect(copyAction).toHaveBeenCalledOnce();
    expect(assistant.find('button[aria-label="Copied"] .tabler-icon-check').exists()).toBe(true);
    expect(assistant.emitted('copy')).toStrictEqual([[]]);

    const user = mountActions({ role: 'user', content: 'Question' }, { canFork: true });
    for (const [label, event] of [
      ['Edit', 'edit'],
      ['Quote', 'quote'],
      ['Fork', 'fork'],
      ['Delete', 'delete'],
    ] as const) {
      await user.get(`button[aria-label="${label}"]`).trigger('click');
      expect(user.emitted(event)).toStrictEqual([[]]);
    }
  });

  it('shows deletion progress and disables every action while deletion is pending', async () => {
    const user = mountActions(
      { role: 'user', content: 'Question' },
      { canFork: true, deleting: true },
    );

    expect(actionLabels(user)).toStrictEqual(['Copy', 'Edit', 'Quote', 'Fork', 'Deleting']);
    expect(user.get('.chat-message-actions').attributes('aria-busy')).toBe('true');
    for (const button of user.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined();
    }
    expect(user.find('button[aria-label="Deleting"] .chat-message-actions__spinner').exists()).toBe(true);

    await user.get('button[aria-label="Deleting"]').trigger('click');
    expect(user.emitted('delete')).toBeUndefined();
  });

  it('places an exact accessible timestamp on the role-appropriate edge', () => {
    const createdAt = '2024-02-29T22:45:00.000Z';
    const label = formatMessageSentAt(createdAt);
    const title = fullMessageSentAt(createdAt);
    const user = mountActions({ role: 'user', content: 'Question', createdAt });
    const assistant = mountActions({ role: 'assistant', content: 'Answer', createdAt });

    const userTimestamp = user.get('.chat-message-actions__sent-at');
    expect(userTimestamp.text()).toBe(label);
    expect(userTimestamp.attributes('title')).toBe(title);
    expect(userTimestamp.element.previousElementSibling).toBeNull();

    const assistantTimestamp = assistant.get('.chat-message-actions__sent-at');
    expect(assistantTimestamp.text()).toBe(label);
    expect(assistantTimestamp.attributes('title')).toBe(title);
    expect(assistantTimestamp.element.nextElementSibling).toBeNull();
  });
});
