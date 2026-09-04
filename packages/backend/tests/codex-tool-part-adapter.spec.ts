import { describe, expect, it } from 'vitest';
import {
  codexToolPartFileActivities,
  codexThreadItemToToolPart,
  commandOutputDeltaToToolPartUpdate,
  fileChangePatchToToolPartUpdate,
  lineDiffFromUnifiedDiff,
  mcpProgressToToolPartUpdate,
  rawOutputToToolPartUpdate,
  shouldForwardCommandExecutionOutput,
} from '../src/node/codex-tool-part-adapter';

describe('tool-part-adapter', () => {
  it('extracts full-path read, create, and edit file activities', () => {
    const readPart = codexThreadItemToToolPart({
      type: 'commandExecution',
      id: 'cmd-read-activity',
      command: "sed -n '1,20p' docs/SKILL.md",
      cwd: '/workspace/project',
      status: 'inProgress',
      commandActions: [{ type: 'read', name: 'SKILL.md', path: 'docs/SKILL.md' }],
    });
    expect(readPart ? codexToolPartFileActivities(readPart, '/workspace/project') : []).toStrictEqual([{
      action: 'read',
      path: '/workspace/project/docs/SKILL.md',
      status: 'running',
    }]);

    const changePart = codexThreadItemToToolPart({
      type: 'fileChange',
      id: 'patch-activity',
      status: 'completed',
      changes: [
        { kind: 'add', path: 'src/new.ts' },
        { kind: 'update', path: 'src/existing.ts' },
        { kind: 'delete', path: 'src/old.ts' },
      ],
    });
    expect(changePart ? codexToolPartFileActivities(changePart, '/workspace/project') : []).toStrictEqual([
      { action: 'create', path: '/workspace/project/src/new.ts', status: 'completed' },
      { action: 'edit', path: '/workspace/project/src/existing.ts', status: 'completed' },
    ]);
  });

  it('maps Codex command executions into renderer tool parts without raw output by default', () => {
    expect(codexThreadItemToToolPart({
      type: 'commandExecution',
      id: 'cmd-1',
      command: 'npm test',
      cwd: '/Users/nbonamy/src/codex-app-sdk',
      status: 'completed',
      commandActions: [],
      aggregatedOutput: 'passed',
      exitCode: 0,
      durationMs: 123,
      source: 'agent',
      processId: 42,
    })).toStrictEqual({
      type: 'tool',
      id: 'cmd-1',
      kind: 'command',
      title: 'npm test',
      status: 'completed',
      statusText: JSON.stringify({
        action: 'run',
        phase: 'completed',
        params: { target: 'npm test' },
        source: 'codex',
      }),
      input: {
        command: 'npm test',
        cwd: '/Users/nbonamy/src/codex-app-sdk',
        commandActions: [],
      },
      output: {
        exitCode: 0,
        durationMs: 123,
      },
      metadata: {
        source: 'agent',
        processId: 42,
      },
    });
  });

  it('keeps command execution output when explicitly allowed', () => {
    expect(codexThreadItemToToolPart({
      type: 'commandExecution',
      id: 'cmd-1',
      command: "apply_patch <<'PATCH'",
      status: 'completed',
      aggregatedOutput: 'Done',
    }, { includeCommandOutput: true })).toMatchObject({
      type: 'tool',
      id: 'cmd-1',
      kind: 'command',
      title: "apply_patch <<'PATCH'",
      status: 'completed',
      body: 'Done',
    });
  });

  it('only forwards command output for recognized file write commands', () => {
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution',
      command: 'rg "needle" src',
    })).toBe(false);
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution',
      command: "sed -n '1,220p' README.md",
    })).toBe(false);
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution',
      command: 'npm test',
    })).toBe(false);
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution',
      command: "apply_patch <<'PATCH'",
    })).toBe(true);
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution',
      command: "cat <<'EOF' > docs/new.md",
    })).toBe(true);
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution',
      command: 'printf hi | tee src/file.ts',
    })).toBe(true);
  });

  it('summarizes Codex command actions for localized renderer labels', () => {
    const runningRead = codexThreadItemToToolPart({
      type: 'commandExecution',
      id: 'cmd-read',
      command: '/bin/bash -lc "sed -n \'1,220p\' README.md"',
      status: 'running',
      commandActions: [
        {
          type: 'read',
          command: "sed -n '1,220p' README.md",
          name: 'README.md',
          path: '/Users/nbonamy/src/codex-app-sdk/README.md',
        },
      ],
    });

    expect(runningRead?.statusText ? JSON.parse(runningRead.statusText) : null).toStrictEqual({
      action: 'read',
      phase: 'running',
      params: {
        names: ['README.md'],
        target: 'README.md',
      },
      source: 'codex',
    });

    const multiRead = codexThreadItemToToolPart({
      type: 'commandExecution',
      id: 'cmd-multi-read',
      command: 'cat README.md package.json src/index.ts',
      status: 'completed',
      commandActions: [
        { type: 'read', name: 'README.md' },
        { type: 'read', name: 'package.json' },
        { type: 'read', name: 'src/index.ts' },
      ],
    });
    expect(multiRead?.statusText ? JSON.parse(multiRead.statusText) : null).toMatchObject({
      action: 'read',
      params: {
        names: ['README.md', 'package.json', 'src/index.ts'],
        target: 'README.md, package.json, index.ts',
      },
    });

    const completedExplore = codexThreadItemToToolPart({
      type: 'commandExecution',
      id: 'cmd-explore',
      command: 'find src -maxdepth 2 -type d | sort',
      status: 'completed',
      commandActions: [
        { type: 'listFiles', command: 'find src -maxdepth 2 -type d | sort', path: 'src' },
        { type: 'search', command: 'rg tool src', query: 'tool', path: 'src' },
      ],
    });

    expect(completedExplore?.statusText ? JSON.parse(completedExplore.statusText) : null).toStrictEqual({
      action: 'explore',
      phase: 'completed',
      params: {
        actions: ['listFiles', 'search'],
        target: 'src',
      },
      source: 'codex',
    });
  });

  it('maps MCP structuredContent over the model-facing placeholder', () => {
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall',
      id: 'call-set-status',
      server: 'codex_sdk',
      tool: 'set-status',
      status: 'completed',
      arguments: {
        agentId: 'agent-dina',
        status: 'Registered and idle',
      },
      result: {
        content: [{ type: 'text', text: 'Result returned in structuredContent.' }],
        structuredContent: {
          agentId: 'agent-dina',
          status: 'Registered and idle',
        },
        isError: false,
      },
    })).toMatchObject({
      type: 'tool',
      id: 'call-set-status',
      kind: 'mcp',
      title: 'codex_sdk.set-status',
      status: 'completed',
      body: '{"agentId":"agent-dina","status":"Registered and idle"}',
      input: {
        agentId: 'agent-dina',
        status: 'Registered and idle',
      },
      metadata: {
        server: 'codex_sdk',
        tool: 'set-status',
      },
    });
  });

  it('maps dynamic, file-change, web-search, and image-generation items', () => {
    expect(codexThreadItemToToolPart({
      type: 'dynamicToolCall',
      id: 'dynamic-1',
      namespace: 'image',
      tool: 'generate',
      status: 'success',
      arguments: { prompt: 'ship' },
      contentItems: [{ type: 'inputText', text: 'done' }],
      success: true,
      durationMs: 12,
    })).toStrictEqual({
      type: 'tool',
      id: 'dynamic-1',
      kind: 'dynamic',
      title: 'image.generate',
      status: 'completed',
      body: 'done',
      input: { prompt: 'ship' },
      output: [{ type: 'inputText', text: 'done' }],
      metadata: {
        namespace: 'image',
        tool: 'generate',
        success: true,
        durationMs: 12,
      },
    });

    expect(codexThreadItemToToolPart({
      type: 'fileChange',
      id: 'patch-1',
      changes: [{ kind: 'update', path: 'src/app.ts' }],
      status: 'completed',
    })).toMatchObject({
      id: 'patch-1',
      kind: 'fileChange',
      title: '1 file change',
      status: 'completed',
      statusText: JSON.stringify({
        action: 'edit',
        phase: 'completed',
        params: {
          addedLines: 0,
          path: 'src/app.ts',
          removedLines: 0,
          target: 'app.ts',
        },
        source: 'codex',
      }),
      body: 'update src/app.ts',
    });

    expect(codexThreadItemToToolPart({
      type: 'webSearch',
      id: 'search-1',
      query: 'codex app server',
    })).toMatchObject({
      id: 'search-1',
      kind: 'webSearch',
      title: 'Web search',
      status: 'completed',
      body: 'codex app server',
    });

    expect(codexThreadItemToToolPart({
      type: 'imageGeneration',
      id: 'image-1',
      status: 'failed',
      revisedPrompt: 'draw a UI',
      savedPath: '/tmp/ui.png',
    })).toMatchObject({
      id: 'image-1',
      kind: 'dynamic',
      title: 'image_generation',
      status: 'failed',
      body: 'draw a UI',
      output: '/tmp/ui.png',
    });
  });

  it('does not map Codex review-mode markers into tool parts', () => {
    expect(codexThreadItemToToolPart({
      type: 'enteredReviewMode',
      id: 'review-1',
      review: 'uncommitted changes',
    })).toBeNull();

    expect(codexThreadItemToToolPart({
      type: 'exitedReviewMode',
      id: 'review-1',
      review: 'Found one issue.',
    })).toBeNull();
  });

  it('creates app-owned update payloads with fallback tool parts', () => {
    expect(commandOutputDeltaToToolPartUpdate('cmd-1', 'running\n')).toStrictEqual({
      itemId: 'cmd-1',
      bodyDelta: 'running\n',
      fallbackToolPart: {
        type: 'tool',
        id: 'cmd-1',
        kind: 'command',
        title: 'Command',
        status: 'running',
      },
    });

    expect(mcpProgressToToolPartUpdate('mcp-1', 'opening')).toStrictEqual({
      itemId: 'mcp-1',
      bodyAppend: 'opening',
      fallbackToolPart: {
        type: 'tool',
        id: 'mcp-1',
        kind: 'mcp',
        title: 'MCP tool',
        status: 'running',
      },
    });

    expect(fileChangePatchToToolPartUpdate('patch-1', [{ path: 'src/next.ts' }])).toMatchObject({
      itemId: 'patch-1',
      body: 'update src/next.ts',
      statusText: JSON.stringify({
        action: 'edit',
        phase: 'running',
        params: {
          addedLines: 0,
          path: 'src/next.ts',
          removedLines: 0,
          target: 'next.ts',
        },
        source: 'codex',
      }),
      input: {
        changes: [{ path: 'src/next.ts' }],
      },
      fallbackToolPart: {
        type: 'tool',
        id: 'patch-1',
        kind: 'fileChange',
        title: '1 file change',
        status: 'running',
        statusText: JSON.stringify({
          action: 'edit',
          phase: 'running',
          params: {
            addedLines: 0,
            path: 'src/next.ts',
            removedLines: 0,
            target: 'next.ts',
          },
          source: 'codex',
        }),
      },
    });

    expect(rawOutputToToolPartUpdate('raw-1', { content: [{ text: 'nested' }] }, 'read_file')).toMatchObject({
      itemId: 'raw-1',
      title: 'read_file',
      status: 'completed',
      body: 'nested',
      output: { content: [{ text: 'nested' }] },
      fallbackToolPart: {
        type: 'tool',
        id: 'raw-1',
        kind: 'generic',
        title: 'read_file',
        status: 'completed',
        body: 'nested',
      },
    });
  });

  it('ignores unsupported item shapes', () => {
    expect(codexThreadItemToToolPart(null)).toBeNull();
    expect(codexThreadItemToToolPart({ type: 'unknown', id: 'unknown-1' })).toBeNull();
  });

  it('summarizes file change patches with filename and diff stats', () => {
    const toolPart = codexThreadItemToToolPart({
      type: 'fileChange',
      id: 'patch-diff',
      changes: [
        {
          kind: { type: 'update', move_path: null },
          path: 'src/main/codex/tool-part-adapter.ts',
          diff: [
            '--- a/src/main/codex/tool-part-adapter.ts',
            '+++ b/src/main/codex/tool-part-adapter.ts',
            '@@ -1,2 +1,4 @@',
            ' import type { RendererToolPart } from "../../shared/contracts";',
            '+const next = true;',
            '+const label = "Editing";',
            '-const old = false;',
          ].join('\n'),
        },
      ],
      status: 'inProgress',
    });

    expect(toolPart?.statusText ? JSON.parse(toolPart.statusText) : null).toStrictEqual({
      action: 'edit',
      phase: 'running',
      params: {
        addedLines: 2,
        path: 'src/main/codex/tool-part-adapter.ts',
        removedLines: 1,
        target: 'tool-part-adapter.ts',
      },
      source: 'codex',
    });
  });

  it('counts raw add and delete patch contents as line diffs while streaming', () => {
    const addUpdate = fileChangePatchToToolPartUpdate('patch-add', [{
      diff: 'one\ntwo\n',
      kind: { type: 'add' },
      path: 'src/new.ts',
    }]);
    const deleteUpdate = fileChangePatchToToolPartUpdate('patch-delete', [{
      diff: 'old one\nold two',
      kind: { type: 'delete' },
      path: 'src/old.ts',
    }]);

    expect(addUpdate.statusText ? JSON.parse(addUpdate.statusText) : null).toMatchObject({
      action: 'create',
      params: {
        addedLines: 2,
        removedLines: 0,
        target: 'new.ts',
      },
    });
    expect(addUpdate.body).toBe('add src/new.ts');
    expect(deleteUpdate.statusText ? JSON.parse(deleteUpdate.statusText) : null).toMatchObject({
      action: 'delete',
      params: {
        addedLines: 0,
        removedLines: 2,
        target: 'old.ts',
      },
    });
    expect(deleteUpdate.body).toBe('delete src/old.ts');
  });

  it('counts turn-level unified diffs', () => {
    expect(lineDiffFromUnifiedDiff([
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,3 @@',
      ' context',
      '-old',
      '+new',
      '+extra',
    ].join('\n'))).toStrictEqual({
      addedLines: 2,
      removedLines: 1,
    });
  });

  it('normalizes incomplete command and tool payloads without leaking protocol shapes', () => {
    expect(codexThreadItemToToolPart({
      type: 'commandExecution', id: 'command-default', status: 'cancelled', commandActions: 'invalid',
      aggregatedOutput: 42, exitCode: '1', durationMs: 'slow',
    }, { includeCommandOutput: true })).toMatchObject({
      title: 'command', status: 'failed', input: { command: 'command', cwd: undefined },
      output: { exitCode: undefined, durationMs: undefined },
    });
    expect(shouldForwardCommandExecutionOutput(null)).toBe(false);
    expect(shouldForwardCommandExecutionOutput({ type: 'commandExecution', command: 42 })).toBe(false);

    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-error', status: 'error', error: { message: 'No access' }, result: null,
    })).toMatchObject({ title: 'mcp.tool', status: 'failed', body: 'No access' });
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-content', status: 'succeeded', server: 'files', tool: 'read',
      result: {
        content: [{ text: 'visible' }, { image: 'png' }, null],
        structuredContent: { path: 'README.md' },
      },
    })).toMatchObject({
      status: 'completed', body: 'visible\n\n{"image":"png"}\n\n{"path":"README.md"}',
    });

    expect(codexThreadItemToToolPart({
      type: 'dynamicToolCall', id: 'dynamic-default', status: 'declined', contentItems: [{ text: 'one' }, { value: 2 }, null],
    })).toMatchObject({
      title: 'tool', status: 'failed', body: 'one\n\n{"value":2}\n\nnull',
    });
    expect(codexThreadItemToToolPart({
      type: 'imageGeneration', id: 'image-result', status: 'success', result: 'inline-image',
    })).toMatchObject({ status: 'completed', body: undefined, output: undefined });
    expect(codexThreadItemToToolPart({
      type: 'webSearch', id: 'web-default', query: '   ', action: { type: 'openPage' },
    })).toMatchObject({ body: 'web search', input: { type: 'openPage' } });
  });

  it('covers list, search, unknown, and long command action summaries', () => {
    const descriptor = (actions: unknown[]) => {
      const part = codexThreadItemToToolPart({
        type: 'commandExecution', id: 'command-actions', command: 'fallback', status: 'inProgress', commandActions: actions,
      });
      return part?.statusText ? JSON.parse(part.statusText) : null;
    };
    expect(descriptor([])).toMatchObject({ action: 'run', params: { target: 'fallback' } });
    expect(descriptor([{ type: 'unknown' }])).toMatchObject({ action: 'run', params: { target: 'fallback' } });
    expect(descriptor([
      { type: 'listFiles', path: 'src' }, { type: 'listFiles', command: 'ls tests' },
      { type: 'listFiles', path: 'docs' }, { type: 'listFiles', path: 'samples' },
    ])).toMatchObject({ action: 'list', params: { target: 'src, ls tests, docs and 1 more' } });
    expect(descriptor([{ type: 'search', query: 'needle', path: 'src' }])).toMatchObject({
      action: 'search', params: { target: '"needle" in src' },
    });
    expect(descriptor([{ type: 'search', query: 'needle' }, { type: 'search', path: 'src' }, { type: 'search' }]))
      .toMatchObject({ action: 'search', params: { targets: ['needle', 'src'] } });
    expect(descriptor([null, { type: 42 }, { type: 'write' }]))
      .toMatchObject({ action: 'run', params: { target: 'fallback' } });
  });

  it('normalizes empty and multi-file changes and raw outputs', () => {
    expect(codexThreadItemToToolPart({
      type: 'fileChange', id: 'empty-patch', changes: null, status: 'incomplete',
    })).toMatchObject({ title: '0 file changes', status: 'failed', body: undefined });
    expect(fileChangePatchToToolPartUpdate('mixed-patch', [
      null,
      { path: 'src/a.ts', kind: 'add', diff: '' },
      { path: 'src/b.ts', kind: 'delete', diff: 'old\r\n\r\n' },
      { kind: { type: 'move' }, diff: undefined },
    ])).toMatchObject({
      statusText: expect.stringContaining('"target":"a.ts, b.ts"'),
      body: 'null\nadd src/a.ts\ndelete src/b.ts\nupdate unknown',
    });
    expect(lineDiffFromUnifiedDiff(undefined)).toStrictEqual({ addedLines: 0, removedLines: 0 });
    expect(rawOutputToToolPartUpdate('raw-failed', 'failed', ' ', 'incomplete')).toMatchObject({
      title: undefined,
      status: 'failed',
      fallbackToolPart: { title: 'Tool output', status: 'failed' },
    });
  });

  it('uses command cwd precedence and filters non-read or unusable file activities', () => {
    const toolPart = {
      type: 'tool',
      id: 'command-activity',
      kind: 'command',
      title: 'inspect',
      status: 'failed',
      input: {
        cwd: '/command/root',
        commandActions: [
          { type: 'read', path: ' src/a.ts ' },
          { type: 'read', name: '/absolute/b.ts' },
          { type: 'read', path: '   ' },
          { type: 'search', path: 'ignored.ts' },
          null,
        ],
      },
    } as const;

    expect(codexToolPartFileActivities(toolPart, '/fallback/root')).toStrictEqual([
      { action: 'read', path: '/command/root/src/a.ts', status: 'failed' },
      { action: 'read', path: '/absolute/b.ts', status: 'failed' },
    ]);
    expect(codexToolPartFileActivities({ ...toolPart, input: null }, '/fallback/root')).toStrictEqual([]);
  });

  it('uses caller cwd for command reads and rejects a relative or absent cwd', () => {
    const toolPart = {
      type: 'tool', id: 'command-activity', kind: 'command', title: 'inspect', status: 'running',
      input: { commandActions: [{ type: 'read', path: 'src/a.ts' }] },
    } as const;

    expect(codexToolPartFileActivities(toolPart, '/fallback/root')).toStrictEqual([
      { action: 'read', path: '/fallback/root/src/a.ts', status: 'running' },
    ]);
    expect(codexToolPartFileActivities(toolPart, 'relative/root')).toStrictEqual([]);
    expect(codexToolPartFileActivities(toolPart)).toStrictEqual([]);
  });

  it('uses file-change metadata before input and filters malformed, deleted, and pathless changes', () => {
    const toolPart = {
      type: 'tool', id: 'change-activity', kind: 'fileChange', title: 'changes', status: 'completed',
      input: { changes: [{ kind: 'add', path: 'input-only.ts' }] },
      metadata: {
        changes: [
          { kind: { type: 'add' }, path: ' src/new.ts ' },
          { kind: 'update', path: '/absolute/existing.ts' },
          { kind: 'delete', path: 'src/deleted.ts' },
          { kind: 'unknown', path: 'src/default-update.ts' },
          { kind: 'add', path: '   ' },
          { kind: 'add' },
          null,
        ],
      },
    } as const;

    expect(codexToolPartFileActivities(toolPart, '/workspace')).toStrictEqual([
      { action: 'create', path: '/workspace/src/new.ts', status: 'completed' },
      { action: 'edit', path: '/absolute/existing.ts', status: 'completed' },
      { action: 'edit', path: '/workspace/src/default-update.ts', status: 'completed' },
    ]);
    expect(codexToolPartFileActivities({ ...toolPart, metadata: undefined }, '/workspace')).toStrictEqual([
      { action: 'create', path: '/workspace/input-only.ts', status: 'completed' },
    ]);
    expect(codexToolPartFileActivities({
      ...toolPart,
      input: null,
      metadata: null as unknown as Record<string, unknown>,
    }, '/workspace'))
      .toStrictEqual([]);
  });

  it('rejects every malformed item identity independently', () => {
    expect(codexThreadItemToToolPart([])).toBeNull();
    expect(codexThreadItemToToolPart({ id: 42, type: 'commandExecution' })).toBeNull();
    expect(codexThreadItemToToolPart({ id: 'item', type: 42 })).toBeNull();
    expect(codexThreadItemToToolPart({ id: 'item', type: 'unknown' })).toBeNull();
  });

  it.each([
    ['completed', 'completed'],
    ['succeeded', 'completed'],
    ['success', 'completed'],
    ['failed', 'failed'],
    ['error', 'failed'],
    ['declined', 'failed'],
    ['incomplete', 'failed'],
    ['canceled', 'failed'],
    ['cancelled', 'failed'],
    ['inProgress', 'running'],
    [undefined, 'running'],
  ] as const)('normalizes protocol status %j to %s', (status, expected) => {
    expect(codexThreadItemToToolPart({
      type: 'commandExecution', id: `command-${String(status)}`, command: 'run', status,
    })).toMatchObject({ status: expected });
  });

  it('preserves command output only for an enabled string payload', () => {
    const item = {
      type: 'commandExecution', id: 'command-output', command: 'run', status: 'completed',
      aggregatedOutput: 'visible output',
    };
    expect(codexThreadItemToToolPart(item)).not.toHaveProperty('body');
    expect(codexThreadItemToToolPart(item, { includeCommandOutput: false })).not.toHaveProperty('body');
    expect(codexThreadItemToToolPart(item, { includeCommandOutput: true })).toHaveProperty('body', 'visible output');
    expect(codexThreadItemToToolPart({ ...item, aggregatedOutput: 42 }, { includeCommandOutput: true }))
      .not.toHaveProperty('body');
  });

  it('maps exact MCP fallback, error, and structured result contracts', () => {
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-defaults', status: 'inProgress', server: 42, tool: null,
      arguments: { input: true }, result: { content: 'not-an-array' }, error: { message: 42 },
      pluginId: 'plugin-1', mcpAppResourceUri: 'ui://result', durationMs: 9,
    })).toStrictEqual({
      type: 'tool', id: 'mcp-defaults', kind: 'mcp', title: 'mcp.tool', status: 'running',
      body: undefined, input: { input: true }, output: { content: 'not-an-array' },
      metadata: {
        server: 'mcp', tool: 'tool', pluginId: 'plugin-1', mcpAppResourceUri: 'ui://result', durationMs: 9,
      },
    });
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-structured', status: 'completed', server: 'files', tool: 'read',
      result: {
        content: [{ text: '  Result returned in structuredContent.\n' }],
        structuredContent: { path: 'README.md' },
      },
    })).toMatchObject({ body: '{"path":"README.md"}' });
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-error-priority', status: 'failed', server: 'files', tool: 'read',
      error: { message: '' }, result: { content: [{ text: 'result body' }] },
    })).toMatchObject({ body: '' });
  });

  it('maps dynamic namespace and content fallbacks exactly', () => {
    expect(codexThreadItemToToolPart({
      type: 'dynamicToolCall', id: 'dynamic-empty-namespace', tool: 'run', namespace: '', status: 'completed',
      contentItems: 'invalid', arguments: null, success: false, durationMs: 0,
    })).toStrictEqual({
      type: 'tool', id: 'dynamic-empty-namespace', kind: 'dynamic', title: 'run', status: 'completed',
      body: undefined, input: null, output: 'invalid',
      metadata: { namespace: '', tool: 'run', success: false, durationMs: 0 },
    });
    expect(codexThreadItemToToolPart({
      type: 'dynamicToolCall', id: 'dynamic-content', tool: 42, namespace: null, status: 'completed',
      contentItems: [undefined, '', { text: '' }, { value: 2 }],
    })).toMatchObject({ title: 'tool', body: '""\n\n{"value":2}' });
  });

  it('honors file-change cwd precedence and exact single/plural titles', () => {
    expect(codexThreadItemToToolPart({
      type: 'fileChange', id: 'single', status: 'completed', cwd: '/item', changes: [{ path: 'a.ts' }],
    }, { cwd: '/option' })).toMatchObject({
      title: '1 file change',
      input: { changes: [{ path: 'a.ts' }] },
      metadata: { cwd: '/item' },
    });
    expect(codexThreadItemToToolPart({
      type: 'fileChange', id: 'double', status: 'completed', cwd: 42,
      changes: [{ path: 'a.ts' }, { path: 'b.ts' }],
    }, { cwd: '/option' })).toMatchObject({ title: '2 file changes', metadata: { cwd: '/option' } });
    expect(codexThreadItemToToolPart({
      type: 'fileChange', id: 'none', status: 'completed', changes: [],
    })).toStrictEqual(expect.objectContaining({ title: '0 file changes', metadata: { changes: [] } }));
  });

  it('trims web queries and builds the fallback action only when needed', () => {
    expect(codexThreadItemToToolPart({
      type: 'webSearch', id: 'search-trimmed', query: '  mutation testing  ', action: null,
    })).toMatchObject({
      body: 'mutation testing', input: { query: 'mutation testing' },
      metadata: { query: 'mutation testing', action: null },
    });
    expect(codexThreadItemToToolPart({
      type: 'webSearch', id: 'search-non-string', query: 42,
    })).toMatchObject({ body: 'web search', input: { query: 'web search' } });
  });

  it('omits a non-string image prompt while preserving saved-path metadata', () => {
    expect(codexThreadItemToToolPart({
      type: 'imageGeneration', id: 'image-no-prompt', status: 'inProgress',
      revisedPrompt: 42, savedPath: null,
    })).toStrictEqual({
      type: 'tool', id: 'image-no-prompt', kind: 'dynamic', title: 'image_generation', status: 'running',
      body: undefined, input: { revisedPrompt: 42 }, output: null, metadata: { savedPath: null },
    });
  });

  it('creates exact empty, single, and plural file-change update payloads', () => {
    expect(fileChangePatchToToolPartUpdate('empty', [])).toStrictEqual({
      itemId: 'empty', body: undefined, input: { changes: [] }, metadata: { changes: [] },
      fallbackToolPart: {
        type: 'tool', id: 'empty', kind: 'fileChange', title: '0 file changes', status: 'running',
        body: undefined, input: { changes: [] }, metadata: { changes: [] },
      },
    });
    expect(fileChangePatchToToolPartUpdate('plural', [{ path: 'a.ts' }, { path: 'b.ts' }]))
      .toMatchObject({ fallbackToolPart: { title: '2 file changes' } });
  });

  it.each([
    'apply_patch',
    'apply_patch patch.diff',
    'echo before; apply_patch patch.diff',
    'echo before | apply_patch patch.diff',
    "bash -lc 'apply_patch patch.diff'",
    'cat input > output.txt',
    'printf "%s" value >> "output file.txt"',
    "echo value > 'output file.txt'",
    'echo before && cat input > output.txt',
    'printf value | tee output.txt',
    'printf value | tee -a "output file.txt"',
    "echo value; tee 'output file.txt'",
  ])('forwards output for the recognized write command %j', (command) => {
    expect(shouldForwardCommandExecutionOutput({ type: 'commandExecution', command })).toBe(true);
  });

  it.each([
    '',
    'xapply_patch patch.diff',
    'apply_patcher patch.diff',
    'cat input',
    'xcat input > output.txt',
    'echo value >',
    'printf value | tee',
    'printf value | xtee output.txt',
    'printf value | tee -x output.txt',
  ])('does not forward output for the non-write command %j', (command) => {
    expect(shouldForwardCommandExecutionOutput({ type: 'commandExecution', command })).toBe(false);
  });

  it('trims commands before deciding whether output is safe to forward', () => {
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution', command: '  apply_patch patch.diff  ',
    })).toBe(true);
  });

  it('does not infer file changes from unrelated tool kinds', () => {
    expect(codexToolPartFileActivities({
      type: 'tool', id: 'generic', kind: 'generic', title: 'generic', status: 'completed',
      input: { changes: [{ kind: 'add', path: '/should-not-exist.ts' }] },
    })).toStrictEqual([]);
  });

  it('ignores non-string file paths but accepts absolute reads without cwd', () => {
    expect(codexToolPartFileActivities({
      type: 'tool', id: 'change', kind: 'fileChange', title: 'change', status: 'running',
      metadata: { changes: [{ kind: 'add', path: 42 }] },
    })).toStrictEqual([]);
    expect(codexToolPartFileActivities({
      type: 'tool', id: 'read', kind: 'command', title: 'read', status: 'running',
      input: { commandActions: [{ type: 'read', path: '/absolute/readme.md' }] },
    })).toStrictEqual([{ action: 'read', path: '/absolute/readme.md', status: 'running' }]);
    expect(codexToolPartFileActivities({
      type: 'tool', id: 'read-missing', kind: 'command', title: 'read', status: 'running',
      input: { commandActions: [{ type: 'read' }] },
    }, '/workspace')).toStrictEqual([]);
  });

  it('omits a non-string command cwd from the renderer input', () => {
    expect(codexThreadItemToToolPart({
      type: 'commandExecution', id: 'command-cwd', command: 'pwd', cwd: 42, status: 'completed',
    })).toMatchObject({ input: { command: 'pwd', cwd: undefined } });
  });

  it('omits a non-string dynamic namespace', () => {
    expect(codexThreadItemToToolPart({
      type: 'dynamicToolCall', id: 'dynamic-namespace', tool: 'run', namespace: 42, status: 'completed',
    })).toMatchObject({ title: 'run', metadata: { namespace: null, tool: 'run' } });
  });

  it('does not forward write-like commands from unrelated item types', () => {
    expect(shouldForwardCommandExecutionOutput({
      type: 'webSearch', command: 'apply_patch patch.diff',
    })).toBe(false);
    expect(shouldForwardCommandExecutionOutput({
      type: 'commandExecution', command: { toString: () => 'apply_patch patch.diff' },
    })).toBe(false);
  });

  it('summarizes a non-array command-action payload as a normal command', () => {
    const part = codexThreadItemToToolPart({
      type: 'commandExecution', id: 'invalid-actions', command: 'npm test', status: 'completed',
      commandActions: 'invalid',
    });
    expect(part?.statusText ? JSON.parse(part.statusText) : null).toStrictEqual({
      action: 'run', phase: 'completed', params: { target: 'npm test' }, source: 'codex',
    });
  });

  it('uses explore for mixed read and search actions', () => {
    const part = codexThreadItemToToolPart({
      type: 'commandExecution', id: 'mixed-actions', command: 'inspect', status: 'completed',
      commandActions: [
        { type: 'read', path: 'README.md' },
        { type: 'search', query: 'needle', path: 'src' },
      ],
    });
    expect(part?.statusText ? JSON.parse(part.statusText) : null).toStrictEqual({
      action: 'explore', phase: 'completed',
      params: { actions: ['read', 'search'], target: 'README.md, src' },
      source: 'codex',
    });
  });

  it('normalizes and deduplicates command action targets', () => {
    const part = codexThreadItemToToolPart({
      type: 'commandExecution', id: 'trimmed-actions', command: 'fallback', status: 'completed',
      commandActions: [
        { type: 'read', name: '  README.md  ' },
        { type: 'read', name: 'README.md' },
        { type: 'read', path: 'src/index.ts' },
      ],
    });
    expect(part?.statusText ? JSON.parse(part.statusText) : null).toStrictEqual({
      action: 'read', phase: 'completed',
      params: { names: ['README.md', 'src/index.ts'], target: 'README.md, index.ts' },
      source: 'codex',
    });
  });

  it('falls back to the command for valid actions without display targets', () => {
    const part = codexThreadItemToToolPart({
      type: 'commandExecution', id: 'targetless-actions', command: 'fallback command', status: 'completed',
      commandActions: [{ type: 'listFiles', path: 42, command: 42 }],
    });
    expect(part?.statusText ? JSON.parse(part.statusText) : null).toStrictEqual({
      action: 'list', phase: 'completed',
      params: { targets: [], target: 'fallback command' },
      source: 'codex',
    });
  });

  it('ignores every non-string optional command action field', () => {
    const part = codexThreadItemToToolPart({
      type: 'commandExecution', id: 'invalid-action-fields', command: 'fallback command', status: 'completed',
      commandActions: [{ type: 'search', path: 42, name: 42, query: 42, command: 42 }],
    });
    expect(part?.statusText ? JSON.parse(part.statusText) : null).toStrictEqual({
      action: 'search', phase: 'completed',
      params: { targets: [], target: 'fallback command' },
      source: 'codex',
    });
  });

  it('falls back from a non-string read name to its path', () => {
    const part = codexThreadItemToToolPart({
      type: 'commandExecution', id: 'invalid-read-name', command: 'read', status: 'completed',
      commandActions: [{ type: 'read', name: 42, path: 'safe.ts' }],
    });
    expect(part?.statusText ? JSON.parse(part.statusText) : null).toMatchObject({
      action: 'read', params: { names: ['safe.ts'], target: 'safe.ts' },
    });
  });

  it('reports mixed file changes as edits without a singular path', () => {
    const update = fileChangePatchToToolPartUpdate('mixed-actions', [
      { kind: 'add', path: 'src/new.ts' },
      { kind: 'delete', path: 'src/old.ts' },
      { kind: 'update', path: 'src/current.ts' },
    ]);
    expect(update.statusText ? JSON.parse(update.statusText) : null).toStrictEqual({
      action: 'edit', phase: 'running',
      params: {
        addedLines: 0, removedLines: 0,
        target: 'new.ts, old.ts, current.ts',
      },
      source: 'codex',
    });
  });

  it('uses record count when file changes have no usable paths', () => {
    const update = fileChangePatchToToolPartUpdate('pathless', [
      { kind: 'add', path: 42 },
      { kind: null },
    ]);
    expect(update.statusText ? JSON.parse(update.statusText) : null).toStrictEqual({
      action: 'edit', phase: 'running',
      params: { addedLines: 0, removedLines: 0, target: '2 files' },
      source: 'codex',
    });
  });

  it('omits a status descriptor for a change list containing only invalid entries', () => {
    expect(fileChangePatchToToolPartUpdate('invalid-change', [null])).toStrictEqual({
      itemId: 'invalid-change', body: 'null', input: { changes: [null] }, metadata: { changes: [null] },
      fallbackToolPart: {
        type: 'tool', id: 'invalid-change', kind: 'fileChange', title: '1 file change', status: 'running',
        body: 'null', input: { changes: [null] }, metadata: { changes: [null] },
      },
    });
  });

  it('does not recursively accept a non-string nested patch kind', () => {
    const update = fileChangePatchToToolPartUpdate('nested-kind', [{
      kind: { type: { type: 'add' } }, path: 'nested.ts',
    }]);
    expect(update.statusText ? JSON.parse(update.statusText) : null).toMatchObject({ action: 'edit' });
    expect(update.body).toBe('update nested.ts');
  });

  it('ignores non-string raw file content when counting add and delete lines', () => {
    for (const kind of ['add', 'delete'] as const) {
      const update = fileChangePatchToToolPartUpdate(kind, [{ kind, path: `${kind}.ts`, diff: 42 }]);
      expect(update.statusText ? JSON.parse(update.statusText) : null).toMatchObject({
        params: { addedLines: 0, removedLines: 0 },
      });
    }
  });

  it('uses the last non-empty path segment in file summaries', () => {
    const update = fileChangePatchToToolPartUpdate('directory', [{
      kind: 'update', path: '/workspace/src/components/',
    }]);
    expect(update.statusText ? JSON.parse(update.statusText) : null).toMatchObject({
      params: { target: 'components' },
    });
  });

  it('returns MCP content without appending a missing structured result', () => {
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-content-only', server: 'files', tool: 'read', status: 'completed',
      result: { content: [{ text: 'visible result' }] },
    })).toMatchObject({ body: 'visible result' });
  });

  it('ignores primitive MCP content entries instead of serializing them as protocol text', () => {
    expect(codexThreadItemToToolPart({
      type: 'mcpToolCall', id: 'mcp-primitive-content', server: 'files', tool: 'read', status: 'completed',
      result: { content: ['ignored', 42, true, { text: 'visible result' }] },
    })).toMatchObject({ body: 'visible result' });
  });

  it.each([
    'echo value >   output.txt',
    'echo value > "long output name.txt"',
    "echo value > 'long output name.txt'",
    'tee output.txt',
    'tee   output.txt',
    'tee   -a   output.txt',
    'tee "long output name.txt"',
    "tee 'long output name.txt'",
  ])('recognizes complete write targets in %j', (command) => {
    expect(shouldForwardCommandExecutionOutput({ type: 'commandExecution', command })).toBe(true);
  });

  it.each([
    'echo value > "',
    "echo value > '",
    'echo value > "unterminated',
    "echo value > 'unterminated",
    'tee "',
    "tee '",
    'tee "unterminated',
    "tee 'unterminated",
    'tee -a',
    'echo value > output.txt"junk',
    "echo value > output.txt'junk",
    'tee output.txt"junk',
    "tee output.txt'junk",
  ])('rejects malformed or missing write targets in %j', (command) => {
    expect(shouldForwardCommandExecutionOutput({ type: 'commandExecution', command })).toBe(false);
  });
});
