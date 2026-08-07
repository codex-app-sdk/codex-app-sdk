import { describe, expect, it, vi } from 'vitest';
import { CodexSurfaceExtensionsController } from '../packages/backend/src/node/codex-surface-extensions-controller';

describe('CodexSurfaceExtensionsController', () => {
  it('validates and exposes normalized dynamic tool definitions', () => {
    expect(() => controller([tool('  ')]))
      .toThrow('Dynamic tool names cannot be empty');
    expect(() => new CodexSurfaceExtensionsController([{
      dynamicTools: [tool('duplicate'), tool(' duplicate ')],
    }], [], () => undefined)).toThrow("Duplicate dynamic tool 'duplicate'");

    const subject = controller([tool(' inspect ', true)]);
    expect(subject.hasDynamicTools()).toBe(true);
    expect(subject.dynamicToolSpecs()).toStrictEqual([{
      type: 'function', name: 'inspect', description: 'Inspect', inputSchema: { type: 'object' }, deferLoading: true,
    }]);
  });

  it('merges extension and per-conversation instructions in declaration order', async () => {
    const subject = new CodexSurfaceExtensionsController([{
      configureConversation: vi.fn(async () => ({
        baseInstructions: 'extension base',
        config: { extension: true },
        developerInstructions: ' extension developer ',
      })),
    }], [], () => undefined);

    await expect(subject.conversationExtension({ operation: 'start', conversationId: null }, {
      baseInstructions: 'conversation base',
      config: { conversation: true },
      developerInstructions: ' conversation developer ',
    })).resolves.toStrictEqual({
      baseInstructions: 'conversation base',
      config: { extension: true, conversation: true },
      developerInstructions: 'extension developer\n\nconversation developer',
    });
  });

  it('handles unknown, successful, image, and failed dynamic tool calls', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce('done')
      .mockResolvedValueOnce({ content: [{ type: 'image', imageUrl: 'data:image/png;base64,AA==' }], success: false })
      .mockRejectedValueOnce(new Error('tool failed'));
    const subject = controller([{ ...tool('inspect'), execute }], { extensionContext: { source: 'host' } });
    const responder = { resolve: vi.fn(), reject: vi.fn() };

    await subject.handleDynamicToolCall(request({ namespace: 'remote' }), responder as never);
    expect(responder.reject).toHaveBeenLastCalledWith(expect.objectContaining({ code: -32601 }));
    await subject.handleDynamicToolCall(request({ tool: 'missing' }), responder as never);
    expect(responder.reject).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('Unknown') }));

    await subject.handleDynamicToolCall(request(), responder as never);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ extensionContext: { source: 'host' } }));
    expect(responder.resolve).toHaveBeenLastCalledWith({
      success: true, contentItems: [{ type: 'inputText', text: 'done' }],
    });
    await subject.handleDynamicToolCall(request(), responder as never);
    expect(responder.resolve).toHaveBeenLastCalledWith({
      success: false, contentItems: [{ type: 'inputImage', imageUrl: 'data:image/png;base64,AA==' }],
    });
    await subject.handleDynamicToolCall(request(), responder as never);
    expect(responder.resolve).toHaveBeenLastCalledWith({
      success: false, contentItems: [{ type: 'inputText', text: 'tool failed' }],
    });
  });
});

function controller(dynamicTools: ReturnType<typeof tool>[], hostOptions?: { extensionContext: unknown }) {
  return new CodexSurfaceExtensionsController([{ dynamicTools }], [], () => hostOptions);
}

function tool(name: string, deferLoading?: boolean) {
  return {
    name, description: 'Inspect', inputSchema: { type: 'object' }, deferLoading,
    execute: vi.fn(async () => 'done'),
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1', method: 'item/tool/call',
    params: {
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1',
      namespace: null, tool: 'inspect', arguments: { value: 1 }, ...overrides,
    },
  } as never;
}
