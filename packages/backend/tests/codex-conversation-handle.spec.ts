import { describe, expect, it, vi } from 'vitest';
import type { CodexConversationSnapshot } from '@codex-app-sdk/core/surface';
import {
  createCodexConversationHandle,
  type CodexConversationHandleOperations,
} from '../src/node/codex-conversation-handle';

describe('createCodexConversationHandle', () => {
  it('delegates conversation operations and returns the latest snapshot', async () => {
    const snapshot = { activeConversationId: 'thread-1' } as unknown as CodexConversationSnapshot;
    const operations = operationSpies(snapshot);
    const conversation = createCodexConversationHandle('thread-1', operations);

    expect(conversation.id).toBe('thread-1');
    await expect(conversation.fork()).resolves.toStrictEqual({ conversationId: 'thread-fork' });
    await expect(conversation.forkMessage(2)).resolves.toStrictEqual({ conversationId: 'thread-fork' });
    await expect(conversation.load({ cwd: '/workspace' })).resolves.toBe(snapshot);
    await expect(conversation.select()).resolves.toBe(snapshot);
    await expect(conversation.rename('New title')).resolves.toBe(snapshot);
    await expect(conversation.updateSettings({ planMode: true })).resolves.toBe(snapshot);
    await expect(conversation.sendMessage('Hello', { model: 'model-1' })).resolves.toBe(snapshot);
    await expect(conversation.compact()).resolves.toBe(snapshot);
    await expect(conversation.startReview({ target: { type: 'uncommittedChanges' } })).resolves.toBe(snapshot);
    await expect(conversation.steerMessage('Follow up', {
      attachments: [{ type: 'file', path: '/tmp/notes.md' }],
    })).resolves.toBe(snapshot);
    await expect(conversation.interrupt()).resolves.toBe(snapshot);
    await expect(conversation.deleteMessage(2)).resolves.toBe(snapshot);
    await expect(conversation.editMessage(1, 'Edited')).resolves.toBe(snapshot);
    await expect(conversation.retryMessage(3)).resolves.toBe(snapshot);
    await expect(conversation.rollbackToTurn('turn-1')).resolves.toBe(snapshot);
    await expect(conversation.deleteQueuedPrompt('prompt-1')).resolves.toBe(snapshot);
    await expect(conversation.steerQueuedPrompt('prompt-2')).resolves.toBe(snapshot);
    const response = { requestId: 'request-1', response: { answers: {} } } as never;
    await expect(conversation.respondToClientRequest(response)).resolves.toBe(snapshot);
    await expect(conversation.resolveApproval('approval-1', 'approve', 'session')).resolves.toBe(snapshot);
    await expect(conversation.setGoal('Ship it', 500)).resolves.toBe(snapshot);
    await expect(conversation.clearGoal()).resolves.toBe(snapshot);

    expect(operations.load).toHaveBeenCalledWith({ cwd: '/workspace' });
    expect(operations.sendMessage).toHaveBeenCalledWith('Hello', { model: 'model-1' });
    expect(operations.steerMessage).toHaveBeenCalledWith('Follow up', {
      attachments: [{ type: 'file', path: '/tmp/notes.md' }],
    });
    expect(operations.resolveApproval).toHaveBeenCalledWith('approval-1', 'approve', 'session');
    expect(operations.setGoal).toHaveBeenCalledWith('Ship it', 500);
    expect(operations.getSnapshot).toHaveBeenCalledTimes(19);
  });

  it('passes through history, realtime, snapshots, and subscriptions', async () => {
    const snapshot = { activeConversationId: 'thread-1' } as unknown as CodexConversationSnapshot;
    const operations = operationSpies(snapshot);
    const conversation = createCodexConversationHandle('thread-1', operations);
    const listener = vi.fn();

    expect(conversation.getSnapshot()).toBe(snapshot);
    expect(conversation.onStateChange(listener)).toBe('state-unsubscribe');
    expect(conversation.onEvent(listener)).toBe('event-unsubscribe');
    await expect(conversation.readHistory()).resolves.toStrictEqual({ turns: [] });
    await expect(conversation.readPromptHistory()).resolves.toStrictEqual({
      conversationId: 'thread-1', prompts: ['Hello'],
    });
    await expect(conversation.startRealtime({ inputAudioFormat: 'pcm16' } as never)).resolves.toBe('session');
  });
});

function operationSpies(snapshot: CodexConversationSnapshot): CodexConversationHandleOperations {
  const operation = () => vi.fn(async () => undefined);
  return {
    clearGoal: operation(), compact: operation(), deleteMessage: operation(), deleteQueuedPrompt: operation(),
    editMessage: operation(), fork: vi.fn(async () => ({ conversationId: 'thread-fork' }) as never),
    forkMessage: vi.fn(async () => ({ conversationId: 'thread-fork' }) as never),
    getSnapshot: vi.fn(() => snapshot), interrupt: operation(), load: operation(),
    onEvent: vi.fn(() => 'event-unsubscribe' as never),
    onStateChange: vi.fn(() => 'state-unsubscribe' as never),
    readHistory: vi.fn(async () => ({ turns: [] }) as never),
    readPromptHistory: vi.fn(async () => ({ conversationId: 'thread-1', prompts: ['Hello'] })),
    rename: operation(),
    resolveApproval: operation(), respondToClientRequest: operation(), retryMessage: operation(),
    rollbackToTurn: operation(), select: operation(), sendMessage: operation(), setGoal: operation(),
    startRealtime: vi.fn(async () => 'session' as never), startReview: operation(), steerMessage: operation(),
    steerQueuedPrompt: operation(), updateSettings: operation(),
  };
}
