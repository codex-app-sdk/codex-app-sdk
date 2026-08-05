# Add a backend service

The scaffold creates one `CodexAppBackend` in Electron main. Add a backend
module when an app-owned panel needs trusted data or behavior that should not
live in the renderer.

Use a backend module for deterministic application services. If Codex itself
must decide when to call the capability, build an [MCP server](/guide/mcp)
instead.

## 1. Define the service

Add `src/main/notes-service.ts`:

```ts
import type { CodexAppBackendModule } from 'codex-app-sdk/node';

export type Note = {
  id: string;
  title: string;
};

export type NotesService = {
  list(): Promise<readonly Note[]>;
};

export function createNotesModule(): CodexAppBackendModule<NotesService> {
  return {
    id: 'notes',
    create: () => ({
      list: async () => readNotesFromDisk(),
    }),
  };
}
```

`readNotesFromDisk` is application code. The service runs in the trusted main
process and may use filesystem, database, or network clients that must never be
exposed directly to the renderer.

## 2. Register it in the generated backend

In `src/main/index.ts`, replace the generated `createCodexAppBackend()` call:

```ts
import { createNotesModule, type NotesService } from './notes-service';

backend = createCodexAppBackend({
  modules: [createNotesModule()],
});

const notes = backend.module<NotesService>('notes');
```

Keep the generated `registerCodexElectronMain({ surface: backend.surface })`
and `backend.close()` calls unchanged. Every module receives the same surface
and shares its lifecycle.

## 3. Expose a narrow renderer API

The SDK bridge intentionally exposes Codex capabilities only. Add a separate,
app-owned IPC contract for the panel:

```ts
// src/main/index.ts
ipcMain.handle('notes:list', () => notes.list());
```

```ts
// src/main/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeCodexElectronPreload } from 'codex-app-sdk/electron/preload';

exposeCodexElectronPreload(contextBridge, ipcRenderer);
contextBridge.exposeInMainWorld('notes', {
  list: () => ipcRenderer.invoke('notes:list'),
});
```

Declare the renderer type next to the generated window declarations, then use
it from your panel:

```ts
declare global {
  interface Window {
    notes: {
      list(): Promise<readonly { id: string; title: string }[]>;
    };
  }
}
```

Keep arguments and results serializable, validate renderer input in main, and
remove custom handlers during shutdown if the window integration can be
registered more than once. See [Electron integration](/guide/electron) for the
SDK bridge and [Security boundary](/guide/security) for trust rules.

## Use the shared surface when useful

A module receives the SDK surface, backend shutdown hook, and cache factory:

```ts
const module: CodexAppBackendModule<NotesService> = {
  id: 'notes',
  create({ surface, createTtlCache }) {
    const cache = createTtlCache({
      ttlMs: 15 * 60_000,
      identity: (entry: { conversationId: string }) => entry.conversationId,
      canEvict: () => true,
      onEvict: (entry) => surface.forgetConversation(entry.conversationId),
    });

    return createNotesService({ surface, cache });
  },
};
```

This does not make the SDK own notes, agents, teams, or other product state.
The backend is only a composition root around one reusable `CodexSurface`.

## Lifecycle and caching

- `backend.close()` closes the shared surface and every TTL cache created by
  the backend. The scaffold already calls it before application shutdown.
- Modules remain responsible for closing their own database clients,
  subscriptions, and timers.
- `backend.createTtlCache()` is optional. It tracks activity and asks the host
  whether an entry is safe to evict; it never decides which product data is
  disposable.
- `surface.forgetConversation(id)` releases rehydratable SDK memory without
  deleting or archiving the app-server thread. See
  [History and performance](/guide/history#releasing-inactive-conversations).

## Choose the right seam

| Requirement | Use |
| --- | --- |
| Data shown deterministically in an app panel | Backend module + app-owned IPC |
| Capability the model may call | [MCP server](/guide/mcp) |
| Small in-process model tool | [Dynamic tool](/guide/extensions#dynamic-tools) |
| Conversation instructions or start/resume config | [Surface extension](/guide/extensions) |
| Renderer-only visual state | Plain Vue state in the [app shell](/guide/app-ui) |

For the complete business-data loop—backend module, read-only IPC, MCP tools,
and UI refresh after tool completion—see the [Relay sample](/guide/samples#relay-business-ui-mcp).
