import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceSnapshot, SurfaceMessage } from '@codex-app-sdk/core/surface';
import type { CodexAppServerClient } from '../src/codex';
import { initialAuthentication } from '../src/node/codex-surface-authentication';
import { createThreadRuntime, initialSurfaceSnapshot } from '../src/node/codex-surface-runtime';
import { CodexSurfaceTurnActionsController } from '../src/node/codex-surface-turn-actions-controller';
import { thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurfaceTurnActionsController', () => {
  it('makes active-conversation compact and interrupt wrappers no-ops without a selection', async () => {
    const setup = createController({ active: false });

    await expect(setup.controller.compact()).resolves.toBe(setup.state);
    await expect(setup.controller.interrupt()).resolves.toBe(setup.state);

    expect(setup.host.ensureThreadReady).not.toHaveBeenCalled();
    expect(setup.request).not.toHaveBeenCalled();
  });

  it('delegates active-conversation compact and interrupt wrappers and returns the latest snapshot', async () => {
    const setup = createController();
    const compact = vi.spyOn(setup.controller, 'compactForThread').mockResolvedValue();
    const interrupt = vi.spyOn(setup.controller, 'interruptThread').mockResolvedValue();

    await expect(setup.controller.compact()).resolves.toBe(setup.state);
    await expect(setup.controller.interrupt()).resolves.toBe(setup.state);

    expect(compact).toHaveBeenCalledExactlyOnceWith('thread-1');
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('thread-1');
  });

  it('compacts an idle thread and identifies its active or latest turn in the event', async () => {
    const active = createController({ activeTurnId: 'turn-active', turnIds: ['turn-old', 'turn-active'] });
    await active.controller.compactForThread('thread-1');
    expect(active.request).toHaveBeenCalledExactlyOnceWith('thread/compact/start', { threadId: 'thread-1' });
    expect(active.host.emitEvent).toHaveBeenCalledExactlyOnceWith('action', {
      type: 'context.compactionStarted', conversationId: 'thread-1', turnId: 'turn-active',
      payload: { itemId: null },
    });

    const latest = createController({ turnIds: ['turn-first', 'turn-middle', 'turn-latest'] });
    await latest.controller.compactForThread('thread-1');
    expect(latest.host.emitEvent).toHaveBeenCalledWith('action', expect.objectContaining({ turnId: 'turn-latest' }));

    const empty = createController();
    await empty.controller.compactForThread('thread-1');
    expect(empty.host.emitEvent).not.toHaveBeenCalled();
  });

  it('rejects compact while the thread is busy', async () => {
    const setup = createController({ busy: true });
    await expect(setup.controller.compactForThread('thread-1'))
      .rejects.toThrow('Cannot compact while Codex is responding');
    expect(setup.request).not.toHaveBeenCalled();
  });

  it('creates an active conversation before starting a review', async () => {
    const setup = createController({ active: false });
    setup.host.createConversation.mockImplementation(async () => {
      setup.state.activeConversationId = 'thread-1';
    });
    const start = vi.spyOn(setup.controller, 'startReviewForThread').mockResolvedValue();

    await expect(setup.controller.startReview({ target: { type: 'uncommittedChanges' } }))
      .resolves.toBe(setup.state);

    expect(setup.host.createConversation).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledExactlyOnceWith('thread-1', { target: { type: 'uncommittedChanges' } });
  });

  it('fails review startup if conversation creation does not select a thread', async () => {
    const setup = createController({ active: false });
    await expect(setup.controller.startReview()).rejects.toThrow('Codex did not create a conversation');
    expect(setup.request).not.toHaveBeenCalled();
  });

  it('rejects a review while the thread is busy before changing state', async () => {
    const setup = createController({ busy: true });
    await expect(setup.controller.startReviewForThread('thread-1'))
      .rejects.toThrow('The conversation is already responding');
    expect(setup.host.patchRuntime).not.toHaveBeenCalled();
    expect(setup.request).not.toHaveBeenCalled();
  });

  it('starts an inline uncommitted review and projects its exact prompt and events', async () => {
    const reviewTurn = {
      ...turn('review-turn', 'inProgress', [{
        type: 'userMessage', id: 'review-user', clientId: null,
        content: [{ type: 'text', text: 'current changes', text_elements: [] }],
      }]),
      startedAt: 1_700_000_000,
    };
    const setup = createController({ reviewResponse: { turn: reviewTurn, reviewThreadId: 'thread-1' } });

    await setup.controller.startReviewForThread('thread-1');

    expect(setup.host.patchRuntime).toHaveBeenNthCalledWith(1, 'thread-1', {
      busy: true, turnStartPending: true, error: null,
    });
    expect(setup.host.patchConversationStatus).toHaveBeenNthCalledWith(1, 'thread-1', 'active', 'action');
    expect(setup.host.emitConversationActivity).toHaveBeenNthCalledWith(1, 'thread-1', 'action');
    expect(setup.request).toHaveBeenCalledExactlyOnceWith('review/start', {
      threadId: 'thread-1', target: { type: 'uncommittedChanges' }, delivery: 'inline',
    });
    expect(setup.runtime).toMatchObject({
      activeTurnId: 'review-turn', turnIds: ['review-turn'], busy: true, turnStartPending: false, error: null,
    });
    expect(setup.runtime.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        parts: [{
          type: 'text',
          text: 'Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.',
        }],
        metadata: expect.objectContaining({ reviewPrompt: true }),
      }),
      expect.objectContaining({ role: 'assistant', status: 'streaming', turnId: 'review-turn' }),
    ]));
    expect(setup.host.patchConversationTurnCount).toHaveBeenCalledWith('thread-1', 1, 'action');
    expect(setup.host.emitEvent).toHaveBeenCalledWith('action', {
      type: 'turn.started', conversationId: 'thread-1', turnId: 'review-turn',
      payload: { startedAt: '2023-11-14T22:13:20.000Z' },
    });
    expect(setup.host.patchConversationStatus).toHaveBeenLastCalledWith('thread-1', 'active', 'action');
    expect(setup.host.emitConversationActivity).toHaveBeenCalledTimes(2);
    expect(setup.host.emitConversationActivity).toHaveBeenLastCalledWith('thread-1', 'action');
  });

  it('uses an explicit review target and does not duplicate known messages or turn-start events', async () => {
    const existing = userMessage('user-thread-1-review-turn-review-user', 'review-turn', 'Keep me');
    const setup = createController({
      messages: [existing],
      turnIds: ['review-turn'],
      reviewResponse: {
        reviewThreadId: 'thread-1',
        turn: turn('review-turn', 'completed', [{
          type: 'userMessage', id: 'review-user', clientId: null,
          content: [{ type: 'text', text: 'branch diff', text_elements: [] }],
        }]),
      },
    });

    await setup.controller.startReviewForThread('thread-1', {
      target: { type: 'baseBranch', branch: 'main' },
    });

    expect(paramsFor(setup.request, 'review/start')).toStrictEqual({
      threadId: 'thread-1', target: { type: 'baseBranch', branch: 'main' }, delivery: 'inline',
    });
    expect(setup.runtime.messages).toStrictEqual([existing]);
    expect(setup.runtime.turnIds).toStrictEqual(['review-turn']);
    expect(setup.runtime).toMatchObject({ activeTurnId: null, busy: false, turnStartPending: false });
    expect(setup.host.emitEvent).not.toHaveBeenCalled();
    expect(setup.host.patchConversationStatus).toHaveBeenLastCalledWith('thread-1', 'idle', 'action');
  });

  it('inserts new review messages immediately before existing messages from the same turn', async () => {
    const existing = assistantMessage('existing', 'review-turn', 'Existing');
    const later = assistantMessage('later', 'turn-later', 'Later');
    const setup = createController({
      messages: [existing, later],
      reviewResponse: {
        reviewThreadId: 'thread-1',
        turn: turn('review-turn', 'completed', [{
          type: 'userMessage', id: 'new-user', clientId: null,
          content: [{ type: 'text', text: 'branch diff', text_elements: [] }],
        }]),
      },
    });

    await setup.controller.startReviewForThread('thread-1', {
      target: { type: 'baseBranch', branch: 'main' },
    });

    expect(setup.runtime.messages.map((message) => message.id)).toStrictEqual([
      'user-thread-1-review-turn-new-user', 'existing', 'later',
    ]);
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('action', {
      type: 'message.appended', conversationId: 'thread-1', turnId: 'review-turn',
      payload: { message: expect.objectContaining({ id: 'user-thread-1-review-turn-new-user' }) },
    });
  });

  it('does not duplicate messages that precede the insertion point for an existing review turn', async () => {
    const prior = assistantMessage('prior', 'turn-prior', 'Prior');
    const existing = assistantMessage('existing', 'review-turn', 'Existing');
    const setup = createController({
      messages: [prior, existing],
      reviewResponse: {
        reviewThreadId: 'thread-1',
        turn: turn('review-turn', 'completed', [{
          type: 'userMessage', id: 'new-user', clientId: null,
          content: [{ type: 'text', text: 'branch diff', text_elements: [] }],
        }]),
      },
    });

    await setup.controller.startReviewForThread('thread-1', {
      target: { type: 'baseBranch', branch: 'main' },
    });

    expect(setup.runtime.messages.map((message) => message.id)).toStrictEqual([
      'prior', 'user-thread-1-review-turn-new-user', 'existing',
    ]);
  });

  it('appends a new review turn after all existing messages', async () => {
    const first = assistantMessage('first', 'turn-first', 'First');
    const second = assistantMessage('second', 'turn-second', 'Second');
    const setup = createController({
      messages: [first, second],
      reviewResponse: {
        reviewThreadId: 'thread-1',
        turn: turn('review-new', 'completed', [{
          type: 'userMessage', id: 'new-user', clientId: null,
          content: [{ type: 'text', text: 'branch diff', text_elements: [] }],
        }]),
      },
    });

    await setup.controller.startReviewForThread('thread-1', {
      target: { type: 'baseBranch', branch: 'main' },
    });

    expect(setup.runtime.messages.map((message) => message.id)).toStrictEqual([
      'first', 'second', 'user-thread-1-review-new-new-user',
    ]);
  });

  it('marks only user review messages and rewrites only the exact uncommitted placeholder', async () => {
    const setup = createController({
      reviewResponse: {
        reviewThreadId: 'thread-1',
        turn: turn('review-turn', 'completed', [
          {
            type: 'userMessage', id: 'context-user', clientId: null,
            content: [{ type: 'text', text: 'context', text_elements: [] }],
          },
          {
            type: 'userMessage', id: 'review-user', clientId: null,
            content: [{ type: 'text', text: 'current changes', text_elements: [] }],
          },
          agentItem('agent answer'),
        ]),
      },
    });

    await setup.controller.startReviewForThread('thread-1');

    const [context, user, assistant] = setup.runtime.messages;
    expect(context).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'context' }],
      metadata: expect.objectContaining({ reviewPrompt: true }),
    });
    expect(user).toMatchObject({
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.',
      }],
      metadata: expect.objectContaining({ reviewPrompt: true }),
    });
    expect(assistant).toMatchObject({
      role: 'assistant', parts: [{ type: 'text', text: 'agent answer' }],
    });
    expect(assistant?.metadata).not.toHaveProperty('reviewPrompt');
  });

  it('does not rewrite current-changes text for a non-uncommitted review target', async () => {
    const setup = createController({
      reviewResponse: {
        reviewThreadId: 'thread-1',
        turn: turn('review-turn', 'completed', [{
          type: 'userMessage', id: 'review-user', clientId: null,
          content: [{ type: 'text', text: 'current changes', text_elements: [] }],
        }]),
      },
    });

    await setup.controller.startReviewForThread('thread-1', {
      target: { type: 'baseBranch', branch: 'main' },
    });

    expect(setup.runtime.messages[0]).toMatchObject({
      role: 'user', parts: [{ type: 'text', text: 'current changes' }],
    });
  });

  it('restores an error state when review/start rejects or returns another thread', async () => {
    const rejected = createController({ rejectReview: 'review unavailable' });
    await expect(rejected.controller.startReviewForThread('thread-1')).rejects.toBe('review unavailable');
    expect(rejected.runtime).toMatchObject({ busy: false, turnStartPending: false, error: 'review unavailable' });
    expect(rejected.host.patchConversationStatus).toHaveBeenLastCalledWith('thread-1', 'error', 'action');
    expect(rejected.host.emitConversationActivity).toHaveBeenCalledTimes(2);
    expect(rejected.host.emitConversationActivity).toHaveBeenLastCalledWith('thread-1', 'action');

    const mismatch = createController({
      reviewResponse: { turn: turn('review-turn', 'completed', []), reviewThreadId: 'other' },
    });
    await expect(mismatch.controller.startReviewForThread('thread-1'))
      .rejects.toThrow("unexpected review thread 'other'");
    expect(mismatch.runtime.error).toContain("unexpected review thread 'other'");
  });

  it('interrupts only an active turn with the exact identifiers', async () => {
    const idle = createController();
    await idle.controller.interruptThread('thread-1');
    expect(idle.request).not.toHaveBeenCalled();

    const active = createController({ activeTurnId: 'turn-active' });
    await active.controller.interruptThread('thread-1');
    expect(active.request).toHaveBeenCalledExactlyOnceWith('turn/interrupt', {
      threadId: 'thread-1', turnId: 'turn-active',
    });
  });

  it('requires an active conversation for message action wrappers', async () => {
    const setup = createController({ active: false });
    await expect(setup.controller.deleteMessage(0)).rejects.toThrow('There is no active conversation');
    await expect(setup.controller.editMessage(0, 'text')).rejects.toThrow('There is no active conversation');
    await expect(setup.controller.retryMessage(0)).rejects.toThrow('There is no active conversation');
    expect(setup.host.ensureThreadReady).not.toHaveBeenCalled();
  });

  it('deletes the turn containing the selected message', async () => {
    const setup = createController({ messages: [userMessage('user', 'turn-2', 'Prompt')] });
    const rollback = vi.spyOn(setup.controller, 'rollbackToTurn').mockResolvedValue();

    await expect(setup.controller.deleteMessage(0)).resolves.toBe(setup.state);

    expect(rollback).toHaveBeenCalledExactlyOnceWith('thread-1', 'turn-2');
  });

  it('edits only nonblank user messages and preserves attachments', async () => {
    const attachment = { type: 'attachment' as const, attachment: {
      kind: 'file' as const, name: 'notes.txt', path: '/tmp/notes.txt', size: 5,
    } };
    const message = userMessage('user', 'turn-2', 'Original', [attachment]);
    const setup = createController({ messages: [message] });
    const rollback = vi.spyOn(setup.controller, 'rollbackToTurn').mockResolvedValue();

    await setup.controller.editMessageForThread('thread-1', 0, ' Edited ');

    expect(rollback).toHaveBeenCalledExactlyOnceWith('thread-1', 'turn-2');
    expect(setup.host.sendMessageToThread).toHaveBeenCalledExactlyOnceWith(
      'thread-1', 'Edited', { attachments: [{ type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' }] },
    );

    setup.runtime.messages = [assistantMessage('assistant', 'turn-2', 'Answer')];
    await expect(setup.controller.editMessageForThread('thread-1', 0, 'text'))
      .rejects.toThrow('Only user messages can be edited');
    setup.runtime.messages = [userMessage('user', 'turn-2', 'Prompt')];
    await expect(setup.controller.editMessageForThread('thread-1', 0, '   '))
      .rejects.toThrow('Cannot replace a message with empty content');
  });

  it('edits an attachment-free message without inventing an attachments option', async () => {
    const setup = createController({ messages: [userMessage('user', 'turn-2', 'Original')] });
    vi.spyOn(setup.controller, 'rollbackToTurn').mockResolvedValue();

    await setup.controller.editMessageForThread('thread-1', 0, 'Edited');

    expect(setup.host.sendMessageToThread).toHaveBeenCalledExactlyOnceWith('thread-1', 'Edited', {});
  });

  it('retries the matching user prompt and attachments even when later messages intervene', async () => {
    const attachment = { type: 'attachment' as const, attachment: {
      kind: 'file' as const, name: 'notes.txt', path: '/tmp/notes.txt', size: 5,
    } };
    const setup = createController({ messages: [
      userMessage('user', 'turn-2', ' Retry me ', [attachment]),
      assistantMessage('assistant', 'turn-2', 'Answer'),
      assistantMessage('later', 'turn-3', 'Later'),
    ] });
    const rollback = vi.spyOn(setup.controller, 'rollbackToTurn').mockResolvedValue();

    await setup.controller.retryMessageForThread('thread-1', 1);

    expect(rollback).toHaveBeenCalledExactlyOnceWith('thread-1', 'turn-2');
    expect(setup.host.sendMessageToThread).toHaveBeenCalledExactlyOnceWith(
      'thread-1', 'Retry me', { attachments: [{ type: 'file', name: 'notes.txt', path: '/tmp/notes.txt' }] },
    );
  });

  it('retries the nearest matching user prompt without inventing attachment options', async () => {
    const setup = createController({ messages: [
      userMessage('older', 'turn-2', 'Older'),
      { ...userMessage('system', 'turn-2', 'Not a prompt'), role: 'system' },
      userMessage('newer', 'turn-2', 'Newer'),
      userMessage('other-turn', 'turn-3', 'Wrong turn'),
      assistantMessage('assistant', 'turn-2', 'Answer'),
      userMessage('after-selection', 'turn-2', 'After selection'),
    ] });
    vi.spyOn(setup.controller, 'rollbackToTurn').mockResolvedValue();

    await setup.controller.retryMessageForThread('thread-1', 4);

    expect(setup.host.sendMessageToThread).toHaveBeenCalledExactlyOnceWith('thread-1', 'Newer', {});
  });

  it('rejects retry when its turn has no nonempty user prompt', async () => {
    const setup = createController({ messages: [assistantMessage('assistant', 'turn-2', 'Answer')] });
    await expect(setup.controller.retryMessageForThread('thread-1', 0))
      .rejects.toThrow('Could not find the user prompt for this turn');
    expect(setup.host.sendMessageToThread).not.toHaveBeenCalled();
  });

  it('rejects retry when the matching user message has no text', async () => {
    const blank = userMessage('blank', 'turn-2', '   ');
    const setup = createController({ messages: [blank, assistantMessage('assistant', 'turn-2', 'Answer')] });

    await expect(setup.controller.retryMessageForThread('thread-1', 1))
      .rejects.toThrow('Could not find the user prompt for this turn');

    expect(setup.host.sendMessageToThread).not.toHaveBeenCalled();
  });

  it('hydrates unknown rollback targets, rejects remaining misses, and blocks busy threads', async () => {
    const hydrated = createController({ turnIds: ['turn-known'] });
    hydrated.host.hydrateCompleteHistory.mockImplementation(async () => {
      hydrated.runtime.turnIds.unshift('turn-old');
    });
    hydrated.rollbackThread = { ...thread('thread-1', false), turns: [] };
    await hydrated.controller.rollbackToTurn('thread-1', 'turn-old');
    expect(hydrated.host.hydrateCompleteHistory).toHaveBeenCalledWith('thread-1');
    expect(paramsFor(hydrated.request, 'thread/rollback')).toStrictEqual({ threadId: 'thread-1', numTurns: 2 });

    const missing = createController({ turnIds: ['turn-known'] });
    await expect(missing.controller.rollbackToTurn('thread-1', 'missing'))
      .rejects.toThrow("Cannot roll back to unknown Codex turn 'missing'");
    expect(missing.request).not.toHaveBeenCalled();

    const busy = createController({ busy: true, turnIds: ['turn-known'] });
    await expect(busy.controller.rollbackToTurn('thread-1', 'turn-known'))
      .rejects.toThrow('Cannot roll back while Codex is responding');
  });

  it('does not hydrate a rollback target already present at index zero', async () => {
    const setup = createController({ turnIds: ['turn-first', 'turn-second'] });
    setup.rollbackThread = { ...thread('thread-1', false), turns: [] };

    await setup.controller.rollbackToTurn('thread-1', 'turn-first');

    expect(setup.host.hydrateCompleteHistory).not.toHaveBeenCalled();
    expect(paramsFor(setup.request, 'thread/rollback')).toStrictEqual({ threadId: 'thread-1', numTurns: 2 });
  });

  it('rejects rollback responses for a different thread without mutating history', async () => {
    const setup = createController({ turnIds: ['turn-1'], rollbackThread: thread('other', false) });
    const before = structuredClone(setup.runtime.messages);

    await expect(setup.controller.rollbackToTurn('thread-1', 'turn-1'))
      .rejects.toThrow("returned 'other' for requested thread 'thread-1'");

    expect(setup.runtime.messages).toStrictEqual(before);
    expect(setup.host.emitHistoryReplaced).not.toHaveBeenCalled();
  });

  it('replaces rollback state and emits every public update in order', async () => {
    const rolledBack = {
      ...thread('thread-1', false),
      turns: [turn('remaining', 'completed', [{
        type: 'userMessage', id: 'remaining-user', clientId: null,
        content: [{ type: 'text', text: 'Remaining', text_elements: [] }],
      }])],
    };
    const setup = createController({
      activeTurnId: 'turn-2', busy: false, turnIds: ['remaining', 'turn-2'],
      messages: [userMessage('old', 'turn-2', 'Old')], rollbackThread: rolledBack,
    });
    setup.runtime.answeredClientRequestIds = ['request'];
    setup.runtime.contextUsage = { totalTokens: 1 } as never;
    setup.runtime.turnGitDiff = { turnId: 'turn-2' } as never;

    await setup.controller.rollbackToTurn('thread-1', 'turn-2');

    expect(paramsFor(setup.request, 'thread/rollback')).toStrictEqual({ threadId: 'thread-1', numTurns: 1 });
    expect(setup.runtime).toMatchObject({
      turnIds: ['remaining'], activeTurnId: null, answeredClientRequestIds: [], busy: false,
      turnStartPending: false, error: null, contextUsage: null, turnGitDiff: null,
    });
    expect(setup.runtime.messages).toEqual([
      expect.objectContaining({ role: 'user', turnId: 'remaining' }),
    ]);
    expect(setup.host.emitSummaryUpserted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thread-1', turnCount: 1 }), 'updated', 'action',
    );
    expect(setup.host.emitHistoryReplaced).toHaveBeenCalledExactlyOnceWith('thread-1', 'rollback', 'action');
    expect(setup.host.emitConversationActivity).toHaveBeenCalledWith('thread-1', 'action');
  });

  it('reverts paginated history while retaining only earlier turns and turnless messages', async () => {
    const first = userMessage('first', 'turn-1', 'First');
    const target = userMessage('target', 'turn-2', 'Target');
    const later = assistantMessage('later', 'turn-3', 'Later');
    const turnless: SurfaceMessage = {
      id: 'turnless', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Draft' }],
      metadata: { conversationId: 'thread-1' },
    };
    const revertedThread = { ...thread('thread-1', false), name: 'Reverted thread' };
    const setup = createController({
      activeTurnId: 'turn-3',
      busy: false,
      historyMode: 'paginated',
      messages: [first, target, turnless, later],
      turnIds: ['turn-1', 'turn-2', 'turn-3'],
      revertResponse: {
        thread: revertedThread,
        turnsBackwardsCursor: 'older-turns',
        itemsBackwardsCursor: 'older-items',
      },
    });
    setup.runtime.answeredClientRequestIds = ['request-1'];
    setup.runtime.turnStartPending = true;
    setup.runtime.error = 'old error';
    setup.runtime.contextUsage = { totalTokens: 1 } as never;
    setup.runtime.turnGitDiff = { turnId: 'turn-3' } as never;

    await setup.controller.rollbackToTurn('thread-1', 'turn-2');

    expect(setup.request).toHaveBeenCalledExactlyOnceWith('thread/revert', {
      threadId: 'thread-1', beforeTurnId: 'turn-2',
    });
    expect(setup.runtime).toMatchObject({
      turnIds: ['turn-1'],
      activeTurnId: null,
      messages: [first, turnless],
      answeredClientRequestIds: [],
      busy: false,
      turnStartPending: false,
      error: null,
      contextUsage: null,
      turnGitDiff: null,
      historyCursor: 'older-turns',
      historyHasOlder: true,
      fullHistoryHydrated: false,
    });
    expect(setup.host.patch).toHaveBeenCalledExactlyOnceWith({
      conversations: [expect.objectContaining({
        id: 'thread-1', title: 'Reverted thread', turnCount: 1,
      })],
    });
    expect(setup.host.emitSummaryUpserted).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'thread-1', title: 'Reverted thread', turnCount: 1 }),
      'updated',
      'action',
    );
    expect(setup.host.emitHistoryReplaced).toHaveBeenCalledExactlyOnceWith('thread-1', 'rollback', 'action');
    expect(setup.host.emitConversationActivity).toHaveBeenCalledExactlyOnceWith('thread-1', 'action');
  });

  it('marks paginated history fully loaded when revert returns no older cursor', async () => {
    const setup = createController({
      historyMode: 'paginated',
      messages: [userMessage('target', 'turn-1', 'Target')],
      turnIds: ['turn-1'],
      revertResponse: {
        thread: thread('thread-1', false),
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      },
    });

    await setup.controller.rollbackToTurn('thread-1', 'turn-1');

    expect(setup.runtime).toMatchObject({
      turnIds: [], messages: [], historyCursor: null, historyHasOlder: false, fullHistoryHydrated: true,
    });
  });

  it('rejects paginated revert responses for another thread without mutating history', async () => {
    const setup = createController({
      activeTurnId: 'turn-1',
      historyMode: 'paginated',
      messages: [userMessage('target', 'turn-1', 'Target')],
      turnIds: ['turn-1'],
      revertResponse: {
        thread: thread('other', false),
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      },
    });
    const before = structuredClone(setup.runtime);

    await expect(setup.controller.rollbackToTurn('thread-1', 'turn-1'))
      .rejects.toThrow("thread/revert returned 'other' for requested thread 'thread-1'");

    expect(setup.runtime).toStrictEqual(before);
    expect(setup.host.patch).not.toHaveBeenCalled();
    expect(setup.host.emitHistoryReplaced).not.toHaveBeenCalled();
  });
});

