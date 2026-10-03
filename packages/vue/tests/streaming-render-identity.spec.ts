// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type {
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CodexSurfaceStatePatch,
  SurfaceMessage,
} from '@codex-app-sdk/core/surface';
import { CodexConversationPane, useCodexSurface } from '../src';
import { renderMarkdown } from '../src/chat/message-markdown';

vi.mock('../src/chat/message-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/chat/message-markdown')>();
  return { ...actual, renderMarkdown: vi.fn(actual.renderMarkdown) };
});

function answer(id: string, text: string, status: SurfaceMessage['status'] = 'complete'): SurfaceMessage {
  return { id, role: 'assistant', status, turnId: `turn-${id}`, parts: [{ type: 'text', text }] };
}

describe('streaming render cost', () => {
  it('re-renders only the streaming message when the surface streams patches', async () => {
    const history = Array.from({ length: 12 }, (_, index) => answer(`done-${index}`, `Finished answer ${index}`));
    const base = {
      status: 'ready', activeConversationId: 'thread-1', busy: true, messages: [...history, answer('live', 'Hel', 'streaming')],
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
    const surface = useCodexSurface(api);
    mount(CodexConversationPane, { props: { surface, renderStrategy: 'eager' } as never });
    await flushPromises();
    const renders = vi.mocked(renderMarkdown);
    const renderedText = () => renders.mock.calls.map(([content]) => content);
    expect(renderedText()).toContain('Finished answer 0');
    renders.mockClear();

    emit!({
      version: 2,
      changes: [{
        type: 'list',
        key: 'messages',
        ids: [...history.map((message) => message.id), 'live'],
        items: [answer('live', 'Hello', 'streaming')],
      }],
    });
    await flushPromises();

    expect(renderedText()).toContain('Hello');
    expect(renderedText().filter((content) => content.startsWith('Finished answer'))).toStrictEqual([]);
  });
});
