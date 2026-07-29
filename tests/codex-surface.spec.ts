import { describe, expect, it, vi } from 'vitest';
import type { RpcMessage, RpcTransport } from '../src/codex';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import type { CodexSurfaceEvent } from '../src/surface';

const generatedPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

class FakeTransport implements RpcTransport {
  readonly sent: RpcMessage[] = [];
  readonly close = vi.fn(async () => undefined);
  readonly start = vi.fn(async () => undefined);
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(private readonly responses: Record<string, (params: unknown) => unknown> = {}) {}

  send(message: RpcMessage): void {
    this.sent.push(message);
    if (!('id' in message) || !('method' in message)) return;
    const params = 'params' in message ? message.params : undefined;
    try {
      const response = this.responses[message.method]?.(params) ?? responseFor(message.method, params);
      void Promise.resolve(response).then(
        (result) => this.emit({ id: message.id, result }),
        (error: unknown) => this.emit({
          id: message.id,
          error: { code: -1, message: error instanceof Error ? error.message : String(error) },
        }),
      );
    } catch (error) {
      queueMicrotask(() => this.emit({
        id: message.id,
        error: { code: -1, message: error instanceof Error ? error.message : String(error) },
      }));
    }
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  fail(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

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
      'account/rateLimits/read', 'thread/list', 'configRequirements/read', 'thread/resume', 'thread/goal/get', 'thread/turns/list',
      'plugin/installed',
    ]);
    expect(lastRequest(transport, 'account/read')).toMatchObject({ params: { refreshToken: false } });
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        excludeTurns: true,
        initialTurnsPage: { limit: 5, itemsView: 'summary', sortDirection: 'desc' },
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

