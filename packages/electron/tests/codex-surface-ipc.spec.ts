import { describe, expect, it, vi } from 'vitest';
import {
  createCodexSurfaceRendererApi,
  registerCodexSurfaceIpc,
  type IpcMainPort,
  type IpcRendererPort,
} from '../src';
import type { CodexSurfaceEvent, CodexSurfaceSnapshot } from '@codex-app-sdk/core/surface';

const snapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  authentication: {
    status: 'loaded',
    account: { type: 'chatgpt', email: 'test@example.test', planType: 'pro' },
    requiresOpenaiAuth: true,
    error: null,
    login: { status: 'idle', loginId: null, authUrl: null, error: null },
  },
  conversations: [],
  activeConversationId: null,
  messages: [],
  clientRequests: [],
  answeredClientRequestIds: [],
  approvals: [],
  models: [],
  modelCatalogStatus: 'loaded',
  skills: [],
  skillCatalogStatus: 'loaded',
  plugins: [],
  pluginCatalogStatus: 'loaded',
  permissionProfiles: [],
  approvalPresets: [],
  approvalPreset: null,
  selectedModelId: null,
  selectedReasoningEffort: null,
  planMode: false,
  contextUsage: null,
  goal: null,
  turnGitDiff: null,
  threadStatus: null,
  rateLimits: null,
  queuedPrompts: [],
  busy: false,
  historyLoading: false,
  error: null,
};

const history = {
  conversationId: 'thread-1',
  messages: [],
  threadStatus: null,
  hasOlder: false,
};

const promptHistory = {
  conversationId: 'thread-1',
  prompts: ['First prompt', 'Second prompt'],
};

const surfaceEvent: CodexSurfaceEvent = {
  seq: 1,
  occurredAt: '2026-07-18T12:00:00.000Z',
  origin: 'lifecycle',
  type: 'surface.statusChanged',
  payload: { status: 'ready', error: null },
};

