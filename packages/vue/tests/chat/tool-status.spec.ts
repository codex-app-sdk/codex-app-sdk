// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { defaultToolTranslate, getToolDisplayTargetLink, getToolDisplayTargetParts, getToolDisplayTitle, getToolDisplayTitleParts, getToolFallbackTitle, getToolGroupLineDiff, getToolLineDiff, parseToolStatusDescriptor, registerCodexToolTitlePresenter } from '../../src/chat/tool-status';
import type { MessageToolCall } from '../../src/chat/types';

describe('tool status helpers', () => {
  it('parses valid status descriptors and rejects invalid values', () => {
    expect(parseToolStatusDescriptor(undefined)).toBeUndefined();
    expect(parseToolStatusDescriptor('   ')).toBeUndefined();
    expect(parseToolStatusDescriptor('not json')).toBeUndefined();
    expect(parseToolStatusDescriptor('{')).toBeUndefined();
    expect(parseToolStatusDescriptor('{"source":"codex"}')).toBeUndefined();
    expect(parseToolStatusDescriptor('{"source":1,"action":"edit","phase":"done"}')).toBeUndefined();
    expect(parseToolStatusDescriptor('{"source":"codex","action":1,"phase":"done"}')).toBeUndefined();
    expect(parseToolStatusDescriptor('{"source":"codex","action":"edit","phase":1}')).toBeUndefined();
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
    expect(parseToolStatusDescriptor('{"source":"codex","action":"edit","phase":"done","params":null}')).toStrictEqual({
      action: 'edit',
      phase: 'done',
      params: undefined,
      source: 'codex',
    });
    expect(parseToolStatusDescriptor('  {"source":"codex","action":"edit","phase":"done"}')).toStrictEqual({
      action: 'edit',
      phase: 'done',
      params: undefined,
      source: 'codex',
    });
    expect(parseToolStatusDescriptor('{"source":"codex","action":"edit","phase":"done","params":"invalid"}')).toStrictEqual({
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
    expect(getToolLineDiff({
      action: 'edit',
      phase: 'done',
      params: { addedLines: 2, removedLines: '1' },
      source: 'codex',
    })).toStrictEqual({ addedLines: 2, removedLines: 0 });
    expect(getToolLineDiff({
      action: 'edit',
      phase: 'done',
      params: { addedLines: 0, removedLines: 0 },
      source: 'codex',
    })).toBeUndefined();
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
    expect(getToolGroupLineDiff([tool('added-only', 4)])).toStrictEqual({ addedLines: 4, removedLines: 0 });
    expect(getToolGroupLineDiff([tool('removed-only', undefined, 5)])).toStrictEqual({ addedLines: 0, removedLines: 5 });
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
    expect(getToolFallbackTitle({ ...tool, done: true, state: 'running' })).toBe('Ran npm test');
    expect(getToolFallbackTitle({ ...tool, done: false, state: 'completed' })).toBe('Ran npm test');
  });

  it('formats image-generation activity without exposing its protocol name', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: false,
      function: 'image_generation',
      id: 'image-generation',
      kind: 'dynamic',
      result: undefined,
      state: 'running',
      status: 'running',
    };

    expect(getToolDisplayTitle(tool, undefined)).toBe('Generating image');
    expect(getToolDisplayTitle({ ...tool, done: true, state: 'completed' }, undefined)).toBe('Generated image');
    expect(getToolDisplayTitle({ ...tool, done: true, state: 'error' }, undefined)).toBe('Failed generating image');
    expect(getToolDisplayTitle({ ...tool, done: true, state: 'canceled' }, undefined)).toBe('Stopped generating image');
    expect(getToolDisplayTitle({ ...tool, done: true, state: 'running' }, undefined)).toBe('Generated image');
    expect(getToolDisplayTitle({ ...tool, done: false, state: 'completed' }, undefined)).toBe('Generated image');
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

  it('formats every semantic command phase and unknown phases through the public title', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'command',
      id: 'tool',
      result: undefined,
      state: 'completed',
    };
    const expected = {
      create: ['Creating target', 'Created target', 'Failed creating target'],
      delete: ['Deleting target', 'Deleted target', 'Failed deleting target'],
      edit: ['Editing target', 'Edited target', 'Failed editing target'],
      explore: ['Exploring target', 'Explored target', 'Failed exploring target'],
      list: ['Listing target', 'Listed target', 'Failed listing target'],
      read: ['Reading target', 'Read target', 'Failed reading target'],
      run: ['Running target', 'Ran target', 'Failed running target'],
      search: ['Searching target', 'Searched target', 'Failed searching target'],
    } as const;

    for (const [action, titles] of Object.entries(expected)) {
      for (const [index, phase] of ['running', 'completed', 'failed'].entries()) {
        expect(getToolDisplayTitle(tool, {
          action,
          phase,
          params: { target: 'target' },
          source: 'codex',
        })).toBe(titles[index]);
      }
    }

    expect(getToolDisplayTitle(tool, {
      action: 'run',
      phase: 'queued',
      params: { target: 'target' },
      source: 'codex',
    })).toBe('Running target');
    expect(getToolDisplayTitle(tool, {
      action: 'host-action',
      phase: 'waiting',
      source: 'host',
    })).toBe('waiting command');
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

    expect(getToolDisplayTitleParts(tool, {
      action: 'edit',
      phase: 'completed',
      params: { target: 'existing.ts' },
      source: 'codex',
    })).toStrictEqual({ title: 'Edited existing.ts', prefix: 'Edited', target: 'existing.ts' });
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
    expect(getToolDisplayTitle(tool, {
      action: 'plan',
      phase: 'failed',
      params: { operation: 'write' },
      source: 'codex',
    })).toBe('Failed writing plan');
    expect(getToolDisplayTitle(tool, {
      action: 'plan',
      phase: 'failed',
      params: { operation: 'update' },
      source: 'codex',
    })).toBe('Failed updating plan');
    expect(getToolDisplayTitle(tool, {
      action: 'plan',
      phase: 'running',
      params: { operation: 'update' },
      source: 'codex',
    })).toBe('Updating plan');
    expect(getToolDisplayTitle(tool, {
      action: 'plan',
      phase: 'completed',
      source: 'codex',
    })).toBe('Wrote plan');
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

    expect(getToolDisplayTitle(tool, {
      action: 'explore',
      phase: 'completed',
      params: { names: ['', 'alpha', 3, 'beta'] },
      source: 'codex',
    })).toBe('Explored alpha, beta');
    expect(getToolDisplayTitle(tool, {
      action: 'explore',
      phase: 'completed',
      params: { names: [], targets: ['src', 'tests'], actions: ['ignored'] },
      source: 'codex',
    })).toBe('Explored src, tests');
    expect(getToolDisplayTitle(tool, {
      action: 'explore',
      phase: 'completed',
      params: { target: '   ', names: ['   ', 'usable'] },
      source: 'codex',
    })).toBe('Explored usable');
  });

  it('renders exactly three file targets without a truncation suffix', () => {
    const tool: MessageToolCall = {
      args: { changes: [{ path: '/a.ts' }, { path: '/b.ts' }, { path: '/c.ts' }] },
      done: true,
      function: 'fileChange',
      id: 'three-files',
      result: undefined,
      state: 'completed',
    };

    expect(getToolDisplayTitle(tool, {
      action: 'edit',
      phase: 'completed',
      source: 'codex',
    })).toBe('Edited a.ts, b.ts, c.ts');

    expect(getToolDisplayTitle(tool, {
      action: 'explore',
      phase: 'completed',
      params: { target: 'workspace' },
      source: 'codex',
    })).toBe('Explored workspace');

    expect(getToolDisplayTitle({
      ...tool,
      args: { changes: [{ path: '/a.ts' }, { path: '/b.ts' }, { path: '/c.ts' }, { path: '/d.ts' }] },
      id: 'four-files',
    }, {
      action: 'edit',
      phase: 'completed',
      source: 'codex',
    })).toBe('Edited a.ts, b.ts, c.ts and 1 more');
  });

  it('returns exact linked file target parts with identity and truncation context', () => {
    const tool: MessageToolCall = {
      args: {
        cwd: '/workspace',
        changes: [
          { path: 'src/alpha.ts' },
          { name: '/shared/beta.ts' },
          { path: 'src/gamma.ts' },
          { path: 'src/delta.ts' },
          { path: 'src/alpha.ts' },
          { path: 42 },
        ],
      },
      done: true,
      function: 'fileChange',
      id: 'tool',
      itemId: 'item-1',
      messageId: 'message-1',
      result: undefined,
      state: 'completed',
      turnId: 'turn-1',
    };
    const descriptor = {
      action: 'edit',
      phase: 'completed',
      params: { target: '4 files' },
      source: 'codex',
    };

    const parts = getToolDisplayTargetParts(tool, descriptor);
    expect(parts).toStrictEqual([
      {
        label: 'alpha.ts',
        link: {
          action: 'edit',
          filepath: '/workspace/src/alpha.ts',
          href: '/workspace/src/alpha.ts',
          itemId: 'item-1',
          kind: 'file',
          messageId: 'message-1',
          path: '/workspace/src/alpha.ts',
          turnId: 'turn-1',
        },
        separator: '',
      },
      {
        label: 'beta.ts',
        link: {
          action: 'edit',
          filepath: '/shared/beta.ts',
          href: '/shared/beta.ts',
          itemId: 'item-1',
          kind: 'file',
          messageId: 'message-1',
          path: '/shared/beta.ts',
          turnId: 'turn-1',
        },
        separator: ', ',
      },
      expect.objectContaining({ label: 'gamma.ts', separator: ', ' }),
      { label: 'and 1 more', separator: ' ' },
    ]);
    expect(getToolDisplayTargetLink(tool, descriptor)).toStrictEqual(parts?.[0]?.link);
  });

  it('rejects non-file target actions and targets without resolvable file payloads', () => {
    const tool: MessageToolCall = {
      args: undefined,
      done: true,
      function: 'command',
      id: 'tool',
      result: undefined,
      state: 'completed',
    };
    const readDescriptor = { action: 'read', phase: 'completed', source: 'codex' };

    expect(getToolDisplayTargetParts(tool, undefined)).toBeUndefined();
    expect(getToolDisplayTargetParts(tool, { ...readDescriptor, action: 'delete' })).toBeUndefined();
    expect(getToolDisplayTargetParts(tool, readDescriptor, 'README.md')).toBeUndefined();
    expect(getToolDisplayTargetLink(tool, readDescriptor, 'README.md')).toBeUndefined();
    expect(getToolDisplayTitleParts(tool, { ...readDescriptor, action: 'run' })).toStrictEqual({ title: 'Ran command' });
    expect(getToolDisplayTitleParts(tool, { ...readDescriptor, action: 'delete' })).toStrictEqual({
      prefix: 'Deleted',
      target: 'command',
      title: 'Deleted command',
    });
    expect(getToolDisplayTitleParts(tool, readDescriptor, () => 'custom title')).toStrictEqual({ title: 'custom title' });
  });

  it('builds file links from direct path and name arguments on every supported action', () => {
    const baseTool: MessageToolCall = {
      args: { cwd: '/workspace/', path: '/src/direct.ts', name: 'named.ts' },
      done: true,
      function: 'fileChange',
      id: 'tool',
      result: undefined,
      state: 'completed',
    };

    for (const action of ['create', 'edit', 'read']) {
      expect(getToolDisplayTargetParts(baseTool, {
        action,
        phase: 'completed',
        source: 'codex',
      })).toStrictEqual([
        expect.objectContaining({ label: 'direct.ts', link: expect.objectContaining({ action, path: '/src/direct.ts' }), separator: '' }),
        expect.objectContaining({ label: 'named.ts', link: expect.objectContaining({ action, path: '/workspace/named.ts' }), separator: ', ' }),
      ]);
    }

    expect(getToolDisplayTitle(baseTool, { action: 'create', phase: 'completed', source: 'codex' }))
      .toBe('Created direct.ts, named.ts');
    expect(getToolDisplayTitle(baseTool, { action: 'read', phase: 'completed', source: 'codex' }))
      .toBe('Read direct.ts, named.ts');
    expect(getToolDisplayTargetParts(baseTool, { action: 'delete', phase: 'completed', source: 'codex' }))
      .toBeUndefined();
  });

  it('preserves Windows paths and safely omits links for network paths', () => {
    const descriptor = { action: 'read', phase: 'completed', source: 'codex' };
    const windowsTool: MessageToolCall = {
      args: { path: 'C:\\repo\\src\\main.ts' },
      done: true,
      function: 'read',
      id: 'windows',
      result: undefined,
      state: 'completed',
    };
    const networkTool = { ...windowsTool, args: { path: '//server/share.ts' }, id: 'network' };

    expect(getToolDisplayTargetParts(windowsTool, descriptor)).toStrictEqual([
      expect.objectContaining({ label: 'main.ts', link: expect.objectContaining({ path: 'C:\\repo\\src\\main.ts' }) }),
    ]);
    expect(getToolDisplayTargetParts(networkTool, descriptor)).toStrictEqual([
      { label: 'share.ts', separator: '' },
    ]);
    expect(getToolDisplayTargetLink(networkTool, descriptor)).toBeUndefined();

    expect(getToolDisplayTargetParts({
      ...windowsTool,
      args: { cwd: 'C:\\repo', path: '\\\\src\\nested.ts' },
      id: 'windows-root-relative',
    }, descriptor)).toStrictEqual([
      expect.objectContaining({
        label: 'nested.ts',
        link: expect.objectContaining({ path: 'C:\\repo/src\\nested.ts' }),
      }),
    ]);
  });

  it('normalizes whitespace and trailing separators in file arguments', () => {
    const descriptor = { action: 'read', phase: 'completed', source: 'codex' };
    const whitespaceTool: MessageToolCall = {
      args: { changes: [null, 'invalid'], path: '  /workspace/space.ts  ' },
      done: true,
      function: 'read',
      id: 'whitespace',
      result: undefined,
      state: 'completed',
    };
    const directoryTool = { ...whitespaceTool, args: { path: '/workspace/folder/' }, id: 'directory' };

    expect(getToolDisplayTargetParts(whitespaceTool, descriptor)).toStrictEqual([
      expect.objectContaining({ label: 'space.ts', link: expect.objectContaining({ path: '/workspace/space.ts' }) }),
    ]);
    expect(getToolDisplayTargetParts(directoryTool, descriptor)).toStrictEqual([
      expect.objectContaining({ label: 'folder', link: expect.objectContaining({ path: '/workspace/folder/' }) }),
    ]);
    expect(getToolDisplayTitle({ ...whitespaceTool, args: { path: '   ' } }, {
      action: 'read',
      phase: 'completed',
      params: { target: 'fallback.ts' },
      source: 'codex',
    })).toBe('Read fallback.ts');
  });

  it('handles null and unresolved relative file payloads without inventing links', () => {
    const descriptor = { action: 'create', phase: 'completed', params: { target: 'fallback.ts' }, source: 'codex' };
    const nullArgs: MessageToolCall = {
      args: null,
      done: true,
      function: 'fileChange',
      id: 'null-args',
      result: undefined,
      state: 'completed',
    };
    const relativeArgs = { ...nullArgs, args: { path: 'relative.ts' }, id: 'relative' };

    expect(getToolDisplayTitle(nullArgs, descriptor)).toBe('Created fallback.ts');
    expect(getToolDisplayTargetParts(nullArgs, descriptor)).toBeUndefined();
    expect(getToolDisplayTargetParts(relativeArgs, descriptor)).toBeUndefined();

    expect(getToolDisplayTargetParts({
      ...nullArgs,
      args: { changes: 'invalid', cwd: '/workspace' },
      id: 'invalid-array',
    }, descriptor)).toBeUndefined();
  });

  it('resolves relative file payloads against metadata cwd when args cwd is invalid', () => {
    const tool: MessageToolCall = {
      args: { cwd: 42, path: 'src/from-metadata.ts' },
      done: true,
      function: 'read',
      id: 'metadata-cwd',
      metadata: { cwd: '/metadata-root' },
      result: undefined,
      state: 'completed',
    };

    expect(getToolDisplayTargetParts(tool, {
      action: 'read',
      phase: 'completed',
      source: 'codex',
    })).toStrictEqual([
      expect.objectContaining({
        label: 'from-metadata.ts',
        link: expect.objectContaining({ path: '/metadata-root/src/from-metadata.ts' }),
      }),
    ]);
  });

  it('removes unknown translation placeholders instead of leaking internal markers', () => {
    expect(defaultToolTranslate('Unknown {missing} value')).toBe('Unknown  value');
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
    const unregisterMiss = registerCodexToolTitlePresenter(() => undefined);
    const unregister = registerCodexToolTitlePresenter(({ toolCall }) => (
      toolCall.function === 'host.display' ? 'Displaying host preview' : undefined
    ));
    const unregisterFallback = registerCodexToolTitlePresenter(() => 'fallback presenter');

    expect(getToolDisplayTitle(tool, undefined)).toBe('Displaying host preview');
    unregister();
    expect(getToolDisplayTitle(tool, undefined)).toBe('fallback presenter');
    unregisterFallback();
    unregisterMiss();
    expect(getToolDisplayTitle(tool, undefined)).toBe('Running host.display');
  });
});
