// @vitest-environment jsdom

import { nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  createCodexConversationPaneController,
  resolveCodexConversationPaneValue,
  type CodexConversationPaneActions,
  type CodexConversationPaneState,
} from '../../src/vue';
import type { SurfaceMessage } from '../../src/surface';

function message(id: string): SurfaceMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    parts: [{ type: 'text', text: id }],
  };
}

function state(messages: readonly SurfaceMessage[]): CodexConversationPaneState {
  return {
    identity: { conversationKey: 'thread-1', messages },
    composer: { state: { text: '', selectionStart: 0, selectionEnd: 0 } },
  };
}

describe('createCodexConversationPaneController', () => {
  it('accepts ref-like sources from another Vue package resolution', () => {
    const messages = [message('message-1')];
    const externalState: { readonly value: CodexConversationPaneState } = {
      get value() { return state(messages); },
    };
    const controller = createCodexConversationPaneController({
      state: externalState,
      actions: { submit: () => undefined },
    });

    expect(controller.state).toBe(externalState);
    expect(resolveCodexConversationPaneValue(controller.state).identity.messages).toBe(messages);
  });

  it('resolves reactive state and actions without cloning message identities', async () => {
    const messages = [message('message-1')];
    const current = shallowRef(state(messages));
    const submit = vi.fn();
    const actionMap: CodexConversationPaneActions = { submit };
    const controller = createCodexConversationPaneController({
      state: current,
      actions: actionMap,
    });

    expect(resolveCodexConversationPaneValue(controller.state).identity.messages).toBe(messages);
    expect(resolveCodexConversationPaneValue(controller.actions).submit).toBe(submit);

    const nextMessages = [message('message-2')];
    current.value = state(nextMessages);
    await nextTick();

    expect(resolveCodexConversationPaneValue(controller.state).identity.messages).toBe(nextMessages);
    expect(resolveCodexConversationPaneValue(controller.state).identity.messages).not.toBe(messages);
  });
});
