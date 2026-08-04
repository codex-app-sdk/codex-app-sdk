import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import type { CodexSurfaceEvent } from '../src/surface';
import { FakeTransport, createSurface, deferred, lastRequest, pluginSummary, requestsFor, thread } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it('validates the trusted top-level CODEX_HOME seam and rejects transport conflicts', () => {
    const client = new CodexAppServerClient(new FakeTransport());
    expect(() => new CodexSurface({ client, codexHome: 'relative/home' })).toThrow(
      'codexHome must be an absolute path',
    );
    expect(() => new CodexSurface({ client, codexHome: '   ' })).toThrow('codexHome cannot be empty');
    expect(() => new CodexSurface({
      client,
      codexHome: '/tmp/codex-a',
      transport: { codexHome: '/tmp/codex-b' },
    })).toThrow('codexHome conflicts with transport.codexHome');
    expect(() => new CodexSurface({
      client,
      codexHome: '/tmp/codex-a',
      transport: { codexHome: '/tmp/codex-a' },
    })).not.toThrow();
  });

  it('enters an error state after disconnect and reconnects the app-server', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    transport.fail(new Error('app-server exited'));
    expect(surface.getSnapshot()).toMatchObject({
      status: 'error',
      busy: false,
      approvals: [],
      error: 'app-server exited',
    });

    await expect(surface.connect()).resolves.toMatchObject({ status: 'ready', error: null });
    expect(transport.start).toHaveBeenCalledTimes(2);
    expect(requestsFor(transport, 'account/read')).toHaveLength(2);
    expect(requestsFor(transport, 'thread/list')).toHaveLength(2);
    expect(requestsFor(transport, 'thread/resume')).toHaveLength(2);

    await surface.sendMessage('Message after reconnect');
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: expect.objectContaining({ threadId: 'thread-existing' }),
    });
  });

  it('clears authenticated state when a restarted app-server reports a signed-out account', async () => {
    let account: Record<string, unknown> | null = {
      type: 'chatgpt', email: 'before@example.test', planType: 'pro',
    };
    const transport = new FakeTransport({
      'account/read': () => ({ account, requiresOpenaiAuth: true }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().conversations).toHaveLength(1);

    transport.fail(new Error('restart'));
    account = null;
    await surface.connect();

    expect(surface.getSnapshot()).toMatchObject({
      status: 'ready',
      authentication: { account: null, requiresOpenaiAuth: true },
      conversations: [],
      activeConversationId: null,
      messages: [],
      models: [],
      modelCatalogStatus: 'notLoaded',
      plugins: [],
      pluginCatalogStatus: 'notLoaded',
    });
    expect(requestsFor(transport, 'thread/list')).toHaveLength(1);
  });

  it('bootstraps Codex and exposes conversation summaries without protocol details', async () => {
    const { surface, transport } = createSurface();
    const listener = vi.fn();
    surface.onStateChange(listener);

    const snapshot = await surface.connect();

    expect(snapshot).toMatchObject({
      status: 'ready',
      activeConversationId: 'thread-existing',
      conversations: [{
        id: 'thread-existing',
        title: 'Existing thread',
        preview: 'Existing thread',
        cwd: '/tmp/project',
      }],
      messages: expect.arrayContaining([expect.objectContaining({
        id: 'user-thread-existing-turn-history-user-history',
      })]),
      modelCatalogStatus: 'loaded',
      selectedModelId: 'gpt-5',
      approvalPreset: 'ask-for-approval',
    });
    expect(transport.sent.map((message) => 'method' in message ? message.method : null)).toStrictEqual([
      'initialize', 'initialized', 'account/read', 'model/list', 'skills/list', 'permissionProfile/list',
      'account/rateLimits/read', 'thread/list', 'configRequirements/read', 'thread/resume', 'thread/goal/get',
      'plugin/installed',
    ]);
    expect(lastRequest(transport, 'account/read')).toMatchObject({ params: { refreshToken: false } });
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        excludeTurns: true,
        initialTurnsPage: { limit: 50, itemsView: 'full', sortDirection: 'desc' },
      },
    });
    expect(listener).toHaveBeenCalled();
    await expect(surface.connect()).resolves.toMatchObject({ status: 'ready' });
    expect(transport.start).toHaveBeenCalledOnce();
  });

  it('exposes the installed plugin catalog with canonical ids and renderer-safe presentation metadata', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [
          thread('thread-existing', false),
          { ...thread('thread-other', false), cwd: '/workspace/other' },
        ],
        nextCursor: null,
      }),
      'plugin/installed': () => ({
        marketplaces: [{
          name: 'installed',
          plugins: [
            pluginSummary('gmail@openai-curated-remote', 'gmail', {
              displayName: ' Gmail ',
              shortDescription: ' Mail and calendar ',
              longDescription: ' Work with Gmail messages. ',
              brandColor: ' #ea4335 ',
              composerIconUrl: 'https://cdn.example.com/gmail-composer.png',
              logoUrl: 'https://cdn.example.com/gmail-logo.png',
              logoUrlDark: 'https://cdn.example.com/gmail-logo-dark.png',
            }),
            pluginSummary('drive@openai-curated-remote', 'drive', {
              displayName: 'Drive',
              logoUrl: 'https://cdn.example.com/drive-logo.png',
              logoUrlDark: 'https://cdn.example.com/drive-logo-dark.png',
            }),
          ],
        }],
        marketplaceLoadErrors: [],
      }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));

    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));

    expect(lastRequest(transport, 'plugin/installed')).toMatchObject({
      params: { cwds: ['/tmp/project', '/workspace/other'] },
    });
    expect(surface.getSnapshot().plugins).toStrictEqual([
      {
        id: 'gmail@openai-curated-remote',
        name: 'gmail',
        displayName: 'Gmail',
        shortDescription: 'Mail and calendar',
        longDescription: 'Work with Gmail messages.',
        brandColor: '#ea4335',
        iconUrl: 'https://cdn.example.com/gmail-composer.png',
        iconUrlDark: 'https://cdn.example.com/gmail-composer.png',
        enabled: true,
      },
      {
        id: 'drive@openai-curated-remote',
        name: 'drive',
        displayName: 'Drive',
        iconUrl: 'https://cdn.example.com/drive-logo.png',
        iconUrlDark: 'https://cdn.example.com/drive-logo-dark.png',
        enabled: true,
      },
    ]);
    expect(events.filter((event) => event.type === 'catalog.pluginsChanged')).toStrictEqual([
      expect.objectContaining({
        origin: 'action',
        payload: { plugins: [], status: 'loading' },
      }),
      expect.objectContaining({
        origin: 'action',
        payload: { plugins: surface.getSnapshot().plugins, status: 'loaded' },
      }),
    ]);
  });

  it('does not block ready state on a cold installed-plugin lookup', async () => {
    const pendingPlugins = deferred<unknown>();
    const transport = new FakeTransport({
      'plugin/installed': () => pendingPlugins.promise,
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });

    await expect(surface.connect()).resolves.toMatchObject({
      status: 'ready',
      pluginCatalogStatus: 'loading',
      plugins: [],
    });
    expect(lastRequest(transport, 'plugin/installed')).toBeDefined();

    pendingPlugins.resolve({ marketplaces: [], marketplaceLoadErrors: [] });
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));
  });

  it('connects signed out and becomes fully usable after managed ChatGPT login completes', async () => {
    let account: Record<string, unknown> | null = null;
    const transport = new FakeTransport({
      'account/read': () => ({ account, requiresOpenaiAuth: true }),
      'account/login/start': () => ({
        type: 'chatgpt',
        loginId: 'login-1',
        authUrl: 'https://auth.example.test/login',
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });

    await expect(surface.connect()).resolves.toMatchObject({
      status: 'ready',
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: true,
        error: null,
      },
      conversations: [],
      modelCatalogStatus: 'notLoaded',
    });
    expect(requestsFor(transport, 'thread/list')).toHaveLength(0);

    await expect(surface.startChatGptLogin()).resolves.toStrictEqual({
      loginId: 'login-1',
      authUrl: 'https://auth.example.test/login',
    });
    expect(lastRequest(transport, 'account/login/start')).toMatchObject({
      params: { type: 'chatgpt' },
    });
    expect(surface.getSnapshot().authentication.login).toMatchObject({
      status: 'pending',
      loginId: 'login-1',
    });

    account = { type: 'chatgpt', email: 'kid@example.test', planType: 'plus' };
    transport.emit({
      method: 'account/login/completed',
      params: { loginId: 'login-1', success: true, error: null },
    });
    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      status: 'ready',
      authentication: {
        account: { type: 'chatgpt', email: 'kid@example.test', planType: 'plus' },
        requiresOpenaiAuth: true,
        login: { status: 'completed', loginId: 'login-1', error: null },
      },
      modelCatalogStatus: 'loaded',
      conversations: [{ id: 'thread-existing' }],
    }));

    await surface.createConversation();
    await surface.sendMessage('Hello after login');
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: expect.objectContaining({ threadId: 'thread-new' }),
    });
  });

});
