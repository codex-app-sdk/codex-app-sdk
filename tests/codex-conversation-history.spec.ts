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

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ id: 'user-client', role: 'user', parts: [{ type: 'text', text: 'Fix it' }] });
    expect(messages[1]).toMatchObject({ id: 'assistant-agent-item', role: 'assistant', parts: [{ text: 'Done' }] });
    expect(messages[2]).toMatchObject({
      status: 'complete',
      parts: [{ type: 'tool', title: 'npm test', status: 'completed', body: '42 passed' }],
    });
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
    expect(tool({
      type: 'commandExecution', id: 'command', command: 'pwd', cwd: '/tmp', processId: null,
      source: 'unifiedExec', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
    })).toMatchObject({ kind: 'command', status: 'running' });
    expect(tool({ type: 'fileChange', id: 'file', changes: [{}], status: 'applied' })).toMatchObject({
      title: 'Changed 1 file', status: 'completed',
    });
    expect(tool({
      type: 'mcpToolCall', id: 'mcp', server: 'github', tool: 'search', status: 'failed', arguments: { q: 'sdk' },
      result: { content: [] }, error: { message: 'offline' }, appContext: null, pluginId: null, durationMs: null,
    })).toMatchObject({ kind: 'mcp', status: 'failed', body: 'offline', output: { content: [] } });
    expect(tool({
      type: 'dynamicToolCall', id: 'dynamic', namespace: null, tool: 'custom', arguments: {}, status: 'completed',
      contentItems: [{ type: 'inputText', text: 'done' }], success: false, durationMs: null,
    })).toMatchObject({ title: 'custom', status: 'failed', output: expect.any(Array) });
    expect(tool({ type: 'reasoning', id: 'reasoning', summary: ['Thinking'], content: ['Details'] })).toMatchObject({
      kind: 'reasoning', body: 'Thinking\nDetails',
    });
    expect(tool({ type: 'webSearch', id: 'search', query: '' })).toMatchObject({ title: 'Web search' });
    expect(tool({ type: 'imageView', id: 'view', path: '/tmp/ui.png' })).toMatchObject({ kind: 'image' });
    expect(tool({ type: 'imageGeneration', id: 'image', status: 'completed' })).toMatchObject({ status: 'completed' });
    expect(tool({ type: 'collabAgentToolCall', id: 'agent', tool: 'spawn', status: 'inProgress' })).toMatchObject({
      title: 'Agent spawn', status: 'running',
    });
    expect(tool({ type: 'sleep', id: 'sleep', durationMs: 100 })).toMatchObject({ kind: 'wait' });
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