describe('Codex surface Electron bridge', () => {
  it('registers the complete main-process surface and forwards state changes', async () => {
    const main = new FakeMainPort();
    const sender = { send: vi.fn() };
    let stateListener: ((value: CodexSurfaceSnapshot) => void) | undefined;
    let eventListener: ((value: CodexSurfaceEvent) => void) | undefined;
    const unsubscribeState = vi.fn();
    const unsubscribeEvents = vi.fn();
    const resolveAttachment = vi.fn(async (attachment: { type: 'file' | 'image'; reference: string }) => {
      if (attachment.reference === 'attachment:screenshot') {
        return { type: 'image' as const, path: '/tmp/screenshot.png', name: 'screenshot.png', mimeType: 'image/png' };
      }
      if (attachment.reference === 'attachment:notes') {
        return { type: 'file' as const, path: '/tmp/notes.md', name: 'Notes', mimeType: 'text/markdown' };
      }
      throw new TypeError('Attachment reference is invalid or expired');
    });
    const surface = {
      archiveConversation: vi.fn(async () => snapshot),
      cancelLogin: vi.fn(async () => snapshot),
      clearGoal: vi.fn(async () => snapshot),
      compactConversation: vi.fn(async () => snapshot),
      connect: vi.fn(async () => snapshot),
      createConversation: vi.fn(async () => snapshot),
      deleteConversation: vi.fn(async () => snapshot),
      deleteMessage: vi.fn(async () => snapshot),
      deleteQueuedPrompt: vi.fn(async () => snapshot),
      editMessage: vi.fn(async () => snapshot),
      forkMessage: vi.fn(async () => snapshot),
      getSnapshot: vi.fn(() => snapshot),
      interrupt: vi.fn(async () => snapshot),
      listConversations: vi.fn(async () => []),
      listModels: vi.fn(async () => []),
      loadOlderConversationHistory: vi.fn(async () => history),
      logout: vi.fn(async () => snapshot),
      readConversationHistory: vi.fn(async () => history),
      readConversationPromptHistory: vi.fn(async () => promptHistory),
      refreshAccount: vi.fn(async () => snapshot),
      refreshConversations: vi.fn(async () => snapshot),
      renameConversation: vi.fn(async () => snapshot),
      respondToClientRequest: vi.fn(async () => snapshot),
      resolveApproval: vi.fn(async () => snapshot),
      retryMessage: vi.fn(async () => snapshot),
      setGoal: vi.fn(async () => snapshot),
      selectConversation: vi.fn(async () => snapshot),
      sendMessage: vi.fn(async () => snapshot),
      startReview: vi.fn(async () => snapshot),
      startChatGptLogin: vi.fn(async () => ({
        loginId: 'login-1', authUrl: 'https://auth.example.test/login',
      })),
      steerMessage: vi.fn(async () => snapshot),
      steerQueuedPrompt: vi.fn(async () => snapshot),
      unarchiveConversation: vi.fn(async () => snapshot),
      updateConversationSettings: vi.fn(async () => snapshot),
      updateQueuedPrompt: vi.fn(async () => snapshot),
      onStateChange: vi.fn((listener: (value: CodexSurfaceSnapshot) => void) => {
        stateListener = listener;
        return unsubscribeState;
      }),
      onEvent: vi.fn((listener: (value: CodexSurfaceEvent) => void) => {
        eventListener = listener;
        return unsubscribeEvents;
      }),
    };

    const dispose = registerCodexSurfaceIpc(main, sender, surface, { resolveAttachment });
    expect([...main.handlers.keys()].sort()).toStrictEqual([
      'codex-surface:archive-conversation',
      'codex-surface:cancel-login',
      'codex-surface:clear-goal',
      'codex-surface:compact-conversation',
      'codex-surface:connect',
      'codex-surface:create-conversation',
      'codex-surface:delete-conversation',
      'codex-surface:delete-message',
      'codex-surface:delete-queued-prompt',
      'codex-surface:edit-message',
      'codex-surface:fork-message',
      'codex-surface:get-snapshot',
      'codex-surface:interrupt',
      'codex-surface:list-conversations',
      'codex-surface:list-models',
      'codex-surface:load-older-conversation-history',
      'codex-surface:logout',
      'codex-surface:read-conversation-history',
      'codex-surface:read-conversation-prompt-history',
      'codex-surface:refresh-account',
      'codex-surface:refresh-conversations',
      'codex-surface:rename-conversation',
      'codex-surface:resolve-approval',
      'codex-surface:respond-to-client-request',
      'codex-surface:retry-message',
      'codex-surface:select-conversation',
      'codex-surface:send-message',
      'codex-surface:set-goal',
      'codex-surface:start-chatgpt-login',
      'codex-surface:start-review',
      'codex-surface:steer-message',
      'codex-surface:steer-queued-prompt',
      'codex-surface:unarchive-conversation',
      'codex-surface:update-conversation-settings',
      'codex-surface:update-queued-prompt',
    ]);
    await expect(main.call('codex-surface:archive-conversation', 'thread-archive')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:cancel-login', 'login-1')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:cancel-login')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:clear-goal')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:compact-conversation')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:connect')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:load-older-conversation-history', 'thread-1')).resolves.toBe(history);
    await expect(main.call('codex-surface:logout')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:refresh-account')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-chatgpt-login')).resolves.toStrictEqual({
      loginId: 'login-1', authUrl: 'https://auth.example.test/login',
    });
    await expect(main.call('codex-surface:create-conversation', {
      model: 'gpt-5',
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:create-conversation', { cwd: '/' })).rejects.toThrow(
      'Conversation options contains unsupported property "cwd"',
    );
    await expect(main.call('codex-surface:create-conversation', {
      mcpServers: [{ name: 'renderer', transport: { type: 'http', url: 'http://127.0.0.1/mcp' } }],
    })).rejects.toThrow('Conversation options contains unsupported property "mcpServers"');
    await expect(main.call('codex-surface:create-conversation')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:create-conversation', {
      reasoningEffort: 'high', approvalPreset: 'approve-for-me',
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:delete-conversation', 'thread-delete')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:delete-message', 2)).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:delete-queued-prompt', 'queued-1')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:edit-message', 1, 'Replacement')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:fork-message', 4)).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:create-conversation', 'unsafe')).rejects.toThrow(
      'Conversation options must be an object',
    );
    await expect(main.call('codex-surface:create-conversation', new Date())).rejects.toThrow(
      'Conversation options must be a plain object',
    );
    await expect(main.call('codex-surface:create-conversation', { model: 42 })).rejects.toThrow(
      'Conversation model must be a non-empty string',
    );
    await expect(main.call('codex-surface:create-conversation', { model: '   ' })).rejects.toThrow(
      'Conversation model must be a non-empty string',
    );
    await expect(main.call('codex-surface:create-conversation', { approvalPreset: 'unsafe' })).rejects.toThrow(
      'Conversation approval preset is invalid',
    );
    await expect(main.call('codex-surface:delete-message', -1)).rejects.toThrow(
      'Message index must be a non-negative integer',
    );
    await expect(main.call('codex-surface:delete-message', 1.5)).rejects.toThrow(
      'Message index must be a non-negative integer',
    );
    await expect(main.call('codex-surface:delete-message', '1')).rejects.toThrow(
      'Message index must be a non-negative integer',
    );
    await expect(main.call('codex-surface:fork-message', -1)).rejects.toThrow(
      'Message index must be a non-negative integer',
    );
    await expect(main.call('codex-surface:archive-conversation', '   ')).rejects.toThrow(
      'Conversation id must be a non-empty string',
    );
    await expect(main.call('codex-surface:delete-conversation', '')).rejects.toThrow(
      'Conversation id must be a non-empty string',
    );
    await expect(main.call('codex-surface:get-snapshot')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:interrupt')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:list-conversations', {
      cwd: ['/tmp/a', '/tmp/b'], limit: 20, archived: false, searchTerm: 'SDK',
    })).resolves.toStrictEqual([]);
    await expect(main.call('codex-surface:list-models', {
      includeHidden: true, forceReload: true,
    })).resolves.toStrictEqual([]);
    await expect(main.call('codex-surface:list-models', { includeHidden: 'yes' })).rejects.toThrow(
      'Model list includeHidden must be a boolean',
    );
    await expect(main.call('codex-surface:list-conversations', { limit: -1 })).rejects.toThrow(
      'Conversation list limit must be a non-negative integer',
    );
    await expect(main.call('codex-surface:list-conversations', { cwd: [''] })).rejects.toThrow(
      'Conversation list cwd must be a non-empty string',
    );
    await expect(main.call('codex-surface:read-conversation-history', 'thread-1')).resolves.toBe(history);
    await expect(main.call('codex-surface:read-conversation-history')).resolves.toBe(history);
    await expect(main.call('codex-surface:read-conversation-prompt-history', 'thread-1')).resolves.toBe(promptHistory);
    await expect(main.call('codex-surface:read-conversation-prompt-history')).resolves.toBe(promptHistory);
    await expect(main.call('codex-surface:refresh-conversations')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:rename-conversation', 'SDK parity')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-1', payload: { answers: { target: { answers: ['README.md'] } } },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', { id: 'question-2' })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-3', payload: { answers: {}, cancelled: true, decision: null },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { cancelled: false, decision: 'allow' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-5', payload: { decision: 'allow_conversation' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-6', payload: { decision: 'always_allow' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-7', payload: { decision: 'deny' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:respond-to-client-request', null)).rejects.toThrow(
      'Client request response must be an object',
    );
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-symbol', [Symbol('unsafe')]: true,
    })).rejects.toThrow('Client request response must not contain symbol properties');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-extra', extra: true,
    })).rejects.toThrow('Client request response contains unsupported property "extra"');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: [],
    })).rejects.toThrow('Client request response payload must be an object');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { decision: 'maybe' },
    })).rejects.toThrow('Client request decision is invalid');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { cancelled: 'yes' },
    })).rejects.toThrow('Client request cancelled flag must be a boolean');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { answers: [] },
    })).rejects.toThrow('Client request answers must be an object');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { answers: { target: { answers: [42] } } },
    })).rejects.toThrow('Client request answer values must be an array of strings');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { answers: { '': { answers: [] } } },
    })).rejects.toThrow('Client request question id must be non-empty');
    await expect(main.call('codex-surface:respond-to-client-request', {
      id: 'question-4', payload: { answers: { target: { answers: [], extra: true } } },
    })).rejects.toThrow('Client request answer contains unsupported property "extra"');
    await expect(main.call('codex-surface:resolve-approval', 'approval-1', 'approve', 'session')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:resolve-approval', 'approval-2', 'deny')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:resolve-approval', 'approval-1', 'invalid', 'session')).rejects.toThrow(
      'Approval decision is invalid',
    );
    await expect(main.call('codex-surface:resolve-approval', 'approval-1', 'approve', 'forever')).rejects.toThrow(
      'Approval scope is invalid',
    );
    await expect(main.call('codex-surface:resolve-approval', '', 'approve')).rejects.toThrow(
      'Approval id must be a non-empty string',
    );
    await expect(main.call('codex-surface:set-goal', 'Ship the SDK', 1000)).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:set-goal', 'Ship the SDK')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:set-goal', 'Ship the SDK', null)).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:set-goal', 'Ship the SDK', 0)).rejects.toThrow(
      'Goal token budget must be a positive number or null',
    );
    await expect(main.call('codex-surface:set-goal', 'Ship the SDK', Number.POSITIVE_INFINITY)).rejects.toThrow(
      'Goal token budget must be a positive number or null',
    );
    await expect(main.call('codex-surface:set-goal', 'Ship the SDK', '1000')).rejects.toThrow(
      'Goal token budget must be a positive number or null',
    );
    await expect(main.call('codex-surface:retry-message', 3)).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:select-conversation', 'thread-1')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Hello', {
      model: 'gpt-5',
      planMode: true,
      skills: [{ name: 'review', path: '/skills/review/SKILL.md' }],
      outputSchema: { type: 'object', required: ['result'] },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Without options')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Empty options', {})).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Reason deeply', {
      reasoningEffort: 'high',
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'JSON values', {
      outputSchema: { nullable: null, enabled: true, count: 2, nested: ['value'] },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Attachments', {
      attachments: [
        {
          type: 'image',
          reference: 'attachment:screenshot',
          detail: 'original',
        },
        { type: 'file', reference: 'attachment:notes' },
      ],
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Attachments', {
      attachments: [{ type: 'image', reference: 'attachment:screenshot', detail: 'huge' }],
    })).rejects.toThrow('Message image detail is invalid');
    await expect(main.call('codex-surface:send-message', 'Attachments', {
      attachments: [{ type: 'unknown', reference: 'attachment:file' }],
    })).rejects.toThrow('Message attachment type is invalid');
    await expect(main.call('codex-surface:send-message', 'Attachments', {
      attachments: [{ type: 'image', path: '/tmp/screenshot.png' }],
    })).rejects.toThrow('Message attachment contains unsupported property "path"');
    await expect(main.call('codex-surface:send-message', 'Attachments', {
      attachments: [{ type: 'file', reference: 'attachment:missing' }],
    })).rejects.toThrow('Attachment reference is invalid or expired');
    await expect(main.call('codex-surface:send-message', 'Hello', { cwd: '/' })).rejects.toThrow(
      'Message options contains unsupported property "cwd"',
    );
    await expect(main.call('codex-surface:send-message', 'Hello', {
      skills: [{ name: 'review', path: 1 }],
    })).rejects.toThrow('Message skill path must be a non-empty string');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      skills: 'review',
    })).rejects.toThrow('Message skills must be an array');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      planMode: 'yes',
    })).rejects.toThrow('Message plan mode must be a boolean');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: { invalid: BigInt(1) },
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: new Date(),
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: new Map([['type', 'object']]),
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: { [Symbol('unsafe')]: true },
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: Array(1),
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    const cyclicOutputSchema: Record<string, unknown> = {};
    cyclicOutputSchema.self = cyclicOutputSchema;
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: cyclicOutputSchema,
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    const hiddenOutputSchema = Object.defineProperty({}, 'hidden', { value: true });
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: hiddenOutputSchema,
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: Object.assign([true], { extra: false }),
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', 'Hello', {
      outputSchema: Number.NaN,
    })).rejects.toThrow('Message output schema must be JSON-serializable');
    await expect(main.call('codex-surface:send-message', '   ')).rejects.toThrow(
      'Message prompt must be a non-empty string',
    );
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'baseBranch', branch: 'main' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {})).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'uncommittedChanges' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'commit', sha: 'abc123' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'commit', sha: 'abc123', title: null },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'commit', sha: 'abc123', title: 'Parity review' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'custom', instructions: 'Review IPC boundaries' },
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'commit', sha: 'abc123', title: 42 },
    })).rejects.toThrow('Review commit title must be a string or null');
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'unknown' },
    })).rejects.toThrow('Review target type is invalid');
    await expect(main.call('codex-surface:start-review', {
      target: { type: 'custom', instructions: '' },
    })).rejects.toThrow('Review instructions must be a non-empty string');
    await expect(main.call('codex-surface:steer-message', 'More detail', {
      attachments: [{ type: 'file', reference: 'attachment:notes' }],
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:steer-queued-prompt', 'queued-2', 'Edited steer')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:unarchive-conversation', 'thread-unarchive')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:unarchive-conversation', '   ')).rejects.toThrow(
      'Conversation id must be a non-empty string',
    );
    await expect(main.call('codex-surface:update-conversation-settings', {
      modelId: 'gpt-5', reasoningEffort: 'high', approvalPreset: 'full-access', planMode: true,
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:update-conversation-settings', {})).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:update-conversation-settings', null)).rejects.toThrow(
      'Conversation settings must be an object',
    );
    await expect(main.call('codex-surface:update-conversation-settings', { approvalPreset: 'unsafe' })).rejects.toThrow(
      'Conversation approval preset is invalid',
    );
    await expect(main.call('codex-surface:update-conversation-settings', { planMode: 'yes' })).rejects.toThrow(
      'Conversation plan mode must be a boolean',
    );
    await expect(main.call('codex-surface:update-queued-prompt', 'queued-1', 'Edited queue')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:connect', 'unexpected')).rejects.toThrow(
      'codex-surface:connect received an invalid number of arguments',
    );
    await expect(main.call('codex-surface:start-chatgpt-login', 'unexpected')).rejects.toThrow(
      'codex-surface:start-chatgpt-login received an invalid number of arguments',
    );
    await expect(main.call('codex-surface:send-message')).rejects.toThrow(
      'codex-surface:send-message received an invalid number of arguments',
    );
    await expect(main.call('codex-surface:archive-conversation')).rejects.toThrow(
      'codex-surface:archive-conversation received an invalid number of arguments',
    );
    await expect(main.call('codex-surface:delete-conversation', 'thread-1', 'unexpected')).rejects.toThrow(
      'codex-surface:delete-conversation received an invalid number of arguments',
    );
    await expect(main.call('codex-surface:unarchive-conversation')).rejects.toThrow(
      'codex-surface:unarchive-conversation received an invalid number of arguments',
    );
    stateListener?.(snapshot);
    expect(surface.archiveConversation).toHaveBeenCalledWith('thread-archive');
    expect(surface.cancelLogin).toHaveBeenNthCalledWith(1, 'login-1');
    expect(surface.cancelLogin).toHaveBeenNthCalledWith(2, undefined);
    expect(surface.connect).toHaveBeenCalledOnce();
    expect(surface.clearGoal).toHaveBeenCalledOnce();
    expect(surface.createConversation).toHaveBeenNthCalledWith(1, {
      model: 'gpt-5',
    });
    expect(surface.createConversation).toHaveBeenNthCalledWith(2, undefined);
    expect(surface.deleteConversation).toHaveBeenCalledWith('thread-delete');
    expect(surface.deleteMessage).toHaveBeenCalledWith(2);
    expect(surface.deleteQueuedPrompt).toHaveBeenCalledWith('queued-1');
    expect(surface.editMessage).toHaveBeenCalledWith(1, 'Replacement');
    expect(surface.forkMessage).toHaveBeenCalledWith(4);
    expect(surface.getSnapshot).toHaveBeenCalledOnce();
    expect(surface.interrupt).toHaveBeenCalledOnce();
    expect(surface.listConversations).toHaveBeenCalledWith({
      cwd: ['/tmp/a', '/tmp/b'], limit: 20, archived: false, searchTerm: 'SDK',
    });
    expect(surface.logout).toHaveBeenCalledOnce();
    expect(surface.refreshAccount).toHaveBeenCalledOnce();
    expect(surface.startChatGptLogin).toHaveBeenCalledOnce();
    expect(surface.readConversationHistory).toHaveBeenNthCalledWith(1, 'thread-1');
    expect(surface.readConversationHistory).toHaveBeenNthCalledWith(2, undefined);
    expect(surface.readConversationPromptHistory).toHaveBeenNthCalledWith(1, 'thread-1');
    expect(surface.readConversationPromptHistory).toHaveBeenNthCalledWith(2, undefined);
    expect(surface.refreshConversations).toHaveBeenCalledOnce();
    expect(surface.renameConversation).toHaveBeenCalledWith('SDK parity');
    expect(surface.respondToClientRequest).toHaveBeenCalledWith({
      id: 'question-1', payload: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(surface.resolveApproval).toHaveBeenCalledWith('approval-1', 'approve', 'session');
    expect(surface.resolveApproval).toHaveBeenCalledTimes(2);
    expect(surface.setGoal).toHaveBeenCalledWith('Ship the SDK', 1000);
    expect(surface.retryMessage).toHaveBeenCalledWith(3);
    expect(surface.selectConversation).toHaveBeenCalledWith('thread-1');
    expect(surface.sendMessage).toHaveBeenCalledWith('Hello', {
      model: 'gpt-5',
      planMode: true,
      skills: [{ name: 'review', path: '/skills/review/SKILL.md' }],
      outputSchema: { type: 'object', required: ['result'] },
    });
    expect(surface.sendMessage).toHaveBeenCalledWith('Attachments', {
      attachments: [
        {
          type: 'image',
          path: '/tmp/screenshot.png',
          detail: 'original',
          name: 'screenshot.png',
          mimeType: 'image/png',
        },
        { type: 'file', path: '/tmp/notes.md', name: 'Notes', mimeType: 'text/markdown' },
      ],
    });
    expect(surface.startReview).toHaveBeenCalledWith({ target: { type: 'baseBranch', branch: 'main' } });
    expect(surface.steerMessage).toHaveBeenCalledWith('More detail', {
      attachments: [{
        type: 'file', path: '/tmp/notes.md', name: 'Notes', mimeType: 'text/markdown',
      }],
    });
    expect(surface.steerQueuedPrompt).toHaveBeenCalledWith('queued-2', 'Edited steer');
    expect(surface.unarchiveConversation).toHaveBeenCalledWith('thread-unarchive');
    expect(surface.updateConversationSettings).toHaveBeenCalledWith({
      modelId: 'gpt-5', reasoningEffort: 'high', approvalPreset: 'full-access', planMode: true,
    });
    expect(surface.updateQueuedPrompt).toHaveBeenCalledWith('queued-1', 'Edited queue');
    stateListener?.(snapshot);
    eventListener?.(surfaceEvent);
    expect(sender.send).toHaveBeenCalledWith('codex-surface:state-changed', snapshot);
    expect(sender.send).toHaveBeenCalledWith('codex-surface:event', surfaceEvent);
    dispose();
    expect(unsubscribeEvents).toHaveBeenCalledOnce();
    expect(unsubscribeState).toHaveBeenCalledOnce();
    expect(main.handlers.size).toBe(0);
  });

  it('provides a renderer API with no raw channel or protocol knowledge', async () => {
    const renderer = new FakeRendererPort();
    const api = createCodexSurfaceRendererApi(renderer);
    const listener = vi.fn();
    const eventListener = vi.fn();
    const unsubscribe = api.onStateChange(listener);
    const unsubscribeEvent = api.onEvent(eventListener);

    await api.archiveConversation('thread-archive');
    await api.cancelLogin('login-1');
    await api.connect();
    await api.clearGoal();
    await api.compactConversation();
    await api.createConversation({ model: 'gpt-5' });
    await api.deleteConversation('thread-delete');
    await api.deleteMessage(2);
    await api.deleteQueuedPrompt('queued-1');
    await api.editMessage(1, 'Replacement');
    await api.forkMessage(4);
    await api.readConversationHistory('thread-2');
    await api.readConversationPromptHistory('thread-2');
    await api.listConversations({ cwd: '/tmp/project', limit: 10 });
    await api.listModels({ includeHidden: true, forceReload: true });
    await api.logout();
    await api.refreshAccount();
    await api.refreshConversations();
    await api.renameConversation('Renamed');
    await api.respondToClientRequest({ id: 'question-1', payload: { answers: {} } });
    await api.resolveApproval('approval-1', 'approve', 'once');
    await api.setGoal('Ship it', 2000);
    await api.retryMessage(3);
    await api.selectConversation('thread-2');
    await api.sendMessage('Build it', { model: 'gpt-5' });
    await api.startChatGptLogin();
    await api.startReview({ target: { type: 'uncommittedChanges' } });
    await api.steerMessage('Keep going', {
      attachments: [{ type: 'file', reference: 'attachment:notes' }],
    });
    await api.steerQueuedPrompt('queued-2', 'Edited steer');
    await api.unarchiveConversation('thread-unarchive');
    await api.updateConversationSettings({ modelId: 'gpt-5', approvalPreset: 'ask-for-approval' });
    await api.updateQueuedPrompt('queued-1', 'Edited queue');
    await api.interrupt();
    await api.getSnapshot();
    renderer.emit('codex-surface:state-changed', snapshot);
    renderer.emit('codex-surface:event', surfaceEvent);
    unsubscribe();
    unsubscribeEvent();
    renderer.emit('codex-surface:state-changed', { ...snapshot, busy: true });

    expect(renderer.invoke.mock.calls).toStrictEqual([
      ['codex-surface:archive-conversation', 'thread-archive'],
      ['codex-surface:cancel-login', 'login-1'],
      ['codex-surface:connect'],
      ['codex-surface:clear-goal'],
      ['codex-surface:compact-conversation'],
      ['codex-surface:create-conversation', { model: 'gpt-5' }],
      ['codex-surface:delete-conversation', 'thread-delete'],
      ['codex-surface:delete-message', 2],
      ['codex-surface:delete-queued-prompt', 'queued-1'],
      ['codex-surface:edit-message', 1, 'Replacement'],
      ['codex-surface:fork-message', 4],
      ['codex-surface:read-conversation-history', 'thread-2'],
      ['codex-surface:read-conversation-prompt-history', 'thread-2'],
      ['codex-surface:list-conversations', { cwd: '/tmp/project', limit: 10 }],
      ['codex-surface:list-models', { includeHidden: true, forceReload: true }],
      ['codex-surface:logout'],
      ['codex-surface:refresh-account'],
      ['codex-surface:refresh-conversations'],
      ['codex-surface:rename-conversation', 'Renamed'],
      ['codex-surface:respond-to-client-request', { id: 'question-1', payload: { answers: {} } }],
      ['codex-surface:resolve-approval', 'approval-1', 'approve', 'once'],
      ['codex-surface:set-goal', 'Ship it', 2000],
      ['codex-surface:retry-message', 3],
      ['codex-surface:select-conversation', 'thread-2'],
      ['codex-surface:send-message', 'Build it', { model: 'gpt-5' }],
      ['codex-surface:start-chatgpt-login'],
      ['codex-surface:start-review', { target: { type: 'uncommittedChanges' } }],
      ['codex-surface:steer-message', 'Keep going', {
        attachments: [{ type: 'file', reference: 'attachment:notes' }],
      }],
      ['codex-surface:steer-queued-prompt', 'queued-2', 'Edited steer'],
      ['codex-surface:unarchive-conversation', 'thread-unarchive'],
      ['codex-surface:update-conversation-settings', { modelId: 'gpt-5', approvalPreset: 'ask-for-approval' }],
      ['codex-surface:update-queued-prompt', 'queued-1', 'Edited queue'],
      ['codex-surface:interrupt'],
      ['codex-surface:get-snapshot'],
    ]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(snapshot);
    expect(eventListener).toHaveBeenCalledWith(surfaceEvent);
  });
});

class FakeMainPort implements IpcMainPort {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }
  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
  async call(channel: string, ...args: unknown[]): Promise<unknown> {
    return this.handlers.get(channel)?.({}, ...args);
  }
}

class FakeRendererPort implements IpcRendererPort {
  readonly invoke = vi.fn(async (_channel: string, ..._args: unknown[]) => snapshot);
  private readonly listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }
  emit(channel: string, value: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) listener({}, value);
  }
}