  it('gates immediate post-login sends until auth-dependent catalogs finish loading', async () => {
    let account: Record<string, unknown> | null = null;
    const models = deferred<unknown>();
    const transport = new FakeTransport({
      'account/read': () => ({ account, requiresOpenaiAuth: true }),
      'model/list': () => models.promise,
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      conversationDefaults: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    });
    await surface.connect();

    account = { type: 'chatgpt', email: 'kid@example.test', planType: 'plus' };
    transport.emit({
      method: 'account/login/completed',
      params: { loginId: 'login-immediate', success: true, error: null },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().authentication.account).toMatchObject({
      type: 'chatgpt',
      email: 'kid@example.test',
    }));

    const send = surface.sendMessage('Hello immediately');
    expect(lastRequest(transport, 'thread/start')).toBeUndefined();
    models.resolve({
      data: [testModel('gpt-5.6-terra', 'gpt-5.6-terra', true)],
      nextCursor: null,
    });
    await send;

    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: { model: 'gpt-5.6-terra' },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: expect.objectContaining({
        threadId: 'thread-new',
        model: 'gpt-5.6-terra',
        effort: 'medium',
      }),
    });
  });

  it('invalidates local conversation state when the authoritative account identity changes', async () => {
    let account = { type: 'chatgpt', email: 'account-a@example.test', planType: 'pro' };
    const transport = new FakeTransport({
      'account/read': () => ({ account, requiresOpenaiAuth: true }),
      'thread/list': () => ({
        data: account.email.startsWith('account-a') ? [thread('thread-existing', false)] : [],
        nextCursor: null,
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-existing',
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    });

    account = { type: 'chatgpt', email: 'account-b@example.test', planType: 'plus' };
    transport.emit({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'plus' } });

    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      authentication: {
        account: { type: 'chatgpt', email: 'account-b@example.test', planType: 'plus' },
      },
      conversations: [],
      activeConversationId: null,
      messages: [],
    }));
    expect(requestsFor(transport, 'thread/list')).toHaveLength(2);
  });

  it('retains account identity across account/read errors so a later account switch still invalidates state', async () => {
    let account = { type: 'chatgpt', email: 'account-a@example.test', planType: 'pro' };
    let failAccountRead = false;
    const transport = new FakeTransport({
      'account/read': () => {
        if (failAccountRead) throw new Error('account temporarily unavailable');
        return { account, requiresOpenaiAuth: true };
      },
      'thread/list': () => ({
        data: account.email.startsWith('account-a') ? [thread('thread-existing', false)] : [],
        nextCursor: null,
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().activeConversationId).toBe('thread-existing');

    failAccountRead = true;
    transport.emit({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'pro' } });
    await vi.waitFor(() => expect(surface.getSnapshot().authentication).toMatchObject({
      status: 'error',
      account: { email: 'account-a@example.test' },
      error: 'account temporarily unavailable',
    }));

    failAccountRead = false;
    account = { type: 'chatgpt', email: 'account-b@example.test', planType: 'plus' };
    await surface.refreshAccount();
    expect(surface.getSnapshot()).toMatchObject({
      authentication: { account: { email: 'account-b@example.test' } },
      conversations: [],
      activeConversationId: null,
      messages: [],
    });
  });

  it('does not invalidate conversation state for metadata changes on the same account', async () => {
    let account = { type: 'chatgpt', email: 'same@example.test', planType: 'plus' };
    const transport = new FakeTransport({
      'account/read': () => ({ account, requiresOpenaiAuth: true }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    const messages = surface.getSnapshot().messages;
    const resumeCount = requestsFor(transport, 'thread/resume').length;

    account = { type: 'chatgpt', email: 'same@example.test', planType: 'pro' };
    transport.emit({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'pro' } });
    await vi.waitFor(() => expect(surface.getSnapshot().authentication.account).toMatchObject({ planType: 'pro' }));

    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-existing',
      messages,
    });
    expect(requestsFor(transport, 'thread/resume')).toHaveLength(resumeCount);
  });

  it('deduplicates concurrent managed ChatGPT login starts', async () => {
    const login = deferred<unknown>();
    const transport = new FakeTransport({
      'account/read': () => ({ account: null, requiresOpenaiAuth: true }),
      'account/login/start': () => login.promise,
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    const first = surface.startChatGptLogin();
    const second = surface.startChatGptLogin();
    await vi.waitFor(() => expect(requestsFor(transport, 'account/login/start')).toHaveLength(1));
    login.resolve({
      type: 'chatgpt',
      loginId: 'login-shared',
      authUrl: 'https://auth.example.test/login',
    });

    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      { loginId: 'login-shared', authUrl: 'https://auth.example.test/login' },
      { loginId: 'login-shared', authUrl: 'https://auth.example.test/login' },
    ]);
    expect(requestsFor(transport, 'account/login/start')).toHaveLength(1);
  });

  it('runs a trailing authoritative account refresh when login completes during an older refresh', async () => {
    const staleRefresh = deferred<unknown>();
    let accountReadCount = 0;
    const transport = new FakeTransport({
      'account/read': () => {
        accountReadCount += 1;
        if (accountReadCount === 1) return { account: null, requiresOpenaiAuth: true };
        if (accountReadCount === 2) return staleRefresh.promise;
        return {
          account: { type: 'chatgpt', email: 'fresh@example.test', planType: 'plus' },
          requiresOpenaiAuth: true,
        };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    transport.emit({ method: 'account/updated', params: { authMode: 'chatgpt', planType: null } });
    await vi.waitFor(() => expect(requestsFor(transport, 'account/read')).toHaveLength(2));
    transport.emit({
      method: 'account/login/completed',
      params: { loginId: 'login-trailing', success: true, error: null },
    });
    staleRefresh.resolve({ account: null, requiresOpenaiAuth: true });

    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      authentication: {
        account: { type: 'chatgpt', email: 'fresh@example.test', planType: 'plus' },
        login: { status: 'completed', loginId: 'login-trailing' },
      },
      modelCatalogStatus: 'loaded',
    }));
    expect(requestsFor(transport, 'account/read')).toHaveLength(3);
  });

  it('still runs the trailing account refresh when the superseded refresh rejects', async () => {
    const staleRefresh = deferred<unknown>();
    let accountReadCount = 0;
    const transport = new FakeTransport({
      'account/read': () => {
        accountReadCount += 1;
        if (accountReadCount === 1) return { account: null, requiresOpenaiAuth: true };
        if (accountReadCount === 2) return staleRefresh.promise;
        return {
          account: { type: 'chatgpt', email: 'recovered@example.test', planType: 'plus' },
          requiresOpenaiAuth: true,
        };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    transport.emit({ method: 'account/updated', params: { authMode: 'chatgpt', planType: null } });
    await vi.waitFor(() => expect(requestsFor(transport, 'account/read')).toHaveLength(2));
    transport.emit({
      method: 'account/login/completed',
      params: { loginId: 'login-after-error', success: true, error: null },
    });
    staleRefresh.reject(new Error('superseded account read failed'));

    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      authentication: {
        status: 'loaded',
        account: { type: 'chatgpt', email: 'recovered@example.test' },
        login: { status: 'completed', loginId: 'login-after-error' },
      },
      modelCatalogStatus: 'loaded',
    }));
    expect(requestsFor(transport, 'account/read')).toHaveLength(3);
  });

  it('refreshes the full authoritative account projection on account updates', async () => {
    let account: Record<string, unknown> = {
      type: 'chatgpt', email: 'before@example.test', planType: 'pro',
    };
    const transport = new FakeTransport({
      'account/read': () => ({ account, requiresOpenaiAuth: true }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    account = { type: 'apiKey' };
    transport.emit({ method: 'account/updated', params: { authMode: 'apikey', planType: null } });
    await vi.waitFor(() => expect(surface.getSnapshot().authentication.account).toStrictEqual({ type: 'apiKey' }));
    expect(requestsFor(transport, 'account/read')).toHaveLength(2);
    expect(transport.sent.some((message) => 'method' in message && message.method === 'getAuthStatus')).toBe(false);
  });

  it('validates managed login responses and exposes cancellation and logout state', async () => {
    let signedOut = false;
    const transport = new FakeTransport({
      'account/read': () => signedOut
        ? { account: null, requiresOpenaiAuth: true }
        : { account: { type: 'apiKey' }, requiresOpenaiAuth: true },
      'account/login/start': () => ({ type: 'chatgpt', loginId: 'login-2', authUrl: 'file:///tmp/nope' }),
      'account/login/cancel': () => ({ status: 'canceled' }),
      'account/logout': () => {
        signedOut = true;
        return {};
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    await expect(surface.startChatGptLogin()).rejects.toThrow('unsupported authentication URL scheme');
    expect(surface.getSnapshot().authentication.login.status).toBe('error');
    await surface.cancelLogin('login-2');
    expect(lastRequest(transport, 'account/login/cancel')).toMatchObject({ params: { loginId: 'login-2' } });
    expect(surface.getSnapshot().authentication.login.status).toBe('cancelled');

    await surface.logout();
    expect(lastRequest(transport, 'account/logout')).toBeDefined();
    expect(surface.getSnapshot()).toMatchObject({
      authentication: { account: null, requiresOpenaiAuth: true },
      conversations: [],
      models: [],
    });
  });

  it('retries a transient plugin catalog failure on an explicit conversation refresh', async () => {
    let attempts = 0;
    const transport = new FakeTransport({
      'plugin/installed': () => {
        attempts += 1;
        if (attempts === 1) throw new Error('catalog unavailable');
        return { marketplaces: [], marketplaceLoadErrors: [] };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('error'));

    await surface.refreshConversations();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));

    expect(attempts).toBe(2);
  });

  it('materializes bounded local plugin icons without exposing filesystem URLs', async () => {
    const readPaths: string[] = [];
    const transport = new FakeTransport({
      'plugin/installed': () => ({
        marketplaces: [{
          name: 'local',
          plugins: [
            pluginSummary('local-plugin', 'local-plugin', {
              displayName: 'Local plugin',
              composerIcon: '/plugins/local/icon.svg',
            }),
            pluginSummary('oversized-plugin', 'oversized-plugin', {
              displayName: 'Oversized plugin',
              composerIcon: '/plugins/local/readme.txt',
              logo: '/plugins/local/oversized.png',
            }),
          ],
        }],
        marketplaceLoadErrors: [],
      }),
      'fs/readFile': (params) => {
        const path = (params as { path: string }).path;
        readPaths.push(path);
        return {
          dataBase64: path.endsWith('icon.svg') ? 'PHN2Zy8+' : 'A'.repeat(350_000),
        };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });

    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));

    expect(readPaths).toStrictEqual(['/plugins/local/icon.svg', '/plugins/local/oversized.png']);
    expect(surface.getSnapshot().plugins).toStrictEqual([
      {
        id: 'local-plugin',
        name: 'local-plugin',
        displayName: 'Local plugin',
        iconUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
        iconUrlDark: 'data:image/svg+xml;base64,PHN2Zy8+',
        enabled: true,
      },
      {
        id: 'oversized-plugin',
        name: 'oversized-plugin',
        displayName: 'Oversized plugin',
        enabled: true,
      },
    ]);
    expect(JSON.stringify(surface.getSnapshot().plugins)).not.toContain('file://');
  });

  it('materializes bounded local skill icons without exposing filesystem paths', async () => {
    const readPaths: string[] = [];
    const transport = new FakeTransport({
      'skills/list': () => ({
        data: [{
          cwd: '/tmp/project',
          skills: [
            {
              name: 'branded-skill',
              description: 'A skill with catalog artwork',
              path: '/skills/branded/SKILL.md',
              scope: 'user',
              enabled: true,
              interface: {
                displayName: 'Branded Skill',
                iconSmall: '/skills/branded/icon-small.svg',
                iconLarge: '/skills/branded/icon-large.png',
              },
            },
            {
              name: 'invalid-icons',
              description: 'A skill whose artwork cannot be exposed safely',
              path: '/skills/invalid/SKILL.md',
              scope: 'user',
              enabled: true,
              interface: {
                iconSmall: '/skills/invalid/readme.txt',
                iconLarge: '/skills/invalid/oversized.png',
              },
            },
          ],
          errors: [],
        }],
      }),
      'fs/readFile': (params) => {
        const path = (params as { path: string }).path;
        readPaths.push(path);
        if (path.endsWith('icon-small.svg')) return { dataBase64: 'PHN2Zy8+' };
        if (path.endsWith('icon-large.png')) return { dataBase64: 'cG5n' };
        return { dataBase64: 'A'.repeat(350_000) };
      },
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      autoSelectFirstConversation: false,
    });

    const snapshot = await surface.connect();

    expect(readPaths).toStrictEqual([
      '/skills/branded/icon-small.svg',
      '/skills/branded/icon-large.png',
      '/skills/invalid/oversized.png',
    ]);
    expect(snapshot.skills).toMatchObject([
      {
        name: 'branded-skill',
        description: 'A skill with catalog artwork',
        displayName: 'Branded Skill',
        iconSmall: 'data:image/svg+xml;base64,PHN2Zy8+',
        iconLarge: 'data:image/png;base64,cG5n',
        path: '/skills/branded/SKILL.md',
        scope: 'user',
        enabled: true,
      },
      {
        name: 'invalid-icons',
        description: 'A skill whose artwork cannot be exposed safely',
        path: '/skills/invalid/SKILL.md',
        scope: 'user',
        enabled: true,
      },
    ]);
    expect(snapshot.skills[1]?.iconSmall).toBeUndefined();
    expect(snapshot.skills[1]?.iconLarge).toBeUndefined();
    expect(JSON.stringify(snapshot.skills)).not.toContain('/skills/branded/icon-');
    expect(JSON.stringify(snapshot.skills)).not.toContain('/skills/invalid/readme.txt');
    expect(JSON.stringify(snapshot.skills)).not.toContain('/skills/invalid/oversized.png');
  });

  it('rereads same-path skill icons when the skill catalog is force reloaded', async () => {
    let iconReads = 0;
    const transport = new FakeTransport({
      'skills/list': () => ({
        data: [{
          cwd: '/tmp/project',
          skills: [{
            name: 'changing-skill',
            description: 'A skill whose icon can change in place',
            path: '/skills/changing/SKILL.md',
            scope: 'user',
            enabled: true,
            interface: { iconSmall: '/skills/changing/icon.png' },
          }],
          errors: [],
        }],
      }),
      'fs/readFile': () => {
        iconReads += 1;
        return { dataBase64: iconReads === 1 ? 'QQ==' : 'Qg==' };
      },
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      autoSelectFirstConversation: false,
    });

    const initial = await surface.connect();
    expect(initial.skills[0]?.iconSmall).toBe('data:image/png;base64,QQ==');

    const reloaded = await surface.listSkills({ forceReload: true });
    expect(reloaded[0]?.iconSmall).toBe('data:image/png;base64,Qg==');
    expect(iconReads).toBe(2);
  });

  it('refreshes the plugin catalog when the conversation cwd union grows', async () => {
    let includeSecondCwd = false;
    const pluginScopes: unknown[] = [];
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [
          thread('thread-existing', false),
          ...(includeSecondCwd ? [{ ...thread('thread-new-cwd', false), cwd: '/workspace/new' }] : []),
        ],
        nextCursor: null,
      }),
      'plugin/installed': (params) => {
        pluginScopes.push(params);
        return { marketplaces: [], marketplaceLoadErrors: [] };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await vi.waitFor(() => expect(pluginScopes).toHaveLength(1));

    includeSecondCwd = true;
    await surface.refreshConversations();
    await vi.waitFor(() => expect(pluginScopes).toHaveLength(2));

    expect(pluginScopes).toStrictEqual([
      { cwds: ['/tmp/project'] },
      { cwds: ['/tmp/project', '/workspace/new'] },
    ]);
  });

  it('refreshes the plugin catalog after creating a conversation in a new cwd', async () => {
    const pluginScopes: unknown[] = [];
    const transport = new FakeTransport({
      'plugin/installed': (params) => {
        pluginScopes.push(params);
        return { marketplaces: [], marketplaceLoadErrors: [] };
      },
      'thread/start': () => {
        const created = { ...thread('thread-new', false), cwd: '/workspace/new' };
        return { ...resumeResponse(created), cwd: '/workspace/new' };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await vi.waitFor(() => expect(pluginScopes).toHaveLength(1));

    await surface.createConversation({ cwd: '/workspace/new' });
    await vi.waitFor(() => expect(pluginScopes).toHaveLength(2));

    expect(pluginScopes).toStrictEqual([
      { cwds: ['/tmp/project'] },
      { cwds: ['/tmp/project', '/workspace/new'] },
    ]);
  });

  it('deduplicates concurrent bootstrap and honors client and list configuration', async () => {
    const transport = new FakeTransport();
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      clientInfo: { name: 'custom_surface', version: '2.0.0' },
      conversationLimit: 12,
      cwd: '/tmp/project',
    });
    const first = surface.connect();
    const second = surface.connect();
    expect(second).toBe(first);
    await first;
    expect(transport.sent.find((message) => 'method' in message && message.method === 'initialize')).toMatchObject({
      params: { clientInfo: { name: 'custom_surface', title: null, version: '2.0.0' } },
    });
    expect(transport.sent.find((message) => 'method' in message && message.method === 'thread/list')).toMatchObject({
      params: { limit: 12 },
    });
    expect(transport.sent.find((message) => 'method' in message && message.method === 'thread/list')).not.toMatchObject({
      params: { cwd: expect.anything() },
    });
  });

  it('owns archive, unarchive, and permanent deletion lifecycle actions', async () => {
    const transport = new FakeTransport({
      'thread/unarchive': (params) => ({
        thread: thread((params as { threadId: string }).threadId, false),
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const removedEvents: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => {
      if (event.type === 'conversation.summaryRemoved') removedEvents.push(event);
    });
    await surface.connect();

    await surface.archiveConversation(' thread-existing ');
    expect(lastRequest(transport, 'thread/archive')).toMatchObject({
      params: { threadId: 'thread-existing' },
    });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: null, conversations: [] });
    expect(removedEvents).toStrictEqual([expect.objectContaining({
      origin: 'action',
      conversationId: 'thread-existing',
      payload: { reason: 'archived' },
    })]);

    transport.emit({ method: 'thread/archived', params: { threadId: 'thread-existing' } });
    expect(removedEvents).toHaveLength(1);

    await surface.unarchiveConversation('thread-existing');
    expect(lastRequest(transport, 'thread/unarchive')).toMatchObject({
      params: { threadId: 'thread-existing' },
    });
    expect(surface.getSnapshot().conversations).toEqual([
      expect.objectContaining({ id: 'thread-existing' }),
    ]);

    await surface.deleteConversation('thread-existing');
    expect(lastRequest(transport, 'thread/delete')).toMatchObject({
      params: { threadId: 'thread-existing' },
    });
    expect(surface.getSnapshot().conversations).toStrictEqual([]);
    expect(removedEvents).toStrictEqual([
      expect.objectContaining({ payload: { reason: 'archived' } }),
      expect.objectContaining({
        origin: 'action',
        conversationId: 'thread-existing',
        payload: { reason: 'deleted' },
      }),
    ]);

    transport.emit({ method: 'thread/deleted', params: { threadId: 'thread-existing' } });
    expect(removedEvents).toHaveLength(2);
    await expect(surface.deleteConversation('   ')).rejects.toThrow('Conversation id cannot be empty');
  });

  it('loads history, sends a message, and reduces streaming events into surface state', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const selected = await surface.selectConversation('thread-existing');
    expect(selected.messages.map((message) => message.parts[0])).toMatchObject([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'Hi there' },
    ]);

    await surface.sendMessage('  Build the UI  ');
    expect(surface.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'assistant-turn-live',
      role: 'assistant',
      status: 'streaming',
      parts: [],
    });
    const turnRequest = lastRequest(transport, 'turn/start');
    expect(turnRequest).toMatchObject({
      method: 'turn/start',
      params: { threadId: 'thread-existing', input: [{ type: 'text', text: 'Build the UI' }] },
    });
    await surface.steerMessage('Focus on the renderer');
    expect(lastRequest(transport, 'turn/steer')).toMatchObject({
      params: {
        threadId: 'thread-existing', expectedTurnId: 'turn-live',
        input: [{ type: 'text', text: 'Focus on the renderer' }],
      },
    });

    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: 'Working' },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: '… done' },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });

    const snapshot = surface.getSnapshot();
    expect(snapshot).toMatchObject({ busy: false, error: null });
    expect(snapshot.messages.find((message) => (
      message.role === 'assistant'
      && message.parts.some((part) => part.type === 'text' && part.itemId === 'agent-live')
    ))).toMatchObject({
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'Working… done', itemId: 'agent-live' }],
    });
  });

  it('renders a bounded summary page before hydrating full history in the background', async () => {
    const firstTurn = turn('turn-first', 'completed', [
      { type: 'userMessage', id: 'user-first', clientId: null, content: [{ type: 'text', text: 'First', text_elements: [] }] },
      {
        type: 'commandExecution', id: 'command-first', command: 'npm test', cwd: '/tmp/project', processId: null,
        source: 'unifiedExec', status: 'completed', commandActions: [], aggregatedOutput: 'passed', exitCode: 0,
        durationMs: 20,
      },
      { type: 'agentMessage', id: 'agent-first', text: 'First reply', phase: null, memoryCitation: null },
    ]);
    const secondTurn = turn('turn-second', 'completed', [
      { type: 'userMessage', id: 'user-second', clientId: null, content: [{ type: 'text', text: 'Second', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-second', text: 'Second reply', phase: null, memoryCitation: null },
    ]);
    const firstFullPage = deferred<unknown>();
    const transport = new FakeTransport({
      'thread/resume': (params) => ({
        ...resumeResponse(thread(String((params as { threadId: string }).threadId), false)),
        initialTurnsPage: { data: [secondTurn], nextCursor: 'summary-page-2', backwardsCursor: null },
      }),
      'thread/turns/list': (params) => {
        const cursor = (params as { cursor: string | null }).cursor;
        expect(params).toMatchObject({
          threadId: 'thread-existing', limit: 5, sortDirection: 'desc', itemsView: 'full',
        });
        return cursor === null
          ? firstFullPage.promise
          : { data: [firstTurn], nextCursor: null, backwardsCursor: null };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });

    const snapshot = await surface.connect();

    expect(snapshot.messages.map((message) => message.parts[0])).toMatchObject([
      { type: 'text', text: 'Second' },
      { type: 'text', text: 'Second reply' },
    ]);
    firstFullPage.resolve({ data: [secondTurn], nextCursor: 'full-page-2', backwardsCursor: null });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.map((message) => message.parts[0])).toMatchObject([
      { type: 'text', text: 'First' },
      { type: 'tool', id: 'command-first', kind: 'command' },
      { type: 'text', text: 'Second' },
      { type: 'text', text: 'Second reply' },
    ]));
    expect(surface.getSnapshot().conversations[0]).toMatchObject({ id: 'thread-existing', turnCount: 2 });
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/turns/list'
    ))).toHaveLength(2);
  });

  it('does not resurrect a completed turn from a stale background history page', async () => {
    const staleFullPage = deferred<unknown>();
    const historyHydrated = deferred<void>();
    const runningTurn = turn('turn-running', 'inProgress', []);
    const transport = new FakeTransport({
      'thread/resume': () => {
        const running = thread('thread-existing', false);
        running.status = { type: 'active', activeFlags: [] };
        running.turns = [runningTurn];
        return resumeResponse(running);
      },
      'thread/turns/list': () => staleFullPage.promise,
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    surface.onEvent((event) => {
      if (event.type === 'conversation.historyReplaced' && event.payload.reason === 'resync') {
        historyHydrated.resolve();
      }
    });
    await surface.connect();
    expect(surface.getSnapshot().busy).toBe(true);

    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-running', 'completed', []) },
    });
    expect(surface.getSnapshot().busy).toBe(false);
    staleFullPage.resolve({ data: [runningTurn], nextCursor: null, backwardsCursor: null });
    await historyHydrated.promise;

    expect(surface.getSnapshot().busy).toBe(false);
    expect(surface.conversation('thread-existing').getSnapshot().activeTurnId).toBeNull();
    expect(surface.getSnapshot().messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-running', status: 'streaming' }),
    ]));
  });

  it('emits ordered semantic events after matching state mutations for conversation handles', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const events: CodexSurfaceEvent[] = [];
    const handleEvents: CodexSurfaceEvent[] = [];
    const unsubscribeSurface = surface.onEvent((event) => {
      events.push(event);
      if (event.type === 'message.delta') {
        const message = surface.conversation(event.conversationId).getSnapshot().messages
          .find((candidate) => candidate.id === event.payload.messageId);
        expect(message?.parts).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: 'text', itemId: event.payload.itemId }),
        ]));
      }
      if (event.type === 'tool.updated') {
        const part = surface.conversation(event.conversationId).getSnapshot().messages
          .flatMap((message) => message.parts)
          .find((candidate) => candidate.type === 'tool' && candidate.id === event.payload.update.itemId);
        expect(part).toMatchObject({ body: expect.stringContaining(event.payload.update.bodyAppend ?? '') });
      }
    });
    const conversation = surface.conversation('thread-existing');
    const unsubscribeConversation = conversation.onEvent((event) => handleEvents.push(event));

    await conversation.sendMessage('Inspect these', {
      attachments: [
        {
          type: 'image', path: '/tmp/screenshot.png', name: 'shot.png', mimeType: 'image/png',
          previewUrl: 'data:image/png;base64,cG5n',
        },
        { type: 'file', path: '/tmp/notes.md', name: 'Notes', mimeType: 'text/markdown' },
      ],
    });
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: 'Working' },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'plan-live', delta: '# Draft' },
    });
    transport.emit({
      method: 'turn/plan/updated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', explanation: 'Implementation',
        plan: [{ step: 'Wire events', status: 'inProgress' }],
      },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', startedAtMs: 1,
        item: {
          type: 'mcpToolCall', id: 'mcp-live', server: 'tools', tool: 'run', status: 'inProgress',
          arguments: {}, appContext: null, pluginId: null, result: null, error: null, durationMs: null,
        },
      },
    });
    transport.emit({
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'mcp-live', message: 'halfway' },
    });
    transport.emit({
      id: 'ask-event',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', itemId: 'ask-live', autoResolutionMs: null,
        questions: [{
          id: 'target', header: 'Target', question: 'Which target?', isOther: false, isSecret: false,
          options: null,
        }],
      },
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'clientRequest.requested')).toBe(true));
    await conversation.respondToClientRequest({
      id: 'ask-event', payload: { answers: { target: { answers: ['SDK'] } } },
    });
    transport.emit({
      id: 'approval-event',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', itemId: 'command-live', command: 'npm test',
        cwd: '/tmp/project', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null,
        availableDecisions: ['accept', 'decline'], proposedExecpolicyAmendment: null,
      },
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'approval.requested')).toBe(true));
    await conversation.resolveApproval('approval-event', 'approve', 'once');
    transport.emit({ method: 'skills/changed', params: {} });
    await vi.waitFor(() => expect(handleEvents.some((event) => event.type === 'conversation.skillsChanged')).toBe(true));

    const appended = events.find((event) => (
      event.type === 'message.appended' && event.origin === 'action'
    ));
    expect(appended?.type === 'message.appended' ? appended.payload.message.parts : []).toStrictEqual([
      { type: 'text', text: 'Inspect these' },
      {
        type: 'attachment',
        attachment: {
          kind: 'image', name: 'shot.png', path: '/tmp/screenshot.png',
          url: 'data:image/png;base64,cG5n', mimeType: 'image/png',
        },
      },
      {
        type: 'attachment',
        attachment: { kind: 'file', name: 'Notes', path: '/tmp/notes.md', mimeType: 'text/markdown' },
      },
    ]);
    expect(events.filter((event) => event.type === 'turn.started' && event.turnId === 'turn-live')).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message.delta', payload: expect.objectContaining({ delta: 'Working' }) }),
      expect.objectContaining({ type: 'plan.delta', payload: expect.objectContaining({ markdown: '# Draft' }) }),
      expect.objectContaining({
        type: 'plan.updated',
        payload: expect.objectContaining({
          explanation: 'Implementation', status: 'completed',
          steps: [{ step: 'Wire events', status: 'inProgress' }],
        }),
      }),
      expect.objectContaining({ type: 'tool.started', payload: expect.objectContaining({ messageId: 'assistant-turn-live' }) }),
      expect.objectContaining({ type: 'tool.updated', payload: expect.objectContaining({ update: expect.objectContaining({ bodyAppend: 'halfway' }) }) }),
      expect.objectContaining({ type: 'clientRequest.resolved', payload: expect.objectContaining({ reason: 'host' }) }),
      expect.objectContaining({ type: 'approval.resolved', payload: expect.objectContaining({ decision: 'approve' }) }),
    ]));
    expect(events.map((event) => event.seq)).toStrictEqual(
      [...events.map((event) => event.seq)].sort((left, right) => left - right),
    );
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
    expect(handleEvents.every((event) => 'conversationId' in event && event.conversationId === 'thread-existing')).toBe(true);

    const handleEventCount = handleEvents.length;
    unsubscribeConversation();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: ' done' },
    });
    expect(handleEvents).toHaveLength(handleEventCount);
    const surfaceEventCount = events.length;
    unsubscribeSurface();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: '!' },
    });
    expect(events).toHaveLength(surfaceEventCount);
  });

  it('keeps reasoning internal and exposes an empty streaming assistant message for thinking UI', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.sendMessage('Think carefully');

    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', startedAtMs: 1,
        item: { type: 'reasoning', id: 'reasoning-live', summary: [], content: [] },
      },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', completedAtMs: 2,
        item: { type: 'reasoning', id: 'reasoning-live', summary: ['Internal'], content: ['Hidden'] },
      },
    });

    const assistant = surface.getSnapshot().messages.at(-1);
    expect(assistant).toMatchObject({
      id: 'assistant-turn-live',
      role: 'assistant',
      status: 'streaming',
      parts: [],
    });
    expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.kind === 'reasoning')
    ))).toBe(false);
  });

  it('preserves agent message phase before and during streaming', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing',
        turnId: 'turn-live',
        startedAtMs: 1,
        item: {
          type: 'agentMessage',
          id: 'agent-final',
          text: '',
          phase: 'final_answer',
          memoryCitation: null,
        },
      },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-existing',
        turnId: 'turn-live',
        itemId: 'agent-final',
        delta: 'Final response',
      },
    });

    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Final response',
          itemId: 'agent-final',
          phase: 'final_answer',
        }),
      ]),
    );
  });

  it('creates conversations with app-server-backed permission defaults and interrupts active turns', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.createConversation();
    const startRequest = transport.sent.find((message) => 'method' in message && message.method === 'thread/start');
    expect(startRequest).toMatchObject({
      method: 'thread/start',
      params: {
        approvalPolicy: 'on-request', approvalsReviewer: 'user', cwd: '/tmp/project', permissions: ':workspace',
      },
    });

    await surface.sendMessage('Inspect this project');
    await surface.interrupt();
    expect(lastRequest(transport, 'turn/interrupt')).toMatchObject({
      params: { threadId: 'thread-new', turnId: 'turn-live' },
    });
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'another-thread', turn: turn('ignored-turn', 'inProgress', []) },
    });
  });

  it('maps product options, creates on first send, and queues concurrent prompts', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.createConversation({
      approvalMode: 'ask', cwd: '/tmp/other', model: 'gpt-mini-runtime', permissionMode: 'full-access',
    });
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        approvalPolicy: 'on-request', cwd: '/tmp/other', model: 'gpt-mini-runtime', sandbox: 'danger-full-access',
      },
    });
    await surface.sendMessage('First', { model: 'gpt-mini-runtime' });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({ params: { model: 'gpt-mini-runtime' } });
    await expect(surface.sendMessage('Second')).resolves.toMatchObject({
      queuedPrompts: [{ text: 'Second' }],
    });

    const fresh = createSurface();
    await fresh.surface.sendMessage('Continue automatically');
    expect(lastRequest(fresh.transport, 'thread/start')).toBeUndefined();
    expect(lastRequest(fresh.transport, 'turn/start')).toMatchObject({ params: { threadId: 'thread-existing' } });
  });

  it('applies host conversation defaults to explicit and automatic thread creation', async () => {
    const responses = {
      'model/list': () => ({
        data: [testModel('gpt-5.6-terra', 'gpt-5.6-terra', true)],
        nextCursor: null,
      }),
      'thread/list': () => ({ data: [], nextCursor: null }),
    };
    const createTransport = new FakeTransport(responses);
    const createSurface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(createTransport),
      conversationDefaults: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    });
    await createSurface.connect();
    await createSurface.createConversation();
    expect(lastRequest(createTransport, 'thread/start')).toMatchObject({
      params: { model: 'gpt-5.6-terra' },
    });
    expect(lastRequest(createTransport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new',
        effort: 'medium',
        collaborationMode: {
          mode: 'default',
          settings: { model: 'gpt-5.6-terra', reasoning_effort: 'medium' },
        },
      },
    });

    const automaticTransport = new FakeTransport(responses);
    const automaticSurface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(automaticTransport),
      conversationDefaults: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    });
    await automaticSurface.connect();
    await automaticSurface.sendMessage('Hello Terra');
    expect(lastRequest(automaticTransport, 'thread/start')).toMatchObject({
      params: { model: 'gpt-5.6-terra' },
    });
    expect(lastRequest(automaticTransport, 'turn/start')).toMatchObject({
      params: {
        threadId: 'thread-new', model: 'gpt-5.6-terra', effort: 'medium',
      },
    });
  });

  it('updates model, reasoning, plan mode, and permissions through app-server settings', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    const snapshot = await surface.updateConversationSettings({
      modelId: 'gpt-mini',
      reasoningEffort: 'high',
      approvalPreset: 'full-access',
      planMode: true,
    });

    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        model: 'gpt-mini-runtime',
        effort: 'high',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        permissions: ':danger-full-access',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high' },
        },
      },
    });
    expect(snapshot).toMatchObject({
      selectedModelId: 'gpt-mini',
      selectedReasoningEffort: 'high',
      approvalPreset: 'full-access',
      planMode: true,
    });
  });

  it('keeps catalogs and settings useful when there is no persisted conversation', async () => {
    const transport = new FakeTransport({
      'model/list': () => ({ data: [], nextCursor: null }),
      'permissionProfile/list': () => ({ data: [], nextCursor: null }),
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });

    await expect(surface.connect()).resolves.toMatchObject({
      activeConversationId: null,
      models: [],
      selectedModelId: null,
      selectedReasoningEffort: null,
      approvalPresets: [],
      approvalPreset: null,
    });
    await surface.updateConversationSettings({ planMode: true });
    expect(lastRequest(transport, 'thread/settings/update')).toBeUndefined();

    await surface.sendMessage('Start the first thread');
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: { approvalPolicy: 'never', sandbox: 'read-only' },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: { threadId: 'thread-new' },
    });
  });

  it('degrades catalogs safely when app-server catalog requests fail', async () => {
    const transport = new FakeTransport({
      'model/list': () => { throw new Error('models unavailable'); },
      'permissionProfile/list': () => { throw new Error('profiles unavailable'); },
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });

    await expect(surface.connect()).resolves.toMatchObject({
      status: 'ready',
      modelCatalogStatus: 'error',
      models: [],
      permissionProfiles: [],
      approvalPresets: [],
      approvalPreset: null,
    });
    expect(lastRequest(transport, 'configRequirements/read')).toBeUndefined();
  });

  it('paginates catalogs and applies app-server permission requirements', async () => {
    const transport = new FakeTransport({
      'model/list': (params) => (params as { cursor?: string | null }).cursor
        ? { data: [testModel('model-default', 'runtime-default', true)], nextCursor: null }
        : { data: [testModel('model-first', 'runtime-first', false)], nextCursor: 'models-2' },
      'permissionProfile/list': (params) => (params as { cursor?: string | null }).cursor
        ? {
            data: [
              { id: ':danger-full-access', description: null, allowed: true },
              { id: ':disabled', description: null, allowed: false },
            ],
            nextCursor: null,
          }
        : {
            data: [{ id: ':workspace', description: 'Project files', allowed: true }],
            nextCursor: 'profiles-2',
          },
      'configRequirements/read': () => ({
        requirements: {
          allowedApprovalPolicies: ['on-request'],
          allowedApprovalsReviewers: ['user'],
        },
      }),
      'thread/list': (params) => (params as { cursor?: string | null }).cursor
        ? { data: [thread('thread-second-page', false)], nextCursor: null }
        : { data: [thread('thread-first-page', false)], nextCursor: 'threads-2' },
    });
    const surface = new CodexSurface({
      approvalPreset: 'full-access',
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    });

    await expect(surface.connect()).resolves.toMatchObject({
      models: [{ id: 'model-first' }, { id: 'model-default' }],
      selectedModelId: 'model-default',
      approvalPresets: ['ask-for-approval'],
      approvalPreset: 'ask-for-approval',
    });
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'model/list')).toHaveLength(2);
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'permissionProfile/list')).toHaveLength(2);
    const threadListRequests = transport.sent.filter(
      (message) => 'method' in message && message.method === 'thread/list',
    );
    expect(threadListRequests).toHaveLength(2);
    expect(threadListRequests).not.toContainEqual(expect.objectContaining({ params: { cwd: expect.anything() } }));
    expect(surface.getSnapshot().conversations.map((conversation) => conversation.id)).toStrictEqual([
      'thread-first-page',
      'thread-second-page',
    ]);
    await expect(surface.createConversation({ approvalPreset: 'full-access' }))
      .rejects.toThrow("Approval preset 'full-access' is not available");
    expect(lastRequest(transport, 'thread/start')).toBeUndefined();
  });

  it('rejects invalid settings and falls back to a supported effort when the model changes', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    await expect(surface.updateConversationSettings({ modelId: 'missing' })).rejects.toThrow("Unknown model 'missing'");
    await expect(surface.updateConversationSettings({ reasoningEffort: 'ultra' })).rejects.toThrow(
      "Reasoning effort 'ultra' is not available",
    );
    await expect(surface.updateConversationSettings({
      approvalPreset: 'blocked' as never,
    })).rejects.toThrow("Approval preset 'blocked' is not available");

    await surface.updateConversationSettings({ modelId: 'gpt-mini', reasoningEffort: 'high' });
    const snapshot = await surface.updateConversationSettings({ modelId: 'gpt-5' });
    expect(snapshot.selectedReasoningEffort).toBe('medium');
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { model: 'gpt-5', effort: 'medium' },
    });
  });

  it('supports focused settings updates and authoritative settings notifications', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    await surface.updateConversationSettings({ approvalPreset: 'approve-for-me' });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', permissions: ':workspace' },
    });
    await surface.updateConversationSettings({ planMode: false });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { collaborationMode: { mode: 'default' } },
    });

    transport.emit({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-existing',
        threadSettings: threadSettings({
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          activePermissionProfile: { id: ':danger-no-sandbox', extends: null },
          collaborationMode: {
            mode: 'plan',
            settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high', developer_instructions: null },
          },
          model: 'gpt-mini-runtime',
          effort: 'high',
        }),
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      approvalPreset: 'full-access',
      planMode: true,
      selectedModelId: 'gpt-mini',
      selectedReasoningEffort: 'high',
    });

    transport.emit({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-existing',
        threadSettings: threadSettings({
          approvalPolicy: 'on-request',
          approvalsReviewer: 'guardian_subagent',
        }),
      },
    });
    expect(surface.getSnapshot().approvalPreset).toBe('approve-for-me');
  });

  it('honors explicit main-process policy defaults', async () => {
    const cases = [
      { options: { approvalPreset: 'full-access' as const }, expected: 'full-access' },
      { options: { approvalMode: 'never' as const, permissionMode: 'full-access' as const }, expected: 'full-access' },
      { options: { approvalMode: 'ask' as const, permissionMode: 'workspace-write' as const }, expected: 'ask-for-approval' },
      { options: { approvalMode: 'never' as const, permissionMode: 'read-only' as const }, expected: null },
    ];

    for (const entry of cases) {
      const transport = new FakeTransport({ 'thread/list': () => ({ data: [], nextCursor: null }) });
      const surface = new CodexSurface({
        ...entry.options,
        client: new CodexAppServerClient(transport),
        cwd: '/tmp/project',
      });
      expect((await surface.connect()).approvalPreset).toBe(entry.expected);
    }
  });

  it('reports invalid and failed steering without losing the active conversation', async () => {
    const transport = new FakeTransport({
      'turn/steer': () => { throw new Error('steer rejected'); },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    await expect(surface.steerMessage('')).rejects.toThrow('empty message');
    await expect(surface.steerMessage('No active turn')).rejects.toThrow('no active turn');
    await surface.sendMessage('Begin');
    await expect(surface.steerMessage('Redirect')).rejects.toThrow('steer rejected');
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-existing',
      busy: true,
      error: 'steer rejected',
    });
  });

  it('uses the authoritative turn returned after steering', async () => {
    const transport = new FakeTransport({
      'turn/steer': () => ({ turnId: 'turn-after-steer' }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await surface.sendMessage('Begin');
    await surface.steerMessage('Redirect');

    expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'steer', metadata: expect.objectContaining({ turnId: 'turn-after-steer' }) }),
      expect.objectContaining({ role: 'assistant', metadata: expect.objectContaining({ turnId: 'turn-after-steer' }) }),
    ]));
    await surface.interrupt();
    expect(lastRequest(transport, 'turn/interrupt')).toMatchObject({
      params: { threadId: 'thread-existing', turnId: 'turn-after-steer' },
    });
  });

  it('handles completed start responses and running history', async () => {
    const transport = new FakeTransport({
      'thread/resume': (params) => {
        const value = thread(String((params as { threadId: string }).threadId), false);
        value.turns = [turn('turn-running', 'inProgress', [])];
        return resumeResponse(value);
      },
      'turn/start': () => ({ turn: turn('turn-already-done', 'completed', []) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    expect((await surface.selectConversation('thread-existing')).busy).toBe(true);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-running', 'completed', []) },
    });
    await surface.sendMessage('Quick answer');
    expect(surface.getSnapshot().busy).toBe(false);
    await expect(surface.interrupt()).resolves.toMatchObject({ busy: false });
  });

  it('tracks names, completed tool items, errors, and lifecycle cleanup', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.selectConversation('thread-existing');
    transport.emit({ method: 'thread/name/updated', params: { threadId: 'thread-existing', threadName: 'Renamed' } });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-tool', completedAtMs: 1_700_000_002_000,
        item: {
          type: 'commandExecution', id: 'command', command: 'npm test', cwd: '/tmp/project', processId: null,
          source: 'unifiedExec', status: 'failed', commandActions: [], aggregatedOutput: 'failed', exitCode: 1,
          durationMs: 20,
        },
      },
    });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'thread-existing', turnId: 'turn-tool', willRetry: false,
        error: { message: 'No network', codexErrorInfo: null, additionalDetails: null },
      },
    });

    const snapshot = surface.getSnapshot();
    expect(snapshot.conversations[0]).toMatchObject({ title: 'Renamed' });
    expect(snapshot.error).toBe('No network');
    expect(snapshot.messages.find((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'command')
    ))).toMatchObject({
      id: 'assistant-turn-tool',
      parts: [{ type: 'tool', status: 'failed' }],
    });
    await surface.close();
    await surface.close();
    expect(transport.close).toHaveBeenCalledOnce();
    await expect(surface.connect()).rejects.toThrow('Codex surface is closed');
  });

  it('projects live generated images once while preserving technical tool events', async () => {
    const { surface, transport } = createSurface();
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();

    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-image', startedAtMs: 1,
        item: {
          type: 'imageGeneration', id: 'image-live', status: 'inProgress',
          revisedPrompt: null, result: '',
        },
      },
    });
    expect(surface.getSnapshot().messages.find((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'image-live')
    ))?.parts).toStrictEqual([
      expect.objectContaining({ type: 'tool', id: 'image-live', status: 'running' }),
    ]);

    transport.emit({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-image',
        item: {
          type: 'image_generation_call', id: 'image-live', status: 'completed',
          revised_prompt: 'Draw the route map', result: generatedPngBase64,
        },
      },
    });
    expect(JSON.stringify(surface.getSnapshot())).not.toContain(generatedPngBase64);

    const completedItem = {
      type: 'imageGeneration', id: 'image-live', status: 'completed',
      revisedPrompt: 'Draw the route map', result: generatedPngBase64,
      savedPath: '/tmp/generated route.png',
    };
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-image', completedAtMs: 2,
        item: completedItem,
      },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-image', completedAtMs: 2,
        item: completedItem,
      },
    });

    const message = surface.getSnapshot().messages.find((candidate) => (
      candidate.parts.some((part) => part.type === 'tool' && part.id === 'image-live')
    ));
    expect(message?.parts).toStrictEqual([
      expect.objectContaining({
        type: 'tool', id: 'image-live', status: 'completed', output: '/tmp/generated route.png',
      }),
      {
        type: 'media',
        itemId: 'image-live',
        media: {
          url: `data:image/png;base64,${generatedPngBase64}`,
          alt: 'Generated image',
          mimeType: 'image/png',
          prompt: 'Draw the route map',
          title: 'Generated image',
        },
      },
    ]);
    expect(message?.parts.filter((part) => part.type === 'media')).toHaveLength(1);
    expect(JSON.stringify(message?.parts.find((part) => part.type === 'tool'))).not.toContain(generatedPngBase64);
    expect(JSON.stringify(surface.getSnapshot()).split(generatedPngBase64)).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({ toolPart: expect.objectContaining({ id: 'image-live' }) }),
      }),
      expect.objectContaining({
        type: 'message.updated',
        payload: expect.objectContaining({
          message: expect.objectContaining({
            parts: expect.arrayContaining([expect.objectContaining({ type: 'media', itemId: 'image-live' })]),
          }),
        }),
      }),
    ]));
    expect(events.filter((event) => event.type === 'message.updated')).toHaveLength(1);
  });

  it('reduces started, replaced, ignored, and failed lifecycle variants', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.selectConversation('thread-existing');
    const startedThread = thread('thread-started', false);
    startedThread.name = 'Named thread';
    startedThread.status = { type: 'active', activeFlags: [] };
    startedThread.recencyAt = 1_700_000_010;
    transport.emit({ method: 'thread/started', params: { thread: startedThread } });
    transport.emit({ method: 'thread/name/updated', params: { threadId: 'missing', threadName: '' } });
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-variant', 'inProgress', []) },
    });
    const command = {
      type: 'commandExecution', id: 'command-variant', command: 'pwd', cwd: '/tmp/project', processId: null,
      source: 'unifiedExec', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
    };
    transport.emit({
      method: 'item/started',
      params: { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 1, item: command },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-variant', completedAtMs: 2,
        item: { ...command, status: 'completed' },
      },
    });
    const user = {
      type: 'userMessage', id: 'user-variant', clientId: null,
      content: [{ type: 'text', text: 'Steer', text_elements: [] }],
    };
    transport.emit({
      method: 'item/started',
      params: { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 3, item: user },
    });
    transport.emit({
      method: 'item/started',
      params: { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 3, item: user },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 4,
        item: { type: 'contextCompaction', id: 'compact' },
      },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'other', turnId: 'turn', itemId: 'ignored', delta: 'ignored' },
    });
    transport.emit({
      method: 'item/started',
      params: { threadId: 'other', turnId: 'turn', startedAtMs: 1, item: command },
    });
    transport.emit({ method: 'turn/completed', params: { threadId: 'other', turn: turn('turn', 'completed', []) } });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'other', turnId: 'turn', willRetry: false,
        error: { message: 'Ignored', codexErrorInfo: null, additionalDetails: null },
      },
    });
    transport.emit({
      method: 'turn/completed',
      params: {
        threadId: 'thread-existing',
        turn: { ...turn('turn-variant', 'failed', []), error: { message: 'Failed turn', codexErrorInfo: null, additionalDetails: null } },
      },
    });

    const snapshot = surface.getSnapshot();
    expect(snapshot.conversations.find((conversation) => conversation.id === 'thread-started')).toMatchObject({
      title: 'Named thread', status: 'active', updatedAt: new Date(1_700_000_010_000).toISOString(),
    });
    expect(snapshot.messages.filter((message) => (
      message.parts.some((part) => part.type === 'text' && part.text === 'Steer')
    ))).toHaveLength(1);
    expect(snapshot.messages.find((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'command-variant')
    ))).toMatchObject({
      parts: [{ status: 'completed' }], status: 'error',
    });
    expect(snapshot).toMatchObject({ busy: false, error: 'Failed turn' });
  });

  it('renders app-server plans and raw response tools instead of dropping them', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-plan', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-plan', itemId: 'plan-item', delta: '# Plan\n' },
    });
    transport.emit({
      method: 'turn/plan/updated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan', explanation: 'Implementation',
        plan: [{ step: 'Copy the component', status: 'completed' }, { step: 'Wire events', status: 'inProgress' }],
      },
    });
    transport.emit({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan',
        item: {
          type: 'local_shell_call', call_id: 'raw-shell', status: 'completed',
          action: { type: 'exec', command: ['npm', 'test'], working_directory: '/tmp/project' },
        },
      },
    });

    const tools = surface.getSnapshot().messages.flatMap((message) => (
      message.parts.filter((part) => part.type === 'tool')
    ));
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-progress-turn-plan', title: 'plan', status: 'completed' }),
      expect.objectContaining({ id: 'raw-shell', kind: 'command', title: 'npm test', status: 'completed' }),
    ]));
  });

  it('surfaces app-server user questions and MCP confirmations and sends their answers back', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      id: 'ask-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-existing', turnId: 'turn-input', itemId: 'ask-user-item', autoResolutionMs: null,
        questions: [{
          id: 'target', header: 'Target', question: 'Which file?', isOther: true, isSecret: false,
          options: [{ label: 'README.md', description: 'Read the README.' }],
        }],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'ask-user-item')
    ))).toBe(true));
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({
      id: 'ask-user-item', title: 'ask_user_question', status: 'running',
      statusText: expect.stringContaining('"requestId":"ask-1"'),
    }));
    expect(surface.getSnapshot().clientRequests).toStrictEqual([{
      id: 'ask-1',
      kind: 'ask_user',
      conversationId: 'thread-existing',
      turnId: 'turn-input',
      itemId: 'ask-user-item',
      payload: {
        request: {
          itemId: 'ask-user-item',
          questions: [{
            id: 'target', header: 'Target', question: 'Which file?', isOther: true, isSecret: false,
            options: [{ label: 'README.md', description: 'Read the README.' }],
          }],
        },
      },
    }]);
    await surface.respondToClientRequest({
      id: 'ask-1', payload: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(lastResponse(transport, 'ask-1')).toMatchObject({
      result: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(surface.getSnapshot().clientRequests).toStrictEqual([]);

    transport.emit({
      id: 'mcp-1',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-existing', turnId: 'turn-input', serverName: 'calendar', mode: 'form',
        message: 'Allow calendar.create_event?', requestedSchema: { type: 'object', properties: {} },
        _meta: {
          codex_approval_kind: 'mcp_tool_call', tool_name: 'create_event', persist: ['session', 'always'],
          connector_name: 'Team Calendar',
          tool_params: { title: 'Planning' },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'approval-mcp-1')
    ))).toBe(true));
    expect(surface.getSnapshot().clientRequests).toStrictEqual([{
      id: 'mcp-1',
      kind: 'confirm_tool',
      conversationId: 'thread-existing',
      turnId: 'turn-input',
      itemId: 'approval-mcp-1',
      payload: {
        confirmation: {
          argumentsPreview: '{\n  "title": "Planning"\n}',
          integrationId: 'calendar',
          integrationName: 'Team Calendar',
          summary: 'Allow calendar.create_event?',
          toolName: 'create_event',
          allowConversation: true,
          allowAlways: true,
        },
      },
    }]);
    await surface.respondToClientRequest({ id: 'mcp-1', payload: { decision: 'allow_conversation' } });
    expect(lastResponse(transport, 'mcp-1')).toMatchObject({
      result: { action: 'accept', content: null, _meta: { persist: 'session' } },
    });
  });

  it('executes built-in slash commands and drains queued prompts after a turn', async () => {
    const goal = {
      threadId: 'thread-existing', objective: 'Ship it', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const transport = new FakeTransport({
      'thread/goal/set': () => ({ goal }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    await surface.sendMessage('/compact');
    expect(lastRequest(transport, 'thread/compact/start')).toMatchObject({ params: { threadId: 'thread-existing' } });
    await surface.sendMessage('/plan');
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({ params: { collaborationMode: { mode: 'plan' } } });
    await surface.sendMessage('/goal Ship it');
    expect(surface.getSnapshot().goal).toMatchObject({ objective: 'Ship it' });

    await surface.sendMessage('First');
    await surface.sendMessage('Second');
    expect(surface.getSnapshot().queuedPrompts).toMatchObject([{ text: 'Second' }]);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });
    await vi.waitFor(() => expect(
      transport.sent.filter((message) => 'method' in message && message.method === 'turn/start'),
    ).toHaveLength(2));
    expect(surface.getSnapshot()).toMatchObject({ busy: true, queuedPrompts: [] });
  });

  it('exposes skills, goals, context usage, diffs, and rollback-backed message deletion', async () => {
    const transport = new FakeTransport({
      'skills/list': () => ({
        data: [{
          cwd: '/tmp/project', errors: [], skills: [{
            name: 'reviewer', description: 'Review code', shortDescription: null, path: '/tmp/reviewer/SKILL.md',
            scope: 'repo', enabled: true, interface: { displayName: 'Reviewer' },
          }],
        }],
      }),
      'thread/rollback': () => ({ thread: thread('thread-existing', false) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    expect(surface.getSnapshot().skills).toMatchObject([{ name: 'reviewer', displayName: 'Reviewer' }]);
    transport.emit({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-history',
        tokenUsage: {
          total: { totalTokens: 200, inputTokens: 120, cachedInputTokens: 20, outputTokens: 80, reasoningOutputTokens: 30 },
          last: { totalTokens: 100, inputTokens: 60, cachedInputTokens: 10, outputTokens: 40, reasoningOutputTokens: 15 },
          modelContextWindow: 1000,
        },
      },
    });
    transport.emit({
      method: 'turn/diff/updated',
      params: { threadId: 'thread-existing', turnId: 'turn-history', diff: '@@ -1 +1,2 @@\n-old\n+new\n+line' },
    });
    transport.emit({
      method: 'thread/goal/updated',
      params: {
        threadId: 'thread-existing', turnId: null,
        goal: {
          threadId: 'thread-existing', objective: 'Finish', status: 'active', tokenBudget: 1000,
          tokensUsed: 200, timeUsedSeconds: 10, createdAt: 1, updatedAt: 2,
        },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      contextUsage: { totalTokens: 200, lastTotalTokens: 100, usedPercent: 10 },
      goal: { objective: 'Finish', tokenBudget: 1000 },
      turnGitDiff: { addedLines: 2, removedLines: 1 },
    });
    await surface.deleteMessage(0);
    expect(lastRequest(transport, 'thread/rollback')).toMatchObject({
      params: { threadId: 'thread-existing', numTurns: 1 },
    });
    expect(surface.getSnapshot().messages).toStrictEqual([]);
  });

  it('uses app-server cwd defaults and reports unavailable conversation operations precisely', async () => {
    const goal = {
      threadId: 'thread-new', objective: 'Ship', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const transport = new FakeTransport({
      'skills/list': () => { throw new Error('skills unavailable'); },
      'thread/list': () => ({ data: [], nextCursor: null }),
      'thread/goal/set': () => ({ goal }),
      'review/start': () => ({ turn: turn('review-complete', 'completed', []), reviewThreadId: 'thread-new' }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      conversationLimit: 0,
    });
    await surface.connect();
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: null,
      skillCatalogStatus: 'error',
      skills: [],
    });
    expect(lastRequest(transport, 'thread/list')).toBeUndefined();
    expect(lastRequest(transport, 'skills/list')).toMatchObject({ params: { forceReload: false } });
    expect(lastRequest(transport, 'permissionProfile/list')).toMatchObject({ params: { cursor: null } });
    await expect(surface.clearGoal()).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal edit')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal clear')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/compact')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal pause')).rejects.toThrow('not supported');
    expect(lastRequest(transport, 'thread/start')).toBeUndefined();
    expect(lastRequest(transport, 'thread/goal/clear')).toBeUndefined();
    expect(lastRequest(transport, 'thread/compact/start')).toBeUndefined();

    await surface.setGoal('Ship');
    expect(lastRequest(transport, 'thread/start')).not.toMatchObject({ params: { cwd: expect.anything() } });
    expect(lastRequest(transport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship', status: 'active' },
    });
    await expect(surface.setGoal('   ')).rejects.toThrow('cannot be empty');
    await surface.setGoal(' Ship ', null);
    expect(lastRequest(transport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship', status: 'active', tokenBudget: null },
    });
    await surface.clearGoal();
    expect(lastRequest(transport, 'thread/goal/clear')).toMatchObject({ params: { threadId: 'thread-new' } });
    await surface.sendMessage('/review');
    expect(surface.getSnapshot().busy).toBe(false);
  });

  it('creates zero-config conversations only for slash commands that need a thread', async () => {
    const goal = {
      threadId: 'thread-new', objective: 'Ship it', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const goalTransport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
      'thread/goal/set': () => ({ goal }),
    });
    const goalSurface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(goalTransport),
      conversationDefaults: { model: 'gpt-5', reasoningEffort: 'medium' },
    });
    await goalSurface.connect();
    await goalSurface.sendMessage('/goal Ship it');
    expect(lastRequest(goalTransport, 'thread/start')).toMatchObject({ params: { model: 'gpt-5' } });
    expect(lastRequest(goalTransport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship it' },
    });
    expect(lastRequest(goalTransport, 'turn/start')).toBeUndefined();

    const reviewTransport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
      'review/start': () => ({ turn: turn('review-turn', 'inProgress', []), reviewThreadId: 'thread-new' }),
    });
    const reviewSurface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(reviewTransport),
      conversationDefaults: { model: 'gpt-5', reasoningEffort: 'medium' },
    });
    await reviewSurface.connect();
    await reviewSurface.sendMessage('/review focus on regressions');
    expect(lastRequest(reviewTransport, 'thread/start')).toMatchObject({ params: { model: 'gpt-5' } });
    expect(lastRequest(reviewTransport, 'review/start')).toMatchObject({
      params: {
        threadId: 'thread-new', delivery: 'inline',
        target: { type: 'custom', instructions: 'focus on regressions' },
      },
    });
    expect(lastRequest(reviewTransport, 'turn/start')).toBeUndefined();
  });

  it('inherits zero-thread UI selections when the first normal prompt creates a conversation', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
    });
    await surface.connect();
    await surface.updateConversationSettings({
      approvalPreset: 'full-access',
      modelId: 'gpt-mini',
      reasoningEffort: 'high',
      planMode: true,
    });

    await surface.sendMessage('Build the app');

    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        approvalPolicy: 'never', approvalsReviewer: 'user', permissions: ':danger-full-access',
        model: 'gpt-mini-runtime',
      },
    });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new', effort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high' },
        },
      },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        threadId: 'thread-new', model: 'gpt-mini-runtime', effort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high' },
        },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      approvalPreset: 'full-access', selectedModelId: 'gpt-mini', selectedReasoningEffort: 'high', planMode: true,
    });
  });

  it('uses an explicitly switched model default instead of inheriting incompatible reasoning', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
    });
    await surface.connect();
    await surface.updateConversationSettings({ modelId: 'gpt-mini', reasoningEffort: 'high' });

    await expect(surface.createConversation({ model: 'gpt-5' })).resolves.toMatchObject({
      selectedModelId: 'gpt-5', selectedReasoningEffort: 'medium',
    });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new', effort: 'medium',
        collaborationMode: { settings: { model: 'gpt-5', reasoning_effort: 'medium' } },
      },
    });
  });

  it('backs edit, retry, delete, and queued prompt actions with real surface operations', async () => {
    const edited = createSurface();
    await edited.surface.connect();
    await expect(edited.surface.deleteMessage(-1)).rejects.toThrow('Unknown message index');
    await expect(edited.surface.editMessage(1, 'Nope')).rejects.toThrow('Only user messages');
    await expect(edited.surface.editMessage(0, '   ')).rejects.toThrow('empty content');
    await edited.surface.editMessage(0, 'Edited prompt');
    expect(lastRequest(edited.transport, 'thread/rollback')).toMatchObject({ params: { numTurns: 1 } });
    expect(lastRequest(edited.transport, 'turn/start')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Edited prompt' }] },
    });

    const retried = createSurface();
    await retried.surface.connect();
    await retried.surface.retryMessage(1);
    expect(lastRequest(retried.transport, 'thread/rollback')).toMatchObject({ params: { numTurns: 1 } });
    expect(lastRequest(retried.transport, 'turn/start')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Hello' }] },
    });

    const queued = createSurface();
    await queued.surface.connect();
    await queued.surface.sendMessage('First');
    const firstQueue = await queued.surface.sendMessage('Delete me');
    const deleteId = firstQueue.queuedPrompts[0]!.id;
    await queued.surface.deleteQueuedPrompt(deleteId);
    await expect(queued.surface.deleteQueuedPrompt(deleteId)).rejects.toThrow('Unknown queued prompt');
    const secondQueue = await queued.surface.sendMessage('Steer now');
    const steerId = secondQueue.queuedPrompts[0]!.id;
    await queued.surface.steerQueuedPrompt(steerId);
    expect(lastRequest(queued.transport, 'turn/steer')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Steer now' }] },
    });
    await expect(queued.surface.steerQueuedPrompt('missing')).rejects.toThrow('Unknown queued prompt');
  });

  it('reduces every streamed tool update and resolves cancellation and confirmation variants', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started', params: { threadId: 'thread-existing', turn: turn('turn-stream', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-stream', startedAtMs: 1,
        item: {
          type: 'commandExecution', id: 'cmd-stream', command: 'printf data > output.txt',
          cwd: '/tmp/project', processId: null, source: 'agent', status: 'inProgress',
          commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
        },
      },
    });
    transport.emit({
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'cmd-stream', delta: 'one' },
    });
    transport.emit({
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'cmd-stream', delta: 'two' },
    });
    transport.emit({
      method: 'item/fileChange/patchUpdated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'patch-stream',
        changes: [{ path: 'src/new.ts', kind: { type: 'add' }, diff: 'one\ntwo' }],
      },
    });
    transport.emit({
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'mcp-stream', message: 'opening' },
    });
    transport.emit({
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'mcp-stream', message: 'done' },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'plan', delta: 'First\n' },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'plan', delta: 'Second\n' },
    });
    transport.emit({
      method: 'turn/plan/updated',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', explanation: null, plan: [] },
    });
    transport.emit({
      method: 'thread/compacted', params: { threadId: 'thread-existing', turnId: 'turn-stream' },
    });
    transport.emit({
      method: 'thread/compacted', params: { threadId: 'thread-existing', turnId: 'turn-stream' },
    });
    const parts = surface.getSnapshot().messages.flatMap((message) => message.parts);
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cmd-stream', body: 'onetwo' }),
      expect.objectContaining({ id: 'patch-stream', status: 'running' }),
      expect.objectContaining({ id: 'mcp-stream', body: 'opening\ndone' }),
    ]));
    expect(surface.getSnapshot().messages.filter((message) => message.kind === 'compaction')).toHaveLength(1);

    transport.emit({
      id: 'ask-cancel', method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'ask-cancel-item', autoResolutionMs: 60_000,
        questions: [{ id: 'q', header: 'Q', question: 'Answer?', isOther: false, isSecret: true, options: null }],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'ask-cancel-item')
    ))).toBe(true));
    await surface.respondToClientRequest({ id: 'ask-cancel', payload: { cancelled: true } });
    expect(lastResponse(transport, 'ask-cancel')).toMatchObject({ result: { answers: {} } });
    await expect(surface.respondToClientRequest({ id: 'ask-cancel' })).rejects.toThrow('Unknown client request');

    for (const [id, decision, persist] of [
      ['mcp-once', 'allow', null],
      ['mcp-always', 'always_allow', 'always'],
      ['mcp-deny', 'deny', null],
    ] as const) {
      const itemId = `mcp-${id}`;
      transport.emit({
        method: 'item/started',
        params: {
          threadId: 'thread-existing', turnId: 'turn-stream', startedAtMs: 1,
          item: {
            type: 'mcpToolCall', id: itemId, server: 'tools', tool: 'Run', status: 'inProgress',
            arguments: { path: 'README.md' }, appContext: null, pluginId: null, result: null,
            error: null, durationMs: null,
          },
        },
      });
      transport.emit({
        id, method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thread-existing', turnId: 'turn-stream', serverName: 'tools', mode: 'form',
          message: '', requestedSchema: { type: 'object', properties: {} },
          _meta: {
            codex_approval_kind: 'mcp_tool_call', tool_title: 'Run', persist,
            tool_params_display: [{ name: 'path', display_name: 'Path', value: { file: 'README.md' } }, null],
          },
        },
      });
      await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
        message.parts.some((part) => (
          part.type === 'tool'
          && part.id === itemId
          && part.metadata?.confirmationRequestId === id
        ))
      ))).toBe(true));
      await surface.respondToClientRequest({ id, payload: { decision } });
      transport.emit({
        method: 'item/completed',
        params: {
          threadId: 'thread-existing', turnId: 'turn-stream', completedAtMs: 2,
          item: {
            type: 'mcpToolCall', id: itemId, server: 'tools', tool: 'Run',
            status: decision === 'deny' ? 'failed' : 'completed', arguments: { path: 'README.md' },
            appContext: null, pluginId: null, result: null, error: null, durationMs: 1,
          },
        },
      });
    }
    expect(lastResponse(transport, 'mcp-once')).toMatchObject({ result: { action: 'accept', _meta: null } });
    expect(lastResponse(transport, 'mcp-always')).toMatchObject({ result: { _meta: { persist: 'always' } } });
    expect(lastResponse(transport, 'mcp-deny')).toMatchObject({ result: { action: 'decline' } });
  });

  it('rejects invalid sends and ignores interrupts without an active turn', async () => {
    const { surface } = createSurface();
    await surface.connect();
    await expect(surface.sendMessage('   ')).rejects.toThrow('empty message');
    await expect(surface.interrupt()).resolves.toMatchObject({ busy: false });
    await expect(surface.resolveApproval('missing', 'deny')).rejects.toThrow('Unknown approval');
  });

  it('adapts server approval requests and resolves them through one surface API', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    transport.emit({
      id: 90,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'command-1', startedAtMs: 1,
        command: 'npm test', cwd: '/tmp/project', reason: 'Run tests', environmentId: null,
        networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' },
        additionalPermissions: {
          network: { enabled: true },
          fileSystem: {
            read: null,
            write: null,
            entries: [{ path: { type: 'glob_pattern', pattern: '/tmp/results/**' }, access: 'write' }],
          },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().busy).toBe(true);
    expect(surface.getSnapshot().approvals[0]).toMatchObject({
      id: '90', kind: 'command', title: 'Run command', command: 'npm test',
      requestedPermissions: [
        { kind: 'network', enabled: true, host: 'registry.npmjs.org', protocol: 'https' },
        { kind: 'filesystem', access: 'write', path: '/tmp/results/**' },
      ],
    });
    await surface.resolveApproval('90', 'approve', 'session');
    expect(lastResponse(transport, 90)).toMatchObject({ result: { decision: 'acceptForSession' } });

    transport.emit({
      id: 'patch-1', method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread-existing', turnId: 'turn-1', itemId: 'patch-item', startedAtMs: 1, grantRoot: '/tmp/project' },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('patch-1', 'deny');
    expect(lastResponse(transport, 'patch-1')).toMatchObject({ result: { decision: 'decline' } });

    transport.emit({
      id: 91, method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'permissions-1', startedAtMs: 1,
        environmentId: null, cwd: '/tmp/project', reason: null,
        permissions: {
          network: { enabled: null },
          fileSystem: {
            read: ['/tmp'],
            write: ['/tmp'],
            entries: [
              { path: { type: 'path', path: '/var/log' }, access: 'read' },
              { path: { type: 'special', value: { kind: 'root' } }, access: 'deny' },
              { path: { type: 'special', value: { kind: 'minimal' } }, access: 'read' },
              { path: { type: 'special', value: { kind: 'project_roots', subpath: 'src' } }, access: 'write' },
              { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'write' },
              { path: { type: 'special', value: { kind: 'slash_tmp' } }, access: 'write' },
              { path: { type: 'special', value: { kind: 'unknown', path: '/private', subpath: 'cache' } }, access: 'write' },
            ],
          },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]?.requestedPermissions).toStrictEqual([
      { kind: 'network', enabled: false },
      { kind: 'filesystem', access: 'read', path: '/tmp' },
      { kind: 'filesystem', access: 'write', path: '/tmp' },
      { kind: 'filesystem', access: 'read', path: '/var/log' },
      { kind: 'filesystem', access: 'deny', path: 'filesystem root' },
      { kind: 'filesystem', access: 'read', path: 'minimal runtime paths' },
      { kind: 'filesystem', access: 'write', path: 'project roots/src' },
      { kind: 'filesystem', access: 'write', path: 'system temporary directory' },
      { kind: 'filesystem', access: 'write', path: '/tmp' },
      { kind: 'filesystem', access: 'write', path: '/private/cache' },
    ]);
    await surface.resolveApproval('91', 'approve');
    expect(lastResponse(transport, 91)).toMatchObject({ result: { scope: 'turn' } });

    transport.emit({
      id: 92, method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'permissions-2', startedAtMs: 1,
        environmentId: null, cwd: '/tmp/project', reason: 'Use network',
        permissions: { fileSystem: null, network: { enabled: true } },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('92', 'deny', 'session');
    expect(lastResponse(transport, 92)).toMatchObject({ result: { permissions: {}, scope: 'session' } });

    transport.emit({
      id: 'legacy-command', method: 'execCommandApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-command-item', approvalId: null,
        command: ['npm', 'test'], cwd: '/tmp/project', reason: 'Verify', parsedCmd: [],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-command', 'approve');
    expect(lastResponse(transport, 'legacy-command')).toMatchObject({ result: { decision: 'approved' } });

    transport.emit({
      id: 'legacy-patch', method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-patch-item', fileChanges: {},
        reason: null, grantRoot: '/tmp/project',
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]?.description).toBe('Write under /tmp/project');
    await surface.resolveApproval('legacy-patch', 'approve', 'session');
    expect(lastResponse(transport, 'legacy-patch')).toMatchObject({ result: { decision: 'approved_for_session' } });

    transport.emit({
      id: 93, method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'command-2', startedAtMs: 1,
        command: null, cwd: null, reason: null, environmentId: null,
        availableDecisions: ['accept', 'cancel'],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]).toMatchObject({ allowedScopes: ['once'], canDeny: true });
    await expect(surface.resolveApproval('93', 'approve', 'session')).rejects.toThrow(
      "Approval decision 'approve:session' is not available",
    );
    await surface.resolveApproval('93', 'deny');
    expect(lastResponse(transport, 93)).toMatchObject({ result: { decision: 'cancel' } });

    transport.emit({
      id: 'patch-2', method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'patch-item-2', startedAtMs: 1,
        reason: 'Update generated files', grantRoot: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('patch-2', 'approve', 'session');
    expect(lastResponse(transport, 'patch-2')).toMatchObject({ result: { decision: 'acceptForSession' } });

    transport.emit({
      id: 94, method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'permissions-3', startedAtMs: 1,
        environmentId: null, cwd: '/tmp/project', reason: 'Use network',
        permissions: { fileSystem: null, network: { enabled: true } },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('94', 'approve', 'session');
    expect(lastResponse(transport, 94)).toMatchObject({ result: { scope: 'session' } });

    transport.emit({
      id: 'legacy-command-deny', method: 'execCommandApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-command-deny-item', approvalId: null,
        command: ['false'], cwd: '/tmp/project', reason: null, parsedCmd: [],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-command-deny', 'deny');
    expect(lastResponse(transport, 'legacy-command-deny')).toMatchObject({ result: { decision: 'denied' } });

    transport.emit({
      id: 'legacy-patch-deny', method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-patch-deny-item', fileChanges: {},
        reason: 'Review changes', grantRoot: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-patch-deny', 'deny');
    expect(lastResponse(transport, 'legacy-patch-deny')).toMatchObject({ result: { decision: 'denied' } });

    transport.emit({
      id: 'legacy-patch-once', method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-patch-once-item', fileChanges: {},
        reason: null, grantRoot: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-patch-once', 'approve');
    expect(lastResponse(transport, 'legacy-patch-once')).toMatchObject({ result: { decision: 'approved' } });
  });

  it('keeps live runtime, approvals, client requests, and queued drains isolated per thread', async () => {
    let turnNumber = 0;
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
      'turn/start': (params) => ({
        turn: turn(`${(params as { threadId: string }).threadId}-turn-${++turnNumber}`, 'inProgress', []),
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await surface.sendMessage('A first');
    await surface.sendMessage('A queued');
    expect(surface.getSnapshot().queuedPrompts).toMatchObject([{ text: 'A queued' }]);

    await surface.selectConversation('thread-b');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', approvals: [] });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-a', turnId: 'thread-a-turn-1', itemId: 'agent-a', delta: 'Background A',
      },
    });
    transport.emit({
      id: 'ask-a',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-a', turnId: 'thread-a-turn-1', itemId: 'ask-a-item', autoResolutionMs: null,
        questions: [{ id: 'q', header: 'Q', question: 'Continue A?', isOther: false, isSecret: false, options: null }],
      },
    });
    transport.emit({
      id: 'approval-a',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-a', turnId: 'thread-a-turn-1', itemId: 'command-a',
        command: 'npm test', cwd: '/tmp/project', reason: null, environmentId: null,
        commandActions: [], networkApprovalContext: null, additionalPermissions: null,
        availableDecisions: ['accept', 'decline'], proposedExecpolicyAmendment: null,
      },
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', approvals: [] });
    expect(surface.getSnapshot().clientRequests).toStrictEqual([]);
    expect(surface.conversation('thread-a').getSnapshot().clientRequests).toMatchObject([{
      id: 'ask-a', kind: 'ask_user', conversationId: 'thread-a', turnId: 'thread-a-turn-1',
    }]);
    expect(lastResponse(transport, 'ask-a')).toBeUndefined();
    await surface.respondToClientRequest({ id: 'ask-a', payload: { answers: { q: { answers: ['yes'] } } } });
    expect(lastResponse(transport, 'ask-a')).toMatchObject({ result: { answers: { q: { answers: ['yes'] } } } });
    expect(surface.conversation('thread-a').getSnapshot().clientRequests).toStrictEqual([]);

    const resumeACount = () => transport.sent.filter((message) => (
      'method' in message
      && message.method === 'thread/resume'
      && 'params' in message
      && (message.params as { threadId?: string }).threadId === 'thread-a'
    )).length;
    expect(resumeACount()).toBe(1);
    await surface.selectConversation('thread-a');
    expect(resumeACount()).toBe(1);
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Background A' }),
      expect.objectContaining({ type: 'tool', id: 'ask-a-item', status: 'running' }),
    ]));
    expect(surface.getSnapshot().answeredClientRequestIds).toContain('ask-a');
    expect(surface.getSnapshot().approvals).toMatchObject([{ id: 'approval-a', conversationId: 'thread-a' }]);
    await surface.resolveApproval('approval-a', 'deny');

    await surface.selectConversation('thread-b');
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-a', turn: turn('thread-a-turn-1', 'completed', []) },
    });
    await vi.waitFor(() => expect(
      transport.sent.filter((message) => 'method' in message && message.method === 'turn/start'),
    ).toHaveLength(2));
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: { threadId: 'thread-a', input: [{ type: 'text', text: 'A queued' }] },
    });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', busy: false });

    await surface.selectConversation('thread-a');
    expect(resumeACount()).toBe(1);
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', busy: true });
    expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'A queued' }] }),
    ]));
  });

  it('hydrates an uncached background thread before projecting its live status', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-b', status: { type: 'active', activeFlags: [] } },
    });

    await surface.selectConversation('thread-b');
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/resume'
    ))).toHaveLength(2);
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-b',
      messages: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
    });
  });

  it('runs independent conversation handles concurrently and delivers background state and approvals', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => {
        const { threadId, cwd } = params as { threadId: string; cwd?: string };
        return { ...resumeResponse({ ...thread(threadId, true), cwd: cwd ?? '/tmp/project' }), cwd: cwd ?? '/tmp/project' };
      },
      'skills/list': (params) => {
        const cwd = (params as { cwds?: string[] }).cwds?.[0] ?? '/global';
        return {
          data: [{
            cwd,
            skills: [{
              name: `skill-${cwd}`, description: `Skill for ${cwd}`, path: `${cwd}/SKILL.md`,
              scope: 'repo', enabled: true, interface: null,
            }],
            errors: [],
          }],
        };
      },
      'turn/start': (params) => ({
        turn: turn(`turn-${(params as { threadId: string }).threadId}`, 'inProgress', []),
      }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
    });
    await surface.connect();
    const a = surface.conversation('thread-a');
    const b = surface.conversation('thread-b');
    const aListener = vi.fn();
    const bListener = vi.fn();
    a.onStateChange(aListener);
    b.onStateChange(bListener);

    await Promise.all([
      a.load({ cwd: '/workspace/a', extensionContext: { agent: 'a' } }),
      b.load({ cwd: '/workspace/b', extensionContext: { agent: 'b' } }),
    ]);
    await Promise.all([a.sendMessage('Run A'), b.sendMessage('Run B')]);

    expect(surface.getSnapshot().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-a', turnCount: 2 }),
      expect.objectContaining({ id: 'thread-b', turnCount: 2 }),
    ]));
    await surface.refreshConversations();
    expect(surface.getSnapshot().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-a', turnCount: 2 }),
      expect.objectContaining({ id: 'thread-b', turnCount: 2 }),
    ]));

    expect(surface.getSnapshot().activeConversationId).toBeNull();
    expect(a.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-a', activeTurnId: 'turn-thread-a', busy: true,
      skills: [{ name: 'skill-/workspace/a' }],
    });
    expect(b.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-b', activeTurnId: 'turn-thread-b', busy: true,
      skills: [{ name: 'skill-/workspace/b' }],
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({ params: { threadId: 'thread-b' } });

    await a.select();
    aListener.mockClear();
    bListener.mockClear();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-b', turnId: 'turn-thread-b', itemId: 'agent-b', delta: 'Background B',
      },
    });
    transport.emit({
      id: 'approval-b', method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-b', turnId: 'turn-thread-b', itemId: 'command-b', command: 'npm test',
        cwd: '/workspace/b', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null, availableDecisions: ['accept', 'decline'],
        proposedExecpolicyAmendment: null,
      },
    });
    await vi.waitFor(() => expect(b.getSnapshot().approvals).toMatchObject([{ id: 'approval-b' }]));
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', approvals: [] });
    expect(b.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Background B' }),
    ]));
    expect(bListener).toHaveBeenCalled();
    expect(aListener).not.toHaveBeenCalledWith(expect.objectContaining({ approvals: [expect.anything()] }));
    await expect(a.resolveApproval('approval-b', 'deny')).rejects.toThrow("belongs to conversation 'thread-b'");
    await surface.resolveApproval('approval-b', 'deny');
    expect(lastResponse(transport, 'approval-b')).toMatchObject({ result: { decision: 'decline' } });
  });

  it('applies product-neutral host extensions on start and resume and executes dynamic tools', async () => {
    const configureConversation = vi.fn((context: {
      operation: 'start' | 'resume';
      extensionContext?: unknown;
    }) => ({
      config: { extensionAgent: (context.extensionContext as { agent: string }).agent },
      developerInstructions: `extension-${context.operation}`,
    }));
    const execute = vi.fn(({ extensionContext, arguments: input }) => ({
      success: true,
      content: [{
        type: 'text' as const,
        text: `${(extensionContext as { agent: string }).agent}:${JSON.stringify(input)}`,
      }],
    }));
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-existing', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      extensions: [{
        configureConversation,
        dynamicTools: [{
          name: 'lookup_ticket',
          description: 'Look up one product ticket',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
          execute,
        }],
      }],
    });
    await surface.connect();
    await surface.createConversation({
      cwd: '/workspace/a', config: { explicit: true }, developerInstructions: 'host-start',
    }, { extensionContext: { agent: 'a' } });
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        cwd: '/workspace/a',
        config: { extensionAgent: 'a', explicit: true },
        developerInstructions: 'extension-start\n\nhost-start',
        dynamicTools: [{
          type: 'function', name: 'lookup_ticket', description: 'Look up one product ticket',
        }],
      },
    });

    await surface.conversation('thread-existing').load({
      cwd: '/workspace/b', extensionContext: { agent: 'b' },
    });
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({
      params: {
        threadId: 'thread-existing', cwd: '/workspace/b',
        config: { extensionAgent: 'b' }, developerInstructions: 'extension-resume',
      },
    });

    transport.emit({
      id: 'dynamic-b', method: 'item/tool/call',
      params: {
        threadId: 'thread-existing', turnId: 'turn-b', callId: 'call-b', namespace: null,
        tool: 'lookup_ticket', arguments: { id: 'SDK-42' },
      },
    });
    await vi.waitFor(() => expect(lastResponse(transport, 'dynamic-b')).toMatchObject({
      result: { success: true, contentItems: [{ type: 'inputText', text: 'b:{"id":"SDK-42"}' }] },
    }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'thread-existing', extensionContext: { agent: 'b' },
    }));
    expect(configureConversation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'resume', conversationId: 'thread-existing', cwd: '/workspace/b',
    }));
  });

  it('applies typed main-process MCP servers on conversation start and resume', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-existing', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      mcpServers: [{
        name: 'relay',
        transport: { type: 'http', url: 'http://127.0.0.1:8767/mcp' },
        toolApprovalMode: 'approve',
        required: true,
        enabledTools: ['get_shipments', 'update_shipment'],
        startupTimeoutMs: 12_500,
        toolTimeoutMs: 30_000,
      }],
    });
    await surface.connect();

    await surface.createConversation();
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        config: {
          'mcp_servers.relay': {
            url: 'http://127.0.0.1:8767/mcp',
            default_tools_approval_mode: 'approve',
            required: true,
            enabled_tools: ['get_shipments', 'update_shipment'],
            startup_timeout_sec: 12.5,
            tool_timeout_sec: 30,
          },
        },
      },
    });

    await surface.conversation('thread-existing').load();
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        config: {
          'mcp_servers.relay': expect.objectContaining({ url: 'http://127.0.0.1:8767/mcp' }),
        },
      },
    });
    expect(JSON.stringify(surface.getSnapshot())).not.toContain('127.0.0.1:8767');
  });

  it('supports stdio MCP definitions and per-conversation replacement or disabling', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-existing', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
      mcpServers: [{ name: 'default_server', transport: { type: 'http', url: 'http://127.0.0.1:9000/mcp' } }],
    });
    await surface.connect();

    await surface.createConversation({}, {
      mcpServers: [{
        name: 'shipment_worker',
        transport: {
          type: 'stdio',
          command: '/usr/bin/node',
          args: ['/opt/relay/mcp.mjs'],
          cwd: '/opt/relay',
          env: { RELAY_MODE: 'test' },
          envVars: ['RELAY_TOKEN'],
        },
        toolApprovalMode: 'prompt',
      }],
    });
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        config: {
          'mcp_servers.shipment_worker': {
            command: '/usr/bin/node',
            args: ['/opt/relay/mcp.mjs'],
            cwd: '/opt/relay',
            env: { RELAY_MODE: 'test' },
            env_vars: ['RELAY_TOKEN'],
            default_tools_approval_mode: 'prompt',
          },
        },
      },
    });
    expect(lastRequest(transport, 'thread/start')).not.toMatchObject({
      params: { config: { 'mcp_servers.default_server': expect.anything() } },
    });

    await surface.conversation('thread-existing').load({ mcpServers: [] });
    expect(lastRequest(transport, 'thread/resume')).toMatchObject({ params: { threadId: 'thread-existing' } });
    expect(lastRequest(transport, 'thread/resume')).not.toHaveProperty('params.config');
  });

  it('validates typed MCP definitions and raw-config collisions', async () => {
    const client = () => new CodexAppServerClient(new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
    }));
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{ name: 'bad.name', transport: { type: 'http', url: 'http://127.0.0.1/mcp' } }],
    })).toThrow('name must match');
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [
        { name: 'duplicate', transport: { type: 'http', url: 'http://127.0.0.1/a' } },
        { name: 'duplicate', transport: { type: 'http', url: 'http://127.0.0.1/b' } },
      ],
    })).toThrow("Duplicate Codex MCP server 'duplicate'");
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{ name: 'invalid_url', transport: { type: 'http', url: 'file:///tmp/mcp' } }],
    })).toThrow('URL must use HTTP or HTTPS');
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{
        name: 'invalid_cwd', transport: { type: 'stdio', command: 'node', cwd: 'relative' },
      }],
    })).toThrow('cwd must be an absolute path');
    expect(() => new CodexSurface({
      client: client(),
      mcpServers: [{
        name: 'invalid_timeout', transport: { type: 'stdio', command: 'node' }, startupTimeoutMs: 0,
      }],
    })).toThrow('startup timeout must be a positive finite number');

    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: client(),
      mcpServers: [{ name: 'relay', transport: { type: 'http', url: 'http://127.0.0.1/mcp' } }],
    });
    await surface.connect();
    await expect(surface.createConversation({
      config: { 'mcp_servers.relay.url': 'http://127.0.0.1:9999/mcp' },
    })).rejects.toThrow("conflicts with its typed definition");
  });

  it('provides scoped conversation discovery, skill catalogs, attachments, and direct rollback', async () => {
    const transport = new FakeTransport({
      'thread/list': (params) => ({
        data: [{ ...thread('thread-existing', true), cwd: String((params as { cwd?: string }).cwd ?? '/tmp/project') }],
        nextCursor: null,
      }),
      'skills/list': (params) => {
        const cwd = (params as { cwds?: string[] }).cwds?.[0] ?? '/global';
        return {
          data: [{
            cwd,
            skills: [{
              name: 'workspace-skill', description: cwd, path: `${cwd}/SKILL.md`, scope: 'repo',
              enabled: true, interface: null,
            }],
            errors: [],
          }],
        };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();

    await expect(surface.listConversations({ cwd: '/workspace/specific', limit: 5 }))
      .resolves.toMatchObject([{ id: 'thread-existing', cwd: '/workspace/specific' }]);
    expect(lastRequest(transport, 'thread/list')).toMatchObject({
      params: { cwd: '/workspace/specific', limit: 5, archived: false },
    });
    await expect(surface.listSkills({ cwd: '/workspace/specific', forceReload: true }))
      .resolves.toMatchObject([{ name: 'workspace-skill', path: '/workspace/specific/SKILL.md' }]);

    await surface.sendMessage('Inspect attachments', {
      attachments: [
        { type: 'image', path: '/tmp/screenshot.png', detail: 'high' },
        { type: 'file', path: '/tmp/README.md', name: 'README' },
      ],
    });
    expect(surface.getSnapshot().messages.find((message) => (
      message.role === 'user' && message.parts.some((part) => part.type === 'attachment')
    ))).toMatchObject({
      parts: [
        { type: 'text', text: 'Inspect attachments' },
        { type: 'attachment', attachment: { kind: 'image', name: 'screenshot.png', path: '/tmp/screenshot.png' } },
        { type: 'attachment', attachment: { kind: 'file', name: 'README', path: '/tmp/README.md' } },
      ],
    });
    await surface.sendMessage('Queued with attachment', {
      attachments: [{ type: 'file', path: '/tmp/queued.txt' }],
    });
    const queuedPromptId = surface.getSnapshot().queuedPrompts[0]?.id;
    expect(queuedPromptId).toBeDefined();
    await expect(surface.steerQueuedPrompt(queuedPromptId!)).rejects.toThrow(
      'Queued prompts with attachments cannot be steered and remain queued',
    );
    expect(surface.getSnapshot().queuedPrompts).toHaveLength(1);
    await surface.deleteQueuedPrompt(queuedPromptId!);
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Inspect attachments' },
          { type: 'localImage', path: '/tmp/screenshot.png', detail: 'high' },
          { type: 'mention', path: '/tmp/README.md', name: 'README' },
        ],
      },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });
    const conversation = surface.conversation('thread-existing');
    expect(conversation.getSnapshot()).toMatchObject({
      activeTurnId: null,
      turnIds: ['turn-history', 'turn-live'],
    });
    expect(surface.getSnapshot().conversations).toContainEqual(expect.objectContaining({
      id: 'thread-existing', turnCount: 2,
    }));
    const rolledBack = await conversation.rollbackToTurn('turn-history');
    expect(lastRequest(transport, 'thread/rollback')).toMatchObject({
      params: { threadId: 'thread-existing', numTurns: 2 },
    });
    expect(rolledBack).toMatchObject({ activeConversationId: 'thread-existing', activeTurnId: null, turnIds: [] });
    expect(surface.getSnapshot().conversations).toContainEqual(expect.objectContaining({
      id: 'thread-existing', turnCount: 0,
    }));
    await expect(conversation.sendMessage('Bad attachment', {
      attachments: [{ type: 'file', path: 'relative.txt' }],
    })).rejects.toThrow('Attachment path must be absolute');
  });

  it('preserves structured attachments when retrying and editing user messages', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const attachments = [
      {
        type: 'image' as const,
        path: '/tmp/screenshot.png',
        name: 'Screenshot',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,cG5n',
      },
      { type: 'file' as const, path: '/tmp/README.md', name: 'README', mimeType: 'text/markdown' },
    ];
    await surface.sendMessage('Original prompt', { attachments });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });
    const sentIndex = surface.getSnapshot().messages.findIndex((message) => (
      message.role === 'user' && message.parts.some((part) => part.type === 'attachment')
    ));
    await surface.retryMessage(sentIndex);
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Original prompt' },
          { type: 'localImage', path: '/tmp/screenshot.png' },
          { type: 'mention', path: '/tmp/README.md', name: 'README' },
        ],
      },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });
    const retriedIndex = surface.getSnapshot().messages.findIndex((message) => (
      message.role === 'user' && message.parts.some((part) => part.type === 'attachment')
    ));
    await surface.editMessage(retriedIndex, 'Edited prompt');
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Edited prompt' },
          { type: 'localImage', path: '/tmp/screenshot.png' },
          { type: 'mention', path: '/tmp/README.md', name: 'README' },
        ],
      },
    });
  });

  it('continues a hydrated in-progress assistant message without duplicating its segment', async () => {
    const runningThread = thread('thread-running', false);
    runningThread.status = { type: 'active', activeFlags: [] };
    runningThread.turns = [turn('turn-running', 'inProgress', [
      { type: 'userMessage', id: 'user-running', clientId: null, content: [{ type: 'text', text: 'Continue', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-running', text: 'Hello', phase: null, memoryCitation: null },
    ])];
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-running', false)], nextCursor: null }),
      'thread/resume': () => resumeResponse(runningThread),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-running', turnId: 'turn-running', itemId: 'agent-running', delta: ' world',
      },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-running', turn: turn('turn-running', 'completed', []) },
    });

    const assistant = surface.getSnapshot().messages.filter((message) => (
      message.role === 'assistant' && message.turnId === 'turn-running'
    ));
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      status: 'complete',
      metadata: { conversationId: 'thread-running', turnId: 'turn-running' },
      parts: [{ type: 'text', itemId: 'agent-running', text: 'Hello world' }],
    });
  });

  it('derives skill inputs from plain prompts and rejects renderer-supplied skill paths outside the catalog', async () => {
    const transport = new FakeTransport({
      'skills/list': () => ({
        data: [{
          cwd: '/tmp/project', errors: [], skills: [
            { name: 'pdf', description: 'PDF tools', path: '/trusted/pdf/SKILL.md', scope: 'user', enabled: true },
            { name: 'disabled', description: 'Disabled', path: '/trusted/disabled/SKILL.md', scope: 'user', enabled: false },
          ],
        }],
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().skills).toStrictEqual([
      expect.objectContaining({ name: 'pdf', enabled: true }),
    ]);

    await expect(surface.sendMessage('bad', {
      skills: [{ name: 'pdf', path: '/tmp/attacker/SKILL.md' }],
    })).rejects.toThrow("Skill 'pdf' is not an enabled skill");
    expect(lastRequest(transport, 'turn/start')).toBeUndefined();
    await expect(surface.sendMessage('bad', {
      skills: [{ name: 'disabled', path: '/trusted/disabled/SKILL.md' }],
    })).rejects.toThrow("Skill 'disabled' is not an enabled skill");

    await surface.sendMessage('Use $pdf and /pdf', {
      skills: [{ name: 'pdf', path: '/trusted/pdf/SKILL.md' }],
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Use $pdf and /pdf' },
          { type: 'skill', name: 'pdf', path: '/trusted/pdf/SKILL.md' },
        ],
      },
    });
    expect(lastRequest(transport, 'turn/start')).not.toMatchObject({ params: { cwd: expect.anything() } });
  });

  it('preserves slash command semantics and exposes structured review, rename, and non-mutating history operations', async () => {
    const goal = {
      threadId: 'thread-existing', objective: 'Existing goal', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const transport = new FakeTransport({
      'thread/goal/get': () => ({ goal }),
      'thread/resume': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        if (threadId !== 'thread-running-read') return resumeResponse(thread(threadId, true));
        const running = thread(threadId, false);
        running.status = { type: 'active', activeFlags: [] };
        running.turns = [turn('turn-running-read', 'inProgress', [])];
        return resumeResponse(running);
      },
      'thread/goal/clear': () => ({ cleared: true }),
      'thread/read': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        if (threadId === 'thread-running-read') {
          const running = thread(threadId, false);
          running.status = { type: 'active', activeFlags: [] };
          running.turns = [turn('turn-running-read', 'inProgress', [])];
          return { thread: running };
        }
        return { thread: thread(threadId, true) };
      },
      'thread/turns/list': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        return {
          data: threadId === 'thread-running-read'
            ? [turn('turn-running-read', 'inProgress', [])]
            : (thread(threadId, true).turns as unknown[]),
          nextCursor: null,
          backwardsCursor: null,
        };
      },
      'review/start': (params) => ({
        turn: turn('review-complete', 'completed', []),
        reviewThreadId: (params as { threadId: string }).threadId,
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect((await surface.sendMessage('/goal')).goal).toMatchObject({ objective: 'Existing goal' });
    expect((await surface.sendMessage('/goal edit')).goal).toMatchObject({ objective: 'Existing goal' });
    await surface.sendMessage('/goal clear');
    expect(surface.getSnapshot().goal).toBeNull();
    await expect(surface.sendMessage('/goal pause')).rejects.toThrow('not supported');

    await surface.sendMessage('/plan Build a plan');
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { threadId: 'thread-existing', collaborationMode: { mode: 'plan' } },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: { threadId: 'thread-existing', input: [{ type: 'text', text: 'Build a plan' }] },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });

    await surface.sendMessage('/review focus on regressions');
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { target: { type: 'custom', instructions: 'focus on regressions' }, delivery: 'inline' },
    });
    await surface.startReview({ target: { type: 'baseBranch', branch: 'main' } });
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { target: { type: 'baseBranch', branch: 'main' } },
    });
    await surface.startReview({ target: { type: 'commit', sha: 'abc123' } });
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { target: { type: 'commit', sha: 'abc123', title: null } },
    });

    await surface.renameConversation('Renamed');
    expect(lastRequest(transport, 'thread/name/set')).toMatchObject({
      params: { threadId: 'thread-existing', name: 'Renamed' },
    });
    const history = await surface.readConversationHistory('thread-other');
    expect(history).toMatchObject({
      conversationId: 'thread-other',
      messages: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
    });
    const runningHistory = await surface.readConversationHistory('thread-running-read');
    expect(runningHistory).toMatchObject({
      conversationId: 'thread-running-read',
      threadStatus: { type: 'active' },
      messages: [expect.objectContaining({
        id: 'assistant-turn-running-read', role: 'assistant', status: 'streaming', parts: [],
      })],
    });
    expect(surface.getSnapshot().activeConversationId).toBe('thread-existing');
    expect(transport.sent.filter((message) => (
      'method' in message
      && message.method === 'thread/read'
      && (message.params as { includeTurns?: boolean }).includeTurns === false
    ))).toHaveLength(1);
  });

  it('validates create settings before persistence and rejects detached responses for inline reviews', async () => {
    const transport = new FakeTransport({
      'review/start': () => ({
        turn: turn('turn-review', 'inProgress', []),
        reviewThreadId: 'thread-detached',
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await expect(surface.sendMessage('bad model', { model: 'missing' })).rejects.toThrow("Unknown model 'missing'");
    await expect(surface.sendMessage('bad effort', { reasoningEffort: 'ultra' }))
      .rejects.toThrow("Reasoning effort 'ultra' is not available");
    expect(lastRequest(transport, 'turn/start')).toBeUndefined();
    const startsBefore = transport.sent.filter((message) => 'method' in message && message.method === 'thread/start').length;
    await expect(surface.createConversation({ model: 'gpt-5', reasoningEffort: 'ultra' }))
      .rejects.toThrow("Reasoning effort 'ultra' is not available");
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'thread/start')).toHaveLength(startsBefore);

    await surface.createConversation({ model: 'gpt-5', reasoningEffort: 'medium' });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new', effort: 'medium', collaborationMode: { mode: 'default' },
      },
    });
    await expect(surface.startReview()).rejects.toThrow("unexpected review thread 'thread-detached'");
  });

  it('does not clear optimistic busy state when a stale idle status arrives during turn/start', async () => {
    const pendingTurn = deferred<unknown>();
    const transport = new FakeTransport({
      'turn/start': () => pendingTurn.promise,
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    const first = surface.sendMessage('First');
    await vi.waitFor(() => expect(lastRequest(transport, 'turn/start')).toBeDefined());
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-existing', status: { type: 'idle' } },
    });
    expect(surface.getSnapshot().busy).toBe(true);
    await surface.sendMessage('Second');
    expect(surface.getSnapshot().queuedPrompts).toMatchObject([{ text: 'Second' }]);
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'turn/start')).toHaveLength(1);
    pendingTurn.resolve({ turn: turn('turn-pending', 'inProgress', []) });
    await first;
  });

  it('keeps plan mode selection isolated per thread across refreshed idle histories', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [thread('thread-a', false), thread('thread-b', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await surface.updateConversationSettings({ planMode: true });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', planMode: true });

    await surface.selectConversation('thread-b');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', planMode: false });
    await surface.selectConversation('thread-a');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', planMode: true });
    await surface.selectConversation('thread-b');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', planMode: false });
  });

  it('keeps multiple conversation handles active and readable at the same time', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-a', false), thread('thread-b', false)], nextCursor: null,
      }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, false)),
      'thread/turns/list': () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      'turn/start': (params) => ({
        turn: turn(`turn-${(params as { threadId: string }).threadId}`, 'inProgress', []),
      }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      autoSelectFirstConversation: false,
    });
    await surface.connect();
    const first = surface.conversation('thread-a');
    const second = surface.conversation('thread-b');
    await Promise.all([first.load(), second.load()]);

    await Promise.all([
      first.sendMessage('First background task'),
      second.sendMessage('Second background task'),
    ]);

    expect(first.getSnapshot()).toMatchObject({ busy: true, activeTurnId: 'turn-thread-a' });
    expect(second.getSnapshot()).toMatchObject({ busy: true, activeTurnId: 'turn-thread-b' });
    expect(surface.getSnapshot().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-a', status: 'active', turnCount: 1 }),
      expect.objectContaining({ id: 'thread-b', status: 'active', turnCount: 1 }),
    ]));
    const threadReadsBefore = transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/read'
    )).length;
    const [firstHistory, secondHistory] = await Promise.all([first.readHistory(), second.readHistory()]);
    expect(firstHistory).toMatchObject({
      conversationId: 'thread-a', messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    });
    expect(secondHistory).toMatchObject({
      conversationId: 'thread-b', messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    });
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/read'
    ))).toHaveLength(threadReadsBefore);
  });

  it('does not let out-of-order resume responses steal the active selection', async () => {
    const resumeB = deferred<unknown>();
    const resumeC = deferred<unknown>();
    const transport = new FakeTransport({
      'thread/list': () => ({
        data: [thread('thread-existing', false), thread('thread-b', false), thread('thread-c', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        if (threadId === 'thread-b') return resumeB.promise;
        if (threadId === 'thread-c') return resumeC.promise;
        return resumeResponse(thread(threadId, true));
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    const selectingB = surface.selectConversation('thread-b');
    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-b', historyLoading: true,
    }));
    const selectingC = surface.selectConversation('thread-c');
    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-c', historyLoading: true,
    }));

    resumeB.resolve(resumeResponse(thread('thread-b', true)));
    await selectingB;
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-c', historyLoading: true });
    resumeC.resolve(resumeResponse(thread('thread-c', true)));
    await selectingC;
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-c', historyLoading: false });
  });

  it('renders and resolves MCP confirmations that are not associated with a turn', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      id: 'mcp-thread-level',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-existing', turnId: null, serverName: 'calendar', mode: 'form',
        message: 'Allow calendar.list?', requestedSchema: { type: 'object', properties: {} },
        _meta: {
          codex_approval_kind: 'mcp_tool_call', tool_name: 'list', persist: null, tool_params: {},
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool', id: 'approval-mcp-thread-level', status: 'running',
          metadata: expect.objectContaining({ confirmationRequestId: 'mcp-thread-level' }),
        }),
      ]),
    ));
    await surface.respondToClientRequest({ id: 'mcp-thread-level', payload: { decision: 'allow' } });
    expect(lastResponse(transport, 'mcp-thread-level')).toMatchObject({ result: { action: 'accept' } });
    expect(surface.getSnapshot()).toMatchObject({
      busy: false,
      answeredClientRequestIds: ['mcp-thread-level'],
    });
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', id: 'approval-mcp-thread-level', status: 'running' }),
    ]));
  });

  it('completes plan items and finalizes orphaned running tools with the turn', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-plan', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-plan', itemId: 'plan-item', delta: 'draft' },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan', startedAtMs: 1,
        item: {
          type: 'mcpToolCall', id: 'mcp-orphan', server: 'tools', tool: 'run', status: 'inProgress',
          arguments: {}, appContext: null, pluginId: null, result: null, error: null, durationMs: null,
        },
      },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan', completedAtMs: 2,
        item: { type: 'plan', id: 'plan-item', text: '# Final plan' },
      },
    });
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-progress-turn-plan', status: 'completed', body: '# Final plan' }),
      expect.objectContaining({ id: 'mcp-orphan', status: 'running' }),
    ]));
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-plan', 'interrupted', []) },
    });
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-progress-turn-plan', status: 'completed' }),
      expect.objectContaining({ id: 'mcp-orphan', status: 'failed' }),
    ]));
  });

  it('merges rate limits, preserves waiting status, and applies thread lifecycle events', async () => {
    const transport = new FakeTransport({
      'account/rateLimits/read': () => ({
        rateLimits: {
          limitId: 'codex', limitName: 'Codex',
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 100 },
          secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 200 },
          credits: { hasCredits: true, unlimited: false, balance: '42' },
          individualLimit: null, planType: 'pro', rateLimitReachedType: null,
        },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: { availableCount: 2n, credits: null },
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().rateLimits).toMatchObject({
      rateLimits: { limitName: 'Codex', primary: { usedPercent: 10 }, credits: { balance: '42' } },
      rateLimitResetCredits: { availableCount: '2' },
    });
    transport.emit({
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          limitId: 'codex', limitName: null,
          primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 150 },
          secondary: null, credits: null, individualLimit: null, planType: null,
          rateLimitReachedType: null,
        },
      },
    });
    expect(surface.getSnapshot().rateLimits).toMatchObject({
      rateLimits: {
        limitName: 'Codex', primary: { usedPercent: 55, resetsAt: 150 },
        secondary: { usedPercent: 20 }, credits: { balance: '42' }, planType: 'pro',
      },
    });

    transport.emit({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread-existing',
        status: { type: 'active', activeFlags: ['waitingOnApproval', 'waitingOnUserInput'] },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      busy: true,
      threadStatus: { type: 'active', activeFlags: ['waitingOnApproval', 'waitingOnUserInput'] },
      conversations: [expect.objectContaining({ id: 'thread-existing', status: 'active' })],
    });
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-existing', status: { type: 'idle' } },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, threadStatus: { type: 'idle' } });

    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-error', 'inProgress', []) },
    });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'thread-existing', turnId: 'turn-error', willRetry: true,
        error: { message: 'Retrying', codexErrorInfo: null, additionalDetails: null },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: true, error: 'Retrying' });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'thread-existing', turnId: 'turn-error', willRetry: false,
        error: { message: 'Stopped', codexErrorInfo: null, additionalDetails: null },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, error: 'Stopped' });

    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-system-error', 'inProgress', []) },
    });
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-existing', status: { type: 'systemError' } },
    });
    expect(surface.getSnapshot()).toMatchObject({
      busy: false,
      error: 'Codex app-server reported a system error',
      threadStatus: { type: 'systemError' },
    });
    transport.emit({ method: 'thread/archived', params: { threadId: 'thread-existing' } });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: null, conversations: [], messages: [] });
    transport.emit({ method: 'thread/unarchived', params: { threadId: 'thread-existing' } });
    await vi.waitFor(() => expect(surface.getSnapshot().conversations).toHaveLength(1));
    await surface.selectConversation('thread-existing');
    await surface.sendMessage('Running');
    transport.emit({ method: 'thread/closed', params: { threadId: 'thread-existing' } });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, threadStatus: { type: 'idle' } });
    transport.emit({ method: 'thread/deleted', params: { threadId: 'thread-existing' } });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: null, conversations: [] });
  });

  it('contains rejected fire-and-forget conversation refreshes after unarchive', async () => {
    let failRefresh = false;
    const transport = new FakeTransport({
      'thread/list': () => {
        if (failRefresh) throw new Error('refresh unavailable');
        return { data: [thread('thread-existing', false)], nextCursor: null };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    failRefresh = true;

    transport.emit({ method: 'thread/unarchived', params: { threadId: 'thread-existing' } });
    await vi.waitFor(() => expect(surface.getSnapshot().error).toBe('refresh unavailable'));
    expect(surface.getSnapshot().conversations).toHaveLength(1);
  });

  it('exposes realtime voice as a typed conversation session', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const conversation = surface.conversation('thread-existing');
    const events: CodexSurfaceEvent[] = [];
    conversation.onEvent((event) => events.push(event));

    const session = await conversation.startRealtime({
      outputModality: 'audio',
      version: 'v2',
      voice: 'marin',
      includeStartupContext: true,
      flushTranscriptTailOnSessionEnd: true,
    });
    expect(lastRequest(transport, 'thread/realtime/start')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        outputModality: 'audio',
        version: 'v2',
        voice: 'marin',
        includeStartupContext: true,
        flushTranscriptTailOnSessionEnd: true,
        transport: { type: 'websocket' },
      },
    });

    await session.appendAudio({
      data: new Uint8Array([1, 2, 3, 4]),
      sampleRate: 16_000,
      numChannels: 1,
    });
    expect(lastRequest(transport, 'thread/realtime/appendAudio')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        audio: {
          data: 'AQIDBA==',
          sampleRate: 16_000,
          numChannels: 1,
          samplesPerChannel: 2,
          itemId: null,
        },
      },
    });

    await session.appendText('check the tests', 'user');
    await session.appendSpeech('I am checking the tests');
    expect(lastRequest(transport, 'thread/realtime/appendText')).toMatchObject({
      params: { threadId: 'thread-existing', text: 'check the tests', role: 'user' },
    });
    expect(lastRequest(transport, 'thread/realtime/appendSpeech')).toMatchObject({
      params: { threadId: 'thread-existing', text: 'I am checking the tests' },
    });

    transport.emit({
      method: 'thread/realtime/started',
      params: { threadId: 'thread-existing', realtimeSessionId: 'rtc_123', version: 'v2' },
    });
    transport.emit({
      method: 'thread/realtime/transcript/delta',
      params: { threadId: 'thread-existing', role: 'user', delta: 'check the' },
    });
    transport.emit({
      method: 'thread/realtime/transcript/done',
      params: { threadId: 'thread-existing', role: 'user', text: 'check the tests' },
    });
    transport.emit({
      method: 'thread/realtime/outputAudio/delta',
      params: {
        threadId: 'thread-existing',
        audio: {
          data: 'AQID',
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: 3,
          itemId: 'audio-1',
        },
      },
    });
    transport.emit({
      method: 'thread/realtime/closed',
      params: { threadId: 'thread-existing', reason: 'requested' },
    });

    expect(events.map((event) => event.type)).toStrictEqual([
      'realtime.started',
      'realtime.transcriptDelta',
      'realtime.transcriptCompleted',
      'realtime.audioDelta',
      'realtime.closed',
    ]);
    expect(events[3]).toMatchObject({
      payload: {
        audio: {
          data: new Uint8Array([1, 2, 3]),
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: 3,
          itemId: 'audio-1',
        },
      },
    });

    await session.stop();
    await session.stop();
    expect(requestsFor(transport, 'thread/realtime/stop')).toHaveLength(1);
    await expect(session.appendText('too late')).rejects.toThrow(
      "Realtime session for 'thread-existing' is stopped",
    );
  });

  it('negotiates WebRTC realtime before returning the session handle', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const conversation = surface.conversation('thread-existing');

    const sessionPromise = conversation.startRealtime({
      outputModality: 'audio',
      version: 'v1',
      transport: {
        type: 'webrtc',
        sdp: 'v=0\r\no=codex-remote-offer\r\n',
      },
    });
    await vi.waitFor(() => {
      expect(requestsFor(transport, 'thread/realtime/start')).toHaveLength(1);
    });
    expect(lastRequest(transport, 'thread/realtime/start')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        outputModality: 'audio',
        version: 'v1',
        transport: {
          type: 'webrtc',
          sdp: 'v=0\r\no=codex-remote-offer\r\n',
        },
      },
    });

    transport.emit({
      method: 'thread/realtime/sdp',
      params: {
        threadId: 'thread-existing',
        sdp: 'v=0\r\no=codex-remote-answer\r\n',
      },
    });
    const session = await sessionPromise;
    expect(session).toMatchObject({
      conversationId: 'thread-existing',
      transport: 'webrtc',
      remoteSdp: 'v=0\r\no=codex-remote-answer\r\n',
    });
    await expect(session.appendAudio({
      data: new Uint8Array([0, 0]),
      sampleRate: 24_000,
      numChannels: 1,
    })).rejects.toThrow('must be sent through its negotiated media track');
    await session.stop();
  });

  it('explicitly tolerates every known notification that has no surface projection', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const before = surface.getSnapshot();
    const ignoredMethods = [
      'hook/started',
      'hook/completed',
      'item/autoApprovalReview/started',
      'item/autoApprovalReview/completed',
      'command/exec/outputDelta',
      'process/outputDelta',
      'process/exited',
      'item/commandExecution/terminalInteraction',
      'item/fileChange/outputDelta',
      'mcpServer/oauthLogin/completed',
      'mcpServer/startupStatus/updated',
      'app/list/updated',
      'remoteControl/status/changed',
      'externalAgentConfig/import/progress',
      'externalAgentConfig/import/completed',
      'fs/changed',
      'model/verification',
      'turn/moderationMetadata',
      'model/safetyBuffering/updated',
      'warning',
      'guardianWarning',
      'deprecationNotice',
      'configWarning',
      'fuzzyFileSearch/sessionUpdated',
      'fuzzyFileSearch/sessionCompleted',
      'windows/worldWritableWarning',
      'windowsSandbox/setupCompleted',
    ];
    for (const method of ignoredMethods) transport.emit({ method, params: {} });
    expect(surface.getSnapshot()).toStrictEqual(before);
  });

  it('ignores and reports notifications added by a newer app-server schema', async () => {
    const transport = new FakeTransport();
    const onUnknownNotification = vi.fn();
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      onUnknownNotification,
    });
    await surface.connect();
    const before = surface.getSnapshot();
    const notification = {
      method: 'future/notification',
      params: { threadId: 'thread-existing', future: true },
    };

    expect(() => transport.emit(notification)).not.toThrow();
    expect(onUnknownNotification).toHaveBeenCalledOnce();
    expect(onUnknownNotification).toHaveBeenCalledWith(notification);
    expect(surface.getSnapshot()).toStrictEqual(before);
  });

  it('makes every non-UI server-request policy explicit and fail-closed', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({ id: 'time', method: 'currentTime/read', params: { threadId: 'thread-existing' } });
    await vi.waitFor(() => expect(lastResponse(transport, 'time')).toMatchObject({
      result: { currentTimeAt: expect.any(Number) },
    }));

    const unsupported = [
      {
        id: 'dynamic', method: 'item/tool/call',
        params: { threadId: 'thread-existing', turnId: 'turn', callId: 'call', namespace: null, tool: 'host', arguments: {} },
      },
      {
        id: 'auth', method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: null },
      },
      { id: 'attestation', method: 'attestation/generate', params: {} },
    ];
    for (const request of unsupported) {
      transport.emit(request);
      await vi.waitFor(() => expect(lastResponse(transport, request.id)).toMatchObject({
        error: { code: -32601 },
      }));
    }
  });

  it('removes externally resolved approvals from the active surface', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      id: 'external-approval',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn', itemId: 'command', command: 'npm test',
        cwd: '/tmp/project', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null, availableDecisions: null,
        proposedExecpolicyAmendment: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    transport.emit({
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-existing', requestId: 'external-approval' },
    });
    expect(surface.getSnapshot().approvals).toStrictEqual([]);
    await expect(surface.resolveApproval('external-approval', 'approve')).rejects.toThrow('Unknown approval');
  });
});

