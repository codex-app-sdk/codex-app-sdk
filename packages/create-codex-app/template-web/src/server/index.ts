import { createServer, type IncomingMessage } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createCodexAppBackend } from '@codex-app-sdk/backend';
import {
  bindCodexWebSocket,
  createCodexNodeWebSocketPort,
  isAllowedCodexWebSocketOrigin,
} from '@codex-app-sdk/web/server';

type SiteUser = { id: string };
type WebSessionContext = { request: IncomingMessage; siteUser: SiteUser };

const port = Number(process.env.PORT ?? 3000);
// Browsers let any website open a WebSocket to this server, so only pages
// served from these origins may drive Codex. Set ALLOWED_ORIGINS
// (comma-separated) to the public origin when deploying.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean)
  ?? [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const clientDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
const app = express();
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });
const backend = createCodexAppBackend({
  surfaceOptions: { autoSelectFirstConversation: false },
});

app.use(express.static(clientDirectory));
app.get('/', (_request, response) => response.sendFile(path.join(clientDirectory, 'index.html')));

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname !== '/codex' || !isAllowedCodexWebSocketOrigin(request, allowedOrigins)) {
    socket.destroy();
    return;
  }
  const siteUser = authenticateSiteRequest(request);
  if (!siteUser) {
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
  for (const client of webSocketServer.clients) client.terminate();
  await Promise.all([
    new Promise<void>((resolve) => webSocketServer.close(() => resolve())),
    new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve())),
    backend.close(),
  ]);
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
