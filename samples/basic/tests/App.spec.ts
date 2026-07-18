import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceApi, CodexSurfaceSnapshot } from 'codex-app-sdk/surface';
import App from '../src/App.vue';

describe('basic sample App', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a custom conversation list and sends through the SDK pane', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    expect(api.connect).toHaveBeenCalledOnce();
    expect(wrapper.get('[aria-label="Conversations"]').text()).toContain('First thread');
    await wrapper.get('.conversation-sidebar__item').trigger('click');
    await flushPromises();
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
    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Refresh conversations'))!.trigger('click');
    await flushPromises();
    expect(api.refreshConversations).toHaveBeenCalledOnce();
  });

  it('wires app-server model and permission state into the SDK pane', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('button[aria-label="Model and reasoning"]').trigger('click');
    await wrapper.findAll('[role="menuitemradio"]')[1]!.trigger('click');
    await flushPromises();
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ modelId: 'gpt-5.4-mini' });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('[role="menuitemradio"]')[2]!.trigger('click');
    await flushPromises();
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ approvalPreset: 'full-access' });
  });
});

const snapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  conversations: [{
    id: 'thread-1', title: 'First thread', preview: 'First thread', cwd: '/tmp/project', status: 'idle',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }],
  activeConversationId: 'thread-1',
  messages: [],
  approvals: [],
  models: [
    {
      id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT-5.4', isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    },
    {
      id: 'gpt-5.4-mini', model: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini',
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    },
  ],
  modelCatalogStatus: 'loaded',
  skills: [],
  skillCatalogStatus: 'loaded',
  permissionProfiles: [
    { id: ':workspace', description: null, allowed: true },
    { id: ':danger-full-access', description: null, allowed: true },
  ],
  approvalPresets: ['ask-for-approval', 'approve-for-me', 'full-access'],
  approvalPreset: 'ask-for-approval',
  selectedModelId: 'gpt-5.4',
  selectedReasoningEffort: 'medium',
  planMode: false,
  contextUsage: null,
  goal: null,
  turnGitDiff: null,
  queuedPrompts: [],
  busy: false,
  error: null,
};

function fakeSurfaceApi(): CodexSurfaceApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    clearGoal: vi.fn(async () => snapshot),
    connect: vi.fn(async () => snapshot),
    createConversation: vi.fn(async () => snapshot),
    deleteMessage: vi.fn(async () => snapshot),
    deleteQueuedPrompt: vi.fn(async () => snapshot),
    editMessage: vi.fn(async () => snapshot),
    getSnapshot: vi.fn(async () => snapshot),
    interrupt: vi.fn(async () => snapshot),
    onStateChange: vi.fn(() => vi.fn()),
    refreshConversations: vi.fn(async () => snapshot),
    respondToClientRequest: vi.fn(async () => snapshot),
    resolveApproval: vi.fn(async () => snapshot),
    retryMessage: vi.fn(async () => snapshot),
    setGoal: vi.fn(async () => snapshot),
    selectConversation: vi.fn(async () => ({ ...snapshot, activeConversationId: 'thread-1' })),
    sendMessage: vi.fn(async () => snapshot),
    steerMessage: vi.fn(async () => snapshot),
    steerQueuedPrompt: vi.fn(async () => snapshot),
    updateConversationSettings: vi.fn(async () => snapshot),
  };
}
