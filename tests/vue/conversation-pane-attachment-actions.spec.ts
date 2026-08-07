// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';
import {
  CodexConversationPane,
  type CodexNativeAttachment,
} from '../../packages/vue/src';

describe('CodexConversationPane composer attachment actions', () => {
  it('renders the scoped slot once per attachment immediately before remove', () => {
    const attachments: CodexNativeAttachment[] = [
      {
        id: 'first',
        type: 'file',
        path: '/tmp/first.md',
        name: 'first.md',
        mimeType: 'text/markdown',
        size: 1,
      },
      {
        id: 'second',
        type: 'image',
        path: '/tmp/second.png',
        name: 'second.png',
        mimeType: 'image/png',
        size: 2,
      },
    ];
    const receivedScopes: object[] = [];
    const wrapper = mount(CodexConversationPane, {
      props: {
        attachments,
        disabled: true,
        messages: [],
        modelValue: '',
      },
      slots: {
        'composer-attachment-actions': (scope: {
          attachments: readonly CodexNativeAttachment[];
          disabled: boolean;
          index: number;
        }) => {
          receivedScopes.push(scope);
          return [
            h('button', {
              class: 'host-attachment-action',
              'data-name': scope.attachments[scope.index]?.name,
              disabled: scope.disabled,
            }, 'Host action'),
            h('button', {
              class: 'host-secondary-attachment-action',
              disabled: scope.disabled,
            }, 'Secondary action'),
          ];
        },
      },
    });

    const rows = wrapper.findAll('.codex-conversation-pane__attachment');
    expect(rows).toHaveLength(2);
    const attachmentsRow = wrapper.get('.codex-conversation-pane__attachments');
    const composer = wrapper.get('.chat-composer');
    expect(attachmentsRow.element.parentElement).toBe(composer.element);
    expect(attachmentsRow.element.nextElementSibling)
      .toBe(composer.get('.chat-composer__input-row').element);
    expect(wrapper.findAll('.host-attachment-action').map((action) => action.attributes('data-name')))
      .toStrictEqual(['first.md', 'second.png']);
    expect(receivedScopes).toHaveLength(2);
    expect(Object.keys(receivedScopes[0]!).sort()).toStrictEqual(['attachments', 'disabled', 'index']);

    for (const row of rows) {
      const actions = row.get('.codex-conversation-pane__attachment-actions');
      const action = actions.get('.host-attachment-action');
      const secondaryAction = actions.get('.host-secondary-attachment-action');
      expect(action.attributes('disabled')).toBeDefined();
      expect(action.element.nextElementSibling).toBe(secondaryAction.element);
      expect(secondaryAction.element.nextElementSibling)
        .toBe(actions.get('.codex-conversation-pane__attachment-remove').element);
      expect(actions.get('.codex-conversation-pane__attachment-remove').attributes('title')).toBeUndefined();
      expect(actions.findAll('button')).toHaveLength(3);
      expect(row.element.children).toHaveLength(3);
    }
  });
});
