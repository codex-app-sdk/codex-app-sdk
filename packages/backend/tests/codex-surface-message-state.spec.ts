import { describe, expect, it } from 'vitest';
import type { v2 } from '../src/codex';
import type {
  SurfaceMessage,
  SurfaceMessageMediaPart,
  SurfaceMessageToolPart,
} from '@codex-app-sdk/core/surface';
import {
  activeTurnId,
  addUnique,
  appendAssistantTextDelta,
  appendCompactionMarker,
  ensureAssistantTurnMessage,
  finalizeTurnToolParts,
  formatPlanMarkdown,
  planProgressToolPart,
  pruneEmptyAssistantPlaceholders,
  surfaceMediaPartsEqual,
  updateAssistantToolPart,
  upsertAssistantMediaPart,
  upsertAssistantReasoningSummaries,
  upsertAssistantText,
  upsertAssistantToolPart,
} from '../src/node/codex-surface-message-state';

describe('Codex surface message state', () => {
  it('selects the most recent active turn', () => {
    const turns = [
      { id: 'turn-1', status: 'inProgress' },
      { id: 'turn-2', status: 'completed' },
      { id: 'turn-3', status: 'inProgress' },
    ] as v2.Turn[];

    expect(activeTurnId(turns)).toBe('turn-3');
    expect(activeTurnId([{ id: 'done', status: 'completed' } as v2.Turn])).toBeNull();
    expect(activeTurnId([])).toBeNull();
  });

  it('creates, reuses, replaces, and completes assistant segments', () => {
    const created = ensureAssistantTurnMessage([], 'thread-1', 'turn-1', {
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(created).toStrictEqual([assistant('assistant-turn-1', [], 'streaming', 'turn-1', {
      createdAt: '2026-01-01T00:00:00.000Z',
    })]);
    expect(ensureAssistantTurnMessage(created, 'thread-1', 'turn-1')).toStrictEqual(created);

    const separated = [created[0]!, user('interrupt'), assistant('later', [], 'complete', 'turn-2')];
    expect(ensureAssistantTurnMessage(separated, 'thread-1', 'turn-1')).toStrictEqual(separated);

    const turnBoundary = { ...user('boundary'), metadata: { conversationId: 'thread-1', turnId: 'turn-1' } };
    const replaced = ensureAssistantTurnMessage([...created, turnBoundary], 'thread-1', 'turn-1', {
      forceSegment: true,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    expect(replaced).toHaveLength(2);
    expect(replaced[1]).toMatchObject({ id: 'assistant-turn-1', status: 'streaming' });

    const withText = [
      assistant('assistant-turn-1', [{ type: 'text', text: 'first' }], 'streaming'),
      turnBoundary,
    ];
    const segmented = ensureAssistantTurnMessage(withText, 'thread-1', 'turn-1', {
      forceSegment: true,
      createdAt: '2026-01-03T00:00:00.000Z',
    });
    expect(segmented.filter((message) => message.role === 'assistant').map((message) => [message.id, message.status]))
      .toStrictEqual([
      ['assistant-turn-1', 'complete'],
      ['assistant-turn-1-segment-1', 'streaming'],
      ]);
  });

  it('appends text deltas into the active item and starts a new part for another item', () => {
    const untouched: SurfaceMessage[] = [user('user-1')];
    expect(appendAssistantTextDelta(untouched, 'thread-1', 'turn-1', 'item-1', ''))
      .toStrictEqual(untouched);

    const first = appendAssistantTextDelta(untouched, 'thread-1', 'turn-1', 'item-1', 'hel');
    const second = appendAssistantTextDelta(first, 'thread-1', 'turn-1', 'item-1', 'lo');
    const third = appendAssistantTextDelta(second, 'thread-1', 'turn-1', 'item-2', '!');
    expect(third.at(-1)?.parts).toStrictEqual([
      { type: 'text', text: 'hello', itemId: 'item-1' },
      { type: 'text', text: '!', itemId: 'item-2' },
    ]);

    const phased = appendAssistantTextDelta(
      untouched,
      'thread-1',
      'turn-1',
      'commentary-1',
      'Checking',
      'commentary',
    );
    expect(phased.at(-1)?.parts).toStrictEqual([
      { type: 'text', text: 'Checking', itemId: 'commentary-1', phase: 'commentary' },
    ]);
  });

  it('appends phased deltas only to the matching final text part of the matching turn', () => {
    const wrongTurn = assistant('wrong-turn', [
      { type: 'text', text: 'wrong', itemId: 'item-1', phase: 'commentary' },
    ], 'complete', 'turn-other');
    const target = assistant('target', [
      { type: 'text', text: 'first', itemId: 'item-1' },
      toolPart('tool-1'),
      { type: 'text', text: 'partial', itemId: 'item-1' },
    ]);
    const result = appendAssistantTextDelta(
      [target, wrongTurn], 'thread-1', 'turn-1', 'item-1', ' answer', 'final_answer',
    );

    expect(result).toStrictEqual([
      {
        ...target,
        parts: [
          { type: 'text', text: 'first', itemId: 'item-1' },
          toolPart('tool-1'),
          { type: 'text', text: 'partial answer', itemId: 'item-1', phase: 'final_answer' },
        ],
      },
      wrongTurn,
    ]);
  });

  it('updates existing assistant text or inserts a phased text part', () => {
    const existing = [assistant('assistant-turn-1', [
      { type: 'text', text: 'old', itemId: 'item-1' },
      toolPart('tool-1'),
    ])];
    expect(upsertAssistantText(existing, 'thread-1', 'turn-1', 'item-1', 'new', 'final_answer')[0]?.parts[0])
      .toStrictEqual({ type: 'text', text: 'new', itemId: 'item-1', phase: 'final_answer' });

    const inserted = upsertAssistantText([], 'thread-1', 'turn-1', 'item-2', 'thinking', 'commentary');
    expect(inserted[0]?.parts).toStrictEqual([
      { type: 'text', text: 'thinking', itemId: 'item-2', phase: 'commentary' },
    ]);
    const withoutPhase = upsertAssistantText([], 'thread-1', 'turn-1', 'item-3', 'plain');
    expect(withoutPhase[0]?.parts[0]).toStrictEqual({ type: 'text', text: 'plain', itemId: 'item-3' });
  });

  it('inserts and replaces safe reasoning summaries without exposing reasoning content', () => {
    const first = upsertAssistantReasoningSummaries(
      [],
      'thread-1',
      'turn-1',
      'reasoning-1',
      ['Inspecting the renderer', '', 'Checking the event flow'],
    );
    expect(first[0]?.parts).toStrictEqual([
      {
        type: 'reasoning',
        summary: 'Inspecting the renderer',
        itemId: 'reasoning-1',
        summaryIndex: 0,
      },
      {
        type: 'reasoning',
        summary: 'Checking the event flow',
        itemId: 'reasoning-1',
        summaryIndex: 2,
      },
    ]);

    const replaced = upsertAssistantReasoningSummaries(
      first,
      'thread-1',
      'turn-1',
      'reasoning-1',
      ['Verified the renderer'],
    );
    expect(replaced[0]?.parts).toStrictEqual([{
      type: 'reasoning',
      summary: 'Verified the renderer',
      itemId: 'reasoning-1',
      summaryIndex: 0,
    }]);
  });

  it('replaces only the matching reasoning item in its original ordered position', () => {
    const wrongTurn = assistant('wrong-turn', [{
      type: 'reasoning', summary: 'Wrong turn', itemId: 'reasoning-1', summaryIndex: 0,
    }], 'complete', 'turn-other');
    const compaction = {
      ...assistant('compaction', [{
        type: 'reasoning', summary: 'Compaction', itemId: 'reasoning-1', summaryIndex: 0,
      }]),
      kind: 'compaction' as const,
    };
    const target = assistant('target', [
      { type: 'text', text: 'Before' },
      toolPart('tool-before'),
      { type: 'reasoning', summary: 'Old first', itemId: 'reasoning-1', summaryIndex: 0 },
      toolPart('tool-1'),
      { type: 'reasoning', summary: 'Other', itemId: 'reasoning-other', summaryIndex: 0 },
      { type: 'reasoning', summary: 'Old second', itemId: 'reasoning-1', summaryIndex: 1 },
      { type: 'text', text: 'After' },
    ]);
    const result = upsertAssistantReasoningSummaries(
      [target, user('user-1'), wrongTurn, compaction],
      'thread-1',
      'turn-1',
      'reasoning-1',
      ['  New first  ', '   ', 'New second'],
    );

    expect(result[0]).toStrictEqual({
      ...target,
      status: 'streaming',
      parts: [
        { type: 'text', text: 'Before' },
        toolPart('tool-before'),
        { type: 'reasoning', summary: 'New first', itemId: 'reasoning-1', summaryIndex: 0 },
        { type: 'reasoning', summary: 'New second', itemId: 'reasoning-1', summaryIndex: 2 },
        toolPart('tool-1'),
        { type: 'reasoning', summary: 'Other', itemId: 'reasoning-other', summaryIndex: 0 },
        { type: 'text', text: 'After' },
      ],
    });
    expect(result.slice(1)).toStrictEqual([user('user-1'), wrongTurn, compaction]);
  });

  it('ignores empty reasoning updates without creating or changing a message', () => {
    const messages = [user('user-1')];
    const result = upsertAssistantReasoningSummaries(
      messages, 'thread-1', 'turn-1', 'reasoning-1', ['', '   '],
    );

    expect(result).toStrictEqual(messages);
    expect(result).not.toBe(messages);
    expect(result[0]).toBe(messages[0]);
  });

  it('inserts and merges tool parts while preserving incremental fields', () => {
    const runningStatus = JSON.stringify({
      action: 'run',
      phase: 'running',
      source: 'codex',
    });
    const first = upsertAssistantToolPart([], 'thread-1', 'turn-1', toolPart('tool-1', {
      body: 'body',
      input: { query: 'one' },
      output: { found: 1 },
      statusText: runningStatus,
      metadata: { server: 'drive' },
    }));
    const running = upsertAssistantToolPart(first, 'thread-1', 'turn-1', toolPart('tool-1', {
      title: 'Updated',
      metadata: { tool: 'search' },
    }));
    expect(running[0]?.parts[0]).toStrictEqual(toolPart('tool-1', {
      title: 'Updated',
      body: 'body',
      input: { query: 'one' },
      output: { found: 1 },
      statusText: runningStatus,
      metadata: { server: 'drive', tool: 'search' },
    }));

    const completed = upsertAssistantToolPart(running, 'thread-1', 'turn-1', toolPart('tool-1', {
      title: 'Done',
      status: 'completed',
    }));
    expect(completed[0]?.parts[0]).toMatchObject({
      status: 'completed',
      statusText: JSON.stringify({ action: 'run', phase: 'completed', source: 'codex' }),
      body: 'body',
    });
  });

  it('updates every optional tool field and supports a fallback insertion', () => {
    const missing = updateAssistantToolPart([], 'thread-1', 'turn-1', { itemId: 'missing' });
    expect(missing).toStrictEqual([]);

    const inserted = updateAssistantToolPart([], 'thread-1', 'turn-1', {
      itemId: 'tool-1',
      fallbackToolPart: toolPart('tool-1'),
      title: 'Renamed',
      status: 'completed',
      statusText: null,
      body: 'base',
      bodyDelta: '+delta',
      bodyAppend: 'append',
      input: { value: 1 },
      output: { value: 2 },
      metadata: { phase: 'done' },
    });
    expect(inserted[0]?.parts[0]).toStrictEqual(toolPart('tool-1', {
      title: 'Renamed',
      status: 'completed',
      statusText: undefined,
      body: 'append',
      input: { value: 1 },
      output: { value: 2 },
      metadata: { phase: 'done' },
    }));

    const appendedWithoutBody = updateAssistantToolPart(
      [assistant('assistant-turn-1', [toolPart('tool-2')])],
      'thread-1',
      'turn-1',
      { itemId: 'tool-2', bodyAppend: 'first' },
    );
    expect(appendedWithoutBody[0]?.parts[0]).toMatchObject({ body: 'first' });

    const bodyUpdates = [assistant('assistant-turn-1', [toolPart('tool-3', { body: 'old' })])];
    expect(updateAssistantToolPart(bodyUpdates, 'thread-1', 'turn-1', {
      itemId: 'tool-3', body: 'replaced',
    })[0]?.parts[0]).toMatchObject({ body: 'replaced' });
    expect(updateAssistantToolPart(bodyUpdates, 'thread-1', 'turn-1', {
      itemId: 'tool-3', bodyDelta: '+delta',
    })[0]?.parts[0]).toMatchObject({ body: 'old+delta' });
    expect(updateAssistantToolPart(bodyUpdates, 'thread-1', 'turn-1', {
      itemId: 'tool-3', statusText: 'updated',
    })[0]?.parts[0]).toMatchObject({ statusText: 'updated' });
  });

  it('places media beside its associated tool and replaces matching media', () => {
    const base = [assistant('assistant-turn-1', [toolPart('image-tool')])];
    const media = mediaPart('image-tool', 'data:image/png;base64,one');
    const besideTool = upsertAssistantMediaPart(base, 'thread-1', 'turn-1', media);
    expect(besideTool[0]?.parts).toStrictEqual([toolPart('image-tool'), media]);

    const replacement = mediaPart('image-tool', 'data:image/png;base64,two');
    const replaced = upsertAssistantMediaPart(besideTool, 'thread-1', 'turn-1', replacement);
    expect(replaced[0]?.parts).toStrictEqual([toolPart('image-tool'), replacement]);

    const standalone = upsertAssistantMediaPart([], 'thread-1', 'turn-1', mediaPart(undefined, 'https://example.com/a'));
    expect(standalone[0]?.parts).toHaveLength(1);
    expect(surfaceMediaPartsEqual(replacement, { ...replacement })).toBe(true);
    expect(surfaceMediaPartsEqual(replacement, { ...replacement, itemId: 'other' })).toBe(false);
    expect(surfaceMediaPartsEqual(replacement, mediaPart('image-tool', 'different'))).toBe(false);
    expect(surfaceMediaPartsEqual(replacement, { ...replacement, media: { ...replacement.media, alt: 'other' } }))
      .toBe(false);
  });

  it('adds one compaction marker and closes or removes the active segment', () => {
    const empty = [assistant('assistant-turn-1', [])];
    const afterEmpty = appendCompactionMarker(empty, 'thread-1', 'turn-1');
    expect(afterEmpty).toHaveLength(1);
    expect(afterEmpty[0]).toMatchObject({ id: 'compaction-turn-1', kind: 'compaction' });
    expect(appendCompactionMarker(afterEmpty, 'thread-1', 'turn-1')).toStrictEqual(afterEmpty);

    const nonEmpty = [assistant('assistant-turn-1', [{ type: 'text', text: 'before' }])];
    const afterText = appendCompactionMarker(nonEmpty, 'thread-1', 'turn-1');
    expect(afterText[0]?.status).toBe('complete');
    expect(afterText[1]).toMatchObject({ kind: 'compaction', status: 'streaming' });
  });

  it('finalizes only running tools in the selected turn', () => {
    const messages = [
      assistant('assistant-turn-1', [
        toolPart('json', { statusText: JSON.stringify({ label: 'editing', phase: 'running' }) }),
        toolPart('invalid', { statusText: '{bad json' }),
        toolPart('primitive', { statusText: '3' }),
        toolPart('empty'),
        toolPart('already-done', { status: 'completed' }),
        { type: 'text' as const, text: 'answer' },
      ]),
      assistant('assistant-turn-2', [toolPart('other')], 'streaming', 'turn-2'),
    ];
    const completed = finalizeTurnToolParts(messages, 'turn-1', 'completed');
    expect(completed[0]?.parts).toMatchObject([
      { status: 'completed', statusText: JSON.stringify({ label: 'editing', phase: 'completed' }) },
      { status: 'completed', statusText: '{bad json' },
      { status: 'completed', statusText: '3' },
      { status: 'completed', statusText: undefined },
      { status: 'completed' },
      { type: 'text' },
    ]);
    expect(completed[1]).toBe(messages[1]);

    const failed = finalizeTurnToolParts(messages, 'turn-1', 'failed');
    expect(failed[0]?.parts[0]).toMatchObject({
      status: 'failed',
      statusText: JSON.stringify({ label: 'editing', phase: 'failed' }),
    });
  });

  it('prunes only obsolete empty assistant placeholders for one thread', () => {
    const messages: SurfaceMessage[] = [
      assistant('empty-old', []),
      assistant('empty-other-thread', [], 'streaming', 'turn-1', { conversationId: 'thread-2' }),
      { ...assistant('marker', []), kind: 'compaction' },
      assistant('nonempty', [{ type: 'text', text: 'keep' }]),
      user('user-last'),
    ];

    expect(pruneEmptyAssistantPlaceholders(messages, 'thread-1').map((message) => message.id))
      .toStrictEqual(['empty-other-thread', 'marker', 'nonempty', 'user-last']);
    expect(pruneEmptyAssistantPlaceholders([], 'thread-1')).toStrictEqual([]);
  });

  it('adds values only once without returning the original array', () => {
    const values = ['one'];
    expect(addUnique(values, 'two')).toStrictEqual(['one', 'two']);
    const duplicate = addUnique(values, 'one');
    expect(duplicate).toStrictEqual(['one']);
    expect(duplicate).not.toBe(values);
  });

  it('selects assistant segments by exact role, kind, turn, and status', () => {
    const decoys: SurfaceMessage[] = [
      { ...user('user-current'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...assistant('compaction', [], 'streaming'), kind: 'compaction' },
      assistant('completed-current', [{ type: 'text', text: 'done' }], 'complete'),
      assistant('streaming-current', [{ type: 'text', text: 'live' }]),
      { ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    expect(ensureAssistantTurnMessage(decoys, 'thread-1', 'turn-1')).toStrictEqual(decoys);

    const forced = ensureAssistantTurnMessage(decoys, 'thread-1', 'turn-1', {
      forceSegment: true, createdAt: '2026-02-01T00:00:00.000Z',
    });
    expect(forced).toStrictEqual([
      decoys[0], decoys[1], decoys[2], decoys[3], { ...decoys[4]!, status: 'complete' }, decoys[5],
      assistant('assistant-turn-1-segment-2', [], 'streaming', 'turn-1', {
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
    ]);
  });

  it('removes only the prior empty assistant when forcing a segment', () => {
    const messages = [
      assistant('empty-other-turn', [], 'streaming', 'turn-2'),
      assistant('empty-current', []),
      { ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const result = ensureAssistantTurnMessage(messages, 'thread-1', 'turn-1', {
      forceSegment: true, createdAt: 'fixed',
    });
    expect(result.map((message) => message.id)).toStrictEqual([
      'empty-other-turn', 'boundary', 'assistant-turn-1',
    ]);
    expect(result.at(-1)).toStrictEqual(assistant('assistant-turn-1', [], 'streaming', 'turn-1', {
      createdAt: 'fixed',
    }));
  });

  it('appends deltas only to the last exact assistant segment and prunes old empty placeholders', () => {
    const messages: SurfaceMessage[] = [
      assistant('empty-old', []),
      assistant('other-turn', [{ type: 'text', text: 'other', itemId: 'item-1' }], 'streaming', 'turn-2'),
      { ...assistant('marker', [], 'streaming'), kind: 'compaction' },
      assistant('active', [
        { type: 'text', text: 'prefix', itemId: 'item-1' }, toolPart('tool-1'),
      ]),
    ];
    const result = appendAssistantTextDelta(messages, 'thread-1', 'turn-1', 'item-1', 'delta');
    expect(result.map((message) => message.id)).toStrictEqual(['other-turn', 'marker', 'active']);
    expect(result.at(-1)?.parts).toStrictEqual([
      { type: 'text', text: 'prefix', itemId: 'item-1' }, toolPart('tool-1'),
      { type: 'text', text: 'delta', itemId: 'item-1' },
    ]);
  });

  it('updates only the matching text part in the latest matching assistant message', () => {
    const messages: SurfaceMessage[] = [
      assistant('older', [{ type: 'text', text: 'older', itemId: 'target' }]),
      assistant('other-turn', [{ type: 'text', text: 'other', itemId: 'target' }], 'streaming', 'turn-2'),
      { ...user('user-decoy'), parts: [{ type: 'text', text: 'user', itemId: 'target' }] },
      assistant('latest', [
        mediaPart('target', 'data:image/png;base64,AA=='),
        { type: 'text', text: 'latest', itemId: 'target' },
      ]),
    ];
    const result = upsertAssistantText(messages, 'thread-1', 'turn-1', 'target', 'replacement', 'commentary');
    expect(result.slice(0, 3)).toStrictEqual(messages.slice(0, 3));
    expect(result[3]?.parts).toStrictEqual([
      mediaPart('target', 'data:image/png;base64,AA=='),
      { type: 'text', text: 'replacement', itemId: 'target', phase: 'commentary' },
    ]);
  });

  it('selects tools by exact assistant, turn, type, and id and appends otherwise', () => {
    const messages: SurfaceMessage[] = [
      { ...user('user-decoy'), parts: [toolPart('target')] },
      assistant('other-turn', [toolPart('target')], 'streaming', 'turn-2'),
      assistant('current', [
        { type: 'text', text: 'target', itemId: 'target' }, toolPart('other'),
      ]),
    ];
    const target = toolPart('target', { title: 'Target', body: 'body' });
    const result = upsertAssistantToolPart(messages, 'thread-1', 'turn-1', target);
    expect(result.slice(0, 2)).toStrictEqual(messages.slice(0, 2));
    expect(result[2]?.parts).toStrictEqual([
      { type: 'text', text: 'target', itemId: 'target' }, toolPart('other'), target,
    ]);
  });

  it('selects media and associated tools by exact assistant, turn, type, and item id', () => {
    const target = mediaPart('target', 'data:image/png;base64,target');
    const messages: SurfaceMessage[] = [
      { ...user('user-decoy'), parts: [mediaPart('target', 'data:image/png;base64,user')] },
      assistant('other-turn', [mediaPart('target', 'data:image/png;base64,other')], 'streaming', 'turn-2'),
      assistant('current', [
        { type: 'text', text: 'decoy', itemId: 'target' }, toolPart('other'), toolPart('target'),
      ]),
    ];
    const result = upsertAssistantMediaPart(messages, 'thread-1', 'turn-1', target);
    expect(result.slice(0, 2)).toStrictEqual(messages.slice(0, 2));
    expect(result[2]?.parts).toStrictEqual([
      { type: 'text', text: 'decoy', itemId: 'target' }, toolPart('other'), toolPart('target'), target,
    ]);
    const replacement = { ...target, media: { ...target.media, url: 'data:image/png;base64,replaced' } };
    const replaced = upsertAssistantMediaPart(result, 'thread-1', 'turn-1', replacement);
    expect(replaced[2]?.parts).toHaveLength(4);
    expect(replaced[2]?.parts[3]).toStrictEqual(replacement);
  });

  it('compares every observable media field', () => {
    const base = mediaPart('image', 'https://example.com/image.png');
    const changes: SurfaceMessageMediaPart[] = [
      { ...base, itemId: 'other' },
      { ...base, media: { ...base.media, url: 'https://example.com/other.png' } },
      { ...base, media: { ...base.media, alt: 'Other' } },
      { ...base, media: { ...base.media, mimeType: 'image/jpeg' } },
      { ...base, media: { ...base.media, prompt: 'Other' } },
      { ...base, media: { ...base.media, title: 'Other' } },
    ];
    expect(changes.map((candidate) => surfaceMediaPartsEqual(base, candidate)))
      .toStrictEqual([false, false, false, false, false, false]);
    expect(surfaceMediaPartsEqual(base, structuredClone(base))).toBe(true);
  });

  it('updates only the exact tool and preserves every omitted field', () => {
    const existing = toolPart('target', {
      title: 'Original', status: 'running', statusText: 'plain', body: 'body',
      input: { before: true }, output: { before: true }, metadata: { before: true },
    });
    const messages: SurfaceMessage[] = [
      { ...user('user-decoy'), parts: [toolPart('target')] },
      assistant('other-turn', [toolPart('target')], 'streaming', 'turn-2'),
      assistant('current', [
        { type: 'text', text: 'decoy', itemId: 'target' }, toolPart('other'), existing,
      ]),
    ];
    const result = updateAssistantToolPart(messages, 'thread-1', 'turn-1', {
      itemId: 'target', status: 'completed', metadata: { after: true },
    });
    expect(result.slice(0, 2)).toStrictEqual(messages.slice(0, 2));
    expect(result[2]?.parts).toStrictEqual([
      { type: 'text', text: 'decoy', itemId: 'target' }, toolPart('other'),
      { ...existing, status: 'completed', metadata: { before: true, after: true } },
    ]);
  });

  it('compacts only the last ordinary assistant in the requested turn', () => {
    const metadataFreeMarker = {
      ...assistant('marker-decoy', [], 'streaming'), kind: 'compaction' as const,
    };
    delete metadataFreeMarker.metadata;
    const messages: SurfaceMessage[] = [
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      metadataFreeMarker,
      assistant('older-current', [{ type: 'text', text: 'older' }]),
      { ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
      assistant('latest-current', [{ type: 'text', text: 'latest' }]),
    ];
    const result = appendCompactionMarker(messages, 'thread-1', 'turn-1');
    expect(result.map((message) => [message.id, message.status])).toStrictEqual([
      ['other-turn', 'streaming'], ['marker-decoy', 'streaming'], ['older-current', 'streaming'],
      ['boundary', 'complete'], ['latest-current', 'complete'], ['compaction-turn-1', 'streaming'],
    ]);
    expect(result.at(-1)).toMatchObject({
      id: 'compaction-turn-1', kind: 'compaction', role: 'assistant', status: 'streaming',
      turnId: 'turn-1', parts: [], metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    });
  });

  it('keeps the last relevant empty message and every independently protected message', () => {
    const messages: SurfaceMessage[] = [
      assistant('remove-empty', []),
      assistant('keep-other-thread', [], 'streaming', 'turn-1', { conversationId: 'thread-2' }),
      { ...assistant('keep-user', []), role: 'user' },
      { ...assistant('keep-kind', []), kind: 'compaction' },
      assistant('keep-parts', [{ type: 'text', text: 'content' }]),
      assistant('keep-last-empty', []),
    ];
    expect(pruneEmptyAssistantPlaceholders(messages, 'thread-1').map((message) => message.id))
      .toStrictEqual(['keep-other-thread', 'keep-user', 'keep-kind', 'keep-parts', 'keep-last-empty']);
  });

  it('formats plan markdown and exposes the complete plan progress contract', () => {
    expect(formatPlanMarkdown('  Why  ', [
      { step: 'Done', status: 'completed' },
      { step: 'Doing', status: 'inProgress' },
      { step: 'Pending', status: 'pending' },
    ])).toBe('Why\n- [x] Done\n- [ ] Doing\n- [ ] Pending');
    expect(formatPlanMarkdown(null, [])).toBe('');
    expect(formatPlanMarkdown('   ', [{ step: 'Only', status: 'completed' }])).toBe('- [x] Only');
    expect(planProgressToolPart('turn-1', 'First\n\n Second ', 'running')).toStrictEqual({
      type: 'tool', id: 'plan-progress-turn-1', kind: 'generic', title: 'plan', status: 'running',
      body: 'First\n\n Second ',
      statusText: JSON.stringify({
        source: 'codex', action: 'plan', phase: 'running',
        params: { addedLines: 2, operation: 'write', target: 'plan' },
      }),
      metadata: { planProgress: true },
    });
  });

  it('finds an active turn across sparse and undefined turn entries', () => {
    const turns = new Array<v2.Turn>(4);
    turns[0] = { id: 'old-active', status: 'inProgress' } as v2.Turn;
    turns[2] = { id: 'done', status: 'completed' } as v2.Turn;
    expect(activeTurnId(turns)).toBe('old-active');
  });

  it('updates the exact existing tool instead of matching role, turn, type, or id decoys', () => {
    const metadataFree = { ...assistant('metadata-free', [toolPart('target')]) };
    delete metadataFree.metadata;
    const target = toolPart('target', { title: 'Before', body: 'before' });
    const messages: SurfaceMessage[] = [
      metadataFree,
      { ...user('user-target'), parts: [toolPart('target')] },
      assistant('other-turn-target', [toolPart('target')], 'streaming', 'turn-2'),
      assistant('wrong-type', [{ type: 'text', text: 'decoy', itemId: 'target' }]),
      assistant('wrong-id', [toolPart('other')]),
      assistant('right', [target]),
    ];
    const replacement = toolPart('target', { title: 'After', status: 'completed' });
    const result = upsertAssistantToolPart(messages, 'thread-1', 'turn-1', replacement);
    expect(result.slice(0, -1)).toStrictEqual(messages.slice(0, -1));
    expect(result.at(-1)?.parts).toStrictEqual([
      {
        ...target, ...replacement, body: 'before', input: undefined, output: undefined,
        statusText: undefined, metadata: {},
      },
    ]);
  });

  it('updates the exact existing media instead of matching role, turn, type, or id decoys', () => {
    const metadataFree = { ...assistant('metadata-free', [mediaPart('target', 'metadata-free')]) };
    delete metadataFree.metadata;
    const existing = mediaPart('target', 'before');
    const messages: SurfaceMessage[] = [
      metadataFree,
      { ...user('user-target'), parts: [mediaPart('target', 'user')] },
      assistant('other-turn-target', [mediaPart('target', 'other')], 'streaming', 'turn-2'),
      assistant('wrong-type', [{ type: 'text', text: 'decoy', itemId: 'target' }]),
      assistant('wrong-id', [mediaPart('other', 'wrong')]),
      assistant('right', [existing]),
    ];
    const replacement = mediaPart('target', 'after');
    const result = upsertAssistantMediaPart(messages, 'thread-1', 'turn-1', replacement);
    expect(result.slice(0, -1)).toStrictEqual(messages.slice(0, -1));
    expect(result.at(-1)?.parts).toStrictEqual([replacement]);
  });

  it('associates new media only with the exact current-turn tool', () => {
    const metadataFree = { ...assistant('metadata-free', [toolPart('target')]) };
    delete metadataFree.metadata;
    const messages: SurfaceMessage[] = [
      metadataFree,
      { ...user('user-target'), parts: [toolPart('target')] },
      assistant('other-turn-target', [toolPart('target')], 'streaming', 'turn-2'),
      assistant('wrong-type', [{ type: 'text', text: 'decoy', itemId: 'target' }]),
      assistant('wrong-id', [toolPart('other')]),
      assistant('right', [toolPart('target')]),
    ];
    const media = mediaPart('target', 'after');
    const result = upsertAssistantMediaPart(messages, 'thread-1', 'turn-1', media);
    expect(result.slice(0, -1)).toStrictEqual(messages.slice(0, -1));
    expect(result.at(-1)?.parts).toStrictEqual([toolPart('target'), media]);
  });

  it('applies a tool update only to the exact current-turn tool', () => {
    const metadataFree = { ...assistant('metadata-free', [toolPart('target')]) };
    delete metadataFree.metadata;
    const messages: SurfaceMessage[] = [
      metadataFree,
      { ...user('user-target'), parts: [toolPart('target')] },
      assistant('other-turn-target', [toolPart('target')], 'streaming', 'turn-2'),
      assistant('wrong-type', [{ type: 'text', text: 'decoy', itemId: 'target' }]),
      assistant('wrong-id', [toolPart('other')]),
      assistant('right', [toolPart('target', { body: 'before' })]),
    ];
    const result = updateAssistantToolPart(messages, 'thread-1', 'turn-1', {
      itemId: 'target', bodyDelta: '+after', status: 'completed',
    });
    expect(result.slice(0, -1)).toStrictEqual(messages.slice(0, -1));
    expect(result.at(-1)?.parts).toStrictEqual([
      toolPart('target', { body: 'before+after', status: 'completed' }),
    ]);
  });

  it('deduplicates only an exact compaction marker for the requested turn', () => {
    const metadataFree = { ...assistant('metadata-free', []), kind: 'compaction' as const };
    delete metadataFree.metadata;
    const messages: SurfaceMessage[] = [
      metadataFree,
      { ...assistant('wrong-kind', []), kind: 'other' as never },
      { ...assistant('wrong-turn', [], 'streaming', 'turn-2'), kind: 'compaction' },
      { ...assistant('exact', []), kind: 'compaction' },
    ];
    const result = appendCompactionMarker(messages, 'thread-1', 'turn-1');
    expect(result).toStrictEqual(messages);
    expect(result).not.toBe(messages);
  });

  it('leaves selected-turn messages unchanged when they have no running tools', () => {
    const noRunningTools = assistant('no-running', [
      { type: 'text', text: 'answer' }, toolPart('done', { status: 'completed' }),
    ]);
    const result = finalizeTurnToolParts([noRunningTools], 'turn-1', 'failed');
    expect(result[0]).toBe(noRunningTools);
    expect(result[0]?.parts).toStrictEqual([
      { type: 'text', text: 'answer' }, toolPart('done', { status: 'completed' }),
    ]);
  });

  it('appends a delta to the intended assistant when later messages are selector decoys', () => {
    const intended = assistant('intended', [{ type: 'text', text: 'before', itemId: 'target' }]);
    const messages: SurfaceMessage[] = [
      intended,
      { ...assistant('compaction', [], 'streaming'), kind: 'compaction' },
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...user('current-user'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const result = appendAssistantTextDelta(messages, 'thread-1', 'turn-1', 'target', '+after');
    expect(result[0]?.parts).toStrictEqual([{ type: 'text', text: 'before+after', itemId: 'target' }]);
    expect(result.slice(1)).toStrictEqual(messages.slice(1));
  });

  it('inserts text into the intended assistant when later messages are selector decoys', () => {
    const intended = assistant('intended', [{ type: 'text', text: 'existing', itemId: 'other' }]);
    const messages: SurfaceMessage[] = [
      intended,
      { ...assistant('compaction', [], 'streaming'), kind: 'compaction' },
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...user('current-user'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const result = upsertAssistantText(messages, 'thread-1', 'turn-1', 'target', 'inserted');
    expect(result[0]?.parts).toStrictEqual([
      { type: 'text', text: 'existing', itemId: 'other' },
      { type: 'text', text: 'inserted', itemId: 'target' },
    ]);
    expect(result.slice(1)).toStrictEqual(messages.slice(1));
  });

  it('updates an existing tool in an earlier segment rather than duplicating it in the latest segment', () => {
    const messages = [
      assistant('earlier', [toolPart('target', { body: 'before' })], 'complete'),
      assistant('latest', [{ type: 'text', text: 'later' }]),
    ];
    const result = upsertAssistantToolPart(messages, 'thread-1', 'turn-1',
      toolPart('target', { status: 'completed' }));
    expect(result[0]?.parts).toStrictEqual([
      expect.objectContaining({ id: 'target', body: 'before', status: 'completed' }),
    ]);
    expect(result[1]).toStrictEqual(messages[1]);
  });

  it('inserts a new tool into the intended assistant when later messages are selector decoys', () => {
    const intended = assistant('intended', [{ type: 'text', text: 'existing' }]);
    const messages: SurfaceMessage[] = [
      intended,
      { ...assistant('compaction', [], 'streaming'), kind: 'compaction' },
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...user('current-user'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const target = toolPart('target');
    const result = upsertAssistantToolPart(messages, 'thread-1', 'turn-1', target);
    expect(result[0]?.parts).toStrictEqual([{ type: 'text', text: 'existing' }, target]);
    expect(result.slice(1)).toStrictEqual(messages.slice(1));
  });

  it('updates existing media in an earlier segment rather than duplicating it in the latest segment', () => {
    const messages = [
      assistant('earlier', [mediaPart('target', 'before')], 'complete'),
      assistant('latest', [{ type: 'text', text: 'later' }]),
    ];
    const replacement = mediaPart('target', 'after');
    const result = upsertAssistantMediaPart(messages, 'thread-1', 'turn-1', replacement);
    expect(result[0]?.parts).toStrictEqual([replacement]);
    expect(result[1]).toStrictEqual(messages[1]);
  });

  it('inserts standalone media into the intended assistant when later messages are selector decoys', () => {
    const intended = assistant('intended', [{ type: 'text', text: 'existing' }]);
    const messages: SurfaceMessage[] = [
      intended,
      { ...assistant('compaction', [], 'streaming'), kind: 'compaction' },
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...user('current-user'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const media = mediaPart(undefined, 'standalone');
    const result = upsertAssistantMediaPart(messages, 'thread-1', 'turn-1', media);
    expect(result[0]?.parts).toStrictEqual([{ type: 'text', text: 'existing' }, media]);
    expect(result.slice(1)).toStrictEqual(messages.slice(1));
  });

  it('closes the intended assistant during compaction when later messages are selector decoys', () => {
    const intended = assistant('intended', [{ type: 'text', text: 'existing' }]);
    const messages: SurfaceMessage[] = [
      intended,
      { ...assistant('other-kind', [{ type: 'text', text: 'kind' }]), kind: 'marker' as never },
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...user('current-user'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const result = appendCompactionMarker(messages, 'thread-1', 'turn-1');
    expect(result[0]).toStrictEqual({ ...intended, status: 'complete' });
    expect(result.slice(1, -1)).toStrictEqual(messages.slice(1));
    expect(result.at(-1)).toMatchObject({ id: 'compaction-turn-1', kind: 'compaction' });
  });

  it('creates a segment when the last current-turn message fails exactly one assistant invariant', () => {
    const cases: SurfaceMessage[] = [
      {
        id: 'wrong-role', role: 'user', status: 'streaming', parts: [], turnId: 'turn-1',
        metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
      },
      { ...assistant('wrong-kind', []), kind: 'compaction' },
      assistant('wrong-status', [], 'complete'),
    ];
    for (const candidate of cases) {
      const result = ensureAssistantTurnMessage([candidate], 'thread-1', 'turn-1', { createdAt: 'fixed' });
      expect(result).toHaveLength(2);
      const id = candidate.id === 'wrong-status' ? 'assistant-turn-1-segment-1' : 'assistant-turn-1';
      expect(result.at(-1)).toStrictEqual(assistant(id, [], 'streaming', 'turn-1', {
        createdAt: 'fixed',
      }));
    }
  });

  it('reuses an earlier streaming assistant when a later current-turn user message exists', () => {
    const existing = assistant('existing', [{ type: 'text', text: 'live' }]);
    const boundary = {
      ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    };
    const messages = [existing, boundary];
    const result = ensureAssistantTurnMessage(messages, 'thread-1', 'turn-1');
    expect(result).toStrictEqual(messages);
    expect(result).not.toBe(messages);
  });

  it('ignores metadata-free assistant decoys in every last-message selector', () => {
    const metadataFree = assistant('metadata-free', [{ type: 'text', text: 'decoy' }]);
    delete metadataFree.metadata;
    const boundary = {
      ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    };

    const ensured = ensureAssistantTurnMessage([metadataFree, boundary], 'thread-1', 'turn-1', {
      createdAt: 'fixed',
    });
    expect(ensured.at(-1)).toStrictEqual(assistant('assistant-turn-1', [], 'streaming', 'turn-1', {
      createdAt: 'fixed',
    }));

    const intended = assistant('intended', [{ type: 'text', text: 'before', itemId: 'target' }]);
    const withDecoy = [intended, metadataFree, boundary];
    expect(appendAssistantTextDelta(withDecoy, 'thread-1', 'turn-1', 'target', '+after')[0]?.parts)
      .toStrictEqual([{ type: 'text', text: 'before+after', itemId: 'target' }]);
    expect(upsertAssistantText(withDecoy, 'thread-1', 'turn-1', 'new', 'inserted')[0]?.parts)
      .toStrictEqual([
        { type: 'text', text: 'before', itemId: 'target' },
        { type: 'text', text: 'inserted', itemId: 'new' },
      ]);
    expect(upsertAssistantToolPart(withDecoy, 'thread-1', 'turn-1', toolPart('new'))[0]?.parts)
      .toStrictEqual([{ type: 'text', text: 'before', itemId: 'target' }, toolPart('new')]);
    expect(upsertAssistantMediaPart(withDecoy, 'thread-1', 'turn-1', mediaPart(undefined, 'new'))[0]?.parts)
      .toStrictEqual([
        { type: 'text', text: 'before', itemId: 'target' }, mediaPart(undefined, 'new'),
      ]);
  });

  it('preserves running status text and blank terminal status text exactly', () => {
    const runningStatus = JSON.stringify({ action: 'run', phase: 'running' });
    const running = upsertAssistantToolPart(
      [assistant('message', [toolPart('tool', { statusText: runningStatus })])],
      'thread-1', 'turn-1', toolPart('tool', { status: 'running' }),
    );
    expect(running[0]?.parts[0]).toMatchObject({ status: 'running', statusText: runningStatus });

    const completed = upsertAssistantToolPart(
      [assistant('message', [toolPart('tool', { statusText: '' })])],
      'thread-1', 'turn-1', toolPart('tool', { status: 'completed' }),
    );
    expect(completed[0]?.parts[0]).toMatchObject({ status: 'completed', statusText: '' });

    const priorCompletedStatus = JSON.stringify({ action: 'run', phase: 'completed' });
    const restarted = upsertAssistantToolPart(
      [assistant('message', [toolPart('tool', { status: 'completed', statusText: priorCompletedStatus })])],
      'thread-1', 'turn-1', toolPart('tool', { status: 'running' }),
    );
    expect(restarted[0]?.parts[0]).toMatchObject({
      status: 'running', statusText: priorCompletedStatus,
    });
  });

  it('does not count whitespace-only lines as plan progress', () => {
    const part = planProgressToolPart('turn-1', 'First\n   \nSecond', 'completed');
    expect(JSON.parse(part.statusText ?? '{}')).toMatchObject({
      phase: 'completed', params: { addedLines: 2 },
    });
  });

  it('does not force a new segment while the last current-turn assistant is still streaming', () => {
    const current = assistant('current', [{ type: 'text', text: 'live' }]);
    const result = ensureAssistantTurnMessage([current], 'thread-1', 'turn-1', {
      forceSegment: true, createdAt: 'unused',
    });
    expect(result).toStrictEqual([current]);
  });

  it('forces a segment from the exact prior assistant despite later selector decoys', () => {
    const prior = assistant('prior', [{ type: 'text', text: 'answer' }]);
    const metadataFree = assistant('metadata-free', [{ type: 'text', text: 'decoy' }]);
    delete metadataFree.metadata;
    const messages: SurfaceMessage[] = [
      prior,
      metadataFree,
      assistant('other-turn', [{ type: 'text', text: 'other' }], 'streaming', 'turn-2'),
      { ...assistant('wrong-kind', [{ type: 'text', text: 'marker' }]), kind: 'compaction' },
      { ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' } },
    ];
    const result = ensureAssistantTurnMessage(messages, 'thread-1', 'turn-1', {
      forceSegment: true, createdAt: 'fixed',
    });
    expect(result[0]).toStrictEqual({ ...prior, status: 'complete' });
    expect(result.slice(1, -1)).toStrictEqual(messages.slice(1));
    expect(result.at(-1)).toMatchObject({ status: 'streaming', createdAt: 'fixed' });
  });

  it('updates earlier assistant text instead of a later matching user or other-turn part', () => {
    const messages: SurfaceMessage[] = [
      assistant('right', [{ type: 'text', text: 'before', itemId: 'target' }]),
      assistant('other-turn', [{ type: 'text', text: 'other', itemId: 'target' }], 'streaming', 'turn-2'),
      {
        ...user('user-target'), turnId: 'turn-1', parts: [{ type: 'text', text: 'user', itemId: 'target' }],
        metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
      },
    ];
    const result = upsertAssistantText(messages, 'thread-1', 'turn-1', 'target', 'after');
    expect(result[0]?.parts).toStrictEqual([{ type: 'text', text: 'after', itemId: 'target' }]);
    expect(result.slice(1)).toStrictEqual(messages.slice(1));
  });

  it('rejects current-turn user tool and media parts from assistant selectors', () => {
    const userTool = {
      ...user('user-tool'), turnId: 'turn-1', parts: [toolPart('target')],
      metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    };
    const rightTool = assistant('right-tool', [toolPart('target', { body: 'before' })]);
    const toolMessages: SurfaceMessage[] = [userTool, rightTool];
    const upserted = upsertAssistantToolPart(
      toolMessages, 'thread-1', 'turn-1', toolPart('target', { status: 'completed' }),
    );
    expect(upserted[0]).toStrictEqual(userTool);
    expect(upserted[1]?.parts[0]).toMatchObject({ body: 'before', status: 'completed' });
    const updated = updateAssistantToolPart(toolMessages, 'thread-1', 'turn-1', {
      itemId: 'target', bodyDelta: '+after',
    });
    expect(updated[0]).toStrictEqual(userTool);
    expect(updated[1]?.parts[0]).toMatchObject({ body: 'before+after' });

    const userMedia = {
      ...user('user-media'), turnId: 'turn-1', parts: [mediaPart('target', 'user')],
      metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    };
    const rightMedia = assistant('right-media', [mediaPart('target', 'before')]);
    const replacement = mediaPart('target', 'after');
    const mediaResult = upsertAssistantMediaPart([userMedia, rightMedia], 'thread-1', 'turn-1', replacement);
    expect(mediaResult[0]).toStrictEqual(userMedia);
    expect(mediaResult[1]?.parts).toStrictEqual([replacement]);

    const associated = upsertAssistantMediaPart([userTool, rightTool], 'thread-1', 'turn-1', replacement);
    expect(associated[0]).toStrictEqual(userTool);
    expect(associated[1]?.parts).toStrictEqual([rightTool.parts[0], replacement]);
  });

  it('ignores a metadata-free ordinary assistant when selecting the segment to compact', () => {
    const right = assistant('right', [{ type: 'text', text: 'answer' }]);
    const metadataFree = assistant('metadata-free', [{ type: 'text', text: 'decoy' }]);
    delete metadataFree.metadata;
    const boundary = {
      ...user('boundary'), turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    };
    const result = appendCompactionMarker([right, metadataFree, boundary], 'thread-1', 'turn-1');
    expect(result[0]).toStrictEqual({ ...right, status: 'complete' });
    expect(result[1]).toStrictEqual(metadataFree);
  });

  it('keeps the last current-thread empty placeholder when another thread follows it', () => {
    const currentLast = assistant('current-last', []);
    const otherLast = assistant('other-last', [], 'streaming', 'turn-1', { conversationId: 'thread-2' });
    expect(pruneEmptyAssistantPlaceholders([
      assistant('current-old', []), currentLast, otherLast,
    ], 'thread-1')).toStrictEqual([currentLast, otherLast]);
  });

  it('skips a trailing metadata-free message when locating the last current-turn message', () => {
    const completed = assistant('completed', [{ type: 'text', text: 'done' }], 'complete');
    const metadataFree = assistant('metadata-free', [{ type: 'text', text: 'decoy' }]);
    delete metadataFree.metadata;
    const result = ensureAssistantTurnMessage([completed, metadataFree], 'thread-1', 'turn-1', {
      createdAt: 'fixed',
    });
    expect(result.at(-1)).toStrictEqual(assistant(
      'assistant-turn-1-segment-1', [], 'streaming', 'turn-1', { createdAt: 'fixed' },
    ));
  });

  it('associates media with an earlier tool segment instead of the latest assistant', () => {
    const toolMessage = assistant('tool-message', [
      { type: 'text', text: 'before' }, toolPart('other'), toolPart('target'),
    ], 'complete');
    const latest = assistant('latest', [{ type: 'text', text: 'later' }]);
    const media = mediaPart('target', 'after');
    const result = upsertAssistantMediaPart([toolMessage, latest], 'thread-1', 'turn-1', media);
    expect(result[0]?.parts).toStrictEqual([
      { type: 'text', text: 'before' }, toolPart('other'), toolPart('target'), media,
    ]);
    expect(result[1]).toStrictEqual(latest);
  });
});

function assistant(
  id: string,
  parts: SurfaceMessage['parts'],
  status: SurfaceMessage['status'] = 'streaming',
  turnId = 'turn-1',
  options: { createdAt?: string; conversationId?: string } = {},
): SurfaceMessage {
  return {
    id,
    role: 'assistant',
    status,
    turnId,
    parts,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    metadata: { conversationId: options.conversationId ?? 'thread-1', turnId },
  };
}

function user(id: string): SurfaceMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    parts: [{ type: 'text', text: id }],
    metadata: { conversationId: 'thread-1' },
  };
}

function toolPart(
  id: string,
  overrides: Partial<SurfaceMessageToolPart> = {},
): SurfaceMessageToolPart {
  return {
    type: 'tool',
    id,
    title: 'Tool',
    status: 'running',
    ...overrides,
  };
}

function mediaPart(itemId: string | undefined, url: string): SurfaceMessageMediaPart {
  return {
    type: 'media',
    itemId,
    media: {
      url,
      alt: 'Generated image',
      mimeType: 'image/png',
      prompt: 'A prompt',
      title: 'Image',
    },
  };
}
