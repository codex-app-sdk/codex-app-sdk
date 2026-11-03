// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type {
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CodexSurfaceStatePatch,
  SurfaceMessage,
} from '@codex-app-sdk/core/surface';
import { effectScope } from 'vue';
import { CodexConversationPane, useCodexSurface } from '../src';
function answer(id: string, text: string, status: SurfaceMessage['status'] = 'complete'): SurfaceMessage {
  return { id, role: 'assistant', status, turnId: `turn-${id}`, parts: [{ type: 'text', text }] };
}

describe('streaming render cost', () => {
  it('re-renders only the streaming message when the surface streams patches', async () => {
    const history = Array.from({ length: 12 }, (_, index) => answer(`done-${index}`, `Finished answer ${index}`));
    const base = {
      status: 'ready', activeConversationId: 'thread-1', busy: true, messages: [...history, answer('live', 'Finished **prefix**.\n\nHel', 'streaming')],
      turns: [], approvals: [], clientRequests: [], answeredClientRequestIds: [], queuedPrompts: [], conversations: [],
      models: [], skills: [], plugins: [], approvalPresets: [], permissionProfiles: [],
    } as unknown as CodexSurfaceSnapshot;
    let emit: ((patch: CodexSurfaceStatePatch) => void) | undefined;
    const api = new Proxy({
      getVersionedSnapshot: async () => ({ version: 1, snapshot: base }),
      onStatePatch: (listener: (patch: CodexSurfaceStatePatch) => void) => { emit = listener; return () => undefined; },
      onStateChange: () => () => undefined,
      onEvent: () => () => undefined,
    }, {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : async () => base),
    }) as unknown as CodexSurfaceRendererApi;
    const scope = effectScope();
    const surface = scope.run(() => useCodexSurface(api))!;
    const wrapper = mount(CodexConversationPane, { props: { surface, renderStrategy: 'eager' } as never });
    await flushPromises();
    const finished = wrapper.findAll('.chat-message--assistant p').slice(0, 12).map(node => node.element);
    expect(finished.map(node => node.textContent)).toEqual(history.map((_, index) => `Finished answer ${index}`));

    const prefix = wrapper.findAll('.chat-message--assistant p')[12]!.element;
    emit!({
      version: 2,
      changes: [{
        type: 'list',
        key: 'messages',
        ids: [...history.map((message) => message.id), 'live'],
        items: [answer('live', 'Finished **prefix**.\n\nHello', 'streaming')],
      }],
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Hello');
    expect(wrapper.findAll('.chat-message--assistant p')[12]!.element).toBe(prefix);
    expect(wrapper.findAll('.chat-message--assistant p').slice(0, 12).map(node => node.element)).toEqual(finished);
    wrapper.unmount();
    scope.stop();
  });
});
