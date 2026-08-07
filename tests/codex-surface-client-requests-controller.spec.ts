import { describe, expect, it, vi } from 'vitest';
import {
  CodexSurfaceClientRequestsController,
  type CodexSurfaceClientRequestsHost,
} from '../packages/backend/src/node/codex-surface-client-requests-controller';
import { createThreadRuntime, initialSurfaceSnapshot } from '../packages/backend/src/node/codex-surface-runtime';
import { initialAuthentication } from '../packages/backend/src/node/codex-surface-authentication';

describe('CodexSurfaceClientRequestsController', () => {
  it('rejects empty prompts and resolves normalized ask-user answers', async () => {
    const setup = clientRequests();
    const responder = { resolve: vi.fn(), reject: vi.fn() };
    expect(setup.controller.handleToolInputRequest(askRequest([]), responder as never)).toBe(false);

    expect(setup.controller.handleToolInputRequest(askRequest([{
      id: 'target', header: 'Target', question: 'Which file?', isOther: true, isSecret: false,
      options: [{ label: 'README.md', description: 'Read it' }],
    }]), responder as never)).toBe(true);
    expect(setup.controller.requestsForThread('thread-1')).toMatchObject([{
      id: 'ask-1', kind: 'ask_user', payload: { request: { autoResolutionMs: 60_000 } },
    }]);
    await expect(setup.controller.respond('other', { id: 'ask-1' })).rejects.toThrow("belongs to conversation 'thread-1'");
    await setup.controller.respond('thread-1', {
      id: 'ask-1', payload: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(responder.resolve).toHaveBeenCalledWith({ answers: { target: { answers: ['README.md'] } } });
    expect(setup.runtime.answeredClientRequestIds).toStrictEqual(['ask-1']);
    expect(setup.controller.requestsForThread('thread-1')).toStrictEqual([]);
  });

  it('recognizes only Codex MCP approvals and validates decisions', async () => {
    const setup = clientRequests();
    const responder = { resolve: vi.fn(), reject: vi.fn() };
    expect(setup.controller.handleMcpElicitationRequest(mcpRequest({ mode: 'url' }), responder as never)).toBe(false);
    expect(setup.controller.handleMcpElicitationRequest(mcpRequest(), responder as never)).toBe(true);
    expect(setup.controller.requestsForThread('thread-1')).toMatchObject([{
      id: 'mcp-1', kind: 'confirm_tool',
      payload: { confirmation: { allowConversation: true, allowAlways: true, toolName: 'create_event' } },
    }]);
    await expect(setup.controller.respond(undefined, {
      id: 'mcp-1', payload: { decision: 'invalid' as never },
    })).rejects.toThrow("Invalid tool confirmation decision 'invalid'");
    await setup.controller.respond(undefined, { id: 'mcp-1', payload: { decision: 'always_allow' } });
    expect(responder.resolve).toHaveBeenCalledWith({ action: 'accept', content: null, _meta: { persist: 'always' } });
  });

  it('rejects cleared requests and records server-side resolution', () => {
    const setup = clientRequests();
    const rejected = { resolve: vi.fn(), reject: vi.fn() };
    setup.controller.handleToolInputRequest(askRequest([{ id: 'q', header: 'Q', question: 'Q?' }]), rejected as never);
    setup.controller.clearForThread('thread-1', 'closed', 'conversation_closed');
    expect(rejected.reject).toHaveBeenCalledWith('closed');
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'clientRequest.resolved', payload: expect.objectContaining({ reason: 'conversation_closed' }),
    }));

    const resolved = { resolve: vi.fn(), reject: vi.fn() };
    setup.runtime.activeTurnId = null;
    setup.controller.handleToolInputRequest(askRequest([{ id: 'q', header: 'Q', question: 'Q?' }]), resolved as never);
    setup.runtime.activeTurnId = null;
    setup.controller.handleServerResolved('ask-1', 'thread-1');
    expect(setup.runtime.answeredClientRequestIds).toStrictEqual(['ask-1']);
    expect(setup.runtime.busy).toBe(false);
  });
});

function clientRequests() {
  const runtime = createThreadRuntime('thread-1', initialSurfaceSnapshot(initialAuthentication()));
  const host: CodexSurfaceClientRequestsHost = {
    emitConversationActivity: vi.fn(),
    emitEvent: vi.fn(),
    hasPendingApproval: () => false,
    markRuntimeTurnActive: vi.fn((target, turnId) => {
      target.activeTurnId = turnId;
      target.busy = true;
    }),
    messageContainingTool: (_threadId, turnId, itemId) => runtime.messages.find((message) => (
      message.metadata?.turnId === turnId
      && message.parts.some((part) => part.type === 'tool' && part.id === itemId)
    )) ?? null,
    patchRuntime: vi.fn((_threadId, patch) => Object.assign(runtime, patch)),
    requireRuntime: () => runtime,
  };
  return { controller: new CodexSurfaceClientRequestsController(host), host, runtime };
}

function askRequest(questions: unknown[]) {
  return {
    id: 'ask-1', method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'ask-item', autoResolutionMs: 60_000, questions,
    },
  } as never;
}

function mcpRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mcp-1', method: 'mcpServer/elicitation/request',
    params: {
      threadId: 'thread-1', turnId: null, serverName: 'calendar', mode: 'form',
      message: '', requestedSchema: { type: 'object', properties: {} },
      _meta: {
        codex_approval_kind: 'mcp_tool_call', tool_name: 'create_event', connector_name: 'Calendar',
        tool_params: { title: 'Planning' }, persist: ['session', 'always'],
      },
      ...overrides,
    },
  } as never;
}
