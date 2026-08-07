import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../packages/backend/src/codex';
import { CodexSurface } from '../packages/backend/src/node';
import type { CodexSurfaceEvent } from '../src/surface';
import { FakeTransport, lastRequest, pluginSummary, resumeResponse, thread } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
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

});
