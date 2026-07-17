import { describe, expect, it } from 'vitest';
import type { v2 } from '../src/codex';
import {
  codexItemToSurfaceMessage,
  codexItemToToolPart,
  codexThreadToSurfaceMessages,
} from '../src/node/codex-conversation-history';

describe('Codex conversation history adapter', () => {
  it('turns persisted user, assistant, and tool items into stable surface messages', () => {
    const thread = {
      id: 'thread-1',
      turns: [{
        id: 'turn-1',
        status: 'completed',
        startedAt: 1_700_000_000,
        items: [
          { type: 'userMessage', id: 'user-item', clientId: 'user-client', content: [{ type: 'text', text: 'Fix it', text_elements: [] }] },
          { type: 'agentMessage', id: 'agent-item', text: 'Done', phase: null, memoryCitation: null },
          {
            type: 'commandExecution', id: 'command-item', command: 'npm test', cwd: '/tmp/project', processId: null,
            source: 'unifiedExec', status: 'completed', commandActions: [], aggregatedOutput: '42 passed', exitCode: 0,
            durationMs: 100,
          },
        ],
      }],
    } as unknown as v2.Thread;

    const messages = codexThreadToSurfaceMessages(thread);

    expect(messages).toStrictEqual([
      {
        id: 'user-client',
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text: 'Fix it' }],
        createdAt: '2023-11-14T22:13:20.000Z',
        metadata: { conversationId: 'thread-1', turnId: 'turn-1', itemId: 'user-item' },
      },
      {
        id: 'assistant-agent-item',
        role: 'assistant',
        status: 'complete',
        parts: [{ type: 'text', text: 'Done' }],
        createdAt: '2023-11-14T22:13:20.000Z',
        metadata: { conversationId: 'thread-1', turnId: 'turn-1', itemId: 'agent-item' },
      },
      {
        id: 'assistant-command-item',
        role: 'assistant',
        status: 'complete',
        parts: [{
          type: 'tool',
          id: 'command-item',
          title: 'npm test',
          kind: 'command',
          status: 'completed',
          body: '42 passed',
          output: '42 passed',
          metadata: { cwd: '/tmp/project', exitCode: 0 },
        }],
        createdAt: '2023-11-14T22:13:20.000Z',
        metadata: { conversationId: 'thread-1', turnId: 'turn-1', itemId: 'command-item' },
      },
    ]);
  });

  it('maps rich inputs, plans, failures, and unsupported lifecycle items safely', () => {
    const thread = {
      id: 'thread-2',
      turns: [{
        id: 'turn-2', status: 'failed', startedAt: null,
        items: [
          { type: 'userMessage', id: 'user', clientId: null, content: [
            { type: 'skill', name: 'review', path: '/review' },
            { type: 'mention', name: 'app', path: '/app' },
            { type: 'localImage', path: '/tmp/ui.png' },
          ] },
          { type: 'plan', id: 'plan', text: '1. Inspect' },
          { type: 'contextCompaction', id: 'compact' },
        ],
      }],
    } as unknown as v2.Thread;

    const messages = codexThreadToSurfaceMessages(thread);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.parts[0]).toMatchObject({ text: '$review\n@app\n![image](/tmp/ui.png)' });
    expect(messages[1]).toMatchObject({ status: 'error', parts: [{ text: '1. Inspect' }] });
  });

  it('normalizes the full tool-item vocabulary without leaking protocol shapes', () => {
    const tool = (item: unknown) => codexItemToToolPart(item as v2.ThreadItem);
    const cases = [
      {
        input: {
          type: 'commandExecution', id: 'command', command: 'pwd', cwd: '/tmp', processId: null,
          source: 'unifiedExec', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
        },
        expected: {
          type: 'tool', id: 'command', title: 'pwd', kind: 'command', status: 'running',
          metadata: { cwd: '/tmp', exitCode: null },
        },
      },
      {
        input: { type: 'fileChange', id: 'file', changes: [{}], status: 'applied' },
        expected: {
          type: 'tool', id: 'file', title: 'Changed 1 file', kind: 'file-change', status: 'completed', output: [{}],
        },
      },
      {
        input: {
          type: 'mcpToolCall', id: 'mcp', server: 'github', tool: 'search', status: 'failed', arguments: { q: 'sdk' },
          result: { content: [] }, error: { message: 'offline' }, appContext: null, pluginId: null, durationMs: null,
        },
        expected: {
          type: 'tool', id: 'mcp', title: 'github · search', kind: 'mcp', status: 'failed',
          input: { q: 'sdk' }, output: { content: [] }, body: 'offline',
        },
      },
      {
        input: {
          type: 'dynamicToolCall', id: 'dynamic', namespace: null, tool: 'custom', arguments: {}, status: 'completed',
          contentItems: [{ type: 'inputText', text: 'done' }], success: false, durationMs: null,
        },
        expected: {
          type: 'tool', id: 'dynamic', title: 'custom', kind: 'tool', status: 'failed', input: {},
          output: [{ type: 'inputText', text: 'done' }],
        },
      },
      {
        input: { type: 'reasoning', id: 'reasoning', summary: ['Thinking'], content: ['Details'] },
        expected: {
          type: 'tool', id: 'reasoning', title: 'Reasoning', kind: 'reasoning', status: 'completed', body: 'Thinking\nDetails',
        },
      },
      {
        input: { type: 'webSearch', id: 'search', query: '' },
        expected: { type: 'tool', id: 'search', title: 'Web search', kind: 'web-search', status: 'completed' },
      },
      {
        input: { type: 'imageView', id: 'view', path: '/tmp/ui.png' },
        expected: { type: 'tool', id: 'view', title: 'Viewed /tmp/ui.png', kind: 'image', status: 'completed' },
      },
      {
        input: { type: 'imageGeneration', id: 'image', status: 'completed' },
        expected: { type: 'tool', id: 'image', title: 'Generated image', kind: 'image', status: 'completed' },
      },
      {
        input: { type: 'collabAgentToolCall', id: 'agent', tool: 'spawn', status: 'inProgress' },
        expected: { type: 'tool', id: 'agent', title: 'Agent spawn', kind: 'agent', status: 'running' },
      },
      {
        input: { type: 'sleep', id: 'sleep', durationMs: 100 },
        expected: {
          type: 'tool', id: 'sleep', title: 'Waited', kind: 'wait', status: 'completed', metadata: { durationMs: 100 },
        },
      },
    ];

    for (const { input, expected } of cases) {
      expect(tool(input)).toStrictEqual(expected);
    }
  });

  it('handles empty and alternate message inputs and review output', () => {
    const turn = { id: 'turn', status: 'interrupted' as const, startedAt: null };
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'userMessage', id: 'empty', clientId: null, content: [{ type: 'text', text: '', text_elements: [] }],
    })).toBeNull();
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'userMessage', id: 'image', clientId: null, content: [{ type: 'image', url: 'https://example.com/ui.png' }],
    })).toMatchObject({ parts: [{ text: '![image](https://example.com/ui.png)' }] });
    expect(codexItemToSurfaceMessage('thread', turn, {
      type: 'exitedReviewMode', id: 'review', review: 'Looks good',
    })).toMatchObject({ status: 'complete', parts: [{ text: 'Looks good' }] });
  });
});