type ControllerOptions = {
  active?: boolean;
  activeTurnId?: string | null;
  busy?: boolean;
  historyMode?: 'legacy' | 'paginated';
  messages?: SurfaceMessage[];
  rejectReview?: unknown;
  reviewResponse?: unknown;
  rollbackThread?: Record<string, unknown>;
  revertResponse?: Record<string, unknown>;
  turnIds?: string[];
};

function createController(options: ControllerOptions = {}) {
  const state = initialSurfaceSnapshot(initialAuthentication());
  state.activeConversationId = options.active === false ? null : 'thread-1';
  state.conversations = [summary('thread-1')];
  const runtime = createThreadRuntime('thread-1', state, {
    activeTurnId: options.activeTurnId ?? null,
    busy: options.busy ?? false,
    historyMode: options.historyMode ?? 'legacy',
    messages: options.messages ?? [],
    turnIds: options.turnIds ?? [],
  });
  const setup = { rollbackThread: options.rollbackThread };
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'review/start') {
      if (options.rejectReview !== undefined) throw options.rejectReview;
      return options.reviewResponse ?? {
        reviewThreadId: 'thread-1', turn: turn('review-turn', 'inProgress', []),
      };
    }
    if (method === 'thread/rollback') {
      return { thread: setup.rollbackThread ?? { ...thread('thread-1', false), turns: [] } };
    }
    if (method === 'thread/revert') {
      return options.revertResponse ?? {
        thread: { ...thread('thread-1', false), turns: [] },
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      };
    }
    return {};
  });
  const host = {
    createConversation: vi.fn(async () => undefined),
    emitConversationActivity: vi.fn(),
    emitEvent: vi.fn(),
    emitHistoryReplaced: vi.fn(),
    emitSummaryUpserted: vi.fn(),
    ensureThreadReady: vi.fn(async () => runtime),
    getSnapshot: vi.fn(() => state),
    getState: vi.fn(() => state),
    hydrateCompleteHistory: vi.fn(async () => undefined),
    patch: vi.fn((patch: Partial<CodexSurfaceSnapshot>) => Object.assign(state, patch)),
    patchConversationStatus: vi.fn((threadId: string, status: 'idle' | 'active' | 'error') => {
      state.conversations = state.conversations.map((item) => item.id === threadId ? { ...item, status } : item);
    }),
    patchConversationTurnCount: vi.fn(),
    patchRuntime: vi.fn((_threadId: string, patch: object) => Object.assign(runtime, patch)),
    sendMessageToThread: vi.fn(async () => undefined),
  };
  const controller = new CodexSurfaceTurnActionsController(
    { request } as unknown as CodexAppServerClient,
    host,
  );
  return Object.assign({ controller, host, request, runtime, state }, setup);
}

function summary(id: string) {
  return {
    id, title: id, preview: '', cwd: '/workspace', status: 'idle' as const, turnCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function userMessage(
  id: string,
  turnId: string,
  text: string,
  extraParts: SurfaceMessage['parts'] = [],
): SurfaceMessage {
  return {
    id, role: 'user', status: 'complete', turnId,
    parts: [{ type: 'text', text }, ...extraParts],
    metadata: { conversationId: 'thread-1', turnId },
  };
}

function assistantMessage(id: string, turnId: string, text: string): SurfaceMessage {
  return {
    id, role: 'assistant', status: 'complete', turnId, parts: [{ type: 'text', text }],
    metadata: { conversationId: 'thread-1', turnId },
  };
}

function agentItem(text: string) {
  return { type: 'agentMessage', id: 'agent', text, phase: null, memoryCitation: null };
}

function paramsFor(request: ReturnType<typeof vi.fn>, method: string): unknown {
  return request.mock.calls.find(([candidate]) => candidate === method)?.[1];
}
