import { createServer } from 'node:http';
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
type WebSessionContext = {
  request: import('node:http').IncomingMessage;
  siteUser: SiteUser;
};

const port = Number(process.env.PORT ?? 3000);
const devServerPort = Number(process.env.VITE_PORT ?? 5173);
// Browsers let any website open a WebSocket to this server, so only the built
// client and the Vite dev server (which proxies /codex) may drive Codex.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean)
  ?? [port, devServerPort].flatMap((origin) => [`http://127.0.0.1:${origin}`, `http://localhost:${origin}`]);
const clientDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
const app = express();
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });

// The default backend uses the already-authenticated default Codex home.
// A production host would acquire a stable, isolated backend for siteUser.id here.
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
  console.log(`Codex Basic web sample: http://127.0.0.1:${port}`);
});

function authenticateSiteRequest(_request: import('node:http').IncomingMessage): SiteUser | null {
  // DEMO ONLY: replace this with the website's cookie/session authentication.
  return { id: 'local-demo-user' };
}

function acquireCodexSession({ siteUser }: WebSessionContext) {
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
