import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import { FakeTransport, deferred, lastRequest, requestsFor, testModel, thread } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
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

});