function createSurface(): { surface: CodexSurface; transport: FakeTransport } {
  const transport = new FakeTransport();
  return {
    transport,
    surface: new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    }),
  };
}

function responseFor(method: string, params: unknown): unknown {
  switch (method) {
    case 'initialize': return { userAgent: 'test' };
    case 'account/read': return {
      account: { type: 'chatgpt', email: 'test@example.test', planType: 'pro' },
      requiresOpenaiAuth: true,
    };
    case 'model/list': return {
      data: [
        {
          id: 'gpt-5', model: 'gpt-5', upgrade: null, upgradeInfo: null, availabilityNux: null,
          displayName: 'GPT-5', description: 'Test model', hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
          defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null, isDefault: true,
        },
        {
          id: 'gpt-mini', model: 'gpt-mini-runtime', upgrade: null, upgradeInfo: null, availabilityNux: null,
          displayName: 'GPT Mini', description: 'Fast model', hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Balanced' },
            { reasoningEffort: 'high', description: 'Deep' },
          ],
          defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null, isDefault: false,
        },
      ],
      nextCursor: null,
    };
    case 'skills/list': return { data: [{ cwd: '/tmp/project', skills: [], errors: [] }] };
    case 'plugin/installed': return { marketplaces: [], marketplaceLoadErrors: [] };
    case 'permissionProfile/list': return {
      data: [
        { id: ':read-only', description: null, allowed: true },
        { id: ':workspace', description: null, allowed: true },
        { id: ':danger-full-access', description: null, allowed: true },
      ],
      nextCursor: null,
    };
    case 'configRequirements/read': return { requirements: null };
    case 'thread/list': return { data: [thread('thread-existing', false)], nextCursor: null };
    case 'thread/turns/list': {
      const threadId = String((params as { threadId: string }).threadId);
      return {
        data: (thread(threadId, true).turns as unknown[]),
        nextCursor: null,
        backwardsCursor: null,
      };
    }
    case 'thread/resume': return resumeResponse(thread(String((params as { threadId: string }).threadId), true));
    case 'thread/start': return resumeResponse(thread('thread-new', false));
    case 'turn/start': return { turn: turn('turn-live', 'inProgress', []) };
    case 'turn/steer': return { turnId: 'turn-live' };
    case 'turn/interrupt': return {};
    case 'thread/compact/start': return {};
    case 'review/start': return { turn: turn('turn-review', 'inProgress', []), reviewThreadId: 'thread-existing' };
    case 'thread/rollback': return { thread: thread('thread-existing', false) };
    default: return {};
  }
}

