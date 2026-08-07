import {
  codexSurfaceBridgeOperations,
  invokeCodexSurfaceBridgeOperation,
  isCodexSurfaceBridgeOperation,
  type CodexSurfaceBridgeTarget,
} from '@codex-app-sdk/core/surface-bridge';
import { describe, expect, it, vi } from 'vitest';

describe('Codex surface bridge', () => {
  it('recognizes every supported operation without accepting inherited names', () => {
    expect(codexSurfaceBridgeOperations).toContain('sendMessage');
    expect(isCodexSurfaceBridgeOperation('sendMessage')).toBe(true);
    expect(isCodexSurfaceBridgeOperation('toString')).toBe(false);
    expect(isCodexSurfaceBridgeOperation('__proto__')).toBe(false);
  });

  it('validates and forwards renderer input including service tiers', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ marker: 'snapshot' });
    const target = { sendMessage } as unknown as CodexSurfaceBridgeTarget;

    await expect(invokeCodexSurfaceBridgeOperation(target, 'sendMessage', [
      'Hello',
      {
        attachments: [{ type: 'file', reference: 'attachment:notes' }],
        serviceTier: 'priority',
        planMode: true,
      },
    ], {
      resolveAttachment: async (attachment) => ({
        type: attachment.type,
        path: '/srv/user/notes.md',
        name: 'notes.md',
      }),
    })).resolves.toStrictEqual({ marker: 'snapshot' });
    expect(sendMessage).toHaveBeenCalledWith('Hello', {
      attachments: [{ type: 'file', path: '/srv/user/notes.md', name: 'notes.md' }],
      serviceTier: 'priority',
      planMode: true,
    });
  });

  it('rejects malformed arity and non-serializable nested values', async () => {
    const target = { sendMessage: vi.fn() } as unknown as CodexSurfaceBridgeTarget;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(invokeCodexSurfaceBridgeOperation(
      target,
      'sendMessage',
      [],
      { operationLabel: 'transport:send-message' },
    )).rejects.toThrow('transport:send-message received an invalid number of arguments');
    await expect(invokeCodexSurfaceBridgeOperation(target, 'sendMessage', [
      'Hello',
      { outputSchema: cyclic },
    ])).rejects.toThrow('Message output schema must be JSON-serializable');
    expect(target.sendMessage).not.toHaveBeenCalled();
  });
});
