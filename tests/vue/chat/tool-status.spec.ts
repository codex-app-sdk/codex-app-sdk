// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { getToolDisplayTitle, getToolDisplayTitleParts, getToolFallbackTitle, getToolGroupLineDiff, getToolLineDiff, parseToolStatusDescriptor, registerCodexToolTitlePresenter } from '../../../src/vue/chat/tool-status';
import type { MessageToolCall } from '../../../src/vue/chat/types';

describe('tool status helpers', () => {
  it('parses valid status descriptors and rejects invalid values', () => {
    expect(parseToolStatusDescriptor('not json')).toBeUndefined();
    expect(parseToolStatusDescriptor('{"source":"codex"}')).toBeUndefined();
    expect(parseToolStatusDescriptor('{"source":"codex","action":"edit","phase":"done","params":{"addedLines":4}}')).toStrictEqual({
      action: 'edit',
      phase: 'done',
      params: { addedLines: 4 },
      source: 'codex',
    });
    expect(parseToolStatusDescriptor('{"source":"codex","action":"edit","phase":"done","params":[]}')).toStrictEqual({
      action: 'edit',
      phase: 'done',
      params: undefined,
      source: 'codex',
    });
  });

  it('extracts line diffs from descriptor params', () => {
    expect(getToolLineDiff(undefined)).toBeUndefined();
    expect(getToolLineDiff({
      action: 'edit',
      phase: 'done',
      params: { addedLines: 3, removedLines: 1 },
      source: 'codex',
    })).toStrictEqual({ addedLines: 3, removedLines: 1 });
  });

  it('sums line diffs across grouped tool calls', () => {
    const tool = (id: string, addedLines?: number, removedLines?: number): MessageToolCall => ({
      args: undefined,
      done: true,
      function: 'fileChange',
      id,
      result: undefined,
      state: 'completed',
      status: JSON.stringify({
        action: 'edit',
        phase: 'completed',
        source: 'codex',
        params: { addedLines, removedLines },
      }),
    });

    expect(getToolGroupLineDiff([
      tool('one', 31, 26),
      tool('two', 97, 70),
      { ...tool('no-diff'), status: 'completed' },
    ])).toStrictEqual({ addedLines: 128, removedLines: 96 });
    expect(getToolGroupLineDiff([])).toBeUndefined();
  });

  it('formats fallback titles by running state', () => {
    const tool: MessageToolCall = {
      args: undefined,
      function: 'npm test',
      id: 'tool',
      result: undefined,
      state: 'running',
    };

    expect(getToolFallbackTitle(tool)).toBe('Running npm test');
    expect(getToolFallbackTitle({ ...tool, done: true, state: 'completed' })).toBe('Ran npm test');
  });

  it('formats Codex file creation and deletion titles', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'fileChange',
      id: 'tool',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    expect(getToolDisplayTitle(tool, {
      action: 'create',
      phase: 'completed',
      params: { target: 'LISEZMOI.md' },
      source: 'codex',
    })).toBe('Created LISEZMOI.md');

    expect(getToolDisplayTitle(tool, {
      action: 'delete',
      phase: 'completed',
      params: { target: 'old.ts' },
      source: 'codex',
    })).toBe('Deleted old.ts');
  });

  it('derives multi-file edit titles from tool payload paths', () => {
    const tool: MessageToolCall = {
      args: {
        changes: [
          { path: '/workspace/project/app-state.spec.ts' },
          { path: '/workspace/project/ConversationPane.vue' },
        ],
      },
      done: true,
      function: 'fileChange',
      id: 'multi-file-edit',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    expect(getToolDisplayTitle(tool, {
      action: 'edit',
      phase: 'completed',
      params: { addedLines: 31, removedLines: 26, target: '2 files' },
      source: 'codex',
    })).toBe('Edited app-state.spec.ts, ConversationPane.vue');
  });

  it('separates read and file-operation targets for highlighting', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'command',
      id: 'tool',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    expect(getToolDisplayTitleParts(tool, {
      action: 'read',
      phase: 'completed',
      params: { target: 'SKILL.md' },
      source: 'codex',
    })).toStrictEqual({ title: 'Read SKILL.md', prefix: 'Read', target: 'SKILL.md' });

    expect(getToolDisplayTitleParts(tool, {
      action: 'create',
      phase: 'completed',
      params: { target: 'new-file.ts' },
      source: 'codex',
    })).toStrictEqual({ title: 'Created new-file.ts', prefix: 'Created', target: 'new-file.ts' });
  });

  it('formats Codex plan progress titles by operation and phase', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: false,
      function: 'plan',
      id: 'tool',
      result: undefined,
      state: 'running',
      status: 'running',
    };

    expect(getToolDisplayTitle(tool, {
      action: 'plan',
      phase: 'running',
      params: { operation: 'write' },
      source: 'codex',
    })).toBe('Writing plan');
    expect(getToolDisplayTitle({ ...tool, done: true, state: 'completed', status: 'completed' }, {
      action: 'plan',
      phase: 'completed',
      params: { operation: 'update' },
      source: 'codex',
    })).toBe('Updated plan');
  });

  it('includes the target in mixed exploration titles', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'find src -type f | sort',
      id: 'tool',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    expect(getToolDisplayTitle(tool, {
      action: 'explore',
      phase: 'completed',
      params: { actions: ['listFiles', 'search'], target: 'src' },
      source: 'codex',
    })).toBe('Explored src');
  });

  it('keeps exploration titles informative when the target is omitted', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'explore',
      id: 'tool-explore-empty-target',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    expect(getToolDisplayTitle(tool, {
      action: 'explore',
      phase: 'completed',
      params: { actions: ['listFiles', 'search'] },
      source: 'codex',
    })).toBe('Explored listFiles, search');
  });

  it('uses the generic fallback for app-specific tools', () => {
    const tool: MessageToolCall = {
      args: { to: 'Manny' },
      done: true,
      function: 'team.send-message',
      id: 'tool',
      result: undefined,
      state: 'completed',
      status: 'completed',
    };

    expect(getToolDisplayTitle(tool, undefined)).toBe('Ran team.send-message');
  });

  it('lets hosts register and dispose exact tool title presenters', () => {
    const tool: MessageToolCall = {
      args: { target: 'Preview' },
      done: false,
      function: 'host.display',
      id: 'tool',
      result: undefined,
      state: 'running',
      status: 'running',
    };
    const unregister = registerCodexToolTitlePresenter(({ toolCall }) => (
      toolCall.function === 'host.display' ? 'Displaying host preview' : undefined
    ));

    expect(getToolDisplayTitle(tool, undefined)).toBe('Displaying host preview');
    unregister();
    expect(getToolDisplayTitle(tool, undefined)).toBe('Running host.display');
  });
});
