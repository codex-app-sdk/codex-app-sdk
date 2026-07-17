import { describe, expect, it } from 'vitest';
import type { v2 } from '../src/codex';
import { codexThreadToSurfaceMessages } from '../src/node/codex-conversation-history';

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
});
