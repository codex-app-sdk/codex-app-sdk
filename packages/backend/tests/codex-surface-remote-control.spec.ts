import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import { configRequirements, MockCodexAppServer, lastRequest } from './helpers/codex-surface-fixture';

describe('CodexSurface remote control', () => {
  it('exposes state-neutral pairing, client management, and managed requirements methods', async () => {
    const status = {
      status: 'connected' as const,
      serverName: 'codex-desktop',
      installationId: 'installation-1',
      environmentId: 'environment-1',
    };
    const requirements = configRequirements({ allowRemoteControl: true });
    const transport = new MockCodexAppServer({
      'configRequirements/read': () => ({
        requirements,
      }),
      'remoteControl/status/read': () => status,
      'remoteControl/enable': () => ({ ...status, status: 'connecting' as const }),
      'remoteControl/disable': () => ({ ...status, status: 'disabled' as const, environmentId: null }),
      'remoteControl/pairing/start': () => ({
        pairingCode: 'pairing-code',
        manualPairingCode: '1234-5678',
        environmentId: 'environment-1',
        expiresAt: 123n,
      }),
      'remoteControl/pairing/status': () => ({ claimed: true }),
      'remoteControl/client/list': () => ({
        data: [{
          clientId: 'client-1',
          displayName: 'Nicolas phone',
          deviceType: 'phone',
          platform: 'ios',
          osVersion: '18.0',
          deviceModel: 'iPhone',
          appVersion: '1.0.0',
          lastSeenAt: 123n,
        }],
        nextCursor: null,
      }),
      'remoteControl/client/revoke': () => ({}),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));
    const snapshotBeforeActions = surface.getSnapshot();

    await expect(surface.readRemoteControlStatus()).resolves.toStrictEqual(status);
    await expect(surface.enableRemoteControl({ ephemeral: true })).resolves.toMatchObject({ status: 'connecting' });
    await expect(surface.disableRemoteControl()).resolves.toMatchObject({ status: 'disabled', environmentId: null });
    await expect(surface.startRemoteControlPairing({ manualCode: true })).resolves.toMatchObject({
      pairingCode: 'pairing-code', manualPairingCode: '1234-5678', expiresAt: 123n,
    });
    await expect(surface.readRemoteControlPairingStatus({ pairingCode: 'pairing-code' }))
      .resolves.toStrictEqual({ claimed: true });
    await expect(surface.listRemoteControlClients({ environmentId: 'environment-1', limit: 10, order: 'desc' }))
      .resolves.toMatchObject({ data: [expect.objectContaining({ clientId: 'client-1' })], nextCursor: null });
    await expect(surface.revokeRemoteControlClient({ environmentId: 'environment-1', clientId: 'client-1' }))
      .resolves.toStrictEqual({});
    await expect(surface.readConfigRequirements()).resolves.toStrictEqual(requirements);

    expect(surface.getSnapshot()).toStrictEqual(snapshotBeforeActions);
    expect(lastRequest(transport, 'remoteControl/enable')).toMatchObject({ params: { ephemeral: true } });
    expect(lastRequest(transport, 'remoteControl/pairing/start')).toMatchObject({ params: { manualCode: true } });
    expect(lastRequest(transport, 'remoteControl/pairing/status')).toMatchObject({ params: { pairingCode: 'pairing-code' } });
    expect(lastRequest(transport, 'remoteControl/client/list')).toMatchObject({
      params: { environmentId: 'environment-1', limit: 10, order: 'desc' },
    });
    expect(lastRequest(transport, 'remoteControl/client/revoke')).toMatchObject({
      params: { environmentId: 'environment-1', clientId: 'client-1' },
    });
  });
});
