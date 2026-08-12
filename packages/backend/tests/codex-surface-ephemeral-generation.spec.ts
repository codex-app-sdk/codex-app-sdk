import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import {
  FakeTransport,
  resumeResponse,
  thread,
  turn,
} from './helpers/codex-surface-fixture';

describe('CodexSurface ephemeral generation', () => {
  it('returns structured text without changing or emitting visible surface state', async () => {
    const transport = new FakeTransport({
      'thread/start': () => resumeResponse({
        ...thread('thread-ephemeral', false),
        ephemeral: true,
      }),
      'turn/start': () => ({ turn: turn('turn-ephemeral', 'inProgress', []) }),
      'thread/unsubscribe': () => ({ status: 'unsubscribed' }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    });
    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));
    const before = surface.getSnapshot();
    const events: unknown[] = [];
    surface.onEvent((event) => events.push(event));

    const resultPromise = surface.generateText('Write a commit message', {
      developerInstructions: 'Return JSON only.',
      model: 'gpt-mini',
      reasoningEffort: 'high',
      outputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
    });

    await vi.waitFor(() => expect(transport.sent.some((message) => (
      'method' in message && message.method === 'turn/start'
    ))).toBe(true));
    transport.emit({
      method: 'thread/started',
      params: {
        thread: { ...thread('thread-ephemeral', false), ephemeral: true },
      },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-ephemeral',
        turnId: 'turn-ephemeral',
        completedAtMs: 2,
        item: {
          type: 'agentMessage',
          id: 'result',
          text: '{"message":"fix: keep state isolated"}',
          phase: 'final_answer',
          memoryCitation: null,
        },
      },
    });
    transport.emit({
      method: 'turn/completed',
      params: {
        threadId: 'thread-ephemeral',
        turn: turn('turn-ephemeral', 'completed', []),
      },
    });

    await expect(resultPromise).resolves.toEqual({
      text: '{"message":"fix: keep state isolated"}',
    });
    expect(transport.sent.find((message) => (
      'method' in message && message.method === 'thread/start'
    ))).toMatchObject({
      params: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        cwd: '/tmp/project',
        developerInstructions: 'Return JSON only.',
        dynamicTools: [],
        ephemeral: true,
        model: 'gpt-mini-runtime',
        permissions: ':read-only',
        serviceName: 'codex_app_sdk',
      },
    });
    expect(transport.sent.find((message) => (
      'method' in message && message.method === 'turn/start'
    ))).toMatchObject({
      params: {
        threadId: 'thread-ephemeral',
        effort: 'high',
        environments: [],
        input: [{ type: 'text', text: 'Write a commit message', text_elements: [] }],
        model: 'gpt-mini-runtime',
        outputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        permissions: ':read-only',
      },
    });
    expect(transport.sent).toContainEqual({
      id: expect.any(Number),
      method: 'thread/unsubscribe',
      params: { threadId: 'thread-ephemeral' },
    });
    expect(surface.getSnapshot()).toEqual(before);
    expect(events).toEqual([]);
  });

  it('interrupts and unsubscribes when generation is aborted', async () => {
    const transport = new FakeTransport({
      'thread/start': () => resumeResponse({
        ...thread('thread-aborted', false),
        ephemeral: true,
      }),
      'turn/start': () => ({ turn: turn('turn-aborted', 'inProgress', []) }),
      'turn/interrupt': () => ({}),
      'thread/unsubscribe': () => ({ status: 'unsubscribed' }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    const abort = new AbortController();

    const resultPromise = surface.generateText('Generate', { signal: abort.signal });
    await vi.waitFor(() => expect(transport.sent.some((message) => (
      'method' in message && message.method === 'turn/start'
    ))).toBe(true));
    abort.abort();

    await expect(resultPromise).rejects.toThrow('aborted');
    expect(transport.sent).toContainEqual({
      id: expect.any(Number),
      method: 'turn/interrupt',
      params: { threadId: 'thread-aborted', turnId: 'turn-aborted' },
    });
    expect(transport.sent).toContainEqual({
      id: expect.any(Number),
      method: 'thread/unsubscribe',
      params: { threadId: 'thread-aborted' },
    });
  });

  it('deletes and rejects a thread when app-server does not honor ephemeral creation', async () => {
    const transport = new FakeTransport({
      'thread/start': () => resumeResponse({
        ...thread('thread-persisted', false),
        ephemeral: false,
      }),
      'thread/delete': () => ({}),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    await expect(surface.generateText('Generate')).rejects.toThrow('did not create an ephemeral');
    expect(transport.sent).toContainEqual({
      id: expect.any(Number),
      method: 'thread/delete',
      params: { threadId: 'thread-persisted' },
    });
    expect(transport.sent.some((message) => (
      'method' in message && message.method === 'turn/start'
    ))).toBe(false);
  });
});
