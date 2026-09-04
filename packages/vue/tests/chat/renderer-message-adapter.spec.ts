// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { Message, MessageToolCall } from '../../src/chat/types';
import {
  chatMessageFromInput,
  chatMessagesFromInputs,
  surfaceMessageToChatMessage,
} from '../../src/chat/renderer-message-adapter';
import type { SurfaceMessage } from '@codex-app-sdk/core/surface';

describe('renderer message adapter', () => {
  it('adapts mixed input collections while preserving unchanged compatibility messages', () => {
    const compatibilityMessage: Message = {
      role: 'user',
      content: 'legacy input',
    };
    const surfaceMessage: SurfaceMessage = {
      id: 'surface-input',
      parts: [{ type: 'text', text: 'surface input' }],
      role: 'assistant',
      status: 'complete',
    };

    const messages = chatMessagesFromInputs([compatibilityMessage, surfaceMessage]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(compatibilityMessage);
    expect(messages[1]).toMatchObject({ content: 'surface input', id: 'surface-input' });
  });

  it('preserves assistant phases and safe reasoning summaries as structured parts', () => {
    const message = surfaceMessageToChatMessage({
      id: 'assistant-phased',
      role: 'assistant',
      status: 'streaming',
      parts: [
        {
          type: 'reasoning',
          summary: 'Checking the renderer contract',
          itemId: 'reasoning-1',
          summaryIndex: 0,
        },
        { type: 'text', text: 'I am checking the UI.', itemId: 'commentary-1', phase: 'commentary' },
        { type: 'text', text: 'The fix is ready.', itemId: 'answer-1', phase: 'final_answer' },
      ],
    });

    expect(message.parts).toStrictEqual([
      {
        type: 'reasoning',
        summary: 'Checking the renderer contract',
        itemId: 'reasoning-1',
        summaryIndex: 0,
      },
      { type: 'text', content: 'I am checking the UI.', itemId: 'commentary-1', phase: 'commentary' },
      { type: 'text', content: 'The fix is ready.', itemId: 'answer-1', phase: 'final_answer' },
    ]);
    expect(message.content).toBe('I am checking the UI.\n\nThe fix is ready.');
  });

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
            itemId: 'tool-npm-test',
            kind: 'command',
            messageId: 'assistant-turn-1',
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
          itemId: 'tool-npm-test',
          kind: 'command',
          messageId: 'assistant-turn-1',
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

  it('propagates message, turn, and item context to adapted tool calls', () => {
    const rendererMessage: SurfaceMessage = {
      id: 'assistant-turn-context',
      metadata: { conversationId: 'thread-1' },
      parts: [{
        type: 'tool',
        id: 'item-read',
        kind: 'command',
        title: 'cat app-state.spec.ts',
        status: 'completed',
      }],
      role: 'assistant',
      status: 'complete',
      turnId: 'turn-context',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).toolCalls?.[0]).toMatchObject({
      itemId: 'item-read',
      messageId: 'assistant-turn-context',
      turnId: 'turn-context',
    });
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

  it('marks a completed compaction with its terminal timeline status', () => {
    const message = surfaceMessageToChatMessage({
      id: 'compaction-complete',
      kind: 'compaction',
      parts: [],
      role: 'assistant',
      status: 'complete',
    });

    expect(message).toMatchObject({
      compactionStatus: 'completed',
      streaming: false,
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
      itemId: 'tool-git-diff',
      kind: 'command',
      messageId: 'assistant-turn-2',
      result: undefined,
        state: 'error',
        status: 'failed',
      },
    ]);
  });

  it('settles stale running tools when their surface message is terminal', () => {
    const rendererMessage: SurfaceMessage = {
      id: 'assistant-interrupted',
      parts: [{
        type: 'tool',
        id: 'tool-read',
        kind: 'command',
        title: 'cat README.md',
        status: 'running',
        statusText: JSON.stringify({ source: 'codex', action: 'read', phase: 'running' }),
      }],
      role: 'assistant',
      status: 'complete',
    };

    expect(surfaceMessageToChatMessage(rendererMessage).toolCalls?.[0]).toMatchObject({
      done: true,
      state: 'error',
      status: JSON.stringify({ source: 'codex', action: 'read', phase: 'failed' }),
    });
  });

  it('settles stale running tools in terminal compatibility messages', () => {
    const message = chatMessageFromInput({
      role: 'assistant',
      content: '',
      streaming: false,
      toolCalls: [{
        args: undefined,
        function: 'image_generation',
        id: 'tool-image',
        state: 'running',
        status: 'Running image_generation',
        result: undefined,
      }],
    });

    expect(message.toolCalls?.[0]).toMatchObject({
      done: true,
      state: 'error',
      status: 'failed',
    });
  });

  it('settles every terminal tool-state combination without cloning completed work', () => {
    const settled: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'settled',
      id: 'settled',
      result: 'done',
      state: 'completed',
      status: 'completed',
    };
    const incomplete: MessageToolCall = {
      args: undefined,
      function: 'incomplete',
      id: 'incomplete',
      result: 'done',
      state: 'completed',
      status: 'completed',
    };
    const staleRunning: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'stale-running',
      id: 'stale-running',
      result: undefined,
      state: 'running',
      status: 'Still running',
    };
    const message: Message = {
      role: 'assistant',
      content: 'terminal',
      parts: [
        { type: 'tool', toolCall: settled },
        { type: 'tool', toolCall: incomplete },
        { type: 'text', content: 'between tools' },
        { type: 'tool', toolCall: staleRunning },
      ],
      streaming: false,
      toolCalls: [settled, incomplete, staleRunning],
    };

    const adapted = chatMessageFromInput(message);

    expect(adapted).not.toBe(message);
    expect(adapted.toolCalls?.[0]).toBe(settled);
    expect(adapted.toolCalls?.[1]).toMatchObject({ done: true, state: 'completed', status: 'completed' });
    expect(adapted.toolCalls?.[2]).toMatchObject({ done: true, state: 'error', status: 'failed' });
    expect(adapted.parts?.[0]).toStrictEqual({ type: 'tool', toolCall: settled });
    expect(adapted.parts?.[1]).toStrictEqual({ type: 'tool', toolCall: adapted.toolCalls?.[1] });
    expect(adapted.parts?.[2]).toStrictEqual({ type: 'text', content: 'between tools' });
    expect(adapted.parts?.[3]).toStrictEqual({ type: 'tool', toolCall: adapted.toolCalls?.[2] });
    expect((adapted.parts?.[1] as { toolCall: MessageToolCall }).toolCall).toBe(adapted.toolCalls?.[1]);
    expect((adapted.parts?.[3] as { toolCall: MessageToolCall }).toolCall).toBe(adapted.toolCalls?.[2]);
  });

  it('returns an already settled terminal compatibility message by identity', () => {
    const message: Message = {
      role: 'assistant',
      content: 'done',
      streaming: false,
      toolCalls: [{
        args: undefined,
        done: true,
        function: 'read',
        id: 'read',
        result: 'done',
        state: 'completed',
      }],
    };

    expect(chatMessageFromInput(message)).toBe(message);
  });

  it.each([undefined, '', 'plain running label', '[]', 'null']) (
    'normalizes a stale terminal status of %j to the failed fallback',
    (status) => {
      const message = chatMessageFromInput({
        role: 'assistant',
        content: '',
        streaming: false,
        toolCalls: [{
          args: undefined,
          function: 'read',
          id: 'read',
          result: undefined,
          state: 'running',
          status,
        }],
      });

      expect(message.toolCalls?.[0]?.status).toBe('failed');
    },
  );

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
        itemId: 'tool-set-status',
        kind: 'mcp',
        messageId: 'assistant-turn-structured',
        result: {
          agentId: 'agent-dina',
          status: 'Registered and idle',
        },
        state: 'completed',
        status: 'completed',
      },
    ]);
  });

  it('keeps a null tool output as the exact result', () => {
    const message = surfaceMessageToChatMessage({
      id: 'assistant-null-output',
      parts: [{
        type: 'tool',
        id: 'null-output',
        title: 'read',
        status: 'completed',
        output: null as never,
      }],
      role: 'assistant',
      status: 'complete',
    });

    expect(message.toolCalls?.[0]?.result).toBeNull();
  });

  it('derives body arguments, fallback item identity, and turn context from metadata', () => {
    const message = surfaceMessageToChatMessage({
      id: 'assistant-fallback-tool',
      metadata: { turnId: 'turn-from-metadata' },
      parts: [{
        type: 'tool',
        id: '',
        title: 'shell',
        status: 'running',
        body: 'command output',
      }],
      role: 'assistant',
      status: 'streaming',
    });

    expect(message.toolCalls).toStrictEqual([{
      args: { output: 'command output' },
      done: false,
      function: 'shell',
      id: 'assistant-fallback-tool-tool-0',
      itemId: 'assistant-fallback-tool-tool-0',
      messageId: 'assistant-fallback-tool',
      result: 'command output',
      state: 'running',
      status: 'running',
      turnId: 'turn-from-metadata',
    }]);
  });

  it.each([undefined, '', false, 42])('rejects non-usable metadata turn ids: %j', (turnId) => {
    const toolCall = surfaceMessageToChatMessage({
      id: 'assistant-invalid-turn',
      metadata: turnId === undefined ? undefined : { turnId },
      parts: [{ type: 'tool', id: 'read', title: 'read', status: 'completed' }],
      role: 'assistant',
      status: 'complete',
    }).toolCalls?.[0];

    expect(toolCall).not.toHaveProperty('turnId');
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
          itemId: 'tool-read',
          kind: 'command',
          messageId: 'assistant-turn-ordered',
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

  it('preserves app-owned MCP identity for Vue presentation resolvers', () => {
    const metadata = { server: 'codex_claw', tool: 'browser_open', durationMs: 12 };
    const rendererMessage: SurfaceMessage = {
      id: 'assistant-mcp-presentation',
      parts: [{
        type: 'tool',
        id: 'browser-open',
        kind: 'mcp',
        title: 'codex_claw.browser_open',
        status: 'completed',
        metadata,
      }],
      role: 'assistant',
      status: 'complete',
    };

    const toolCall = surfaceMessageToChatMessage(rendererMessage).toolCalls?.at(0);
    expect(toolCall).toMatchObject({
      kind: 'mcp',
      metadata: { server: 'codex_claw', tool: 'browser_open', durationMs: 12 },
    });
    expect(toolCall?.metadata).not.toBe(metadata);
  });
});
