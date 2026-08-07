import { describe, expect, it, vi } from 'vitest';
import type { CodexAppServerClient } from '../packages/backend/src/codex';
import type { CodexSurfaceSnapshot } from '../src/surface';
import {
  CodexSurfaceCatalogController,
  type CodexSurfaceCatalogHost,
} from '../packages/backend/src/node/codex-surface-catalog-controller';
import { initialAuthentication } from '../packages/backend/src/node/codex-surface-authentication';
import { createThreadRuntime, initialSurfaceSnapshot } from '../packages/backend/src/node/codex-surface-runtime';

describe('CodexSurfaceCatalogController', () => {
  it('returns cached models or paginates and applies a fresh selection', async () => {
    const cached = setupCatalog(vi.fn());
    cached.state.models = [{ id: 'cached', model: 'cached', displayName: 'Cached' }];
    cached.state.modelCatalogStatus = 'loaded';
    await expect(cached.controller.listModels({ forceReload: false })).resolves.toStrictEqual(cached.state.models);
    expect(cached.request).not.toHaveBeenCalled();

    const request = vi.fn(async (_method: string, params: { cursor?: string | null }) => params.cursor
      ? { data: [model('default', true)], nextCursor: null }
      : { data: [model('first', false)], nextCursor: 'page-2' });
    const fresh = setupCatalog(request);
    await expect(fresh.controller.listModels()).resolves.toHaveLength(2);
    expect(fresh.state).toMatchObject({
      modelCatalogStatus: 'loaded', selectedModelId: 'default', selectedReasoningEffort: 'medium',
    });
    expect(fresh.host.emitEvent).toHaveBeenCalledWith('action', expect.objectContaining({
      type: 'catalog.modelsChanged', payload: expect.objectContaining({ status: 'loaded' }),
    }));
  });

  it('updates matching conversation skill catalogs and isolates request failures', async () => {
    const skill = {
      name: 'review', description: 'Review', shortDescription: null, path: '/skills/review/SKILL.md',
      scope: 'user', enabled: true, interface: null,
    };
    const request = vi.fn(async (method: string) => {
      if (method === 'skills/list') return { data: [{ cwd: '/workspace', skills: [skill], errors: [] }] };
      throw new Error('unavailable');
    });
    const setup = setupCatalog(request);
    setup.runtime.cwd = '/workspace';

    await expect(setup.controller.listSkills({ cwd: '/workspace' })).resolves.toMatchObject([{ name: 'review' }]);
    expect(setup.runtime.skillCatalogStatus).toBe('loaded');
    expect(setup.host.emitConversationSkills).toHaveBeenCalledWith('thread-1', 'action');

    await setup.controller.loadModels();
    expect(setup.state).toMatchObject({ modelCatalogStatus: 'error', models: [] });
    await setup.controller.loadPermissionProfiles();
    expect(setup.state).toMatchObject({ permissionProfiles: [], approvalPresets: [], approvalPreset: null });
    await setup.controller.loadRateLimits();
    expect(setup.state.rateLimits).toBeNull();
  });

  it('loads plugin scope once and can explicitly invalidate it', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'plugin/installed') return { marketplaces: [], marketplaceLoadErrors: [] };
      return {};
    });
    const setup = setupCatalog(request);
    setup.state.status = 'ready';
    setup.state.conversations = [{
      id: 'thread-1', title: 'Thread', preview: '', cwd: '/workspace', status: 'idle',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', turnCount: 0,
    }];

    setup.controller.schedulePluginRefresh();
    await vi.waitFor(() => expect(setup.state.pluginCatalogStatus).toBe('loaded'));
    setup.controller.schedulePluginRefresh();
    expect(request.mock.calls.filter(([method]) => method === 'plugin/installed')).toHaveLength(1);
    setup.controller.schedulePluginRefresh(true);
    await vi.waitFor(() => expect(request.mock.calls.filter(([method]) => method === 'plugin/installed')).toHaveLength(2));
  });
});

function setupCatalog(request: ReturnType<typeof vi.fn>) {
  const state = initialSurfaceSnapshot(initialAuthentication());
  const runtime = createThreadRuntime('thread-1', state);
  const host: CodexSurfaceCatalogHost = {
    authenticationBlocksBootstrap: () => false,
    emitConversationPermissions: vi.fn(),
    emitConversationSkills: vi.fn(),
    emitEvent: vi.fn(),
    ensureConnected: vi.fn(async () => undefined),
    getState: () => state,
    isClosed: () => false,
    patch: vi.fn((patch: Partial<CodexSurfaceSnapshot>) => Object.assign(state, patch)),
    patchRuntime: vi.fn((_threadId, patch) => Object.assign(runtime, patch)),
    preferredApprovalPreset: () => 'ask-for-approval',
    runtimes: () => [runtime],
  };
  const client = { request } as unknown as CodexAppServerClient;
  return {
    controller: new CodexSurfaceCatalogController(client, '/project', host),
    host, request, runtime, state,
  };
}

function model(id: string, isDefault: boolean) {
  return {
    id, model: id, displayName: id, description: 'Model', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium', isDefault, inputModalities: ['text'], serviceTiers: [],
    supportsPersonality: false, upgrade: null, upgradeInfo: null,
  };
}
