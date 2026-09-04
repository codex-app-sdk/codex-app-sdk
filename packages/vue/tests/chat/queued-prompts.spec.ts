import { describe, expect, it } from 'vitest';
import { createQueuedChatPrompt } from '../../src/chat/queued-prompts';

describe('createQueuedChatPrompt', () => {
  it('preserves prompt text and assigns monotonically increasing identities', () => {
    const first = createQueuedChatPrompt('first prompt');
    const second = createQueuedChatPrompt('second prompt');
    const firstId = Number(first.id.replace('queued-prompt-', ''));
    const secondId = Number(second.id.replace('queued-prompt-', ''));

    expect(first).toStrictEqual({ id: `queued-prompt-${firstId}`, text: 'first prompt' });
    expect(second).toStrictEqual({ id: `queued-prompt-${secondId}`, text: 'second prompt' });
    expect(Number.isInteger(firstId)).toBe(true);
    expect(secondId).toBe(firstId + 1);
  });
});
