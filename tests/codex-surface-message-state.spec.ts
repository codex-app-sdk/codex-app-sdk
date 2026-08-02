import { describe, expect, it } from 'vitest';
import type { v2 } from '../src/codex';
import type {
  SurfaceMessage,
  SurfaceMessageMediaPart,
  SurfaceMessageToolPart,
} from '../src/surface';
import {
  activeTurnId,
  addUnique,
  appendAssistantTextDelta,
  appendCompactionMarker,
  ensureAssistantTurnMessage,
  finalizeTurnToolParts,
  pruneEmptyAssistantPlaceholders,
  surfaceMediaPartsEqual,
  updateAssistantToolPart,
  upsertAssistantMediaPart,
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
