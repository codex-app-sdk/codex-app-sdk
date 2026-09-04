import { describe, expect, it } from 'vitest';
import {
  codexImageDataUrl,
  codexItemToMediaPart,
  codexItemToSurfaceMessage,
  codexThreadToSurfaceMessages,
  codexTurnToSurfaceMessages,
  preserveHistoricalAttachmentPreviews,
} from '../src/node/codex-conversation-history';
import type { v2 } from '../src/codex';
import type { SurfaceMessage } from '@codex-app-sdk/core/surface';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
            kind: 'image', name: 'image.png', path: '/tmp/image.png', mimeType: 'image/png',
          },
        },
      ],
    })]);
  });

  it('maps individual history items and all turn statuses', () => {
    const baseTurn = { id: 'turn', startedAt: Number.NaN } as Pick<v2.Turn, 'id' | 'status' | 'startedAt'>;
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'inProgress' }, {
      type: 'agentMessage', id: 'agent', text: 'Streaming', phase: 'commentary', memoryCitation: null, delivery: null,
    })).toMatchObject({
      status: 'streaming',
      createdAt: '1970-01-01T00:00:00.000Z',
      parts: [{ type: 'text', text: 'Streaming', phase: 'commentary' }],
    });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'failed' }, {
      type: 'exitedReviewMode', id: 'review', review: 'Failed review',
    })).toMatchObject({ status: 'error', parts: [{ text: 'Failed review' }] });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'reasoning', id: 'reasoning', summary: ['Checked the event flow'], content: ['raw chain of thought'],
    })).toMatchObject({
      status: 'complete',
      parts: [{
        type: 'reasoning',
        summary: 'Checked the event flow',
        itemId: 'reasoning',
        summaryIndex: 0,
      }],
    });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'interrupted' }, {
      type: 'agentMessage', id: 'interrupted', text: 'Partial response', phase: null, memoryCitation: null, delivery: null,
    })).toMatchObject({ status: 'complete', parts: [{ text: 'Partial response' }] });
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
          mimeType: 'image/png',
        },
      }],
    });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'webSearch', id: 'search', query: '', action: null, results: null,
    })).toMatchObject({
      status: 'complete', parts: [{ type: 'tool', id: 'search', body: 'web search' }],
    });
    expect(codexItemToSurfaceMessage('thread', { ...baseTurn, status: 'completed' }, {
      type: 'enteredReviewMode', id: 'entered', review: 'changes',
    })).toBeNull();
  });

  it('projects every non-empty reasoning summary with stable source indices', () => {
    const turn = {
      id: 'turn-reasoning', status: 'completed', startedAt: 2, completedAt: 3,
    } as Pick<v2.Turn, 'id' | 'status' | 'startedAt' | 'completedAt'>;
    expect(codexItemToSurfaceMessage('thread-reasoning', turn, {
      type: 'reasoning',
      id: 'reasoning-item',
      summary: ['  Inspecting  ', '', '   ', 'Testing'],
      content: ['private chain of thought'],
    })).toStrictEqual({
      id: 'assistant-reasoning-item',
      role: 'assistant',
      status: 'complete',
      turnId: 'turn-reasoning',
      parts: [
        { type: 'reasoning', summary: 'Inspecting', itemId: 'reasoning-item', summaryIndex: 0 },
        { type: 'reasoning', summary: 'Testing', itemId: 'reasoning-item', summaryIndex: 3 },
      ],
      createdAt: '1970-01-01T00:00:02.000Z',
      metadata: {
        conversationId: 'thread-reasoning', turnId: 'turn-reasoning', itemId: 'reasoning-item',
      },
    });
    expect(codexItemToSurfaceMessage('thread-reasoning', turn, {
      type: 'reasoning', id: 'empty-reasoning', summary: ['', '   '], content: ['private'],
    })).toBeNull();
  });

  it('preserves ordered reasoning summaries inside complete turn history', () => {
    const messages = codexTurnToSurfaceMessages('thread-reasoning', {
      id: 'turn-reasoning',
      status: 'completed',
      startedAt: 2,
      completedAt: 3,
      items: [
        { type: 'reasoning', id: 'empty', summary: ['   '], content: ['hidden'] },
        {
          type: 'reasoning', id: 'reasoning-1',
          summary: ['  Inspecting the renderer ', '', 'Checking events'],
          content: ['hidden'],
        },
        {
          type: 'reasoning', id: 'reasoning-2', summary: ['Finishing'], content: ['also hidden'],
        },
      ],
    } as unknown as v2.Turn);

    expect(messages).toStrictEqual([{
      id: 'assistant-turn-reasoning',
      role: 'assistant',
      status: 'complete',
      turnId: 'turn-reasoning',
      parts: [
        {
          type: 'reasoning', summary: 'Inspecting the renderer', itemId: 'reasoning-1', summaryIndex: 0,
        },
        { type: 'reasoning', summary: 'Checking events', itemId: 'reasoning-1', summaryIndex: 2 },
        { type: 'reasoning', summary: 'Finishing', itemId: 'reasoning-2', summaryIndex: 0 },
      ],
      createdAt: '1970-01-01T00:00:02.000Z',
      metadata: { conversationId: 'thread-reasoning', turnId: 'turn-reasoning' },
    }]);
    expect(JSON.stringify(messages)).not.toContain('hidden');
  });

  it('uses visible reasoning—not empty reasoning—to classify later user input as steering', () => {
    const base = {
      status: 'completed', startedAt: 2, completedAt: 3,
    } as const;
    const userMessage = {
      type: 'userMessage', id: 'user-after-reasoning', clientId: null,
      content: [{ type: 'text', text: 'Continue', text_elements: [] }],
    } as const;
    const empty = codexTurnToSurfaceMessages('thread-reasoning', {
      ...base,
      id: 'turn-empty-reasoning',
      items: [
        { type: 'reasoning', id: 'reasoning-empty', summary: ['   '], content: ['hidden'] },
        userMessage,
      ],
    } as unknown as v2.Turn);
    const visible = codexTurnToSurfaceMessages('thread-reasoning', {
      ...base,
      id: 'turn-visible-reasoning',
      items: [
        { type: 'reasoning', id: 'reasoning-visible', summary: ['Visible'], content: ['hidden'] },
        userMessage,
      ],
    } as unknown as v2.Turn);

    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ role: 'user' });
    expect(empty[0]).not.toHaveProperty('kind');
    expect(visible.map(({ role, kind }) => ({ role, kind }))).toStrictEqual([
      { role: 'assistant', kind: undefined },
      { role: 'user', kind: 'steer' },
    ]);
  });

  it('settles stale running tool items in terminal history messages', () => {
    const runningCommand = {
      type: 'commandExecution',
      id: 'command-interrupted',
      command: 'npm test',
      cwd: '/tmp/project',
      status: 'inProgress',
      commandActions: [{ type: 'run', command: 'npm test' }],
      aggregatedOutput: '',
      exitCode: null,
      durationMs: null,
    } as unknown as v2.ThreadItem;

    expect(codexItemToSurfaceMessage('thread', {
      id: 'turn-interrupted', status: 'interrupted', startedAt: 1,
    }, runningCommand)).toMatchObject({
      status: 'complete',
      parts: [{ type: 'tool', status: 'failed' }],
    });

    const [message] = codexTurnToSurfaceMessages('thread', {
      id: 'turn-interrupted',
      status: 'interrupted',
      startedAt: 1,
      completedAt: 2,
      items: [runningCommand],
    } as unknown as v2.Turn);
    expect(message).toMatchObject({
      status: 'complete',
      parts: [{ type: 'tool', status: 'failed' }],
    });
  });

  it('preserves bounded data previews while rematerializing local image history', () => {
    const turn = {
      id: 'turn', status: 'completed', startedAt: 1, completedAt: 2,
      items: [{
        type: 'userMessage', id: 'user', clientId: 'client-user',
        content: [{ type: 'localImage', path: '/tmp/resumed.png' }],
      }],
    } as unknown as v2.Turn;
    const previous = codexTurnToSurfaceMessages('thread', turn).map((message) => ({
      ...message,
      parts: message.parts.map((part) => part.type === 'attachment'
        ? { ...part, attachment: { ...part.attachment, url: 'data:image/png;base64,cG5n' } }
        : part),
    }));
    const history = codexTurnToSurfaceMessages('thread', turn);

    expect(preserveHistoricalAttachmentPreviews(previous, history)[0]?.parts).toContainEqual({
      type: 'attachment',
      attachment: {
        kind: 'image',
        name: 'resumed.png',
        path: '/tmp/resumed.png',
        mimeType: 'image/png',
        url: 'data:image/png;base64,cG5n',
      },
    });
  });

  it('projects completed generated images as first-class media for restored history', () => {
    const completed = {
      type: 'imageGeneration',
      id: 'generated-image',
      status: 'completed',
      revisedPrompt: 'A friendly logistics map',
      result: pngBase64,
      savedPath: '/tmp/generated image.png',
    } as unknown as v2.ThreadItem;

    expect(codexItemToMediaPart(completed)).toStrictEqual({
      type: 'media',
      itemId: 'generated-image',
      media: {
        url: `data:image/png;base64,${pngBase64}`,
        alt: 'Generated image',
        title: 'Generated image',
        mimeType: 'image/png',
        prompt: 'A friendly logistics map',
      },
    });
    expect(codexItemToSurfaceMessage('thread', {
      id: 'turn', status: 'completed', startedAt: 1,
    }, completed)).toMatchObject({
      parts: [
        { type: 'tool', id: 'generated-image', status: 'completed' },
        {
          type: 'media', itemId: 'generated-image',
          media: { url: `data:image/png;base64,${pngBase64}`, prompt: 'A friendly logistics map' },
        },
      ],
    });
    expect(codexTurnToSurfaceMessages('thread', {
      id: 'turn', status: 'completed', startedAt: 1, completedAt: 2,
      items: [
        completed,
        { type: 'agentMessage', id: 'agent-after-image', text: 'Here it is.' },
      ],
    } as unknown as v2.Turn)[0]?.parts.map((part) => part.type)).toStrictEqual([
      'tool', 'media', 'text',
    ]);

    expect(codexItemToMediaPart({
      ...completed, savedPath: undefined, revisedPrompt: null,
    } as unknown as v2.ThreadItem)).toMatchObject({
      media: { url: `data:image/png;base64,${pngBase64}`, mimeType: 'image/png' },
    });
    expect(codexItemToMediaPart({
      ...completed, status: 'inProgress', savedPath: undefined,
    } as unknown as v2.ThreadItem)).toBeNull();
    expect(codexItemToMediaPart({
      ...completed, status: 'failed', savedPath: undefined,
    } as unknown as v2.ThreadItem)).toBeNull();
    expect(codexItemToMediaPart({
      ...completed, result: 'not base64', savedPath: undefined,
    } as unknown as v2.ThreadItem)).toBeNull();
    expect(codexItemToMediaPart({
      ...completed, result: 'aW1hZ2U=', savedPath: undefined,
    } as unknown as v2.ThreadItem)).toBeNull();
    expect(codexItemToMediaPart({
      ...completed, result: '',
    } as unknown as v2.ThreadItem)).toMatchObject({
      media: { url: 'file:///tmp/generated%20image.png', mimeType: 'image/png' },
    });
    expect(codexItemToMediaPart({
      ...completed, savedPath: '/tmp/generated.svg',
    } as unknown as v2.ThreadItem)).toMatchObject({
      media: { url: `data:image/png;base64,${pngBase64}` },
    });
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

  it('materializes the canonical review-mode items returned by app-server history', () => {
    const text = 'The review found one issue.';
    const messages = codexTurnToSurfaceMessages('thread-review', {
      id: 'turn-review',
      status: 'completed',
      startedAt: 1_780_000_000,
      completedAt: 1_780_000_010,
      items: [
        { type: 'enteredReviewMode', id: 'review-start', review: 'current changes' },
        { type: 'exitedReviewMode', id: 'review-1', review: text },
      ],
    } as unknown as v2.Turn);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toStrictEqual([
      { type: 'text', text, itemId: 'review-1' },
    ]);
  });

  it('collapses duplicated initial user items materialized by an app-server review turn', () => {
    const prompt = 'Review the current code changes and provide prioritized findings.';
    const messages = codexTurnToSurfaceMessages('thread-review', {
      id: 'turn-review-worker',
      status: 'completed',
      startedAt: 1_780_000_000,
      completedAt: 1_780_000_010,
      items: [
        { type: 'userMessage', id: 'user-1', clientId: null, content: [{ type: 'text', text: prompt }] },
        { type: 'userMessage', id: 'user-2', clientId: null, content: [{ type: 'text', text: prompt }] },
        { type: 'agentMessage', id: 'result', text: 'No findings.', phase: null },
      ],
    } as unknown as v2.Turn);

    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(messages[0]?.parts).toStrictEqual([{ type: 'text', text: prompt }]);
  });

  it('preserves only renderer-safe image previews for the exact matching path', () => {
    const safe = 'data:image/png;base64,cG5n';
    const previous: SurfaceMessage[] = [{
      id: 'previous', role: 'user', status: 'complete', parts: [
        { type: 'text', text: 'ignore' },
        { type: 'attachment', attachment: { kind: 'file', name: 'file', path: '/file-kind.png', url: safe } },
        { type: 'attachment', attachment: { kind: 'image', name: 'pathless', url: safe } },
        { type: 'attachment', attachment: { kind: 'image', name: 'remote', path: '/remote.png', url: 'https://example.com/a.png' } },
        { type: 'attachment', attachment: { kind: 'image', name: 'unsafe', path: '/unsafe.svg', url: 'data:image/svg+xml;base64,PHN2Zz4=' } },
        { type: 'attachment', attachment: { kind: 'image', name: 'safe', path: '/same.png', url: safe } },
      ],
    }];
    const fileKind = {
      ...historyImage('file-kind', '/file-kind.png', 'file:///file-kind.png'),
      parts: [{
        type: 'attachment' as const,
        attachment: { kind: 'file' as const, name: 'file-kind', path: '/file-kind.png' },
      }],
    };
    const samePreview = historyImage('same-preview', '/same.png', safe);
    const unchanged = historyImage('unchanged', '/other.png', safe);
    const target = historyImage('target', '/same.png', 'file:///same.png');
    const result = preserveHistoricalAttachmentPreviews(previous, [fileKind, samePreview, unchanged, target]);

    expect(result[0]).toBe(fileKind);
    expect(result[1]).toBe(samePreview);
    expect(result[2]).toBe(unchanged);
    expect(result[3]).not.toBe(target);
    expect(result[3]?.parts).toStrictEqual([{
      type: 'attachment',
      attachment: { kind: 'image', name: 'target', path: '/same.png', url: safe },
    }]);
    expect(target.parts[0]).toMatchObject({ attachment: { url: 'file:///same.png' } });
  });

  it('returns a detached unchanged history when no usable preview exists', () => {
    const history = [historyImage('history', '/image.png', 'file:///image.png')];
    const result = preserveHistoricalAttachmentPreviews([
      historyImage('previous', '/image.png', 'data:image/png;base64,not-valid!'),
    ], history);
    expect(result).toStrictEqual(history);
    expect(result).not.toBe(history);
    expect(result[0]).toBe(history[0]);
  });

  it('never transfers previews across attachment kinds or malformed prefixes', () => {
    const safe = 'data:image/png;base64,cG5n';
    const previous: SurfaceMessage[] = [{
      id: 'previous', role: 'user', status: 'complete', parts: [
        { type: 'text', text: 'text' },
        { type: 'attachment', attachment: { kind: 'file', name: 'file', path: '/from-file.png', url: safe } },
        { type: 'attachment', attachment: { kind: 'image', name: 'image', path: '/to-file.png', url: safe } },
        {
          type: 'attachment',
          attachment: {
            kind: 'image', name: 'prefix', path: '/prefix.png',
            url: `prefix${safe}`,
          },
        },
      ],
    }];
    const text: SurfaceMessage = {
      id: 'text', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'unchanged' }],
    };
    const fromFile = historyImage('from-file', '/from-file.png', 'file:///from-file.png');
    const toFile: SurfaceMessage = {
      id: 'to-file', role: 'user', status: 'complete', parts: [{
        type: 'attachment', attachment: { kind: 'file', name: 'to-file', path: '/to-file.png' },
      }],
    };
    const prefixed = historyImage('prefix', '/prefix.png', 'file:///prefix.png');
    const result = preserveHistoricalAttachmentPreviews(previous, [text, fromFile, toFile, prefixed]);
    expect(result).toStrictEqual([text, fromFile, toFile, prefixed]);
    expect(result[0]).toBe(text);
    expect(result[1]).toBe(fromFile);
    expect(result[2]).toBe(toFile);
    expect(result[3]).toBe(prefixed);
  });

  it('accepts each renderer-safe preview MIME spelling but rejects junk before the data URL', () => {
    for (const mime of ['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'webp']) {
      const path = `/preview-${mime}`;
      const preview = `data:image/${mime};base64,AAAA`;
      expect(preserveHistoricalAttachmentPreviews(
        [historyImage('previous', path, preview)],
        [historyImage('history', path, `file://${path}`)],
      )[0]?.parts[0]).toMatchObject({ attachment: { url: preview } });
    }
    const path = '/junk-prefix';
    expect(preserveHistoricalAttachmentPreviews(
      [historyImage('previous', path, 'junkdata:image/png;base64,AAAA')],
      [historyImage('history', path, 'file:///junk-prefix')],
    )[0]?.parts[0]).toMatchObject({ attachment: { url: 'file:///junk-prefix' } });
  });

  it('enforces the exact renderer preview URL length boundary', () => {
    const prefix = 'data:image/png;base64,';
    const exact = `${prefix}${'A'.repeat(16 * 1024 * 1024 - prefix.length)}`;
    const path = '/bounded.png';
    expect(preserveHistoricalAttachmentPreviews(
      [historyImage('previous', path, exact)],
      [historyImage('history', path, 'file:///bounded.png')],
    )[0]?.parts[0]).toMatchObject({ attachment: { url: exact } });
    expect(preserveHistoricalAttachmentPreviews(
      [historyImage('previous', path, `${exact}A`)],
      [historyImage('history', path, 'file:///bounded.png')],
    )[0]?.parts[0]).toMatchObject({ attachment: { url: 'file:///bounded.png' } });
  });

  it('recognizes every supported generated-image signature and canonicalizes data URLs', () => {
    const images = [
      ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
      ['image/jpeg', [0xff, 0xd8, 0xff, 0x00]],
      ['image/gif', [...Buffer.from('GIF87a')]],
      ['image/gif', [...Buffer.from('GIF89a')]],
      ['image/webp', [...Buffer.from('RIFF0000WEBP')]],
      ['image/avif', [...Buffer.from('0000ftypavif')]],
    ] as const;
    for (const [mimeType, bytes] of images) {
      const base64 = Buffer.from(bytes).toString('base64');
      expect(codexImageDataUrl(base64)).toStrictEqual({
        url: `data:${mimeType};base64,${base64}`, mimeType,
      });
      expect(codexImageDataUrl(`data:image/custom+type;base64,\n${base64}\n`)).toStrictEqual({
        url: `data:${mimeType};base64,${base64}`, mimeType,
      });
    }
  });

  it('rejects malformed, unsupported, and non-image base64 without accepting partial data URLs', () => {
    const candidates = [
      '', 'AA', 'AAAAA', '!!!!', 'AAAA===', 'AAAA trailing',
      `prefixdata:image/png;base64,${pngBase64}`,
      `data:image/png;base64,${pngBase64}!`,
      `!!!!${pngBase64}`,
      `${pngBase64}!!!!`,
      pngBase64.replace(/=+$/, ''),
      `${pngBase64.slice(0, 8)}!!!!${pngBase64.slice(8)}`,
      'data:text/plain;base64,QUJDRA==',
      Buffer.from('not an image').toString('base64'),
      Buffer.from('RIFF0000NOPE').toString('base64'),
      Buffer.from('0000ftypavis').toString('base64'),
      Buffer.from('GIF86a').toString('base64'),
    ];
    expect(candidates.map(codexImageDataUrl)).toStrictEqual(candidates.map(() => null));
  });

  it('accepts exactly the generated-image byte budget and rejects one byte more', () => {
    const exact = Buffer.alloc(16 * 1024 * 1024);
    exact.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const over = Buffer.alloc(exact.byteLength + 1);
    exact.copy(over);
    expect(codexImageDataUrl(exact.toString('base64'))).toMatchObject({ mimeType: 'image/png' });
    expect(codexImageDataUrl(over.toString('base64'))).toBeNull();
  });

  it('uses only supported absolute saved paths and trims the optional generated prompt', () => {
    const base = {
      type: 'imageGeneration', id: 'image', status: 'completed', result: '', revisedPrompt: '  Prompt  ',
    };
    expect(codexItemToMediaPart({ ...base, savedPath: '/tmp/image.WEBP' } as unknown as v2.ThreadItem))
      .toStrictEqual({
        type: 'media', itemId: 'image',
        media: {
          url: 'file:///tmp/image.WEBP', alt: 'Generated image', title: 'Generated image',
          mimeType: 'image/webp', prompt: 'Prompt',
        },
      });
    for (const savedPath of ['relative.png', '/tmp/image.svg', '/tmp/image', null]) {
      expect(codexItemToMediaPart({ ...base, savedPath } as unknown as v2.ThreadItem)).toBeNull();
    }
    expect(codexItemToMediaPart({
      ...base, savedPath: '/tmp/image.png', revisedPrompt: '   ',
    } as unknown as v2.ThreadItem)?.media).toStrictEqual({
      url: 'file:///tmp/image.png', alt: 'Generated image', title: 'Generated image', mimeType: 'image/png',
    });
  });

  it('trims whitespace around inline generated-image results before decoding', () => {
    expect(codexItemToMediaPart({
      type: 'imageGeneration', id: 'trimmed', status: 'completed',
      result: `  \n${pngBase64}\n  `, revisedPrompt: null, savedPath: null,
    } as unknown as v2.ThreadItem)).toMatchObject({
      itemId: 'trimmed', media: { url: `data:image/png;base64,${pngBase64}`, mimeType: 'image/png' },
    });
  });

  it('preserves turn order and exact message identity across a complete thread', () => {
    const thread = {
      id: 'thread-order',
      turns: [
        {
          id: 'turn-1', status: 'completed', startedAt: 10, completedAt: 11,
          items: [{
            type: 'userMessage', id: 'user-1', clientId: 'client-1',
            content: [{ type: 'text', text: 'First' }],
          }],
        },
        {
          id: 'turn-2', status: 'failed', startedAt: null, completedAt: 20,
          items: [{ type: 'agentMessage', id: 'agent-2', text: 'Second', phase: 'final_answer' }],
        },
      ],
    } as unknown as v2.Thread;
    expect(codexThreadToSurfaceMessages(thread)).toStrictEqual([
      {
        id: 'client-1', role: 'user', status: 'complete', turnId: 'turn-1',
        parts: [{ type: 'text', text: 'First' }], createdAt: '1970-01-01T00:00:10.000Z',
        metadata: { conversationId: 'thread-order', turnId: 'turn-1' },
      },
      {
        id: 'assistant-turn-2', role: 'assistant', status: 'error', turnId: 'turn-2',
        parts: [{ type: 'text', text: 'Second', itemId: 'agent-2', phase: 'final_answer' }],
        createdAt: '1970-01-01T00:00:20.000Z',
        metadata: { conversationId: 'thread-order', turnId: 'turn-2' },
      },
    ]);
  });

  it('segments every assistant activity boundary and ignores empty activity', () => {
    const messages = codexTurnToSurfaceMessages('thread', {
      id: 'turn', status: 'inProgress', startedAt: 1, completedAt: null,
      items: [
        { type: 'agentMessage', id: 'empty', text: '', phase: null },
        { type: 'enteredReviewMode', id: 'ignored-review', review: 'ignored' },
        { type: 'agentMessage', id: 'agent-1', text: 'Before', phase: 'commentary' },
        { type: 'webSearch', id: 'search', query: 'SDK', action: null, results: null },
        { type: 'userMessage', id: 'steer', clientId: null, content: [{ type: 'text', text: 'Redirect' }] },
        { type: 'exitedReviewMode', id: 'review', review: 'After' },
      ],
    } as unknown as v2.Turn);
    expect(messages).toStrictEqual([
      {
        id: 'assistant-turn', role: 'assistant', status: 'streaming', turnId: 'turn',
        parts: [
          { type: 'text', text: 'Before', itemId: 'agent-1', phase: 'commentary' },
          expect.objectContaining({ type: 'tool', id: 'search' }),
        ],
        createdAt: '1970-01-01T00:00:01.000Z', metadata: { conversationId: 'thread', turnId: 'turn' },
      },
      {
        id: 'user-thread-turn-steer', kind: 'steer', role: 'user', status: 'complete', turnId: 'turn',
        parts: [{ type: 'text', text: 'Redirect' }], createdAt: '1970-01-01T00:00:01.000Z',
        metadata: { conversationId: 'thread', turnId: 'turn' },
      },
      {
        id: 'assistant-turn-segment-1', role: 'assistant', status: 'streaming', turnId: 'turn',
        parts: [{ type: 'text', text: 'After', itemId: 'review' }],
        createdAt: '1970-01-01T00:00:01.000Z', metadata: { conversationId: 'thread', turnId: 'turn' },
      },
    ]);
  });

  it('classifies steering after review output or tool activity alone', () => {
    const review = codexTurnToSurfaceMessages('thread', {
      id: 'review-turn', status: 'completed', startedAt: 1,
      items: [
        { type: 'exitedReviewMode', id: 'review', review: 'Review output' },
        { type: 'userMessage', id: 'after-review', clientId: null, content: [{ type: 'text', text: 'Continue' }] },
      ],
    } as unknown as v2.Turn);
    expect(review.map((message) => [message.role, message.kind])).toStrictEqual([
      ['assistant', undefined], ['user', 'steer'],
    ]);

    const tool = codexTurnToSurfaceMessages('thread', {
      id: 'tool-turn', status: 'completed', startedAt: 1,
      items: [
        { type: 'webSearch', id: 'search', query: 'SDK', action: null, results: null },
        { type: 'userMessage', id: 'after-tool', clientId: null, content: [{ type: 'text', text: 'Continue' }] },
      ],
    } as unknown as v2.Turn);
    expect(tool.map((message) => [message.role, message.kind])).toStrictEqual([
      ['assistant', undefined], ['user', 'steer'],
    ]);
  });

  it('maps individual user, assistant, review, and unsupported items with exact public shapes', () => {
    const turn = { id: 'turn', status: 'failed', startedAt: 2 } as const;
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'userMessage', id: 'user', clientId: null,
      content: [{ type: 'text', text: 'Hello' }],
    } as unknown as v2.ThreadItem)).toStrictEqual({
      id: 'user-thread-turn-user', role: 'user', status: 'complete', turnId: 'turn',
      parts: [{ type: 'text', text: 'Hello' }], createdAt: '1970-01-01T00:00:02.000Z',
      metadata: { conversationId: 'thread', turnId: 'turn', itemId: 'user' },
    });
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'agentMessage', id: 'agent', text: 'Answer', phase: 'commentary', memoryCitation: null,
    } as unknown as v2.ThreadItem)).toStrictEqual({
      id: 'assistant-agent', role: 'assistant', status: 'error', turnId: 'turn',
      parts: [{ type: 'text', text: 'Answer', itemId: 'agent', phase: 'commentary' }],
      createdAt: '1970-01-01T00:00:02.000Z',
      metadata: { conversationId: 'thread', turnId: 'turn', itemId: 'agent' },
    });
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'exitedReviewMode', id: 'review', review: 'Review',
    } as unknown as v2.ThreadItem)).toStrictEqual({
      id: 'assistant-review', role: 'assistant', status: 'error', turnId: 'turn',
      parts: [{ type: 'text', text: 'Review', itemId: 'review' }],
      createdAt: '1970-01-01T00:00:02.000Z',
      metadata: { conversationId: 'thread', turnId: 'turn', itemId: 'review' },
    });
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'enteredReviewMode', id: 'ignored', review: 'Prompt',
    } as unknown as v2.ThreadItem)).toBeNull();

    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'webSearch', id: 'search', query: 'SDK', action: null, results: null,
    } as unknown as v2.ThreadItem)).toStrictEqual({
      id: 'assistant-search', role: 'assistant', status: 'error', turnId: 'turn',
      parts: [expect.objectContaining({ type: 'tool', id: 'search', status: 'completed' })],
      createdAt: '1970-01-01T00:00:02.000Z',
      metadata: { conversationId: 'thread', turnId: 'turn', itemId: 'search' },
    });
  });

  it('keeps in-progress tool history running instead of terminalizing it', () => {
    const running = {
      type: 'commandExecution', id: 'command', command: 'npm test', cwd: '/tmp', status: 'inProgress',
      commandActions: [{ type: 'run', command: 'npm test' }], aggregatedOutput: '',
      exitCode: null, durationMs: null,
    } as unknown as v2.ThreadItem;
    expect(codexItemToSurfaceMessage('thread', {
      id: 'turn', status: 'inProgress', startedAt: 1,
    }, running)).toMatchObject({
      id: 'assistant-command', role: 'assistant', status: 'streaming',
      parts: [{ type: 'tool', id: 'command', status: 'running' }],
    });
    expect(codexTurnToSurfaceMessages('thread', {
      id: 'turn', status: 'inProgress', startedAt: 1, items: [running],
    } as unknown as v2.Turn)[0]).toMatchObject({
      status: 'streaming', parts: [{ type: 'tool', id: 'command', status: 'running' }],
    });
  });

  it('validates and groups every user input shape without confusing lookalikes', () => {
    const message = codexItemToSurfaceMessage('thread', {
      id: 'turn', status: 'completed', startedAt: 1,
    }, {
      type: 'userMessage', id: 'inputs', clientId: null, content: [
        null, [], { type: 1 }, { type: 'text', text: 1 }, { type: 'skill', name: 1 },
        { type: 'text', text: 'First' }, { type: 'skill', name: 'review' },
        { type: 'mention', name: '  Named file  ', path: '/tmp/file.pdf' },
        { type: 'mention', name: '   ', path: '/tmp/fallback.txt' },
        { type: 'image', url: 'https://example.com/a%20name.JPEG' },
        { type: 'localImage', path: '/tmp/local.HEIC' },
        { type: 'image', url: 1 }, { type: 'localImage', path: 1 },
        { type: 'unknown', path: '/tmp/lookalike.png', url: 'https://example.com/lookalike.png' },
        { type: 'mention', name: 42, path: '/tmp/numeric-name.gif' },
        { type: 'image', url: 'data:image/PNG;base64,AAAA' },
        { type: 'image', url: 'prefixdata:image/png;base64,AAAA' },
        { type: 'text', text: 'Last' },
      ],
    } as unknown as v2.ThreadItem);
    expect(message?.parts).toStrictEqual([
      { type: 'text', text: 'First\n$review' },
      { type: 'attachment', attachment: {
        kind: 'file', name: 'Named file', path: '/tmp/file.pdf', mimeType: 'application/pdf',
      } },
      { type: 'attachment', attachment: { kind: 'file', name: 'fallback.txt', path: '/tmp/fallback.txt' } },
      { type: 'attachment', attachment: {
        kind: 'image', name: 'a name.JPEG', url: 'https://example.com/a%20name.JPEG', mimeType: 'image/jpeg',
      } },
      { type: 'attachment', attachment: {
        kind: 'image', name: 'local.HEIC', path: '/tmp/local.HEIC', mimeType: 'image/heic',
      } },
      { type: 'attachment', attachment: {
        kind: 'file', name: 'numeric-name.gif', path: '/tmp/numeric-name.gif', mimeType: 'image/gif',
      } },
      { type: 'attachment', attachment: {
        kind: 'image', name: 'PNG;base64,AAAA', url: 'data:image/PNG;base64,AAAA', mimeType: 'image/png',
      } },
      { type: 'attachment', attachment: {
        kind: 'image', name: 'png;base64,AAAA', url: 'prefixdata:image/png;base64,AAAA',
      } },
      { type: 'text', text: 'Last' },
    ]);
  });

  it('uses attachment fallbacks for empty and malformed URL paths', () => {
    const message = codexItemToSurfaceMessage('thread', {
      id: 'turn', status: 'completed', startedAt: 1,
    }, {
      type: 'userMessage', id: 'inputs', clientId: null, content: [
        { type: 'image', url: 'https://example.com/' },
        { type: 'image', url: 'https://example.com/%E0%A4%A' },
        { type: 'image', url: 'folder/http:file.png' },
        { type: 'image', url: 'http://[.png' },
        { type: 'localImage', path: '' },
      ],
    } as unknown as v2.ThreadItem);
    expect(message?.parts).toStrictEqual([
      { type: 'attachment', attachment: { kind: 'image', name: 'Image', url: 'https://example.com/' } },
      { type: 'attachment', attachment: { kind: 'image', name: '%E0%A4%A', url: 'https://example.com/%E0%A4%A' } },
      { type: 'attachment', attachment: {
        kind: 'image', name: 'http:file.png', url: 'folder/http:file.png', mimeType: 'image/png',
      } },
      { type: 'attachment', attachment: {
        kind: 'image', name: '[.png', url: 'http://[.png', mimeType: 'image/png',
      } },
      { type: 'attachment', attachment: { kind: 'image', name: 'Image', path: '' } },
    ]);
  });

  it('recognizes every supported saved-path image MIME type', () => {
    const expected = [
      ['avif', 'image/avif'], ['gif', 'image/gif'], ['jpeg', 'image/jpeg'],
      ['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
    ];
    for (const [extension, mimeType] of expected) {
      expect(codexItemToMediaPart({
        type: 'imageGeneration', id: extension, status: 'completed', result: '', revisedPrompt: null,
        savedPath: `/tmp/image.${extension}`,
      } as unknown as v2.ThreadItem)?.media).toMatchObject({ mimeType });
    }
  });

  it('rejects near-miss image signatures that share only suffixes or bytes', () => {
    const candidates = [
      [0x89, 0, 0, 0, 0, 0, 0, 0],
      [...Buffer.from('xxxxxxGIF87a')],
      [...Buffer.from('xxxxxxGIF89a')],
      [...Buffer.from('xxxx0000WEBP')],
    ];
    expect(candidates.map((bytes) => codexImageDataUrl(Buffer.from(bytes).toString('base64'))))
      .toStrictEqual([null, null, null, null]);
  });
});

function historyImage(id: string, path: string, url: string): SurfaceMessage {
  return {
    id, role: 'user', status: 'complete', parts: [{
      type: 'attachment', attachment: { kind: 'image', name: id, path, url },
    }],
  };
}
