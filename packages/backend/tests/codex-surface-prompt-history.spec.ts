import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import { FakeTransport, responseFor, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface prompt history', () => {
  it('reads one bounded summary page and retains only chronological visible user prompts', async () => {
    const transport = new FakeTransport({
      'thread/turns/list': (params) => {
        expect(params).toStrictEqual({
          threadId: 'thread-prompts',
          cursor: null,
          limit: 100,
          sortDirection: 'desc',
          itemsView: 'summary',
        });
        return {
          data: [
            turn('turn-new', 'completed', [
              { type: 'userMessage', id: 'user-empty', clientId: null, content: [
                { type: 'text', text: '(no user instructions)', text_elements: [] },
              ] },
              { type: 'agentMessage', id: 'assistant-new', text: 'Ignored', phase: null, memoryCitation: null },
              { type: 'userMessage', id: 'user-new', clientId: null, content: [
                { type: 'text', text: '$cp', text_elements: [] },
                { type: 'skill', name: 'Commit-Push', path: '/skills/cp/SKILL.md' },
              ] },
            ]),
            turn('turn-old', 'completed', [
              { type: 'userMessage', id: 'user-old', clientId: null, content: [
                { type: 'text', text: '<context>hidden</context> First prompt ', text_elements: [] },
                { type: 'image', url: 'data:image/png;base64,abc' },
              ] },
              { type: 'agentMessage', id: 'assistant-old', text: 'Ignored', phase: null, memoryCitation: null },
            ]),
          ],
          nextCursor: 'older',
          backwardsCursor: null,
        };
      },
      'thread/list': (params) => responseFor('thread/list', params),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
      autoSelectFirstConversation: false,
    });
    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));
    const before = surface.getSnapshot();
    const stateChanged = vi.fn();
    const unsubscribe = surface.onStateChange(stateChanged);

    await expect(surface.readConversationPromptHistory(' thread-prompts ')).resolves.toStrictEqual({
      conversationId: 'thread-prompts',
      prompts: ['First prompt', '$cp'],
    });
    expect(surface.getSnapshot()).toStrictEqual(before);
    expect(stateChanged).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('rejects an absent active conversation before requesting turns', async () => {
    const transport = new FakeTransport();
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      autoSelectFirstConversation: false,
    });
    await surface.connect();

    await expect(surface.readConversationPromptHistory()).rejects.toThrow('Conversation id cannot be empty');
  });
});
