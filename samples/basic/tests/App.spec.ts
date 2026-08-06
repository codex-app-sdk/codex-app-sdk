import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { CodexNativeAttachmentInput, CodexNativeRendererApi } from 'codex-app-sdk/electron';
import type { CodexSurfaceRendererApi, CodexSurfaceSnapshot } from 'codex-app-sdk/surface';
import App from '../src/renderer/App.vue';

describe('basic sample App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'codexAppSdkNative');
  });

  it('renders its custom conversation list and sends through one bound SDK pane', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    expect(api.connect).toHaveBeenCalledOnce();
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).props('surface')).toBeDefined();
    expect(wrapper.get('[aria-label="Conversations"]').text()).toContain('First thread');
    expect(wrapper.text()).toContain('Start a conversation with Codex');
    expect(wrapper.text()).not.toContain('This sample asks before protected tool calls');
    expect(wrapper.findAll('[aria-label="Status: active"]')).toHaveLength(2);

    const conversationItems = wrapper.findAll('.conversation-sidebar__select');
    expect(conversationItems.every((item) => item.attributes('disabled') === undefined)).toBe(true);
    await conversationItems[1]!.trigger('click');
    await flushPromises();
    expect(api.selectConversation).toHaveBeenCalledWith('thread-2');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await wrapper.findAll('.conversation-sidebar__delete')[1]!.trigger('click');
    await flushPromises();
    expect(api.deleteConversation).toHaveBeenCalledWith('thread-2');

    await setComposerText(wrapper, 'Build a new surface');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.sendMessage).toHaveBeenCalledWith('Build a new surface', undefined);

    await setComposerText(wrapper, '/goal Ship the sample');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.sendMessage).toHaveBeenLastCalledWith('/goal Ship the sample', undefined);
  });

  it('gets app-server models, permission presets, and plan mode through the bound SDK pane', async () => {
    const api = fakeSurfaceApi();
    vi.mocked(api.updateConversationSettings).mockImplementation(async (settings) => ({
      ...snapshot,
      approvalPreset: settings.approvalPreset ?? snapshot.approvalPreset,
      planMode: settings.planMode ?? snapshot.planMode,
      selectedModelId: settings.modelId ?? snapshot.selectedModelId,
      selectedReasoningEffort: settings.reasoningEffort ?? snapshot.selectedReasoningEffort,
    }));
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('button[aria-label="Model and reasoning"]').trigger('click');
    await wrapper.findAll('[role="menuitemradio"]')[1]!.trigger('click');
    await flushPromises();
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ modelId: 'gpt-5.4-mini' });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.get('.codex-composer-menu-list__submenu').trigger('mouseenter');
    const fullAccess = wrapper.findAll('[role="menuitemradio"]')
      .find((item) => item.text().includes('Full access'))!;
    await fullAccess.trigger('click');
    await flushPromises();
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ approvalPreset: 'full-access' });

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.get('.codex-composer-menu-list__submenu').trigger('mouseenter');
    expect(wrapper.findAll('[role="menuitemradio"]')
      .find((item) => item.text().includes('Full access'))!
      .attributes('aria-checked')).toBe('true');
    document.body.click();
    await wrapper.vm.$nextTick();

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.get('[role="menuitemcheckbox"]').trigger('click');
    await flushPromises();
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ planMode: true });
  });

  it('gets native attachment picking through the SDK without sample callbacks', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const attachment = {
      id: 'diagram',
      type: 'image' as const,
      path: '/tmp/diagram.png',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 3,
      previewUrl: 'data:image/png;base64,cG5n',
    };
    window.codexAppSdkNative = fakeNativeApi({
      pickAttachments: vi.fn(async () => [attachment]),
    });
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Add Files & Photos'))!.trigger('click');
    await flushPromises();
    expect(window.codexAppSdkNative.pickAttachments).toHaveBeenCalledOnce();
    expect(wrapper.get('.codex-conversation-pane__attachment-preview').attributes('src')).toBe(attachment.previewUrl);

    await setComposerText(wrapper, 'Review this image');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.sendMessage).toHaveBeenCalledWith('Review this image', {
      attachments: [{
        type: 'image',
        path: '/tmp/diagram.png',
        name: 'diagram.png',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,cG5n',
      }],
    });
  });

  it('uses the SDK native bridge for text and image paste plus image drop without sample callbacks', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const ingestAttachments = vi.fn(async (files: readonly CodexNativeAttachmentInput[]) => files.map((file) => ({
      id: file.name,
      type: 'image' as const,
      path: `/tmp/${file.name}`,
      name: file.name,
      mimeType: file.mimeType ?? 'image/png',
      size: file.data.byteLength,
      previewUrl: 'data:image/png;base64,cG5n',
    })));
    window.codexAppSdkNative = fakeNativeApi({ ingestAttachments });
    const wrapper = mount(App);
    await flushPromises();

    const pastedImage = imageFile('clipboard.png');
    await setComposerText(wrapper, 'Keep ');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [pastedImage], getData: () => 'the pasted text' },
    });
    composerEditor(wrapper).element.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(composerEditor(wrapper).text()).toBe('Keep the pasted text');
    await vi.waitFor(() => expect(ingestAttachments).toHaveBeenCalledOnce());
    expect(ingestAttachments).toHaveBeenLastCalledWith([{
      name: 'clipboard.png',
      mimeType: 'image/png',
      data: expect.any(ArrayBuffer),
    }]);
    expect(wrapper.text()).toContain('clipboard.png');

    const droppedImage = imageFile('dropped.png');
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [droppedImage], types: ['Files'] },
    });
    wrapper.get('.codex-conversation-pane').element.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(ingestAttachments).toHaveBeenCalledTimes(2));
    expect(ingestAttachments).toHaveBeenLastCalledWith([{
      name: 'dropped.png',
      mimeType: 'image/png',
      data: expect.any(ArrayBuffer),
    }]);
    expect(wrapper.text()).toContain('dropped.png');
  });
});

const snapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  authentication: {
    status: 'loaded',
    account: { type: 'chatgpt', email: 'test@example.test', planType: 'pro' },
    requiresOpenaiAuth: true,
    error: null,
    login: { status: 'idle', loginId: null, authUrl: null, error: null },
  },
  conversations: [{
    id: 'thread-1',
    title: 'First thread',
    preview: 'First thread',
    cwd: '/tmp/project',
    status: 'active',
    turnCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, {
    id: 'thread-2',
    title: 'Second active thread',
    preview: 'Still working',
    cwd: '/tmp/project',
    status: 'active',
    turnCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }],
  activeConversationId: 'thread-1',
  messages: [],
  clientRequests: [],
  answeredClientRequestIds: [],
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
  plugins: [],
  pluginCatalogStatus: 'loaded',
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
  threadStatus: null,
  rateLimits: null,
  queuedPrompts: [],
  busy: false,
  historyLoading: false,
  error: null,
};

function composerEditor(wrapper: VueWrapper) {
  return wrapper.get<HTMLElement>('.chat-rich-text-editor');
}

async function setComposerText(wrapper: VueWrapper, value: string): Promise<void> {
  composerEditor(wrapper).element.textContent = value;
  await composerEditor(wrapper).trigger('input');
  await nextTick();
}

function fakeSurfaceApi(): CodexSurfaceRendererApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    archiveConversation: vi.fn(async () => snapshot),
    cancelLogin: vi.fn(async () => snapshot),
    clearGoal: vi.fn(async () => snapshot),
    compactConversation: vi.fn(async () => snapshot),
    connect: vi.fn(async () => snapshot),
    createConversation: vi.fn(async () => snapshot),
    deleteConversation: vi.fn(async () => snapshot),
    deleteMessage: vi.fn(async () => snapshot),
    deleteQueuedPrompt: vi.fn(async () => snapshot),
    editMessage: vi.fn(async () => snapshot),
    forkMessage: vi.fn(async () => snapshot),
    getSnapshot: vi.fn(async () => snapshot),
    interrupt: vi.fn(async () => snapshot),
    listConversations: vi.fn(async () => snapshot.conversations),
    listModels: vi.fn(async () => snapshot.models),
    logout: vi.fn(async () => snapshot),
    onEvent: vi.fn(() => vi.fn()),
    onStateChange: vi.fn(() => vi.fn()),
    readConversationHistory: vi.fn(async (conversationId = 'thread-1') => ({
      conversationId,
      messages: [],
      threadStatus: null,
    })),
    refreshAccount: vi.fn(async () => snapshot),
    refreshConversations: vi.fn(async () => snapshot),
    renameConversation: vi.fn(async () => snapshot),
    respondToClientRequest: vi.fn(async () => snapshot),
    resolveApproval: vi.fn(async () => snapshot),
    retryMessage: vi.fn(async () => snapshot),
    setGoal: vi.fn(async () => snapshot),
    selectConversation: vi.fn(async () => ({ ...snapshot, activeConversationId: 'thread-1' })),
    sendMessage: vi.fn(async () => snapshot),
    startReview: vi.fn(async () => snapshot),
    startChatGptLogin: vi.fn(async () => ({
      loginId: 'login-1', authUrl: 'https://auth.example.test/login',
    })),
    steerMessage: vi.fn(async () => snapshot),
    steerQueuedPrompt: vi.fn(async () => snapshot),
    updateConversationSettings: vi.fn(async () => snapshot),
    unarchiveConversation: vi.fn(async () => snapshot),
  };
}

function fakeNativeApi(overrides: Partial<CodexNativeRendererApi> = {}): CodexNativeRendererApi {
  return {
    capabilities: { attachments: true, clipboard: true, externalLinks: true, transcription: true },
    copyToClipboard: vi.fn(async () => undefined),
    ingestAttachments: vi.fn(async () => []),
    openExternal: vi.fn(async () => undefined),
    pickAttachments: vi.fn(async () => []),
    transcribeAudio: vi.fn(async () => ({ text: '' })),
    ...overrides,
  };
}

function imageFile(name: string): File {
  const file = new File(['png'], name, { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  });
  return file;
}