function thread(id: string, includeHistory: boolean): Record<string, unknown> {
  return {
    id,
    preview: id === 'thread-existing' ? 'Existing thread' : '',
    name: null,
    cwd: '/tmp/project',
    status: { type: 'idle' },
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_001,
    recencyAt: null,
    turns: includeHistory ? [turn('turn-history', 'completed', [
      { type: 'userMessage', id: 'user-history', clientId: null, content: [{ type: 'text', text: 'Hello', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-history', text: 'Hi there', phase: null, memoryCitation: null },
    ])] : [],
  };
}

function turn(id: string, status: string, items: unknown[]): Record<string, unknown> {
  return { id, status, items, startedAt: 1_700_000_000, completedAt: null, error: null };
}

function resumeResponse(value: Record<string, unknown>): Record<string, unknown> {
  const turns = Array.isArray(value.turns) ? value.turns : [];
  return {
    thread: { ...value, turns: [] },
    initialTurnsPage: { data: [...turns].reverse(), nextCursor: null, backwardsCursor: null },
    model: 'gpt-5',
    cwd: '/tmp/project',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: {
      type: 'workspaceWrite', writableRoots: ['/tmp/project'], networkAccess: false,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ':workspace', extends: null },
    reasoningEffort: 'medium',
  };
}

function testModel(id: string, model: string, isDefault: boolean): Record<string, unknown> {
  return {
    id,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: id,
    description: 'Test model',
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text'],
    supportsPersonality: true,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault,
  };
}

function pluginSummary(
  id: string,
  name: string,
  pluginInterface: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    name,
    installed: true,
    enabled: true,
    interface: pluginInterface,
  };
}

function threadSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: '/tmp/project',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: {
      type: 'workspaceWrite', writableRoots: ['/tmp/project'], networkAccess: false,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ':workspace', extends: null },
    model: 'gpt-5',
    modelProvider: 'openai',
    serviceTier: null,
    effort: 'medium',
    summary: null,
    collaborationMode: {
      mode: 'default',
      settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: null },
    },
    multiAgentMode: 'explicitRequestOnly',
    personality: null,
    ...overrides,
  };
}

function lastRequest(transport: FakeTransport, method: string): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'method' in message && message.method === method) return message;
  }
  return undefined;
}

function requestsFor(transport: FakeTransport, method: string): RpcMessage[] {
  return transport.sent.filter((message) => 'method' in message && message.method === method);
}

function lastResponse(transport: FakeTransport, id: string | number): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'id' in message && message.id === id && !('method' in message)) return message;
  }
  return undefined;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
