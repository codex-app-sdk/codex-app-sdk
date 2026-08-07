import { describe, expect, it, vi } from 'vitest';
import type { CodexAppServerClient } from '../src/codex';
import type {
  CodexSurfaceAuthentication,
  CodexSurfaceEventOrigin,
} from '@codex-app-sdk/core/surface';
import {
  initialAuthentication,
  normalizedLoginId,
  safeLoginUrl,
  surfaceAccount,
  surfaceAuthenticationIdentityKey,
  surfaceAuthenticationKey,
} from '../src/node/codex-surface-authentication';
import {
  CodexSurfaceAuthenticationController,
  type CodexSurfaceAuthenticationHost,
} from '../src/node/codex-surface-authentication-controller';
import { initialSurfaceSnapshot } from '../src/node/codex-surface-runtime';

describe('Codex surface authentication values', () => {
  it('normalizes each supported account type and identity', () => {
    expect(surfaceAccount({ type: 'chatgpt', email: 'person@example.test', planType: 'pro' }))
      .toStrictEqual({ type: 'chatgpt', email: 'person@example.test', planType: 'pro' });
    expect(surfaceAccount({ type: 'amazonBedrock', usesCodexManagedCredentials: true }))
      .toStrictEqual({ type: 'amazonBedrock', credentialSource: 'codexManaged' });
    expect(surfaceAccount({ type: 'amazonBedrock', usesCodexManagedCredentials: false }))
      .toStrictEqual({ type: 'amazonBedrock', credentialSource: 'awsManaged' });
    expect(surfaceAccount({ type: 'apiKey' })).toStrictEqual({ type: 'apiKey' });

    expect(surfaceAuthenticationIdentityKey(authentication({ account: null, requiresOpenaiAuth: true })))
      .toBe('{"type":null,"requiresOpenaiAuth":true}');
    expect(surfaceAuthenticationIdentityKey(authentication({
      account: { type: 'chatgpt', email: 'person@example.test', planType: 'pro' },
    }))).toBe('{"type":"chatgpt","email":"person@example.test"}');
    expect(surfaceAuthenticationIdentityKey(authentication({
      account: { type: 'amazonBedrock', credentialSource: 'awsManaged' },
    }))).toBe('{"type":"amazonBedrock","credentialSource":"awsManaged"}');
    expect(surfaceAuthenticationIdentityKey(authentication({ account: { type: 'apiKey' } })))
      .toBe('{"type":"apiKey"}');
  });

  it('keys bootstrap state separately from account identity', () => {
    const value = authentication({
      account: { type: 'chatgpt', email: 'person@example.test', planType: 'team' },
      requiresOpenaiAuth: false,
    });
    expect(surfaceAuthenticationKey(value)).toBe(JSON.stringify({
      account: value.account,
      requiresOpenaiAuth: false,
    }));
    expect(initialAuthentication().login.status).toBe('idle');
  });

  it('validates login ids and browser-safe authentication URLs', () => {
    expect(normalizedLoginId(' login-1 ')).toBe('login-1');
    expect(() => normalizedLoginId('  ')).toThrow('cannot be empty');
    expect(safeLoginUrl('https://example.test/login?q=1')).toBe('https://example.test/login?q=1');
    expect(safeLoginUrl('http://localhost:3000/callback')).toBe('http://localhost:3000/callback');
    expect(() => safeLoginUrl('not a url')).toThrow('invalid authentication URL');
    expect(() => safeLoginUrl('file:///tmp/login')).toThrow("unsupported authentication URL scheme 'file:'");
  });
});

