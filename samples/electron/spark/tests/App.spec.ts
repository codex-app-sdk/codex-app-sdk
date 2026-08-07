import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexNativeRendererApi } from '@codex-app-sdk/electron';
import App from '../src/renderer/App.vue';
import { fakeSurfaceApi, surfaceSnapshot } from './fakes';

describe('Spark App', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'codexAppSdkNative');
    Reflect.deleteProperty(window, 'codexSurface');
  });

  it('reuses one themed SDK conversation pane with advanced capabilities disabled', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    expect(api.connect).toHaveBeenCalledOnce();
    const pane = wrapper.getComponent({ name: 'CodexConversationPane' });
    expect(pane.classes()).toContain('spark-chat');
    expect(pane.props('attachEnabled')).toBe(false);
    expect(pane.props('capabilities')).toMatchObject({
      approvals: false,
      goals: false,
      models: false,
      planMode: false,
      reasoningEffort: false,
      skills: false,
    });
    expect(pane.props('presentation')).toStrictEqual({
      composer: { actionMenu: false, contextUsage: false, voice: false },
      messages: {
        actions: { copy: false, delete: false, edit: false, quote: false, retry: false },
        toolBlocks: false,
      },
      shelf: { goal: false, queuedPrompts: false, turnGitDiff: false },
    });
    expect(wrapper.text()).toContain('Hi! I’m Spark.');
    expect(wrapper.find('[aria-label="Model and reasoning"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Composer actions"]').exists()).toBe(false);
  });

  it('shows a kid-friendly sign-in page and opens the SDK login URL', async () => {
    const signedOut = surfaceSnapshot({
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: true,
        error: null,
        login: { status: 'idle', loginId: null, authUrl: null, error: null },
      },
      conversations: [],
      activeConversationId: null,
    });
    const api = fakeSurfaceApi(signedOut);
    const native = fakeNativeApi();
    window.codexSurface = api;
    window.codexAppSdkNative = native;
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain('Welcome to Spark!');
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).exists()).toBe(false);
    await wrapper.get('.spark-landing__sign-in').trigger('click');
    await flushPromises();

    expect(api.startChatGptLogin).toHaveBeenCalledOnce();
    expect(native.openExternal).toHaveBeenCalledWith('https://auth.example.test/login');
  });

  it('does not infer signed-out state when the server says OpenAI auth is not required', async () => {
    const api = fakeSurfaceApi(surfaceSnapshot({
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: false,
        error: null,
        login: { status: 'idle', loginId: null, authUrl: null, error: null },
      },
    }));
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find('.spark-landing').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).exists()).toBe(true);
  });

  it('enters the same chat surface after the SDK reports a completed login', async () => {
    const signedOut = surfaceSnapshot({
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: true,
        error: null,
        login: { status: 'pending', loginId: 'login-1', authUrl: 'https://auth.example.test/login', error: null },
      },
      conversations: [],
      activeConversationId: null,
    });
    const api = fakeSurfaceApi(signedOut);
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    const wrapper = mount(App);
    await flushPromises();

    api.pushSnapshot(surfaceSnapshot());
    await flushPromises();

    expect(wrapper.find('.spark-landing').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).exists()).toBe(true);
  });

  it('signs out through the SDK account menu and returns to the landing page', async () => {
    const signedOut = surfaceSnapshot({
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: true,
        error: null,
        login: { status: 'idle', loginId: null, authUrl: null, error: null },
      },
      conversations: [],
      activeConversationId: null,
    });
    const api = fakeSurfaceApi();
    api.logout.mockResolvedValue(signedOut);
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain('ChatGPT account');
    await wrapper.get('.spark-account__menu button').trigger('click');
    await flushPromises();

    expect(api.logout).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Welcome to Spark!');
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).exists()).toBe(false);
  });

  it('cancels a started SDK login when the external sign-in page cannot open', async () => {
    const signedOut = surfaceSnapshot({
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: true,
        error: null,
        login: { status: 'idle', loginId: null, authUrl: null, error: null },
      },
    });
    const api = fakeSurfaceApi(signedOut);
    const native = fakeNativeApi({ openExternal: vi.fn(async () => { throw new Error('blocked'); }) });
    window.codexSurface = api;
    window.codexAppSdkNative = native;
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('.spark-landing__sign-in').trigger('click');
    await flushPromises();

    expect(api.cancelLogin).toHaveBeenCalledWith('login-1');
    expect(wrapper.get('[role="alert"]').text()).toContain('ask a grown-up to try again');
  });

  it('offers a friendly retry when the SDK surface cannot connect', async () => {
    const ready = surfaceSnapshot();
    const api = fakeSurfaceApi(ready);
    api.connect.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ready);
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain('Spark couldn’t start');
    await wrapper.get('.spark-status button').trigger('click');
    await flushPromises();

    expect(api.connect).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).exists()).toBe(true);
  });

  it('starts a chat from a large kid-friendly suggestion', async () => {
    const snapshot = surfaceSnapshot({ conversations: [], activeConversationId: null });
    const created = surfaceSnapshot();
    const api = fakeSurfaceApi(snapshot);
    api.createConversation.mockResolvedValue(created);
    api.sendMessage.mockResolvedValue(created);
    window.codexSurface = api;
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.findAll('.spark-prompts button')[1]!.trigger('click');
    await flushPromises();
    expect(api.createConversation).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalledWith('Tell me something amazing about space.', undefined);
  });
});

function fakeNativeApi(overrides: Partial<CodexNativeRendererApi> = {}): CodexNativeRendererApi {
  return {
    capabilities: { attachments: false, clipboard: true, externalLinks: true, transcription: false },
    copyToClipboard: vi.fn(async () => undefined),
    ingestAttachments: vi.fn(async () => []),
    openExternal: vi.fn(async () => undefined),
    pickAttachments: vi.fn(async () => []),
    transcribeAudio: vi.fn(async () => ({ text: '' })),
    ...overrides,
  };
}
