import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import {
  FakeTransport,
  generatedPngBase64,
  resumeResponse,
  thread,
  turn,
} from './helpers/codex-surface-fixture';

describe('CodexSurface local Markdown images', () => {
  it('hydrates completed historical assistant images and publishes their renderer-safe update', async () => {
    const markdown = '![Current Music album play bar](/tmp/music-album-playbar.png)';
    const transport = new FakeTransport({
      'thread/resume': (params) => ({
        ...resumeResponse(thread(String((params as { threadId: string }).threadId), false)),
        initialTurnsPage: {
          data: [turn('turn-image', 'completed', [
            {
              type: 'userMessage',
              id: 'user-image-reference',
              clientId: null,
              content: [{ type: 'text', text: '![do not resolve](/tmp/user-image.png)', text_elements: [] }],
            },
            { type: 'agentMessage', id: 'agent-image', text: markdown, phase: null, memoryCitation: null },
          ])],
          nextCursor: null,
          backwardsCursor: null,
        },
      }),
      'fs/readFile': (params) => {
        expect(params).toStrictEqual({ path: '/tmp/music-album-playbar.png' });
        return { dataBase64: generatedPngBase64 };
      },
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));

    await surface.connect();
    await surface.selectConversation('thread-existing');

    const dataUrl = `data:image/png;base64,${generatedPngBase64}`;
    await vi.waitFor(() => expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: `![Current Music album play bar](${dataUrl})` }),
        ]),
      }),
    ])));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message.updated',
        conversationId: 'thread-existing',
        turnId: 'turn-image',
        payload: expect.objectContaining({
          message: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ type: 'text', text: `![Current Music album play bar](${dataUrl})` }),
            ]),
          }),
        }),
      }),
    ]));
    expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        parts: [expect.objectContaining({ type: 'text', text: '![do not resolve](/tmp/user-image.png)' })],
      }),
    ]));

    await surface.close();
  });

  it('hydrates a local Markdown image when a live assistant turn completes', async () => {
    const transport = new FakeTransport({
      'fs/readFile': () => ({ dataBase64: generatedPngBase64 }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    });
    await surface.connect();
    await surface.selectConversation('thread-existing');

    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-live-image', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-existing',
        turnId: 'turn-live-image',
        itemId: 'agent-live-image',
        delta: '![preview](/tmp/live-preview.png)',
      },
    });
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'fs/readFile')).toHaveLength(0);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live-image', 'completed', []) },
    });

    const dataUrl = `data:image/png;base64,${generatedPngBase64}`;
    await vi.waitFor(() => expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        turnId: 'turn-live-image',
        status: 'complete',
        parts: [expect.objectContaining({ type: 'text', text: `![preview](${dataUrl})` })],
      }),
    ])));
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'fs/readFile')).toHaveLength(1);

    await surface.close();
  });
});
