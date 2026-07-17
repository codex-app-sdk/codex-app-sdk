import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceApi, CodexSurfaceSnapshot } from 'codex-app-sdk/surface';
import App from '../src/App.vue';

describe('basic sample App', () => {
  afterEach(() => vi.restoreAllMocks());

  it('connects, selects the newest conversation, and sends through the SDK pane', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    expect(api.connect).toHaveBeenCalledOnce();
    expect(api.selectConversation).toHaveBeenCalledWith('thread-1');
    await wrapper.get('textarea').setValue('Build a new surface');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.sendMessage).toHaveBeenCalledWith('Build a new surface', undefined);
  });

  it('demonstrates menu extensibility with a sample-provided refresh action', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('.codex-composer-menu__trigger').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Refresh conversations'))!.trigger('click');
    await flushPromises();
    expect(api.refreshConversations).toHaveBeenCalledOnce();
  });
});

const snapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  conversations: [{
    id: 'thread-1', title: 'First thread', preview: 'First thread', cwd: '/tmp/project', status: 'idle',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }],
  activeConversationId: null,
  messages: [],
  busy: false,
  error: null,
};

function fakeSurfaceApi(): CodexSurfaceApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    connect: vi.fn(async () => snapshot),
    createConversation: vi.fn(async () => snapshot),
    getSnapshot: vi.fn(async () => snapshot),
    interrupt: vi.fn(async () => snapshot),
    onStateChange: vi.fn(() => vi.fn()),
    refreshConversations: vi.fn(async () => snapshot),
    selectConversation: vi.fn(async () => ({ ...snapshot, activeConversationId: 'thread-1' })),
    sendMessage: vi.fn(async () => snapshot),
  };
}
