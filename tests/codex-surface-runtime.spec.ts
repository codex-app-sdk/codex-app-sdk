import { describe, expect, it } from 'vitest';
import type { CodexSurfaceAuthentication } from '../src/surface';
import {
  createThreadRuntime,
  initialSurfaceSnapshot,
  runtimeProjection,
} from '../src/node/codex-surface-runtime';

const authentication: CodexSurfaceAuthentication = {
  status: 'notLoaded',
  account: null,
  requiresOpenaiAuth: null,
  error: null,
  login: { status: 'idle', loginId: null, authUrl: null, error: null },
};

describe('Codex surface runtime state', () => {
  it('creates the complete idle surface state', () => {
    const state = initialSurfaceSnapshot(authentication);
    expect(state).toMatchObject({
      status: 'idle',
      authentication,
      conversations: [],
      activeConversationId: null,
      modelCatalogStatus: 'notLoaded',
      skillCatalogStatus: 'notLoaded',
      pluginCatalogStatus: 'notLoaded',
      approvalPreset: null,
      planMode: false,
      busy: false,
      historyLoading: false,
      error: null,
    });
  });

  it('inherits catalog defaults into a new isolated thread runtime', () => {
    const state = initialSurfaceSnapshot(authentication);
    state.approvalPreset = 'approve-for-me';
    state.approvalPresets = ['ask-for-approval', 'approve-for-me'];
    state.permissionProfiles = [{ id: ':workspace', description: null, allowed: true }];
    state.skills = [{ name: 'review', path: '/skills/review/SKILL.md', enabled: true }];
    state.skillCatalogStatus = 'loaded';
    state.selectedModelId = 'model-1';
    state.selectedReasoningEffort = 'high';

    const runtime = createThreadRuntime('thread-1', state, { cwd: '/workspace', busy: true });
    expect(runtime).toMatchObject({
      threadId: 'thread-1', cwd: '/workspace', busy: true,
      approvalPreset: 'approve-for-me', skillCatalogStatus: 'loaded',
      selectedModelId: 'model-1', selectedReasoningEffort: 'high',
    });
    expect(runtime.approvalPresets).not.toBe(state.approvalPresets);
    expect(runtime.permissionProfiles).not.toBe(state.permissionProfiles);
    expect(runtime.skills).not.toBe(state.skills);
    expect(runtime.planMarkdownByTurn).toBeInstanceOf(Map);
  });

  it('projects conversation-owned state with pending approvals and client requests', () => {
    const runtime = createThreadRuntime('thread-1', initialSurfaceSnapshot(authentication), {
      messages: [{ id: 'assistant', role: 'assistant', status: 'streaming', parts: [] }],
      answeredClientRequestIds: ['answered'],
      planMode: true,
      busy: true,
      historyLoading: true,
      error: 'waiting',
    });
    const approvals = [{
      id: 'approval-1', kind: 'command' as const, conversationId: 'thread-1',
      itemId: 'item-1', title: 'Run tests',
    }];
    const clientRequests = [{
      id: 'request-1', kind: 'ask_user' as const, conversationId: 'thread-1',
      turnId: 'turn-1', itemId: 'item-1',
      payload: { request: { itemId: 'item-1', questions: [] } },
    }];

    expect(runtimeProjection(runtime, approvals, clientRequests)).toMatchObject({
      approvals,
      clientRequests,
      messages: runtime.messages,
      answeredClientRequestIds: ['answered'],
      planMode: true,
      busy: true,
      historyLoading: true,
      error: 'waiting',
    });
  });
});
