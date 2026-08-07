import { createServer, type IncomingMessage } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createCodexAppBackend } from '@codex-app-sdk/backend';
import {
  bindCodexWebSocket,
  createCodexNodeWebSocketPort,
} from '@codex-app-sdk/web/server';

type SiteUser = { id: string };
type WebSessionContext = { request: IncomingMessage; siteUser: SiteUser };

const port = Number(process.env.PORT ?? 3000);
const clientDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
const app = express();
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });
const backend = createCodexAppBackend();

app.use(express.static(clientDirectory));
app.get('/', (_request, response) => response.sendFile(path.join(clientDirectory, 'index.html')));

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const siteUser = authenticateSiteRequest(request);
  if (pathname !== '/codex' || !siteUser) {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    const binding = bindCodexWebSocket({
      socket: createCodexNodeWebSocketPort(webSocket),
      context: { request, siteUser },
      authorize: acquireCodexSession,
    });
    void binding.ready.catch((error: unknown) => {
      console.error('Codex web session failed:', error);
    });
  });
});

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`{{displayName}}: http://127.0.0.1:${port}`);
});

function authenticateSiteRequest(_request: IncomingMessage): SiteUser | null {
  // DEMO ONLY: replace this with the website's cookie/session authentication.
  return { id: 'local-demo-user' };
}

function acquireCodexSession({ siteUser }: WebSessionContext) {
  // A production host would acquire this user's isolated backend/process here.
  return siteUser.id === 'local-demo-user' ? { surface: backend.surface } : null;
}

async function shutdown(): Promise<void> {
  webSocketServer.close();
  httpServer.close();
  await backend.close();
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
