import { describe, expect, it } from 'vitest';
import type { ResponseItem } from '../src/codex/generated/ResponseItem';
import { rawResponseItemToEvent } from '../src/node/codex-raw-response-item-adapter';

const adapt = (item: unknown) => rawResponseItemToEvent(item as ResponseItem);

describe('rawResponseItemToEvent', () => {
  it('ignores unsupported and malformed response items', () => {
    expect(adapt(null)).toBeNull();
    expect(adapt({})).toBeNull();
    expect(adapt({ type: 'message', role: 'assistant', content: [] })).toBeNull();
  });

  it('maps local shell calls with completed, failed, and running status', () => {
    expect(adapt({
      type: 'local_shell_call', call_id: 'shell-1', status: 'completed',
      action: { command: ['npm', 'run test'], working_directory: '/tmp/project' },
    })).toMatchObject({
      type: 'item.completed',
      payload: { toolPart: { id: 'shell-1', title: 'npm "run test"', status: 'completed' } },
    });
    expect(adapt({
      type: 'local_shell_call', id: 'shell-2', call_id: null, status: 'failed', action: { command: 'false' },
    })).toMatchObject({
      type: 'item.completed', payload: { toolPart: { id: 'shell-2', title: 'false', status: 'failed' } },
    });
    expect(adapt({ type: 'local_shell_call', call_id: null, status: 'in_progress', action: null })).toMatchObject({
      type: 'item.started', payload: { toolPart: { id: 'raw-local_shell_call', title: 'local shell', status: 'running' } },
    });
  });

  it('maps function and custom tool calls plus their outputs', () => {
    expect(adapt({
      type: 'function_call', call_id: 'function-shell', name: 'shell_command',
      arguments: '{"command":"pwd","workdir":"/tmp"}',
    })).toMatchObject({
      type: 'item.started',
      payload: { toolPart: { id: 'function-shell', kind: 'command', title: 'pwd', status: 'running' } },
    });
    expect(adapt({
      type: 'function_call', call_id: 'function-1', namespace: 'files', name: 'read_file', arguments: 'not json',
    })).toMatchObject({
      type: 'item.started',
      payload: { toolPart: { id: 'function-1', kind: 'dynamic', title: 'files.read_file', input: 'not json' } },
    });
    expect(adapt({
      type: 'custom_tool_call', call_id: 'custom-1', name: 'render', input: 'image', status: 'completed',
    })).toMatchObject({
      type: 'item.started', payload: { toolPart: { id: 'custom-1', title: 'render', status: 'completed' } },
    });
    expect(adapt({ type: 'function_call_output', call_id: 'function-1', output: { result: 'done' } })).toMatchObject({
      type: 'item.updated', payload: { itemId: 'function-1', status: 'completed', output: { result: 'done' } },
    });
    expect(adapt({
      type: 'custom_tool_call_output', call_id: 'custom-1', name: 'render', output: [{ type: 'input_text', text: 'done' }],
    })).toMatchObject({
      type: 'item.updated', payload: { itemId: 'custom-1', title: 'render', status: 'completed' },
    });
  });

  it('maps tool search calls and outputs', () => {
    expect(adapt({
      type: 'tool_search_call', call_id: 'search-call', status: 'inProgress', execution: 'server',
      arguments: { query: 'calendar' },
    })).toMatchObject({
      type: 'item.started',
      payload: { toolPart: { id: 'search-call', title: 'codex.tool_search', status: 'running' } },
    });
    expect(adapt({
      type: 'tool_search_output', call_id: null, status: 'failed', execution: 'server', tools: [{ name: 'calendar' }],
    })).toMatchObject({
      type: 'item.updated', payload: { itemId: 'raw-tool_search_output', status: 'failed' },
    });
  });

  it('maps web search and image generation variants', () => {
    expect(adapt({ type: 'web_search_call', id: 'web-1', action: { type: 'search', query: 'Codex SDK' } })).toMatchObject({
      type: 'item.completed', payload: { toolPart: { id: 'web-1', title: 'Web search', body: 'Codex SDK' } },
    });
    expect(adapt({ type: 'web_search_call', action: { searchTerm: 'app-server' } })).toMatchObject({
      payload: { toolPart: { id: 'raw-web_search_call', body: 'app-server' } },
    });
    expect(adapt({ type: 'web_search_call', action: null })).toMatchObject({
      payload: { toolPart: { body: 'web search' } },
    });
    expect(adapt({
      type: 'image_generation_call', id: 'image-1', status: 'completed', revised_prompt: 'A polished UI', result: 'png-data',
    })).toMatchObject({
      type: 'item.completed',
      payload: { toolPart: { id: 'image-1', title: 'image_generation', status: 'completed', body: 'png-data' } },
    });
    expect(adapt({ type: 'image_generation_call', status: 'failed', result: '' })).toMatchObject({
      payload: { toolPart: { id: 'raw-image_generation_call', status: 'failed' } },
    });
  });
});
