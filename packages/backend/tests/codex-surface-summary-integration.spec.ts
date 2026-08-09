import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import { FakeTransport, lastRequest, thread } from './helpers/codex-surface-fixture';

describe('CodexSurface conversation summaries', () => {
  it('reads child metadata without loading turns or mutating surface state', async () => {
    const transport = new FakeTransport({
      'thread/read': (params) => ({
        thread: {
          ...thread(String((params as { threadId: string }).threadId), false),
          sessionId: 'session-root',
          parentThreadId: 'thread-existing',
          agentNickname: 'Kuhn',
          agentRole: 'researcher',
        },
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));
    const snapshotBefore = surface.getSnapshot();
    const events: CodexSurfaceEvent[] = [];
    const unsubscribe = surface.onEvent((event) => events.push(event));

    const summary = await surface.readConversationSummary('thread-child');
    unsubscribe();

    expect(lastRequest(transport, 'thread/read')).toMatchObject({
      params: { threadId: 'thread-child', includeTurns: false },
    });
    expect(summary).toMatchObject({
      id: 'thread-child',
      sessionId: 'session-root',
      parentConversationId: 'thread-existing',
      agentNickname: 'Kuhn',
      agentRole: 'researcher',
      turnCount: 0,
    });
    expect(surface.getSnapshot()).toStrictEqual(snapshotBefore);
    expect(events).toStrictEqual([]);
    expect(transport.sent.some((message) => (
      'method' in message
      && message.method === 'thread/turns/list'
      && (message.params as { threadId?: string }).threadId === 'thread-child'
    ))).toBe(false);
    expect(transport.sent.some((message) => (
      'method' in message
      && message.method === 'thread/resume'
      && (message.params as { threadId?: string }).threadId === 'thread-child'
    ))).toBe(false);
  });

  it('rejects a summary returned for a different conversation', async () => {
    const transport = new FakeTransport({
      'thread/read': () => ({ thread: thread('thread-other', false) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    await expect(surface.readConversationSummary('thread-child')).rejects.toThrow(
      "Codex thread/read returned 'thread-other' for requested thread 'thread-child'",
    );
  });
});
