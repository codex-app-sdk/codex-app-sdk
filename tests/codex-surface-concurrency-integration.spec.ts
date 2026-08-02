import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import { FakeTransport, lastRequest, lastResponse, resumeResponse, thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it('keeps live runtime, approvals, client requests, and queued drains isolated per thread', async () => {
    let turnNumber = 0;
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
      'turn/start': (params) => ({
        turn: turn(`${(params as { threadId: string }).threadId}-turn-${++turnNumber}`, 'inProgress', []),
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await surface.sendMessage('A first');
    await surface.sendMessage('A queued');
    expect(surface.getSnapshot().queuedPrompts).toMatchObject([{ text: 'A queued' }]);

    await surface.selectConversation('thread-b');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', approvals: [] });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-a', turnId: 'thread-a-turn-1', itemId: 'agent-a', delta: 'Background A',
      },
    });
    transport.emit({
      id: 'ask-a',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-a', turnId: 'thread-a-turn-1', itemId: 'ask-a-item', autoResolutionMs: null,
        questions: [{ id: 'q', header: 'Q', question: 'Continue A?', isOther: false, isSecret: false, options: null }],
      },
    });
    transport.emit({
      id: 'approval-a',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-a', turnId: 'thread-a-turn-1', itemId: 'command-a',
        command: 'npm test', cwd: '/tmp/project', reason: null, environmentId: null,
        commandActions: [], networkApprovalContext: null, additionalPermissions: null,
        availableDecisions: ['accept', 'decline'], proposedExecpolicyAmendment: null,
      },
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', approvals: [] });
    expect(surface.getSnapshot().clientRequests).toStrictEqual([]);
    expect(surface.conversation('thread-a').getSnapshot().clientRequests).toMatchObject([{
      id: 'ask-a', kind: 'ask_user', conversationId: 'thread-a', turnId: 'thread-a-turn-1',
    }]);
    expect(lastResponse(transport, 'ask-a')).toBeUndefined();
    await surface.respondToClientRequest({ id: 'ask-a', payload: { answers: { q: { answers: ['yes'] } } } });
    expect(lastResponse(transport, 'ask-a')).toMatchObject({ result: { answers: { q: { answers: ['yes'] } } } });
    expect(surface.conversation('thread-a').getSnapshot().clientRequests).toStrictEqual([]);

    const resumeACount = () => transport.sent.filter((message) => (
      'method' in message
      && message.method === 'thread/resume'
      && 'params' in message
      && (message.params as { threadId?: string }).threadId === 'thread-a'
    )).length;
    expect(resumeACount()).toBe(1);
    await surface.selectConversation('thread-a');
    expect(resumeACount()).toBe(1);
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Background A' }),
      expect.objectContaining({ type: 'tool', id: 'ask-a-item', status: 'running' }),
    ]));
    expect(surface.getSnapshot().answeredClientRequestIds).toContain('ask-a');
    expect(surface.getSnapshot().approvals).toMatchObject([{ id: 'approval-a', conversationId: 'thread-a' }]);
    await surface.resolveApproval('approval-a', 'deny');

    await surface.selectConversation('thread-b');
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-a', turn: turn('thread-a-turn-1', 'completed', []) },
    });
    await vi.waitFor(() => expect(
      transport.sent.filter((message) => 'method' in message && message.method === 'turn/start'),
    ).toHaveLength(2));
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: { threadId: 'thread-a', input: [{ type: 'text', text: 'A queued' }] },
    });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', busy: false });

    await surface.selectConversation('thread-a');
    expect(resumeACount()).toBe(1);
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', busy: true });
    expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'A queued' }] }),
    ]));
  });

  it('hydrates an uncached background thread before projecting its live status', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-b', status: { type: 'active', activeFlags: [] } },
    });

    await surface.selectConversation('thread-b');
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/resume'
    ))).toHaveLength(2);
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-b',
      messages: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
    });
  });

  it('runs independent conversation handles concurrently and delivers background state and approvals', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => {
        const { threadId, cwd } = params as { threadId: string; cwd?: string };
        return { ...resumeResponse({ ...thread(threadId, true), cwd: cwd ?? '/tmp/project' }), cwd: cwd ?? '/tmp/project' };
      },
      'skills/list': (params) => {
        const cwd = (params as { cwds?: string[] }).cwds?.[0] ?? '/global';
        return {
          data: [{
            cwd,
            skills: [{
              name: `skill-${cwd}`, description: `Skill for ${cwd}`, path: `${cwd}/SKILL.md`,
              scope: 'repo', enabled: true, interface: null,
            }],
            errors: [],
          }],
        };
      },
      'turn/start': (params) => ({
        turn: turn(`turn-${(params as { threadId: string }).threadId}`, 'inProgress', []),
      }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
    });
    await surface.connect();
    const a = surface.conversation('thread-a');
    const b = surface.conversation('thread-b');
    const aListener = vi.fn();
    const bListener = vi.fn();
    a.onStateChange(aListener);
    b.onStateChange(bListener);

    await Promise.all([
      a.load({ cwd: '/workspace/a', extensionContext: { agent: 'a' } }),
      b.load({ cwd: '/workspace/b', extensionContext: { agent: 'b' } }),
    ]);
    await Promise.all([a.sendMessage('Run A'), b.sendMessage('Run B')]);

    expect(surface.getSnapshot().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-a', turnCount: 2 }),
      expect.objectContaining({ id: 'thread-b', turnCount: 2 }),
    ]));
    await surface.refreshConversations();
    expect(surface.getSnapshot().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-a', turnCount: 2 }),
      expect.objectContaining({ id: 'thread-b', turnCount: 2 }),
    ]));

    expect(surface.getSnapshot().activeConversationId).toBeNull();
    expect(a.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-a', activeTurnId: 'turn-thread-a', busy: true,
      skills: [{ name: 'skill-/workspace/a' }],
    });
    expect(b.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-b', activeTurnId: 'turn-thread-b', busy: true,
      skills: [{ name: 'skill-/workspace/b' }],
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({ params: { threadId: 'thread-b' } });

    await a.select();
    aListener.mockClear();
    bListener.mockClear();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-a', turnId: 'turn-thread-a', itemId: 'agent-a', delta: 'Foreground A',
      },
    });
    await vi.waitFor(() => expect(a.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Foreground A' }),
    ])));
    expect(aListener).toHaveBeenCalled();
    expect(bListener).not.toHaveBeenCalled();

    aListener.mockClear();
    bListener.mockClear();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-b', turnId: 'turn-thread-b', itemId: 'agent-b', delta: 'Background B',
      },
    });
    transport.emit({
      id: 'approval-b', method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-b', turnId: 'turn-thread-b', itemId: 'command-b', command: 'npm test',
        cwd: '/workspace/b', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null, availableDecisions: ['accept', 'decline'],
        proposedExecpolicyAmendment: null,
      },
    });
    await vi.waitFor(() => expect(b.getSnapshot().approvals).toMatchObject([{ id: 'approval-b' }]));
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', approvals: [] });
    expect(b.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Background B' }),
    ]));
    expect(bListener).toHaveBeenCalled();
    expect(aListener).not.toHaveBeenCalledWith(expect.objectContaining({ approvals: [expect.anything()] }));
    await expect(a.resolveApproval('approval-b', 'deny')).rejects.toThrow("belongs to conversation 'thread-b'");
    await surface.resolveApproval('approval-b', 'deny');
    expect(lastResponse(transport, 'approval-b')).toMatchObject({ result: { decision: 'decline' } });
  });

  it('applies product-neutral host extensions on start and resume and executes dynamic tools', async () => {
    const configureConversation = vi.fn((context: {
      operation: 'start' | 'resume';
      extensionContext?: unknown;
    }) => ({
      config: { extensionAgent: (context.extensionContext as { agent: string }).agent },
      developerInstructions: `extension-${context.operation}`,
    }));
    const execute = vi.fn(({ extensionContext, arguments: input }) => ({
      success: true,
      content: [{
        type: 'text' as const,
        text: `${(extensionContext as { agent: string }).agent}:${JSON.stringify(input)}`,
      }],
    }));
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-existing', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      extensions: [{
        configureConversation,
        dynamicTools: [{
          name: 'lookup_ticket',
          description: 'Look up one product ticket',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
          execute,
        }],
      }],
    });
    await surface.connect();
    await surface.createConversation({
      cwd: '/workspace/a', config: { explicit: true }, developerInstructions: 'host-start',
    }, { extensionContext: { agent: 'a' } });
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        cwd: '/workspace/a',
        config: { extensionAgent: 'a', explicit: true },
        developerInstructions: 'extension-start\n\nhost-start',
        dynamicTools: [{
          type: 'function', name: 'lookup_ticket', description: 'Look up one product ticket',
        }],
      },
    });

    await surface.conversation('thread-existing').load({
      cwd: '/workspace/b', extensionContext: { agent: 'b' },
    });
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({
      params: {
        threadId: 'thread-existing', cwd: '/workspace/b',
        config: { extensionAgent: 'b' }, developerInstructions: 'extension-resume',
      },
    });

    transport.emit({
      id: 'dynamic-b', method: 'item/tool/call',
      params: {
        threadId: 'thread-existing', turnId: 'turn-b', callId: 'call-b', namespace: null,
        tool: 'lookup_ticket', arguments: { id: 'SDK-42' },
      },
    });
    await vi.waitFor(() => expect(lastResponse(transport, 'dynamic-b')).toMatchObject({
      result: { success: true, contentItems: [{ type: 'inputText', text: 'b:{"id":"SDK-42"}' }] },
    }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'thread-existing', extensionContext: { agent: 'b' },
    }));
    expect(configureConversation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'resume', conversationId: 'thread-existing', cwd: '/workspace/b',
    }));
  });

  it('applies typed main-process MCP servers on conversation start and resume', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-existing', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      mcpServers: [{
        name: 'relay',
        transport: { type: 'http', url: 'http://127.0.0.1:8767/mcp' },
        toolApprovalMode: 'approve',
        required: true,
        enabledTools: ['get_shipments', 'update_shipment'],
        startupTimeoutMs: 12_500,
        toolTimeoutMs: 30_000,
      }],
    });
    await surface.connect();

    await surface.createConversation();
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        config: {
          'mcp_servers.relay': {
            url: 'http://127.0.0.1:8767/mcp',
            default_tools_approval_mode: 'approve',
            required: true,
            enabled_tools: ['get_shipments', 'update_shipment'],
            startup_timeout_sec: 12.5,
            tool_timeout_sec: 30,
          },
        },
      },
    });

    await surface.conversation('thread-existing').load();
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        config: {
          'mcp_servers.relay': expect.objectContaining({ url: 'http://127.0.0.1:8767/mcp' }),
        },
      },
    });
    expect(JSON.stringify(surface.getSnapshot())).not.toContain('127.0.0.1:8767');
  });

  it('supports stdio MCP definitions and per-conversation replacement or disabling', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-existing', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      mcpServers: [{ name: 'default_server', transport: { type: 'http', url: 'http://127.0.0.1:9000/mcp' } }],
    });
    await surface.connect();

    await surface.createConversation({}, {
      mcpServers: [{
        name: 'shipment_worker',
        transport: {
          type: 'stdio',
          command: '/usr/bin/node',
          args: ['/opt/relay/mcp.mjs'],
          cwd: '/opt/relay',
          env: { RELAY_MODE: 'test' },
          envVars: ['RELAY_TOKEN'],
        },
        toolApprovalMode: 'prompt',
      }],
    });
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        config: {
          'mcp_servers.shipment_worker': {
            command: '/usr/bin/node',
            args: ['/opt/relay/mcp.mjs'],
            cwd: '/opt/relay',
            env: { RELAY_MODE: 'test' },
            env_vars: ['RELAY_TOKEN'],
            default_tools_approval_mode: 'prompt',
          },
        },
      },
    });
    expect(lastRequest(transport, 'thread/start')).not.toMatchObject({
      params: { config: { 'mcp_servers.default_server': expect.anything() } },
    });

    await surface.conversation('thread-existing').load({ mcpServers: [] });
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({ params: { threadId: 'thread-existing' } });
    expect(lastRequest(transport, 'thread/resume')).not.toHaveProperty('params.config');
  });

  it('validates typed MCP definitions and raw-config collisions', async () => {
    const client = () => new CodexAppServerClient(new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
    }));
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{ name: 'bad.name', transport: { type: 'http', url: 'http://127.0.0.1/mcp' } }],
    })).toThrow('name must match');
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [
        { name: 'duplicate', transport: { type: 'http', url: 'http://127.0.0.1/a' } },
        { name: 'duplicate', transport: { type: 'http', url: 'http://127.0.0.1/b' } },
      ],
    })).toThrow("Duplicate Codex MCP server 'duplicate'");
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{ name: 'invalid_url', transport: { type: 'http', url: 'file:///tmp/mcp' } }],
    })).toThrow('URL must use HTTP or HTTPS');
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{
        name: 'invalid_cwd', transport: { type: 'stdio', command: 'node', cwd: 'relative' },
      }],
    })).toThrow('cwd must be an absolute path');
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{
        name: 'invalid_timeout', transport: { type: 'stdio', command: 'node' }, startupTimeoutMs: 0,
      }],
    })).toThrow('startup timeout must be a positive finite number');

    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: client(),
      mcpServers: [{ name: 'relay', transport: { type: 'http', url: 'http://127.0.0.1/mcp' } }],
    });
    await surface.connect();
    await expect(surface.createConversation({
      config: { 'mcp_servers.relay.url': 'http://127.0.0.1:9999/mcp' },
    })).rejects.toThrow("conflicts with its typed definition");
  });

});
