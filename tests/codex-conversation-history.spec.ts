import { describe, expect, it } from 'vitest';
import {
  codexItemToSurfaceMessage,
  codexThreadToSurfaceMessages,
  codexTurnToSurfaceMessages,
} from '../src/node/codex-conversation-history';
import type { v2 } from '../src/codex';

describe('codexThreadToSurfaceMessages', () => {
  it('normalizes incomplete history and every persisted user input type', () => {
    expect(codexThreadToSurfaceMessages({ id: 'empty', turns: null } as unknown as v2.Thread)).toStrictEqual([]);
    const messages = codexTurnToSurfaceMessages('thread-inputs', {
      id: 'turn-inputs',
      status: 'failed',
      startedAt: null,
      completedAt: 1_780_000_010,
      items: [
        {
          type: 'userMessage', id: 'user-inputs', clientId: 'client-inputs',
          content: [
            null,
            { type: 'text', text: 'Hello' },
            { type: 'skill', name: 'review' },
            { type: 'mention', name: 'README.md', path: '/tmp/README.md' },
            { type: 'image', url: 'https://example.com/image.png' },
            { type: 'localImage', path: '/tmp/image.png' },
            { type: 'unknown', value: 'ignored' },
          ],
        },
        { type: 'userMessage', id: 'empty-user', clientId: null, content: null },
        { type: 'agentMessage', id: 'empty-agent', text: '' },
        { type: 'exitedReviewMode', id: 'empty-review', review: '' },
        { type: 'unknown', id: 'unknown' },
      ],
    } as unknown as v2.Turn);
    expect(messages).toStrictEqual([expect.objectContaining({
      id: 'client-inputs',
      status: 'complete',
      parts: [
        { type: 'text', text: 'Hello\n$review' },
        {
          type: 'attachment',
          attachment: {
            kind: 'file', name: 'README.md', path: '/tmp/README.md',
          },
        },
        {
          type: 'attachment',
          attachment: {
            kind: 'image', name: 'image.png', url: 'https://example.com/image.png', mimeType: 'image/png',
          },
        },
        {
          type: 'attachment',
          attachment: {
            kind: 'image', name: 'image.png', path: '/tmp/image.png', url: 'file:///tmp/image.png', mimeType: 'image/png',
          },
        },
      ],
    })]);
  });

  it('maps individual history items and all turn statuses', () => {
    const baseTurn = { id: 'turn', startedAt: Number.NaN } as Pick<v2.Turn, 'id' | 'status' | 'startedAt'>;
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'inProgress' }, {
      type: 'agentMessage', id: 'agent', text: 'Streaming', phase: null, memoryCitation: null,
    })).toMatchObject({ status: 'streaming', createdAt: '1970-01-01T00:00:00.000Z' });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'failed' }, {
      type: 'exitedReviewMode', id: 'review', review: 'Failed review',
    })).toMatchObject({ status: 'error', parts: [{ text: 'Failed review' }] });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'userMessage', id: 'user', clientId: null, content: [],
    })).toBeNull();
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'userMessage', id: 'image-only', clientId: null,
      content: [{ type: 'localImage', path: '/tmp/resumed.png' }],
    })).toMatchObject({
      parts: [{
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'resumed.png',
          path: '/tmp/resumed.png',
          url: 'file:///tmp/resumed.png',
          mimeType: 'image/png',
        },
      }],
    });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'webSearch', id: 'search', query: '', action: null,
    })).toMatchObject({
      status: 'complete', parts: [{ type: 'tool', id: 'search', body: 'web search' }],
    });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'enteredReviewMode', id: 'entered', review: 'changes',
    })).toBeNull();
  });
  it('translates resumed Codex turns into renderer messages in item order', () => {
    const thread = {
      id: 'thread-resumed',
      cwd: '/Users/nbonamy/src/project',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          startedAt: 1_780_000_000,
          completedAt: 1_780_000_010,
          items: [
            {
              type: 'userMessage',
              id: 'user-1',
              content: [
                {
                  type: 'text',
                  text: 'read README.md',
                  text_elements: [],
                },
              ],
            },
            {
              type: 'agentMessage',
              id: 'msg-1',
              text: 'I will read it.',
            },
            {
              type: 'commandExecution',
              id: 'cmd-read',
              command: 'sed -n "1,120p" README.md',
              cwd: '/Users/nbonamy/src/project',
              status: 'completed',
              commandActions: [
                {
                  type: 'read',
                  name: 'README.md',
                  cmd: 'sed -n "1,120p" README.md',
                },
              ],
              aggregatedOutput: '# Project',
              exitCode: 0,
              durationMs: 42,
            },
            {
              type: 'agentMessage',
              id: 'msg-2',
              text: 'Read README.md.',
            },
          ],
        },
      ],
    };

    expect(codexThreadToSurfaceMessages(thread as unknown as v2.Thread)).toStrictEqual([
      {
        id: 'user-thread-resumed-turn-1-user-1',
        role: 'user',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-resumed', turnId: 'turn-1' },
        parts: [{ type: 'text', text: 'read README.md' }],
      },
      {
        id: 'assistant-turn-1',
        role: 'assistant',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-resumed', turnId: 'turn-1' },
        parts: [
          { type: 'text', text: 'I will read it.', itemId: 'msg-1' },
          {
            type: 'tool',
            id: 'cmd-read',
            kind: 'command',
            title: 'sed -n "1,120p" README.md',
            status: 'completed',
            statusText: '{"action":"read","phase":"completed","params":{"names":["README.md"],"target":"README.md"},"source":"codex"}',
            input: {
              command: 'sed -n "1,120p" README.md',
              cwd: '/Users/nbonamy/src/project',
              commandActions: [
                {
                  type: 'read',
                  name: 'README.md',
                  cmd: 'sed -n "1,120p" README.md',
                },
              ],
            },
            output: {
              exitCode: 0,
              durationMs: 42,
            },
            metadata: {
              source: undefined,
              processId: undefined,
            },
          },
          { type: 'text', text: 'Read README.md.', itemId: 'msg-2' },
        ],
      },
    ]);
  });

  it('does not replay Codex plan items as normal assistant text', () => {
    const thread = {
      id: 'thread-resumed',
      cwd: '/Users/nbonamy/src/project',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          startedAt: 1_780_000_000,
          completedAt: 1_780_000_010,
          items: [
            {
              type: 'userMessage',
              id: 'user-1',
              content: [
                {
                  type: 'text',
                  text: 'write a dummy false plan this is a test',
                  text_elements: [],
                },
              ],
            },
            {
              type: 'plan',
              id: 'turn-1-plan',
              text: '# Dummy False Plan\n\n- [ ] Do not implement\n',
            },
          ],
        },
      ],
    };

    expect(codexThreadToSurfaceMessages(thread as unknown as v2.Thread)).toStrictEqual([
      {
        id: 'user-thread-resumed-turn-1-user-1',
        role: 'user',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-resumed', turnId: 'turn-1' },
        parts: [{ type: 'text', text: 'write a dummy false plan this is a test' }],
      },
    ]);
  });

  it('preserves mid-turn steering as a visible marker between assistant segments', () => {
    const thread = {
      id: 'thread-steered',
      cwd: '/Users/nbonamy/src/project',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          startedAt: 1_780_000_000,
          completedAt: 1_780_000_010,
          items: [
            {
              type: 'userMessage',
              id: 'user-1',
              content: [
                {
                  type: 'text',
                  text: 'read all markdown files',
                  text_elements: [],
                },
              ],
            },
            {
              type: 'agentMessage',
              id: 'msg-1',
              text: 'I will inventory the Markdown files.',
            },
            {
              type: 'userMessage',
              id: 'steer-1',
              content: [
                {
                  type: 'text',
                  text: 'actually read them too',
                  text_elements: [],
                },
              ],
            },
            {
              type: 'agentMessage',
              id: 'msg-2',
              text: 'Reading them now.',
            },
          ],
        },
      ],
    };

    expect(codexThreadToSurfaceMessages(thread as unknown as v2.Thread)).toStrictEqual([
      {
        id: 'user-thread-steered-turn-1-user-1',
        role: 'user',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-steered', turnId: 'turn-1' },
        parts: [{ type: 'text', text: 'read all markdown files' }],
      },
      {
        id: 'assistant-turn-1',
        role: 'assistant',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-steered', turnId: 'turn-1' },
        parts: [
          { type: 'text', text: 'I will inventory the Markdown files.', itemId: 'msg-1' },
        ],
      },
      {
        id: 'user-thread-steered-turn-1-steer-1',
        kind: 'steer',
        role: 'user',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-steered', turnId: 'turn-1' },
        parts: [{ type: 'text', text: 'actually read them too' }],
      },
      {
        id: 'assistant-turn-1-segment-1',
        role: 'assistant',
        status: 'complete',
        turnId: 'turn-1',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-steered', turnId: 'turn-1' },
        parts: [
          { type: 'text', text: 'Reading them now.', itemId: 'msg-2' },
        ],
      },
    ]);
  });

  it('hydrates completed review output as assistant text instead of hidden tool output', () => {
    const thread = {
      id: 'thread-review',
      cwd: '/Users/nbonamy/src/project',
      turns: [
        {
          id: 'turn-review',
          status: 'completed',
          startedAt: 1_780_000_000,
          completedAt: 1_780_000_010,
          items: [
            {
              type: 'userMessage',
              id: 'user-review',
              content: [
                {
                  type: 'text',
                  text: 'current changes',
                  text_elements: [],
                },
              ],
            },
            {
              type: 'enteredReviewMode',
              id: 'review-1',
              review: 'current changes',
            },
            {
              type: 'exitedReviewMode',
              id: 'review-1',
              review: 'Found one issue.',
            },
          ],
        },
      ],
    };

    expect(codexThreadToSurfaceMessages(thread as unknown as v2.Thread)).toStrictEqual([
      {
        id: 'user-thread-review-turn-review-user-review',
        role: 'user',
        status: 'complete',
        turnId: 'turn-review',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-review', turnId: 'turn-review' },
        parts: [{ type: 'text', text: 'current changes' }],
      },
      {
        id: 'assistant-turn-review',
        role: 'assistant',
        status: 'complete',
        turnId: 'turn-review',
        createdAt: '2026-05-28T20:26:40.000Z',
        metadata: { conversationId: 'thread-review', turnId: 'turn-review' },
        parts: [{ type: 'text', text: 'Found one issue.', itemId: 'review-1' }],
      },
    ]);
  });
});
