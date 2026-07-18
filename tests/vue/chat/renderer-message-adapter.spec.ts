// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { surfaceMessageToChatMessage } from '../../../src/vue/chat/renderer-message-adapter';
import type { SurfaceMessage } from '../../../src/surface/types';

describe('renderer message adapter', () => {
  it('maps surface parts into rich chat messages without losing tool display data', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'assistant-turn-1',
      parts: [
        { type: 'text', text: 'Done.' },
        { type: 'status', text: 'checked workspace' },
        {
          type: 'tool',
          id: 'tool-npm-test',
          kind: 'command',
          title: 'npm test',
          status: 'completed',
          body: '46 passed',
          input: { command: 'npm test' },
        },
      ],
      role: 'assistant',
      status: 'streaming',
    };

    expect(surfaceMessageToChatMessage(rendererMessage)).toStrictEqual({
      content: 'Done.\n\nchecked workspace',
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'assistant-turn-1',
      parts: [
        { type: 'text', content: 'Done.' },
        { type: 'text', content: 'checked workspace' },
        {
          type: 'tool',
          toolCall: {
            args: { command: 'npm test' },
            done: true,
            function: 'npm test',
            id: 'tool-npm-test',
            result: '46 passed',
            state: 'completed',
            status: 'completed',
          },
        },
      ],
      role: 'assistant',
      streaming: true,
      toolCalls: [
        {
          args: { command: 'npm test' },
          done: true,
          function: 'npm test',
          id: 'tool-npm-test',
          result: '46 passed',
          state: 'completed',
          status: 'completed',
        },
      ],
      type: 'text',
    });
  });

  it('converts system messages to assistant display messages for the renderer stack', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'system-1',
      parts: [{ type: 'status', text: 'Codex app-server error' }],
      role: 'system',
      status: 'error',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).role).toBe('assistant');
    expect(surfaceMessageToChatMessage(rendererMessage).content).toBe('Codex app-server error');
  });

  it('marks steered user messages for timeline rendering', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:03.000Z',
      id: 'steer-turn-1',
      kind: 'steer',
      parts: [{ type: 'text', text: 'read all the markdown files' }],
      role: 'user',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage)).toStrictEqual({
      content: 'read all the markdown files',
      createdAt: '2026-06-05T00:00:03.000Z',
      id: 'steer-turn-1',
      parts: [{ type: 'text', content: 'read all the markdown files' }],
      role: 'user',
      streaming: false,
      toolCalls: [],
      type: 'steer',
    });
  });

  it('marks compaction messages for timeline rendering', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:03.000Z',
      id: 'compaction-turn-1',
      kind: 'compaction',
      parts: [],
      role: 'assistant',
      status: 'streaming',
    };

    expect(surfaceMessageToChatMessage(rendererMessage)).toStrictEqual({
      compactionStatus: 'running',
      content: '',
      createdAt: '2026-06-05T00:00:03.000Z',
      id: 'compaction-turn-1',
      parts: [],
      role: 'assistant',
      streaming: true,
      toolCalls: [],
      type: 'compaction',
    });
  });


  it('maps failed and bodyless tools into displayable tool calls', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'assistant-turn-2',
      parts: [
        { type: 'tool', id: 'tool-git-diff', kind: 'command', title: 'git diff', status: 'failed' },
      ],
      role: 'assistant',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).toolCalls).toStrictEqual([
      {
        args: undefined,
        done: true,
        function: 'git diff',
        id: 'tool-git-diff',
        result: undefined,
        state: 'error',
        status: 'failed',
      },
    ]);
  });

  it('prefers structuredContent over the MCP model-facing placeholder result', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'assistant-turn-structured',
      parts: [
        {
          type: 'tool',
          id: 'tool-set-status',
          kind: 'mcp',
          title: 'team.set-status',
          status: 'completed',
          body: 'Result returned in structuredContent.',
          input: {
            agentId: 'agent-dina',
            status: 'Registered and idle',
          },
          output: {
            content: [{ type: 'text', text: 'Result returned in structuredContent.' }],
            structuredContent: {
              agentId: 'agent-dina',
              status: 'Registered and idle',
            },
            isError: false,
          },
        },
      ],
      role: 'assistant',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).toolCalls).toStrictEqual([
      {
        args: {
          agentId: 'agent-dina',
          status: 'Registered and idle',
        },
        done: true,
        function: 'team.set-status',
        id: 'tool-set-status',
        result: {
          agentId: 'agent-dina',
          status: 'Registered and idle',
        },
        state: 'completed',
        status: 'completed',
      },
    ]);
  });

  it('preserves ordered renderer parts so tools can render between text chunks', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'assistant-turn-ordered',
      parts: [
        { type: 'text', text: 'Before the read.' },
        {
          type: 'tool',
          id: 'tool-read',
          kind: 'command',
          title: 'cat docs/architecture.md',
          status: 'completed',
          body: 'architecture contents',
          input: { command: 'cat docs/architecture.md' },
        },
        { type: 'text', text: 'After the read.' },
      ],
      role: 'assistant',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).parts).toStrictEqual([
      { type: 'text', content: 'Before the read.' },
      {
        type: 'tool',
        toolCall: {
          args: { command: 'cat docs/architecture.md' },
          done: true,
          function: 'cat docs/architecture.md',
          id: 'tool-read',
          result: 'architecture contents',
          state: 'completed',
          status: 'completed',
        },
      },
      { type: 'text', content: 'After the read.' },
    ]);
  });

  it('preserves generated media as an ordered renderer part', () => {
    const rendererMessage: SurfaceMessage = {
      id: 'assistant-generated',
      parts: [{
        type: 'media',
        itemId: 'image-1',
        media: {
          url: 'file:///tmp/generated.png',
          alt: 'Generated image',
          mimeType: 'image/png',
          prompt: 'Draw a polished dashboard',
          title: 'Generated image',
        },
      }],
      role: 'assistant',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage)).toMatchObject({
      content: '',
      parts: [{
        type: 'media',
        media: {
          url: 'file:///tmp/generated.png',
          prompt: 'Draw a polished dashboard',
        },
      }],
      toolCalls: [],
    });
  });

  it('preserves ordered user attachments without flattening filenames into editable text', () => {
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-07-18T00:00:00.000Z',
      id: 'user-turn-attachments',
      parts: [
        { type: 'text', text: 'Compare these.' },
        {
          type: 'attachment',
          attachment: {
            kind: 'image',
            name: 'diagram.png',
            path: '/tmp/diagram.png',
            url: 'data:image/png;base64,cG5n',
            mimeType: 'image/png',
          },
        },
        {
          type: 'attachment',
          attachment: {
            kind: 'file',
            name: 'notes.md',
            path: '/tmp/notes.md',
            mimeType: 'text/markdown',
          },
        },
        { type: 'text', text: 'Keep their order.' },
      ],
      role: 'user',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage)).toMatchObject({
      content: 'Compare these.\n\nKeep their order.',
      parts: [
        { type: 'text', content: 'Compare these.' },
        {
          type: 'attachment',
          attachment: {
            kind: 'image',
            name: 'diagram.png',
            path: '/tmp/diagram.png',
            url: 'data:image/png;base64,cG5n',
            mimeType: 'image/png',
          },
        },
        {
          type: 'attachment',
          attachment: {
            kind: 'file',
            name: 'notes.md',
            path: '/tmp/notes.md',
            mimeType: 'text/markdown',
          },
        },
        { type: 'text', content: 'Keep their order.' },
      ],
    });
  });

  it('uses renderer tool status text for confirmation descriptors', () => {
    const statusText = JSON.stringify({
      source: 'mcp',
      action: 'run',
      phase: 'running',
      params: {
        requestId: 'approval-1',
      },
    });
    const rendererMessage: SurfaceMessage = {
      createdAt: '2026-06-05T00:00:00.000Z',
      id: 'assistant-turn-confirm',
      parts: [
        {
          type: 'tool',
          id: 'tool-register',
          kind: 'mcp',
          title: 'team.register-agent',
          status: 'running',
          statusText,
        },
      ],
      role: 'assistant',
      status: 'streaming',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).toolCalls?.at(0)?.status).toBe(statusText);
  });
});