describe('CodexSurfaceAuthenticationController', () => {
  it('starts, reuses, and cancels a ChatGPT login', async () => {
    const request = vi.fn(async (method: string) => method === 'account/login/start'
      ? { type: 'chatgpt', loginId: ' login-1 ', authUrl: 'https://example.test/login' }
      : { status: 'canceled' });
    const { controller, state, host } = setupController(request);

    await expect(controller.startChatGptLogin()).resolves.toStrictEqual({
      loginId: 'login-1', authUrl: 'https://example.test/login',
    });
    expect(state.authentication.login.status).toBe('pending');
    await expect(controller.startChatGptLogin()).resolves.toStrictEqual({
      loginId: 'login-1', authUrl: 'https://example.test/login',
    });
    expect(request).toHaveBeenCalledTimes(1);

    await controller.cancelLogin(' login-1 ');
    expect(request).toHaveBeenLastCalledWith('account/login/cancel', { loginId: 'login-1' });
    expect(state.authentication.login.status).toBe('cancelled');
    expect(host.patchAuthentication).toHaveBeenLastCalledWith(expect.objectContaining({
      login: expect.objectContaining({ status: 'cancelled' }),
    }), 'action');
  });

  it('surfaces invalid and rejected login attempts', async () => {
    const wrongType = setupController(vi.fn(async () => ({ type: 'apiKey' })));
    await expect(wrongType.controller.startChatGptLogin()).rejects.toThrow("unexpected login type 'apiKey'");
    expect(wrongType.state.authentication.login.status).toBe('error');

    const rejected = setupController(vi.fn(async () => { throw new Error('offline'); }));
    await expect(rejected.controller.startChatGptLogin()).rejects.toThrow('offline');
    expect(rejected.state.authentication.login).toMatchObject({ status: 'error', error: 'offline' });
  });

  it('loads authentication, detects identity changes, and records read failures', async () => {
    let email = 'first@example.test';
    const request = vi.fn(async () => ({
      account: { type: 'chatgpt', email, planType: 'pro' }, requiresOpenaiAuth: false,
    }));
    const setup = setupController(request);
    await expect(setup.controller.load('lifecycle')).resolves.toBe(false);
    await expect(setup.controller.load('notification')).resolves.toBe(false);
    email = 'second@example.test';
    await expect(setup.controller.load('notification')).resolves.toBe(true);
    expect(setup.state.authentication.account).toMatchObject({ email: 'second@example.test' });

    request.mockRejectedValueOnce(new Error('read failed'));
    await expect(setup.controller.load('action')).rejects.toThrow('read failed');
    expect(setup.state.authentication).toMatchObject({ status: 'error', error: 'read failed' });
  });

  it('refreshes bootstrap state and honors the blocked-authentication boundary', async () => {
    const allowed = setupController(vi.fn(async () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })));
    await allowed.controller.refresh('action', true);
    expect(allowed.host.bootstrapSurfaceData).toHaveBeenCalledWith(true);
    expect(allowed.host.clearAuthenticatedSurfaceData).not.toHaveBeenCalled();
    expect(allowed.controller.pendingRefresh()).toBeNull();

    const blocked = setupController(vi.fn(async () => ({ account: null, requiresOpenaiAuth: true })));
    await blocked.controller.refresh('lifecycle');
    expect(blocked.controller.blocksBootstrap()).toBe(true);
    expect(blocked.host.clearAuthenticatedSurfaceData).toHaveBeenCalledOnce();
    expect(blocked.host.bootstrapSurfaceData).not.toHaveBeenCalled();
  });

  it('handles login completion notifications and refresh errors', async () => {
    const failed = setupController(vi.fn(async () => ({ account: null, requiresOpenaiAuth: true })));
    failed.state.authentication.login = {
      status: 'pending', loginId: 'login-current', authUrl: 'https://example.test/login', error: null,
    };
    failed.controller.handleLoginCompleted({ loginId: null, success: false, error: null });
    expect(failed.state.authentication.login).toMatchObject({
      status: 'error', loginId: 'login-current', error: 'Codex sign-in failed',
    });

    const successful = setupController(vi.fn(async () => { throw new Error('refresh failed'); }));
    successful.controller.handleLoginCompleted({ loginId: 'login-2', success: true, error: null });
    expect(successful.state.authentication.login.status).toBe('completed');
    await vi.waitFor(() => expect(successful.host.reportError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'refresh failed',
    })));
  });
});

function authentication(overrides: Partial<CodexSurfaceAuthentication> = {}): CodexSurfaceAuthentication {
  return { ...initialAuthentication(), ...overrides };
}

function setupController(request: ReturnType<typeof vi.fn>) {
  const state = initialSurfaceSnapshot(initialAuthentication());
  const host: CodexSurfaceAuthenticationHost = {
    bootstrapSurfaceData: vi.fn(async () => undefined),
    clearAuthenticatedSurfaceData: vi.fn(async () => undefined),
    getSnapshot: () => state,
    patchAuthentication: vi.fn((patch: Partial<CodexSurfaceAuthentication>, _origin: CodexSurfaceEventOrigin) => {
      state.authentication = { ...state.authentication, ...patch };
    }),
    reportError: vi.fn(),
  };
  const client = { request } as unknown as CodexAppServerClient;
  return { controller: new CodexSurfaceAuthenticationController(client, host), host, state };
}
