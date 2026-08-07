import {
  invokeCodexSurfaceBridgeOperation,
  type CodexSurfaceBridgeAttachmentResolver,
  type CodexSurfaceBridgeTarget,
} from '../src/surface-bridge';
import { describe, expect, it, vi } from 'vitest';

function targetWithSend(sendMessage = vi.fn().mockResolvedValue(undefined)) {
  return { sendMessage, target: { sendMessage } as unknown as CodexSurfaceBridgeTarget };
}

async function expectMessageRejected(
  options: unknown,
  message: string,
  resolveAttachment?: CodexSurfaceBridgeAttachmentResolver,
) {
  const { sendMessage, target } = targetWithSend();
  await expect(invokeCodexSurfaceBridgeOperation(
    target,
    'sendMessage',
    ['prompt', options],
    { resolveAttachment },
  )).rejects.toThrow(message);
  expect(sendMessage).not.toHaveBeenCalled();
}

describe('Codex surface bridge message options', () => {
  it('accepts empty collections and JSON scalar schemas', async () => {
    const { sendMessage, target } = targetWithSend();
    for (const outputSchema of [null, true, 'value', 42, [1, 'two', false]]) {
      await invokeCodexSurfaceBridgeOperation(target, 'sendMessage', [
        'prompt',
        { attachments: [], skills: [], outputSchema },
      ]);
    }
    expect(sendMessage).toHaveBeenCalledTimes(5);
  });

  it.each([
    [null, 'Message options must be an object'],
    [{ extra: true }, 'Message options contains unsupported property "extra"'],
    [{ attachments: {} }, 'Message attachments must be an array'],
    [{ attachments: [{ type: 'file', reference: 'ref' }] }, 'Message attachment references are not supported by this host'],
    [{ skills: {} }, 'Message skills must be an array'],
    [{ skills: [null] }, 'Message skill must be an object'],
    [{ skills: [{ name: 'skill', path: '/skill', extra: true }] }, 'Message skill contains unsupported property "extra"'],
    [{ skills: [{ name: '', path: '/skill' }] }, 'Message skill name must be a non-empty string'],
    [{ skills: [{ name: 'skill', path: '' }] }, 'Message skill path must be a non-empty string'],
    [{ model: '' }, 'Message model must be a non-empty string'],
    [{ reasoningEffort: 1 }, 'Message reasoning effort must be a non-empty string'],
    [{ serviceTier: false }, 'Message service tier must be a non-empty string'],
    [{ planMode: 'yes' }, 'Message plan mode must be a boolean'],
  ] as const)('rejects malformed message options', async (options, message) => {
    await expectMessageRejected(options, message);
  });

  it.each([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [1n],
    [Symbol('schema')],
    [new Date()],
  ])('rejects a non-JSON output schema', async (outputSchema) => {
    await expectMessageRejected({ outputSchema }, 'Message output schema must be JSON-serializable');
  });

  it('rejects cyclic, sparse, decorated, symbol-bearing, and accessor JSON structures', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = Array(2);
    sparse[0] = 'only';
    const decorated = ['value'] as unknown[] & { extra?: boolean };
    decorated.extra = true;
    const symbolObject = { value: true } as Record<PropertyKey, unknown>;
    symbolObject[Symbol('secret')] = true;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'hidden', { get: () => true });

    for (const outputSchema of [cyclic, sparse, decorated, symbolObject, accessor]) {
      await expectMessageRejected({ outputSchema }, 'Message output schema must be JSON-serializable');
    }
  });

  it.each([
    [null, 'Message attachment must be an object'],
    [{ type: 'video', reference: 'ref' }, 'Message attachment type is invalid'],
    [{ type: 'file', reference: 'ref', detail: 'high' }, 'Message attachment contains unsupported property "detail"'],
    [{ type: 'image', reference: 'ref', detail: 'maximum' }, 'Message image detail is invalid'],
    [{ type: 'file', reference: '' }, 'Message attachment reference must be a non-empty string'],
  ] as const)('rejects malformed attachment references', async (attachment, message) => {
    await expectMessageRejected(
      { attachments: [attachment] },
      message,
      async (input) => ({ type: input.type, path: '/resolved' }),
    );
  });

  it('preserves every supported image detail value', async () => {
    const { sendMessage, target } = targetWithSend();
    for (const detail of ['auto', 'low', 'high', 'original'] as const) {
      await invokeCodexSurfaceBridgeOperation(target, 'sendMessage', [
        'prompt',
        { attachments: [{ type: 'image', reference: `image:${detail}`, detail }] },
      ], {
        resolveAttachment: async () => ({ type: 'image', path: '/resolved.png' }),
      });
    }
    expect(sendMessage).toHaveBeenNthCalledWith(1, 'prompt', {
      attachments: [{ type: 'image', path: '/resolved.png', detail: 'auto' }],
    });
    expect(sendMessage).toHaveBeenNthCalledWith(4, 'prompt', {
      attachments: [{ type: 'image', path: '/resolved.png', detail: 'original' }],
    });
  });

  it.each([
    [async (): Promise<unknown> => null, 'Resolved message attachment must be an object'],
    [async (): Promise<unknown> => ({ type: 'image', path: '/image.png' }), 'Resolved message attachment type does not match'],
    [async (): Promise<unknown> => ({ type: 'file', path: '' }), 'Resolved message attachment path must be a non-empty string'],
    [async (): Promise<unknown> => ({ type: 'file', path: '/file', name: '' }), 'Resolved message attachment name must be a non-empty string'],
    [async (): Promise<unknown> => ({ type: 'file', path: '/file', name: 'x'.repeat(1_025) }), 'Resolved message attachment name is too long'],
    [async (): Promise<unknown> => ({ type: 'file', path: '/file', mimeType: '' }), 'Resolved message attachment MIME type must be a non-empty string'],
  ] as const)('validates host-resolved attachments', async (resolver, message) => {
    await expectMessageRejected(
      { attachments: [{ type: 'file', reference: 'file:1' }] },
      message,
      resolver as CodexSurfaceBridgeAttachmentResolver,
    );
  });
});
