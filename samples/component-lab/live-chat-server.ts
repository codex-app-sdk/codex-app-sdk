import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createCodexAppBackend } from '../../packages/backend/src/index';
import { bindCodexWebSocket, createCodexNodeWebSocketPort } from '../../packages/web/src/server';

/** Dev-only, same-origin loopback access to the local Codex login. */
export function liveChatServer(): Plugin {
  return {
    name: 'live-chat-lab',
    configureServer(server) {
      const sockets = new WebSocketServer({ noServer: true });
      const backends = new Set<ReturnType<typeof createCodexAppBackend>>();
      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (request.url !== '/live-chat') return;
        const address = request.socket.remoteAddress;
        const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
        const listening = server.httpServer?.address();
        const port = listening && typeof listening === 'object' ? listening.port : null;
        const localHost = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(request.headers.host ?? '');
        if (!local || !localHost || request.headers.origin !== `http://${request.headers.host}`) {
          socket.destroy();
          return;
        }
        sockets.handleUpgrade(request, socket, head, (webSocket) => {
          const backend = createCodexAppBackend({ surfaceOptions: {
            autoSelectFirstConversation: false,
            permissionMode: 'read-only',
            approvalMode: 'ask',
          } });
          backends.add(backend);
          const binding = bindCodexWebSocket({
            socket: createCodexNodeWebSocketPort(webSocket),
            context: undefined,
            authorize: () => ({
              surface: backend.surface,
              release: async () => { backends.delete(backend); await backend.close(); },
            }),
          });
          void binding.ready.catch(() => undefined); // The bridge sends the failure to the lab.
        });
      });
      server.httpServer?.once('close', () => {
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        for (const backend of backends) void backend.close();
      });
    },
  };
}
