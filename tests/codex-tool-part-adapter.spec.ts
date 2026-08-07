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
} from '../packages/backend/src/node/codex-tool-part-adapter';

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
});
