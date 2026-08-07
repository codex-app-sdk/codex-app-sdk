import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import type { CodexSurfaceSnapshot } from '@codex-app-sdk/core/surface';
import {
  CodexSurfaceApprovalsController,
  type CodexSurfaceApprovalsHost,
} from '../src/node/codex-surface-approvals-controller';
import { createThreadRuntime, initialSurfaceSnapshot } from '../src/node/codex-surface-runtime';
import { initialAuthentication } from '../src/node/codex-surface-authentication';
import { FakeCodexTransport } from './helpers/fake-codex-transport';

describe('CodexSurfaceApprovalsController', () => {
  it('surfaces, validates, and resolves an app-server approval', async () => {
    const setup = approvals();
    await setup.client.start();
    setup.transport.emit(commandApproval('approval-1'));
    await vi.waitFor(() => expect(setup.controller.approvalsForThread('thread-1')).toHaveLength(1));
    expect(setup.runtime.busy).toBe(true);
    expect(setup.host.patchConversationStatus).toHaveBeenCalledWith('thread-1', 'active');

    await expect(setup.controller.resolve('other', 'approval-1', 'approve', 'once'))
      .rejects.toThrow("belongs to conversation 'thread-1'");
    await expect(setup.controller.resolve(undefined, 'approval-1', 'approve', 'session'))
      .rejects.toThrow("approve:session' is not available");
    await setup.controller.resolve(undefined, 'approval-1', 'approve', 'once');
    expect(setup.transport.sent).toContainEqual(expect.objectContaining({
      id: 'approval-1', result: { decision: 'accept' },
    }));
    expect(setup.controller.approvalsForThread('thread-1')).toStrictEqual([]);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('action', expect.objectContaining({
      type: 'approval.resolved', payload: expect.objectContaining({ reason: 'host' }),
    }));
    setup.controller.close();
  });

  it('denies approvals when a conversation closes and observes server resolution', async () => {
    const setup = approvals();
    await setup.client.start();
    setup.transport.emit(commandApproval('approval-close'));
    await vi.waitFor(() => expect(setup.controller.hasForThread('thread-1')).toBe(true));
    setup.controller.clearForThread('thread-1', 'conversation_closed');
    expect(setup.transport.sent).toContainEqual(expect.objectContaining({
      id: 'approval-close', result: { decision: 'decline' },
    }));

    setup.transport.emit(commandApproval('approval-server'));
    await vi.waitFor(() => expect(setup.controller.hasForThread('thread-1')).toBe(true));
    setup.controller.handleServerResolved('approval-server');
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'approval.resolved', payload: expect.objectContaining({ reason: 'server' }),
    }));
    setup.controller.close();
  });
});

function approvals() {
  const transport = new FakeCodexTransport();
  const client = new CodexAppServerClient(transport);
  const state = initialSurfaceSnapshot(initialAuthentication());
  state.activeConversationId = 'thread-1';
  const runtime = createThreadRuntime('thread-1', state);
  const host: CodexSurfaceApprovalsHost = {
    activeConversationId: () => state.activeConversationId,
    createRuntime: () => runtime,
    emitConversationActivity: vi.fn(),
    emitEvent: vi.fn(),
    markRuntimeTurnActive: vi.fn((target, turnId) => {
      target.activeTurnId = turnId;
      target.busy = true;
    }),
    maybeClearWaitingBusy: vi.fn(),
    patch: vi.fn((patch: Partial<CodexSurfaceSnapshot>) => Object.assign(state, patch)),
    patchConversationStatus: vi.fn(),
    patchRuntime: vi.fn((_threadId, patch) => Object.assign(runtime, patch)),
    requireRuntime: () => runtime,
  };
  return {
    controller: new CodexSurfaceApprovalsController(client, host),
    client, host, runtime, state, transport,
  };
}

function commandApproval(id: string) {
  return {
    id,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', startedAtMs: 1,
      command: 'npm test', cwd: '/workspace', reason: 'Run tests', environmentId: null,
      networkApprovalContext: null, additionalPermissions: null,
      availableDecisions: ['accept', 'decline'],
    },
  };
}
